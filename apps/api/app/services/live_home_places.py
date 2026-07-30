"""Live OSM places for home/Qur map (no DB upsert).

Hub-driven region load + optional viewport (lat/lng/radius) merge.
Tourism filter + curated seeds + bucket mix. Google Nearby disabled by default.
"""

from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.constants.tourism_hubs import hub_as_center, hubs_for_region
from app.constants.tourism_seeds import seeds_for_region
from app.db import supabase
from app.services.geo_route import haversine_km
from app.services.live_route_candidates import (
    LIVE_PLAN_RADIUS_METERS,
    OSM_MAX_CENTERS,
    _fetch_osm_bundle,
)
from app.services.places_tourism_filter import filter_tourism_rows
from app.services.rank_pois import mix_home_places, public_poi_fields

# How-to expand: add hubs in tourism_hubs.py, seeds in tourism_seeds.py,
# blacklist in places_tourism_filter.py

logger = logging.getLogger(__name__)

# In-memory viewport/region TTL cache (per process — use Redis if multi-worker)
_LIVE_CACHE_TTL_SECONDS = 12 * 60
_LIVE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_LIVE_CACHE_LOCK = Lock()


def _cache_key(
    region_key: str,
    category: str | None,
    limit: int,
    lat: float | None,
    lng: float | None,
    radius: int | None,
) -> str:
    cat = (category or "all").strip().lower()
    if lat is None or lng is None:
        return f"osm|{region_key}|{cat}|{limit}|region"
    # Round to ~100m buckets to absorb tiny pans
    lat_r = round(float(lat), 3)
    lng_r = round(float(lng), 3)
    rad_r = int(round((radius or 8000) / 500.0) * 500)
    return f"osm|{region_key}|{cat}|{limit}|{lat_r}|{lng_r}|{rad_r}"


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


def _cap_centers(centers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(centers) <= OSM_MAX_CENTERS:
        return centers
    ranked = sorted(
        centers, key=lambda c: float(c.get("weight") or 0), reverse=True
    )
    return ranked[:OSM_MAX_CENTERS]


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
    db_region: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """One Overpass tourism bundle per center (no category×hub fan-out)."""
    warnings: list[str] = []
    capped = _cap_centers(centers)
    if not capped:
        return [], warnings

    out: list[dict[str, Any]] = []
    for center in capped:
        rows, batch_warnings = _fetch_osm_bundle(
            latitude=float(center["lat"]),
            longitude=float(center["lng"]),
            region=db_region,
            hub_id=str(center.get("id") or ""),
            hub_weight=float(center.get("weight") or 0.5),
            radius_meters=int(center.get("radius_m") or LIVE_PLAN_RADIUS_METERS),
        )
        warnings.extend(batch_warnings)
        out.extend(rows)
        if not rows and batch_warnings:
            break
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
    Region overview: fetch tourism hubs via OSM.
    Viewport mode (lat/lng set): fetch viewport center (+ nearby strong hubs).
    """
    region_key = region_key.strip().lower()
    if region_key not in REGION_COORDINATES:
        raise KeyError(region_key)

    key = _cache_key(region_key, category, limit, lat, lng, radius)
    now = time.time()
    with _LIVE_CACHE_LOCK:
        hit = _LIVE_CACHE.get(key)
        if hit and now - hit[0] < _LIVE_CACHE_TTL_SECONDS:
            logger.debug("live-places cache HIT %s", key)
            cached = dict(hit[1])
            cached["cache"] = "hit"
            return cached
        logger.debug("live-places cache MISS %s", key)

    loaded = _load_live_home_places_uncached(
        region_key,
        category=category,
        limit=limit,
        lat=lat,
        lng=lng,
        radius=radius,
    )
    with _LIVE_CACHE_LOCK:
        _LIVE_CACHE[key] = (now, loaded)
        # Bound memory: drop oldest if huge
        if len(_LIVE_CACHE) > 200:
            oldest = sorted(_LIVE_CACHE.items(), key=lambda kv: kv[1][0])[:50]
            for old_key, _ in oldest:
                _LIVE_CACHE.pop(old_key, None)
    out = dict(loaded)
    out["cache"] = "miss"
    return out


def _load_live_home_places_uncached(
    region_key: str,
    *,
    category: str | None = None,
    limit: int = 60,
    lat: float | None = None,
    lng: float | None = None,
    radius: int | None = None,
) -> dict[str, Any]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    warnings: list[str] = []
    region_hubs = _centers_for_region(region_key)
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
        rank_hubs = region_hubs
    else:
        # One stable region center — avoid hub fan-out on public Overpass
        coords = REGION_COORDINATES[region_key]
        centers = [
            {
                "id": "region_center",
                "name": region_key,
                "lat": float(coords["latitude"]),
                "lng": float(coords["longitude"]),
                "radius_m": LIVE_PLAN_RADIUS_METERS,
                "weight": 1.0,
            }
        ]
        rank_hubs = region_hubs

    osm_rows, ow = _fetch_centers(centers, db_region=db_region)
    warnings.extend(ow)

    seeds = seeds_for_region(region_key, db_region=db_region)
    if category and category not in {"all", ""}:
        seeds = [s for s in seeds if str(s.get("category") or "") == category]
        osm_rows = [
            r for r in osm_rows if str(r.get("category") or "") == category
        ]

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
        _dedupe_rows(seeds + osm_rows),
        hubs=rank_hubs,
    )
    ranked = mix_home_places(merged, limit=limit, hubs=rank_hubs)

    if ranked:
        return {
            "region": db_region,
            "places": [public_poi_fields(r) for r in ranked],
            "source": "osm",
            "warnings": warnings,
            "viewport": viewport_mode,
            "hubs_used": [c.get("id") for c in centers],
        }

    warnings.append("osm: empty — falling back to db")
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
