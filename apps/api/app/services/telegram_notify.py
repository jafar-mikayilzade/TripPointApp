"""Telegram sendMessage helpers (admin + per-user chat_id)."""

from __future__ import annotations

import logging
from typing import Any

import requests

from app.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger(__name__)

_TELEGRAM_TIMEOUT_SECONDS = 8


def send_telegram_message(
    text: str,
    *,
    chat_id: str | int | None = None,
    parse_mode: str | None = None,
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    """Send a message. Defaults to admin TELEGRAM_CHAT_ID when chat_id is omitted."""
    token = TELEGRAM_BOT_TOKEN
    target = chat_id if chat_id is not None else TELEGRAM_CHAT_ID
    if not token or target is None or str(target).strip() == "":
        logger.warning(
            "Telegram notify skipped: TELEGRAM_BOT_TOKEN or chat_id not set"
        )
        return False

    body = (text or "").strip()
    if not body:
        logger.warning("Telegram notify skipped: empty message")
        return False

    if len(body) > 4000:
        body = body[:3990] + "…"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: dict[str, Any] = {
        "chat_id": target,
        "text": body,
        "disable_web_page_preview": True,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup

    try:
        response = requests.post(url, json=payload, timeout=_TELEGRAM_TIMEOUT_SECONDS)
        if not response.ok:
            logger.warning(
                "Telegram sendMessage failed: status=%s body=%s",
                response.status_code,
                (response.text or "")[:200],
            )
            return False
        return True
    except Exception:
        logger.exception("Telegram sendMessage raised; ignoring")
        return False
