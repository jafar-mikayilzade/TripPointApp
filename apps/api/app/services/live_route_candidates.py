"""Live Google Places candidates for AI route planning (no DB upsert)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Literal

from app.config import GOOGLE_PLACES_API_KEY
from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.db import supabase
from app.services.places_clean import clean_place
from app.services.places_google import fetch_places_from_google
from app.services.rank_pois import bucket_route_candidates, public_poi_fields

SourceKind = Literal["google", "db", "mixed"]

# Wider than sync default — regional tourism spots sit outside 5km often
LIVE_PLAN_RADIUS_METERS = 15_000
GOOGLE_CALL_TIMEOUT_SECONDS = 12

# Mobile InterestId → Google Nearby categories to fetch (app category keys)
# restaurant/hotel always included so itinerary can place meals/stays.
_BASE_GOOGLE_CATS = ("restaurant", "hotel")


def _interest_google_categories(interests: list[str] | None) -> list[str]:
    keys = {str(i).strip().lower() for i in (interests or []) if str(i).strip()}
    cats: list[str] = list(_BASE_GOOGLE_CATS)

    # One tourist_attraction call (nature/historical both map to same Google type)
    if "history" in keys and not keys.intersection({"nature", "active", "photo"}):
        cats.append("historical")
    else:
        cats.append("nature")

    # Deduplicate while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for c in cats:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _row_from_google_place(
    place: dict[str, Any],
    *,
    region: str,
    category: str,
) -> dict[str, Any] | None:
    cleaned = clean_place(place, region=region, category=category)
    if not cleaned:
        return None
    place_id = str(cleaned.get("place_id") or "").strip()
    if not place_id:
        return None
    # Plan/itinerary uses `id`; Google rows use place_id (no DB uuid)
    return {
        **cleaned,
        "id": place_id,
        "description": cleaned.get("description")
        or cleaned.get("address")
        or None,
    }


def _fetch_google_category(
    *,
    latitude: float,
    longitude: float,
    category: str,
    region: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        raw = fetch_places_from_google(
            latitude,
            longitude,
            category,
            radius_meters=LIVE_PLAN_RADIUS_METERS,
            timeout_seconds=GOOGLE_CALL_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — surface as warning + fallback
        warnings.append(f"google:{category}: {exc}")
        return [], warnings

    rows: list[dict[str, Any]] = []
    for place in raw:
        row = _row_from_google_place(place, region=region, category=category)
        if row:
            rows.append(row)
    return rows, warnings


def _load_buckets_from_db(
    region_key: str,
    *,
    per_bucket: int,
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
    rows = list(result.data or [])
    return bucket_route_candidates(rows, per_bucket=per_bucket)


def _bucket_counts(buckets: dict[str, list[dict[str, Any]]]) -> int:
    return sum(len(buckets.get(k) or []) for k in ("restaurants", "accommodations", "attractions"))


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
    coords = REGION_COORDINATES[region_key]
    db_region = REGION_DB_ID.get(region_key, region_key)
    warnings: list[str] = []
    source_used: SourceKind = "db"

    if source == "db":
        buckets = _load_buckets_from_db(region_key, per_bucket=per_bucket)
        return {
            "region": db_region,
            "buckets": buckets,
            "source": "db",
            "warnings": warnings,
        }

    if not GOOGLE_PLACES_API_KEY:
        warnings.append("google: missing GOOGLE_PLACES_API_KEY")
        buckets = _load_buckets_from_db(region_key, per_bucket=per_bucket)
        return {
            "region": db_region,
            "buckets": buckets,
            "source": "db",
            "warnings": warnings,
        }

    categories = _interest_google_categories(interests)
    lat = float(coords["latitude"])
    lng = float(coords["longitude"])
    merged: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}

    with ThreadPoolExecutor(max_workers=min(4, len(categories) or 1)) as pool:
        futures = {
            pool.submit(
                _fetch_google_category,
                latitude=lat,
                longitude=lng,
                category=cat,
                region=db_region,
            ): cat
            for cat in categories
        }
        for fut in as_completed(futures):
            rows, batch_warnings = fut.result()
            warnings.extend(batch_warnings)
            for row in rows:
                pid = str(row.get("place_id") or row.get("id") or "")
                if not pid or pid in by_id:
                    continue
                by_id[pid] = row
                merged.append(row)

    google_buckets = bucket_route_candidates(merged, per_bucket=per_bucket)
    if _bucket_counts(google_buckets) > 0:
        source_used = "google"
        buckets = google_buckets
    else:
        warnings.append("google: empty results — falling back to db")
        buckets = _load_buckets_from_db(region_key, per_bucket=per_bucket)
        source_used = "db"
        # If Google partially failed but we still use DB only
        if any(w.startswith("google:") for w in warnings) and _bucket_counts(buckets) > 0:
            source_used = "db"

    return {
        "region": db_region,
        "buckets": buckets,
        "source": source_used,
        "warnings": warnings,
        "google_raw_count": len(merged),
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
