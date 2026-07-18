"""Environment-backed settings."""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY")

# mock | osm | google
DATA_SOURCE = (os.getenv("DATA_SOURCE") or "mock").strip().lower()
ALLOWED_DATA_SOURCES = {"mock", "osm", "google"}

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
OSM_SEARCH_RADIUS_METERS = 10000
OSM_RESULT_LIMIT = 30
OSM_RESULT_LIMIT_ALL = 120
# "all" sync: hər app kateqoriyasına ayrı kvota (restoran digərlərini boğmasın)
OSM_PER_CATEGORY_LIMIT = 10
OSM_HTTP_TIMEOUT_SECONDS = 20
OSM_CACHE_TTL_SECONDS = 600


def validate_settings() -> None:
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
