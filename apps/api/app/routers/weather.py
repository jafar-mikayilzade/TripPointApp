"""Weather forecast for AI route planning (cached on service layer)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.services.weather import fetch_region_weather

router = APIRouter(tags=["weather"])


@router.get("/api/weather")
def weather_endpoint(
    region: str = Query(..., description="Tourism region key, e.g. quba"),
    days: int = Query(3, ge=1, le=5, description="Trip length in days"),
    start_day: int = Query(
        0,
        ge=0,
        le=4,
        description="0=today, 1=tomorrow — first day of the trip in forecast",
    ),
) -> dict:
    return fetch_region_weather(region, days, start_offset=start_day)
