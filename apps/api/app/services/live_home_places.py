"""Live Google Places for home/Qur map (no DB upsert).

Hub-driven region load + optional viewport (lat/lng/radius) merge.
Tourism filter + curated seeds + bucket mix.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from app.config import GOOGLE_PLACES_API_KEY
from app.constants.categories import APP_CATEGORIES
from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.constants.tourism_hubs import hub_as_center, hubs_for_region
from app.constants.tourism_seeds import seeds_for_region
from app.db import supabase
from app.services.geo_route import haversine_km
from app.services.live_route_candidates import (
    LIVE_PLAN_RADIUS_METERS,
    _fetch_google_category,
)
from app.services.places_tourism_filter import filter_tourism_rows
from app.services.rank_pois import mix_home_places, public_poi_fields

# Tourism-focused Nearby types for "all"
HOME_ALL_GOOGLE_CATS = ("restaurant", "hotel", "nature")

# How-to expand: add hubs in tourism_hubs.py, seeds in tourism_seeds.py,
# blacklist in places_tourism_filter.py


def _google_cats_for_filter(category: str | None) -> list[str]:
    if not category or category == "all":
        return list(HOME_ALL_GOOGLE_CATS)
    cat = category.strip().lower()
    if cat not in APP_CATEGORIES or cat == "cafe":
        return list(HOME_ALL_GOOGLE_CATS)
    return [cat]


def _centers_for_region(region_key: str) -> list[dict[str, Any]]:
    hubs = hubs_for_region(region_key)
    if hubs:
        return [hub_as_center(h) for h in hubs]
    coords = REGION_COORDINATES[region_key]
    return [
        {
            "id": "region_center",
            "name": region_key,
            "lat": float(coords["latitude"]),
            "lng": float(coords["longitude"]),
            "radius_m": LIVE_PLAN_RADIUS_METERS,
            "weight": 0.6,
        }
    ]


def _dedupe_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = str(row.get("place_id") or row.get("id") or "")
        if not pid:
            continue
        prev = by_id.get(pid)
        if prev is None:
            by_id[pid] = row
            continue
        if row.get("is_seed") and not prev.get("is_seed"):
            by_id[pid] = row
        elif float(row.get("hub_weight") or 0) > float(prev.get("hub_weight") or 0):
            by_id[pid] = {**prev, **row}
    return list(by_id.values())


def _load_db_places(
    region_key: str,
    *,
    category: str | None,
    limit: int,
    hubs: list[dict[str, Any]],
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
        .limit(max(limit * 3, 80))
    )
    if category and category not in {"all", ""}:
        query = query.eq("category", category)
    result = query.execute()
    rows = list(result.data or [])
    seeds = seeds_for_region(region_key, db_region=db_region)
    if category and category not in {"all", ""}:
        seeds = [s for s in seeds if str(s.get("category") or "") == category]
    merged = filter_tourism_rows(_dedupe_rows(seeds + rows), hubs=hubs)
    return mix_home_places(merged, limit=limit, hubs=hubs)


def _fetch_centers(
    centers: list[dict[str, Any]],
    *,
    cats: list[str],
    db_region: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    jobs = [(c, cat) for c in centers for cat in cats]
    if not jobs:
        return [], warnings

    out: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
        futures = [
            pool.submit(
                _fetch_google_category,
                latitude=float(center["lat"]),
                longitude=float(center["lng"]),
                category=cat,
                region=db_region,
                radius_meters=int(center.get("radius_m") or LIVE_PLAN_RADIUS_METERS),
                hub_id=str(center.get("id") or ""),
                hub_weight=float(center.get("weight") or 0.5),
            )
            for center, cat in jobs
        ]
        for fut in as_completed(futures):
            rows, batch_warnings = fut.result()
            warnings.extend(batch_warnings)
            out.extend(rows)
    return out, warnings


def load_live_home_places(
    region_key: str,
    *,
    category: str | None = None,
    limit: int = 60,
    lat: float | None = None,
    lng: float | None = None,
    radius: int | None = None,
) -> dict[str, Any]:
    """
    Region overview: fetch all tourism hubs.
    Viewport mode (lat/lng set): fetch viewport center (+ nearby strong hubs).
    """
    region_key = region_key.strip().lower()
    if region_key not in REGION_COORDINATES:
        raise KeyError(region_key)

    db_region = REGION_DB_ID.get(region_key, region_key)
    warnings: list[str] = []
    region_hubs = _centers_for_region(region_key)
    cats = _google_cats_for_filter(category)
    viewport_mode = lat is not None and lng is not None

    if viewport_mode:
        r_m = int(radius or 8_000)
        r_m = max(2_000, min(r_m, 25_000))
        centers: list[dict[str, Any]] = [
            {
                "id": "viewport",
                "name": "viewport",
                "lat": float(lat),
                "lng": float(lng),
                "radius_m": r_m,
                "weight": 1.0,
            }
        ]
        # Cap hub fan-out in viewport mode (Google call budget)
        for hub in region_hubs:
            if len(centers) >= 2:
                break
            if float(hub.get("weight") or 0) < 0.85:
                continue
            dist_km = haversine_km(
                float(lat), float(lng), float(hub["lat"]), float(hub["lng"])
            )
            if dist_km <= (r_m / 1000.0) + (float(hub["radius_m"]) / 1000.0):
                centers.append(hub)
        rank_hubs = region_hubs
    else:
        centers = region_hubs
        rank_hubs = region_hubs

    if not GOOGLE_PLACES_API_KEY:
        warnings.append("google: missing GOOGLE_PLACES_API_KEY")
        rows = _load_db_places(
            region_key, category=category, limit=limit, hubs=rank_hubs
        )
        return {
            "region": db_region,
            "places": [public_poi_fields(r) for r in rows],
            "source": "db",
            "warnings": warnings,
            "viewport": viewport_mode,
            "hubs_used": [c.get("id") for c in centers],
        }

    google_rows, gw = _fetch_centers(centers, cats=cats, db_region=db_region)
    warnings.extend(gw)

    seeds = seeds_for_region(region_key, db_region=db_region)
    if category and category not in {"all", ""}:
        seeds = [s for s in seeds if str(s.get("category") or "") == category]
        google_rows = [
            r
            for r in google_rows
            if str(r.get("category") or "") == category
        ]

    # In viewport mode still include seeds near the camera
    if viewport_mode:
        near_seeds: list[dict[str, Any]] = []
        for s in seeds:
            try:
                if (
                    haversine_km(
                        float(lat), float(lng), float(s["lat"]), float(s["lng"])
                    )
                    <= (float(radius or 8_000) / 1000.0) * 1.4
                ):
                    near_seeds.append(s)
            except (KeyError, TypeError, ValueError):
                continue
        seeds = near_seeds

    merged = filter_tourism_rows(
        _dedupe_rows(seeds + google_rows),
        hubs=rank_hubs,
    )
    ranked = mix_home_places(merged, limit=limit, hubs=rank_hubs)

    if ranked:
        return {
            "region": db_region,
            "places": [public_poi_fields(r) for r in ranked],
            "source": "google",
            "warnings": warnings,
            "viewport": viewport_mode,
            "hubs_used": [c.get("id") for c in centers],
        }

    warnings.append("google: empty — falling back to db")
    rows = _load_db_places(
        region_key, category=category, limit=limit, hubs=rank_hubs
    )
    return {
        "region": db_region,
        "places": [public_poi_fields(r) for r in rows],
        "source": "db",
        "warnings": warnings,
        "viewport": viewport_mode,
        "hubs_used": [c.get("id") for c in centers],
    }
