"""Supabase user authentication for endpoints called by the mobile app.

The app must never ship a shared server secret in its bundle, so client-facing
endpoints authenticate the caller's Supabase session token instead.
"""

from __future__ import annotations

import logging
import time
from threading import Lock

import requests

from app.config import SUPABASE_SERVICE_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)

_VERIFY_TIMEOUT_SECONDS = 8
# Tokens are short-lived anyway; a small cache avoids one round trip per notify.
_CACHE_TTL_SECONDS = 120
_CACHE_MAX = 500

_cache: dict[str, tuple[float, str]] = {}
_cache_lock = Lock()


def _cache_get(token: str) -> str | None:
    with _cache_lock:
        hit = _cache.get(token)
        if not hit:
            return None
        expires_at, user_id = hit
        if time.time() > expires_at:
            _cache.pop(token, None)
            return None
        return user_id


def _cache_set(token: str, user_id: str) -> None:
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.pop(next(iter(_cache)), None)
        _cache[token] = (time.time() + _CACHE_TTL_SECONDS, user_id)


def bearer_token(authorization: str | None) -> str | None:
    """Extract the raw token from an `Authorization: Bearer <token>` header."""
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def verify_user(authorization: str | None) -> str | None:
    """Return the Supabase user id for a valid session token, else None."""
    token = bearer_token(authorization)
    if not token or not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None

    cached = _cache_get(token)
    if cached:
        return cached

    try:
        res = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": SUPABASE_SERVICE_KEY,
            },
            timeout=_VERIFY_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.exception("Supabase token verification failed")
        return None

    if not res.ok:
        return None

    try:
        user_id = str((res.json() or {}).get("id") or "").strip()
    except Exception:
        return None

    if not user_id:
        return None

    _cache_set(token, user_id)
    return user_id


def verify_admin(authorization: str | None) -> str | None:
    """Return user id when the caller is authenticated and profiles.role = admin."""
    user_id = verify_user(authorization)
    if not user_id or not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None

    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{user_id}", "select": "role", "limit": "1"},
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "apikey": SUPABASE_SERVICE_KEY,
            },
            timeout=_VERIFY_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.exception("Admin role lookup failed")
        return None

    if not res.ok:
        return None

    try:
        rows = res.json() or []
    except Exception:
        return None

    if not rows:
        return None
    if str(rows[0].get("role") or "").strip().lower() != "admin":
        return None
    return user_id
