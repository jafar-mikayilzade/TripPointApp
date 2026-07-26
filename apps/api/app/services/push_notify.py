"""Expo Push API helper."""

from __future__ import annotations

import logging
from typing import Any

import requests

from app.db import supabase

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def get_push_token_for_user(user_id: str) -> str | None:
    try:
        rows = (
            supabase.table("profiles")
            .select("expo_push_token")
            .eq("id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        token = (rows[0].get("expo_push_token") if rows else None) or ""
        token = str(token).strip()
        return token or None
    except Exception:
        logger.exception("get_push_token_for_user failed")
        return None


def send_expo_push(
    tokens: list[str],
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    clean = [t.strip() for t in tokens if t and str(t).strip()]
    if not clean:
        return {"sent": 0, "requested": 0}

    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title[:100],
            "body": body[:500],
            "data": data or {},
        }
        for token in clean
    ]

    try:
        res = requests.post(
            EXPO_PUSH_URL,
            json=messages if len(messages) > 1 else messages[0],
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=12,
        )
        if not res.ok:
            logger.warning("Expo push failed: %s %s", res.status_code, res.text[:200])
            return {"sent": 0, "requested": len(clean)}
        return {"sent": len(clean), "requested": len(clean)}
    except Exception:
        logger.exception("Expo push raised")
        return {"sent": 0, "requested": len(clean)}


def notify_users_push(
    user_ids: list[str],
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tokens: list[str] = []
    for uid in user_ids:
        token = get_push_token_for_user(uid)
        if token:
            tokens.append(token)
    return send_expo_push(tokens, title=title, body=body, data=data)
