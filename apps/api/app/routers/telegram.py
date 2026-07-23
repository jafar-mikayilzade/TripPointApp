"""Telegram admin notify endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import TELEGRAM_NOTIFY_SECRET
from app.services.telegram_notify import send_telegram_message

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _require_notify_secret(x_notify_secret: str | None) -> None:
    """If TELEGRAM_NOTIFY_SECRET is set, require matching X-Notify-Secret header."""
    expected = TELEGRAM_NOTIFY_SECRET
    if not expected:
        return
    if (x_notify_secret or "").strip() != expected:
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
    """Admin notify hook (e.g. listing cancel/report from clients later)."""
    _require_notify_secret(x_notify_secret)
    ok = send_telegram_message(body.text)
    return {"ok": ok, "sent": ok}
