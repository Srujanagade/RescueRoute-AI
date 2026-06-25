from __future__ import annotations

import logging
import math
from typing import Any

import networkx as nx
import requests

logger = logging.getLogger(__name__)

_OSRM_BASE_URL = "http://router.project-osrm.org"
_RISKY_ROAD_PENALTY = 4.0
_AVERAGE_SPEED_KPH = {
    "safe": 35.0,
    "risky": 18.0,
}


def _haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
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
    return earth_radius_km * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def _segment_distance_meters(start: tuple[float, float], end: tuple[float, float]) -> float:
    start_lon, start_lat = start
    end_lon, end_lat = end
    return _haversine_distance_km(start_lat, start_lon, end_lat, end_lon) * 1000.0


def _iter_feature_segments(feature: dict[str, Any]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    coordinates = feature.get("geometry", {}).get("coordinates", [])
    if len(coordinates) < 2:
        return []

    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for index in range(len(coordinates) - 1):
        start = coordinates[index]
        end = coordinates[index + 1]
        if len(start) < 2 or len(end) < 2:
            continue
        segments.append(((float(start[0]), float(start[1])), (float(end[0]), float(end[1]))))
    return segments


def _add_weighted_edge(
    graph: nx.Graph,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    status: str,
    road_id: str,
) -> None:
    distance_m = _segment_distance_meters(start, end)
    if distance_m <= 0:
        return

    weight = distance_m if status == "safe" else distance_m * _RISKY_ROAD_PENALTY
    edge_payload = {
        "distance_m": distance_m,
        "weight": weight,
        "status": status,
        "road_id": road_id,
    }

    if graph.has_edge(start, end):
        existing = graph[start][end]
        if edge_payload["weight"] >= existing["weight"]:
            return

    graph.add_edge(start, end, **edge_payload)


def _build_routing_graph(roads_geojson: dict[str, Any], *, allow_risky: bool) -> nx.Graph:
    graph = nx.Graph()

    for feature_index, feature in enumerate(roads_geojson.get("features", [])):
        properties = feature.get("properties", {})
        status = properties.get("status", "safe")
        if status == "blocked":
            continue
        if status == "risky" and not allow_risky:
            continue

        road_id = str(properties.get("road_id", f"road-{feature_index}"))
        for start, end in _iter_feature_segments(feature):
            _add_weighted_edge(graph, start, end, status=status, road_id=road_id)

    return graph


def _snap_point_to_graph(
    point: tuple[float, float],
    graph: nx.Graph,
) -> tuple[float, float]:
    if graph.number_of_nodes() == 0:
        raise ValueError("No traversable roads available for routing")

    point_lon, point_lat = point
    nearest_node = min(
        graph.nodes,
        key=lambda node: _haversine_distance_km(point_lat, point_lon, node[1], node[0]),
    )
    return nearest_node


def _build_route_feature(
    path: list[tuple[float, float]],
    graph: nx.Graph,
) -> tuple[dict[str, Any], dict[str, Any]]:
    coordinates = [[node[0], node[1]] for node in path]
    distance_m = 0.0
    duration_s = 0.0
    risky_road_ids: set[str] = set()
    risky_edge_count = 0

    for index in range(len(path) - 1):
        edge_data = graph[path[index]][path[index + 1]]
        distance_m += edge_data["distance_m"]

        status = edge_data["status"]
        speed_kph = _AVERAGE_SPEED_KPH["risky" if status == "risky" else "safe"]
        duration_s += edge_data["distance_m"] / (speed_kph * 1000 / 3600)

        if status == "risky":
            risky_edge_count += 1
            risky_road_ids.add(edge_data["road_id"])

    metadata = {
        "distance": round(distance_m, 2),
        "duration": round(duration_s, 2),
        "risky_roads_used": len(risky_road_ids),
        "risky_segments_used": risky_edge_count,
    }

    return (
        {
            "type": "Feature",
            "properties": {
                **metadata,
                "type": "smart_route",
            },
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates,
            },
        },
        metadata,
    )


def _fetch_osrm_nearest(lon: float, lat: float) -> dict[str, Any] | None:
    url = f"{_OSRM_BASE_URL}/nearest/v1/driving/{lon},{lat}"
    try:
        response = requests.get(url, params={"number": 1}, timeout=8)
        response.raise_for_status()
        data = response.json()
        if data.get("code") != "Ok":
            return None
        waypoints = data.get("waypoints", [])
        return waypoints[0] if waypoints else None
    except Exception as exc:
        logger.warning("OSRM nearest lookup failed for %s,%s: %s", lon, lat, exc)
        return None


def _normalize_input_point(point: tuple[float, float]) -> tuple[float, float]:
    waypoint = _fetch_osrm_nearest(point[0], point[1])
    if not waypoint:
        return point

    location = waypoint.get("location", [])
    if len(location) < 2:
        return point
    return (float(location[0]), float(location[1]))


def get_route(start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> dict:
    """
    Call OSRM API to get the optimal route.
    http://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}
    """
    url = f"{_OSRM_BASE_URL}/route/v1/driving/{start_lon},{start_lat};{end_lon},{end_lat}"
    params = {
        "overview": "full",
        "geometries": "geojson",
    }

    try:
        response = requests.get(url, params=params, timeout=12)
        response.raise_for_status()
        data = response.json()

        if data.get("code") != "Ok":
            raise ValueError(f"OSRM returned code: {data.get('code')}")

        routes = data.get("routes", [])
        if not routes:
            raise ValueError("No routes found")

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

    except Exception as exc:
        logger.error("Error fetching route: %s", exc)
        raise


def get_smart_route(
    roads_geojson: dict[str, Any],
    start: tuple[float, float],
    end: tuple[float, float],
) -> dict[str, Any]:
    """
    Build a safety-aware route from the local road network:
    1. Exclude blocked roads entirely.
    2. Prefer safe-only roads first.
    3. Fall back to risky roads when no safe-only route exists.
    4. Use OSRM nearest to normalize clicked map points onto the road network.
    """
    normalized_start = _normalize_input_point(start)
    normalized_end = _normalize_input_point(end)

    safe_graph = _build_routing_graph(roads_geojson, allow_risky=False)
    usable_graph = _build_routing_graph(roads_geojson, allow_risky=True)

    if usable_graph.number_of_edges() == 0:
        raise ValueError("No non-blocked roads available for smart routing")

    warning: str | None = None
    graph_for_route = safe_graph if safe_graph.number_of_edges() > 0 else usable_graph

    try:
        safe_start = _snap_point_to_graph(normalized_start, safe_graph)
        safe_end = _snap_point_to_graph(normalized_end, safe_graph)
        path = nx.shortest_path(safe_graph, safe_start, safe_end, weight="weight")
        snapped_start = safe_start
        snapped_end = safe_end
        graph_for_route = safe_graph
    except Exception:
        snapped_start = _snap_point_to_graph(normalized_start, usable_graph)
        snapped_end = _snap_point_to_graph(normalized_end, usable_graph)
        try:
            path = nx.shortest_path(usable_graph, snapped_start, snapped_end, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
            raise ValueError("No route exists without blocked roads") from exc
        warning = "Only risky routes available."
        graph_for_route = usable_graph

    route_feature, metadata = _build_route_feature(path, graph_for_route)
    metadata.update(
        {
            "snapped_start": [snapped_start[0], snapped_start[1]],
            "snapped_end": [snapped_end[0], snapped_end[1]],
            "warning": warning,
        }
    )
    route_feature["properties"].update(metadata)

    return {
        "route": route_feature,
        "metadata": metadata,
    }
