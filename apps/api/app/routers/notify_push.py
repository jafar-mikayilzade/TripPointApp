"""Push notification endpoints.

`/dispatch` is the app-facing route: it authenticates the caller's Supabase
session and mirrors only that caller's own notification rows, so the mobile
bundle never has to carry a server secret.

`/push` stays secret-protected for server-side/admin use (curl, cron, tooling).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import verify_user
from app.config import CRON_SECRET, TELEGRAM_NOTIFY_SECRET
from app.security import secret_matches
from app.services.notify_dispatch import (
    MAX_ROWS_PER_DISPATCH,
    dispatch_notifications,
)
from app.services.push_notify import notify_users_push

router = APIRouter(prefix="/api/notify", tags=["notify"])


def _require_server_secret(x_notify_secret: str | None) -> None:
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


class PushBody(BaseModel):
    user_ids: list[str] = Field(default_factory=list)
    title: str = Field(..., min_length=1, max_length=120)
    body: str = Field(default="", max_length=500)
    data: dict[str, Any] | None = None


class DispatchBody(BaseModel):
    notification_ids: list[str] = Field(
        default_factory=list, max_length=MAX_ROWS_PER_DISPATCH
    )


@router.post("/dispatch")
def api_notify_dispatch(
    body: DispatchBody,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, Any]:
    """Mirror the caller's own fresh notification rows to push + Telegram."""
    actor_id = verify_user(authorization)
    if not actor_id:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})
    result = dispatch_notifications(body.notification_ids, actor_id=actor_id)
    return {"ok": True, **result}


@router.post("/push")
def api_notify_push(
    body: PushBody,
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, Any]:
    _require_server_secret(x_notify_secret)
    ids = [str(u).strip() for u in body.user_ids if str(u).strip()]
    if not ids:
        return {"ok": True, "sent": 0, "requested": 0}
    result = notify_users_push(
        ids[:100],
        title=body.title,
        body=body.body or body.title,
        data=body.data,
    )
    return {"ok": True, **result}
