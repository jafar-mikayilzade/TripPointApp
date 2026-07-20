"""Regional weather via OpenWeather — cached to cut API cost & latency."""

from __future__ import annotations

import time
from typing import Any

import requests

from app.config import OPENWEATHER_API_KEY
from app.constants.regions import REGION_COORDINATES

# Free-tier friendly: one forecast call covers ~5 days; reuse across users.
CACHE_TTL_SECONDS = 45 * 60
_cache: dict[str, tuple[float, dict[str, Any]]] = {}

# Outdoor / exposed categories the AI should drop when rain is heavy
OUTDOOR_CATEGORIES = ("nature", "waterfall", "mountain", "lake")
INDOOR_PREFERRED = (
    "historical",
    "monument",
    "restaurant",
    "home_restaurant",
    "cafe",
    "hotel",
    "hostel",
    "guesthouse",
)

# mm over a 3h bucket, or pop (0–1)
RAIN_MM_HEAVY = 4.0
RAIN_POP_HEAVY = 0.55


def _cache_get(key: str) -> dict[str, Any] | None:
    hit = _cache.get(key)
    if not hit:
        return None
    expires_at, payload = hit
    if time.time() > expires_at:
        _cache.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    _cache[key] = (time.time() + CACHE_TTL_SECONDS, payload)


def _slot_rain_mm(slot: dict[str, Any]) -> float:
    rain = slot.get("rain") or {}
    if isinstance(rain, dict):
        return float(rain.get("3h") or rain.get("1h") or 0)
    return 0.0


def analyze_forecast(slots: list[dict[str, Any]], days: int) -> dict[str, Any]:
    """Inspect next `days` of 3h forecast slots."""
    limit = max(1, min(days, 5)) * 8  # ~8 slots/day
    window = slots[:limit]
    heavy_slots = 0
    max_mm = 0.0
    max_pop = 0.0
    summaries: list[str] = []

    for slot in window:
        mm = _slot_rain_mm(slot)
        pop = float(slot.get("pop") or 0)
        max_mm = max(max_mm, mm)
        max_pop = max(max_pop, pop)
        if mm >= RAIN_MM_HEAVY or pop >= RAIN_POP_HEAVY:
            heavy_slots += 1
        weather = (slot.get("weather") or [{}])[0]
        desc = weather.get("description") or weather.get("main") or ""
        if desc and desc not in summaries:
            summaries.append(str(desc))

    prefer_indoor = heavy_slots >= 2 or max_mm >= RAIN_MM_HEAVY or max_pop >= 0.7

    if prefer_indoor:
        summary_az = (
            "Güclü yağış riski var — açıq hava / dağ marşrutları azaldılır, "
            "muzey, restoran və qapalı məkanlar üstün tutulur."
        )
    else:
        summary_az = "Hava ümumən uyğundur — açıq və qapalı məkanlar qarışıq planlana bilər."

    return {
        "prefer_indoor": prefer_indoor,
        "summary_az": summary_az,
        "exclude_categories": list(OUTDOOR_CATEGORIES) if prefer_indoor else [],
        "prefer_categories": list(INDOOR_PREFERRED) if prefer_indoor else [],
        "max_rain_mm": round(max_mm, 2),
        "max_pop": round(max_pop, 2),
        "heavy_slots": heavy_slots,
        "conditions": summaries[:5],
    }


def fetch_region_weather(region_key: str, days: int = 3) -> dict[str, Any]:
    key = region_key.strip().lower()
    if key not in REGION_COORDINATES:
        return {
            "ok": False,
            "error": "unknown_region",
            "allowed_regions": list(REGION_COORDINATES.keys()),
        }

    if not OPENWEATHER_API_KEY:
        # Soft fail — AI still works without weather bias
        return {
            "ok": True,
            "cached": False,
            "region": key,
            "prefer_indoor": False,
            "summary_az": "Hava məlumatı konfiqurasiya olunmayıb.",
            "exclude_categories": [],
            "prefer_categories": [],
            "available": False,
        }

    cache_key = f"{key}:{max(1, min(days, 5))}"
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}

    coords = REGION_COORDINATES[key]
    url = "https://api.openweathermap.org/data/2.5/forecast"
    params = {
        "lat": coords["latitude"],
        "lon": coords["longitude"],
        "appid": OPENWEATHER_API_KEY,
        "units": "metric",
        "lang": "az",
    }

    try:
        response = requests.get(url, params=params, timeout=8)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        return {
            "ok": False,
            "error": "weather_fetch_failed",
            "detail": str(exc)[:200],
            "region": key,
        }

    slots = data.get("list") or []
    analysis = analyze_forecast(slots, days)
    payload = {
        "ok": True,
        "available": True,
        "region": key,
        "cached": False,
        **analysis,
    }
    _cache_set(cache_key, payload)
    return payload
