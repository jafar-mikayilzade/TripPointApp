"""Sync Geoapify Places into Supabase `pois` (insert-if-missing)."""

from __future__ import annotations

import logging
from typing import Any

from app.constants.regions import REGION_COORDINATES, REGION_LABELS
from app.services.places_clean import clean_place, to_db_region
from app.services.places_geoapify import (
    Kind,
    GeoapifyConfigError,
    GeoapifyEndpointError,
    fetch_standardized_for_region,
    require_geoapify_key,
)
from app.services.places_sync import upsert_hospitality_places

logger = logging.getLogger(__name__)

DEFAULT_REGIONS = ("quba", "qusar", "qabala")
DEFAULT_KINDS: tuple[Kind, ...] = (
    "hotel",
    "restaurant",
    "camping",
    "lake",
    "waterfall",
)


def sync_geoapify_regions(
    regions: list[str],
    *,
    kinds: list[Kind] | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    require_geoapify_key()
    wanted = kinds or list(DEFAULT_KINDS)
    reports: list[dict[str, Any]] = []
    total_cleaned = 0
    total_inserted = 0
    total_skipped = 0

    for region in regions:
        key = region.strip().lower()
        if key not in REGION_COORDINATES:
            reports.append({"region": key, "success": False, "error": f"unknown_region:{key}"})
            continue

        try:
            fetched = fetch_standardized_for_region(key, kinds=wanted)
        except (GeoapifyConfigError, GeoapifyEndpointError) as exc:
            reports.append({"region": key, "success": False, "error": str(exc)})
            return {
                "success": False,
                "dry_run": dry_run,
                "stopped_on": key,
                "error": str(exc),
                "regions": reports,
            }

        cleaned: list[dict[str, Any]] = []
        clean_skipped = 0
        for place in fetched["places"]:
            row = clean_place(place, key, str(place.get("category") or "other"))
            if row is None:
                clean_skipped += 1
                continue
            cleaned.append(row)

        inserted = 0
        updated = 0
        skipped_existing = 0
        photos_added = 0
        if not dry_run:
            stats = upsert_hospitality_places(cleaned)
            inserted = int(stats.get("inserted") or 0)
            updated = int(stats.get("updated") or 0)
            skipped_existing = int(stats.get("skipped") or 0)
            photos_added = int(stats.get("photos_added") or 0)

        total_cleaned += len(cleaned)
        total_inserted += inserted
        total_skipped += skipped_existing + clean_skipped

        reports.append(
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
        "success": all(r.get("success") for r in reports) if reports else False,
        "dry_run": dry_run,
        "kinds": wanted,
        "total_cleaned": total_cleaned,
        "total_inserted": total_inserted,
        "total_skipped": total_skipped,
        "regions": reports,
        "note": "No new pois columns required; used data_source=geoapify + place_id geoapify:…",
    }
