"""Places sync API."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from app.auth import verify_user
from app.config import CRON_SECRET
from app.security import secret_matches
from app.services.places_sync import sync_places

router = APIRouter(prefix="/api", tags=["sync"])


def _require_user_or_cron(
    authorization: str | None,
    x_cron_secret: str | None,
) -> None:
    """Sync writes to `pois` and hits Overpass — never leave it anonymous."""
    expected = (CRON_SECRET or "").strip()
    if expected and secret_matches(x_cron_secret, expected):
        return
    if verify_user(authorization):
        return
    raise HTTPException(status_code=401, detail={"error": "unauthorized"})


@router.get("/sync-places")
def sync_places_endpoint(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    region: str = Query(..., description="Tourism region key, e.g. quba"),
    category: str = Query(
        "all",
        description=(
            "Use 'all' for OSM attractions sync (insert-if-missing). "
            "Food/lodging categories are skipped when DATA_SOURCE=osm."
        ),
    ),
) -> JSONResponse:
    _require_user_or_cron(authorization, x_cron_secret)
    return sync_places(region, category)
