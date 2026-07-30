"""Telegram Bot API helpers (admin + per-user)."""

from __future__ import annotations

import logging
from typing import Any

import requests

from app.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
from app.db import supabase

logger = logging.getLogger(__name__)

_TELEGRAM_TIMEOUT_SECONDS = 8


def _token() -> str | None:
    return TELEGRAM_BOT_TOKEN


def telegram_api(method: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    token = _token()
    if not token:
        logger.warning("Telegram API skipped: TELEGRAM_BOT_TOKEN not set")
        return None
    url = f"https://api.telegram.org/bot{token}/{method}"
    try:
        response = requests.post(url, json=payload, timeout=_TELEGRAM_TIMEOUT_SECONDS)
        if not response.ok:
            logger.warning(
                "Telegram %s failed: status=%s body=%s",
                method,
                response.status_code,
                (response.text or "")[:200],
            )
            return None
        data = response.json()
        if not data.get("ok"):
            logger.warning("Telegram %s not ok: %s", method, str(data)[:200])
            return None
        return data
    except Exception:
        logger.exception("Telegram %s raised", method)
        return None


def send_telegram_message(
    text: str,
    *,
    chat_id: str | int | None = None,
    parse_mode: str | None = None,
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    """Send a message. Defaults to admin TELEGRAM_CHAT_ID when chat_id is omitted."""
    target = chat_id if chat_id is not None else TELEGRAM_CHAT_ID
    if target is None or str(target).strip() == "":
        logger.warning("Telegram notify skipped: chat_id not set")
        return False

    body = (text or "").strip()
    if not body:
        logger.warning("Telegram notify skipped: empty message")
        return False
    if len(body) > 4000:
        body = body[:3990] + "…"

    payload: dict[str, Any] = {
        "chat_id": target,
        "text": body,
        "disable_web_page_preview": True,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup

    return telegram_api("sendMessage", payload) is not None


def edit_telegram_message(
    chat_id: str | int,
    message_id: int,
    text: str,
    *,
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    body = (text or "").strip()
    if len(body) > 4000:
        body = body[:3990] + "…"
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": body,
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return telegram_api("editMessageText", payload) is not None


def answer_callback_query(
    callback_query_id: str,
    *,
    text: str | None = None,
) -> bool:
    payload: dict[str, Any] = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text[:200]
    return telegram_api("answerCallbackQuery", payload) is not None


def resolve_telegram_chat_id_for_user(user_id: str) -> str | None:
    """Find linked Telegram chat for an app user_id."""
    uid = (user_id or "").strip()
    if not uid:
        return None
    try:
        res = (
            supabase.table("telegram_users")
            .select("telegram_chat_id")
            .eq("linked_user_id", uid)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows and rows[0].get("telegram_chat_id"):
            return str(rows[0]["telegram_chat_id"])
    except Exception:
        logger.exception("resolve telegram_users failed")

    try:
        res = (
            supabase.table("profiles")
            .select("telegram_chat_id")
            .eq("id", uid)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows and rows[0].get("telegram_chat_id"):
            return str(rows[0]["telegram_chat_id"])
    except Exception:
        logger.exception("resolve profiles.telegram_chat_id failed")
    return None


def notify_telegram_user(user_id: str, text: str) -> bool:
    chat_id = resolve_telegram_chat_id_for_user(user_id)
    if not chat_id:
        return False
    return send_telegram_message(text, chat_id=chat_id)


def list_admin_telegram_chat_ids() -> list[str]:
    """TELEGRAM_CHAT_ID + bütün role=admin və Telegram bağlı profillər."""
    chats: set[str] = set()
    if TELEGRAM_CHAT_ID and str(TELEGRAM_CHAT_ID).strip():
        chats.add(str(TELEGRAM_CHAT_ID).strip())

    try:
        rows = (
            supabase.table("profiles")
            .select("id, telegram_chat_id")
            .eq("role", "admin")
            .execute()
            .data
            or []
        )
        for row in rows:
            chat = row.get("telegram_chat_id")
            if chat:
                chats.add(str(chat).strip())
            else:
                uid = row.get("id")
                if uid:
                    linked = resolve_telegram_chat_id_for_user(str(uid))
                    if linked:
                        chats.add(linked)
    except Exception:
        logger.exception("list_admin_telegram_chat_ids failed")

    return sorted(chats)


# kind → (table, column, open statuses)
_MODERATION_TARGETS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "poi_pending": ("pois", "status", ("pending",)),
    "photo_pending": ("poi_photos", "status", ("pending",)),
    "listing_report": ("listing_reports", "status", ("open",)),
}


def moderation_target_is_open(kind: str, target_id: str) -> bool:
    """True when the row exists and still awaits moderation.

    Callers pass a client-supplied id, so without this check anyone with a
    session could make admins see approve/reject buttons for arbitrary rows.
    """
    target = _MODERATION_TARGETS.get(kind)
    tid = (target_id or "").strip()
    if not target or not tid:
        return False

    table, column, open_values = target
    try:
        rows = (
            supabase.table(table)
            .select(f"id, {column}")
            .eq("id", tid)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception:
        logger.exception("moderation target check failed: %s %s", kind, tid)
        return False

    if not rows:
        return False
    return str(rows[0].get(column) or "") in open_values


def admin_action_keyboard(kind: str, target_id: str) -> dict[str, Any] | None:
    """Inline ✅/❌ for moderation notify messages.

    callback_data max 64 bytes — short prefixes.
    """
    tid = (target_id or "").strip()
    if not tid or len(tid) > 40:
        return None

    if kind == "poi_pending":
        entity = "poi"
        ok_label, no_label = "✅ Təsdiq", "❌ Rədd"
        no_action = "no"
    elif kind == "photo_pending":
        entity = "pho"
        ok_label, no_label = "✅ Təsdiq", "❌ Rədd"
        no_action = "no"
    elif kind == "listing_report":
        entity = "rep"
        ok_label, no_label = "✅ Bağla", "🗑 Elanı sil"
        no_action = "dl"
    else:
        return None

    return {
        "inline_keyboard": [
            [
                {"text": ok_label, "callback_data": f"adm:ok:{entity}:{tid}"},
                {"text": no_label, "callback_data": f"adm:{no_action}:{entity}:{tid}"},
            ]
        ]
    }


def notify_all_admins(
    text: str,
    *,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Broadcast moderation alert to env chat + all linked admins."""
    chats = list_admin_telegram_chat_ids()
    if not chats:
        logger.warning("notify_all_admins: no admin chat ids")
        return {"sent": 0, "requested": 0}

    sent = 0
    for chat_id in chats:
        if send_telegram_message(text, chat_id=chat_id, reply_markup=reply_markup):
            sent += 1
    return {"sent": sent, "requested": len(chats)}
