"""Hybrid Places fetch: Google for food/lodging, OSM for nature/historic."""

from __future__ import annotations

import math
import re
import time
from typing import Any

from app.config import HYBRID_DEDUPE_METERS, OSM_PER_CATEGORY_LIMIT
from app.constants.categories import (
    HYBRID_GOOGLE_CATEGORIES,
    HYBRID_OSM_CATEGORIES,
    HYBRID_OSM_SYNC_ORDER,
)
from app.services.places_google import fetch_places_from_google
from app.services.places_osm import _fetch_single_category

# "all" sync: one call per Google type (lodging covers hotel/hostel/guesthouse)
_HYBRID_GOOGLE_ALL_ORDER = ("restaurant", "hotel")
# Pause between OSM categories — public Overpass rate-limits hard on Railway
_OSM_GAP_SECONDS = 2.5
# Skip noisy/empty buckets on region-wide sync to cut Overpass load
_HYBRID_OSM_ALL_ORDER = tuple(
    c for c in HYBRID_OSM_SYNC_ORDER if c not in {"other"}
)

def _normalize_name(name: str) -> str:
    text = name.casefold().strip()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text)
    return text


def _place_lat_lng(place: dict[str, Any]) -> tuple[float, float] | None:
    geometry = place.get("geometry") or {}
    location = geometry.get("location") or {}
    lat = location.get("lat", place.get("latitude", place.get("lat")))
    lng = location.get("lng", place.get("longitude", place.get("lng")))
    if lat is None or lng is None:
        return None
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = a
    lat2, lng2 = b
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    x = (
        math.sin(dp / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return 2 * r * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def _source_rank(place: dict[str, Any]) -> int:
    """Lower = preferred. Google food/lodging beats OSM; OSM nature beats Google junk."""
    place_id = str(place.get("place_id") or "")
    category = str(place.get("category") or "").lower()
    is_osm = place_id.startswith("osm:")
    if category in HYBRID_GOOGLE_CATEGORIES and not is_osm:
        return 0
    if category in HYBRID_OSM_CATEGORIES and is_osm:
        return 1
    if not is_osm:
        return 2
    return 3


def merge_dedupe_places(
    places: list[dict[str, Any]],
    *,
    radius_m: float = HYBRID_DEDUPE_METERS,
) -> list[dict[str, Any]]:
    """
    Drop duplicates by place_id, then by similar name + nearby coordinates.
    Prefer Google for food/lodging, OSM for nature/historic.
    """
    by_id: dict[str, dict[str, Any]] = {}
    for place in places:
        place_id = str(place.get("place_id") or "").strip()
        if not place_id:
            continue
        existing = by_id.get(place_id)
        if existing is None or _source_rank(place) < _source_rank(existing):
            by_id[place_id] = place

    ordered = list(by_id.values())
    kept: list[dict[str, Any]] = []
    kept_meta: list[tuple[str, tuple[float, float] | None]] = []

    for place in sorted(ordered, key=_source_rank):
        name = _normalize_name(str(place.get("name") or ""))
        coords = _place_lat_lng(place)
        duplicate = False
        for kept_name, kept_coords in kept_meta:
            if not name or not kept_name:
                continue
            if name != kept_name and name not in kept_name and kept_name not in name:
                continue
            if coords is None or kept_coords is None:
                if name == kept_name:
                    duplicate = True
                    break
                continue
            if _haversine_m(coords, kept_coords) <= radius_m:
                duplicate = True
                break
        if duplicate:
            continue
        kept.append(place)
        kept_meta.append((name, coords))

    print(f"[hybrid] dedupe {len(places)} → {len(kept)}")
    return kept


def _fetch_google(
    latitude: float, longitude: float, category: str
) -> list[dict[str, Any]]:
    places = fetch_places_from_google(latitude, longitude, category)
    print(f"[hybrid] google category={category} n={len(places)}")
    return places


def _fetch_osm_safe(
    latitude: float,
    longitude: float,
    category: str,
) -> list[dict[str, Any]]:
    """Single-category OSM fetch with sequential selectors (no mirror stampede)."""
    try:
        places = _fetch_single_category(
            latitude,
            longitude,
            category,
            OSM_PER_CATEGORY_LIMIT,
            selector_parallel=False,
        )
        print(f"[hybrid] osm category={category} n={len(places)}")
        return places
    except Exception as exc:
        print(f"[hybrid] osm category={category} failed: {exc}")
        return []


def _fetch_all_hybrid(
    latitude: float,
    longitude: float,
    cache_key: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Balanced all: Google (few unique types) + OSM (fully sequential).
    Returns (places, warnings).
    """
    del cache_key  # reserved for future hybrid cache
    merged: list[dict[str, Any]] = []
    warnings: list[str] = []

    for cat in _HYBRID_GOOGLE_ALL_ORDER:
        try:
            merged.extend(_fetch_google(latitude, longitude, cat))
        except Exception as exc:
            msg = f"google:{cat}: {exc}"
            print(f"[hybrid] {msg}")
            warnings.append(msg)

    for i, cat in enumerate(_HYBRID_OSM_ALL_ORDER):
        if i > 0:
            time.sleep(_OSM_GAP_SECONDS)
        places = _fetch_osm_safe(latitude, longitude, cat)
        if not places:
            warnings.append(f"osm:{cat}: empty or unavailable")
        merged.extend(places)

    return merge_dedupe_places(merged), warnings


def fetch_places_from_hybrid(
    latitude: float,
    longitude: float,
    category: str,
    cache_key: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Returns (places, warnings).
    Google-only categories raise on API key / Places errors (do not swallow).
    """
    key = cache_key or f"hybrid:{latitude:.4f}:{longitude:.4f}:{category}"
    cat = (category or "").strip().lower()

    if cat == "cafe":
        return [], []

    if cat == "all":
        return _fetch_all_hybrid(latitude, longitude, key)

    if cat == "tourist_attraction":
        return _fetch_osm_safe(latitude, longitude, "historical"), []

    if cat in HYBRID_GOOGLE_CATEGORIES:
        return _fetch_google(latitude, longitude, cat), []

    if cat in HYBRID_OSM_CATEGORIES:
        return _fetch_osm_safe(latitude, longitude, cat), []

    return _fetch_osm_safe(latitude, longitude, "other"), []
