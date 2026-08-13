"""Create + fan out notification rows to push + Telegram.

Client RLS used to block join-request / subscribe rows (recipient is the
listing owner, not a subscriber of the actor). Inserts go through the
service-role client after the caller's session is verified and each
recipient is checked against listing ownership, participation, or a real
subscription.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import supabase
from app.services.push_notify import notify_users_push

logger = logging.getLogger(__name__)

MAX_ROWS_PER_DISPATCH = 200
# Only just-created rows may be mirrored — blocks replaying old notifications.
MAX_ROW_AGE_MINUTES = 15


def _parse_created_at(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _load_own_rows(notification_ids: list[str], actor_id: str) -> list[dict[str, Any]]:
    try:
        rows = (
            supabase.table("notifications")
            .select("id, user_id, title, body, listing_id, actor_id, created_at")
            .in_("id", notification_ids)
            .eq("actor_id", actor_id)
            .limit(MAX_ROWS_PER_DISPATCH)
            .execute()
            .data
            or []
        )
    except Exception:
        logger.exception("notify dispatch: loading notification rows failed")
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=MAX_ROW_AGE_MINUTES)
    fresh: list[dict[str, Any]] = []
    for row in rows:
        created = _parse_created_at(row.get("created_at"))
        if created is None or created >= cutoff:
            fresh.append(row)
    return fresh


def dispatch_notifications(
    notification_ids: list[str],
    *,
    actor_id: str,
) -> dict[str, Any]:
    """Mirror the caller's own fresh notification rows to push + Telegram."""
    ids = [str(i).strip() for i in notification_ids if str(i).strip()]
    if not ids:
        return {"pushed": 0, "telegram": 0, "requested": 0}

    rows = _load_own_rows(ids[:MAX_ROWS_PER_DISPATCH], actor_id)
    if not rows:
        return {"pushed": 0, "telegram": 0, "requested": len(ids)}

    # Same title/body for every recipient of one event — group to batch the push
    grouped: dict[tuple[str, str, str], list[str]] = {}
    for row in rows:
        user_id = str(row.get("user_id") or "").strip()
        if not user_id or user_id == actor_id:
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        body = str(row.get("body") or "").strip()
        listing_id = str(row.get("listing_id") or "").strip()
        grouped.setdefault((title, body, listing_id), []).append(user_id)

    pushed = 0
    telegram_sent = 0
    from app.services.telegram_notify import notify_telegram_user

    for (title, body, listing_id), user_ids in grouped.items():
        unique_ids = list(dict.fromkeys(user_ids))
        result = notify_users_push(
            unique_ids,
            title=title,
            body=body or title,
            data={"listingId": listing_id} if listing_id else {},
        )
        pushed += int(result.get("sent") or 0)

        text = f"{title}\n{body}".strip() if body else title
        for user_id in unique_ids:
            try:
                if notify_telegram_user(user_id, text):
                    telegram_sent += 1
            except Exception:
                logger.exception("notify dispatch: telegram mirror failed")

    return {"pushed": pushed, "telegram": telegram_sent, "requested": len(ids)}


ALLOWED_KINDS = frozenset(
    {
        "tour_update",
        "organizer_new_tour",
        "tour_cancelled",
        "weather_tip",
        "explore_region",
        "system_tip",
        "join_request",
    }
)
KIND_FALLBACK = {
    "join_request": "tour_update",
}
MAX_CREATE_RECIPIENTS = 80


def _recipient_allowed(actor_id: str, user_id: str, listing_id: str | None) -> bool:
    """True when the actor may notify this user for this listing (or follow)."""
    if not user_id or user_id == actor_id:
        return False

    if listing_id:
        try:
            listing_rows = (
                supabase.table("listings")
                .select("created_by")
                .eq("id", listing_id)
                .limit(1)
                .execute()
                .data
                or []
            )
        except Exception:
            logger.exception("notify create: listing lookup failed")
            listing_rows = []
        owner = str((listing_rows[0] or {}).get("created_by") or "") if listing_rows else ""
        if owner == user_id or owner == actor_id:
            return True
        try:
            listing_sub = (
                supabase.table("subscriptions")
                .select("id")
                .eq("user_id", user_id)
                .eq("target_type", "listing")
                .eq("target_id", listing_id)
                .limit(1)
                .execute()
                .data
            )
            if listing_sub:
                return True
        except Exception:
            logger.exception("notify create: listing subscription lookup failed")
        if owner == actor_id:
            try:
                participant = (
                    supabase.table("listing_participants")
                    .select("id")
                    .eq("listing_id", listing_id)
                    .eq("user_id", user_id)
                    .limit(1)
                    .execute()
                    .data
                )
                if participant:
                    return True
            except Exception:
                logger.exception("notify create: participant lookup failed")

    try:
        for follower, organizer in ((actor_id, user_id), (user_id, actor_id)):
            org_sub = (
                supabase.table("subscriptions")
                .select("id")
                .eq("user_id", follower)
                .eq("target_type", "organizer")
                .eq("target_id", organizer)
                .limit(1)
                .execute()
                .data
            )
            if org_sub:
                return True
    except Exception:
        logger.exception("notify create: organizer subscription lookup failed")
    return False


def _insert_notification_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        inserted = supabase.table("notifications").insert(rows).execute().data or []
        if inserted:
            return list(inserted)
    except Exception:
        logger.warning("notify create: insert with requested kind failed; retrying fallback")
    fallback_rows = []
    for row in rows:
        kind = str(row.get("kind") or "tour_update")
        fallback_rows.append({**row, "kind": KIND_FALLBACK.get(kind, "tour_update")})
    try:
        inserted = (
            supabase.table("notifications").insert(fallback_rows).execute().data or []
        )
        return list(inserted)
    except Exception:
        logger.exception("notify create: fallback insert failed")
        return []


def create_and_dispatch(
    *,
    actor_id: str,
    user_ids: list[str],
    kind: str,
    title: str,
    body: str | None,
    listing_id: str | None,
) -> dict[str, Any]:
    """Insert validated notification rows (service role) and fan out push."""
    clean_kind = (kind or "tour_update").strip()
    if clean_kind not in ALLOWED_KINDS:
        clean_kind = "tour_update"
    clean_title = (title or "").strip()[:120]
    if not clean_title:
        return {"inserted": 0, "pushed": 0, "telegram": 0}

    listing = (listing_id or "").strip() or None
    unique: list[str] = []
    seen: set[str] = set()
    for raw in user_ids:
        uid = str(raw or "").strip()
        if not uid or uid in seen or uid == actor_id:
            continue
        if not _recipient_allowed(actor_id, uid, listing):
            continue
        seen.add(uid)
        unique.append(uid)
        if len(unique) >= MAX_CREATE_RECIPIENTS:
            break

    if not unique:
        return {"inserted": 0, "pushed": 0, "telegram": 0, "rejected": True}

    rows = [
        {
            "user_id": uid,
            "kind": clean_kind,
            "title": clean_title,
            "body": (body or "").strip()[:500] or None,
            "listing_id": listing,
            "actor_id": actor_id,
        }
        for uid in unique
    ]
    inserted = _insert_notification_rows(rows)
    ids = [str(row.get("id") or "") for row in inserted if row.get("id")]
    dispatched = dispatch_notifications(ids, actor_id=actor_id) if ids else {
        "pushed": 0,
        "telegram": 0,
        "requested": 0,
    }
    return {"inserted": len(ids), **dispatched}
