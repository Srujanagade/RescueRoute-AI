"""
Satellite Imagery Service

Fetches satellite imagery from Mapbox Static Images API for road analysis.
Groups road features geographically into tiles to minimize API calls.
"""

import os
import math
import requests
import logging
from io import BytesIO

logger = logging.getLogger(__name__)

MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "")


def get_bounding_box(geojson: dict) -> tuple:
    """
    Calculate the bounding box (min_lon, min_lat, max_lon, max_lat)
    from all road features in the GeoJSON.
    """
    min_lon = float('inf')
    min_lat = float('inf')
    max_lon = float('-inf')
    max_lat = float('-inf')

    for feature in geojson.get("features", []):
        coords = feature.get("geometry", {}).get("coordinates", [])
        for lon, lat in coords:
            min_lon = min(min_lon, lon)
            min_lat = min(min_lat, lat)
            max_lon = max(max_lon, lon)
            max_lat = max(max_lat, lat)

    return (min_lon, min_lat, max_lon, max_lat)


def get_tile_configs(geojson: dict, max_tiles: int = 4) -> list:
    """
    Divide the road network area into spatial tiles for batched satellite analysis.
    Returns a list of tile configs with center coordinates and which road indices belong to each tile.
    """
    bbox = get_bounding_box(geojson)
    min_lon, min_lat, max_lon, max_lat = bbox

    # Calculate center of the entire area
    center_lon = (min_lon + max_lon) / 2
    center_lat = (min_lat + max_lat) / 2

    # Calculate the span
    lon_span = max_lon - min_lon
    lat_span = max_lat - min_lat

    # Determine grid size (2x2 for most cases, 1x1 for small areas)
    if lon_span < 0.005 and lat_span < 0.005:
        # Small area — single tile
        grid_cols, grid_rows = 1, 1
    else:
        grid_cols = min(2, max_tiles)
        grid_rows = min(2, max_tiles // grid_cols)

    tiles = []
    cell_lon = lon_span / grid_cols if grid_cols > 0 else lon_span
    cell_lat = lat_span / grid_rows if grid_rows > 0 else lat_span

    features = geojson.get("features", [])

    for row in range(grid_rows):
        for col in range(grid_cols):
            tile_min_lon = min_lon + col * cell_lon
            tile_max_lon = min_lon + (col + 1) * cell_lon
            tile_min_lat = min_lat + row * cell_lat
            tile_max_lat = min_lat + (row + 1) * cell_lat
            tile_center_lon = (tile_min_lon + tile_max_lon) / 2
            tile_center_lat = (tile_min_lat + tile_max_lat) / 2

            # Find which road features fall into this tile
            road_indices = []
            for i, feature in enumerate(features):
                coords = feature.get("geometry", {}).get("coordinates", [])
                if coords:
                    # Use the midpoint of the road to assign to a tile
                    mid_idx = len(coords) // 2
                    mid_lon, mid_lat = coords[mid_idx]
                    if (tile_min_lon <= mid_lon <= tile_max_lon and
                            tile_min_lat <= mid_lat <= tile_max_lat):
                        road_indices.append(i)

            if road_indices:  # Only create tile if it has roads
                tiles.append({
                    "center_lat": tile_center_lat,
                    "center_lon": tile_center_lon,
                    "bbox": (tile_min_lon, tile_min_lat, tile_max_lon, tile_max_lat),
                    "road_indices": road_indices,
                    "zoom": _calculate_zoom(cell_lon, cell_lat)
                })

    # If some roads weren't assigned (edge cases), assign them to nearest tile
    assigned = set()
    for tile in tiles:
        assigned.update(tile["road_indices"])

    unassigned = [i for i in range(len(features)) if i not in assigned]
    if unassigned and tiles:
        tiles[0]["road_indices"].extend(unassigned)

    return tiles


def _calculate_zoom(lon_span: float, lat_span: float) -> int:
    """
    Estimate an appropriate zoom level for the given geographic span.
    """
    max_span = max(lon_span, lat_span)
    if max_span <= 0:
        return 16
    # Approximate: at zoom 0, the world is ~360 degrees wide.
    # Each zoom level halves the span.
    zoom = int(math.log2(360 / max_span)) if max_span > 0 else 16
    return max(14, min(zoom, 18))  # Clamp between 14 and 18


def fetch_satellite_image(center_lat: float, center_lon: float,
                          zoom: int = 16, width: int = 600, height: int = 600) -> bytes:
    """
    Fetch a satellite image tile from Mapbox Static Images API.
    Returns raw image bytes.
    """
    token = MAPBOX_TOKEN
    if not token:
        raise ValueError("MAPBOX_TOKEN not configured")

    url = (
        f"https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/"
        f"{center_lon},{center_lat},{zoom},0/{width}x{height}@2x"
        f"?access_token={token}"
    )

    logger.info(f"Fetching satellite tile at ({center_lat}, {center_lon}), zoom={zoom}")
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    return response.content
