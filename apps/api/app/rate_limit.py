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

# Counters for IPs idle longer than this are dropped during periodic sweeps
_EVICT_AFTER_SECONDS = 600
_EVICT_EVERY_SECONDS = 300

# path prefix → max requests per window
_DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "/api/plan-route": (5, 60),
    "/api/live-places": (30, 60),
    "/api/sync-places": (10, 60),
    "/api/import-serpapi-hotels": (5, 60),
    "/api/pois/upsert-google-place": (20, 60),
    "/api/pois/photos/pending": (20, 60),
    "/api/ratings/upsert": (40, 60),
    # Paid third-party quota (Google Places / OpenWeather) — generous but capped
    "/api/route-candidates": (60, 60),
    "/api/weather": (60, 60),
    # Fan-out to admin chats / push — cap so one client cannot spam them
    "/api/telegram/notify": (10, 60),
    "/api/telegram/webhook": (120, 60),
    "/api/notify/dispatch": (30, 60),
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
        "/api/import-serpapi-hotels": (
            _env_int(
                "RATE_LIMIT_IMPORT_SERPAPI",
                _DEFAULT_LIMITS["/api/import-serpapi-hotels"][0],
            ),
            60,
        ),
        "/api/pois/upsert-google-place": (
            _env_int(
                "RATE_LIMIT_UPSERT_PLACE",
                _DEFAULT_LIMITS["/api/pois/upsert-google-place"][0],
            ),
            60,
        ),
        "/api/pois/photos/pending": (
            _env_int(
                "RATE_LIMIT_POI_PHOTOS_PENDING",
                _DEFAULT_LIMITS["/api/pois/photos/pending"][0],
            ),
            60,
        ),
        "/api/ratings/upsert": (
            _env_int(
                "RATE_LIMIT_RATINGS_UPSERT",
                _DEFAULT_LIMITS["/api/ratings/upsert"][0],
            ),
            60,
        ),
        "/api/route-candidates": (
            _env_int(
                "RATE_LIMIT_ROUTE_CANDIDATES",
                _DEFAULT_LIMITS["/api/route-candidates"][0],
            ),
            60,
        ),
        "/api/weather": (
            _env_int("RATE_LIMIT_WEATHER", _DEFAULT_LIMITS["/api/weather"][0]),
            60,
        ),
        "/api/telegram/notify": (
            _env_int(
                "RATE_LIMIT_TELEGRAM_NOTIFY",
                _DEFAULT_LIMITS["/api/telegram/notify"][0],
            ),
            60,
        ),
        "/api/telegram/webhook": (
            _env_int(
                "RATE_LIMIT_TELEGRAM_WEBHOOK",
                _DEFAULT_LIMITS["/api/telegram/webhook"][0],
            ),
            60,
        ),
        "/api/notify/dispatch": (
            _env_int(
                "RATE_LIMIT_NOTIFY_DISPATCH",
                _DEFAULT_LIMITS["/api/notify/dispatch"][0],
            ),
            60,
        ),
    }


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Callable):
        super().__init__(app)
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._last_evict = time.time()

    def _client_ip(self, request: Request) -> str:
        # Prefer platform-injected client IP. Do not trust the first
        # X-Forwarded-For hop from an untrusted client (spoof resets buckets).
        real_ip = (request.headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            # Railway / typical reverse proxies append the real client as the
            # left-most value when they control the header; when clients can
            # inject XFF, prefer the right-most hop (closest to our edge).
            if parts:
                return parts[-1]
        if request.client:
            return request.client.host
        return "unknown"

    def _evict_stale(self, now: float) -> None:
        """Drop counters for IPs that went quiet — keeps memory bounded."""
        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or now - hits[-1] > _EVICT_AFTER_SECONDS
        ]
        for key in stale:
            self._hits.pop(key, None)
        self._last_evict = now

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        match = _limits().get(path)
        if match is None:
            return await call_next(request)

        max_req, window = match
        ip = self._client_ip(request)
        key = f"{ip}:{path}"
        now = time.time()

        with self._lock:
            if now - self._last_evict > _EVICT_EVERY_SECONDS:
                self._evict_stale(now)
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
