"""Tests for app.rate_limit."""

from __future__ import annotations

import time

from app.rate_limit import RateLimitMiddleware, _env_int, _limits


class TestEnvInt:
    def test_default_when_unset(self, monkeypatch):
        monkeypatch.delenv("RATE_LIMIT_PLAN_ROUTE", raising=False)
        assert _env_int("RATE_LIMIT_PLAN_ROUTE", 5) == 5

    def test_reads_valid_int(self, monkeypatch):
        monkeypatch.setenv("RATE_LIMIT_PLAN_ROUTE", "10")
        assert _env_int("RATE_LIMIT_PLAN_ROUTE", 5) == 10

    def test_invalid_falls_back(self, monkeypatch):
        monkeypatch.setenv("RATE_LIMIT_PLAN_ROUTE", "not-a-number")
        assert _env_int("RATE_LIMIT_PLAN_ROUTE", 5) == 5

    def test_zero_clamped_to_one(self, monkeypatch):
        monkeypatch.setenv("RATE_LIMIT_PLAN_ROUTE", "0")
        assert _env_int("RATE_LIMIT_PLAN_ROUTE", 5) == 1


class TestLimitsRegistry:
    def test_rate_limited_paths_registered(self):
        limits = _limits()
        assert "/api/plan-route" in limits
        assert "/api/weather" in limits
        assert "/api/route-candidates" in limits


class TestRateLimitMiddleware:
    def test_evict_stale_drops_old_keys(self):
        mw = RateLimitMiddleware(app=lambda scope, receive, send: None)
        old = time.time() - 700
        mw._hits["1.2.3.4:/api/plan-route"].append(old)
        mw._evict_stale(time.time())
        assert "1.2.3.4:/api/plan-route" not in mw._hits

    def test_evict_keeps_recent_keys(self):
        mw = RateLimitMiddleware(app=lambda scope, receive, send: None)
        now = time.time()
        mw._hits["1.2.3.4:/api/plan-route"].append(now)
        mw._evict_stale(now)
        assert "1.2.3.4:/api/plan-route" in mw._hits
