"""Feed post helpers (service-role writes after auth)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import verify_admin, verify_user
from app.db import supabase
from app.photo_urls import require_https_photo_url
from app.services.telegram_notify import notify_all_admins

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/posts", tags=["posts"])


class PostPhotoItem(BaseModel):
    photo_url: str = Field(..., min_length=8, max_length=2000)
    order_index: int = Field(default=0, ge=0, le=100)


class AttachPhotosBody(BaseModel):
    post_id: str = Field(..., min_length=8, max_length=64)
    photos: list[PostPhotoItem] = Field(..., min_length=1, max_length=6)


class PostPhotoStatusBody(BaseModel):
    status: Literal["approved", "rejected", "pending"]


@router.post("/photos")
def api_attach_post_photos(
    body: AttachPhotosBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Insert post_photos as pending for the caller's post (admin must approve)."""
    user_id = verify_user(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})

    post = (
        supabase.table("posts")
        .select("id, user_id")
        .eq("id", body.post_id)
        .limit(1)
        .execute()
    )
    row = (post.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail={"error": "post_not_found"})
    if str(row.get("user_id") or "") != user_id:
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    payload = [
        {
            "post_id": body.post_id,
            "photo_url": require_https_photo_url(item.photo_url),
            "order_index": item.order_index,
            "status": "pending",
        }
        for item in body.photos
    ]

    try:
        result = supabase.table("post_photos").insert(payload).execute()
    except Exception as exc:
        # Older DBs without status column — insert without status
        msg = str(exc)
        if "status" in msg.lower() or "pgrst" in msg.lower() or "42703" in msg:
            logger.warning("post_photos.status missing; inserting without status")
            payload_legacy = [
                {
                    "post_id": body.post_id,
                    "photo_url": item.photo_url,
                    "order_index": item.order_index,
                }
                for item in body.photos
            ]
            try:
                result = supabase.table("post_photos").insert(payload_legacy).execute()
            except Exception:
                logger.exception("post photo insert failed (legacy)")
                raise HTTPException(
                    status_code=502,
                    detail={
                        "error": "insert_failed",
                        "message": "Post şəkilləri yazılmadı. Migration tətbiq edin.",
                    },
                ) from None
        else:
            logger.exception("post photo insert failed")
            raise HTTPException(
                status_code=502,
                detail={"error": "insert_failed", "message": "Post şəkilləri yazılmadı."},
            ) from None

    inserted = list(result.data or [])
    first_id = str(inserted[0].get("id")) if inserted else None
    try:
        notify_all_admins(
            f"🛡 TripPoint · yeni paylaşım şəkli\n{len(payload)} şəkil təsdiq gözləyir"
        )
    except Exception:
        logger.exception("post photo admin notify failed")

    return {
        "success": True,
        "inserted": len(inserted) if inserted else len(payload),
        "ids": [str(r.get("id")) for r in inserted if r.get("id")],
        "status": "pending",
        "first_id": first_id,
    }


@router.get("/photos/pending")
def api_list_pending_post_photos(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Admin-only: pending feed post photos."""
    if not verify_admin(authorization):
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    try:
        result = (
            supabase.table("post_photos")
            .select("id, post_id, photo_url, order_index, status, created_at")
            .eq("status", "pending")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
    except Exception:
        logger.exception("list pending post photos failed")
        return {"success": True, "photos": [], "count": 0}

    photos = list(result.data or [])
    post_ids = sorted({str(p.get("post_id")) for p in photos if p.get("post_id")})
    caption_by_id: dict[str, str] = {}
    if post_ids:
        try:
            posts = (
                supabase.table("posts")
                .select("id, caption")
                .in_("id", post_ids)
                .execute()
            )
            caption_by_id = {
                str(row["id"]): str(row.get("caption") or "")[:80]
                for row in (posts.data or [])
                if row.get("id")
            }
        except Exception:
            logger.exception("pending post photo captions failed")

    for photo in photos:
        pid = str(photo.get("post_id") or "")
        photo["post_caption"] = caption_by_id.get(pid) or None
        photo["kind"] = "post"

    return {"success": True, "photos": photos, "count": len(photos)}


@router.patch("/photos/{photo_id}/status")
def api_set_post_photo_status(
    photo_id: str,
    body: PostPhotoStatusBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Admin-only: approve/reject a feed post photo."""
    if not verify_admin(authorization):
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    try:
        result = (
            supabase.table("post_photos")
            .update({"status": body.status})
            .eq("id", photo_id)
            .execute()
        )
    except Exception:
        logger.exception("set post photo status failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "update_failed", "message": "Post şəkil statusu yenilənmədi."},
        ) from None

    return {"success": True, "updated": len(result.data or [])}
