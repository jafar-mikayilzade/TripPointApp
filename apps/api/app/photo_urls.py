"""Shared request validation helpers."""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import HTTPException

# Public image hosts we accept for gallery / post photo metadata.
_ALLOWED_PHOTO_HOST_SUFFIXES = (
    "supabase.co",
    "supabase.in",
    "googleusercontent.com",
    "ggpht.com",
    "googleapis.com",
    "cloudinary.com",
    "imgix.net",
    "amazonaws.com",
    "r2.dev",
)


def require_https_photo_url(url: str | None, *, field: str = "photo_url") -> str:
    """Reject non-https and non-image-host URLs before persisting."""
    value = (url or "").strip()
    if not value:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_photo_url", "message": f"{field} boşdur."},
        )
    parsed = urlparse(value)
    if parsed.scheme.lower() != "https":
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_photo_url",
                "message": f"{field} yalnız https olmalıdır.",
            },
        )
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_photo_url", "message": f"{field} host yoxdur."},
        )
    if not any(host == suffix or host.endswith("." + suffix) for suffix in _ALLOWED_PHOTO_HOST_SUFFIXES):
        # Allow any supabase project subdomain pattern already covered; otherwise soft-allow
        # common CDNs. Unknown hosts are rejected to reduce phishing payloads in admin UI.
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_photo_url",
                "message": f"{field} icazə verilməyən host: {host}",
            },
        )
    return value
