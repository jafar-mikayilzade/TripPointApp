"""POST /api/plan-route — geo itinerary + optional Claude tips."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.services.live_route_candidates import load_live_route_candidates
from app.services.plan_itinerary import build_skeleton, enrich_with_claude

router = APIRouter(tags=["route"])

REGION_LABELS: dict[str, str] = {
    "quba": "Quba",
    "qusar": "Qusar",
    "seki": "Şəki",
    "sheki": "Şəki",
    "qabala": "Qəbələ",
    "gabala": "Qəbələ",
    "lerik": "Lerik",
    "baku": "Bakı",
}


class WeatherIn(BaseModel):
    prefer_indoor: bool = False
    summary_az: str | None = None
    exclude_categories: list[str] = Field(default_factory=list)
    prefer_categories: list[str] = Field(default_factory=list)


class PoisIn(BaseModel):
    restaurants: list[dict[str, Any]] = Field(default_factory=list)
    accommodations: list[dict[str, Any]] = Field(default_factory=list)
    attractions: list[dict[str, Any]] = Field(default_factory=list)


class PlanRouteIn(BaseModel):
    region: str
    days: int = Field(ge=1, le=7)
    budget: str = "mid"
    interests: list[str] = Field(default_factory=list)
    groupType: str | None = "solo"
    weather: WeatherIn | None = None
    pois: PoisIn | None = None
    # Travel-from-home (e.g. Baku → Quba day trip)
    fromOrigin: bool = False
    originLat: float | None = None
    originLng: float | None = None
    departTime: str | None = "08:00"
    returnByTime: str | None = "21:00"


@router.post("/api/plan-route")
def plan_route_endpoint(body: PlanRouteIn) -> JSONResponse:
    region_key = body.region.strip().lower()
    if region_key not in REGION_COORDINATES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid region",
                "allowed_regions": list(REGION_COORDINATES.keys()),
            },
        )

    db_region = REGION_DB_ID.get(region_key, region_key)
    region_label = REGION_LABELS.get(region_key) or REGION_LABELS.get(db_region) or db_region
    interests = [str(i) for i in (body.interests or [])]
    candidate_source = "client"

    if body.pois and (
        body.pois.restaurants or body.pois.accommodations or body.pois.attractions
    ):
        restaurants = list(body.pois.restaurants)
        accommodations = list(body.pois.accommodations)
        attractions = list(body.pois.attractions)
    else:
        loaded = load_live_route_candidates(
            region_key,
            per_bucket=12,
            interests=interests or None,
            source="google",
        )
        buckets = loaded["buckets"]
        restaurants = buckets["restaurants"]
        accommodations = buckets["accommodations"]
        attractions = buckets["attractions"]
        candidate_source = str(loaded.get("source") or "google")

    if not (restaurants or accommodations or attractions):
        raise HTTPException(
            status_code=400,
            detail={"error": "Bu bölgədə yer tapılmadı"},
        )

    weather = body.weather.model_dump() if body.weather else None
    group_type = (body.groupType or "solo").strip() or "solo"

    try:
        skeleton = build_skeleton(
            region=region_key,
            days=int(body.days),
            budget=body.budget,
            interests=interests,
            group_type=group_type,
            restaurants=restaurants,
            accommodations=accommodations,
            attractions=attractions,
            weather=weather,
            origin_lat=body.originLat,
            origin_lng=body.originLng,
            from_origin=bool(body.fromOrigin),
            depart_time=body.departTime or "08:00",
            return_by_time=body.returnByTime or "21:00",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    plan = enrich_with_claude(
        skeleton,
        region_label=region_label,
        days=int(body.days),
        budget=body.budget,
        interests=interests,
        group_type=group_type,
        weather=weather,
    )

    travel = plan.pop("travel", None) or skeleton.get("travel")
    lodging = plan.pop("lodging", None) or skeleton.get("lodging")
    plan.pop("meta", None)

    return JSONResponse(
        content={
            "success": True,
            "summary": plan.get("summary"),
            "days": plan.get("days"),
            "total_cost": plan.get("total_cost"),
            "best_time": plan.get("best_time") or skeleton.get("best_time"),
            "region": db_region,
            "regionLabel": region_label,
            "travel": travel,
            "lodging": lodging,
            "source": "fastapi_geo",
            "candidatesSource": candidate_source,
        }
    )
