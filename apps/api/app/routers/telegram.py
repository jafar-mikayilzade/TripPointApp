"""Telegram admin notify + user bot webhook."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import TELEGRAM_NOTIFY_SECRET, TELEGRAM_WEBHOOK_SECRET
from app.services.telegram_bot import handle_telegram_update
from app.services.telegram_notify import send_telegram_message

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _require_notify_secret(x_notify_secret: str | None) -> None:
    """If TELEGRAM_NOTIFY_SECRET is set, require matching X-Notify-Secret header."""
    expected = TELEGRAM_NOTIFY_SECRET
    if not expected:
        return
    if (x_notify_secret or "").strip() != expected:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


def _require_webhook_secret(x_telegram_bot_api_secret_token: str | None) -> None:
    expected = TELEGRAM_WEBHOOK_SECRET
    if not expected:
        return
    if (x_telegram_bot_api_secret_token or "").strip() != expected:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


class NotifyBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


@router.post("/test")
def telegram_test(
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    _require_notify_secret(x_notify_secret)
    ok = send_telegram_message("TripPoint Telegram OK")
    return {"ok": ok, "sent": ok}


@router.post("/notify")
def telegram_notify(
    body: NotifyBody,
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    """Admin notify hook (listing report / POI / photo)."""
    _require_notify_secret(x_notify_secret)
    ok = send_telegram_message(body.text)
    return {"ok": ok, "sent": ok}


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(
        default=None, alias="X-Telegram-Bot-Api-Secret-Token"
    ),
) -> dict[str, Any]:
    """Telegram Bot API webhook. Always 200 so Telegram does not retry forever."""
    _require_webhook_secret(x_telegram_bot_api_secret_token)
    try:
        update = await request.json()
    except Exception:
        return {"ok": True, "ignored": True}
    if not isinstance(update, dict):
        return {"ok": True, "ignored": True}
    return handle_telegram_update(update)
