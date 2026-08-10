"""Places sync API."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from app.auth import verify_admin, verify_user
from app.config import CRON_SECRET
from app.security import secret_matches
from app.services.places_sync import sync_places
from app.services.import_serpapi_hotels import import_serpapi_hotels_endpoint_response

router = APIRouter(prefix="/api", tags=["sync"])


def _require_admin_or_cron(
    authorization: str | None,
    x_cron_secret: str | None,
) -> None:
    """Sync writes to `pois` and hits paid upstream APIs — admin or cron only."""
    expected = (CRON_SECRET or "").strip()
    if expected and secret_matches(x_cron_secret, expected):
        return
    if verify_admin(authorization):
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
    _require_admin_or_cron(authorization, x_cron_secret)
    return sync_places(region, category)


@router.post("/import-serpapi-hotels")
def import_serpapi_hotels_endpoint(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    region: str = Query(..., description="Region key, e.g. quba"),
    max_pages: int = Query(5, ge=1, le=10, description="SerpAPI result pages"),
    currency: str = Query("AZN", min_length=3, max_length=8),
) -> JSONResponse:
    """One-shot lodging import from SerpAPI Google Hotels → pois (insert-if-missing)."""
    _require_admin_or_cron(authorization, x_cron_secret)
    return import_serpapi_hotels_endpoint_response(
        region,
        max_pages=max_pages,
        currency=currency.strip().upper(),
    )
