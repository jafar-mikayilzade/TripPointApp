"""Mock POI data source."""

from __future__ import annotations

from typing import Any

from app.constants.categories import APP_CATEGORIES, MOCK_CATEGORY_ALIAS
from app.constants.regions import MOCK_REGION_ALIAS
from app.data.mock_places import MOCK_PLACES


def fetch_places_from_mock(region: str, category: str) -> list[dict[str, Any]]:
    mock_key = MOCK_REGION_ALIAS.get(region, region)
    region_data = MOCK_PLACES.get(mock_key, {})

    if category == "all":
        merged: list[dict[str, Any]] = []
        for bucket in ("restaurant", "hotel", "tourist_attraction"):
            for place in region_data.get(bucket, []):
                item = dict(place)
                item["category"] = (
                    "restaurant"
                    if bucket == "restaurant"
                    else "hotel"
                    if bucket == "hotel"
                    else "historical"
                )
                merged.append(item)
        return merged

    bucket = MOCK_CATEGORY_ALIAS.get(category, category)
    stamp = category if category in APP_CATEGORIES else "other"
    return [{**place, "category": stamp} for place in region_data.get(bucket, [])]
