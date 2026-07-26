"""Simple in-memory IP rate limiter (no Redis)."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# path prefix → max requests per window
_DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "/api/plan-route": (5, 60),
    "/api/live-places": (30, 60),
    "/api/sync-places": (10, 60),
    "/api/pois/upsert-google-place": (20, 60),
}


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _limits() -> dict[str, tuple[int, int]]:
    return {
        "/api/plan-route": (
            _env_int("RATE_LIMIT_PLAN_ROUTE", _DEFAULT_LIMITS["/api/plan-route"][0]),
            60,
        ),
        "/api/live-places": (
            _env_int("RATE_LIMIT_LIVE_PLACES", _DEFAULT_LIMITS["/api/live-places"][0]),
            60,
        ),
        "/api/sync-places": (
            _env_int("RATE_LIMIT_SYNC_PLACES", _DEFAULT_LIMITS["/api/sync-places"][0]),
            60,
        ),
        "/api/pois/upsert-google-place": (
            _env_int(
                "RATE_LIMIT_UPSERT_PLACE",
                _DEFAULT_LIMITS["/api/pois/upsert-google-place"][0],
            ),
            60,
        ),
    }


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Callable):
        super().__init__(app)
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
        return "unknown"

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        match: tuple[int, int] | None = None
        for prefix, lim in _limits().items():
            if path == prefix or path.startswith(prefix + "?"):
                match = lim
                break
            if path.startswith(prefix) and prefix != "/":
                # exact path match preferred
                if path == prefix:
                    match = lim
                    break
        # Only exact known paths
        if path in _limits():
            match = _limits()[path]

        if match is None:
            return await call_next(request)

        max_req, window = match
        ip = self._client_ip(request)
        key = f"{ip}:{path}"
        now = time.time()

        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= max_req:
                return JSONResponse(
                    status_code=429,
                    content={
                        "success": False,
                        "error": "rate_limited",
                        "message": f"Too many requests. Max {max_req}/{window}s.",
                    },
                )
            q.append(now)

        return await call_next(request)
