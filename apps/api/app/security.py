"""Shared header-secret checks."""

from __future__ import annotations

from hmac import compare_digest


def secret_matches(provided: str | None, expected: str) -> bool:
    """Constant-time compare so a wrong header cannot be guessed byte by byte."""
    return compare_digest((provided or "").strip(), expected)
