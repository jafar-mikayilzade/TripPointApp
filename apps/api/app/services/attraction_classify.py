"""Refine Google tourist_attraction stamps into nature vs historical (etc.).

Nearby Search uses one Google type for both; without this, interest filters
cannot work (everything looks like 'nature' or everything like 'historical').
"""

from __future__ import annotations

import re
from typing import Any

NATURE_CATS = frozenset({"nature", "waterfall", "mountain", "lake"})
HISTORICAL_CATS = frozenset({"historical", "monument"})

# Mobile InterestId / category chips → attraction categories (shared by plan + candidates)
# "nature" does NOT include mountain — dağ yalnız ayrıca seçiləndə əlavə olunur.
INTEREST_ATTRACTION_CATS: dict[str, set[str]] = {
    "nature": {"nature"},
    "waterfall": {"waterfall"},
    "mountain": {"mountain"},
    "lake": {"lake"},
    "history": {"historical", "monument"},
    "historical": {"historical"},
    "monument": {"monument"},
    "food": set(),
    "family": {"historical", "nature", "lake", "other", "monument"},
    "active": {"mountain", "nature", "waterfall"},
    "photo": {"nature", "waterfall", "historical", "monument", "lake"},
}


def interest_attraction_cats(interests: list[str] | None) -> set[str]:
    cats: set[str] = set()
    for raw in interests or []:
        key = str(raw or "").strip().lower()
        cats |= INTEREST_ATTRACTION_CATS.get(key, set())
    return cats


_WATERFALL_RE = re.compile(
    r"şəlal|selal|waterfall|falls?\b|афурджа|afurc|afurja",
    re.I,
)
_LAKE_RE = re.compile(r"\bgöl\b|\bgol\b|\blake\b|nohur|reservoir", re.I)
_MOUNTAIN_RE = re.compile(
    r"dağ\b|dag\b|mountain|peak|zirv|tufanda[gğ]|şahda[gğ]|shahdag",
    re.I,
)
# OSM peaks often named like "Yerfi 2076.7 metr"
_PEAK_ELEV_RE = re.compile(r"\d{3,4}(?:[.,]\d+)?\s*m(?:etr)?\b", re.I)
_NATURE_RE = re.compile(
    r"təbiət|tebiet|nature|park\b|meşə|mesa|forest|canyon|kanyon|"
    r"təngəaltı|tangaalti|qəçrəş|qachresh|gechresh|viewpoint|"
    r"picnic|istirahət|istirahet|resort\s*zone",
    re.I,
)
_HISTORICAL_RE = re.compile(
    r"muzey|museum|saray|palace|qala\b|castle|fort|məbə[dt]|mebed|"
    r"məscid|mescid|mosque|kilsə|kilse|church|tarix|history|"
    r"karvansara|caravanserai|abidə|abide|monument|memorial|"
    r"xan\s*saray|alban|içəri|icheri|maiden\s*tower|qız\s*qala",
    re.I,
)
_MONUMENT_RE = re.compile(r"abidə|abide|monument|memorial|heykəl|heykel", re.I)

HIST_TYPES = frozenset(
    {
        "museum",
        "art_gallery",
        "church",
        "mosque",
        "hindu_temple",
        "synagogue",
        "city_hall",
        "embassy",
        "library",
        "cemetery",
    }
)
NATURE_TYPES = frozenset(
    {
        "park",
        "campground",
        "rv_park",
        "zoo",
        "aquarium",
        "natural_feature",
    }
)


def refine_attraction_category(
    row: dict[str, Any],
    *,
    stamped: str | None = None,
) -> str:
    """
    Return app category for an attraction-like place.
    Keeps lodging/food stamps untouched if caller passes those.
    """
    cat = str(stamped or row.get("category") or "").strip().lower()
    if cat in {
        "restaurant",
        "home_restaurant",
        "cafe",
        "hotel",
        "hostel",
        "guesthouse",
        "camping",
    }:
        return cat

    name = str(row.get("name") or "")
    types = {
        str(t).strip().lower()
        for t in (row.get("types") or row.get("google_types") or [])
        if str(t).strip()
    }

    if _WATERFALL_RE.search(name):
        return "waterfall"
    if _LAKE_RE.search(name):
        return "lake"
    if _MOUNTAIN_RE.search(name):
        return "mountain"
    if _MONUMENT_RE.search(name) and not _NATURE_RE.search(name):
        return "monument"
    if _HISTORICAL_RE.search(name) or (types & HIST_TYPES):
        return "historical"
    if types & NATURE_TYPES or _NATURE_RE.search(name):
        return "nature"

    # Preserve already-specific stamps from seeds / OSM
    if cat in NATURE_CATS | HISTORICAL_CATS | {"other"}:
        return cat

    # Default tourist_attraction without signal → nature (regional tourism bias)
    return "nature" if cat in {"", "tourist_attraction", "point_of_interest"} else cat


def classify_attraction_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        r = dict(row)
        cat = str(r.get("category") or "").strip().lower()
        if cat in {
            "restaurant",
            "home_restaurant",
            "cafe",
            "hotel",
            "hostel",
            "guesthouse",
            "camping",
        }:
            out.append(r)
            continue
        r["category"] = refine_attraction_category(r)
        out.append(r)
    return out


def _row_category_set(row: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    raw = row.get("categories")
    if isinstance(raw, (list, tuple)):
        for item in raw:
            c = str(item or "").strip().lower()
            if c:
                out.add(c)
    primary = str(row.get("category") or "").strip().lower()
    if primary:
        out.add(primary)
    return out


def looks_like_mountain_peak(row: dict[str, Any]) -> bool:
    """True for mountain/peak POIs (category, name, or elevation label)."""
    cats = _row_category_set(row)
    if "mountain" in cats:
        return True
    name = str(row.get("name") or "")
    if _WATERFALL_RE.search(name) or _LAKE_RE.search(name):
        return False
    if _MOUNTAIN_RE.search(name) or _PEAK_ELEV_RE.search(name):
        return True
    return refine_attraction_category(row) == "mountain"


def attraction_matches_interests(
    row: dict[str, Any],
    interest_cats: set[str] | None,
) -> bool:
    """
    Interest match with hard mountain gate.

    POIs often carry categories=['nature','mountain']. Matching only on
    intersection would let peaks into a «Təbiət» plan — reject mountains
    unless «mountain» is explicitly in the interest set.
    """
    if not interest_cats:
        return True
    if "mountain" not in interest_cats and looks_like_mountain_peak(row):
        return False
    cats = _row_category_set(row)
    if not cats:
        refined = refine_attraction_category(row)
        cats = {refined} if refined else set()
    return bool(cats & set(interest_cats))
