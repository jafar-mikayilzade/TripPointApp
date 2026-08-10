"""OpenStreetMap Overpass data source."""

from __future__ import annotations

import time
from threading import Lock
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

# After 429 / total mirror failure, stop hitting public Overpass for a while
_OVERPASS_COOLDOWN_UNTIL = 0.0
_OVERPASS_COOLDOWN_SECONDS = 300
_OVERPASS_COOLDOWN_LOCK = Lock()


def _overpass_in_cooldown() -> bool:
    return time.time() < _OVERPASS_COOLDOWN_UNTIL


def _trip_overpass_cooldown(reason: str) -> None:
    global _OVERPASS_COOLDOWN_UNTIL
    with _OVERPASS_COOLDOWN_LOCK:
        until = time.time() + _OVERPASS_COOLDOWN_SECONDS
        if until > _OVERPASS_COOLDOWN_UNTIL:
            _OVERPASS_COOLDOWN_UNTIL = until
    try:
        print(
            f"[osm] cooldown {_OVERPASS_COOLDOWN_SECONDS}s — {reason} "
            f"(DB fallback)"
        )
    except UnicodeEncodeError:
        print("[osm] cooldown active after Overpass failure")


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
    # ways/relations need center coords; nodes work with either
    needs_center = selector.lstrip().startswith(("way", "rel", "nwr"))
    out_clause = "out center" if needs_center else "out body"
    return (
        f"[out:json][timeout:25];\n"
        f"{selector}{around};\n"
        f"{out_clause} {result_limit};"
    )


def build_tourism_bundle_query(
    latitude: float,
    longitude: float,
    *,
    result_limit: int = 80,
    radius_meters: int | None = None,
) -> str:
    """
    One Overpass round-trip for live AI/home maps.
    Avoids N category×hub calls that hammer public mirrors.
    """
    radius = int(radius_meters or OSM_SEARCH_RADIUS_METERS)
    around = f"(around:{radius},{latitude},{longitude})"
    return (
        f"[out:json][timeout:20];\n"
        f"(\n"
        f'  node["amenity"="restaurant"]["name"]{around};\n'
        f'  nwr["tourism"="hotel"]["name"]{around};\n'
        f'  nwr["tourism"="hostel"]["name"]{around};\n'
        f'  nwr["tourism"="guest_house"]["name"]{around};\n'
        f'  nwr["tourism"="chalet"]["name"]{around};\n'
        f'  nwr["tourism"="camp_site"]["name"]{around};\n'
        f'  nwr["tourism"="viewpoint"]["name"]{around};\n'
        f'  nwr["tourism"="attraction"]["name"]{around};\n'
        f'  nwr["tourism"="museum"]["name"]{around};\n'
        f'  nwr["waterway"="waterfall"]["name"]{around};\n'
        f'  node["natural"="peak"]["name"]{around};\n'
        f'  nwr["historic"="castle"]["name"]{around};\n'
        f'  nwr["historic"="ruins"]["name"]{around};\n'
        f'  nwr["historic"="monument"]["name"]{around};\n'
        f'  nwr["historic"="memorial"]["name"]{around};\n'
        f");\n"
        f"out center {int(result_limit)};"
    )


def _pick_osm_name(tags: dict[str, Any]) -> str | None:
    """Prefer Azerbaijani / English labels; never prefer Russian-only names."""
    for key in ("name:az", "name:en", "name:tr", "name"):
        raw = tags.get(key)
        if not raw:
            continue
        name = str(raw).strip()
        if not name:
            continue
        # Drop Cyrillic-heavy labels (Russian / mixed garbage)
        letters = [ch for ch in name if ch.isalpha()]
        if letters:
            cyr = sum(1 for ch in letters if "\u0400" <= ch <= "\u04FF")
            if (cyr / len(letters)) >= 0.2:
                continue
        return name
    return None


def osm_element_to_place(element: dict[str, Any]) -> dict[str, Any] | None:
    element_type = element.get("type")
    element_id = element.get("id")
    tags = element.get("tags") or {}
    name = _pick_osm_name(tags)

    if not element_type or element_id is None or not name:
        return None

    coords = element_lat_lng(element)
    if coords is None:
        return None

    lat, lng = coords
    place: dict[str, Any] = {
        "place_id": f"osm:{element_type}/{element_id}",
        "name": name,
        "latitude": lat,
        "longitude": lng,
        "address": build_address_from_tags(tags),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "website": tags.get("website") or tags.get("contact:website") or tags.get("url"),
        "description": tags.get("description:en")
        or tags.get("description:az")
        or tags.get("description")
        or tags.get("note"),
        "rating": None,
        "category": category_from_osm_tags(tags),
        "data_source": "osm",
    }
    # Prefer lodging with star class / price when OSM tags exist
    stars = tags.get("stars")
    if stars is not None:
        try:
            star_i = int(float(str(stars).replace(",", ".")))
            if 1 <= star_i <= 5:
                place["hotel_class"] = star_i
        except (TypeError, ValueError):
            pass
    price = tags.get("price") or tags.get("charge")
    if price:
        # Keep raw hint in description only if numeric parse fails
        try:
            digits = "".join(ch if (ch.isdigit() or ch == ".") else " " for ch in str(price))
            num = next((float(p) for p in digits.split() if p), None)
            if num is not None and num > 0:
                place["price_from"] = num
                place["price_currency"] = "AZN"
        except (TypeError, ValueError, StopIteration):
            pass
    return place


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


def _overpass_get(
    query: str,
    *,
    timeout_seconds: float | None = None,
    max_mirrors: int | None = None,
    rotate: bool = True,
) -> dict[str, Any]:
    if _overpass_in_cooldown():
        raise requests.RequestException(
            "Overpass cooldown active — skipping mirrors"
        )

    headers = {
        "Accept": "application/json",
        "User-Agent": "TripPoint/1.0 (sync-places; contact=dev@trippoint.local)",
    }
    errors: list[str] = []
    saw_rate_limit = False
    read_timeout = (
        float(timeout_seconds)
        if timeout_seconds is not None
        else float(OSM_HTTP_TIMEOUT_SECONDS)
    )
    # (connect, read) — don't wait forever on dead mirrors
    timeout: float | tuple[float, float] = (5.0, read_timeout)
    endpoints = list(OVERPASS_ENDPOINTS)
    # Rotate start mirror so one busy host doesn't always fail first.
    # Callers that already sorted mirrors (e.g. import_osm_named) pass rotate=False.
    if rotate and endpoints:
        start = int(time.time() / 120) % len(endpoints)
        endpoints = endpoints[start:] + endpoints[:start]
    if max_mirrors is not None and max_mirrors > 0:
        endpoints = endpoints[:max_mirrors]

    def _log(message: str) -> None:
        try:
            print(message)
        except UnicodeEncodeError:
            print(message.encode("ascii", "replace").decode("ascii"))

    for endpoint in endpoints:
        try:
            _log(f"[osm] GET {endpoint}")
            response = requests.get(
                endpoint,
                params={"data": query},
                headers=headers,
                timeout=timeout,
            )
            if response.status_code in {429, 502, 503, 504}:
                if response.status_code == 429:
                    saw_rate_limit = True
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

    reason = "HTTP 429 rate limit" if saw_rate_limit else "all mirrors failed"
    _trip_overpass_cooldown(reason)
    raise requests.RequestException(
        "All Overpass mirrors failed: " + "; ".join(errors)
    )


def _fetch_selectors(
    latitude: float,
    longitude: float,
    selectors: list[str],
    per_query_limit: int,
    *,
    timeout_seconds: float | None = None,
    max_mirrors: int | None = None,
) -> list[dict[str, Any]]:
    """Run Overpass selectors sequentially and merge unique places.

    Sequential on purpose: parallel selectors amplify Overpass 429s.
    """

    def _one(selector: str) -> list[dict[str, Any]]:
        query = build_overpass_query(
            latitude, longitude, selector, result_limit=per_query_limit
        )
        payload = _overpass_get(
            query, timeout_seconds=timeout_seconds, max_mirrors=max_mirrors
        )
        return _parse_overpass_places(payload, result_limit=per_query_limit)

    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def _absorb(places: list[dict[str, Any]]) -> None:
        for place in places:
            place_id = place["place_id"]
            if place_id in seen_ids:
                continue
            seen_ids.add(place_id)
            merged.append(place)

    for selector in selectors:
        if _overpass_in_cooldown():
            print("[osm] skip remaining selectors — cooldown active")
            break
        try:
            _absorb(_one(selector))
        except Exception as exc:
            print(f"[osm] selector failed: {exc}")
            # One hard failure is enough; don't walk the rest of the filters
            break
    return merged


def _fetch_single_category(
    latitude: float,
    longitude: float,
    category: str,
    limit: int,
    *,
    timeout_seconds: float | None = None,
    max_mirrors: int | None = None,
) -> list[dict[str, Any]]:
    selectors = OSM_CATEGORY_FILTERS.get(category) or OSM_CATEGORY_FILTERS["other"]
    places = _fetch_selectors(
        latitude,
        longitude,
        selectors,
        per_query_limit=min(25, limit),
        timeout_seconds=timeout_seconds,
        max_mirrors=max_mirrors,
    )
    # Specific filter: stamp requested category so home UI filter matches
    for place in places:
        place["category"] = category
    return places[:limit]


def _fetch_all_categories_balanced(
    latitude: float,
    longitude: float,
) -> list[dict[str, Any]]:
    """
    One Overpass tourism bundle for sync (no per-category fan-out).
    Tag-derived categories; food/lodging filtered later in places_sync.
    """
    if _overpass_in_cooldown():
        print("[osm] all-sync skipped — cooldown active")
        return []
    places = fetch_tourism_bundle_from_osm(
        latitude,
        longitude,
        result_limit=OSM_RESULT_LIMIT_ALL,
        radius_meters=OSM_SEARCH_RADIUS_METERS,
        # Background sync can wait a bit longer than live UI
        timeout_seconds=20.0,
        max_mirrors=3,
        cache_key=f"sync-bundle:{latitude:.4f}:{longitude:.4f}",
    )
    print(f"[osm] all-sync bundle total={len(places)}")
    return places


def fetch_places_from_osm(
    latitude: float,
    longitude: float,
    category: str,
    cache_key: str | None = None,
) -> list[dict[str, Any]]:
    key = cache_key or f"v3:{latitude:.4f}:{longitude:.4f}:{category}"
    if not key.startswith("v3:"):
        key = f"v3:{key}"

    cached = _OSM_CACHE.get(key)
    now = time.time()
    if cached and cached[0] > now:
        print(f"[osm] cache hit {key} ({len(cached[1])} places)")
        return list(cached[1])

    if _overpass_in_cooldown():
        print(f"[osm] skip fetch {category} — cooldown active")
        return []

    if category == "all":
        merged = _fetch_all_categories_balanced(latitude, longitude)
    else:
        merged = _fetch_single_category(
            latitude,
            longitude,
            category,
            OSM_RESULT_LIMIT,
            timeout_seconds=20.0,
            max_mirrors=3,
        )

    _OSM_CACHE[key] = (now + OSM_CACHE_TTL_SECONDS, merged)
    return merged


def fetch_tourism_bundle_from_osm(
    latitude: float,
    longitude: float,
    *,
    result_limit: int = 80,
    radius_meters: int | None = None,
    timeout_seconds: float = 8.0,
    max_mirrors: int = 2,
    cache_key: str | None = None,
) -> list[dict[str, Any]]:
    """
    Single-query tourism pack for live map / AI candidates.
    Uses tag-derived categories (not stamped filters).
    """
    key = (
        cache_key
        or f"bundle:{latitude:.4f}:{longitude:.4f}:{int(radius_meters or OSM_SEARCH_RADIUS_METERS)}:{result_limit}"
    )
    cached = _OSM_CACHE.get(key)
    now = time.time()
    if cached and cached[0] > now:
        print(f"[osm] cache hit {key} ({len(cached[1])} places)")
        return list(cached[1])

    query = build_tourism_bundle_query(
        latitude,
        longitude,
        result_limit=result_limit,
        radius_meters=radius_meters,
    )
    payload = _overpass_get(
        query,
        timeout_seconds=timeout_seconds,
        max_mirrors=max_mirrors,
    )
    places = _parse_overpass_places(payload, result_limit=result_limit)
    # Drop cafes — noisy for tourism UI
    places = [
        p for p in places if str(p.get("category") or "").lower() != "cafe"
    ]
    print(f"[osm] bundle kept={len(places)} key={key}")
    _OSM_CACHE[key] = (now + OSM_CACHE_TTL_SECONDS, places)
    return places
