"""Map raw places → Supabase `pois` row shape."""

from __future__ import annotations

import random
from typing import Any

from app.constants.categories import APP_CATEGORIES
from app.constants.regions import REGION_DB_ID


def to_db_region(region: str) -> str:
    key = region.strip().lower()
    return REGION_DB_ID.get(key, key)


def default_rating() -> float:
    return round(random.uniform(4.1, 4.5), 1)


def category_from_osm_tags(tags: dict[str, Any]) -> str:
    amenity = str(tags.get("amenity") or "").lower()
    tourism = str(tags.get("tourism") or "").lower()
    historic = str(tags.get("historic") or "").lower()
    natural = str(tags.get("natural") or "").lower()
    waterway = str(tags.get("waterway") or "").lower()
    water = str(tags.get("water") or "").lower()
    leisure = str(tags.get("leisure") or "").lower()

    if amenity == "cafe":
        return "cafe"
    if amenity in {"canteen", "biergarten"}:
        return "home_restaurant"
    if amenity in {"restaurant", "fast_food"}:
        return "restaurant"
    if tourism == "hotel":
        return "hotel"
    if tourism == "hostel":
        return "hostel"
    if tourism in {"guest_house", "chalet", "apartment"}:
        return "guesthouse"
    if waterway == "waterfall":
        return "waterfall"
    if natural in {"peak", "ridge", "volcano"}:
        return "mountain"
    if natural == "water" or water in {"lake", "reservoir", "pond"}:
        return "lake"
    if historic in {"monument", "memorial"}:
        return "monument"
    if historic or tourism == "museum":
        return "historical"
    if (
        tourism in {"viewpoint", "attraction", "picnic_site"}
        or leisure in {"nature_reserve", "park"}
        or natural in {"wood", "beach", "scrub", "heath"}
    ):
        return "nature"
    return "other"


def resolve_db_category(place: dict[str, Any], requested: str) -> str:
    place_cat = str(place.get("category") or "").strip().lower()
    req = str(requested or "").strip().lower()

    # Region-wide sync: keep OSM-derived category for every POI
    if req in {"all", "tourist_attraction"}:
        if place_cat in APP_CATEGORIES:
            return place_cat
        return "historical" if req == "tourist_attraction" else "other"

    # Specific filter: store as requested so home chips match
    if req in APP_CATEGORIES:
        return req
    if place_cat in APP_CATEGORIES:
        return place_cat
    return "other"


def clean_place(
    place: dict[str, Any],
    region: str,
    category: str,
) -> dict[str, Any] | None:
    place_id = place.get("place_id")
    name = place.get("name")
    geometry = place.get("geometry") or {}
    location = geometry.get("location") or {}

    latitude = location.get("lat", place.get("latitude", place.get("lat")))
    longitude = location.get("lng", place.get("longitude", place.get("lng")))

    if not place_id or not name or latitude is None or longitude is None:
        return None

    rating = place.get("rating")
    if rating is None:
        rating = default_rating()
    else:
        try:
            rating = float(rating)
        except (TypeError, ValueError):
            rating = default_rating()

    row: dict[str, Any] = {
        "name": str(name).strip(),
        "category": resolve_db_category(place, category),
        "status": "approved",
        "region": to_db_region(region),
        "lat": float(latitude),
        "lng": float(longitude),
        "place_id": str(place_id),
        "rating": rating,
    }

    description = place.get("description")
    if description:
        row["description"] = str(description)
    address = place.get("vicinity") or place.get("address")
    if address:
        row["address"] = str(address)
    phone = place.get("phone")
    if phone:
        row["phone"] = str(phone)
    website = place.get("website")
    if website:
        row["website"] = str(website)

    return row
