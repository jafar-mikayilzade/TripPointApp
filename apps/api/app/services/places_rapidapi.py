"""RapidAPI Booking.com + TripAdvisor → standardized place dicts for pois.

Documented hosts (override via env):
  - booking-com15.p.rapidapi.com
    https://rapidapi.com/DataCrawler/api/booking-com15
  - tripadvisor16.p.rapidapi.com
    https://rapidapi.com/apiheya/api/tripadvisor16
"""

from __future__ import annotations

import logging
import re
import time
from datetime import date, timedelta
from typing import Any, Literal

import requests

from app.config import (
    RAPIDAPI_BOOKING_HOST,
    RAPIDAPI_KEY,
    RAPIDAPI_TRIPADVISOR_HOST,
)
from app.constants.regions import REGION_COORDINATES, REGION_LABELS

logger = logging.getLogger(__name__)

Kind = Literal["hotel", "restaurant", "camping"]

_CAMPING_RE = re.compile(
    r"\b(camp|camping|campground|campsite|glamping|çarə|camp\s*site)\b",
    re.IGNORECASE,
)
_MAX_ATTEMPTS = 3
_HTTP_TIMEOUT = 35


class RapidApiConfigError(RuntimeError):
    """Missing key or unusable RapidAPI configuration."""


class RapidApiEndpointError(RuntimeError):
    """Host/path rejected after limited retries — stop and report URL."""


def require_rapidapi_key() -> str:
    if not RAPIDAPI_KEY:
        raise RapidApiConfigError(
            "RAPIDAPI_KEY is not set. Add it to apps/api/.env, then subscribe to "
            "https://rapidapi.com/DataCrawler/api/booking-com15 and "
            "https://rapidapi.com/apiheya/api/tripadvisor16"
        )
    return RAPIDAPI_KEY


def _headers(host: str) -> dict[str, str]:
    return {
        "X-RapidAPI-Key": require_rapidapi_key(),
        "X-RapidAPI-Host": host,
        "Content-Type": "application/json",
    }


def _get_json(
    url: str,
    *,
    host: str,
    params: dict[str, Any] | None = None,
    label: str,
) -> Any:
    last_err: Exception | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            resp = requests.get(
                url,
                headers=_headers(host),
                params=params,
                timeout=_HTTP_TIMEOUT,
            )
            if resp.status_code in {401, 403}:
                raise RapidApiEndpointError(
                    f"{label}: HTTP {resp.status_code} — check RAPIDAPI_KEY and "
                    f"subscription for host {host}. URL={url}"
                )
            if resp.status_code == 404:
                raise RapidApiEndpointError(
                    f"{label}: HTTP 404 — wrong path for host {host}. URL={url}"
                )
            if resp.status_code == 429:
                last_err = RapidApiEndpointError(
                    f"{label}: rate limited (429). URL={url}"
                )
                time.sleep(1.5 * attempt)
                continue
            if resp.status_code >= 500:
                last_err = RapidApiEndpointError(
                    f"{label}: HTTP {resp.status_code}. URL={url}"
                )
                time.sleep(1.0 * attempt)
                continue
            if resp.status_code >= 400:
                raise RapidApiEndpointError(
                    f"{label}: HTTP {resp.status_code} body={resp.text[:300]!r} URL={url}"
                )
            return resp.json()
        except RapidApiEndpointError:
            raise
        except requests.RequestException as exc:
            last_err = exc
            logger.warning("%s attempt %s failed: %s", label, attempt, exc)
            time.sleep(0.8 * attempt)
    raise RapidApiEndpointError(
        f"{label}: failed after {_MAX_ATTEMPTS} attempts ({last_err}). URL={url}"
    )


def _default_stay_dates() -> tuple[str, str]:
    check_in = date.today() + timedelta(days=30)
    check_out = check_in + timedelta(days=1)
    return check_in.isoformat(), check_out.isoformat()


def _region_query(region_key: str) -> str:
    label = REGION_LABELS.get(region_key, region_key)
    return f"{label}, Azerbaijan"


def _as_list(payload: Any) -> list[Any]:
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "result", "results", "hotels", "restaurants", "list"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return inner
            if isinstance(inner, dict):
                nested = _as_list(inner)
                if nested:
                    return nested
    return []


def _first_dest(payload: Any) -> dict[str, Any] | None:
    rows = _as_list(payload)
    for row in rows:
        if isinstance(row, dict) and (
            row.get("dest_id") is not None or row.get("destinationId") is not None
        ):
            return row
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict) and data.get("dest_id") is not None:
            return data
    return None


def search_booking_destination(region_key: str) -> dict[str, Any]:
    host = RAPIDAPI_BOOKING_HOST
    url = f"https://{host}/api/v1/hotels/searchDestination"
    payload = _get_json(
        url,
        host=host,
        params={"query": _region_query(region_key)},
        label="booking.searchDestination",
    )
    dest = _first_dest(payload)
    if not dest:
        raise RapidApiEndpointError(
            "booking.searchDestination: empty destinations for "
            f"{region_key!r}. Host={host} URL={url}"
        )
    dest_id = dest.get("dest_id") or dest.get("destinationId")
    search_type = (
        dest.get("search_type")
        or dest.get("dest_type")
        or dest.get("type")
        or "city"
    )
    return {
        "dest_id": str(dest_id),
        "search_type": str(search_type).upper()
        if str(search_type).isalpha()
        else str(search_type),
        "raw": dest,
    }


def fetch_booking_hotels(
    region_key: str,
    *,
    currency: str = "AZN",
    page_number: int = 1,
) -> list[dict[str, Any]]:
    host = RAPIDAPI_BOOKING_HOST
    dest = search_booking_destination(region_key)
    arrival, departure = _default_stay_dates()
    url = f"https://{host}/api/v1/hotels/searchHotels"
    params = {
        "dest_id": dest["dest_id"],
        "search_type": dest["search_type"],
        "arrival_date": arrival,
        "departure_date": departure,
        "adults": 2,
        "room_qty": 1,
        "page_number": page_number,
        "units": "metric",
        "temperature_unit": "c",
        "languagecode": "en-us",
        "currency_code": currency,
    }

    payload = _get_json(
        url,
        host=host,
        params=params,
        label="booking.searchHotels",
    )
    hotels = _as_list(payload)
    if not hotels and isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict):
            hotels = _as_list(data.get("hotels") or data.get("result"))
    return [h for h in hotels if isinstance(h, dict)]


def fetch_booking_hotels_by_coords(
    region_key: str,
    *,
    currency: str = "AZN",
    page_number: int = 1,
) -> list[dict[str, Any]]:
    coords = REGION_COORDINATES.get(region_key)
    if not coords:
        return []
    host = RAPIDAPI_BOOKING_HOST
    arrival, departure = _default_stay_dates()
    url = f"https://{host}/api/v1/hotels/searchHotelsByCoordinates"
    params = {
        "latitude": coords["latitude"],
        "longitude": coords["longitude"],
        "adults": 2,
        "room_qty": 1,
        "units": "metric",
        "page_number": page_number,
        "temperature_unit": "c",
        "languagecode": "en-us",
        "currency_code": currency,
        "arrival_date": arrival,
        "departure_date": departure,
    }
    payload = _get_json(
        url,
        host=host,
        params=params,
        label="booking.searchHotelsByCoordinates",
    )
    hotels = _as_list(payload)
    if not hotels and isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict):
            hotels = _as_list(data.get("hotels") or data.get("result"))
    return [h for h in hotels if isinstance(h, dict)]


def _flatten_booking(prop: dict[str, Any]) -> dict[str, Any]:
    """booking-com15 searchHotels rows nest fields under `property`."""
    nested = prop.get("property")
    if isinstance(nested, dict):
        flat = dict(nested)
        if prop.get("hotel_id") is not None:
            flat["hotel_id"] = prop.get("hotel_id")
        label = prop.get("accessibilityLabel")
        if isinstance(label, str) and label.strip():
            flat.setdefault("accessibilityLabel", label)
        return flat
    return prop


def _booking_property_id(prop: dict[str, Any]) -> str | None:
    prop = _flatten_booking(prop)
    for key in ("hotel_id", "id", "property_id", "hotelId"):
        raw = prop.get(key)
        if raw is None:
            continue
        text = str(raw).strip()
        if text.startswith("property_card_"):
            text = text.replace("property_card_", "", 1)
        if text:
            return text
    return None


def _booking_name(prop: dict[str, Any]) -> str | None:
    prop = _flatten_booking(prop)
    for key in (
        "name",
        "hotel_name",
        "property_name",
        "accessibilityLabel",
    ):
        val = prop.get(key)
        if isinstance(val, str) and val.strip():
            # accessibilityLabel can be multi-line marketing blurb
            return val.strip().split("\n", 1)[0].strip()
    return None


def _booking_coords(prop: dict[str, Any]) -> tuple[float, float] | None:
    prop = _flatten_booking(prop)
    lat = prop.get("latitude")
    lng = prop.get("longitude")
    if lat is None or lng is None:
        loc = prop.get("location") or {}
        if isinstance(loc, dict):
            lat = loc.get("latitude") or loc.get("lat")
            lng = loc.get("longitude") or loc.get("lng")
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def _booking_price(prop: dict[str, Any]) -> float | None:
    prop = _flatten_booking(prop)
    for key in (
        "min_total_price",
        "price_from",
        "price",
        "minPrice",
    ):
        raw = prop.get(key)
        if isinstance(raw, dict):
            raw = raw.get("value") or raw.get("amount") or raw.get("extracted")
        if raw is None:
            continue
        try:
            value = float(raw)
            if value >= 0:
                return value
        except (TypeError, ValueError):
            continue
    price_block = prop.get("priceBreakdown") or prop.get("price_breakdown") or {}
    if isinstance(price_block, dict):
        for price_key in ("grossPrice", "gross_price", "excludedPrice"):
            block = price_block.get(price_key) or {}
            if isinstance(block, dict) and block.get("value") is not None:
                try:
                    return float(block["value"])
                except (TypeError, ValueError):
                    pass
    return None


def _booking_currency(prop: dict[str, Any], fallback: str) -> str:
    prop = _flatten_booking(prop)
    cur = prop.get("currency")
    if isinstance(cur, str) and cur.strip():
        return cur.strip().upper()
    price_block = prop.get("priceBreakdown") or {}
    if isinstance(price_block, dict):
        gross = price_block.get("grossPrice") or {}
        if isinstance(gross, dict) and isinstance(gross.get("currency"), str):
            return gross["currency"].strip().upper()
    return fallback


def _booking_class(prop: dict[str, Any]) -> int | None:
    prop = _flatten_booking(prop)
    for key in (
        "propertyClass",
        "accuratePropertyClass",
        "class",
        "hotel_class",
        "stars",
    ):
        raw = prop.get(key)
        try:
            stars = int(float(raw))
        except (TypeError, ValueError):
            continue
        if 1 <= stars <= 5:
            return stars
    return None


def _booking_is_camping(prop: dict[str, Any]) -> bool:
    prop = _flatten_booking(prop)
    blobs: list[str] = []
    for key in (
        "accommodation_type_name",
        "accommodationTypeName",
        "property_type",
        "propertyType",
        "hotel_name",
        "name",
        "wishlistName",
        "unit_type",
        "accessibilityLabel",
    ):
        val = prop.get(key)
        if isinstance(val, str):
            blobs.append(val)
    return any(_CAMPING_RE.search(b) for b in blobs)


def map_booking_property_to_place(
    prop: dict[str, Any],
    *,
    category: Kind,
    currency: str = "AZN",
) -> dict[str, Any] | None:
    flat = _flatten_booking(prop)
    prop_id = _booking_property_id(flat)
    name = _booking_name(flat)
    coords = _booking_coords(flat)
    if not prop_id or not name or not coords:
        return None
    lat, lng = coords
    price = _booking_price(flat)
    currency_out = _booking_currency(flat, currency)

    rating = None
    for key in ("reviewScore", "review_score", "rating"):
        raw = flat.get(key)
        if isinstance(raw, dict):
            raw = raw.get("score") or raw.get("value")
        try:
            value = float(raw)
            # Booking often uses 0–10 scale
            if value > 5:
                value = value / 2.0
            if 0 < value <= 5:
                rating = round(value, 2)
                break
        except (TypeError, ValueError):
            continue

    rating_count = None
    for key in ("reviewCount", "review_nr", "review_count", "user_ratings_total"):
        raw = flat.get(key)
        try:
            rating_count = int(raw)
            break
        except (TypeError, ValueError):
            continue

    thumb = None
    photos = flat.get("photoUrls") or flat.get("photos")
    if isinstance(photos, list) and photos:
        first = photos[0]
        if isinstance(first, str) and first.startswith("http"):
            thumb = first
        elif isinstance(first, dict):
            url = first.get("url") or first.get("absolute_url")
            if isinstance(url, str) and url.startswith("http"):
                thumb = url
    if thumb is None:
        for key in ("main_photo_url", "photoUrl", "image", "thumbnail_url"):
            val = flat.get(key)
            if isinstance(val, str) and val.startswith("http"):
                thumb = val
                break

    place: dict[str, Any] = {
        "name": name,
        "category": category,
        "lat": lat,
        "lng": lng,
        "place_id": f"booking:{prop_id}",
        "data_source": "booking",
        "price_currency": currency_out,
    }
    if price is not None:
        place["price_from"] = round(price, 2)
    if rating is not None:
        place["rating"] = rating
    if rating_count is not None:
        place["rating_count"] = rating_count
    stars = _booking_class(flat)
    if stars is not None:
        place["hotel_class"] = stars
    if thumb:
        place["thumbnail_url"] = thumb
    checkin = flat.get("checkin")
    if isinstance(checkin, dict) and checkin.get("fromTime"):
        place["check_in_time"] = str(checkin["fromTime"])[:40]
    checkout = flat.get("checkout")
    if isinstance(checkout, dict) and checkout.get("untilTime"):
        place["check_out_time"] = str(checkout["untilTime"])[:40]
    address = flat.get("address") or flat.get("city") or flat.get("district")
    if address:
        place["address"] = str(address)
    return place


def search_tripadvisor_location(region_key: str) -> str:
    """Resolve TripAdvisor geo id.

    Preferred path restaurant/searchLocation is currently broken on tripadvisor16
    (returns status:false even for Paris). Fall back to hotels/searchLocation
    which returns geoId for the same host.
    """
    host = RAPIDAPI_TRIPADVISOR_HOST
    query = _region_query(region_key)
    # 1) restaurants collection (documented)
    url_rest = f"https://{host}/api/v1/restaurant/searchLocation"
    try:
        payload = _get_json(
            url_rest,
            host=host,
            params={"query": query},
            label="tripadvisor.searchLocation",
        )
        rows = _as_list(payload)
        for row in rows:
            if not isinstance(row, dict):
                continue
            loc_id = row.get("locationId") or row.get("location_id") or row.get("id")
            if loc_id is None:
                loc = row.get("location")
                if isinstance(loc, dict):
                    loc_id = loc.get("locationId") or loc.get("id")
            if loc_id is not None:
                return str(loc_id)
        if isinstance(payload, dict) and payload.get("status") is False:
            logger.warning(
                "tripadvisor restaurant/searchLocation status=false for %s — trying hotels/searchLocation",
                region_key,
            )
    except RapidApiEndpointError as exc:
        logger.warning("tripadvisor restaurant/searchLocation failed: %s", exc)

    # 2) hotels collection geo search (works on this RapidAPI product)
    url_hotels = f"https://{host}/api/v1/hotels/searchLocation"
    payload = _get_json(
        url_hotels,
        host=host,
        params={"query": REGION_LABELS.get(region_key, region_key)},
        label="tripadvisor.hotels.searchLocation",
    )
    rows = _as_list(payload)
    for row in rows:
        if not isinstance(row, dict):
            continue
        geo = row.get("geoId") or row.get("locationId") or row.get("id")
        secondary = str(row.get("secondaryText") or "")
        title = str(row.get("title") or "")
        # Prefer Azerbaijan matches when present
        if geo is not None and (
            "Azerbaijan" in secondary
            or "Azərbaycan" in secondary
            or region_key.lower() in title.lower()
            or REGION_LABELS.get(region_key, "").lower() in title.lower().replace("<b>", "").replace("</b>", "")
        ):
            return str(geo)
    for row in rows:
        if isinstance(row, dict) and row.get("geoId") is not None:
            return str(row["geoId"])

    raise RapidApiEndpointError(
        f"tripadvisor.searchLocation: no locationId/geoId for {region_key!r}. "
        f"Host={host}. Restaurant endpoints may be down; hotels/searchLocation also empty."
    )


def fetch_tripadvisor_restaurants(region_key: str) -> list[dict[str, Any]]:
    host = RAPIDAPI_TRIPADVISOR_HOST
    location_id = search_tripadvisor_location(region_key)
    url = f"https://{host}/api/v1/restaurant/searchRestaurants"
    payload = _get_json(
        url,
        host=host,
        params={"locationId": location_id},
        label="tripadvisor.searchRestaurants",
    )
    if isinstance(payload, dict) and payload.get("status") is False:
        raise RapidApiEndpointError(
            "tripadvisor.searchRestaurants: upstream status=false for "
            f"locationId={location_id} region={region_key}. "
            "Subscribe/check https://rapidapi.com/apiheya/api/tripadvisor16 "
            "restaurant endpoints (currently returning empty errors)."
        )
    rows = _as_list(payload)
    if not rows and isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict):
            rows = _as_list(data.get("data") or data.get("restaurants"))
    if not rows:
        raise RapidApiEndpointError(
            f"tripadvisor.searchRestaurants: empty list for locationId={location_id} "
            f"region={region_key}"
        )
    return [r for r in rows if isinstance(r, dict)]


def _ta_id(row: dict[str, Any]) -> str | None:
    for key in ("restaurantsId", "restaurantId", "locationId", "id", "location_id"):
        raw = row.get(key)
        if raw is not None and str(raw).strip():
            return str(raw).strip()
    return None


def _ta_name(row: dict[str, Any]) -> str | None:
    for key in ("name", "title", "restaurantName"):
        val = row.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _ta_coords(row: dict[str, Any]) -> tuple[float, float] | None:
    lat = row.get("latitude") or row.get("lat")
    lng = row.get("longitude") or row.get("lng") or row.get("lon")
    if lat is None or lng is None:
        loc = row.get("location") or row.get("coordinates") or {}
        if isinstance(loc, dict):
            lat = loc.get("latitude") or loc.get("lat")
            lng = loc.get("longitude") or loc.get("lng")
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def map_tripadvisor_restaurant_to_place(row: dict[str, Any]) -> dict[str, Any] | None:
    rid = _ta_id(row)
    name = _ta_name(row)
    coords = _ta_coords(row)
    if not rid or not name or not coords:
        return None
    lat, lng = coords

    rating = None
    for key in ("averageRating", "rating", "ratingValue"):
        raw = row.get(key)
        if isinstance(raw, dict):
            raw = raw.get("value") or raw.get("rating")
        try:
            value = float(raw)
            if 0 < value <= 5:
                rating = round(value, 2)
                break
        except (TypeError, ValueError):
            continue

    rating_count = None
    for key in ("userReviewCount", "numberOfReviews", "review_count", "rating_count"):
        raw = row.get(key)
        try:
            rating_count = int(raw)
            break
        except (TypeError, ValueError):
            continue

    place: dict[str, Any] = {
        "name": name,
        "category": "restaurant",
        "lat": lat,
        "lng": lng,
        "place_id": f"tripadvisor:{rid}",
        "data_source": "tripadvisor",
    }
    if rating is not None:
        place["rating"] = rating
    if rating_count is not None:
        place["rating_count"] = rating_count
    address = row.get("address") or row.get("locationString")
    if address:
        place["address"] = str(address)
    thumb = row.get("thumbnail") or row.get("image") or row.get("photo")
    if isinstance(thumb, dict):
        thumb = thumb.get("url") or thumb.get("images", {}).get("medium", {}).get("url")
    if isinstance(thumb, str) and thumb.startswith("http"):
        place["thumbnail_url"] = thumb
    return place


def fetch_standardized_for_region(
    region_key: str,
    *,
    kinds: list[Kind] | None = None,
    currency: str = "AZN",
) -> dict[str, Any]:
    """Fetch + map places for one region. Does not write to DB."""
    key = region_key.strip().lower()
    if key not in REGION_COORDINATES:
        raise ValueError(f"Unknown region '{region_key}'")

    wanted = kinds or ["hotel", "restaurant", "camping"]
    out: dict[str, Any] = {
        "region": key,
        "places": [],
        "fetched": {},
        "mapped": {},
        "skipped": {},
        "errors": [],
    }

    booking_raw: list[dict[str, Any]] = []
    if "hotel" in wanted or "camping" in wanted:
        try:
            booking_raw = fetch_booking_hotels(key, currency=currency)
            if not booking_raw:
                booking_raw = fetch_booking_hotels_by_coords(key, currency=currency)
        except (RapidApiConfigError, RapidApiEndpointError, ValueError) as exc:
            out["errors"].append(str(exc))
            raise

    if "hotel" in wanted:
        hotels: list[dict[str, Any]] = []
        skipped = 0
        for prop in booking_raw:
            if _booking_is_camping(prop):
                continue
            mapped = map_booking_property_to_place(
                prop, category="hotel", currency=currency
            )
            if mapped is None:
                skipped += 1
                continue
            hotels.append(mapped)
        out["fetched"]["hotel"] = len(booking_raw)
        out["mapped"]["hotel"] = len(hotels)
        out["skipped"]["hotel"] = skipped
        out["places"].extend(hotels)

    if "camping" in wanted:
        camps: list[dict[str, Any]] = []
        skipped = 0
        for prop in booking_raw:
            if not _booking_is_camping(prop):
                skipped += 1
                continue
            mapped = map_booking_property_to_place(
                prop, category="camping", currency=currency
            )
            if mapped is None:
                skipped += 1
                continue
            camps.append(mapped)
        out["fetched"]["camping"] = len(booking_raw)
        out["mapped"]["camping"] = len(camps)
        out["skipped"]["camping"] = skipped
        if camps:
            out["places"].extend(camps)
        else:
            logger.info(
                "camping: no reliable camp/camping matches for region=%s (skipped=%s)",
                key,
                skipped,
            )

    if "restaurant" in wanted:
        try:
            # tripadvisor16 restaurant endpoints are currently flaky upstream;
            # resolve geo via hotels/searchLocation which works on the same host.
            ta_raw = fetch_tripadvisor_restaurants(key)
        except (RapidApiConfigError, RapidApiEndpointError, ValueError) as exc:
            msg = str(exc)
            out["errors"].append(msg)
            logger.warning("tripadvisor restaurants failed for %s: %s", key, msg)
            # Fallback: Google Places Nearby (existing GOOGLE_PLACES_API_KEY)
            try:
                from app.services.places_google import fetch_places_from_google

                coords = REGION_COORDINATES[key]
                g_raw = fetch_places_from_google(
                    coords["latitude"],
                    coords["longitude"],
                    "restaurant",
                    radius_meters=12_000,
                )
                restaurants: list[dict[str, Any]] = []
                skipped = 0
                for row in g_raw:
                    place_id = row.get("place_id")
                    name = row.get("name")
                    loc = (row.get("geometry") or {}).get("location") or {}
                    try:
                        lat = float(loc.get("lat"))
                        lng = float(loc.get("lng"))
                    except (TypeError, ValueError):
                        skipped += 1
                        continue
                    if not place_id or not name:
                        skipped += 1
                        continue
                    mapped: dict[str, Any] = {
                        "name": str(name),
                        "category": "restaurant",
                        "lat": lat,
                        "lng": lng,
                        "place_id": str(place_id),
                        "data_source": "google",
                        "vicinity": row.get("vicinity"),
                        "rating": row.get("rating"),
                        "user_ratings_total": row.get("user_ratings_total"),
                    }
                    restaurants.append(mapped)
                out["fetched"]["restaurant"] = len(g_raw)
                out["mapped"]["restaurant"] = len(restaurants)
                out["skipped"]["restaurant"] = skipped
                out["places"].extend(restaurants)
                out["errors"].append(
                    "restaurant_source=google_fallback (tripadvisor restaurant API down)"
                )
            except Exception as gexc:  # noqa: BLE001 — report and continue
                out["fetched"]["restaurant"] = 0
                out["mapped"]["restaurant"] = 0
                out["skipped"]["restaurant"] = 0
                out["errors"].append(f"google_restaurant_fallback_failed: {gexc}")
        else:
            restaurants = []
            skipped = 0
            for row in ta_raw:
                mapped = map_tripadvisor_restaurant_to_place(row)
                if mapped is None:
                    skipped += 1
                    continue
                restaurants.append(mapped)
            out["fetched"]["restaurant"] = len(ta_raw)
            out["mapped"]["restaurant"] = len(restaurants)
            out["skipped"]["restaurant"] = skipped
            out["places"].extend(restaurants)

    # Camping: if Booking had no reliable matches, try Google campground
    if "camping" in wanted and out["mapped"].get("camping", 0) == 0:
        try:
            from app.services.places_google import fetch_places_from_google

            coords = REGION_COORDINATES[key]
            g_raw = fetch_places_from_google(
                coords["latitude"],
                coords["longitude"],
                "camping",
                radius_meters=20_000,
            )
            camps: list[dict[str, Any]] = []
            skipped = 0
            for row in g_raw:
                place_id = row.get("place_id")
                name = row.get("name")
                loc = (row.get("geometry") or {}).get("location") or {}
                try:
                    lat = float(loc.get("lat"))
                    lng = float(loc.get("lng"))
                except (TypeError, ValueError):
                    skipped += 1
                    continue
                if not place_id or not name:
                    skipped += 1
                    continue
                types = [str(t).lower() for t in (row.get("types") or [])]
                if "campground" not in types and not _CAMPING_RE.search(str(name)):
                    skipped += 1
                    continue
                camps.append(
                    {
                        "name": str(name),
                        "category": "camping",
                        "lat": lat,
                        "lng": lng,
                        "place_id": str(place_id),
                        "data_source": "google",
                        "vicinity": row.get("vicinity"),
                        "rating": row.get("rating"),
                        "user_ratings_total": row.get("user_ratings_total"),
                    }
                )
            out["fetched"]["camping"] = out["fetched"].get("camping", 0) + len(g_raw)
            out["mapped"]["camping"] = len(camps)
            out["skipped"]["camping"] = skipped
            out["places"].extend(camps)
            if camps:
                out["errors"].append(
                    "camping_source=google_fallback (no Booking camping matches)"
                )
        except Exception as gexc:  # noqa: BLE001
            out["errors"].append(f"google_camping_fallback_failed: {gexc}")

    return out
