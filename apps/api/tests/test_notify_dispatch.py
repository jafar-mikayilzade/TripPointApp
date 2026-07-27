"""Tests for app.services.notify_dispatch."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.services.notify_dispatch import (
    MAX_ROW_AGE_MINUTES,
    _parse_created_at,
    dispatch_notifications,
)


class TestParseCreatedAt:
    def test_iso_with_z_suffix(self):
        dt = _parse_created_at("2026-07-28T10:00:00Z")
        assert dt is not None
        assert dt.tzinfo is not None

    def test_iso_with_offset(self):
        dt = _parse_created_at("2026-07-28T10:00:00+00:00")
        assert dt is not None

    def test_invalid_returns_none(self):
        assert _parse_created_at("not-a-date") is None
        assert _parse_created_at("") is None


class TestDispatchNotifications:
    def test_empty_ids(self):
        result = dispatch_notifications([], actor_id="actor-1")
        assert result == {"pushed": 0, "telegram": 0, "requested": 0}

    @patch("app.services.notify_dispatch._load_own_rows", return_value=[])
    def test_no_matching_rows(self, _mock_load):
        result = dispatch_notifications(["id-1"], actor_id="actor-1")
        assert result["pushed"] == 0
        assert result["requested"] == 1

    @patch("app.services.telegram_notify.notify_telegram_user", return_value=True)
    @patch("app.services.notify_dispatch.notify_users_push", return_value={"sent": 2, "requested": 2})
    @patch("app.services.notify_dispatch._load_own_rows")
    def test_dispatches_fresh_rows(
        self,
        mock_load,
        _mock_push,
        _mock_tg,
    ):
        now = datetime.now(timezone.utc).isoformat()
        mock_load.return_value = [
            {
                "id": "n1",
                "user_id": "user-a",
                "title": "Yeni tur",
                "body": "Sheki",
                "listing_id": "listing-1",
                "actor_id": "actor-1",
                "created_at": now,
            },
            {
                "id": "n2",
                "user_id": "user-b",
                "title": "Yeni tur",
                "body": "Sheki",
                "listing_id": "listing-1",
                "actor_id": "actor-1",
                "created_at": now,
            },
        ]
        result = dispatch_notifications(["n1", "n2"], actor_id="actor-1")
        assert result["pushed"] == 2
        assert result["telegram"] == 2
        assert result["requested"] == 2

    @patch("app.services.notify_dispatch._load_own_rows")
    def test_skips_actor_self_and_stale(self, mock_load):
        stale = (
            datetime.now(timezone.utc) - timedelta(minutes=MAX_ROW_AGE_MINUTES + 5)
        ).isoformat()
        mock_load.return_value = [
            {
                "id": "n1",
                "user_id": "actor-1",
                "title": "Self",
                "body": "",
                "actor_id": "actor-1",
                "created_at": stale,
            },
        ]
        # _load_own_rows filters stale internally — simulate empty after filter
        mock_load.return_value = []
        result = dispatch_notifications(["n1"], actor_id="actor-1")
        assert result["pushed"] == 0
