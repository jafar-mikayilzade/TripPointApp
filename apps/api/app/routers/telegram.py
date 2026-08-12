"""Telegram admin notify + user bot webhook."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import verify_user
from app.config import CRON_SECRET, TELEGRAM_NOTIFY_SECRET
from app.security import secret_matches
from app.services.telegram_bot import handle_telegram_update
from app.services.telegram_notify import (
    admin_action_keyboard,
    moderation_target_is_open,
    notify_all_admins,
    telegram_api,
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


def _require_webhook_secret(x_telegram_bot_api_secret_token: str | None) -> None:
    """Fail closed when the bot is configured — unsigned webhooks must not moderate."""
    from app.config import TELEGRAM_BOT_TOKEN, resolved_telegram_webhook_secret

    expected = (resolved_telegram_webhook_secret() or "").strip()
    if not expected:
        if TELEGRAM_BOT_TOKEN:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "webhook_secret_unset",
                    "message": (
                        "Set TELEGRAM_WEBHOOK_SECRET (or TELEGRAM_NOTIFY_SECRET/"
                        "CRON_SECRET) and POST /api/telegram/register-webhook."
                    ),
                },
            )
        return
    if not secret_matches(x_telegram_bot_api_secret_token, expected):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


_ALLOWED_USER_NOTIFY_PREFIXES = (
    "🛡 TripPoint · yeni məkan təsdiqi",
    "🛡 TripPoint · yeni şəkil təsdiqi",
    "🛡 TripPoint · elan şikayəti",
)


def _sanitize_user_notify_text(text: str, kind: str | None) -> str:
    """Authenticated clients may only send short, prefixed moderation alerts."""
    cleaned = (text or "").strip()
    if not kind:
        raise HTTPException(
            status_code=400,
            detail={"error": "kind_required", "message": "kind tələb olunur."},
        )
    if len(cleaned) > 500:
        cleaned = cleaned[:500]
    if not any(cleaned.startswith(prefix) for prefix in _ALLOWED_USER_NOTIFY_PREFIXES):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_notify_text",
                "message": "Bildiriş formatı yanlışdır.",
            },
        )
    return cleaned


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


@router.post("/register-webhook")
def telegram_register_webhook(
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, Any]:
    """
    Call Telegram setWebhook with secret_token so callbacks hit this API.
    Requires X-Notify-Secret. Uses PUBLIC_API_URL or RAILWAY_PUBLIC_DOMAIN.
    """
    _require_notify_secret(x_notify_secret)
    from app.config import (
        TELEGRAM_BOT_TOKEN,
        resolved_public_api_base_url,
        resolved_telegram_webhook_secret,
    )

    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "bot_token_unset",
                "message": "Set TELEGRAM_BOT_TOKEN on the server.",
            },
        )
    secret = (resolved_telegram_webhook_secret() or "").strip()
    if not secret:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "webhook_secret_unset",
                "message": (
                    "Set TELEGRAM_WEBHOOK_SECRET (or TELEGRAM_NOTIFY_SECRET/"
                    "CRON_SECRET)."
                ),
            },
        )
    base = resolved_public_api_base_url()
    if not base:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "public_api_url_unset",
                "message": (
                    "Set PUBLIC_API_URL=https://your-api.up.railway.app "
                    "(or ensure RAILWAY_PUBLIC_DOMAIN is set)."
                ),
            },
        )

    webhook_url = f"{base}/api/telegram/webhook"
    result = telegram_api(
        "setWebhook",
        {
            "url": webhook_url,
            "secret_token": secret,
            "allowed_updates": ["message", "callback_query"],
            "drop_pending_updates": False,
        },
    )
    if not result:
        raise HTTPException(
            status_code=502,
            detail={
                "error": "set_webhook_failed",
                "message": (
                    "Telegram setWebhook failed — check bot token and that "
                    "secret_token only uses A-Z a-z 0-9 _ - (1–256 chars)."
                ),
                "url": webhook_url,
            },
        )
    return {"ok": True, "url": webhook_url, "telegram": result}


@router.post("/notify")
def telegram_notify(
    body: NotifyBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, object]:
    """Admin notify hook — bütün bağlı adminlərə + TELEGRAM_CHAT_ID."""
    server = _has_server_secret(x_notify_secret)
    if not server:
        if not verify_user(authorization):
            raise HTTPException(status_code=401, detail={"error": "unauthorized"})
        text = _sanitize_user_notify_text(body.text, body.kind)
    else:
        text = body.text

    markup = None
    if (
        body.kind
        and body.target_id
        and moderation_target_is_open(body.kind, body.target_id)
    ):
        markup = admin_action_keyboard(body.kind, body.target_id)
    result = notify_all_admins(text, reply_markup=markup)
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
