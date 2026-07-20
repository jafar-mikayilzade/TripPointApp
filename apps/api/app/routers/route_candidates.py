"""Ranked POI candidates for AI route planning."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.db import supabase
from app.services.rank_pois import bucket_route_candidates, public_poi_fields

router = APIRouter(tags=["route"])


@router.get("/api/route-candidates")
def route_candidates_endpoint(
    region: str = Query(..., description="Tourism region key, e.g. quba"),
    per_bucket: int = Query(12, ge=4, le=30, description="Max POIs per category group"),
) -> JSONResponse:
    region_key = region.strip().lower()
    if region_key not in REGION_COORDINATES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid region",
                "allowed_regions": list(REGION_COORDINATES.keys()),
            },
        )

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
    buckets = bucket_route_candidates(rows, per_bucket=per_bucket)

    return JSONResponse(
        content={
            "success": True,
            "region": db_region,
            "restaurants": [public_poi_fields(r) for r in buckets["restaurants"]],
            "accommodations": [public_poi_fields(r) for r in buckets["accommodations"]],
            "attractions": [public_poi_fields(r) for r in buckets["attractions"]],
            "counts": {
                "restaurants": len(buckets["restaurants"]),
                "accommodations": len(buckets["accommodations"]),
                "attractions": len(buckets["attractions"]),
                "source_rows": len(rows),
            },
        }
    )
