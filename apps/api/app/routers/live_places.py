"""GET /api/live-places — home map markers from Google (DB fallback)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.constants.regions import REGION_COORDINATES
from app.services.live_home_places import load_live_home_places

router = APIRouter(tags=["places"])


@router.get("/api/live-places")
def live_places_endpoint(
    region: str = Query(..., description="Tourism region key, e.g. quba"),
    category: str | None = Query(
        None,
        description="App category filter, or all/omit for tourism mix",
    ),
    limit: int = Query(60, ge=10, le=100),
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

    loaded = load_live_home_places(
        region_key,
        category=category,
        limit=limit,
    )

    return JSONResponse(
        content={
            "success": True,
            "region": loaded["region"],
            "source": loaded["source"],
            "warnings": loaded.get("warnings") or [],
            "places": loaded["places"],
            "count": len(loaded["places"]),
        }
    )
