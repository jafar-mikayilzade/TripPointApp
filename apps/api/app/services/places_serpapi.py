"""SerpAPI Google Hotels → raw property dicts for pois import."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

import requests

from app.config import SERPAPI_API_KEY
from app.constants.regions import REGION_LABELS

logger = logging.getLogger(__name__)

SERPAPI_SEARCH_URL = "https://serpapi.com/search.json"
DEFAULT_MAX_PAGES = 5


def _default_stay_dates() -> tuple[str, str]:
    """Stable future night — required by Google Hotels; rates are a snapshot."""
    check_in = date.today() + timedelta(days=30)
    check_out = check_in + timedelta(days=1)
    return check_in.isoformat(), check_out.isoformat()


def _category_for_property(prop: dict[str, Any]) -> str:
    kind = str(prop.get("type") or "").strip().lower()
    if kind == "vacation rental":
        return "guesthouse"
    stars = prop.get("extracted_hotel_class")
    if stars is None:
        raw = prop.get("hotel_class")
        if isinstance(raw, int):
            stars = raw
        elif isinstance(raw, str):
            digits = "".join(ch for ch in raw if ch.isdigit())
            stars = int(digits) if digits else None
    try:
        stars_i = int(stars) if stars is not None else None
    except (TypeError, ValueError):
        stars_i = None
    if stars_i is not None and stars_i <= 2:
        return "hostel"
    return "hotel"


def _extract_price(prop: dict[str, Any]) -> float | None:
    rate = prop.get("rate_per_night") or {}
    raw = rate.get("extracted_lowest")
    if raw is None:
        raw = prop.get("extracted_price")
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def _hotel_class(prop: dict[str, Any]) -> int | None:
    raw = prop.get("extracted_hotel_class")
    if raw is None:
        hc = prop.get("hotel_class")
        if isinstance(hc, int):
            raw = hc
        elif isinstance(hc, str):
            digits = "".join(ch for ch in hc if ch.isdigit())
            raw = int(digits) if digits else None
    try:
        stars = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None
    if stars is None or not (1 <= stars <= 5):
        return None
    return stars


def map_serpapi_property_to_place(
    prop: dict[str, Any],
    *,
    currency: str,
) -> dict[str, Any] | None:
    """Normalize one SerpAPI property into a place dict for clean_place."""
    token = str(prop.get("property_token") or "").strip()
    name = str(prop.get("name") or "").strip()
    gps = prop.get("gps_coordinates") or {}
    try:
        lat = float(gps.get("latitude"))
        lng = float(gps.get("longitude"))
    except (TypeError, ValueError):
        return None
    if not token or not name:
        return None

    price = _extract_price(prop)
    amenities = prop.get("amenities")
    if not isinstance(amenities, list):
        amenities = None

    images = prop.get("images") or []
    thumbnail = None
    if isinstance(images, list) and images:
        first = images[0] if isinstance(images[0], dict) else {}
        thumbnail = first.get("thumbnail") or first.get("original_image")
    if not thumbnail:
        thumbnail = prop.get("thumbnail")

    return {
        "place_id": f"serpapi:{token}",
        "name": name,
        "category": _category_for_property(prop),
        "lat": lat,
        "lng": lng,
        "latitude": lat,
        "longitude": lng,
        "geometry": {"location": {"lat": lat, "lng": lng}},
        "rating": prop.get("overall_rating"),
        "user_ratings_total": prop.get("reviews"),
        "description": prop.get("description"),
        "website": prop.get("link"),
        "address": prop.get("address"),
        "phone": prop.get("phone"),
        "vicinity": prop.get("address"),
        "price_from": price,
        "price_currency": currency if price is not None else None,
        "hotel_class": _hotel_class(prop),
        "amenities": amenities,
        "check_in_time": prop.get("check_in_time"),
        "check_out_time": prop.get("check_out_time"),
        "data_source": "serpapi",
        "thumbnail_url": thumbnail,
    }


def fetch_hotels_from_serpapi(
    region_key: str,
    *,
    max_pages: int = DEFAULT_MAX_PAGES,
    currency: str = "AZN",
    gl: str = "az",
    hl: str = "az",
    timeout_seconds: float = 45,
) -> list[dict[str, Any]]:
    """Fetch lodging properties for one region (paginated)."""
    if not SERPAPI_API_KEY:
        raise RuntimeError("SERPAPI_API_KEY is not set")

    label = REGION_LABELS.get(region_key) or region_key
    query = f"{label} Azerbaijan hotels"
    check_in, check_out = _default_stay_dates()

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    next_token: str | None = None

    for page in range(max(1, max_pages)):
        params: dict[str, Any] = {
            "engine": "google_hotels",
            "q": query,
            "gl": gl,
            "hl": hl,
            "currency": currency,
            "check_in_date": check_in,
            "check_out_date": check_out,
            "adults": 2,
            "api_key": SERPAPI_API_KEY,
        }
        if next_token:
            params["next_page_token"] = next_token

        logger.info(
            "[serpapi] hotels region=%s page=%s q=%s",
            region_key,
            page + 1,
            query,
        )
        response = requests.get(
            SERPAPI_SEARCH_URL,
            params=params,
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()

        if payload.get("error"):
            raise RuntimeError(str(payload["error"]))

        if payload.get("type") in {"hotel", "vacation rental"} and payload.get(
            "property_token"
        ):
            props = [payload]
        else:
            props = list(payload.get("properties") or [])

        for prop in props:
            if not isinstance(prop, dict):
                continue
            mapped = map_serpapi_property_to_place(prop, currency=currency)
            if not mapped:
                continue
            pid = mapped["place_id"]
            if pid in seen:
                continue
            seen.add(pid)
            merged.append(mapped)

        pagination = payload.get("serpapi_pagination") or {}
        next_token = pagination.get("next_page_token")
        if not next_token:
            break

    logger.info("[serpapi] hotels region=%s fetched=%s", region_key, len(merged))
    return merged


def serpapi_playground_url(region_key: str, *, currency: str = "AZN") -> str:
    label = REGION_LABELS.get(region_key) or region_key
    check_in, check_out = _default_stay_dates()
    q = quote(f"{label} Azerbaijan hotels")
    return (
        f"https://serpapi.com/search.json?engine=google_hotels&q={q}"
        f"&gl=az&hl=az&currency={currency}"
        f"&check_in_date={check_in}&check_out_date={check_out}&adults=2"
    )
