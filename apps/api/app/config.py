"""Environment-backed settings."""

from __future__ import annotations

import logging
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

# Optional — Google Hotels via SerpAPI (lodging → pois)
_raw_serpapi = (os.getenv("SERPAPI_API_KEY") or "").strip()
SERPAPI_API_KEY = _raw_serpapi.strip('"').strip("'") or None

# Optional — RapidAPI (Booking.com + TripAdvisor wrappers → pois sync)
_raw_rapid = (os.getenv("RAPIDAPI_KEY") or "").strip()
RAPIDAPI_KEY = _raw_rapid.strip('"').strip("'") or None
RAPIDAPI_BOOKING_HOST = (
    (os.getenv("RAPIDAPI_BOOKING_HOST") or "booking-com15.p.rapidapi.com")
    .strip()
    .strip('"')
    .strip("'")
)
RAPIDAPI_TRIPADVISOR_HOST = (
    (os.getenv("RAPIDAPI_TRIPADVISOR_HOST") or "tripadvisor16.p.rapidapi.com")
    .strip()
    .strip('"')
    .strip("'")
)

# Optional — Geoapify Places API → pois sync
_raw_geoapify = (os.getenv("GEOAPIFY_API_KEY") or "").strip()
GEOAPIFY_API_KEY = _raw_geoapify.strip('"').strip("'") or None

# mock | osm | google | hybrid
DATA_SOURCE = (os.getenv("DATA_SOURCE") or "osm").strip().lower()
ALLOWED_DATA_SOURCES = {"mock", "osm", "google", "hybrid"}

_DEFAULT_OVERPASS = (
    "https://overpass.openstreetmap.fr/api/interpreter,"
    "https://overpass-api.de/api/interpreter,"
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
# Optional: if set, /api/telegram/test|notify requires header X-Notify-Secret
_raw_tg_secret = (os.getenv("TELEGRAM_NOTIFY_SECRET") or "").strip()
TELEGRAM_NOTIFY_SECRET = _raw_tg_secret.strip('"').strip("'") or None
# Optional: Telegram setWebhook secret_token → header X-Telegram-Bot-Api-Secret-Token
_raw_tg_webhook = (os.getenv("TELEGRAM_WEBHOOK_SECRET") or "").strip()
TELEGRAM_WEBHOOK_SECRET = _raw_tg_webhook.strip('"').strip("'") or None

# Optional: Railway cron → POST /api/jobs/* with header X-Cron-Secret
_raw_cron = (os.getenv("CRON_SECRET") or "").strip()
CRON_SECRET = _raw_cron.strip('"').strip("'") or None


def resolved_telegram_webhook_secret() -> str | None:
    """
    Prefer dedicated webhook secret; fall back to notify/cron so Railway
    bots keep working when only one server secret is configured.
    """
    for candidate in (TELEGRAM_WEBHOOK_SECRET, TELEGRAM_NOTIFY_SECRET, CRON_SECRET):
        value = (candidate or "").strip()
        if value:
            return value
    return None


def resolved_public_api_base_url() -> str | None:
    """Public HTTPS base for Telegram setWebhook (no trailing slash)."""
    for raw in (
        os.getenv("PUBLIC_API_URL"),
        os.getenv("API_PUBLIC_URL"),
        (
            f"https://{os.getenv('RAILWAY_PUBLIC_DOMAIN')}"
            if (os.getenv("RAILWAY_PUBLIC_DOMAIN") or "").strip()
            else None
        ),
    ):
        value = (raw or "").strip().strip('"').strip("'").rstrip("/")
        if value.startswith("https://") or value.startswith("http://"):
            return value
    return None


# Optional Sentry (API)
_raw_sentry = (os.getenv("SENTRY_DSN") or "").strip()
SENTRY_DSN = _raw_sentry.strip('"').strip("'") or None

# CORS: native apps send no Origin, so "*" is safe by default. Set
# CORS_ALLOW_ORIGINS to a comma-separated list to lock down browser callers.
_raw_cors = (os.getenv("CORS_ALLOW_ORIGINS") or "*").strip()
CORS_ALLOW_ORIGINS: list[str] = [
    origin.strip() for origin in _raw_cors.split(",") if origin.strip()
] or ["*"]


def validate_settings() -> None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY"
        )
    if TELEGRAM_BOT_TOKEN and not resolved_telegram_webhook_secret():
        logging.getLogger(__name__).error(
            "TELEGRAM_WEBHOOK_SECRET is unset while TELEGRAM_BOT_TOKEN is set — "
            "set TELEGRAM_WEBHOOK_SECRET (or TELEGRAM_NOTIFY_SECRET / CRON_SECRET) "
            "and POST /api/telegram/register-webhook so Telegram can call the bot."
        )
    elif TELEGRAM_BOT_TOKEN and not TELEGRAM_WEBHOOK_SECRET:
        logging.getLogger(__name__).warning(
            "TELEGRAM_WEBHOOK_SECRET unset — using TELEGRAM_NOTIFY_SECRET/CRON_SECRET "
            "fallback. Prefer a dedicated TELEGRAM_WEBHOOK_SECRET."
        )
    if DATA_SOURCE not in ALLOWED_DATA_SOURCES:
        raise RuntimeError(
            f"Invalid DATA_SOURCE={DATA_SOURCE!r}. Allowed: {sorted(ALLOWED_DATA_SOURCES)}"
        )
    if DATA_SOURCE in {"google", "hybrid"} and not GOOGLE_PLACES_API_KEY:
        raise RuntimeError(
            f"GOOGLE_PLACES_API_KEY is required when DATA_SOURCE={DATA_SOURCE}"
        )
