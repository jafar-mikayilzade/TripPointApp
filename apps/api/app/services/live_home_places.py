"""Home / Qur map places from Supabase `pois` (no live Overpass).

OSM fills the table via background `/api/sync-places` only.
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
from app.services.live_route_candidates import LIVE_PLAN_RADIUS_METERS
from app.services.places_tourism_filter import filter_tourism_rows
from app.services.rank_pois import mix_home_places, public_poi_fields

logger = logging.getLogger(__name__)

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
        return f"db|{region_key}|{cat}|{limit}|region"
    lat_r = round(float(lat), 3)
    lng_r = round(float(lng), 3)
    rad_r = int(round((radius or 8000) / 500.0) * 500)
    return f"db|{region_key}|{cat}|{limit}|{lat_r}|{lng_r}|{rad_r}"


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
    lat: float | None = None,
    lng: float | None = None,
    radius: int | None = None,
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
        .limit(max(limit * 4, 120))
    )
    if category and category not in {"all", ""}:
        query = query.eq("category", category)
    result = query.execute()
    rows = list(result.data or [])
    seeds = seeds_for_region(region_key, db_region=db_region)
    if category and category not in {"all", ""}:
        seeds = [s for s in seeds if str(s.get("category") or "") == category]

    merged = _dedupe_rows(seeds + rows)

    if lat is not None and lng is not None:
        r_km = (float(radius or 8_000) / 1000.0) * 1.4
        near: list[dict[str, Any]] = []
        for row in merged:
            try:
                if (
                    haversine_km(
                        float(lat),
                        float(lng),
                        float(row["lat"]),
                        float(row["lng"]),
                    )
                    <= r_km
                ):
                    near.append(row)
            except (KeyError, TypeError, ValueError):
                continue
        merged = near

    filtered = filter_tourism_rows(merged, hubs=hubs)
    return mix_home_places(filtered, limit=limit, hubs=hubs)


def load_live_home_places(
    region_key: str,
    *,
    category: str | None = None,
    limit: int = 60,
    lat: float | None = None,
    lng: float | None = None,
    radius: int | None = None,
) -> dict[str, Any]:
    """DB-only home places. Overpass is never called here."""
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
    viewport_mode = lat is not None and lng is not None
    rank_hubs = _centers_for_region(region_key)

    if viewport_mode:
        hubs_used = ["viewport"]
    else:
        hubs_used = ["region_center"]

    rows = _load_db_places(
        region_key,
        category=category,
        limit=limit,
        hubs=rank_hubs,
        lat=lat,
        lng=lng,
        radius=radius,
    )
    return {
        "region": db_region,
        "places": [public_poi_fields(r) for r in rows],
        "source": "db",
        "warnings": [],
        "viewport": viewport_mode,
        "hubs_used": hubs_used,
    }
