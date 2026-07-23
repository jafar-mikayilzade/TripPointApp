"""Environment-backed settings."""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip()
SUPABASE_SERVICE_KEY = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
# Strip quotes/whitespace — Railway paste often adds trailing spaces or quotes
_raw_google_key = (os.getenv("GOOGLE_PLACES_API_KEY") or "").strip()
GOOGLE_PLACES_API_KEY = _raw_google_key.strip('"').strip("'") or None

_raw_ow_key = (os.getenv("OPENWEATHER_API_KEY") or "").strip()
OPENWEATHER_API_KEY = _raw_ow_key.strip('"').strip("'") or None

# Optional — plan-route tips only; itinerary works without it
_raw_anthropic = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
ANTHROPIC_API_KEY = _raw_anthropic.strip('"').strip("'") or None

# mock | osm | google | hybrid
DATA_SOURCE = (os.getenv("DATA_SOURCE") or "mock").strip().lower()
ALLOWED_DATA_SOURCES = {"mock", "osm", "google", "hybrid"}

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
OSM_SEARCH_RADIUS_METERS = 15000
OSM_RESULT_LIMIT = 30
OSM_RESULT_LIMIT_ALL = 120
# "all" sync: hər app kateqoriyasına ayrı kvota (restoran digərlərini boğmasın)
OSM_PER_CATEGORY_LIMIT = 10
OSM_HTTP_TIMEOUT_SECONDS = 28
OSM_CACHE_TTL_SECONDS = 600
# hybrid "all": name+coords dedupe radius (meters)
HYBRID_DEDUPE_METERS = 90

# Optional Telegram admin notify (Railway env; never hardcode)
_raw_tg_token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
TELEGRAM_BOT_TOKEN = _raw_tg_token.strip('"').strip("'") or None
_raw_tg_chat = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
TELEGRAM_CHAT_ID = _raw_tg_chat.strip('"').strip("'") or None
# Optional: if set, /api/telegram/* requires header X-Notify-Secret
_raw_tg_secret = (os.getenv("TELEGRAM_NOTIFY_SECRET") or "").strip()
TELEGRAM_NOTIFY_SECRET = _raw_tg_secret.strip('"').strip("'") or None


def validate_settings() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY"
        )
    if DATA_SOURCE not in ALLOWED_DATA_SOURCES:
        raise RuntimeError(
            f"Invalid DATA_SOURCE={DATA_SOURCE!r}. Allowed: {sorted(ALLOWED_DATA_SOURCES)}"
        )
    if DATA_SOURCE in {"google", "hybrid"} and not GOOGLE_PLACES_API_KEY:
        raise RuntimeError(
            f"GOOGLE_PLACES_API_KEY is required when DATA_SOURCE={DATA_SOURCE}"
        )
