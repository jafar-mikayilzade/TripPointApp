"""POST /api/plan-route — geo itinerary + optional Claude tips."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.db import supabase
from app.services.plan_itinerary import build_skeleton, enrich_with_claude
from app.services.rank_pois import bucket_route_candidates

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


def _load_buckets_from_db(region_key: str, per_bucket: int = 12) -> dict[str, list[dict[str, Any]]]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    result = (
        supabase.table("pois")
        .select(
            "id, name, category, description, lat, lng, region, rating, rating_count"
        )
        .eq("status", "approved")
        .ilike("region", db_region)
        .neq("category", "cafe")
        .limit(200)
        .execute()
    )
    rows = list(result.data or [])
    return bucket_route_candidates(rows, per_bucket=per_bucket)


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

    if body.pois and (
        body.pois.restaurants or body.pois.accommodations or body.pois.attractions
    ):
        restaurants = list(body.pois.restaurants)
        accommodations = list(body.pois.accommodations)
        attractions = list(body.pois.attractions)
    else:
        buckets = _load_buckets_from_db(region_key)
        restaurants = buckets["restaurants"]
        accommodations = buckets["accommodations"]
        attractions = buckets["attractions"]

    if not (restaurants or accommodations or attractions):
        raise HTTPException(
            status_code=400,
            detail={"error": "Bu bölgədə yer tapılmadı"},
        )

    weather = body.weather.model_dump() if body.weather else None
    interests = [str(i) for i in (body.interests or [])]
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

    # Strip internal meta noise for mobile (keep compatible fields)
    plan.pop("meta", None)

    return JSONResponse(
        content={
            "success": True,
            "summary": plan.get("summary"),
            "days": plan.get("days"),
            "total_cost": plan.get("total_cost"),
            "best_time": plan.get("best_time"),
            "region": db_region,
            "regionLabel": region_label,
            "source": "fastapi_geo",
        }
    )
