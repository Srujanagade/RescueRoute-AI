from fastapi import APIRouter, HTTPException
from services.osm_service import get_roads

router = APIRouter()

@router.get("/roads")
def fetch_roads(lat: float, lon: float):
    """
    Fetch nearby drivable roads as a GeoJSON.
    """
    try:
        geojson = get_roads(lat, lon)
        return geojson
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch roads: {str(e)}")
