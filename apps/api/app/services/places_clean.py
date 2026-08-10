"""Map raw places → Supabase `pois` row shape."""

from __future__ import annotations

from typing import Any

from app.constants.categories import APP_CATEGORIES
from app.constants.regions import REGION_DB_ID
from app.services.places_tourism_filter import (
    name_has_forbidden_script,
    name_is_blacklisted,
)


def to_db_region(region: str) -> str:
    key = region.strip().lower()
    return REGION_DB_ID.get(key, key)


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
    if tourism in {"camp_site", "caravan_site"}:
        return "camping"
    if waterway == "waterfall":
        return "waterfall"
    if natural in {"peak", "ridge", "volcano"}:
        return "mountain"
    if natural == "water" or water in {"lake", "reservoir", "pond"}:
        return "lake"
    if str(tags.get("boundary") or "").lower() == "national_park":
        return "nature"
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


# Temporarily drop cafes from sync (low tourism signal in regional OSM data)
IGNORED_SYNC_CATEGORIES = frozenset({"cafe"})


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

    name_s = str(name).strip()
    # Reject Russian / Arabic-Persian / blacklisted / garbled labels
    if name_is_blacklisted(name_s) or name_has_forbidden_script(name_s):
        return None
    letters = [ch for ch in name_s if ch.isalpha()]
    if letters:
        cyr = sum(1 for ch in letters if "\u0400" <= ch <= "\u04FF")
        if cyr > 0 and (cyr / len(letters)) >= 0.15:
            return None
    # Reject names that are mostly punctuation/digits or single-token junk
    if len(name_s) < 2 or name_s.isdigit():
        return None

    db_category = resolve_db_category(place, category)
    if db_category in IGNORED_SYNC_CATEGORIES or str(category).strip().lower() in IGNORED_SYNC_CATEGORIES:
        return None

    # Google Nearby Search returns rating + user_ratings_total.
    # OSM almost never has comparable star ratings → keep NULL (never invent).
    rating: float | None = None
    raw_rating = place.get("rating")
    if raw_rating is not None:
        try:
            value = float(raw_rating)
            if 0 < value <= 5:
                rating = round(value, 2)
        except (TypeError, ValueError):
            rating = None

    rating_count: int | None = None
    raw_count = place.get("user_ratings_total")
    if raw_count is None:
        raw_count = place.get("rating_count")
    if raw_count is not None:
        try:
            count = int(raw_count)
            if count >= 0:
                rating_count = count
        except (TypeError, ValueError):
            rating_count = None

    row: dict[str, Any] = {
        "name": name_s,
        "category": db_category,
        "status": "approved",
        "region": to_db_region(region),
        "lat": float(latitude),
        "lng": float(longitude),
        "place_id": str(place_id),
        "rating": rating,
        "rating_count": rating_count,
    }

    description = place.get("description")
    if description:
        text = str(description).strip()
        # Never persist Cyrillic (RU) blurbs — app is Azerbaijani-only for copy.
        if text and not any("\u0400" <= ch <= "\u04FF" for ch in text):
            row["description"] = text
    address = place.get("vicinity") or place.get("address")
    if address:
        row["address"] = str(address)
    phone = place.get("phone")
    if phone:
        row["phone"] = str(phone)
    website = place.get("website")
    if website:
        row["website"] = str(website)

    # Lodging extras (SerpAPI Google Hotels / similar)
    if place.get("price_from") is not None:
        try:
            row["price_from"] = round(float(place["price_from"]), 2)
        except (TypeError, ValueError):
            pass
    if place.get("price_currency"):
        row["price_currency"] = str(place["price_currency"]).strip().upper()[:8]
    if place.get("hotel_class") is not None:
        try:
            stars = int(place["hotel_class"])
            if 1 <= stars <= 5:
                row["hotel_class"] = stars
        except (TypeError, ValueError):
            pass
    amenities = place.get("amenities")
    if isinstance(amenities, list):
        row["amenities"] = [str(a) for a in amenities if a][:40]
    if place.get("check_in_time"):
        row["check_in_time"] = str(place["check_in_time"])[:40]
    if place.get("check_out_time"):
        row["check_out_time"] = str(place["check_out_time"])[:40]
    if place.get("data_source"):
        row["data_source"] = str(place["data_source"])[:32]
    if place.get("thumbnail_url"):
        row["thumbnail_url"] = str(place["thumbnail_url"])[:2000]

    # Gallery URLs (DB column photo_urls if present; also used for poi_photos sync)
    gallery: list[str] = []
    raw_photos = place.get("photo_urls")
    if isinstance(raw_photos, list):
        for item in raw_photos:
            url = None
            if isinstance(item, str):
                url = item.strip()
            elif isinstance(item, dict):
                url = str(
                    item.get("url")
                    or item.get("original_image")
                    or item.get("thumbnail")
                    or ""
                ).strip()
            if url and url.startswith("http") and url not in gallery:
                gallery.append(url[:2000])
            if len(gallery) >= 12:
                break
    thumb = row.get("thumbnail_url")
    if isinstance(thumb, str) and thumb.startswith("http") and thumb not in gallery:
        gallery.insert(0, thumb)
    if gallery:
        row["photo_urls"] = gallery[:12]

    cuisine = place.get("cuisine")
    if cuisine:
        row["cuisine"] = str(cuisine).strip()[:120]

    external = place.get("external_url") or place.get("link")
    if external and not row.get("website"):
        row["website"] = str(external).strip()[:2000]
    if external:
        row["external_url"] = str(external).strip()[:2000]

    return row
