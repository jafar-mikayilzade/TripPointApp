"""Tests for app.auth."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import auth as auth_mod
from app.auth import bearer_token, verify_user


@pytest.fixture(autouse=True)
def clear_auth_cache():
    auth_mod._cache.clear()
    yield
    auth_mod._cache.clear()


class TestBearerToken:
    def test_valid_bearer(self):
        assert bearer_token("Bearer abc123") == "abc123"

    def test_bearer_case_insensitive_scheme(self):
        assert bearer_token("bearer token-here") == "token-here"

    def test_missing_header(self):
        assert bearer_token(None) is None

    def test_wrong_scheme(self):
        assert bearer_token("Basic abc") is None

    def test_empty_token(self):
        assert bearer_token("Bearer ") is None


class TestVerifyUser:
    @patch("app.auth.requests.get")
    def test_valid_token_returns_user_id(self, mock_get: MagicMock):
        mock_get.return_value = MagicMock(
            ok=True,
            json=lambda: {"id": "user-uuid-123"},
        )
        uid = verify_user("Bearer good-token")
        assert uid == "user-uuid-123"
        mock_get.assert_called_once()

    @patch("app.auth.requests.get")
    def test_invalid_token_returns_none(self, mock_get: MagicMock):
        mock_get.return_value = MagicMock(ok=False)
        assert verify_user("Bearer bad-token") is None

    def test_missing_authorization_returns_none(self):
        assert verify_user(None) is None

    @patch("app.auth.requests.get")
    def test_uses_cache_on_second_call(self, mock_get: MagicMock):
        mock_get.return_value = MagicMock(
            ok=True,
            json=lambda: {"id": "cached-user"},
        )
        assert verify_user("Bearer cached-token") == "cached-user"
        assert verify_user("Bearer cached-token") == "cached-user"
        mock_get.assert_called_once()

    @patch("app.auth.requests.get", side_effect=OSError("network down"))
    def test_network_error_returns_none(self, _mock_get: MagicMock):
        assert verify_user("Bearer token") is None
