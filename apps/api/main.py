import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY")
# "mock" (default) | "osm" | "google"
DATA_SOURCE = (os.getenv("DATA_SOURCE") or "mock").strip().lower()
ALLOWED_DATA_SOURCES = {"mock", "osm", "google"}

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError(
        "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY"
    )

if DATA_SOURCE not in ALLOWED_DATA_SOURCES:
    raise RuntimeError(
        f"Invalid DATA_SOURCE={DATA_SOURCE!r}. Allowed: {sorted(ALLOWED_DATA_SOURCES)}"
    )

if DATA_SOURCE == "google" and not GOOGLE_PLACES_API_KEY:
    raise RuntimeError(
        "GOOGLE_PLACES_API_KEY is required when DATA_SOURCE=google"
    )

app = FastAPI(title="TripPoint Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Azərbaycanın əsas turizm bölgələrinin mərkəzi koordinatları
# Mobile REGIONS id-ləri + köhnə alias-lar (sheki/gabala)
REGION_COORDINATES: dict[str, dict[str, float]] = {
    "quba": {"latitude": 41.3625, "longitude": 48.5128},
    "qusar": {"latitude": 41.601, "longitude": 48.4295},
    "seki": {"latitude": 41.1997, "longitude": 47.1706},
    "sheki": {"latitude": 41.1997, "longitude": 47.1706},
    "qabala": {"latitude": 40.9981, "longitude": 47.8453},
    "gabala": {"latitude": 40.9981, "longitude": 47.8453},
    "lerik": {"latitude": 38.7736, "longitude": 48.415},
    "baku": {"latitude": 40.4093, "longitude": 49.8671},
}

ALLOWED_CATEGORIES = {"restaurant", "hotel", "tourist_attraction"}

GOOGLE_TYPE_MAP: dict[str, str] = {
    "restaurant": "restaurant",
    "hotel": "lodging",
    "tourist_attraction": "tourist_attraction",
}

GOOGLE_NEARBY_SEARCH_URL = (
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
)
# GET works more reliably than POST from some networks; mirrors for failover
_DEFAULT_OVERPASS = (
    "https://overpass-api.de/api/interpreter,"
    "https://overpass.openstreetmap.fr/api/interpreter,"
    "https://lz4.overpass-api.de/api/interpreter,"
    "https://overpass.kumi.systems/api/interpreter"
)
OVERPASS_ENDPOINTS: list[str] = [
    url.strip()
    for url in (os.getenv("OVERPASS_API_URL") or _DEFAULT_OVERPASS).split(",")
    if url.strip()
]
SEARCH_RADIUS_METERS = 5000
# Kiçik şəhərlərdə (Lerik, Qəbələ) OSM sparse olur — biraz daha geniş radius
OSM_SEARCH_RADIUS_METERS = 10000
OSM_RESULT_LIMIT = 30
OSM_HTTP_TIMEOUT_SECONDS = 20
OSM_CACHE_TTL_SECONDS = 600  # 10 dəq — təkrar sync-i sürətləndirir

# Mobile REGIONS.id ile uyum: sheki/gabala -> seki/qabala
REGION_DB_ID: dict[str, str] = {
    "sheki": "seki",
    "gabala": "qabala",
}

# Node-first; az selector = daha sürətli Overpass
OSM_CATEGORY_FILTERS: dict[str, list[str]] = {
    "restaurant": [
        'node["amenity"="restaurant"]["name"]',
        'node["amenity"="cafe"]["name"]',
    ],
    "hotel": [
        'node["tourism"="hotel"]["name"]',
        'node["tourism"="guest_house"]["name"]',
    ],
    "tourist_attraction": [
        'node["tourism"="attraction"]["name"]',
        'node["tourism"="museum"]["name"]',
        'node["historic"="monument"]["name"]',
    ],
}

MOCK_REGION_ALIAS: dict[str, str] = {
    "seki": "sheki",
    "qabala": "gabala",
}

# region+category -> (expires_at_epoch, places)
_OSM_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}

# Billing həll olunana qədər lokal mock POI-lər
MOCK_PLACES: dict[str, dict[str, list[dict[str, Any]]]] = {
    "baku": {
        "restaurant": [
            {
                "place_id": "mock_baku_rest_1",
                "name": "Nargiz Restaurant",
                "latitude": 40.3777,
                "longitude": 49.8520,
                "address": "Nizami Street, Baku",
                "rating": 4.5,
                "photo_reference": "mock_photo_baku_rest_1",
            },
            {
                "place_id": "mock_baku_rest_2",
                "name": "Shirvanshah Museum Restaurant",
                "latitude": 40.3662,
                "longitude": 49.8352,
                "address": "Icherisheher, Baku",
                "rating": 4.6,
                "photo_reference": "mock_photo_baku_rest_2",
            },
            {
                "place_id": "mock_baku_rest_3",
                "name": "Sumakh",
                "latitude": 40.3891,
                "longitude": 49.8478,
                "address": "Fountain Square area, Baku",
                "rating": 4.4,
                "photo_reference": "mock_photo_baku_rest_3",
            },
        ],
        "hotel": [
            {
                "place_id": "mock_baku_hotel_1",
                "name": "Fairmont Baku",
                "latitude": 40.3592,
                "longitude": 49.8355,
                "address": "Flame Towers, Baku",
                "rating": 4.7,
                "photo_reference": "mock_photo_baku_hotel_1",
            },
            {
                "place_id": "mock_baku_hotel_2",
                "name": "Marriott Absheron Baku",
                "latitude": 40.3754,
                "longitude": 49.8531,
                "address": "Azadliq Square, Baku",
                "rating": 4.5,
                "photo_reference": "mock_photo_baku_hotel_2",
            },
        ],
        "tourist_attraction": [
            {
                "place_id": "mock_baku_attr_1",
                "name": "Maiden Tower",
                "latitude": 40.3663,
                "longitude": 49.8372,
                "address": "Icherisheher, Baku",
                "rating": 4.7,
                "photo_reference": "mock_photo_baku_attr_1",
            },
            {
                "place_id": "mock_baku_attr_2",
                "name": "Heydar Aliyev Center",
                "latitude": 40.3959,
                "longitude": 49.8678,
                "address": "Heydar Aliyev Ave, Baku",
                "rating": 4.8,
                "photo_reference": "mock_photo_baku_attr_2",
            },
            {
                "place_id": "mock_baku_attr_3",
                "name": "Flame Towers",
                "latitude": 40.3593,
                "longitude": 49.8347,
                "address": "Highland Park, Baku",
                "rating": 4.6,
                "photo_reference": "mock_photo_baku_attr_3",
            },
        ],
    },
    "quba": {
        "restaurant": [
            {
                "place_id": "mock_quba_rest_1",
                "name": "Quba Chayxana",
                "latitude": 41.1610,
                "longitude": 48.5135,
                "address": "Central Quba",
                "rating": 4.3,
                "photo_reference": "mock_photo_quba_rest_1",
            },
            {
                "place_id": "mock_quba_rest_2",
                "name": "Apple Garden Cafe",
                "latitude": 41.1582,
                "longitude": 48.5098,
                "address": "Quba city center",
                "rating": 4.4,
                "photo_reference": "mock_photo_quba_rest_2",
            },
        ],
        "hotel": [
            {
                "place_id": "mock_quba_hotel_1",
                "name": "Quba Palace Hotel",
                "latitude": 41.1575,
                "longitude": 48.5150,
                "address": "Quba",
                "rating": 4.2,
                "photo_reference": "mock_photo_quba_hotel_1",
            },
            {
                "place_id": "mock_quba_hotel_2",
                "name": "Caucasus Resort Quba",
                "latitude": 41.1635,
                "longitude": 48.5201,
                "address": "Quba outskirts",
                "rating": 4.5,
                "photo_reference": "mock_photo_quba_hotel_2",
            },
        ],
        "tourist_attraction": [
            {
                "place_id": "mock_quba_attr_1",
                "name": "Quba Apple Orchards",
                "latitude": 41.1702,
                "longitude": 48.5011,
                "address": "Quba region",
                "rating": 4.6,
                "photo_reference": "mock_photo_quba_attr_1",
            },
            {
                "place_id": "mock_quba_attr_2",
                "name": "Red Village (Qirmizi Qesebe)",
                "latitude": 41.1760,
                "longitude": 48.5030,
                "address": "Near Quba",
                "rating": 4.7,
                "photo_reference": "mock_photo_quba_attr_2",
            },
        ],
    },
    "qusar": {
        "restaurant": [
            {
                "place_id": "mock_qusar_rest_1",
                "name": "Shahdag Restaurant",
                "latitude": 41.4275,
                "longitude": 48.4355,
                "address": "Qusar center",
                "rating": 4.3,
                "photo_reference": "mock_photo_qusar_rest_1",
            },
            {
                "place_id": "mock_qusar_rest_2",
                "name": "Alpine Taste",
                "latitude": 41.4248,
                "longitude": 48.4320,
                "address": "Qusar",
                "rating": 4.2,
                "photo_reference": "mock_photo_qusar_rest_2",
            },
        ],
        "hotel": [
            {
                "place_id": "mock_qusar_hotel_1",
                "name": "Shahdag Hotel & Spa",
                "latitude": 41.3210,
                "longitude": 48.1450,
                "address": "Shahdag Mountain Resort",
                "rating": 4.6,
                "photo_reference": "mock_photo_qusar_hotel_1",
            },
            {
                "place_id": "mock_qusar_hotel_2",
                "name": "Qusar Mountain Lodge",
                "latitude": 41.4255,
                "longitude": 48.4368,
                "address": "Qusar",
                "rating": 4.1,
                "photo_reference": "mock_photo_qusar_hotel_2",
            },
        ],
        "tourist_attraction": [
            {
                "place_id": "mock_qusar_attr_1",
                "name": "Shahdag Mountain Resort",
                "latitude": 41.3215,
                "longitude": 48.1445,
                "address": "Shahdag, Qusar",
                "rating": 4.8,
                "photo_reference": "mock_photo_qusar_attr_1",
            },
            {
                "place_id": "mock_qusar_attr_2",
                "name": "Laza Village Viewpoint",
                "latitude": 41.3050,
                "longitude": 48.1600,
                "address": "Laza, Qusar",
                "rating": 4.7,
                "photo_reference": "mock_photo_qusar_attr_2",
            },
        ],
    },
    "sheki": {
        "restaurant": [
            {
                "place_id": "mock_sheki_rest_1",
                "name": "Sheki Karvansaray Restaurant",
                "latitude": 41.2005,
                "longitude": 47.1708,
                "address": "Sheki historical center",
                "rating": 4.5,
                "photo_reference": "mock_photo_sheki_rest_1",
            },
            {
                "place_id": "mock_sheki_rest_2",
                "name": "Piti House Sheki",
                "latitude": 41.1925,
                "longitude": 47.1690,
                "address": "Sheki",
                "rating": 4.6,
                "photo_reference": "mock_photo_sheki_rest_2",
            },
        ],
        "hotel": [
            {
                "place_id": "mock_sheki_hotel_1",
                "name": "Sheki Palace Hotel",
                "latitude": 41.2040,
                "longitude": 47.1725,
                "address": "Sheki",
                "rating": 4.4,
                "photo_reference": "mock_photo_sheki_hotel_1",
            },
            {
                "place_id": "mock_sheki_hotel_2",
                "name": "Karvansaray Hotel",
                "latitude": 41.2010,
                "longitude": 47.1712,
                "address": "Old Sheki",
                "rating": 4.3,
                "photo_reference": "mock_photo_sheki_hotel_2",
            },
        ],
        "tourist_attraction": [
            {
                "place_id": "mock_sheki_attr_1",
                "name": "Sheki Khan's Palace",
                "latitude": 41.2043,
                "longitude": 47.1986,
                "address": "Sheki",
                "rating": 4.8,
                "photo_reference": "mock_photo_sheki_attr_1",
            },
            {
                "place_id": "mock_sheki_attr_2",
                "name": "Sheki Fortress",
                "latitude": 41.2035,
                "longitude": 47.1970,
                "address": "Sheki",
                "rating": 4.5,
                "photo_reference": "mock_photo_sheki_attr_2",
            },
        ],
    },
    "gabala": {
        "restaurant": [
            {
                "place_id": "mock_gabala_rest_1",
                "name": "Gabala Garden Restaurant",
                "latitude": 40.9825,
                "longitude": 47.8465,
                "address": "Gabala center",
                "rating": 4.3,
                "photo_reference": "mock_photo_gabala_rest_1",
            },
            {
                "place_id": "mock_gabala_rest_2",
                "name": "Tufandag Cafe",
                "latitude": 40.9750,
                "longitude": 47.8500,
                "address": "Near Tufandag, Gabala",
                "rating": 4.4,
                "photo_reference": "mock_photo_gabala_rest_2",
            },
        ],
        "hotel": [
            {
                "place_id": "mock_gabala_hotel_1",
                "name": "Qafqaz Riverside Resort",
                "latitude": 40.9780,
                "longitude": 47.8550,
                "address": "Gabala",
                "rating": 4.5,
                "photo_reference": "mock_photo_gabala_hotel_1",
            },
            {
                "place_id": "mock_gabala_hotel_2",
                "name": "Gabala Land Hotel",
                "latitude": 40.9835,
                "longitude": 47.8440,
                "address": "Gabala",
                "rating": 4.2,
                "photo_reference": "mock_photo_gabala_hotel_2",
            },
        ],
        "tourist_attraction": [
            {
                "place_id": "mock_gabala_attr_1",
                "name": "Tufandag Mountain Resort",
                "latitude": 40.9600,
                "longitude": 47.8700,
                "address": "Gabala",
                "rating": 4.7,
                "photo_reference": "mock_photo_gabala_attr_1",
            },
            {
                "place_id": "mock_gabala_attr_2",
                "name": "Nohur Lake",
                "latitude": 40.9550,
                "longitude": 47.8900,
                "address": "Near Gabala",
                "rating": 4.8,
                "photo_reference": "mock_photo_gabala_attr_2",
            },
        ],
    },
}


def to_db_region(region: str) -> str:
    """Normalize API region key to mobile/DB lowercase id."""
    key = region.strip().lower()
    return REGION_DB_ID.get(key, key)


def default_rating() -> float:
    """OSM-də rating olmur — 4.1–4.5 arası sabit görünüşlü default."""
    return round(random.uniform(4.1, 4.5), 1)


def build_address_from_tags(tags: dict[str, Any]) -> str | None:
    """Compose a short address from OSM addr:* tags."""
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
    """Resolve coordinates for node / way / relation (center)."""
    if element.get("lat") is not None and element.get("lon") is not None:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if center.get("lat") is not None and center.get("lon") is not None:
        return float(center["lat"]), float(center["lon"])
    return None


def clean_place(
    place: dict[str, Any],
    region: str,
    category: str,
) -> dict[str, Any] | None:
    """Map raw source place → Supabase `pois` row (exact column names)."""
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
        "category": category,
        "status": "approved",
        "region": to_db_region(region),
        "lat": float(latitude),
        "lng": float(longitude),
        "place_id": str(place_id),
        "rating": rating,
    }

    # Optional columns — omit None so upsert does not wipe existing values
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


def fetch_places_from_mock(region: str, category: str) -> list[dict[str, Any]]:
    """Return local mock POIs for the selected region and category."""
    mock_key = MOCK_REGION_ALIAS.get(region, region)
    region_data = MOCK_PLACES.get(mock_key, {})
    return list(region_data.get(category, []))


def fetch_places_from_google(
    latitude: float,
    longitude: float,
    category: str,
) -> list[dict[str, Any]]:
    """Fetch nearby places from Google Places Nearby Search API."""
    params = {
        "location": f"{latitude},{longitude}",
        "radius": SEARCH_RADIUS_METERS,
        "type": GOOGLE_TYPE_MAP[category],
        "key": GOOGLE_PLACES_API_KEY,
    }

    response = requests.get(GOOGLE_NEARBY_SEARCH_URL, params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()

    status = payload.get("status")
    if status not in {"OK", "ZERO_RESULTS"}:
        error_message = payload.get("error_message") or status
        raise RuntimeError(f"Google Places API error: {error_message}")

    return payload.get("results") or []


def build_overpass_query(
    latitude: float,
    longitude: float,
    selector: str,
) -> str:
    """Build a single-selector Overpass QL query (keeps requests under timeout)."""
    around = f"(around:{OSM_SEARCH_RADIUS_METERS},{latitude},{longitude})"
    return (
        f"[out:json][timeout:25];\n"
        f"{selector}{around};\n"
        f"out body {OSM_RESULT_LIMIT};"
    )


def osm_element_to_place(element: dict[str, Any]) -> dict[str, Any] | None:
    """Convert one Overpass element into the intermediate place dict."""
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
    }


def _parse_overpass_places(payload: dict[str, Any]) -> list[dict[str, Any]]:
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
        if len(places) >= OSM_RESULT_LIMIT:
            break
    return places


def _overpass_get(query: str) -> dict[str, Any]:
    """GET one Overpass query; try mirrors until JSON with elements arrives."""
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

            _log(f"[osm] ok via {endpoint}, elements={len(payload.get('elements') or [])}")
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
    """Fetch live POIs from OSM; cache + parallel selectors for speed."""
    key = cache_key or f"{latitude:.4f}:{longitude:.4f}:{category}"
    cached = _OSM_CACHE.get(key)
    now = time.time()
    if cached and cached[0] > now:
        print(f"[osm] cache hit {key} ({len(cached[1])} places)")
        return list(cached[1])

    selectors = OSM_CATEGORY_FILTERS[category]
    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def _fetch_selector(selector: str) -> list[dict[str, Any]]:
        query = build_overpass_query(latitude, longitude, selector)
        payload = _overpass_get(query)
        return _parse_overpass_places(payload)

    # Parallel Overpass calls (max 2) — UI-nin gözləməsini azaldır
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
                seen_ids.add(place_id)
                merged.append(place)

    merged = merged[:OSM_RESULT_LIMIT]
    _OSM_CACHE[key] = (now + OSM_CACHE_TTL_SECONDS, merged)
    return merged


@app.get("/")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "TripPoint Backend",
        "data_source": DATA_SOURCE,
    }


@app.get("/api/sync-places")
def sync_places(
    region: str = Query(..., description="Tourism region key, e.g. baku"),
    category: str = Query(
        ...,
        description="POI category: restaurant, hotel, or tourist_attraction",
    ),
) -> JSONResponse:
    region_key = region.strip().lower()
    category_key = category.strip().lower()

    if region_key not in REGION_COORDINATES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid region",
                "message": f"Region '{region}' is not supported.",
                "allowed_regions": list(REGION_COORDINATES.keys()),
            },
        )

    if category_key not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid category",
                "message": f"Category '{category}' is not supported.",
                "allowed_categories": sorted(ALLOWED_CATEGORIES),
            },
        )

    coordinates = REGION_COORDINATES[region_key]
    db_region = to_db_region(region_key)

    try:
        if DATA_SOURCE == "google":
            raw_places = fetch_places_from_google(
                latitude=coordinates["latitude"],
                longitude=coordinates["longitude"],
                category=category_key,
            )
        elif DATA_SOURCE == "osm":
            raw_places = fetch_places_from_osm(
                latitude=coordinates["latitude"],
                longitude=coordinates["longitude"],
                category=category_key,
                cache_key=f"{db_region}:{category_key}",
            )
        else:
            # DATA_SOURCE=mock (default) — mövcud mock axını dəyişməz
            raw_places = fetch_places_from_mock(region_key, category_key)

        cleaned_places = [
            cleaned
            for place in raw_places
            if (cleaned := clean_place(place, region_key, category_key)) is not None
        ]

        if not cleaned_places:
            return JSONResponse(
                content={
                    "success": True,
                    "data_source": DATA_SOURCE,
                    "region": db_region,
                    "category": category_key,
                    "fetched": 0,
                    "upserted": 0,
                    "message": "No places found for the given region and category.",
                }
            )

        result = (
            supabase.table("pois")
            .upsert(cleaned_places, on_conflict="place_id")
            .execute()
        )

        upserted_count = len(result.data) if result.data else len(cleaned_places)

        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": db_region,
                "category": category_key,
                "fetched": len(raw_places),
                "upserted": upserted_count,
                "data": result.data or cleaned_places,
            }
        )

    except requests.RequestException as exc:
        source_label = {
            "google": "Google Places API",
            "osm": "OpenStreetMap Overpass API",
        }.get(DATA_SOURCE, "external data source")
        return JSONResponse(
            status_code=502,
            content={
                "success": False,
                "error": "network_error",
                "message": f"Failed to reach {source_label}.",
                "details": str(exc),
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "sync_failed",
                "message": "Failed to sync places due to an external API or database error.",
                "details": str(exc),
            },
        )
