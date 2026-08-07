"""Geoapify Places API → standardized place dicts for pois.

Docs: https://apidocs.geoapify.com/docs/places/
Endpoint: https://api.geoapify.com/v2/places
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Literal

import requests

from app.config import GEOAPIFY_API_KEY
from app.constants.regions import REGION_COORDINATES, REGION_LABELS
from app.services.geo_route import haversine_km

logger = logging.getLogger(__name__)

Kind = Literal["hotel", "restaurant", "camping", "lake", "waterfall"]

PLACES_URL = "https://api.geoapify.com/v2/places"
GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search"

# App category → Geoapify Places categories (comma-joined)
GEOAPIFY_CATEGORY_MAP: dict[Kind, str] = {
    "hotel": "accommodation.hotel",
    "restaurant": "catering.restaurant",
    "camping": "camping,camping.camp_site",
    "lake": "natural.water",
    # No dedicated waterfall category on Geoapify — resolved via geocode + name filters
    "waterfall": "",
}

DEFAULT_RADIUS_M = {
    "hotel": 25_000,
    "restaurant": 20_000,
    "camping": 35_000,
    "lake": 40_000,
    "waterfall": 45_000,
}

_WATERFALL_NAME_RE = re.compile(
    r"(şəlal|selale|waterfall|falls|afurc|afurj|mucuq|laza)",
    re.IGNORECASE,
)
_LAKE_NAME_RE = re.compile(
    r"(göl|gol|lake|reservoir|ambar|vir\b)",
    re.IGNORECASE,
)
_MAX_ATTEMPTS = 3
_HTTP_TIMEOUT = 40


class GeoapifyConfigError(RuntimeError):
    pass


class GeoapifyEndpointError(RuntimeError):
    pass


def require_geoapify_key() -> str:
    if not GEOAPIFY_API_KEY:
        raise GeoapifyConfigError(
            "GEOAPIFY_API_KEY is not set. Add it to apps/api/.env "
            "(https://www.geoapify.com/ — MyProjects → API Keys)."
        )
    return GEOAPIFY_API_KEY


def _get_json(url: str, params: dict[str, Any], *, label: str) -> dict[str, Any]:
    key = require_geoapify_key()
    params = {**params, "apiKey": key}
    last_err: Exception | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            resp = requests.get(url, params=params, timeout=_HTTP_TIMEOUT)
            if resp.status_code in {401, 403}:
                raise GeoapifyEndpointError(
                    f"{label}: HTTP {resp.status_code} — check GEOAPIFY_API_KEY"
                )
            if resp.status_code == 429:
                last_err = GeoapifyEndpointError(f"{label}: rate limited (429)")
                time.sleep(1.2 * attempt)
                continue
            if resp.status_code >= 400:
                try:
                    detail = resp.json().get("message") or resp.text[:200]
                except Exception:
                    detail = resp.text[:200]
                raise GeoapifyEndpointError(
                    f"{label}: HTTP {resp.status_code} — {detail}"
                )
            payload = resp.json()
            if not isinstance(payload, dict):
                raise GeoapifyEndpointError(f"{label}: unexpected payload type")
            return payload
        except GeoapifyEndpointError:
            raise
        except requests.RequestException as exc:
            last_err = exc
            logger.warning("%s attempt %s failed: %s", label, attempt, exc)
            time.sleep(0.7 * attempt)
    raise GeoapifyEndpointError(f"{label}: failed after {_MAX_ATTEMPTS} attempts ({last_err})")


def _feature_props(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties") or {}
    return props if isinstance(props, dict) else {}


def map_geoapify_feature_to_place(
    feature: dict[str, Any],
    *,
    category: Kind,
) -> dict[str, Any] | None:
    props = _feature_props(feature)
    name = props.get("name") or props.get("address_line1")
    if not name or not str(name).strip():
        return None
    try:
        lat = float(props.get("lat"))
        lng = float(props.get("lon"))
    except (TypeError, ValueError):
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not isinstance(coords, list) or len(coords) < 2:
            return None
        try:
            lng = float(coords[0])
            lat = float(coords[1])
        except (TypeError, ValueError):
            return None

    raw_id = props.get("place_id") or props.get("osm_id") or f"{lat:.5f},{lng:.5f}"
    place: dict[str, Any] = {
        "name": str(name).strip(),
        "category": category,
        "lat": lat,
        "lng": lng,
        "place_id": f"geoapify:{raw_id}",
        "data_source": "geoapify",
    }
    formatted = props.get("formatted") or props.get("address_line2")
    if formatted:
        place["address"] = str(formatted)
    website = props.get("website") or props.get("url")
    if website:
        place["website"] = str(website)
    phone = props.get("contact", {}).get("phone") if isinstance(props.get("contact"), dict) else props.get("phone")
    if phone:
        place["phone"] = str(phone)
    return place


def fetch_places_circle(
    *,
    lon: float,
    lat: float,
    categories: str,
    radius_m: int,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Paginate Places API within a circle (limit max 500/page)."""
    features: list[dict[str, Any]] = []
    offset = 0
    page_limit = min(max(limit, 1), 100)
    while offset < limit:
        batch_limit = min(page_limit, limit - offset)
        payload = _get_json(
            PLACES_URL,
            {
                "categories": categories,
                "filter": f"circle:{lon},{lat},{int(radius_m)}",
                "bias": f"proximity:{lon},{lat}",
                "limit": batch_limit,
                "offset": offset,
                "lang": "en",
            },
            label=f"places:{categories}",
        )
        batch = [f for f in (payload.get("features") or []) if isinstance(f, dict)]
        features.extend(batch)
        if len(batch) < batch_limit:
            break
        offset += batch_limit
        if offset >= 500:
            # free-tier friendly cap per category/region
            break
    return features


def _keep_as_lake(props: dict[str, Any]) -> bool:
    name = str(props.get("name") or "")
    cats = [str(c).lower() for c in (props.get("categories") or [])]
    joined = " ".join(cats)
    if "sea" in joined and "inland" not in joined:
        # coastal sea nodes — skip for mountain rayons
        if not _LAKE_NAME_RE.search(name):
            return False
    if not name.strip():
        return False
    if _LAKE_NAME_RE.search(name):
        return True
    # named inland water without sea
    return "natural.water" in joined and "sea" not in joined


def fetch_waterfalls_for_region(region_key: str, *, radius_m: int) -> list[dict[str, Any]]:
    """Geoapify has no waterfall Places category — use geocode + name heuristics."""
    coords = REGION_COORDINATES[region_key]
    lat = coords["latitude"]
    lng = coords["longitude"]
    label = REGION_LABELS.get(region_key, region_key)
    queries = [
        f"waterfall {label} Azerbaijan",
        f"şəlalə {label}",
        f"{label} waterfall",
    ]
    seen: set[str] = set()
    features: list[dict[str, Any]] = []
    for q in queries:
        payload = _get_json(
            GEOCODE_URL,
            {
                "text": q,
                "filter": "countrycode:az",
                "bias": f"proximity:{lng},{lat}",
                "limit": 10,
                "lang": "en",
            },
            label=f"geocode:{q}",
        )
        for feat in payload.get("features") or []:
            if not isinstance(feat, dict):
                continue
            props = _feature_props(feat)
            name = str(props.get("name") or props.get("formatted") or "")
            if not _WATERFALL_NAME_RE.search(name):
                continue
            # skip cities / plain populated places
            result_type = str(props.get("result_type") or "")
            if result_type in {"city", "postcode", "county", "state", "country"}:
                continue
            try:
                plat = float(props.get("lat"))
                plng = float(props.get("lon"))
            except (TypeError, ValueError):
                continue
            if haversine_km(lat, lng, plat, plng) > (radius_m / 1000.0):
                continue
            pid = str(props.get("place_id") or f"{plat:.5f},{plng:.5f}")
            if pid in seen:
                continue
            seen.add(pid)
            features.append(feat)
    return features


def fetch_standardized_for_region(
    region_key: str,
    *,
    kinds: list[Kind] | None = None,
) -> dict[str, Any]:
    key = region_key.strip().lower()
    if key not in REGION_COORDINATES:
        raise ValueError(f"Unknown region '{region_key}'")

    wanted: list[Kind] = kinds or ["hotel", "restaurant", "camping", "lake", "waterfall"]
    coords = REGION_COORDINATES[key]
    lat = coords["latitude"]
    lng = coords["longitude"]

    out: dict[str, Any] = {
        "region": key,
        "places": [],
        "fetched": {},
        "mapped": {},
        "skipped": {},
        "errors": [],
    }

    for kind in wanted:
        radius = DEFAULT_RADIUS_M.get(kind, 25_000)
        try:
            if kind == "waterfall":
                raw = fetch_waterfalls_for_region(key, radius_m=radius)
            else:
                categories = GEOAPIFY_CATEGORY_MAP[kind]
                raw = fetch_places_circle(
                    lon=lng,
                    lat=lat,
                    categories=categories,
                    radius_m=radius,
                    limit=100,
                )
        except (GeoapifyConfigError, GeoapifyEndpointError) as exc:
            out["errors"].append(str(exc))
            out["fetched"][kind] = 0
            out["mapped"][kind] = 0
            out["skipped"][kind] = 0
            # Auth errors should abort caller
            if "401" in str(exc) or "403" in str(exc) or "GEOAPIFY_API_KEY" in str(exc):
                raise
            logger.warning("geoapify %s failed for %s: %s", kind, key, exc)
            continue

        places: list[dict[str, Any]] = []
        skipped = 0
        for feat in raw:
            props = _feature_props(feat)
            if kind == "lake" and not _keep_as_lake(props):
                skipped += 1
                continue
            if kind == "waterfall" and not _WATERFALL_NAME_RE.search(
                str(props.get("name") or props.get("formatted") or "")
            ):
                skipped += 1
                continue
            mapped = map_geoapify_feature_to_place(feat, category=kind)
            if mapped is None:
                skipped += 1
                continue
            places.append(mapped)

        out["fetched"][kind] = len(raw)
        out["mapped"][kind] = len(places)
        out["skipped"][kind] = skipped
        out["places"].extend(places)

    return out
