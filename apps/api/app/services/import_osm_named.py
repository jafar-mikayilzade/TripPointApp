"""Import named OSM tourism POIs for selected regions into Supabase `pois`.

Uses small per-category Overpass queries (avoids one huge timeout-prone request).
Empty-name features are never inserted (`["name"]` in QL + clean_place guard).
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.constants.regions import REGION_COORDINATES, REGION_LABELS
from app.services.places_clean import clean_place, to_db_region
from app.services.places_osm import (
    _overpass_get,
    _overpass_in_cooldown,
    _parse_overpass_places,
)
from app.services.places_sync import _insert_if_missing

logger = logging.getLogger(__name__)

DEFAULT_REGIONS = ("quba", "qusar", "qabala")
DEFAULT_RADIUS_M = 25_000
DEFAULT_RESULT_LIMIT = 60

# (app category, overpass selector with name required)
CATEGORY_SELECTORS: list[tuple[str, str]] = [
    ("restaurant", 'node["amenity"="restaurant"]["name"]'),
    ("restaurant", 'way["amenity"="restaurant"]["name"]'),
    ("waterfall", 'nwr["waterway"="waterfall"]["name"]'),
    ("lake", 'nwr["natural"="water"]["water"="lake"]["name"]'),
    ("lake", 'nwr["water"="lake"]["name"]'),
    ("nature", 'nwr["leisure"="nature_reserve"]["name"]'),
    ("nature", 'relation["boundary"="national_park"]["name"]'),
    ("mountain", 'node["natural"="peak"]["name"]'),
]


def _query_for_selector(
    latitude: float,
    longitude: float,
    selector: str,
    *,
    radius_m: int,
    result_limit: int,
) -> str:
    around = f"(around:{int(radius_m)},{latitude},{longitude})"
    needs_center = selector.lstrip().startswith(("way", "rel", "nwr"))
    out_clause = "out center" if needs_center else "out body"
    return (
        f"[out:json][timeout:25];\n"
        f"{selector}{around};\n"
        f"{out_clause} {int(result_limit)};"
    )


def _stamp_data_source(place: dict[str, Any]) -> dict[str, Any]:
    out = dict(place)
    out["data_source"] = "osm"
    return out


def _fetch_category_places(
    *,
    lat: float,
    lng: float,
    app_category: str,
    selector: str,
    radius_m: int,
) -> list[dict[str, Any]]:
    if _overpass_in_cooldown():
        logger.warning("overpass cooldown — skip %s", app_category)
        return []
    query = _query_for_selector(
        lat, lng, selector, radius_m=radius_m, result_limit=DEFAULT_RESULT_LIMIT
    )
    # Prefer currently healthy public mirror first (others often 429/504)
    preferred = "https://overpass.openstreetmap.fr/api/interpreter"
    try:
        from app.config import OVERPASS_ENDPOINTS

        endpoints = [preferred] + [
            e for e in OVERPASS_ENDPOINTS if e.rstrip("/") != preferred.rstrip("/")
        ]
    except Exception:
        endpoints = [preferred]

    # Temporarily point module mirrors at preferred order without mutating forever
    import app.services.places_osm as osm_mod

    previous = list(osm_mod.OVERPASS_ENDPOINTS)
    osm_mod.OVERPASS_ENDPOINTS = endpoints
    # Clear cooldown so one bad mirror earlier doesn't block the run
    osm_mod._OVERPASS_COOLDOWN_UNTIL = 0.0
    try:
        payload = _overpass_get(query, timeout_seconds=35.0, max_mirrors=2)
    except Exception as exc:
        logger.warning("overpass failed for %s: %s", app_category, exc)
        print(f"[osm-import] {app_category} failed: {exc}")
        return []
    finally:
        osm_mod.OVERPASS_ENDPOINTS = previous

    places = _parse_overpass_places(payload, result_limit=DEFAULT_RESULT_LIMIT)
    for place in places:
        place["category"] = app_category
    print(f"[osm-import] {app_category}: +{len(places)}")
    return places


def import_osm_named_for_region(
    region: str,
    *,
    radius_m: int = DEFAULT_RADIUS_M,
    dry_run: bool = False,
) -> dict[str, Any]:
    key = region.strip().lower()
    if key not in REGION_COORDINATES:
        raise ValueError(f"Unknown region '{region}'")

    coords = REGION_COORDINATES[key]
    lat = float(coords["latitude"])
    lng = float(coords["longitude"])

    raw: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    selector_errors: list[str] = []

    for app_cat, selector in CATEGORY_SELECTORS:
        batch = _fetch_category_places(
            lat=lat,
            lng=lng,
            app_category=app_cat,
            selector=selector,
            radius_m=radius_m,
        )
        if not batch and _overpass_in_cooldown():
            selector_errors.append(f"{app_cat}: cooldown")
            break
        for place in batch:
            pid = str(place.get("place_id") or "")
            if not pid or pid in seen_ids:
                continue
            seen_ids.add(pid)
            raw.append(place)
        # Be gentle with public mirrors
        time.sleep(1.0)

    cleaned: list[dict[str, Any]] = []
    skipped_no_name = 0
    skipped_clean = 0
    by_cat: dict[str, int] = {}

    for place in raw:
        name = str(place.get("name") or "").strip()
        if not name:
            skipped_no_name += 1
            continue
        cat = str(place.get("category") or "other").strip().lower()
        stamped = _stamp_data_source(place)
        row = clean_place(stamped, key, cat)
        if row is None:
            skipped_clean += 1
            continue
        if not str(row.get("name") or "").strip():
            skipped_no_name += 1
            continue
        cleaned.append(row)
        by_cat[cat] = by_cat.get(cat, 0) + 1

    inserted = 0
    skipped_existing = 0
    if not dry_run and cleaned:
        inserted, skipped_existing = _insert_if_missing(cleaned)

    return {
        "success": True,
        "region": to_db_region(key),
        "region_label": REGION_LABELS.get(key, key),
        "radius_m": radius_m,
        "fetched": len(raw),
        "cleaned": len(cleaned),
        "by_category": by_cat,
        "inserted": inserted if not dry_run else 0,
        "skipped_existing": skipped_existing if not dry_run else 0,
        "skipped_no_name": skipped_no_name,
        "skipped_clean": skipped_clean,
        "selector_errors": selector_errors,
        "dry_run": dry_run,
        "sample_place_ids": [r.get("place_id") for r in cleaned[:8]],
    }


def import_osm_named_regions(
    regions: list[str],
    *,
    radius_m: int = DEFAULT_RADIUS_M,
    dry_run: bool = False,
) -> dict[str, Any]:
    reports: list[dict[str, Any]] = []
    total_inserted = 0
    total_cleaned = 0
    for region in regions:
        try:
            report = import_osm_named_for_region(
                region, radius_m=radius_m, dry_run=dry_run
            )
        except Exception as exc:
            logger.exception("OSM import failed for %s", region)
            reports.append(
                {
                    "region": region,
                    "success": False,
                    "error": str(exc),
                }
            )
            continue
        reports.append(report)
        total_inserted += int(report.get("inserted") or 0)
        total_cleaned += int(report.get("cleaned") or 0)
        time.sleep(1.5)

    ok = bool(reports) and all(r.get("success") for r in reports)
    return {
        "success": ok,
        "dry_run": dry_run,
        "total_cleaned": total_cleaned,
        "total_inserted": total_inserted,
        "regions": reports,
    }
