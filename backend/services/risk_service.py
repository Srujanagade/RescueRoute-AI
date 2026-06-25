import math
from collections import Counter
from dataclasses import dataclass
from typing import Sequence

from models.disaster import Disaster

DEFAULT_SEVERITY = 50.0
MAX_HAZARD_DISTANCE_KM = 5.0
HIGH_EXPOSURE_DISTANCE_KM = 2.0
MAX_SAMPLED_ROUTE_POINTS = 40
DISASTER_TYPE_WEIGHTS = {
    "fire": 1.25,
    "flood": 1.15,
    "earthquake": 1.35,
    "weather": 1.0,
    "other": 0.9,
}


def adjust_risk_by_confidence(risk_score: float, confidence: str | None) -> float:
    normalized_confidence = str(confidence or "").strip().lower()

    if normalized_confidence == "high":
        return risk_score * 1.0
    if normalized_confidence == "medium":
        return risk_score * 0.75
    return risk_score * 0.5


@dataclass(frozen=True)
class RouteRiskAssessment:
    risk_score: float
    hazard_hits: int
    safety_level: str
    exposure_summary: dict[str, object]


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth in kilometers.
    """
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])

    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return 6371 * c


def _sample_route_coordinates(
    coordinates: Sequence[Sequence[float]],
    max_points: int = MAX_SAMPLED_ROUTE_POINTS,
) -> list[tuple[float, float]]:
    if not coordinates:
        return []

    if len(coordinates) <= max_points:
        return [(float(lon), float(lat)) for lon, lat in coordinates]

    last_index = len(coordinates) - 1
    sampled: list[tuple[float, float]] = []

    for step_index in range(max_points):
        coordinate_index = round(step_index * last_index / (max_points - 1))
        lon, lat = coordinates[coordinate_index]
        point = (float(lon), float(lat))
        if not sampled or sampled[-1] != point:
            sampled.append(point)

    return sampled


def _severity_factor(severity: float | None) -> float:
    normalized = severity if isinstance(severity, (int, float)) else DEFAULT_SEVERITY
    return max(0.4, min(float(normalized), 100.0) / 100.0)


def _proximity_factor(distance_km: float) -> float:
    if distance_km <= 0.5:
        return 2.7
    if distance_km <= 1.0:
        return 2.0
    if distance_km <= 2.0:
        return 1.4
    return 0.75


def _to_safety_level(risk_score: float, hazard_hits: int) -> str:
    if hazard_hits == 0 and risk_score <= 0.5:
        return "High"
    if risk_score < 15:
        return "Moderate"
    if risk_score < 35:
        return "Guarded"
    return "Low"


def assess_route_risk(geometry: dict | None, disasters: list[Disaster]) -> RouteRiskAssessment:
    if not geometry or geometry.get("type") != "LineString":
        return RouteRiskAssessment(
            risk_score=0.0,
            hazard_hits=0,
            safety_level="High",
            exposure_summary={
                "total_hazards": 0,
                "high_exposure_hazards": 0,
                "by_type": {},
                "closest_hazard_km": None,
                "highest_severity": None,
            },
        )

    coordinates = geometry.get("coordinates", [])
    sampled_coordinates = _sample_route_coordinates(coordinates)
    if not sampled_coordinates:
        return RouteRiskAssessment(
            risk_score=0.0,
            hazard_hits=0,
            safety_level="High",
            exposure_summary={
                "total_hazards": 0,
                "high_exposure_hazards": 0,
                "by_type": {},
                "closest_hazard_km": None,
                "highest_severity": None,
            },
        )

    risk_score = 0.0
    hazard_types = Counter()
    high_exposure_hazards = 0
    closest_hazard_km = math.inf
    highest_severity: float | None = None

    for disaster in disasters:
        min_distance_km = min(
            haversine(lat, lon, disaster.latitude, disaster.longitude)
            for lon, lat in sampled_coordinates
        )

        if min_distance_km > MAX_HAZARD_DISTANCE_KM:
            continue

        severity = float(disaster.severity) if disaster.severity is not None else None
        type_weight = DISASTER_TYPE_WEIGHTS.get(disaster.type, DISASTER_TYPE_WEIGHTS["other"])
        hazard_types[disaster.type] += 1
        closest_hazard_km = min(closest_hazard_km, min_distance_km)
        highest_severity = max(highest_severity or 0.0, severity or DEFAULT_SEVERITY)

        if min_distance_km <= HIGH_EXPOSURE_DISTANCE_KM:
            high_exposure_hazards += 1

        base_risk = _proximity_factor(min_distance_km) * _severity_factor(severity) * type_weight * 10
        risk_score += adjust_risk_by_confidence(base_risk, disaster.confidence)

    if high_exposure_hazards > 1:
        risk_score += (high_exposure_hazards - 1) * 2.5

    total_hazards = sum(hazard_types.values())
    rounded_score = round(risk_score, 2)

    return RouteRiskAssessment(
        risk_score=rounded_score,
        hazard_hits=total_hazards,
        safety_level=_to_safety_level(rounded_score, total_hazards),
        exposure_summary={
            "total_hazards": total_hazards,
            "high_exposure_hazards": high_exposure_hazards,
            "by_type": dict(sorted(hazard_types.items())),
            "closest_hazard_km": None
            if math.isinf(closest_hazard_km)
            else round(closest_hazard_km, 2),
            "highest_severity": None if highest_severity is None else round(highest_severity, 2),
        },
    )


def compute_point_risk_score(lat: float, lon: float, disasters: list[Disaster]) -> float:
    score = 0.0
    for disaster in disasters:
        distance = haversine(lat, lon, disaster.latitude, disaster.longitude)
        if distance > MAX_HAZARD_DISTANCE_KM:
            continue

        severity = float(disaster.severity) if disaster.severity is not None else None
        base_risk = _proximity_factor(distance) * _severity_factor(severity)
        score += adjust_risk_by_confidence(base_risk, disaster.confidence)

    return round(score, 2)


def score_route(geometry: dict, disasters: list[Disaster]) -> float:
    return assess_route_risk(geometry, disasters).risk_score
