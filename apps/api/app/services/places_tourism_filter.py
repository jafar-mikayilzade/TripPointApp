"""Drop non-tourism places; keep attractions / lodging / quality food.

Used by live home map, Qur live, and AI route candidates.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.geo_route import haversine_km
from app.services.rank_pois import (
    ACCOMMODATION_CATS,
    ATTRACTION_CATS,
    RESTAURANT_CATS,
)

# Food quality bar (tunable)
FOOD_MIN_RATING = 4.0
FOOD_MIN_REVIEWS = 30

# Soft floor for tourism types when reviews exist
ATTRACTION_MIN_RATING = 3.2

# Google types that are almost never tourism product signal
BAD_GOOGLE_TYPES = frozenset(
    {
        "cafe",
        "meal_takeaway",
        "meal_delivery",
        "bakery",
        "night_club",
        "bar",
        "liquor_store",
        "convenience_store",
        "supermarket",
        "grocery_or_supermarket",
        "pharmacy",
        "bank",
        "atm",
        "gas_station",
        "car_wash",
        "car_repair",
        "funeral_home",
        "cemetery",
        "shopping_mall",
        "store",
        "clothing_store",
        "electronics_store",
        "furniture_store",
        "home_goods_store",
        "hair_care",
        "beauty_salon",
        "gym",
        "hospital",
        "doctor",
        "dentist",
        "school",
        "university",
        "local_government_office",
        "police",
        "post_office",
        "parking",
        "transit_station",
    }
)

# Explicit wedding / banquet noise
BAD_GOOGLE_TYPES_STRICT = frozenset(
    {
        "wedding_venue",  # may not always appear
    }
)

# Name substrings (AZ / RU / EN) — non-tourism everyday venues
_NAME_BLACKLIST_PATTERNS = [
    r"d[öo]n[eə]r",
    r"doner",
    r"shawarma",
    r"shaurma",
    r"çayxana",
    r"cayxana",
    r"çay\s*evi",
    r"chayxana",
    r"tea\s*house",
    r"şadlıq",
    r"sadliq",
    r"toy\s*saray",
    r"wedding",
    r"banquet",
    r"supermarket",
    r"market\b",
    r"aptek",
    r"pharmacy",
    r"\bbank\b",
    r"lombard",
    r"avtoyuma",
    r"car\s*wash",
    r"telefon\s*t[əe]mir",
    r"telefon\s*temir",
    r"fast\s*food",
    r"burger\s*king",
    r"mcdonald",
    r"kfc\b",
    r"papajohns",
    r"pizza\s*hut",
    r"starbucks",
    r"coffee\s*shop",
    r"kafe\b",
    r"\bcafe\b",
    r"çörək",
    r"corek",
    r"bakery",
    r"lavaş",
    r"lavash",
    r"dükkan",
    r"dukan",
    r"magaza",
    r"mağaza",
]

_NAME_BLACKLIST_RE = re.compile(
    "|".join(f"(?:{p})" for p in _NAME_BLACKLIST_PATTERNS),
    re.IGNORECASE,
)

# Prefer AZ/EN (Latin + Azerbaijani letters). Drop heavy Cyrillic / Arabic-Persian.
_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
_ARABIC_PERSIAN_RE = re.compile(r"[\u0600-\u06FF]")
# Letters counted for ratio (Latin/AZ + forbidden scripts)
_LETTER_RE = re.compile(
    r"[A-Za-zÀ-ÖØ-öø-ÿƏəİıÖöÜüŞşÇçĞğ\u0400-\u04FF\u0600-\u06FF]"
)
FORBIDDEN_SCRIPT_RATIO = 0.35

FOOD_CATS = RESTAURANT_CATS
LODGING_CATS = ACCOMMODATION_CATS
TOURISM_ATTRACTION_CATS = ATTRACTION_CATS


def name_is_blacklisted(name: str | None) -> bool:
    if not name or not str(name).strip():
        return False
    return bool(_NAME_BLACKLIST_RE.search(str(name)))


def text_has_forbidden_script(
    text: str | None,
    *,
    ratio: float = FORBIDDEN_SCRIPT_RATIO,
) -> bool:
    """True if Cyrillic or Arabic/Persian letters are a large share of the text."""
    if not text or not str(text).strip():
        return False
    letters = _LETTER_RE.findall(str(text))
    if not letters:
        return False
    forbidden = sum(
        1
        for ch in letters
        if _CYRILLIC_RE.match(ch) or _ARABIC_PERSIAN_RE.match(ch)
    )
    return (forbidden / len(letters)) >= ratio


def name_has_forbidden_script(name: str | None) -> bool:
    """Reject place names that are primarily Russian or Persian/Arabic script."""
    return text_has_forbidden_script(name)


def sanitize_tip_text(tip: str | None) -> str:
    """Drop tips that still contain forbidden scripts (Claude may copy place names)."""
    if not tip or not str(tip).strip():
        return ""
    text = str(tip).strip()
    if text_has_forbidden_script(text):
        return ""
    return text


def google_types_of(row: dict[str, Any]) -> set[str]:
    raw = row.get("types") or row.get("google_types") or []
    if not isinstance(raw, (list, tuple, set)):
        return set()
    return {str(t).strip().lower() for t in raw if str(t).strip()}


def _near_strong_hub(
    row: dict[str, Any],
    hubs: list[dict[str, Any]] | None,
    *,
    min_weight: float = 0.85,
    radius_factor: float = 1.0,
) -> bool:
    """True if POI sits inside a high-weight tourism hub (core zone by default)."""
    if not hubs:
        return False
    try:
        lat = float(row["lat"])
        lng = float(row["lng"])
    except (KeyError, TypeError, ValueError):
        return False
    for hub in hubs:
        try:
            w = float(hub.get("weight") or 0)
            if w < min_weight:
                continue
            hlat = float(hub["lat"])
            hlng = float(hub["lng"])
            radius_km = float(hub.get("radius_m") or 8000) / 1000.0
            # Food exceptions use a tighter core so city-center spillover is rare
            if haversine_km(lat, lng, hlat, hlng) <= radius_km * radius_factor:
                return True
        except (KeyError, TypeError, ValueError):
            continue
    return False


def _food_quality_ok(row: dict[str, Any]) -> bool:
    try:
        rating = float(row["rating"]) if row.get("rating") is not None else None
    except (TypeError, ValueError):
        rating = None
    try:
        count = int(row["rating_count"]) if row.get("rating_count") is not None else 0
    except (TypeError, ValueError):
        count = 0
    if rating is None:
        return False
    return rating >= FOOD_MIN_RATING and count >= FOOD_MIN_REVIEWS


def passes_tourism_filter(
    row: dict[str, Any],
    *,
    hubs: list[dict[str, Any]] | None = None,
    keep_seeds: bool = True,
) -> bool:
    """Return False to drop row from live/plan candidate lists."""
    if keep_seeds and row.get("is_seed"):
        seed_name = str(row.get("name") or "")
        return not (
            name_is_blacklisted(seed_name) or name_has_forbidden_script(seed_name)
        )

    cat = str(row.get("category") or "").strip().lower()
    name = str(row.get("name") or "")

    if cat == "cafe":
        return False
    if name_is_blacklisted(name):
        return False
    if name_has_forbidden_script(name):
        return False

    types = google_types_of(row)
    if types & BAD_GOOGLE_TYPES_STRICT:
        return False
    # Drop if primary noise types present (unless lodging/attraction stamped)
    if types & BAD_GOOGLE_TYPES:
        if cat not in LODGING_CATS | TOURISM_ATTRACTION_CATS:
            return False
        # Still drop obvious retail even if mis-stamped
        if types & {
            "supermarket",
            "pharmacy",
            "bank",
            "gas_station",
            "car_wash",
            "shopping_mall",
        }:
            return False

    if "fast_food" in types and cat in FOOD_CATS:
        if not (row.get("is_seed") or _near_strong_hub(row, hubs)):
            return False

    if cat in FOOD_CATS:
        if _food_quality_ok(row):
            return True
        # Allow decent food only in hub core (not city spillover from large radius)
        if _near_strong_hub(row, hubs, radius_factor=0.4) and row.get("rating") is not None:
            try:
                if float(row["rating"]) >= 4.0:
                    return True
            except (TypeError, ValueError):
                pass
        return False

    if cat in LODGING_CATS | TOURISM_ATTRACTION_CATS:
        if row.get("rating") is None:
            return True
        try:
            return float(row["rating"]) >= ATTRACTION_MIN_RATING
        except (TypeError, ValueError):
            return True

    # Unknown category — only keep if near strong hub and not blacklisted
    return _near_strong_hub(row, hubs)


def filter_tourism_rows(
    rows: list[dict[str, Any]],
    *,
    hubs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    return [r for r in rows if passes_tourism_filter(r, hubs=hubs)]
