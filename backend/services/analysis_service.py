from __future__ import annotations

import logging
import math
from typing import Any, Literal

logger = logging.getLogger(__name__)

RoadSeverity = Literal["safe", "risky", "blocked"]
RoadStatus = dict[str, str]
RoadFeature = dict[str, Any]
Disaster = dict[str, Any]

_STATUS_PRIORITY: dict[RoadSeverity, int] = {
    "safe": 0,
    "risky": 1,
    "blocked": 2,
}


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Return the great-circle distance between two points in kilometers.
    """
    earth_radius_km = 6371.0
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    delta_lat = lat2_rad - lat1_rad
    delta_lon = lon2_rad - lon1_rad

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


def _build_disaster_bounds(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    """
    Create a coarse bounding box in lat/lon degrees for fast pre-filtering.
    """
    lat_delta = radius_km / 111.0
    cos_lat = max(math.cos(math.radians(lat)), 0.01)
    lon_delta = radius_km / (111.0 * cos_lat)
    return (
        lat - lat_delta,
        lon - lon_delta,
        lat + lat_delta,
        lon + lon_delta,
    )


def _extract_road_points(road: RoadFeature) -> list[tuple[float, float]]:
    """
    Convert GeoJSON coordinates into a list of (lat, lon) pairs.
    Current OSM service stores coordinates as [lon, lat].
    """
    geometry = road.get("geometry", {})
    coordinates = geometry.get("coordinates", [])
    points: list[tuple[float, float]] = []

    for coordinate in coordinates:
        if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
            continue
        lon, lat = coordinate[0], coordinate[1]
        points.append((float(lat), float(lon)))

    return points


def _compute_road_bbox(points: list[tuple[float, float]]) -> tuple[float, float, float, float] | None:
    if not points:
        return None

    latitudes = [point[0] for point in points]
    longitudes = [point[1] for point in points]
    return (
        min(latitudes),
        min(longitudes),
        max(latitudes),
        max(longitudes),
    )


def _bbox_intersects(
    road_bbox: tuple[float, float, float, float] | None,
    disaster_bbox: tuple[float, float, float, float],
) -> bool:
    if road_bbox is None:
        return False

    road_min_lat, road_min_lon, road_max_lat, road_max_lon = road_bbox
    dis_min_lat, dis_min_lon, dis_max_lat, dis_max_lon = disaster_bbox

    return not (
        road_max_lat < dis_min_lat
        or road_min_lat > dis_max_lat
        or road_max_lon < dis_min_lon
        or road_min_lon > dis_max_lon
    )


def _get_road_id(road: RoadFeature, fallback_index: int) -> str:
    properties = road.get("properties", {})
    for key in ("road_id", "id", "osmid", "@id"):
        value = properties.get(key, road.get(key))
        if value is not None:
            return str(value)
    return f"road-{fallback_index}"


def _determine_status_for_disaster(
    points: list[tuple[float, float]],
    disaster_center: tuple[float, float],
    radius_km: float,
) -> RoadSeverity:
    near_radius_km = radius_km + 1.0
    center_lat, center_lon = disaster_center
    current_status: RoadSeverity = "safe"

    for point_lat, point_lon in points:
        distance_km = _haversine_distance(point_lat, point_lon, center_lat, center_lon)
        if distance_km <= radius_km:
            return "blocked"
        if distance_km <= near_radius_km:
            current_status = "risky"

    return current_status


def _compute_road_status(roads: list[RoadFeature], disasters: list[Disaster]) -> list[RoadStatus]:
    """
    Compute deterministic road status from road geometry and disaster radii.
    A road is affected if any point in its LineString enters the disaster radius.
    """
    normalized_disasters: list[dict[str, Any]] = []
    for disaster in disasters:
        center = disaster.get("center", [])
        if len(center) < 2:
            logger.warning("Skipping disaster with invalid center: %s", disaster)
            continue

        center_lat = float(center[0])
        center_lon = float(center[1])
        radius_km = max(float(disaster.get("radius_km", 0.0)), 0.0)
        near_radius_km = radius_km + 1.0

        normalized_disasters.append(
            {
                "type": disaster.get("type", "unknown"),
                "center": (center_lat, center_lon),
                "radius_km": radius_km,
                "near_radius_km": near_radius_km,
                "bbox": _build_disaster_bounds(center_lat, center_lon, near_radius_km),
            }
        )

    results: list[RoadStatus] = []
    for index, road in enumerate(roads):
        road_id = _get_road_id(road, index)
        points = _extract_road_points(road)
        road_bbox = _compute_road_bbox(points)
        status: RoadSeverity = "safe"

        if points and normalized_disasters:
            for disaster in normalized_disasters:
                if not _bbox_intersects(road_bbox, disaster["bbox"]):
                    continue

                disaster_status = _determine_status_for_disaster(
                    points=points,
                    disaster_center=disaster["center"],
                    radius_km=disaster["radius_km"],
                )
                if _STATUS_PRIORITY[disaster_status] > _STATUS_PRIORITY[status]:
                    status = disaster_status
                if status == "blocked":
                    break

        results.append({"road_id": road_id, "status": status})

    return results


def compute_geojson_road_status(geojson: dict[str, Any], disasters: list[Disaster]) -> dict[str, Any]:
    """
    Apply computed road status back onto the incoming GeoJSON features.
    """
    features = geojson.get("features", [])
    statuses = _compute_road_status(features, disasters)
    status_by_road_id = {item["road_id"]: item["status"] for item in statuses}

    for index, feature in enumerate(features):
        if "properties" not in feature:
            feature["properties"] = {}

        road_id = _get_road_id(feature, index)
        feature["properties"]["road_id"] = road_id
        feature["properties"]["status"] = status_by_road_id.get(road_id, "safe")

    return {
        "type": geojson.get("type", "FeatureCollection"),
        "features": features,
    }
