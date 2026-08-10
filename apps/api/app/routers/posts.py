"""Feed post helpers (service-role writes after auth)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import verify_user
from app.db import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/posts", tags=["posts"])


class PostPhotoItem(BaseModel):
    photo_url: str = Field(..., min_length=8, max_length=2000)
    order_index: int = Field(default=0, ge=0, le=100)


class AttachPhotosBody(BaseModel):
    post_id: str = Field(..., min_length=8, max_length=64)
    photos: list[PostPhotoItem] = Field(..., min_length=1, max_length=6)


@router.post("/photos")
def api_attach_post_photos(
    body: AttachPhotosBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Insert post_photos rows for the caller's post (bypasses INSERT RLS)."""
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
            "photo_url": item.photo_url,
            "order_index": item.order_index,
        }
        for item in body.photos
    ]

    try:
        result = supabase.table("post_photos").insert(payload).execute()
    except Exception:
        logger.exception("post photo insert failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "insert_failed", "message": "Post şəkilləri yazılmadı."},
        ) from None

    inserted = list(result.data or [])
    return {
        "success": True,
        "inserted": len(inserted) if inserted else len(payload),
        "ids": [str(r.get("id")) for r in inserted if r.get("id")],
    }
