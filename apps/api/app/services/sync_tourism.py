"""Sync RapidAPI Booking/TripAdvisor tourism POIs into Supabase `pois`."""

from __future__ import annotations

import logging
from typing import Any

from app.constants.regions import REGION_COORDINATES, REGION_LABELS
from app.services.places_clean import clean_place, to_db_region
from app.services.places_rapidapi import (
    Kind,
    RapidApiConfigError,
    RapidApiEndpointError,
    fetch_standardized_for_region,
    require_rapidapi_key,
)
from app.services.places_sync import upsert_hospitality_places

logger = logging.getLogger(__name__)

DEFAULT_REGIONS = ("quba", "qabala", "qusar")
DEFAULT_KINDS: tuple[Kind, ...] = ("hotel", "restaurant", "camping")


def sync_tourism_regions(
    regions: list[str],
    *,
    kinds: list[Kind] | None = None,
    currency: str = "AZN",
    dry_run: bool = False,
) -> dict[str, Any]:
    require_rapidapi_key()

    wanted = kinds or list(DEFAULT_KINDS)
    region_reports: list[dict[str, Any]] = []
    total_mapped = 0
    total_inserted = 0
    total_skipped = 0

    for region in regions:
        key = region.strip().lower()
        if key not in REGION_COORDINATES:
            region_reports.append(
                {
                    "region": key,
                    "success": False,
                    "error": f"unknown_region:{key}",
                }
            )
            continue

        try:
            fetched = fetch_standardized_for_region(
                key, kinds=wanted, currency=currency
            )
        except (RapidApiConfigError, RapidApiEndpointError) as exc:
            region_reports.append(
                {
                    "region": key,
                    "success": False,
                    "error": str(exc),
                }
            )
            # Hard stop on auth/endpoint issues so we do not burn quota
            return {
                "success": False,
                "dry_run": dry_run,
                "stopped_on": key,
                "error": str(exc),
                "regions": region_reports,
                "subscribe": {
                    "booking": "https://rapidapi.com/DataCrawler/api/booking-com15",
                    "tripadvisor": "https://rapidapi.com/apiheya/api/tripadvisor16",
                },
            }

        cleaned: list[dict[str, Any]] = []
        clean_skipped = 0
        for place in fetched["places"]:
            category = str(place.get("category") or "hotel")
            row = clean_place(place, key, category)
            if row is None:
                clean_skipped += 1
                continue
            cleaned.append(row)

        inserted = 0
        updated = 0
        skipped_existing = 0
        photos_added = 0
        if dry_run:
            skipped_existing = 0
        else:
            stats = upsert_hospitality_places(cleaned)
            inserted = int(stats.get("inserted") or 0)
            updated = int(stats.get("updated") or 0)
            skipped_existing = int(stats.get("skipped") or 0)
            photos_added = int(stats.get("photos_added") or 0)

        total_mapped += len(cleaned)
        total_inserted += inserted
        total_skipped += skipped_existing + clean_skipped

        region_reports.append(
            {
                "region": to_db_region(key),
                "region_label": REGION_LABELS.get(key, key),
                "success": True,
                "fetched": fetched.get("fetched"),
                "mapped": fetched.get("mapped"),
                "skipped_map": fetched.get("skipped"),
                "cleaned": len(cleaned),
                "clean_skipped": clean_skipped,
                "inserted": inserted if not dry_run else 0,
                "updated": updated if not dry_run else 0,
                "skipped_existing": skipped_existing if not dry_run else 0,
                "photos_added": photos_added if not dry_run else 0,
                "dry_run": dry_run,
                "warnings": fetched.get("errors") or [],
                "sample_place_ids": [r.get("place_id") for r in cleaned[:5]],
            }
        )

    return {
        "success": all(r.get("success") for r in region_reports) if region_reports else False,
        "dry_run": dry_run,
        "currency": currency,
        "kinds": wanted,
        "total_cleaned": total_mapped,
        "total_inserted": total_inserted,
        "total_skipped": total_skipped,
        "regions": region_reports,
    }
