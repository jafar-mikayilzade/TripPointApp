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
