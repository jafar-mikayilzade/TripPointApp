"""Orchestrate place sync: fetch → clean → upsert."""

from __future__ import annotations

import threading
from typing import Any

import requests
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.config import DATA_SOURCE
from app.constants.categories import ALLOWED_CATEGORIES
from app.constants.regions import REGION_COORDINATES
from app.db import supabase
from app.services.places_clean import clean_place, to_db_region
from app.services.places_google import fetch_places_from_google
from app.services.places_hybrid import fetch_places_from_hybrid, iter_hybrid_all_batches
from app.services.places_mock import fetch_places_from_mock
from app.services.places_osm import fetch_places_from_osm

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
                "upserted": 0,
                "message": "Category 'cafe' is temporarily disabled.",
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
        return _upsert_and_respond(
            raw_places=raw_places,
            region_key=region_key,
            db_region=db_region,
            category_key=category_key,
            fetch_warnings=fetch_warnings,
        )
    except RuntimeError as exc:
        return JSONResponse(
            status_code=502,
            content={
                "success": False,
                "error": "upstream_error",
                "data_source": DATA_SOURCE,
                "message": str(exc),
                "hint": (
                    "Check Railway GOOGLE_PLACES_API_KEY: Places API enabled, "
                    "billing on, key unrestricted for server (or IP), no extra spaces/quotes."
                ),
            },
        )
    except requests.RequestException as exc:
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
                "details": str(exc),
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "sync_failed",
                "message": "Failed to sync places due to an external API or database error.",
                "details": str(exc),
            },
        )
    finally:
        _SYNC_LOCK.release()


def _sync_hybrid_all_progressive(
    coordinates: dict[str, float],
    region_key: str,
    db_region: str,
) -> JSONResponse:
    """
    Write Google food/lodging first so the app has POIs even if OSM times out later.
    """
    lat = coordinates["latitude"]
    lng = coordinates["longitude"]
    all_warnings: list[str] = []
    total_fetched = 0
    total_upserted = 0
    category_counts: dict[str, int] = {}
    seen_place_ids: set[str] = set()

    for label, raw_places, warnings in iter_hybrid_all_batches(lat, lng):
        all_warnings.extend(warnings)
        total_fetched += len(raw_places)

        # Dedupe across batches by place_id within this sync run
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

        result = (
            supabase.table("pois")
            .upsert(cleaned, on_conflict="place_id")
            .execute()
        )
        batch_upserted = len(result.data) if result.data else len(cleaned)
        total_upserted += batch_upserted
        for row in cleaned:
            cat = str(row.get("category") or "other")
            category_counts[cat] = category_counts.get(cat, 0) + 1
        print(
            f"[hybrid] progressive upsert batch={label} "
            f"cleaned={len(cleaned)} upserted={batch_upserted}"
        )

    if total_upserted == 0:
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": db_region,
                "category": "all",
                "fetched": total_fetched,
                "upserted": 0,
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
            "upserted": total_upserted,
            "category_counts": category_counts,
            "warnings": all_warnings,
        }
    )


def _upsert_and_respond(
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

    if not cleaned_places:
        return JSONResponse(
            content={
                "success": True,
                "data_source": DATA_SOURCE,
                "region": db_region,
                "category": category_key,
                "fetched": 0,
                "upserted": 0,
                "warnings": fetch_warnings,
                "message": "No places found for the given region and category.",
            }
        )

    result = (
        supabase.table("pois")
        .upsert(cleaned_places, on_conflict="place_id")
        .execute()
    )
    upserted_count = len(result.data) if result.data else len(cleaned_places)
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
            "upserted": upserted_count,
            "category_counts": category_counts,
            "warnings": fetch_warnings,
            "data": result.data or cleaned_places,
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
        return (
            fetch_places_from_osm(
                latitude=coordinates["latitude"],
                longitude=coordinates["longitude"],
                category=category_key,
                cache_key=f"{db_region}:{category_key}",
            ),
            [],
        )
    return fetch_places_from_mock(region_key, category_key), []
