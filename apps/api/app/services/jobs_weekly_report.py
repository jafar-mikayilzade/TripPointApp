"""Weekly admin stats → Telegram."""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import supabase
from app.services.telegram_notify import notify_all_admins

logger = logging.getLogger(__name__)


def _week_ago_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()


def build_weekly_stats() -> dict[str, Any]:
    since = _week_ago_iso()
    stats: dict[str, Any] = {
        "new_users": 0,
        "new_listings": 0,
        "active_listings": 0,
        "carpool_listings": 0,
        "tour_listings": 0,
        "top_region": None,
        "pending_pois": 0,
        "pending_photos": 0,
    }

    try:
        profiles = (
            supabase.table("profiles")
            .select("id", count="exact")
            .gte("created_at", since)
            .execute()
        )
        stats["new_users"] = profiles.count if profiles.count is not None else len(
            profiles.data or []
        )
    except Exception:
        logger.exception("weekly new_users failed")

    try:
        listings = (
            supabase.table("listings")
            .select("id, type, region, status")
            .gte("created_at", since)
            .execute()
            .data
            or []
        )
        stats["new_listings"] = len(listings)
        stats["carpool_listings"] = sum(
            1 for r in listings if str(r.get("type") or "") == "carpool"
        )
        stats["tour_listings"] = sum(
            1 for r in listings if str(r.get("type") or "") == "tour"
        )
        regions = [
            str(r.get("region") or "").lower()
            for r in listings
            if r.get("region")
        ]
        if regions:
            stats["top_region"] = Counter(regions).most_common(1)[0][0]
    except Exception:
        logger.exception("weekly listings failed")

    try:
        active = (
            supabase.table("listings")
            .select("id", count="exact")
            .eq("status", "active")
            .execute()
        )
        stats["active_listings"] = active.count if active.count is not None else len(
            active.data or []
        )
    except Exception:
        logger.exception("weekly active_listings failed")

    try:
        pending_pois = (
            supabase.table("pois")
            .select("id", count="exact")
            .eq("status", "pending")
            .execute()
        )
        stats["pending_pois"] = (
            pending_pois.count
            if pending_pois.count is not None
            else len(pending_pois.data or [])
        )
    except Exception:
        logger.exception("weekly pending_pois failed")

    try:
        pending_photos = (
            supabase.table("poi_photos")
            .select("id", count="exact")
            .eq("status", "pending")
            .execute()
        )
        stats["pending_photos"] = (
            pending_photos.count
            if pending_photos.count is not None
            else len(pending_photos.data or [])
        )
    except Exception:
        logger.exception("weekly pending_photos failed")

    return stats


def format_weekly_report(stats: dict[str, Any]) -> str:
    top = stats.get("top_region") or "—"
    return (
        "📊 TripPoint həftəlik hesabat\n\n"
        f"Yeni istifadəçi: {stats.get('new_users', 0)}\n"
        f"Yeni elan: {stats.get('new_listings', 0)} "
        f"(tur: {stats.get('tour_listings', 0)}, carpool: {stats.get('carpool_listings', 0)})\n"
        f"Aktiv elan (ümumi): {stats.get('active_listings', 0)}\n"
        f"Ən aktiv region (yeni elanlar): {top}\n"
        f"Gözləyən POI / şəkil: {stats.get('pending_pois', 0)} / {stats.get('pending_photos', 0)}"
    )


def run_weekly_report(*, send: bool = True) -> dict[str, Any]:
    stats = build_weekly_stats()
    text = format_weekly_report(stats)
    sent = {"sent": 0, "requested": 0}
    if send:
        sent = notify_all_admins(text)
    return {"ok": True, "stats": stats, "text": text, **sent}
