"""Ratings upsert for feed/posts (service-role write after auth)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import verify_user
from app.db import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ratings", tags=["ratings"])

TargetType = Literal["poi", "listing", "business", "profile", "post"]


class UpsertRatingBody(BaseModel):
    target_type: TargetType
    target_id: str = Field(..., min_length=8, max_length=64)
    score: int = Field(..., ge=1, le=5)


@router.post("/upsert")
def api_upsert_rating(
    body: UpsertRatingBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    user_id = verify_user(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})

    row = {
        "rater_id": user_id,
        "target_type": body.target_type,
        "target_id": body.target_id,
        "score": body.score,
    }

    try:
        supabase.table("ratings").upsert(
            row, on_conflict="rater_id,target_type,target_id"
        ).execute()
    except Exception as exc:
        msg = str(exc)
        logger.exception("rating upsert failed")
        if "ratings_target_type_check" in msg or "23514" in msg:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "schema_outdated",
                    "message": (
                        "Reytinq cədvəli köhnədir. Supabase SQL Editor-də "
                        "20260810_fix_ratings_and_poi_photo_insert.sql işə salın."
                    ),
                },
            ) from exc
        if "ratings_target_type_key" in msg or "23505" in msg:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "schema_broken_unique",
                    "message": (
                        "Reytinq unique constraint səhvdir. "
                        "20260810_fix_ratings_and_poi_photo_insert.sql migration-ını tətbiq edin."
                    ),
                },
            ) from exc
        raise HTTPException(
            status_code=502,
            detail={"error": "upsert_failed", "message": "Reytinq yazılmadı."},
        ) from None

    refreshed = (
        supabase.table("ratings")
        .select("score, rater_id")
        .eq("target_type", body.target_type)
        .eq("target_id", body.target_id)
        .execute()
    )
    rows = list(refreshed.data or [])
    total = len(rows)
    avg = (sum(float(r.get("score") or 0) for r in rows) / total) if total else None
    mine = next(
        (int(r["score"]) for r in rows if str(r.get("rater_id")) == user_id),
        body.score,
    )
    return {
        "success": True,
        "average": avg,
        "count": total,
        "user_score": mine,
    }
