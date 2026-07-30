"""POI helper endpoints (service-role upserts)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import verify_user
from app.services.poi_upsert_google import upsert_google_place

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pois", tags=["pois"])


class UpsertGooglePlaceBody(BaseModel):
    place_id: str = Field(..., min_length=4, max_length=256)
    name: str = Field(..., min_length=1, max_length=200)
    lat: float
    lng: float
    category: str | None = "other"
    region: str | None = None
    rating: float | None = None
    rating_count: int | None = None


@router.post("/upsert-google-place")
def api_upsert_google_place(
    body: UpsertGooglePlaceBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Persist a live Google place so favorites.target_id can be a UUID.

    Writes an approved row with the service role, so the caller must present a
    valid Supabase session — otherwise anyone could seed the public POI table.
    """
    if not verify_user(authorization):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})

    try:
        return upsert_google_place(body.model_dump())
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_payload", "message": str(exc)},
        ) from exc
    except Exception:
        logger.exception("upsert-google-place failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "upsert_failed", "message": "Could not save the place."},
        ) from None
