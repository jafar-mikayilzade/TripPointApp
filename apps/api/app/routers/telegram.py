"""Telegram admin notify + user bot webhook."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import verify_user
from app.config import CRON_SECRET, TELEGRAM_NOTIFY_SECRET, TELEGRAM_WEBHOOK_SECRET
from app.security import secret_matches
from app.services.telegram_bot import handle_telegram_update
from app.services.telegram_notify import (
    admin_action_keyboard,
    notify_all_admins,
)

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _has_server_secret(x_notify_secret: str | None) -> bool:
    expected = (TELEGRAM_NOTIFY_SECRET or CRON_SECRET or "").strip()
    return bool(expected) and secret_matches(x_notify_secret, expected)


def _require_notify_secret(x_notify_secret: str | None) -> None:
    """Server-only route: fail closed when no secret is configured."""
    expected = (TELEGRAM_NOTIFY_SECRET or CRON_SECRET or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "notify_secret_unset",
                "message": "Set TELEGRAM_NOTIFY_SECRET on the server.",
            },
        )
    if not secret_matches(x_notify_secret, expected):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


def _require_user_or_secret(
    authorization: str | None,
    x_notify_secret: str | None,
) -> None:
    """App users authenticate with their Supabase session; servers with a secret."""
    if _has_server_secret(x_notify_secret):
        return
    if verify_user(authorization):
        return
    raise HTTPException(status_code=401, detail={"error": "unauthorized"})


def _require_webhook_secret(x_telegram_bot_api_secret_token: str | None) -> None:
    expected = TELEGRAM_WEBHOOK_SECRET
    if not expected:
        return
    if not secret_matches(x_telegram_bot_api_secret_token, expected):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


class NotifyBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    kind: Literal["poi_pending", "photo_pending", "listing_report"] | None = None
    target_id: str | None = Field(default=None, max_length=64)


class NotifyUserBody(BaseModel):
    user_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1, max_length=4000)


class NotifyUsersBody(BaseModel):
    user_ids: list[str] = Field(default_factory=list)
    text: str = Field(..., min_length=1, max_length=4000)


@router.post("/test")
def telegram_test(
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    _require_notify_secret(x_notify_secret)
    result = notify_all_admins("TripPoint Telegram OK")
    return {"ok": result["sent"] > 0, **result}


@router.post("/notify")
def telegram_notify(
    body: NotifyBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    """Admin notify hook — bütün bağlı adminlərə + TELEGRAM_CHAT_ID."""
    _require_user_or_secret(authorization, x_notify_secret)
    markup = None
    if body.kind and body.target_id:
        markup = admin_action_keyboard(body.kind, body.target_id)
    result = notify_all_admins(body.text, reply_markup=markup)
    return {"ok": result["sent"] > 0, **result}


@router.post("/notify-user")
def telegram_notify_user(
    body: NotifyUserBody,
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    """Mirror app notification to a linked Telegram user (not admin chat)."""
    _require_notify_secret(x_notify_secret)
    from app.services.telegram_notify import notify_telegram_user

    ok = notify_telegram_user(body.user_id, body.text)
    return {"ok": ok, "sent": ok}


@router.post("/notify-users")
def telegram_notify_users(
    body: NotifyUsersBody,
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    """Batch mirror to linked users. Skips users without Telegram."""
    _require_notify_secret(x_notify_secret)
    from app.services.telegram_notify import notify_telegram_user

    sent = 0
    for uid in body.user_ids:
        if uid and notify_telegram_user(uid, body.text):
            sent += 1
    return {"ok": True, "sent": sent, "requested": len(body.user_ids)}


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
