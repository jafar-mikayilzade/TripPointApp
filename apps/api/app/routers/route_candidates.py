"""Ranked POI candidates for AI route planning (Google-first)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.constants.regions import REGION_COORDINATES
from app.services.live_route_candidates import (
    buckets_as_public,
    load_live_route_candidates,
)

router = APIRouter(tags=["route"])


@router.get("/api/route-candidates")
def route_candidates_endpoint(
    region: str = Query(..., description="Tourism region key, e.g. quba"),
    per_bucket: int = Query(12, ge=4, le=30, description="Max POIs per category group"),
    interests: str | None = Query(
        None,
        description="Comma-separated mobile interests, e.g. nature,food,history",
    ),
    source: Literal["google", "db"] = Query(
        "google",
        description="Candidate source preference (google falls back to db)",
    ),
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

    interest_list = [
        part.strip()
        for part in (interests or "").split(",")
        if part.strip()
    ]

    loaded = load_live_route_candidates(
        region_key,
        per_bucket=per_bucket,
        interests=interest_list or None,
        source=source,
    )
    buckets = loaded["buckets"]
    public = buckets_as_public(buckets)

    return JSONResponse(
        content={
            "success": True,
            "region": loaded["region"],
            "source": loaded["source"],
            "warnings": loaded.get("warnings") or [],
            "restaurants": public["restaurants"],
            "accommodations": public["accommodations"],
            "attractions": public["attractions"],
            "counts": {
                "restaurants": len(public["restaurants"]),
                "accommodations": len(public["accommodations"]),
                "attractions": len(public["attractions"]),
                "google_raw": loaded.get("google_raw_count") or 0,
            },
        }
    )
