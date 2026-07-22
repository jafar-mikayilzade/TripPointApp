"""Rank POIs by tourism signal + rating for live map and AI planning."""

from __future__ import annotations

from typing import Any

from app.services.geo_route import haversine_km

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

# Category tourism weights for scoring
_TYPE_WEIGHT: dict[str, float] = {
    "waterfall": 1.15,
    "mountain": 1.1,
    "lake": 1.1,
    "nature": 1.1,
    "historical": 1.05,
    "monument": 1.0,
    "hotel": 1.0,
    "hostel": 0.95,
    "guesthouse": 0.95,
    "restaurant": 0.75,
    "home_restaurant": 0.8,
    "cafe": 0.2,
    "other": 0.55,
}

# Home live mix targets (of total limit)
MIX_ATTRACTION_RATIO = 0.50
MIX_LODGING_RATIO = 0.28
MIX_FOOD_RATIO = 0.22


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


def _hub_proximity_weight(
    row: dict[str, Any],
    hubs: list[dict[str, Any]] | None,
) -> float:
    if not hubs:
        return 0.55
    try:
        lat = float(row["lat"])
        lng = float(row["lng"])
    except (KeyError, TypeError, ValueError):
        return 0.4
    best = 0.35
    for hub in hubs:
        try:
            hlat = float(hub["lat"])
            hlng = float(hub["lng"])
            hw = float(hub.get("weight") or 0.5)
            radius_km = max(float(hub.get("radius_m") or 8000) / 1000.0, 0.5)
            dist = haversine_km(lat, lng, hlat, hlng)
            if dist <= radius_km:
                # Closer to hub center → higher; scaled by hub weight
                prox = 1.0 - (dist / radius_km) * 0.45
                best = max(best, hw * prox)
            else:
                # Soft falloff outside radius
                fall = max(0.0, 1.0 - (dist - radius_km) / (radius_km * 2))
                best = max(best, hw * 0.35 * fall)
        except (KeyError, TypeError, ValueError):
            continue
    return best


def tourism_score(
    row: dict[str, Any],
    *,
    hubs: list[dict[str, Any]] | None = None,
) -> float:
    """Higher = better for tourism map / plan candidates."""
    cat = str(row.get("category") or "other").lower()
    type_w = _TYPE_WEIGHT.get(cat, 0.5)
    hub_w = _hub_proximity_weight(row, hubs)
    try:
        rating = float(row["rating"]) if row.get("rating") is not None else 3.5
    except (TypeError, ValueError):
        rating = 3.5
    try:
        reviews = int(row["rating_count"]) if row.get("rating_count") is not None else 0
    except (TypeError, ValueError):
        reviews = 0
    rating_f = max(0.35, min(rating / 5.0, 1.0))
    review_f = 0.55 + min(reviews, 200) / 400.0  # 0.55–1.05
    seed_boost = 1.45 if row.get("is_seed") else 1.0
    return type_w * hub_w * rating_f * review_f * seed_boost


def sort_by_tourism_score(
    rows: list[dict[str, Any]],
    *,
    hubs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda r: tourism_score(r, hubs=hubs),
        reverse=True,
    )


def prefer_high_rated(
    rows: list[dict[str, Any]],
    *,
    limit: int,
    min_rating: float = MIN_USEFUL_RATING,
    hubs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    Prefer tourism score (hub + type + rating), then fill.
    """
    if limit <= 0 or not rows:
        return []

    ranked = sort_by_tourism_score(rows, hubs=hubs)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in ranked:
        pid = str(row.get("id") or row.get("place_id") or "")
        if pid and pid in seen:
            continue
        if pid:
            seen.add(pid)
        out.append(row)
        if len(out) >= limit:
            return out
    return out


def mix_home_places(
    rows: list[dict[str, Any]],
    *,
    limit: int,
    hubs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Cap food share so attractions/lodging dominate the home map."""
    if limit <= 0 or not rows:
        return []

    attractions = [r for r in rows if str(r.get("category") or "") in ATTRACTION_CATS]
    lodging = [r for r in rows if str(r.get("category") or "") in ACCOMMODATION_CATS]
    food = [r for r in rows if str(r.get("category") or "") in RESTAURANT_CATS]

    n_attr = max(1, int(limit * MIX_ATTRACTION_RATIO))
    n_lodging = max(1, int(limit * MIX_LODGING_RATIO))
    n_food = max(1, int(limit * MIX_FOOD_RATIO))
    # Adjust to sum ~= limit
    while n_attr + n_lodging + n_food > limit:
        if n_food > 1:
            n_food -= 1
        elif n_lodging > 1:
            n_lodging -= 1
        else:
            n_attr -= 1

    picked: list[dict[str, Any]] = []
    seen: set[str] = set()

    def take(pool: list[dict[str, Any]], n: int) -> None:
        for row in prefer_high_rated(pool, limit=n, hubs=hubs):
            pid = str(row.get("id") or row.get("place_id") or "")
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            picked.append(row)

    take(attractions, n_attr)
    take(lodging, n_lodging)
    take(food, n_food)

    # Fill remainder from overall tourism rank
    if len(picked) < limit:
        for row in sort_by_tourism_score(rows, hubs=hubs):
            pid = str(row.get("id") or row.get("place_id") or "")
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            picked.append(row)
            if len(picked) >= limit:
                break

    return sort_by_tourism_score(picked, hubs=hubs)


def bucket_route_candidates(
    rows: list[dict[str, Any]],
    *,
    per_bucket: int = 12,
    hubs: list[dict[str, Any]] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    restaurants = [r for r in rows if str(r.get("category") or "") in RESTAURANT_CATS]
    accommodations = [
        r for r in rows if str(r.get("category") or "") in ACCOMMODATION_CATS
    ]
    attractions = [r for r in rows if str(r.get("category") or "") in ATTRACTION_CATS]

    return {
        "restaurants": prefer_high_rated(restaurants, limit=per_bucket, hubs=hubs),
        "accommodations": prefer_high_rated(
            accommodations, limit=per_bucket, hubs=hubs
        ),
        "attractions": prefer_high_rated(attractions, limit=per_bucket, hubs=hubs),
    }


def public_poi_fields(row: dict[str, Any]) -> dict[str, Any]:
    place_id = row.get("place_id")
    row_id = row.get("id") or place_id
    out: dict[str, Any] = {
        "id": row_id,
        "place_id": place_id or row_id,
        "name": row.get("name"),
        "category": row.get("category"),
        "description": row.get("description"),
        "lat": row.get("lat"),
        "lng": row.get("lng"),
        "region": row.get("region"),
        "rating": row.get("rating"),
        "rating_count": row.get("rating_count"),
    }
    if row.get("address"):
        out["address"] = row.get("address")
    return out
