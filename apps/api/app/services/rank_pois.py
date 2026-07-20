"""Rank POIs by external rating for AI route planning."""

from __future__ import annotations

from typing import Any

# Soft floor: below this, treat as weak even if present
MIN_USEFUL_RATING = 3.5

RESTAURANT_CATS = frozenset({"restaurant", "home_restaurant", "cafe"})
ACCOMMODATION_CATS = frozenset({"hotel", "hostel", "guesthouse"})
ATTRACTION_CATS = frozenset(
    {
        "nature",
        "waterfall",
        "mountain",
        "lake",
        "historical",
        "monument",
        "other",
    }
)


def rating_sort_key(row: dict[str, Any]) -> tuple[float, int]:
    """Higher rating first; more reviews as tie-breaker; nulls last."""
    raw = row.get("rating")
    try:
        rating = float(raw) if raw is not None else -1.0
    except (TypeError, ValueError):
        rating = -1.0

    raw_count = row.get("rating_count")
    try:
        count = int(raw_count) if raw_count is not None else 0
    except (TypeError, ValueError):
        count = 0

    return (rating, count)


def sort_pois_by_rating(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=rating_sort_key, reverse=True)


def prefer_high_rated(
    rows: list[dict[str, Any]],
    *,
    limit: int,
    min_rating: float = MIN_USEFUL_RATING,
) -> list[dict[str, Any]]:
    """
    Prefer places with rating >= min_rating, then fill with the rest by rating.
    Keeps geographic diversity soft: no hard geo filter (AI handles proximity).
    """
    if limit <= 0 or not rows:
        return []

    ranked = sort_pois_by_rating(rows)
    strong = [
        r
        for r in ranked
        if (r.get("rating") is not None and float(r["rating"]) >= min_rating)
    ]
    strong_ids = {str(r.get("id") or r.get("place_id") or "") for r in strong}
    weak = [
        r
        for r in ranked
        if str(r.get("id") or r.get("place_id") or "") not in strong_ids
    ]

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for pool in (strong, weak):
        for row in pool:
            pid = str(row.get("id") or row.get("place_id") or "")
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            out.append(row)
            if len(out) >= limit:
                return out
    return out


def bucket_route_candidates(
    rows: list[dict[str, Any]],
    *,
    per_bucket: int = 12,
) -> dict[str, list[dict[str, Any]]]:
    restaurants = [r for r in rows if str(r.get("category") or "") in RESTAURANT_CATS]
    accommodations = [
        r for r in rows if str(r.get("category") or "") in ACCOMMODATION_CATS
    ]
    attractions = [r for r in rows if str(r.get("category") or "") in ATTRACTION_CATS]

    return {
        "restaurants": prefer_high_rated(restaurants, limit=per_bucket),
        "accommodations": prefer_high_rated(accommodations, limit=per_bucket),
        "attractions": prefer_high_rated(attractions, limit=per_bucket),
    }


def public_poi_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "category": row.get("category"),
        "description": row.get("description"),
        "lat": row.get("lat"),
        "lng": row.get("lng"),
        "region": row.get("region"),
        "rating": row.get("rating"),
        "rating_count": row.get("rating_count"),
    }
