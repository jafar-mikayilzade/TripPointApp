"""POI richness scoring for ranking (photos, phone, price, extras)."""

from __future__ import annotations

from typing import Any


def _truthy(v: Any) -> bool:
    return v is not None and str(v).strip() not in {"", "None", "null"}


def richness_score(row: dict[str, Any]) -> float:
    """Higher = more complete listing. Prefer photo, phone, price, contact."""
    score = 0.0
    photos = row.get("photo_urls")
    n_photos = 0
    if isinstance(photos, list):
        n_photos = len([u for u in photos if _truthy(u)])
    if _truthy(row.get("thumbnail_url")):
        n_photos = max(n_photos, 1)
    score += min(n_photos, 8) * 25

    if _truthy(row.get("phone")):
        score += 40
    if row.get("price_from") is not None:
        try:
            float(row["price_from"])
            score += 35
        except (TypeError, ValueError):
            pass

    desc = str(row.get("description") or "").strip()
    if len(desc) >= 20:
        score += 30
    elif desc:
        score += 10

    if _truthy(row.get("website")) or _truthy(row.get("external_url")):
        score += 20
    if _truthy(row.get("address")):
        score += 15
    if _truthy(row.get("opening_hours")):
        score += 10
    if _truthy(row.get("cuisine")):
        score += 8
    if isinstance(row.get("amenities"), list) and row["amenities"]:
        score += min(len(row["amenities"]), 6) * 3
    if row.get("hotel_class") is not None:
        score += 5

    try:
        rating = float(row["rating"]) if row.get("rating") is not None else -1.0
    except (TypeError, ValueError):
        rating = -1.0
    if rating >= 0:
        score += rating * 8

    try:
        count = int(row["rating_count"]) if row.get("rating_count") is not None else 0
    except (TypeError, ValueError):
        count = 0
    score += min(count, 80)

    return score


def richness_factor(row: dict[str, Any]) -> float:
    """Map richness to ~0.55–1.45 multiplier for tourism_score."""
    raw = richness_score(row)
    # Typical empty ~0–20, rich ~150–300+
    return 0.55 + min(raw, 280.0) / 310.0


def richness_sort_key(row: dict[str, Any]) -> tuple[float, float, int]:
    """Higher richness first, then rating, then review count."""
    try:
        rating = float(row["rating"]) if row.get("rating") is not None else -1.0
    except (TypeError, ValueError):
        rating = -1.0
    try:
        count = int(row["rating_count"]) if row.get("rating_count") is not None else 0
    except (TypeError, ValueError):
        count = 0
    return (richness_score(row), rating, count)
