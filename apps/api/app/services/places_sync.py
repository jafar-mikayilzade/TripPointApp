"""Orchestrate place sync: fetch → clean → upsert."""

from __future__ import annotations

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
from app.services.places_mock import fetch_places_from_mock
from app.services.places_osm import fetch_places_from_osm


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

    coordinates = REGION_COORDINATES[region_key]
    db_region = to_db_region(region_key)

    try:
        raw_places = _fetch_raw_places(coordinates, region_key, category_key, db_region)

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
                "data": result.data or cleaned_places,
            }
        )

    except requests.RequestException as exc:
        source_label = {
            "google": "Google Places API",
            "osm": "OpenStreetMap Overpass API",
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


def _fetch_raw_places(
    coordinates: dict[str, float],
    region_key: str,
    category_key: str,
    db_region: str,
) -> list[dict[str, Any]]:
    if DATA_SOURCE == "google":
        return fetch_places_from_google(
            latitude=coordinates["latitude"],
            longitude=coordinates["longitude"],
            category=category_key,
        )
    if DATA_SOURCE == "osm":
        return fetch_places_from_osm(
            latitude=coordinates["latitude"],
            longitude=coordinates["longitude"],
            category=category_key,
            cache_key=f"{db_region}:{category_key}",
        )
    return fetch_places_from_mock(region_key, category_key)
