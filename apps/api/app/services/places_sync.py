"""Orchestrate place sync: fetch → clean → insert-if-missing."""

from __future__ import annotations

import logging
import threading
from typing import Any

import requests
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.config import DATA_SOURCE
from app.constants.categories import (
    ALLOWED_CATEGORIES,
    OSM_SKIP_SYNC_CATEGORIES,
    OSM_SYNC_ATTRACTION_CATEGORIES,
)
from app.constants.regions import REGION_COORDINATES
from app.db import supabase
from app.services.places_clean import clean_place, to_db_region
from app.services.places_google import fetch_places_from_google
from app.services.places_hybrid import fetch_places_from_hybrid, iter_hybrid_all_batches
from app.services.places_mock import fetch_places_from_mock
from app.services.places_osm import _overpass_in_cooldown, fetch_places_from_osm

logger = logging.getLogger(__name__)

# One sync at a time — concurrent mobile/all+filter calls stampede Overpass
_SYNC_LOCK = threading.Lock()


def sync_places(region: str, category: str) -> JSONResponse:
    region_key = region.strip().lower()
    category_key = category.strip().lower()

    if region_key not in REGION_COORDINATES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid region",
                "message": f"Region '{region}' is not supported.",
                "allowed_regions": list(REGION_COORDINATES.keys()),
            },
        )

    if category_key not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid category",
                "message": f"Category '{category}' is not supported.",
                "allowed_categories": sorted(ALLOWED_CATEGORIES),
            },
        )

    # Cafe sync disabled for now
    if category_key == "cafe":
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": to_db_region(region_key),
                "category": category_key,
                "fetched": 0,
                "inserted": 0,
                "skipped": 0,
                "message": "Category 'cafe' is temporarily disabled.",
            }
        )

    # OSM: food/lodging are curated (admin/Google) — do not sync from Overpass
    if DATA_SOURCE == "osm" and category_key in OSM_SKIP_SYNC_CATEGORIES:
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": to_db_region(region_key),
                "category": category_key,
                "fetched": 0,
                "inserted": 0,
                "skipped": 0,
                "message": (
                    f"Category '{category_key}' is curated manually / Google upsert; "
                    "OSM sync skipped. Use category=all for attractions."
                ),
            }
        )

    if DATA_SOURCE == "osm" and _overpass_in_cooldown():
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": to_db_region(region_key),
                "category": category_key,
                "fetched": 0,
                "inserted": 0,
                "skipped": 0,
                "message": "Overpass cooldown active — sync skipped; use existing pois.",
            }
        )

    if not _SYNC_LOCK.acquire(blocking=False):
        return JSONResponse(
            status_code=429,
            content={
                "success": False,
                "error": "sync_busy",
                "message": "Another sync is in progress. Retry in a few seconds.",
            },
        )

    try:
        coordinates = REGION_COORDINATES[region_key]
        db_region = to_db_region(region_key)

        # Hybrid "all": upsert Google immediately, then OSM batch-by-batch
        if DATA_SOURCE == "hybrid" and category_key == "all":
            return _sync_hybrid_all_progressive(coordinates, region_key, db_region)

        raw_places, fetch_warnings = _fetch_raw_places(
            coordinates, region_key, category_key, db_region
        )
        return _insert_missing_and_respond(
            raw_places=raw_places,
            region_key=region_key,
            db_region=db_region,
            category_key=category_key,
            fetch_warnings=fetch_warnings,
        )
    except RuntimeError:
        logger.exception("sync-places upstream error (source=%s)", DATA_SOURCE)
        return JSONResponse(
            status_code=502,
            content={
                "success": False,
                "error": "upstream_error",
                "message": "Upstream place provider rejected the request.",
            },
        )
    except requests.RequestException:
        logger.exception("sync-places network error (source=%s)", DATA_SOURCE)
        source_label = {
            "google": "Google Places API",
            "osm": "OpenStreetMap Overpass API",
            "hybrid": "Google Places / OpenStreetMap",
        }.get(DATA_SOURCE, "external data source")
        return JSONResponse(
            status_code=502,
            content={
                "success": False,
                "error": "network_error",
                "message": f"Failed to reach {source_label}.",
            },
        )
    except Exception:
        logger.exception("sync-places failed (source=%s)", DATA_SOURCE)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "sync_failed",
                "message": "Failed to sync places due to an external API or database error.",
            },
        )
    finally:
        _SYNC_LOCK.release()


def _existing_place_ids(place_ids: list[str]) -> set[str]:
    """Lookup which place_ids already exist (chunked for PostgREST limits)."""
    found: set[str] = set()
    chunk_size = 80
    for i in range(0, len(place_ids), chunk_size):
        chunk = place_ids[i : i + chunk_size]
        if not chunk:
            continue
        result = (
            supabase.table("pois")
            .select("place_id")
            .in_("place_id", chunk)
            .execute()
        )
        for row in result.data or []:
            pid = str(row.get("place_id") or "").strip()
            if pid:
                found.add(pid)
    return found


def _insert_if_missing(cleaned_places: list[dict[str, Any]]) -> tuple[int, int]:
    """
    Insert rows whose place_id is not in pois yet.
    Existing rows (manual/Google/prior OSM) are left untouched — pass.
    Returns (inserted, skipped).
    """
    if not cleaned_places:
        return 0, 0

    place_ids = [
        str(row["place_id"]).strip()
        for row in cleaned_places
        if row.get("place_id")
    ]
    existing = _existing_place_ids(place_ids)
    to_insert = [
        row
        for row in cleaned_places
        if str(row.get("place_id") or "").strip() not in existing
    ]
    skipped = len(cleaned_places) - len(to_insert)
    if not to_insert:
        return 0, skipped

    # Insert in batches
    inserted = 0
    batch_size = 50
    for i in range(0, len(to_insert), batch_size):
        batch = [_strip_unknown_poi_fields(r) for r in to_insert[i : i + batch_size]]
        result = supabase.table("pois").insert(batch).execute()
        inserted += len(result.data) if result.data else len(batch)
    return inserted, skipped


_POIS_COLUMNS: set[str] | None = None

# Fields refreshed on existing hospitality rows (price snapshot, gallery, etc.)
_HOSPITALITY_ENRICH_KEYS = (
    "price_from",
    "price_currency",
    "hotel_class",
    "amenities",
    "check_in_time",
    "check_out_time",
    "data_source",
    "thumbnail_url",
    "website",
    "phone",
    "address",
    "description",
    "rating",
    "rating_count",
    "photo_urls",
    "cuisine",
    "external_url",
)


def _pois_columns() -> set[str]:
    """Cached live column set so optional migration fields can be omitted safely."""
    global _POIS_COLUMNS
    if _POIS_COLUMNS is not None:
        return _POIS_COLUMNS
    result = supabase.table("pois").select("*").limit(1).execute()
    if result.data:
        _POIS_COLUMNS = set(result.data[0].keys())
    else:
        _POIS_COLUMNS = {
            "name",
            "category",
            "status",
            "region",
            "lat",
            "lng",
            "place_id",
            "rating",
            "rating_count",
            "address",
            "phone",
            "website",
            "description",
            "price_from",
            "price_currency",
            "hotel_class",
            "amenities",
            "check_in_time",
            "check_out_time",
            "data_source",
            "thumbnail_url",
        }
    return _POIS_COLUMNS


def invalidate_pois_columns_cache() -> None:
    global _POIS_COLUMNS
    _POIS_COLUMNS = None


def _strip_unknown_poi_fields(row: dict[str, Any]) -> dict[str, Any]:
    cols = _pois_columns()
    # Drop migration-only fields until schema is applied; never send unknown keys.
    return {k: v for k, v in row.items() if k in cols}


def _existing_hospitality_rows(place_ids: list[str]) -> dict[str, dict[str, Any]]:
    """place_id → existing poi row (id + enrich fields)."""
    found: dict[str, dict[str, Any]] = {}
    select_cols = ["id", "place_id", "region", *_HOSPITALITY_ENRICH_KEYS]
    cols = _pois_columns()
    select = ",".join(c for c in select_cols if c == "id" or c == "place_id" or c in cols)
    chunk_size = 60
    for i in range(0, len(place_ids), chunk_size):
        chunk = place_ids[i : i + chunk_size]
        if not chunk:
            continue
        result = (
            supabase.table("pois").select(select).in_("place_id", chunk).execute()
        )
        for row in result.data or []:
            pid = str(row.get("place_id") or "").strip()
            if pid:
                found[pid] = row
    return found


def _merge_amenities(existing: Any, incoming: Any) -> list[str] | None:
    merged: list[str] = []
    for src in (existing, incoming):
        if not isinstance(src, list):
            continue
        for item in src:
            text = str(item).strip()
            if text and text not in merged:
                merged.append(text)
            if len(merged) >= 40:
                return merged
    return merged or None


def _hospitality_patch(
    existing: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    """Build update payload: refresh lodging snapshots; fill empty scalar fields."""
    patch: dict[str, Any] = {}
    refresh_always = {
        "price_from",
        "price_currency",
        "hotel_class",
        "check_in_time",
        "check_out_time",
        "thumbnail_url",
        "photo_urls",
        "data_source",
    }
    for key in _HOSPITALITY_ENRICH_KEYS:
        if key not in incoming or incoming[key] is None:
            continue
        if key == "amenities":
            merged = _merge_amenities(existing.get("amenities"), incoming.get("amenities"))
            if merged:
                patch["amenities"] = merged
            continue
        if key in refresh_always:
            patch[key] = incoming[key]
            continue
        if key == "rating":
            try:
                new_count = int(incoming.get("rating_count") or 0)
                old_count = int(existing.get("rating_count") or 0)
            except (TypeError, ValueError):
                new_count, old_count = 0, 0
            if existing.get("rating") is None or new_count >= old_count:
                patch["rating"] = incoming["rating"]
                if incoming.get("rating_count") is not None:
                    patch["rating_count"] = incoming["rating_count"]
            continue
        if key == "rating_count":
            continue
        if existing.get(key) in (None, "", []):
            patch[key] = incoming[key]
    return patch


def _sync_poi_gallery(poi_uuid: str, urls: list[str]) -> int:
    """Insert missing external gallery URLs into poi_photos (approved)."""
    clean_urls = [
        u.strip()[:2000]
        for u in urls
        if isinstance(u, str) and u.strip().startswith("http")
    ][:12]
    if not clean_urls or not poi_uuid:
        return 0
    existing = (
        supabase.table("poi_photos")
        .select("photo_url")
        .eq("poi_id", poi_uuid)
        .execute()
    )
    have = {
        str(r.get("photo_url") or "").strip()
        for r in (existing.data or [])
        if r.get("photo_url")
    }
    to_add = [u for u in clean_urls if u not in have]
    if not to_add:
        return 0
    start_index = len(have)
    rows = [
        {
            "poi_id": poi_uuid,
            "photo_url": url,
            "thumb_url": url,
            "medium_url": url,
            "order_index": start_index + idx,
            "status": "approved",
            "uploaded_by": None,
        }
        for idx, url in enumerate(to_add)
    ]
    supabase.table("poi_photos").insert(rows).execute()
    return len(rows)


def upsert_hospitality_places(cleaned_places: list[dict[str, Any]]) -> dict[str, int]:
    """
    Insert new hospitality POIs and enrich existing rows (price, amenities, photos).
    Also seeds poi_photos from thumbnail_url / photo_urls.
    """
    if not cleaned_places:
        return {"inserted": 0, "updated": 0, "skipped": 0, "photos_added": 0}

    # Dedupe by place_id within the batch (Geoapify can emit duplicates)
    deduped: dict[str, dict[str, Any]] = {}
    for raw in cleaned_places:
        pid = str(raw.get("place_id") or "").strip()
        if not pid:
            continue
        prev = deduped.get(pid)
        if prev is None:
            deduped[pid] = raw
            continue
        # Prefer row with more enrich fields / photos
        score = lambda r: (
            1 if r.get("price_from") is not None else 0,
            1 if r.get("thumbnail_url") else 0,
            len(r.get("photo_urls") or []) if isinstance(r.get("photo_urls"), list) else 0,
            len(r.get("amenities") or []) if isinstance(r.get("amenities"), list) else 0,
        )
        if score(raw) >= score(prev):
            deduped[pid] = raw
    cleaned_places = list(deduped.values())

    place_ids = [
        str(row["place_id"]).strip()
        for row in cleaned_places
        if row.get("place_id")
    ]
    existing_map = _existing_hospitality_rows(place_ids)

    to_insert: list[dict[str, Any]] = []
    updates: list[tuple[str, dict[str, Any], list[str]]] = []  # uuid, patch, gallery
    skipped = 0

    for raw in cleaned_places:
        pid = str(raw.get("place_id") or "").strip()
        if not pid:
            skipped += 1
            continue
        gallery: list[str] = []
        photos = raw.get("photo_urls")
        if isinstance(photos, list):
            gallery.extend(str(u) for u in photos if u)
        thumb = raw.get("thumbnail_url")
        if isinstance(thumb, str) and thumb.startswith("http") and thumb not in gallery:
            gallery.insert(0, thumb)

        row = _strip_unknown_poi_fields(dict(raw))
        prev = existing_map.get(pid)
        # Same external id already stored under another region → keep a local copy
        if prev is not None:
            prev_region = str(prev.get("region") or "").strip().lower()
            row_region = str(row.get("region") or "").strip().lower()
            if prev_region and row_region and prev_region != row_region:
                scoped = f"{pid}:{row_region}"
                if scoped not in existing_map:
                    row = dict(row)
                    row["place_id"] = scoped
                    to_insert.append(_strip_unknown_poi_fields(row))
                    continue
                prev = existing_map[scoped]
                pid = scoped
                row = _strip_unknown_poi_fields(dict(raw))
                row["place_id"] = scoped
        if prev is None:
            to_insert.append(row)
            continue
        patch = _hospitality_patch(prev, row)
        poi_uuid = str(prev.get("id") or "")
        if patch or gallery:
            updates.append((poi_uuid, patch, gallery))
        else:
            skipped += 1

    inserted = 0
    batch_size = 40
    inserted_rows: list[dict[str, Any]] = []
    for i in range(0, len(to_insert), batch_size):
        batch = to_insert[i : i + batch_size]
        try:
            result = supabase.table("pois").insert(batch).execute()
            batch_data = list(result.data or [])
            inserted += len(batch_data) if batch_data else len(batch)
            inserted_rows.extend(batch_data)
        except Exception as exc:  # noqa: BLE001 — race / duplicate place_id
            msg = str(exc)
            if "23505" not in msg and "duplicate key" not in msg.lower():
                raise
            # Fall back to one-by-one upsert so one duplicate does not drop the batch
            for item in batch:
                pid = str(item.get("place_id") or "")
                try:
                    result = supabase.table("pois").insert(item).execute()
                    batch_data = list(result.data or [])
                    if batch_data:
                        inserted += 1
                        inserted_rows.extend(batch_data)
                except Exception as one_exc:  # noqa: BLE001
                    one_msg = str(one_exc)
                    if "23505" in one_msg or "duplicate key" in one_msg.lower():
                        # Treat as existing — refresh lookup and enrich
                        found = _existing_hospitality_rows([pid]).get(pid)
                        if found:
                            patch = _hospitality_patch(found, item)
                            poi_uuid = str(found.get("id") or "")
                            gallery = []
                            photos = item.get("photo_urls")
                            if isinstance(photos, list):
                                gallery.extend(str(u) for u in photos if u)
                            thumb = item.get("thumbnail_url")
                            if isinstance(thumb, str) and thumb.startswith("http"):
                                gallery.insert(0, thumb)
                            if patch and poi_uuid:
                                supabase.table("pois").update(patch).eq(
                                    "id", poi_uuid
                                ).execute()
                                updates.append((poi_uuid, {}, gallery))
                            elif gallery and poi_uuid:
                                updates.append((poi_uuid, {}, gallery))
                        continue
                    raise

    updated = 0
    photos_added = 0
    for poi_uuid, patch, gallery in updates:
        if patch and poi_uuid:
            supabase.table("pois").update(patch).eq("id", poi_uuid).execute()
            updated += 1
        if gallery and poi_uuid:
            photos_added += _sync_poi_gallery(poi_uuid, gallery)

    for row in inserted_rows:
        poi_uuid = str(row.get("id") or "")
        gallery: list[str] = []
        photos = row.get("photo_urls")
        if isinstance(photos, list):
            gallery.extend(str(u) for u in photos if u)
        thumb = row.get("thumbnail_url")
        if isinstance(thumb, str) and thumb.startswith("http"):
            gallery.insert(0, thumb)
        # Prefer gallery from original cleaned payload when insert response omits jsonb
        if not gallery:
            pid = str(row.get("place_id") or "")
            for raw in cleaned_places:
                if str(raw.get("place_id") or "") == pid:
                    photos = raw.get("photo_urls")
                    if isinstance(photos, list):
                        gallery.extend(str(u) for u in photos if u)
                    thumb = raw.get("thumbnail_url")
                    if isinstance(thumb, str) and thumb.startswith("http"):
                        gallery.insert(0, thumb)
                    break
        if poi_uuid and gallery:
            photos_added += _sync_poi_gallery(poi_uuid, gallery)

    return {
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "photos_added": photos_added,
    }


def _sync_hybrid_all_progressive(
    coordinates: dict[str, float],
    region_key: str,
    db_region: str,
) -> JSONResponse:
    """
    Write Google food/lodging first so the app has POIs even if OSM times out later.
    Google batches upsert; OSM batches insert-if-missing only.
    """
    lat = coordinates["latitude"]
    lng = coordinates["longitude"]
    all_warnings: list[str] = []
    total_fetched = 0
    total_inserted = 0
    total_skipped = 0
    category_counts: dict[str, int] = {}
    seen_place_ids: set[str] = set()

    for label, raw_places, warnings in iter_hybrid_all_batches(lat, lng):
        all_warnings.extend(warnings)
        total_fetched += len(raw_places)

        unique_batch: list[dict[str, Any]] = []
        for place in raw_places:
            place_id = str(place.get("place_id") or "").strip()
            if not place_id or place_id in seen_place_ids:
                continue
            seen_place_ids.add(place_id)
            unique_batch.append(place)

        cleaned = [
            cleaned
            for place in unique_batch
            if (cleaned := clean_place(place, region_key, "all")) is not None
        ]
        if not cleaned:
            print(f"[hybrid] progressive skip empty batch={label}")
            continue

        is_osm_batch = str(label).startswith("osm")
        if is_osm_batch:
            # Attractions only from OSM; never touch existing rows
            cleaned = [
                row
                for row in cleaned
                if str(row.get("category") or "") in OSM_SYNC_ATTRACTION_CATEGORIES
            ]
            inserted, skipped = _insert_if_missing(cleaned)
            total_inserted += inserted
            total_skipped += skipped
            print(
                f"[hybrid] progressive insert-if-missing batch={label} "
                f"cleaned={len(cleaned)} inserted={inserted} skipped={skipped}"
            )
        else:
            # Google food/lodging: upsert so admin refresh can update
            result = (
                supabase.table("pois")
                .upsert(cleaned, on_conflict="place_id")
                .execute()
            )
            batch_n = len(result.data) if result.data else len(cleaned)
            total_inserted += batch_n
            print(
                f"[hybrid] progressive upsert batch={label} "
                f"cleaned={len(cleaned)} upserted={batch_n}"
            )

        for row in cleaned:
            cat = str(row.get("category") or "other")
            category_counts[cat] = category_counts.get(cat, 0) + 1

    if total_inserted == 0 and total_skipped == 0:
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": db_region,
                "category": "all",
                "fetched": total_fetched,
                "inserted": 0,
                "skipped": 0,
                "warnings": all_warnings,
                "message": "No places found for the given region and category.",
            }
        )

    return JSONResponse(
        content={
            "success": True,
            "data_source": DATA_SOURCE,
            "region": db_region,
            "category": "all",
            "fetched": total_fetched,
            "inserted": total_inserted,
            "skipped": total_skipped,
            "category_counts": category_counts,
            "warnings": all_warnings,
        }
    )


def _insert_missing_and_respond(
    *,
    raw_places: list[dict[str, Any]],
    region_key: str,
    db_region: str,
    category_key: str,
    fetch_warnings: list[str],
) -> JSONResponse:
    cleaned_places = [
        cleaned
        for place in raw_places
        if (cleaned := clean_place(place, region_key, category_key)) is not None
    ]

    # When syncing OSM "all" or a single attraction cat, drop food/lodging rows
    if DATA_SOURCE == "osm":
        cleaned_places = [
            row
            for row in cleaned_places
            if str(row.get("category") or "") not in OSM_SKIP_SYNC_CATEGORIES
        ]

    if not cleaned_places:
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": db_region,
                "category": category_key,
                "fetched": len(raw_places),
                "inserted": 0,
                "skipped": 0,
                "warnings": fetch_warnings,
                "message": "No places found for the given region and category.",
            }
        )

    inserted, skipped = _insert_if_missing(cleaned_places)
    category_counts: dict[str, int] = {}
    for row in cleaned_places:
        cat = str(row.get("category") or "other")
        category_counts[cat] = category_counts.get(cat, 0) + 1

    return JSONResponse(
        content={
            "success": True,
            "data_source": DATA_SOURCE,
            "region": db_region,
            "category": category_key,
            "fetched": len(raw_places),
            "inserted": inserted,
            "skipped": skipped,
            "category_counts": category_counts,
            "warnings": fetch_warnings,
        }
    )


def _fetch_raw_places(
    coordinates: dict[str, float],
    region_key: str,
    category_key: str,
    db_region: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    if DATA_SOURCE == "hybrid":
        return fetch_places_from_hybrid(
            latitude=coordinates["latitude"],
            longitude=coordinates["longitude"],
            category=category_key,
            cache_key=f"{db_region}:{category_key}",
        )
    if DATA_SOURCE == "google":
        return (
            fetch_places_from_google(
                latitude=coordinates["latitude"],
                longitude=coordinates["longitude"],
                category=category_key,
            ),
            [],
        )
    if DATA_SOURCE == "osm":
        # "all" → attractions-only balanced fetch inside places_osm
        return (
            fetch_places_from_osm(
                latitude=coordinates["latitude"],
                longitude=coordinates["longitude"],
                category=category_key,
                cache_key=f"v3attr:{db_region}:{category_key}",
            ),
            [],
        )
    return fetch_places_from_mock(region_key, category_key), []
