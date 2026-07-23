"""Google Places Nearby Search data source."""

from __future__ import annotations

from typing import Any

import requests

from app.config import GOOGLE_PLACES_API_KEY, SEARCH_RADIUS_METERS
from app.constants.categories import APP_CATEGORIES, GOOGLE_TYPE_MAP

GOOGLE_NEARBY_SEARCH_URL = (
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
)


def fetch_places_from_google(
    latitude: float,
    longitude: float,
    category: str,
    *,
    radius_meters: int | None = None,
    timeout_seconds: float = 30,
) -> list[dict[str, Any]]:
    google_type = GOOGLE_TYPE_MAP.get(category, "tourist_attraction")
    params = {
        "location": f"{latitude},{longitude}",
        "radius": int(radius_meters or SEARCH_RADIUS_METERS),
        "type": google_type,
        # Prefer Azerbaijani (Latin) names; EN is Google's implicit fallback.
        "language": "az",
        "key": GOOGLE_PLACES_API_KEY,
    }

    response = requests.get(
        GOOGLE_NEARBY_SEARCH_URL,
        params=params,
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()

    status = payload.get("status")
    if status not in {"OK", "ZERO_RESULTS"}:
        error_message = payload.get("error_message") or status
        raise RuntimeError(f"Google Places API error: {error_message}")

    results = payload.get("results") or []
    stamp = category if category in APP_CATEGORIES else "other"
    for item in results:
        item.setdefault("category", stamp)
    return results
