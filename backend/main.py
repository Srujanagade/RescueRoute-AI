import logging
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models.disaster import Disaster
from services.ai_summary_service import generate_disaster_summary_result
from services.analysis_service import compute_geojson_road_status
from services.disaster_service import BoundingBox, get_all_disasters
from services.risk_service import assess_route_risk
from services.routing_service import get_smart_route

load_dotenv()

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

REQUEST_TIMEOUT_SECONDS = 30
ROAD_IMPACT_RADIUS_KM = {
    "flood": 2.6,
    "earthquake": 4.2,
    "fire": 3.0,
    "weather": 1.8,
    "other": 1.3,
}

logger = logging.getLogger(__name__)

app = FastAPI(title="Disaster Response AI - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Point(BaseModel):
    lat: float
    lng: float


class AnalyzeRequest(BaseModel):
    roads: dict[str, Any]


class DisasterImpactInput(BaseModel):
    type: str
    latitude: float | None = None
    longitude: float | None = None
    center: tuple[float, float] | None = Field(default=None, min_length=2, max_length=2)
    severity: float | None = None
    confidence: str | None = None


class RoadStatusRequest(BaseModel):
    roads: dict[str, Any]
    disasters: list[DisasterImpactInput] = Field(default_factory=list)


class CompareRequest(BaseModel):
    source: Point
    destination: Point
    from_ts: str | None = Field(None, alias="from")
    to_ts: str | None = Field(None, alias="to")


class RouteExposureSummary(BaseModel):
    total_hazards: int = 0
    high_exposure_hazards: int = 0
    by_type: dict[str, int] = Field(default_factory=dict)
    closest_hazard_km: float | None = None
    highest_severity: float | None = None


class RouteRecommendation(BaseModel):
    route_id: str
    geometry: dict[str, Any]
    duration: float
    distance: float
    risk_score: float
    safety_level: str
    hazard_hits: int = 0
    exposure_summary: RouteExposureSummary = Field(default_factory=RouteExposureSummary)


class RouteComparisonResponse(BaseModel):
    status: Literal["ok", "fallback"]
    fastest: RouteRecommendation
    safest: RouteRecommendation
    identical: bool = False
    message: str
    alternatives_returned: int
    meaningful_route_count: int
    fallback_reason: str | None = None


class DisasterSummaryRequest(BaseModel):
    disaster: Disaster


class DisasterSummaryResponse(BaseModel):
    summary: str
    used_fallback: bool = False
    provider: str = "fallback"


def _validate_geojson_roads(roads: dict[str, Any]) -> None:
    if roads.get("type") != "FeatureCollection" or "features" not in roads:
        raise HTTPException(status_code=400, detail="Invalid GeoJSON FeatureCollection")


def _parse_query_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    text = value.strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _filter_by_time(
    disasters: list[Disaster],
    start: datetime,
    end: datetime,
) -> list[Disaster]:
    return [
        disaster
        for disaster in disasters
        if start <= disaster.timestamp <= end
    ]


def _route_coordinates(geometry: dict[str, Any] | None) -> list[tuple[float, float]]:
    if not geometry or geometry.get("type") != "LineString":
        return []

    normalized_coordinates: list[tuple[float, float]] = []
    for coordinate in geometry.get("coordinates", []):
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            continue

        try:
            lon = float(coordinate[0])
            lat = float(coordinate[1])
        except (TypeError, ValueError):
            continue

        normalized_coordinates.append((lon, lat))

    return normalized_coordinates


def _sample_route_signature(
    geometry: dict[str, Any] | None,
    max_points: int = 12,
) -> tuple[tuple[float, float], ...]:
    coordinates = _route_coordinates(geometry)
    if not coordinates:
        return ()

    if len(coordinates) <= max_points:
        sampled = coordinates
    else:
        last_index = len(coordinates) - 1
        sampled = []
        for step_index in range(max_points):
            coordinate_index = round(step_index * last_index / (max_points - 1))
            point = coordinates[coordinate_index]
            if not sampled or sampled[-1] != point:
                sampled.append(point)

    return tuple((round(lon, 4), round(lat, 4)) for lon, lat in sampled)


def _severity_radius_factor(severity: float | None) -> float:
    if severity is None:
        return 1.0

    normalized = max(0.0, min(float(severity), 100.0))
    if normalized >= 85:
        return 1.6
    if normalized >= 65:
        return 1.35
    if normalized >= 40:
        return 1.15
    return 0.9


def _confidence_radius_factor(confidence: str | None) -> float:
    normalized = str(confidence or "").strip().lower()
    if normalized == "high":
        return 1.0
    if normalized == "medium":
        return 0.9
    return 0.78


def _impact_radius_for_disaster(
    disaster_type: str | None,
    severity: float | None,
    confidence: str | None,
) -> float:
    normalized_type = str(disaster_type or "other").strip().lower() or "other"
    base_radius = ROAD_IMPACT_RADIUS_KM.get(normalized_type, ROAD_IMPACT_RADIUS_KM["other"])
    radius_km = base_radius * _severity_radius_factor(severity) * _confidence_radius_factor(
        confidence
    )
    return round(max(0.8, min(radius_km, 12.0)), 2)


def _normalize_road_engine_disaster(raw: dict[str, Any]) -> dict[str, Any] | None:
    center = raw.get("center")
    if isinstance(center, (list, tuple)) and len(center) >= 2:
        latitude = float(center[0])
        longitude = float(center[1])
    else:
        latitude = raw.get("latitude")
        longitude = raw.get("longitude")
        if latitude is None or longitude is None:
            return None
        latitude = float(latitude)
        longitude = float(longitude)

    severity = raw.get("severity")
    confidence = raw.get("confidence")
    normalized_type = str(raw.get("type") or "other").strip().lower() or "other"

    return {
        "type": normalized_type,
        "center": (latitude, longitude),
        "radius_km": _impact_radius_for_disaster(normalized_type, severity, confidence),
    }


def _road_engine_inputs_from_live_disasters(disasters: list[Disaster]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for disaster in disasters:
        item = _normalize_road_engine_disaster(
            {
                "type": disaster.type,
                "latitude": disaster.latitude,
                "longitude": disaster.longitude,
                "severity": disaster.severity,
                "confidence": disaster.confidence,
            }
        )
        if item:
            normalized.append(item)
    return normalized


def _deduplicate_osrm_routes(routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique_routes: list[dict[str, Any]] = []
    seen_signatures: set[tuple[tuple[float, float], ...]] = set()

    for route in routes:
        geometry = route.get("geometry") if isinstance(route, dict) else None
        signature = _sample_route_signature(geometry)
        if signature and signature in seen_signatures:
            continue

        if signature:
            seen_signatures.add(signature)
        unique_routes.append(route)

    return unique_routes


def _build_route_bounds(
    source: Point,
    destination: Point,
    routes: list[dict[str, Any]],
) -> BoundingBox:
    longitudes = [source.lng, destination.lng]
    latitudes = [source.lat, destination.lat]

    for route in routes:
        for lon, lat in _route_coordinates(route.get("geometry")):
            longitudes.append(lon)
            latitudes.append(lat)

    west = min(longitudes)
    east = max(longitudes)
    south = min(latitudes)
    north = max(latitudes)

    lon_padding = max(0.05, (east - west) * 0.2)
    lat_padding = max(0.05, (north - south) * 0.2)

    return BoundingBox(
        west=max(-180.0, west - lon_padding),
        south=max(-90.0, south - lat_padding),
        east=min(180.0, east + lon_padding),
        north=min(90.0, north + lat_padding),
    )


def _roads_geojson_from_overpass(osm_data: dict[str, Any]) -> dict[str, Any]:
    features = []
    for element in osm_data.get("elements", []):
        if element.get("type") != "way" or "geometry" not in element:
            continue

        coordinates = [
            [node["lon"], node["lat"]]
            for node in element.get("geometry", [])
            if "lon" in node and "lat" in node
        ]
        if len(coordinates) < 2:
            continue

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": element.get("id"),
                    "road_id": str(element.get("id")),
                    "name": element.get("tags", {}).get("name", "Unknown Road"),
                    "highway": element.get("tags", {}).get("highway", "unknown"),
                    "status": "unknown",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }


def _geojson_bounds(geojson: dict[str, Any]) -> BoundingBox | None:
    longitudes: list[float] = []
    latitudes: list[float] = []

    for feature in geojson.get("features", []):
        geometry = feature.get("geometry", {})
        if geometry.get("type") != "LineString":
            continue
        for coordinate in geometry.get("coordinates", []):
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
                continue
            try:
                longitudes.append(float(coordinate[0]))
                latitudes.append(float(coordinate[1]))
            except (TypeError, ValueError):
                continue

    if not longitudes or not latitudes:
        return None

    return BoundingBox(
        west=min(longitudes),
        south=min(latitudes),
        east=max(longitudes),
        north=max(latitudes),
    )


async def _resolve_road_status_disasters(
    roads: dict[str, Any],
    explicit_disasters: list[DisasterImpactInput] | None = None,
) -> list[dict[str, Any]]:
    if explicit_disasters:
        normalized = [
            _normalize_road_engine_disaster(disaster.model_dump())
            for disaster in explicit_disasters
        ]
        return [item for item in normalized if item]

    bounds = _geojson_bounds(roads)
    live_disasters = await get_all_disasters(bounds=bounds)
    return _road_engine_inputs_from_live_disasters(live_disasters)


def _serialize_route(
    route_id: str,
    route: dict[str, Any],
    disasters: list[Disaster],
) -> RouteRecommendation:
    assessment = assess_route_risk(route.get("geometry"), disasters)
    properties = route.get("properties") if isinstance(route.get("properties"), dict) else {}
    duration = route.get("duration", properties.get("duration"))
    distance = route.get("distance", properties.get("distance"))

    return RouteRecommendation(
        route_id=route_id,
        geometry=route.get("geometry") or {"type": "LineString", "coordinates": []},
        duration=round(float(duration or 0.0), 2),
        distance=round(float(distance or 0.0), 2),
        risk_score=assessment.risk_score,
        safety_level=assessment.safety_level,
        hazard_hits=assessment.hazard_hits,
        exposure_summary=RouteExposureSummary(**assessment.exposure_summary),
    )


def _fetch_overpass_data(overpass_query: str) -> dict:
    """
    Try multiple Overpass instances because public endpoints can be rate-limited
    or intermittently unavailable.
    """
    errors = []
    headers = {"User-Agent": "vnr-disaster-response/1.0"}

    for url in OVERPASS_URLS:
        try:
            response = requests.post(
                url,
                data={"data": overpass_query},
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            errors.append(f"{url}: {exc}")
        except ValueError as exc:
            errors.append(f"{url}: invalid JSON response ({exc})")

    raise HTTPException(
        status_code=502,
        detail={
            "message": "Failed to fetch roads from Overpass API",
            "attempts": errors,
        },
    )


def _fetch_roads_for_bounds(bounds: BoundingBox) -> dict[str, Any]:
    overpass_query = f"""
    [out:json][timeout:25];
    way["highway"]({bounds.south},{bounds.west},{bounds.north},{bounds.east});
    out geom;
    """
    return _roads_geojson_from_overpass(_fetch_overpass_data(overpass_query))


@app.get("/api/roads")
def get_roads(lat: float, lon: float, radius: int = 500):
    """
    Fetch road data from Overpass API within a radius of lat, lon.
    """
    overpass_query = f"""
    [out:json][timeout:25];
    way["highway"](around:{radius},{lat},{lon});
    out geom;
    """

    try:
        osm_data = _fetch_overpass_data(overpass_query)
        return _roads_geojson_from_overpass(osm_data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _build_bounds(
    west: float | None,
    south: float | None,
    east: float | None,
    north: float | None,
) -> BoundingBox | None:
    if west is None or south is None or east is None or north is None:
        return None

    if west >= east or south >= north:
        raise HTTPException(
            status_code=400,
            detail="Invalid map bounds. Expected west < east and south < north.",
        )

    return BoundingBox(west=west, south=south, east=east, north=north)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "Disaster Response AI Backend"}


@app.get("/disasters", response_model=list[Disaster])
@app.get("/api/disasters", response_model=list[Disaster])
async def get_disasters(
    west: float | None = Query(default=None),
    south: float | None = Query(default=None),
    east: float | None = Query(default=None),
    north: float | None = Query(default=None),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
):
    bounds = _build_bounds(west, south, east, north)
    disasters = await get_all_disasters(bounds=bounds)

    start = _parse_query_datetime(from_ts)
    end = _parse_query_datetime(to_ts)
    if start is None or end is None:
        return disasters

    now = datetime.now(tz=UTC)
    start = min(start, now)
    end = min(end, now)
    if start > end:
        return disasters

    return _filter_by_time(disasters, start, end)


@app.post("/roads/status")
@app.post("/api/roads/status")
async def compute_road_status(payload: RoadStatusRequest):
    """
    Compute deterministic road status from nearby disaster impact radii.
    """
    _validate_geojson_roads(payload.roads)
    normalized_disasters = await _resolve_road_status_disasters(payload.roads, payload.disasters)
    return compute_geojson_road_status(payload.roads, normalized_disasters)


@app.post("/api/analyze")
async def analyze_roads(payload: AnalyzeRequest):
    """
    Backward-compatible alias for road status analysis using live disasters.
    """
    return await compute_road_status(RoadStatusRequest(roads=payload.roads))


@app.post("/api/disaster-summary", response_model=DisasterSummaryResponse)
async def summarize_disaster(payload: DisasterSummaryRequest):
    result = await generate_disaster_summary_result(payload.disaster)
    return DisasterSummaryResponse(
        summary=result.summary,
        used_fallback=result.used_fallback,
        provider=result.provider,
    )


@app.post("/api/route/compare", response_model=RouteComparisonResponse)
async def compare_routes(payload: CompareRequest):
    """
    Compare the fastest OSRM route against a blocked-road-aware safest route.
    """
    url = (
        "http://router.project-osrm.org/route/v1/driving/"
        f"{payload.source.lng},{payload.source.lat};{payload.destination.lng},{payload.destination.lat}"
    )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS)) as client:
            response = await client.get(
                url,
                params={
                    "overview": "full",
                    "geometries": "geojson",
                    "alternatives": "true",
                    "steps": "false",
                },
            )
            response.raise_for_status()
            data = response.json()

        if data.get("code") != "Ok":
            raise HTTPException(status_code=400, detail="No route found by OSRM")

        raw_routes = data.get("routes", [])
        if not raw_routes:
            raise HTTPException(status_code=404, detail="No route found")

        meaningful_routes = _deduplicate_osrm_routes(raw_routes)
        if not meaningful_routes:
            raise HTTPException(status_code=404, detail="No meaningful routes found")

        route_bounds = _build_route_bounds(payload.source, payload.destination, meaningful_routes)
        disasters = await get_all_disasters(bounds=route_bounds)

        start_ts = _parse_query_datetime(payload.from_ts)
        end_ts = _parse_query_datetime(payload.to_ts)
        if start_ts and end_ts:
            now = datetime.now(tz=UTC)
            start_ts = min(start_ts, now)
            end_ts = min(end_ts, now)
            if start_ts <= end_ts:
                disasters = _filter_by_time(disasters, start_ts, end_ts)

        scored_routes = [
            _serialize_route(f"route-{index}", route, disasters)
            for index, route in enumerate(meaningful_routes)
        ]

        fastest = min(
            scored_routes,
            key=lambda route: (route.duration, route.risk_score, route.distance, route.route_id),
        )
        fallback_safest = min(
            scored_routes,
            key=lambda route: (route.risk_score, route.duration, route.distance, route.route_id),
        )

        safest = fallback_safest
        smart_route_used = False
        smart_route_warning: str | None = None

        try:
            route_roads = _fetch_roads_for_bounds(route_bounds)
            if route_roads.get("features") and disasters:
                impacted_roads = compute_geojson_road_status(
                    route_roads,
                    _road_engine_inputs_from_live_disasters(disasters),
                )
                smart_route_result = get_smart_route(
                    roads_geojson=impacted_roads,
                    start=(payload.source.lng, payload.source.lat),
                    end=(payload.destination.lng, payload.destination.lat),
                )
                safest = _serialize_route("smart-route", smart_route_result["route"], disasters)
                smart_route_warning = smart_route_result.get("metadata", {}).get("warning")
                smart_route_used = True
        except Exception as exc:
            logger.warning("Smart-routing fallback during route comparison: %s", exc)

        identical = _sample_route_signature(fastest.geometry) == _sample_route_signature(
            safest.geometry
        )
        fallback_reason = None
        status: Literal["ok", "fallback"] = "ok"

        route_signatures = {
            signature
            for signature in (
                _sample_route_signature(route.geometry) for route in scored_routes
            )
            if signature
        }
        safest_signature = _sample_route_signature(safest.geometry)
        meaningful_route_count = len(route_signatures)
        if safest_signature and safest_signature not in route_signatures:
            meaningful_route_count += 1

        if smart_route_used and identical:
            message = (
                "The fastest route also satisfies blocked-road-aware routing for the selected "
                "timeline."
            )
            if smart_route_warning:
                message = f"{message} {smart_route_warning}"
        elif smart_route_used:
            message = (
                "Showing the quickest OSRM route alongside a blocked-road-aware safest route."
            )
            if smart_route_warning:
                message = f"{message} {smart_route_warning}"
        elif len(scored_routes) < 2:
            status = "fallback"
            fallback_reason = "insufficient_meaningful_alternatives"
            message = (
                "OSRM returned only one meaningful route for this trip, so the fastest and "
                "safest recommendations are currently the same."
            )
        elif identical:
            message = (
                "The fastest route also has the lowest disaster exposure for the selected "
                "timeline."
            )
        else:
            message = "Showing the quickest route alongside the lowest-exposure alternative."

        return RouteComparisonResponse(
            status=status,
            fastest=fastest,
            safest=safest,
            identical=identical,
            message=message,
            alternatives_returned=len(raw_routes) + (1 if smart_route_used else 0),
            meaningful_route_count=meaningful_route_count,
            fallback_reason=fallback_reason,
        )
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OSRM request failed: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid OSRM JSON response: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/route")
def get_route(start_lat: float, start_lon: float, end_lat: float, end_lon: float):
    """
    Fetch a standard OSRM route as a single fallback route feature.
    """
    url = (
        "http://router.project-osrm.org/route/v1/driving/"
        f"{start_lon},{start_lat};{end_lon},{end_lat}"
        "?overview=full&geometries=geojson&alternatives=true"
    )

    try:
        response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        data = response.json()

        if data.get("code") != "Ok":
            raise HTTPException(status_code=400, detail="No route found by OSRM")

        routes = data.get("routes", [])
        if not routes:
            raise HTTPException(status_code=404, detail="No route found")

        best_route = routes[0]
        return {
            "type": "Feature",
            "properties": {
                "distance": best_route.get("distance"),
                "duration": best_route.get("duration"),
                "type": "optimal_route",
            },
            "geometry": best_route.get("geometry"),
        }
    except HTTPException:
        raise
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"OSRM request failed: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid OSRM JSON response: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
