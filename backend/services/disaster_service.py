from __future__ import annotations

import asyncio
import csv
import io
import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Iterable

import httpx

from models.disaster import Disaster

logger = logging.getLogger(__name__)

RELIEFWEB_API_URL = "https://api.reliefweb.int/v2/disasters"
FIRMS_API_TEMPLATE = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
    "{api_key}/{source}/{west},{south},{east},{north}/{days}"
)
OPENWEATHER_ONE_CALL_URL = "https://api.openweathermap.org/data/3.0/onecall"
RESTCOUNTRIES_API_TEMPLATE = "https://restcountries.com/v3.1/alpha/{country_code}"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"

REQUEST_TIMEOUT_SECONDS = 20.0
DISASTER_CACHE_TTL_SECONDS = int(os.getenv("DISASTER_CACHE_TTL_SECONDS", "180"))
RELIEFWEB_LIMIT = int(os.getenv("RELIEFWEB_LIMIT", "30"))
FIRMS_LOOKBACK_DAYS = int(os.getenv("FIRMS_LOOKBACK_DAYS", "2"))
DISASTER_DEDUP_DISTANCE_KM = float(os.getenv("DISASTER_DEDUP_DISTANCE_KM", "10"))

DEFAULT_WEATHER_POINTS = [
    ("Hyderabad", 17.3850, 78.4867),
    ("Delhi", 28.6139, 77.2090),
    ("Mumbai", 19.0760, 72.8777),
    ("Chennai", 13.0827, 80.2707),
    ("Kolkata", 22.5726, 88.3639),
]
FIRMS_SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT")
CONFIDENCE_PRIORITY = {
    "low": 0,
    "medium": 1,
    "high": 2,
}

_cache_lock = asyncio.Lock()
_disaster_cache: dict[str, tuple[float, list[Disaster]]] = {}
_country_centroid_cache: dict[str, tuple[float, float] | None] = {}


@dataclass(frozen=True)
class BoundingBox:
    west: float
    south: float
    east: float
    north: float

    def contains(self, latitude: float, longitude: float) -> bool:
        return self.south <= latitude <= self.north and self.west <= longitude <= self.east

    def cache_key(self) -> str:
        return ":".join(
            [
                f"{self.west:.2f}",
                f"{self.south:.2f}",
                f"{self.east:.2f}",
                f"{self.north:.2f}",
            ]
        )


def _default_bounds() -> BoundingBox:
    return BoundingBox(west=67.0, south=6.0, east=98.0, north=37.0)


def _build_cache_key(bounds: BoundingBox | None) -> str:
    target_bounds = bounds or _default_bounds()
    return f"bbox:{target_bounds.cache_key()}"


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)

    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=UTC)

    if not value:
        return None

    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue

    logger.debug("Discarding unparseable datetime '%s'.", text)
    return None


def _parse_first_datetime(*values: Any) -> datetime | None:
    for value in values:
        parsed = _parse_datetime(value)
        if parsed is not None:
            return parsed

    return None


def _parse_firms_timestamp(acq_date: str | None, acq_time: str | None) -> datetime | None:
    if not acq_date:
        return None

    time_text = str(acq_time or "0000").zfill(4)

    try:
        return datetime.strptime(
            f"{acq_date} {time_text}",
            "%Y-%m-%d %H%M",
        ).replace(tzinfo=UTC)
    except ValueError:
        return _parse_datetime(acq_date)


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_type(raw_type: str | None) -> str:
    text = (raw_type or "").strip().lower()

    if any(keyword in text for keyword in ("wildfire", "forest fire", "bushfire", "fire")):
        return "fire"
    if "earthquake" in text or "seismic" in text:
        return "earthquake"
    if "flood" in text or "flash flood" in text:
        return "flood"
    if any(
        keyword in text
        for keyword in (
            "storm",
            "cyclone",
            "typhoon",
            "hurricane",
            "rain",
            "weather",
            "thunder",
            "wind",
            "snow",
            "monsoon",
            "hail",
            "landslide",
            "tornado",
            "cold",
            "heat",
        )
    ):
        return "weather"

    sanitized = "".join(character for character in text if character.isalnum() or character == "_")
    return sanitized or "other"


def _calculate_confidence(disaster: dict[str, Any]) -> str:
    """
    Determine confidence from source reliability, timestamp freshness,
    and how complete the normalized record is.
    """
    source = str(disaster.get("source", "")).strip().lower()
    timestamp = _parse_datetime(disaster.get("timestamp"))
    now = datetime.now(tz=UTC)

    age_hours: float | None = None
    if timestamp is not None:
        age_hours = max(0.0, (now - timestamp).total_seconds() / 3600)

    completeness_score = sum(
        1
        for value in (
            disaster.get("severity"),
            disaster.get("location"),
            disaster.get("title"),
            disaster.get("description"),
        )
        if value not in (None, "")
    )

    reliable_sources = {"reliefweb", "nasa-firms", "nasa"}
    trusted_sources = {"openweather"}

    is_fresh = age_hours is not None and age_hours <= 72
    is_recent = age_hours is not None and age_hours <= 24 * 30

    if source in reliable_sources and is_fresh and completeness_score >= 2:
        return "high"

    if (
        (source in reliable_sources and is_recent)
        or (source in trusted_sources and is_fresh)
        or (timestamp is not None and completeness_score >= 1)
    ):
        return "medium"

    return "low"


def _score_reliefweb_severity(raw_type: str | None, title: str | None) -> float:
    text = f"{raw_type or ''} {title or ''}".lower()

    if "earthquake" in text:
        return 92.0
    if any(keyword in text for keyword in ("cyclone", "hurricane", "typhoon", "tornado")):
        return 88.0
    if "flood" in text:
        return 82.0
    if "fire" in text:
        return 78.0
    if any(keyword in text for keyword in ("storm", "landslide", "volcanic", "eruption")):
        return 72.0
    return 60.0


def _score_weather_severity(event: str | None, tags: Iterable[str] | None, description: str | None) -> float:
    text = " ".join(
        part for part in [event or "", " ".join(tags or []), description or ""] if part
    ).lower()

    if any(keyword in text for keyword in ("hurricane", "cyclone", "typhoon", "tornado")):
        return 94.0
    if "flood" in text:
        return 86.0
    if any(keyword in text for keyword in ("storm", "thunder", "lightning")):
        return 78.0
    if any(keyword in text for keyword in ("rain", "snow", "wind", "heat", "cold")):
        return 68.0
    return 58.0


def _score_fire_severity(row: dict[str, str]) -> float | None:
    brightness = _to_float(row.get("bright_ti4") or row.get("brightness"))
    frp = _to_float(row.get("frp"))

    if brightness is None and frp is None:
        return None

    brightness_score = brightness / 5 if brightness is not None else 0
    frp_score = frp / 5 if frp is not None else 0
    return round(min(max(brightness_score, frp_score), 100.0), 2)


def _first_name(values: Any) -> str | None:
    if isinstance(values, list):
        for item in values:
            if isinstance(item, dict) and item.get("name"):
                return item["name"]
            if isinstance(item, str):
                return item

    if isinstance(values, dict):
        return values.get("name")

    if isinstance(values, str):
        return values

    return None


def _first_country_name(values: Any) -> str | None:
    if isinstance(values, list):
        for item in values:
            if isinstance(item, dict) and item.get("name"):
                return item["name"]

    if isinstance(values, dict):
        return values.get("name")

    return None


def _first_country_iso3(values: Any) -> str | None:
    if isinstance(values, list):
        for item in values:
            if isinstance(item, dict) and item.get("iso3"):
                return item["iso3"]

    if isinstance(values, dict):
        return values.get("iso3")

    return None


def _extract_text(value: Any) -> str | None:
    if value is None:
        return None

    if isinstance(value, str):
        text = value.strip()
        return text or None

    if isinstance(value, dict):
        for key in ("text", "html", "value", "content", "summary", "body"):
            extracted = _extract_text(value.get(key))
            if extracted:
                return extracted

        for nested_value in value.values():
            extracted = _extract_text(nested_value)
            if extracted:
                return extracted

        return None

    if isinstance(value, list):
        parts = [_extract_text(item) for item in value]
        joined = " ".join(part for part in parts if part)
        return joined or None

    text = str(value).strip()
    return text or None


def _extract_coordinates(payload: Any) -> tuple[float, float] | None:
    if isinstance(payload, dict):
        for lat_key, lon_key in (
            ("latitude", "longitude"),
            ("lat", "lon"),
            ("lat", "lng"),
        ):
            latitude = _to_float(payload.get(lat_key))
            longitude = _to_float(payload.get(lon_key))
            if latitude is not None and longitude is not None:
                return (latitude, longitude)

        coordinates = payload.get("coordinates")
        if isinstance(coordinates, dict):
            nested_coordinates = _extract_coordinates(coordinates)
            if nested_coordinates:
                return nested_coordinates

        if isinstance(coordinates, list) and len(coordinates) >= 2:
            longitude = _to_float(coordinates[0])
            latitude = _to_float(coordinates[1])
            if latitude is not None and longitude is not None:
                return (latitude, longitude)

        geometry = payload.get("geometry")
        if isinstance(geometry, dict):
            geometry_coordinates = geometry.get("coordinates")
            if isinstance(geometry_coordinates, list) and len(geometry_coordinates) >= 2:
                longitude = _to_float(geometry_coordinates[0])
                latitude = _to_float(geometry_coordinates[1])
                if latitude is not None and longitude is not None:
                    return (latitude, longitude)

        for key in ("location", "point", "origin", "center", "centroid", "primary_country", "country"):
            nested_value = payload.get(key)
            if nested_value is None:
                continue
            nested_coordinates = _extract_coordinates(nested_value)
            if nested_coordinates:
                return nested_coordinates

        for value in payload.values():
            nested_coordinates = _extract_coordinates(value)
            if nested_coordinates:
                return nested_coordinates

    if isinstance(payload, list):
        for item in payload:
            nested_coordinates = _extract_coordinates(item)
            if nested_coordinates:
                return nested_coordinates

    return None


def _filter_by_bounds(disasters: Iterable[Disaster], bounds: BoundingBox | None) -> list[Disaster]:
    if not bounds:
        return list(disasters)

    return [disaster for disaster in disasters if bounds.contains(disaster.latitude, disaster.longitude)]


def _haversine_distance_km(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    earth_radius_km = 6371.0

    phi_1 = math.radians(latitude_a)
    phi_2 = math.radians(latitude_b)
    delta_phi = math.radians(latitude_b - latitude_a)
    delta_lambda = math.radians(longitude_b - longitude_a)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_1) * math.cos(phi_2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


def _deduplicate_disasters(disasters: list[Disaster]) -> list[Disaster]:
    sorted_disasters = sorted(
        disasters,
        key=lambda disaster: (
            CONFIDENCE_PRIORITY.get(disaster.confidence, 0),
            disaster.severity is not None,
            disaster.severity or 0,
            disaster.timestamp,
        ),
        reverse=True,
    )
    deduplicated: list[Disaster] = []

    for candidate in sorted_disasters:
        is_duplicate = False

        for existing in deduplicated:
            if existing.type != candidate.type:
                continue

            if (
                _haversine_distance_km(
                    existing.latitude,
                    existing.longitude,
                    candidate.latitude,
                    candidate.longitude,
                )
                <= DISASTER_DEDUP_DISTANCE_KM
            ):
                is_duplicate = True
                break

        if not is_duplicate:
            deduplicated.append(candidate)

    return deduplicated


def _create_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS),
        headers={
            "Accept": "application/json,text/csv;q=0.9,*/*;q=0.8",
            "User-Agent": "vnr-disaster-response/1.0",
        },
    )


async def _lookup_country_centroid(
    client: httpx.AsyncClient,
    iso3: str | None,
    location_name: str | None,
) -> tuple[float, float] | None:
    cache_key = (iso3 or location_name or "").strip().lower()
    if not cache_key:
        return None

    cached = _country_centroid_cache.get(cache_key)
    if cache_key in _country_centroid_cache:
        return cached

    if iso3:
        try:
            response = await client.get(
                RESTCOUNTRIES_API_TEMPLATE.format(country_code=iso3.upper()),
                params={"fields": "latlng"},
            )
            response.raise_for_status()
            payload = response.json()
            coordinates = payload.get("latlng") if isinstance(payload, dict) else None
            if isinstance(coordinates, list) and len(coordinates) >= 2:
                centroid = (_to_float(coordinates[0]), _to_float(coordinates[1]))
                if centroid[0] is not None and centroid[1] is not None:
                    _country_centroid_cache[cache_key] = (centroid[0], centroid[1])
                    return _country_centroid_cache[cache_key]
        except httpx.HTTPError as exc:
            logger.debug("Country centroid lookup failed for %s: %s", iso3, exc)

    if location_name:
        try:
            response = await client.get(
                NOMINATIM_SEARCH_URL,
                params={"q": location_name, "format": "jsonv2", "limit": 1},
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, list) and payload:
                centroid = (
                    _to_float(payload[0].get("lat")),
                    _to_float(payload[0].get("lon")),
                )
                if centroid[0] is not None and centroid[1] is not None:
                    _country_centroid_cache[cache_key] = (centroid[0], centroid[1])
                    return _country_centroid_cache[cache_key]
        except httpx.HTTPError as exc:
            logger.debug("Fallback geocode lookup failed for %s: %s", location_name, exc)

    _country_centroid_cache[cache_key] = None
    return None


async def _fetch_reliefweb_disasters(
    client: httpx.AsyncClient,
    bounds: BoundingBox | None,
) -> list[Disaster]:
    reliefweb_appname = os.getenv("RELIEFWEB_APPNAME")
    if not reliefweb_appname:
        logger.warning(
            "RELIEFWEB_APPNAME is not configured; skipping ReliefWeb disasters."
        )
        return []

    try:
        response = await client.get(
            RELIEFWEB_API_URL,
            params=[
                ("appname", reliefweb_appname),
                ("limit", str(RELIEFWEB_LIMIT)),
                ("profile", "full"),
                ("sort[]", "date.event:desc"),
            ],
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        logger.warning("ReliefWeb request failed: %s", exc)
        return []

    disasters: list[Disaster] = []
    for item in payload.get("data", []):
        fields = item.get("fields", {})
        date_fields = fields.get("date") if isinstance(fields.get("date"), dict) else {}
        coordinates = _extract_coordinates(fields)
        location_name = _first_country_name(fields.get("primary_country")) or _first_country_name(
            fields.get("country")
        )

        if not coordinates:
            coordinates = await _lookup_country_centroid(
                client,
                _first_country_iso3(fields.get("primary_country")),
                location_name,
            )

        if not coordinates:
            continue

        raw_type = _first_name(fields.get("primary_type")) or _first_name(fields.get("type"))
        timestamp = _parse_first_datetime(
            date_fields.get("event"),
            date_fields.get("created"),
            date_fields.get("changed"),
            fields.get("created_at"),
            item.get("created_at"),
        )
        if timestamp is None:
            continue

        normalized_disaster = {
            "id": f"reliefweb:{item.get('id') or fields.get('id')}",
            "type": _normalize_type(raw_type or fields.get("name")),
            "latitude": coordinates[0],
            "longitude": coordinates[1],
            "severity": _score_reliefweb_severity(raw_type, fields.get("name")),
            "timestamp": timestamp,
            "source": "reliefweb",
            "location": location_name,
            "title": fields.get("name"),
            "description": _extract_text(fields.get("description")),
        }
        normalized_disaster["confidence"] = _calculate_confidence(normalized_disaster)
        disasters.append(Disaster(**normalized_disaster))

    return _filter_by_bounds(disasters, bounds)


async def _fetch_firms_source(
    client: httpx.AsyncClient,
    source: str,
    bounds: BoundingBox,
) -> list[Disaster]:
    api_key = os.getenv("NASA_API_KEY")
    if not api_key:
        logger.warning("NASA_API_KEY is not configured; skipping NASA FIRMS data.")
        return []

    url = FIRMS_API_TEMPLATE.format(
        api_key=api_key,
        source=source,
        west=f"{bounds.west:.4f}",
        south=f"{bounds.south:.4f}",
        east=f"{bounds.east:.4f}",
        north=f"{bounds.north:.4f}",
        days=FIRMS_LOOKBACK_DAYS,
    )

    try:
        response = await client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("NASA FIRMS request failed for %s: %s", source, exc)
        return []

    if not response.text.strip():
        return []

    disasters: list[Disaster] = []
    reader = csv.DictReader(io.StringIO(response.text))
    for row in reader:
        latitude = _to_float(row.get("latitude"))
        longitude = _to_float(row.get("longitude"))
        if latitude is None or longitude is None:
            continue

        timestamp = _parse_firms_timestamp(row.get("acq_date"), row.get("acq_time"))
        if timestamp is None:
            continue

        marker_id = ":".join(
            [
                "firms",
                source.lower(),
                row.get("acq_date") or timestamp.date().isoformat(),
                str(row.get("acq_time") or "0000"),
                f"{latitude:.4f}",
                f"{longitude:.4f}",
            ]
        )

        normalized_disaster = {
            "id": marker_id,
            "type": "fire",
            "latitude": latitude,
            "longitude": longitude,
            "severity": _score_fire_severity(row),
            "timestamp": timestamp,
            "source": "nasa-firms",
            "location": row.get("county") or row.get("state") or row.get("country"),
            "title": f"Thermal hotspot ({source})",
            "description": "NASA FIRMS detected a thermal hotspot that may affect nearby travel.",
        }
        normalized_disaster["confidence"] = _calculate_confidence(normalized_disaster)
        disasters.append(Disaster(**normalized_disaster))

    return disasters


def _weather_probe_points(bounds: BoundingBox | None) -> list[tuple[str, float, float]]:
    if not bounds:
        return DEFAULT_WEATHER_POINTS

    center_latitude = (bounds.north + bounds.south) / 2
    center_longitude = (bounds.east + bounds.west) / 2
    candidates = [
        ("North West", bounds.north, bounds.west),
        ("North East", bounds.north, bounds.east),
        ("South West", bounds.south, bounds.west),
        ("South East", bounds.south, bounds.east),
        ("Center", center_latitude, center_longitude),
    ]

    probe_points: list[tuple[str, float, float]] = []
    for label, latitude, longitude in candidates:
        rounded_point = (label, round(latitude, 3), round(longitude, 3))
        if rounded_point not in probe_points:
            probe_points.append(rounded_point)
    return probe_points


async def _fetch_weather_alerts(
    client: httpx.AsyncClient,
    bounds: BoundingBox | None,
) -> list[Disaster]:
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key:
        logger.warning(
            "OPENWEATHER_API_KEY is not configured; skipping OpenWeather alerts."
        )
        return []

    disasters: list[Disaster] = []

    async def fetch_point_alerts(label: str, latitude: float, longitude: float) -> list[Disaster]:
        try:
            response = await client.get(
                OPENWEATHER_ONE_CALL_URL,
                params={
                    "lat": latitude,
                    "lon": longitude,
                    "appid": api_key,
                    "exclude": "minutely,hourly,daily",
                },
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            logger.warning(
                "OpenWeather alert request failed for %.3f, %.3f: %s",
                latitude,
                longitude,
                exc,
            )
            return []

        point_disasters: list[Disaster] = []
        for alert in payload.get("alerts", []):
            event = alert.get("event") or "Weather Alert"
            alert_type = "flood" if "flood" in event.lower() else "weather"
            start_timestamp = _parse_first_datetime(
                alert.get("start"),
                alert.get("end"),
                alert.get("created_at"),
            )
            if start_timestamp is None:
                continue

            normalized_disaster = {
                "id": ":".join(
                    [
                        "openweather",
                        event.lower().replace(" ", "_"),
                        str(int(start_timestamp.timestamp())),
                        f"{latitude:.3f}",
                        f"{longitude:.3f}",
                    ]
                ),
                "type": alert_type,
                "latitude": latitude,
                "longitude": longitude,
                "severity": _score_weather_severity(
                    alert.get("event"),
                    alert.get("tags"),
                    alert.get("description"),
                ),
                "timestamp": start_timestamp,
                "source": "openweather",
                "location": label,
                "title": event,
                "description": _extract_text(alert.get("description")),
            }
            normalized_disaster["confidence"] = _calculate_confidence(normalized_disaster)
            point_disasters.append(Disaster(**normalized_disaster))

        return point_disasters

    weather_tasks = [
        fetch_point_alerts(label, latitude, longitude)
        for label, latitude, longitude in _weather_probe_points(bounds)
    ]
    results = await asyncio.gather(*weather_tasks, return_exceptions=True)

    for result in results:
        if isinstance(result, Exception):
            logger.warning("Unexpected OpenWeather aggregation error: %s", result)
            continue
        disasters.extend(result)

    return _filter_by_bounds(disasters, bounds)


async def fetch_reliefweb_disasters() -> list[Disaster]:
    async with _create_client() as client:
        return await _fetch_reliefweb_disasters(client, _default_bounds())


async def fetch_firms_fires() -> list[Disaster]:
    async with _create_client() as client:
        results = await asyncio.gather(
            *[_fetch_firms_source(client, source, _default_bounds()) for source in FIRMS_SOURCES],
            return_exceptions=True,
        )
        disasters: list[Disaster] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("FIRMS source aggregation failed: %s", result)
                continue
            disasters.extend(result)
        return _deduplicate_disasters(disasters)


async def fetch_weather_alerts() -> list[Disaster]:
    async with _create_client() as client:
        return await _fetch_weather_alerts(client, _default_bounds())


async def get_all_disasters(bounds: BoundingBox | None = None) -> list[Disaster]:
    target_bounds = bounds or _default_bounds()
    cache_key = _build_cache_key(target_bounds)
    now = time.monotonic()

    cached_entry = _disaster_cache.get(cache_key)
    if cached_entry and cached_entry[0] > now:
        return cached_entry[1]

    async with _cache_lock:
        cached_entry = _disaster_cache.get(cache_key)
        if cached_entry and cached_entry[0] > time.monotonic():
            return cached_entry[1]

        async with _create_client() as client:
            results = await asyncio.gather(
                _fetch_reliefweb_disasters(client, target_bounds),
                *[
                    _fetch_firms_source(client, source, target_bounds)
                    for source in FIRMS_SOURCES
                ],
                _fetch_weather_alerts(client, target_bounds),
                return_exceptions=True,
            )

        disasters: list[Disaster] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Disaster source aggregation failed: %s", result)
                continue
            disasters.extend(result)

        normalized = _deduplicate_disasters(_filter_by_bounds(disasters, target_bounds))
        normalized.sort(
            key=lambda disaster: (
                CONFIDENCE_PRIORITY.get(disaster.confidence, 0),
                disaster.severity is not None,
                disaster.severity or 0,
                disaster.timestamp,
            ),
            reverse=True,
        )

        _disaster_cache[cache_key] = (time.monotonic() + DISASTER_CACHE_TTL_SECONDS, normalized)
        return normalized
