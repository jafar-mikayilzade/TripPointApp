"""FastAPI route smoke tests (auth boundaries, health)."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.factory import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


class TestHealth:
    def test_root_ok(self, client: TestClient):
        res = client.get("/")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["service"] == "TripPoint Backend"


class TestNotifyDispatchAuth:
    def test_dispatch_requires_auth(self, client: TestClient):
        res = client.post(
            "/api/notify/dispatch",
            json={"notification_ids": ["fake-id"]},
        )
        assert res.status_code == 401

    @patch("app.routers.notify_push.verify_user", return_value="user-123")
    @patch(
        "app.routers.notify_push.dispatch_notifications",
        return_value={"pushed": 0, "telegram": 0, "requested": 1},
    )
    def test_dispatch_with_valid_session(
        self,
        _mock_dispatch,
        _mock_verify,
        client: TestClient,
    ):
        res = client.post(
            "/api/notify/dispatch",
            json={"notification_ids": ["n1"]},
            headers={"Authorization": "Bearer good-token"},
        )
        assert res.status_code == 200
        assert res.json()["ok"] is True


class TestServiceRoleWriteAuth:
    """Endpoints that write with the service role must reject anonymous calls."""

    def test_upsert_google_place_requires_session(self, client: TestClient):
        res = client.post(
            "/api/pois/upsert-google-place",
            json={
                "place_id": "ChIJtest12345",
                "name": "Test",
                "lat": 41.0,
                "lng": 48.0,
            },
        )
        assert res.status_code == 401

    def test_sync_places_requires_session_or_cron(self, client: TestClient):
        res = client.get("/api/sync-places?region=quba&category=all")
        assert res.status_code == 401

    def test_plan_route_requires_session(self, client: TestClient):
        res = client.post(
            "/api/plan-route",
            json={"region": "quba", "days": 1, "budget": "mid", "interests": []},
        )
        assert res.status_code == 401


class TestJobsAuth:
    def test_nightly_requires_cron_secret(self, client: TestClient, monkeypatch):
        monkeypatch.setattr("app.routers.jobs.CRON_SECRET", None)
        res = client.post("/api/jobs/nightly")
        assert res.status_code == 503

    def test_nightly_rejects_wrong_secret(self, client: TestClient, monkeypatch):
        monkeypatch.setattr("app.routers.jobs.CRON_SECRET", "correct-secret")
        res = client.post(
            "/api/jobs/nightly",
            headers={"X-Cron-Secret": "wrong-secret"},
        )
        assert res.status_code == 401


class TestTelegramNotifyAuth:
    def test_notify_rejects_anonymous_without_secret(self, client: TestClient):
        res = client.post(
            "/api/telegram/notify",
            json={"text": "hello", "kind": "poi_pending"},
        )
        assert res.status_code == 401

    @patch("app.routers.telegram.notify_all_admins", return_value={"sent": 1})
    @patch("app.routers.telegram.verify_user", return_value="admin-user")
    def test_notify_accepts_session(
        self,
        _mock_user,
        _mock_notify,
        client: TestClient,
    ):
        res = client.post(
            "/api/telegram/notify",
            json={"text": "Pending POI", "kind": "poi_pending", "target_id": "p1"},
            headers={"Authorization": "Bearer session-token"},
        )
        assert res.status_code == 200
        assert res.json()["ok"] is True

    @patch("app.routers.telegram.notify_all_admins", return_value={"sent": 1})
    def test_notify_accepts_server_secret(
        self,
        _mock_notify,
        client: TestClient,
        monkeypatch,
    ):
        monkeypatch.setattr("app.routers.telegram.TELEGRAM_NOTIFY_SECRET", "server-secret")
        monkeypatch.setattr("app.routers.telegram.CRON_SECRET", None)
        res = client.post(
            "/api/telegram/notify",
            json={"text": "From cron tool"},
            headers={"X-Notify-Secret": "server-secret"},
        )
        assert res.status_code == 200
