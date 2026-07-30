"""Health / root endpoint."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/")
def health_check() -> dict[str, str]:
    # Keep the public probe free of internal configuration details.
    return {
        "status": "ok",
        "service": "TripPoint Backend",
    }
