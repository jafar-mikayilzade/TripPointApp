"""Persist Telegram bot sessions in Postgres (survives restarts)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.db import supabase

logger = logging.getLogger(__name__)


def load_session(chat_id: str | int) -> dict[str, Any]:
    key = str(chat_id)
    try:
        rows = (
            supabase.table("bot_sessions")
            .select("state, payload")
            .eq("chat_id", key)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            return {"mode": "idle", "step": None, "data": {}}
        payload = rows[0].get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        # Prefer payload as full session blob
        if "mode" in payload:
            return {
                "mode": payload.get("mode") or "idle",
                "step": payload.get("step"),
                "data": payload.get("data") if isinstance(payload.get("data"), dict) else {},
                "last_plan": payload.get("last_plan"),
            }
        return {
            "mode": rows[0].get("state") or "idle",
            "step": None,
            "data": payload if isinstance(payload, dict) else {},
        }
    except Exception:
        logger.exception("bot_sessions load failed chat=%s", key)
        return {"mode": "idle", "step": None, "data": {}}


def save_session(chat_id: str | int, session: dict[str, Any]) -> None:
    key = str(chat_id)
    payload = {
        "mode": session.get("mode") or "idle",
        "step": session.get("step"),
        "data": session.get("data") if isinstance(session.get("data"), dict) else {},
        "last_plan": session.get("last_plan"),
    }
    try:
        supabase.table("bot_sessions").upsert(
            {
                "chat_id": key,
                "state": str(payload.get("mode") or "idle"),
                "payload": payload,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="chat_id",
        ).execute()
    except Exception:
        logger.exception("bot_sessions save failed chat=%s", key)


def clear_session(chat_id: str | int) -> None:
    key = str(chat_id)
    try:
        # Keep last_plan if present
        current = load_session(key)
        last = current.get("last_plan")
        if last:
            save_session(
                key,
                {"mode": "idle", "step": None, "data": {}, "last_plan": last},
            )
        else:
            supabase.table("bot_sessions").delete().eq("chat_id", key).execute()
    except Exception:
        logger.exception("bot_sessions clear failed chat=%s", key)


def save_last_plan(chat_id: str | int, text: str) -> None:
    session = load_session(chat_id)
    session["last_plan"] = text
    save_session(chat_id, session)


def get_last_plan(chat_id: str | int) -> str | None:
    session = load_session(chat_id)
    last = session.get("last_plan")
    return str(last) if last else None
