"""Places sync API."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.services.places_sync import sync_places

router = APIRouter(prefix="/api", tags=["sync"])


@router.get("/sync-places")
def sync_places_endpoint(
    region: str = Query(..., description="Tourism region key, e.g. quba"),
    category: str = Query(
        "all",
        description=(
            "Use 'all' for OSM attractions sync (insert-if-missing). "
            "Food/lodging categories are skipped when DATA_SOURCE=osm."
        ),
    ),
) -> JSONResponse:
    return sync_places(region, category)
