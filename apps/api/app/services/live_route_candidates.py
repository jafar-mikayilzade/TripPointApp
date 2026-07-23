"""Live Google Places candidates for AI route planning (no DB upsert).

Hub-driven fetch + tourism filter + curated seeds.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Literal

from app.config import GOOGLE_PLACES_API_KEY
from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.constants.tourism_hubs import hub_as_center, hubs_for_region
from app.constants.tourism_seeds import seeds_for_region
from app.db import supabase
from app.services.attraction_classify import (
    classify_attraction_rows,
    interest_attraction_cats,
)
from app.services.places_clean import clean_place
from app.services.places_google import fetch_places_from_google
from app.services.places_tourism_filter import filter_tourism_rows
from app.services.rank_pois import bucket_route_candidates, public_poi_fields

SourceKind = Literal["google", "db", "mixed"]

# Wider than sync default — regional tourism spots sit outside 5km often
LIVE_PLAN_RADIUS_METERS = 15_000
GOOGLE_CALL_TIMEOUT_SECONDS = 12

# Always one tourist_attraction fetch (via "nature" map); reclassify after.
_BASE_GOOGLE_CATS = ("restaurant", "hotel", "nature")


def _interest_google_categories(interests: list[str] | None) -> list[str]:
    del interests  # applied at bucket/rank time after classify
    return list(_BASE_GOOGLE_CATS)


def _row_from_google_place(
    place: dict[str, Any],
    *,
    region: str,
    category: str,
    hub_id: str | None = None,
    hub_weight: float | None = None,
) -> dict[str, Any] | None:
    cleaned = clean_place(place, region=region, category=category)
    if not cleaned:
        return None
    place_id = str(cleaned.get("place_id") or "").strip()
    if not place_id:
        return None
    row: dict[str, Any] = {
        **cleaned,
        "id": place_id,
        "description": cleaned.get("description")
        or cleaned.get("address")
        or None,
        "types": list(place.get("types") or []),
    }
    if hub_id:
        row["hub_id"] = hub_id
    if hub_weight is not None:
        row["hub_weight"] = hub_weight
    return row


def _fetch_google_category(
    *,
    latitude: float,
    longitude: float,
    category: str,
    region: str,
    radius_meters: int | None = None,
    hub_id: str | None = None,
    hub_weight: float | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        raw = fetch_places_from_google(
            latitude,
            longitude,
            category,
            radius_meters=radius_meters or LIVE_PLAN_RADIUS_METERS,
            timeout_seconds=GOOGLE_CALL_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"google:{category}: {exc}")
        return [], warnings

    rows: list[dict[str, Any]] = []
    for place in raw:
        row = _row_from_google_place(
            place,
            region=region,
            category=category,
            hub_id=hub_id,
            hub_weight=hub_weight,
        )
        if row:
            rows.append(row)
    return rows, warnings


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


def _load_buckets_from_db(
    region_key: str,
    *,
    per_bucket: int,
    hubs: list[dict[str, Any]],
    prefer_attraction_cats: set[str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    result = (
        supabase.table("pois")
        .select(
            "id, name, category, description, lat, lng, region, rating, "
            "rating_count, place_id"
        )
        .eq("status", "approved")
        .ilike("region", db_region)
        .neq("category", "cafe")
        .limit(200)
        .execute()
    )
    rows = classify_attraction_rows(list(result.data or []))
    seeds = seeds_for_region(region_key, db_region=db_region)
    merged = filter_tourism_rows(seeds + rows, hubs=hubs)
    return bucket_route_candidates(
        merged,
        per_bucket=per_bucket,
        hubs=hubs,
        prefer_attraction_cats=prefer_attraction_cats,
    )


def _bucket_counts(buckets: dict[str, list[dict[str, Any]]]) -> int:
    return sum(
        len(buckets.get(k) or [])
        for k in ("restaurants", "accommodations", "attractions")
    )


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
        # Prefer seed / higher hub weight
        if row.get("is_seed") and not prev.get("is_seed"):
            by_id[pid] = row
        elif float(row.get("hub_weight") or 0) > float(prev.get("hub_weight") or 0):
            by_id[pid] = {**prev, **row}
    return list(by_id.values())


def load_live_route_candidates(
    region_key: str,
    *,
    per_bucket: int = 12,
    interests: list[str] | None = None,
    source: Literal["google", "db"] = "google",
) -> dict[str, Any]:
    """
    Google-first candidate buckets for AI planning.
    Does not upsert to Supabase.
    """
    region_key = region_key.strip().lower()
    if region_key not in REGION_COORDINATES:
        raise KeyError(region_key)
    db_region = REGION_DB_ID.get(region_key, region_key)
    warnings: list[str] = []
    source_used: SourceKind = "db"
    centers = _centers_for_region(region_key)

    prefer_attr = interest_attraction_cats(interests) or None

    if source == "db":
        buckets = _load_buckets_from_db(
            region_key,
            per_bucket=per_bucket,
            hubs=centers,
            prefer_attraction_cats=prefer_attr,
        )
        return {
            "region": db_region,
            "buckets": buckets,
            "source": "db",
            "warnings": warnings,
        }

    if not GOOGLE_PLACES_API_KEY:
        warnings.append("google: missing GOOGLE_PLACES_API_KEY")
        buckets = _load_buckets_from_db(
            region_key,
            per_bucket=per_bucket,
            hubs=centers,
            prefer_attraction_cats=prefer_attr,
        )
        return {
            "region": db_region,
            "buckets": buckets,
            "source": "db",
            "warnings": warnings,
        }

    categories = _interest_google_categories(interests)
    jobs: list[tuple[dict[str, Any], str]] = [
        (center, cat) for center in centers for cat in categories
    ]
    merged_raw: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=min(8, max(1, len(jobs)))) as pool:
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
            merged_raw.extend(rows)

    seeds = seeds_for_region(region_key, db_region=db_region)
    classified = classify_attraction_rows(_dedupe_rows(seeds + merged_raw))
    merged = filter_tourism_rows(classified, hubs=centers)
    google_buckets = bucket_route_candidates(
        merged,
        per_bucket=per_bucket,
        hubs=centers,
        prefer_attraction_cats=prefer_attr,
    )
    if _bucket_counts(google_buckets) > 0:
        source_used = "google"
        buckets = google_buckets
    else:
        warnings.append("google: empty results — falling back to db")
        buckets = _load_buckets_from_db(
            region_key,
            per_bucket=per_bucket,
            hubs=centers,
            prefer_attraction_cats=prefer_attr,
        )
        source_used = "db"

    return {
        "region": db_region,
        "buckets": buckets,
        "source": source_used,
        "warnings": warnings,
        "google_raw_count": len(merged_raw),
        "hubs_used": [c.get("id") for c in centers],
        "interest_attraction_cats": sorted(prefer_attr or []),
    }


def buckets_as_public(
    buckets: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    return {
        "restaurants": [public_poi_fields(r) for r in buckets.get("restaurants") or []],
        "accommodations": [
            public_poi_fields(r) for r in buckets.get("accommodations") or []
        ],
        "attractions": [public_poi_fields(r) for r in buckets.get("attractions") or []],
    }
