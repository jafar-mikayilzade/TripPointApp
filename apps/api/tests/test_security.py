"""Tests for app.security."""

from __future__ import annotations

from app.security import secret_matches


def test_secret_matches_exact():
    assert secret_matches("my-secret", "my-secret") is True


def test_secret_matches_strips_whitespace_on_provided():
    assert secret_matches("  my-secret  ", "my-secret") is True


def test_secret_matches_does_not_strip_expected():
    """Only the provided header value is stripped — expected is server config."""
    assert secret_matches("my-secret", "  my-secret  ") is False


def test_secret_matches_rejects_wrong():
    assert secret_matches("wrong", "expected") is False


def test_secret_matches_rejects_none_and_empty():
    assert secret_matches(None, "expected") is False
    assert secret_matches("", "expected") is False
    assert secret_matches("   ", "expected") is False


def test_secret_matches_rejects_prefix():
    """Wrong length must not pass via naive string compare."""
    assert secret_matches("expected-extra", "expected") is False
