"""OpenStreetMap Overpass data source."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests

from app.config import (
    OSM_CACHE_TTL_SECONDS,
    OSM_HTTP_TIMEOUT_SECONDS,
    OSM_RESULT_LIMIT,
    OSM_RESULT_LIMIT_ALL,
    OSM_SEARCH_RADIUS_METERS,
    OVERPASS_ENDPOINTS,
)
from app.constants.osm import OSM_CATEGORY_FILTERS
from app.services.places_clean import category_from_osm_tags

# region+category -> (expires_at_epoch, places)
_OSM_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def build_address_from_tags(tags: dict[str, Any]) -> str | None:
    street = tags.get("addr:street")
    housenumber = tags.get("addr:housenumber")
    city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village")
    parts: list[str] = []
    if street and housenumber:
        parts.append(f"{street} {housenumber}")
    elif street:
        parts.append(street)
    elif housenumber:
        parts.append(housenumber)
    if city:
        parts.append(str(city))
    if parts:
        return ", ".join(parts)
    return tags.get("addr:full")


def element_lat_lng(element: dict[str, Any]) -> tuple[float, float] | None:
    if element.get("lat") is not None and element.get("lon") is not None:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if center.get("lat") is not None and center.get("lon") is not None:
        return float(center["lat"]), float(center["lon"])
    return None


def build_overpass_query(
    latitude: float,
    longitude: float,
    selector: str,
    result_limit: int = OSM_RESULT_LIMIT,
) -> str:
    around = f"(around:{OSM_SEARCH_RADIUS_METERS},{latitude},{longitude})"
    return (
        f"[out:json][timeout:25];\n"
        f"{selector}{around};\n"
        f"out body {result_limit};"
    )


def osm_element_to_place(element: dict[str, Any]) -> dict[str, Any] | None:
    element_type = element.get("type")
    element_id = element.get("id")
    tags = element.get("tags") or {}
    name = tags.get("name") or tags.get("name:en") or tags.get("name:az")

    if not element_type or element_id is None or not name:
        return None

    coords = element_lat_lng(element)
    if coords is None:
        return None

    lat, lng = coords
    return {
        "place_id": f"osm:{element_type}/{element_id}",
        "name": name,
        "latitude": lat,
        "longitude": lng,
        "address": build_address_from_tags(tags),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "website": tags.get("website") or tags.get("contact:website") or tags.get("url"),
        "description": tags.get("description") or tags.get("note"),
        "rating": None,
        "category": category_from_osm_tags(tags),
    }


def _parse_overpass_places(
    payload: dict[str, Any],
    result_limit: int = OSM_RESULT_LIMIT,
) -> list[dict[str, Any]]:
    places: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for element in payload.get("elements") or []:
        place = osm_element_to_place(element)
        if place is None:
            continue
        place_id = place["place_id"]
        if place_id in seen_ids:
            continue
        seen_ids.add(place_id)
        places.append(place)
        if len(places) >= result_limit:
            break
    return places


def _overpass_get(query: str) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "TripPoint/1.0 (sync-places; contact=dev@trippoint.local)",
    }
    errors: list[str] = []

    def _log(message: str) -> None:
        try:
            print(message)
        except UnicodeEncodeError:
            print(message.encode("ascii", "replace").decode("ascii"))

    for endpoint in OVERPASS_ENDPOINTS:
        try:
            _log(f"[osm] GET {endpoint}")
            response = requests.get(
                endpoint,
                params={"data": query},
                headers=headers,
                timeout=OSM_HTTP_TIMEOUT_SECONDS,
            )
            if response.status_code in {429, 502, 503, 504}:
                errors.append(f"{endpoint} -> HTTP {response.status_code}")
                _log(f"[osm] mirror busy: {errors[-1]}")
                continue

            content_type = (response.headers.get("Content-Type") or "").lower()
            text_head = (response.text or "")[:80].lstrip().lower()
            if (
                "html" in content_type
                or text_head.startswith("<!doctype")
                or text_head.startswith("<html")
                or text_head.startswith("<?xml")
            ):
                errors.append(f"{endpoint} -> HTML/XML error (busy/timeout)")
                _log(f"[osm] mirror busy: {errors[-1]}")
                continue

            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or "elements" not in payload:
                errors.append(f"{endpoint} -> invalid JSON payload")
                continue

            _log(
                f"[osm] ok via {endpoint}, elements={len(payload.get('elements') or [])}"
            )
            return payload
        except (requests.RequestException, ValueError) as exc:
            err_text = str(exc).encode("ascii", "replace").decode("ascii")
            errors.append(f"{endpoint} -> {err_text}")
            _log(f"[osm] mirror failed: {errors[-1]}")
            continue

    raise requests.RequestException(
        "All Overpass mirrors failed: " + "; ".join(errors)
    )


def fetch_places_from_osm(
    latitude: float,
    longitude: float,
    category: str,
    cache_key: str | None = None,
) -> list[dict[str, Any]]:
    key = cache_key or f"{latitude:.4f}:{longitude:.4f}:{category}"
    cached = _OSM_CACHE.get(key)
    now = time.time()
    if cached and cached[0] > now:
        print(f"[osm] cache hit {key} ({len(cached[1])} places)")
        return list(cached[1])

    selectors = OSM_CATEGORY_FILTERS.get(category) or OSM_CATEGORY_FILTERS["other"]
    limit = OSM_RESULT_LIMIT_ALL if category == "all" else OSM_RESULT_LIMIT
    per_query_limit = min(25, limit)
    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def _fetch_selector(selector: str) -> list[dict[str, Any]]:
        query = build_overpass_query(
            latitude, longitude, selector, result_limit=per_query_limit
        )
        payload = _overpass_get(query)
        return _parse_overpass_places(payload, result_limit=per_query_limit)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(_fetch_selector, selector) for selector in selectors]
        for future in as_completed(futures):
            try:
                places = future.result()
            except Exception as exc:
                print(f"[osm] selector failed: {exc}")
                continue
            for place in places:
                place_id = place["place_id"]
                if place_id in seen_ids:
                    continue
                if category not in {"all", "tourist_attraction"}:
                    place_cat = place.get("category")
                    if place_cat and place_cat != category:
                        place["category"] = category
                seen_ids.add(place_id)
                merged.append(place)

    merged = merged[:limit]
    _OSM_CACHE[key] = (now + OSM_CACHE_TTL_SECONDS, merged)
    return merged
