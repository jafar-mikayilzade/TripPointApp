"""Rank POIs by tourism signal + rating for live map and AI planning."""

from __future__ import annotations

from typing import Any

from app.services.geo_route import haversine_km

RESTAURANT_CATS = frozenset({"restaurant", "home_restaurant", "cafe"})
ACCOMMODATION_CATS = frozenset({"hotel", "hostel", "guesthouse", "camping"})
LODGING_HOTEL_CATS = frozenset({"hotel"})
LODGING_PRIVATE_CATS = frozenset({"guesthouse", "hostel", "camping"})


def lodging_type_categories(lodging_type: str | None) -> frozenset[str]:
    """hotel → hotels only; private/homestay → guesthouse/hostel/camping."""
    key = str(lodging_type or "hotel").strip().lower()
    if key in {"private", "homestay", "ferdi", "ev", "guesthouse"}:
        return LODGING_PRIVATE_CATS
    return LODGING_HOTEL_CATS


def filter_accommodations_by_lodging_type(
    rows: list[dict[str, Any]],
    lodging_type: str | None,
) -> list[dict[str, Any]]:
    allowed = lodging_type_categories(lodging_type)
    return [r for r in rows if poi_categories(r) & set(allowed)]


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
    "camping": 1.05,
    "restaurant": 0.75,
    "home_restaurant": 0.8,
    "cafe": 0.2,
    "other": 0.55,
}


def poi_categories(row: dict[str, Any]) -> set[str]:
    """All categories on a POI (array + primary scalar fallback)."""
    raw = row.get("categories")
    out: set[str] = set()
    if isinstance(raw, (list, tuple)):
        for item in raw:
            c = str(item or "").strip()
            if c:
                out.add(c)
    primary = str(row.get("category") or "").strip()
    if primary:
        out.add(primary)
    return out


def row_in_cats(row: dict[str, Any], allowed: frozenset[str] | set[str]) -> bool:
    return bool(poi_categories(row) & set(allowed))

# Home live mix targets (of total limit)
MIX_ATTRACTION_RATIO = 0.50
MIX_LODGING_RATIO = 0.28
MIX_FOOD_RATIO = 0.22


def rating_sort_key(row: dict[str, Any]) -> tuple[float, float, int]:
    """Richer listings first (photo/phone/price), then rating, then reviews."""
    from app.services.poi_richness import richness_sort_key

    return richness_sort_key(row)


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
    from app.services.poi_richness import richness_factor

    info_f = richness_factor(row)  # photo/phone/price/contact boost
    return type_w * hub_w * rating_f * review_f * seed_boost * info_f


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
    prefer_attraction_cats: set[str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    restaurants = [r for r in rows if row_in_cats(r, RESTAURANT_CATS)]
    accommodations = [r for r in rows if row_in_cats(r, ACCOMMODATION_CATS)]
    attractions = [r for r in rows if row_in_cats(r, ATTRACTION_CATS)]

    if prefer_attraction_cats:
        preferred = [
            r for r in attractions if poi_categories(r) & prefer_attraction_cats
        ]
        if len(preferred) >= min(8, per_bucket):
            attractions_out = prefer_high_rated(preferred, limit=per_bucket, hubs=hubs)
        else:
            # Keep matches first, then pad so 2-day plans are not a single POI
            mixed = preferred + [r for r in attractions if r not in preferred]
            attractions_out = prefer_high_rated(mixed, limit=per_bucket, hubs=hubs)
    else:
        attractions_out = prefer_high_rated(attractions, limit=per_bucket, hubs=hubs)

    return {
        "restaurants": prefer_high_rated(restaurants, limit=per_bucket, hubs=hubs),
        "accommodations": prefer_high_rated(
            accommodations, limit=per_bucket, hubs=hubs
        ),
        "attractions": attractions_out,
    }


def public_poi_fields(row: dict[str, Any]) -> dict[str, Any]:
    place_id = row.get("place_id")
    cats = sorted(poi_categories(row))
    primary = str(row.get("category") or (cats[0] if cats else "other"))
    row_id = row.get("id") or place_id
    out: dict[str, Any] = {
        "id": row_id,
        "place_id": place_id or row_id,
        "name": row.get("name"),
        "category": primary,
        "categories": cats,
        "description": row.get("description"),
        "lat": row.get("lat"),
        "lng": row.get("lng"),
        "region": row.get("region"),
        "rating": row.get("rating"),
        "rating_count": row.get("rating_count"),
    }
    if row.get("address"):
        out["address"] = row.get("address")
    if row.get("phone"):
        out["phone"] = row.get("phone")
    if row.get("website"):
        out["website"] = row.get("website")
    if row.get("price_from") is not None:
        out["price_from"] = row.get("price_from")
    if row.get("price_currency"):
        out["price_currency"] = row.get("price_currency")
    if row.get("hotel_class") is not None:
        out["hotel_class"] = row.get("hotel_class")
    if row.get("amenities") is not None:
        out["amenities"] = row.get("amenities")
    if row.get("check_in_time"):
        out["check_in_time"] = row.get("check_in_time")
    if row.get("check_out_time"):
        out["check_out_time"] = row.get("check_out_time")
    if row.get("data_source"):
        out["data_source"] = row.get("data_source")
    if row.get("thumbnail_url"):
        out["thumbnail_url"] = row.get("thumbnail_url")
    if row.get("opening_hours") is not None:
        out["opening_hours"] = row.get("opening_hours")
    return out
