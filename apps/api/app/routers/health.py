"""Health / root endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import DATA_SOURCE

router = APIRouter(tags=["health"])


@router.get("/")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "TripPoint Backend",
        "data_source": DATA_SOURCE,
    }
