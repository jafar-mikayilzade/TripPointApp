"""Telegram admin notifications (optional; never crash the API)."""

from __future__ import annotations

import logging

import requests

from app.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger(__name__)

_TELEGRAM_TIMEOUT_SECONDS = 8


def send_telegram_message(
    text: str,
    *,
    parse_mode: str | None = None,
) -> bool:
    """Send a message to the configured admin chat. No-op if unset."""
    token = TELEGRAM_BOT_TOKEN
    chat_id = TELEGRAM_CHAT_ID
    if not token or not chat_id:
        logger.warning(
            "Telegram notify skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set"
        )
        return False

    body = (text or "").strip()
    if not body:
        logger.warning("Telegram notify skipped: empty message")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: dict[str, object] = {
        "chat_id": chat_id,
        "text": body,
        "disable_web_page_preview": True,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode

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
