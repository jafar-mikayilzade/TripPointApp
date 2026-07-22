"""Live Google Places for home map (no DB upsert)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from app.config import GOOGLE_PLACES_API_KEY
from app.constants.categories import APP_CATEGORIES
from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.db import supabase
from app.services.live_route_candidates import (
    LIVE_PLAN_RADIUS_METERS,
    _fetch_google_category,
)
from app.services.rank_pois import prefer_high_rated, public_poi_fields

# Tourism-focused Nearby types for "all" (lodging once, attractions once)
HOME_ALL_GOOGLE_CATS = ("restaurant", "hotel", "nature")


def _google_cats_for_filter(category: str | None) -> list[str]:
    if not category or category == "all":
        return list(HOME_ALL_GOOGLE_CATS)
    cat = category.strip().lower()
    if cat not in APP_CATEGORIES or cat == "cafe":
        return list(HOME_ALL_GOOGLE_CATS)
    # hostel/guesthouse share lodging type with hotel — stamp as requested
    return [cat]


def _load_db_places(
    region_key: str,
    *,
    category: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    query = (
        supabase.table("pois")
        .select(
            "id, name, category, description, lat, lng, region, rating, "
            "rating_count, place_id, address"
        )
        .eq("status", "approved")
        .ilike("region", db_region)
        .neq("category", "cafe")
        .limit(max(limit, 50))
    )
    if category and category not in {"all", ""}:
        query = query.eq("category", category)
    result = query.execute()
    rows = list(result.data or [])
    return prefer_high_rated(rows, limit=limit)


def load_live_home_places(
    region_key: str,
    *,
    category: str | None = None,
    limit: int = 60,
) -> dict[str, Any]:
    region_key = region_key.strip().lower()
    coords = REGION_COORDINATES[region_key]
    db_region = REGION_DB_ID.get(region_key, region_key)
    warnings: list[str] = []

    if not GOOGLE_PLACES_API_KEY:
        warnings.append("google: missing GOOGLE_PLACES_API_KEY")
        rows = _load_db_places(region_key, category=category, limit=limit)
        return {
            "region": db_region,
            "places": [public_poi_fields(r) for r in rows],
            "source": "db",
            "warnings": warnings,
        }

    cats = _google_cats_for_filter(category)
    lat = float(coords["latitude"])
    lng = float(coords["longitude"])
    by_id: dict[str, dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=min(4, len(cats) or 1)) as pool:
        futures = [
            pool.submit(
                _fetch_google_category,
                latitude=lat,
                longitude=lng,
                category=cat,
                region=db_region,
            )
            for cat in cats
        ]
        for fut in as_completed(futures):
            rows, batch_warnings = fut.result()
            warnings.extend(batch_warnings)
            for row in rows:
                pid = str(row.get("place_id") or row.get("id") or "")
                if not pid or pid in by_id:
                    continue
                if (
                    category
                    and category not in {"all", ""}
                    and str(row.get("category") or "") != category
                ):
                    continue
                by_id[pid] = row

    merged = list(by_id.values())
    ranked = prefer_high_rated(merged, limit=limit)

    if ranked:
        return {
            "region": db_region,
            "places": [public_poi_fields(r) for r in ranked],
            "source": "google",
            "warnings": warnings,
        }

    warnings.append("google: empty — falling back to db")
    rows = _load_db_places(region_key, category=category, limit=limit)
    return {
        "region": db_region,
        "places": [public_poi_fields(r) for r in rows],
        "source": "db",
        "warnings": warnings,
    }
