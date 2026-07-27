"""Fan out already-persisted notification rows to push + Telegram.

Recipients and text come from the `notifications` rows themselves, never from
the request body. Row INSERT is guarded by RLS (`actor_id = auth.uid()` and the
recipient must genuinely subscribe to the actor), so re-reading the rows here
inherits that guarantee — a caller can only mirror notifications it legitimately
created, and cannot forge the content or the audience.
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
