from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.analysis_service import compute_geojson_road_status

router = APIRouter()


class DisasterInput(BaseModel):
    type: Literal["flood", "earthquake"]
    center: tuple[float, float] = Field(..., min_length=2, max_length=2)
    radius_km: float = Field(..., ge=0)


class RoadStatusRequest(BaseModel):
    roads: dict[str, Any]
    disasters: list[DisasterInput]


def _validate_geojson_roads(roads: dict[str, Any]) -> None:
    if roads.get("type") != "FeatureCollection" or "features" not in roads:
        raise HTTPException(status_code=400, detail="Invalid GeoJSON FeatureCollection")


@router.post("/roads/status")
def compute_road_status(payload: RoadStatusRequest):
    """
    Compute deterministic road status using disaster radius intersections.
    """
    try:
        _validate_geojson_roads(payload.roads)
        return compute_geojson_road_status(
            geojson=payload.roads,
            disasters=[disaster.model_dump() for disaster in payload.disasters],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Road status computation failed: {str(e)}")


@router.post("/analyze")
def analyze_roads(payload: RoadStatusRequest):
    """
    Backward-compatible alias for the former AI analysis endpoint.
    """
    return compute_road_status(payload)
