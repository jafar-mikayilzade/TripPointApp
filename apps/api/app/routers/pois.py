"""POI helper endpoints (service-role upserts)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import verify_admin, verify_user
from app.db import supabase
from app.photo_urls import require_https_photo_url
from app.services.poi_upsert_google import upsert_google_place
from app.services.telegram_notify import admin_action_keyboard, notify_all_admins

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


class PendingPhotoItem(BaseModel):
    photo_url: str = Field(..., min_length=8, max_length=2000)
    thumb_url: str | None = Field(default=None, max_length=2000)
    medium_url: str | None = Field(default=None, max_length=2000)
    order_index: int = Field(default=0, ge=0, le=100)


class PendingPhotosBody(BaseModel):
    poi_id: str = Field(..., min_length=8, max_length=64)
    poi_name: str | None = Field(default=None, max_length=200)
    photos: list[PendingPhotoItem] = Field(..., min_length=1, max_length=6)


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


@router.post("/photos/pending")
def api_create_pending_photos(
    body: PendingPhotosBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Insert user-uploaded POI photos as pending (service role bypasses RLS).

    Needed until/alongside the INSERT RLS policy on poi_photos is applied.
    Also notifies admins for Telegram moderation.
    """
    user_id = verify_user(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})

    poi = (
        supabase.table("pois")
        .select("id, name, status")
        .eq("id", body.poi_id)
        .limit(1)
        .execute()
    )
    row = (poi.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail={"error": "poi_not_found"})

    payload = [
        {
            "poi_id": body.poi_id,
            "photo_url": require_https_photo_url(item.photo_url),
            "thumb_url": require_https_photo_url(
                item.thumb_url or item.photo_url, field="thumb_url"
            ),
            "medium_url": require_https_photo_url(
                item.medium_url or item.photo_url, field="medium_url"
            ),
            "order_index": item.order_index,
            "status": "pending",
            "uploaded_by": user_id,
        }
        for item in body.photos
    ]

    try:
        result = supabase.table("poi_photos").insert(payload).execute()
    except Exception:
        logger.exception("pending photo insert failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "insert_failed", "message": "Şəkillər yazılmadı."},
        ) from None

    inserted = list(result.data or [])
    first_id = str(inserted[0].get("id")) if inserted else None
    poi_name = body.poi_name or str(row.get("name") or "POI")
    notify_text = f'🛡 TripPoint · yeni şəkil təsdiqi\n"{poi_name}" üçün {len(payload)} şəkil'
    sent = 0
    try:
        keyboard = (
            admin_action_keyboard("photo_pending", first_id) if first_id else None
        )
        notify_result = notify_all_admins(notify_text, reply_markup=keyboard)
        sent = int(notify_result.get("sent") or 0)
    except Exception:
        logger.exception("pending photo admin notify failed")

    return {
        "success": True,
        "inserted": len(inserted) if inserted else len(payload),
        "ids": [str(r.get("id")) for r in inserted if r.get("id")],
        "notify_sent": sent,
    }


@router.get("/photos/pending")
def api_list_pending_photos(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Admin-only: list pending POI photos (service role bypasses SELECT RLS)."""
    if not verify_admin(authorization):
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    try:
        result = (
            supabase.table("poi_photos")
            .select(
                "id, poi_id, photo_url, thumb_url, medium_url, order_index, "
                "status, uploaded_by, created_at"
            )
            .eq("status", "pending")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
    except Exception:
        logger.exception("list pending photos failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "list_failed", "message": "Gözləyən şəkillər oxunmadı."},
        ) from None

    photos = list(result.data or [])
    poi_ids = sorted({str(p.get("poi_id")) for p in photos if p.get("poi_id")})
    name_by_id: dict[str, str] = {}
    if poi_ids:
        try:
            pois = (
                supabase.table("pois")
                .select("id, name")
                .in_("id", poi_ids)
                .execute()
            )
            name_by_id = {
                str(row["id"]): str(row.get("name") or "")
                for row in (pois.data or [])
                if row.get("id")
            }
        except Exception:
            logger.exception("pending photo poi names failed")

    for photo in photos:
        poi_id = str(photo.get("poi_id") or "")
        photo["poi_name"] = name_by_id.get(poi_id) or None

    return {"success": True, "photos": photos, "count": len(photos)}


class PhotoStatusBody(BaseModel):
    status: Literal["approved", "rejected", "pending"]


def _purge_poi_photo_urls(poi_id: str, urls: list[str]) -> None:
    """Remove rejected photo URLs from pois.photo_urls / thumbnail_url so gallery stays clean."""
    blocked = {u.strip() for u in urls if isinstance(u, str) and u.strip()}
    if not poi_id or not blocked:
        return
    try:
        poi = (
            supabase.table("pois")
            .select("id, photo_urls, thumbnail_url")
            .eq("id", poi_id)
            .limit(1)
            .execute()
        )
        row = (poi.data or [None])[0]
        if not row:
            return

        raw_urls = row.get("photo_urls")
        kept: list[str] = []
        if isinstance(raw_urls, list):
            kept = [
                str(u).strip()
                for u in raw_urls
                if isinstance(u, str) and str(u).strip() and str(u).strip() not in blocked
            ]

        patch: dict[str, Any] = {}
        if isinstance(raw_urls, list) and kept != [
            str(u).strip() for u in raw_urls if isinstance(u, str) and str(u).strip()
        ]:
            patch["photo_urls"] = kept

        thumb = str(row.get("thumbnail_url") or "").strip()
        if thumb and thumb in blocked:
            patch["thumbnail_url"] = kept[0] if kept else None

        if patch:
            supabase.table("pois").update(patch).eq("id", poi_id).execute()
    except Exception:
        logger.exception("purge poi photo urls failed poi_id=%s", poi_id)


@router.patch("/photos/{photo_id}/status")
def api_set_photo_status(
    photo_id: str,
    body: PhotoStatusBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Admin-only: approve/reject a pending POI photo."""
    if not verify_admin(authorization):
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    existing = (
        supabase.table("poi_photos")
        .select("id, poi_id, photo_url, thumb_url, medium_url")
        .eq("id", photo_id)
        .limit(1)
        .execute()
    )
    photo_row = (existing.data or [None])[0]

    try:
        result = (
            supabase.table("poi_photos")
            .update({"status": body.status})
            .eq("id", photo_id)
            .execute()
        )
    except Exception:
        logger.exception("set photo status failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "update_failed", "message": "Şəkil statusu yenilənmədi."},
        ) from None

    if body.status == "rejected" and photo_row:
        urls = [
            str(photo_row.get("photo_url") or ""),
            str(photo_row.get("thumb_url") or ""),
            str(photo_row.get("medium_url") or ""),
        ]
        _purge_poi_photo_urls(str(photo_row.get("poi_id") or ""), urls)

    return {"success": True, "updated": len(result.data or [])}
