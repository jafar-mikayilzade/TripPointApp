"""Push notify endpoint (called from mobile after in-app notifications)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import CRON_SECRET, TELEGRAM_NOTIFY_SECRET
from app.services.push_notify import notify_users_push

router = APIRouter(prefix="/api/notify", tags=["notify"])


def _optional_secret(x_notify_secret: str | None) -> None:
    """If a secret is configured, require it; otherwise allow (dev)."""
    expected = (TELEGRAM_NOTIFY_SECRET or CRON_SECRET or "").strip()
    if not expected:
        return
    if (x_notify_secret or "").strip() != expected:
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


class PushBody(BaseModel):
    user_ids: list[str] = Field(default_factory=list)
    title: str = Field(..., min_length=1, max_length=120)
    body: str = Field(default="", max_length=500)
    data: dict[str, Any] | None = None


@router.post("/push")
def api_notify_push(
    body: PushBody,
    x_notify_secret: str | None = Header(default=None, alias="X-Notify-Secret"),
) -> dict[str, Any]:
    _optional_secret(x_notify_secret)
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
