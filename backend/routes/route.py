from fastapi import APIRouter, HTTPException
from services.routing_service import get_route

router = APIRouter()

@router.get("/route")
def calculate_route(start_lat: float, start_lon: float, end_lat: float, end_lon: float):
    """
    Calculate route between start and end coordinates using OSRM.
    """
    try:
        route_geojson = get_route(start_lat, start_lon, end_lat, end_lon)
        return route_geojson
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get route: {str(e)}")
