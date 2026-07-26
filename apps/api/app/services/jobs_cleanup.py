"""Nightly cleanup: pending moderation, expired listings, spots + rating recompute."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import supabase
from app.services.jobs_dup_alert import run_duplicate_poi_alert

logger = logging.getLogger(__name__)

PENDING_MAX_AGE_DAYS = 30


def _iso_days_ago(days: int) -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    return cutoff.isoformat()


def cleanup_stale_pending() -> dict[str, int]:
    """Delete pending POIs/photos older than PENDING_MAX_AGE_DAYS."""
    cutoff = _iso_days_ago(PENDING_MAX_AGE_DAYS)
    photos_deleted = 0
    pois_deleted = 0

    try:
        photo_rows = (
            supabase.table("poi_photos")
            .select("id")
            .eq("status", "pending")
            .lt("created_at", cutoff)
            .limit(500)
            .execute()
            .data
            or []
        )
        photo_ids = [str(r["id"]) for r in photo_rows if r.get("id")]
        if photo_ids:
            supabase.table("poi_photos").delete().in_("id", photo_ids).execute()
            photos_deleted = len(photo_ids)
    except Exception:
        logger.exception("cleanup_stale_pending photos failed")

    try:
        poi_rows = (
            supabase.table("pois")
            .select("id")
            .eq("status", "pending")
            .lt("created_at", cutoff)
            .limit(200)
            .execute()
            .data
            or []
        )
        poi_ids = [str(r["id"]) for r in poi_rows if r.get("id")]
        if poi_ids:
            # Photos for those POIs first (any status)
            supabase.table("poi_photos").delete().in_("poi_id", poi_ids).execute()
            supabase.table("pois").delete().in_("id", poi_ids).execute()
            pois_deleted = len(poi_ids)
    except Exception:
        logger.exception("cleanup_stale_pending pois failed")

    return {"pending_photos_deleted": photos_deleted, "pending_pois_deleted": pois_deleted}


def complete_expired_listings() -> dict[str, int]:
    """Mark active listings past departure_at as completed."""
    now = datetime.now(timezone.utc).isoformat()
    updated = 0
    try:
        rows = (
            supabase.table("listings")
            .select("id")
            .eq("status", "active")
            .lt("departure_at", now)
            .limit(300)
            .execute()
            .data
            or []
        )
        ids = [str(r["id"]) for r in rows if r.get("id")]
        if ids:
            supabase.table("listings").update({"status": "completed"}).in_(
                "id", ids
            ).execute()
            updated = len(ids)
    except Exception:
        logger.exception("complete_expired_listings failed")
    return {"listings_completed": updated}


def refresh_spots_left() -> dict[str, int]:
    """Recompute spots_left from capacity/max_participants − approved members."""
    refreshed = 0
    try:
        rows = (
            supabase.table("listings")
            .select("id, capacity, max_participants, spots_left")
            .eq("status", "active")
            .limit(400)
            .execute()
            .data
            or []
        )
        for row in rows:
            lid = row.get("id")
            if not lid:
                continue
            cap = row.get("capacity")
            if cap is None:
                cap = row.get("max_participants")
            if cap is None:
                continue
            try:
                capacity = int(cap)
            except (TypeError, ValueError):
                continue

            parts = (
                supabase.table("listing_participants")
                .select("id")
                .eq("listing_id", lid)
                .eq("status", "approved")
                .execute()
                .data
                or []
            )
            left = max(0, capacity - len(parts))
            current = row.get("spots_left")
            if current != left:
                supabase.table("listings").update({"spots_left": left}).eq(
                    "id", lid
                ).execute()
                refreshed += 1
    except Exception:
        logger.exception("refresh_spots_left failed")
    return {"listings_spots_refreshed": refreshed}


def recompute_profile_rating_avg() -> dict[str, int]:
    """Denormalized profiles.rating_avg from ratings where target_type=profile."""
    updated = 0
    try:
        rows = (
            supabase.table("ratings")
            .select("target_id, score")
            .eq("target_type", "profile")
            .limit(2000)
            .execute()
            .data
            or []
        )
        buckets: dict[str, list[float]] = {}
        for row in rows:
            tid = row.get("target_id")
            score = row.get("score")
            if not tid or score is None:
                continue
            try:
                buckets.setdefault(str(tid), []).append(float(score))
            except (TypeError, ValueError):
                continue

        for uid, scores in buckets.items():
            avg = round(sum(scores) / len(scores), 2)
            supabase.table("profiles").update({"rating_avg": avg}).eq("id", uid).execute()
            updated += 1
    except Exception:
        logger.exception("recompute_profile_rating_avg failed")
    return {"profiles_rating_updated": updated}


def run_nightly_cleanup() -> dict[str, Any]:
    result: dict[str, Any] = {"ok": True}
    result.update(cleanup_stale_pending())
    result.update(complete_expired_listings())
    result.update(refresh_spots_left())
    result.update(recompute_profile_rating_avg())
    try:
        result.update(run_duplicate_poi_alert(send=True))
    except Exception:
        logger.exception("duplicate poi alert failed")
        result["duplicate_pairs"] = -1
    return result
