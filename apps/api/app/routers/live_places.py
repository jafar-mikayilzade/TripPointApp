"""GET /api/live-places — home/Qur map markers (tourism-first Google + DB)."""

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
    lat: float | None = Query(
        None, description="Optional viewport center latitude"
    ),
    lng: float | None = Query(
        None, description="Optional viewport center longitude"
    ),
    radius: int | None = Query(
        None,
        ge=2000,
        le=25000,
        description="Optional viewport radius meters (with lat/lng)",
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

    if (lat is None) ^ (lng is None):
        raise HTTPException(
            status_code=400,
            detail={"error": "lat and lng must be provided together"},
        )

    try:
        loaded = load_live_home_places(
            region_key,
            category=category,
            limit=limit,
            lat=lat,
            lng=lng,
            radius=radius,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "Invalid region"},
        ) from exc

    return JSONResponse(
        content={
            "success": True,
            "region": loaded["region"],
            "source": loaded["source"],
            "warnings": loaded.get("warnings") or [],
            "places": loaded["places"],
            "count": len(loaded["places"]),
            "viewport": bool(loaded.get("viewport")),
            "hubs_used": loaded.get("hubs_used") or [],
        }
    )
