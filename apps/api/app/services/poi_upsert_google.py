"""Upsert a single Google place into pois (service role) for favorites etc."""

from __future__ import annotations

from typing import Any

from app.constants.categories import APP_CATEGORIES
from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.db import supabase
from app.services.geo_route import haversine_km

# Same tourism policy as home: never persist cafe via this path
BLOCKED_CATEGORIES = frozenset({"cafe"})


def _infer_region(lat: float, lng: float) -> str:
    best_id = "quba"
    best_km = float("inf")
    for region_id, coords in REGION_COORDINATES.items():
        # Skip aliases — prefer canonical ids
        if region_id in REGION_DB_ID:
            continue
        km = haversine_km(
            lat,
            lng,
            float(coords["latitude"]),
            float(coords["longitude"]),
        )
        if km < best_km:
            best_km = km
            best_id = region_id
    return REGION_DB_ID.get(best_id, best_id)


def upsert_google_place(payload: dict[str, Any]) -> dict[str, Any]:
    place_id = str(payload.get("place_id") or "").strip()
    name = str(payload.get("name") or "").strip()
    try:
        lat = float(payload.get("lat"))
        lng = float(payload.get("lng"))
    except (TypeError, ValueError) as exc:
        raise ValueError("lat/lng required") from exc

    if not place_id or not name:
        raise ValueError("place_id and name are required")
    if not place_id.startswith("ChIJ") and len(place_id) < 8:
        raise ValueError("invalid place_id")

    category = str(payload.get("category") or "other").strip().lower()
    if category in BLOCKED_CATEGORIES:
        raise ValueError("category 'cafe' is not allowed")
    if category not in APP_CATEGORIES:
        category = "other"

    region = str(payload.get("region") or "").strip().lower()
    if region:
        region = REGION_DB_ID.get(region, region)
    else:
        region = _infer_region(lat, lng)

    rating = payload.get("rating")
    rating_count = payload.get("rating_count")
    try:
        rating_f = float(rating) if rating is not None else None
        if rating_f is not None and not (0 < rating_f <= 5):
            rating_f = None
    except (TypeError, ValueError):
        rating_f = None
    try:
        rating_count_i = int(rating_count) if rating_count is not None else None
    except (TypeError, ValueError):
        rating_count_i = None

    row: dict[str, Any] = {
        "name": name[:200],
        "category": category,
        "status": "approved",
        "region": region,
        "lat": lat,
        "lng": lng,
        "place_id": place_id,
        "website": f"https://www.google.com/maps/place/?q=place_id:{place_id}",
        "rating": rating_f,
        "rating_count": rating_count_i,
    }

    # Prefer existing row if place_id already known
    existing = (
        supabase.table("pois")
        .select("id, place_id, name, category, lat, lng, region, rating, rating_count")
        .eq("place_id", place_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        poi_id = existing[0]["id"]
        return {"ok": True, "created": False, "poi": existing[0], "id": poi_id}

    # submitted_by: use a stable system marker if column requires uuid — check schema
    # Migration uses submitted_by; sync rows often omit or use system. Try without first.
    try:
        result = (
            supabase.table("pois")
            .upsert(row, on_conflict="place_id")
            .execute()
        )
        data = (result.data or [None])[0]
        if not data:
            # Fetch after upsert
            fetched = (
                supabase.table("pois")
                .select("id, place_id, name, category, lat, lng, region, rating, rating_count")
                .eq("place_id", place_id)
                .limit(1)
                .execute()
                .data
                or []
            )
            data = fetched[0] if fetched else None
        if not data:
            raise RuntimeError("upsert returned empty")
        return {"ok": True, "created": True, "poi": data, "id": data["id"]}
    except Exception:
        # If submitted_by NOT NULL without default, attach placeholder via select auth — skip
        raise
