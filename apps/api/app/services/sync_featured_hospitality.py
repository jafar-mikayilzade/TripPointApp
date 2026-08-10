"""Sequential multi-source hospitality sync for featured tourism regions.

Order per region (retry then continue on persistent failure):
  1) SerpAPI Google Hotels
  2) RapidAPI Booking hotels
  3) Geoapify hotels + restaurants
  4) RapidAPI TripAdvisor restaurants (Google fallback inside fetch)
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

from app.constants.regions import REGION_COORDINATES, REGION_LABELS, TOURISM_FEATURED_IDS
from app.services.import_serpapi_hotels import import_serpapi_hotels_for_region
from app.services.places_clean import clean_place, to_db_region
from app.services.places_geoapify import (
    fetch_standardized_for_region as fetch_geoapify,
    require_geoapify_key,
)
from app.services.places_rapidapi import (
    fetch_standardized_for_region as fetch_rapidapi,
    require_rapidapi_key,
)
from app.services.places_sync import upsert_hospitality_places

logger = logging.getLogger(__name__)

DEFAULT_MAX_RETRIES = 2
DEFAULT_RETRY_SLEEP_S = 6.0
DEFAULT_REGION_SLEEP_S = 4.0
DEFAULT_STAGE_SLEEP_S = 3.0


def _with_retries(
    label: str,
    fn: Callable[[], dict[str, Any]],
    *,
    max_retries: int = DEFAULT_MAX_RETRIES,
    sleep_s: float = DEFAULT_RETRY_SLEEP_S,
) -> dict[str, Any]:
    last_err: str | None = None
    for attempt in range(1, max(1, max_retries) + 1):
        try:
            payload = fn()
            payload.setdefault("success", True)
            payload["attempts"] = attempt
            return payload
        except Exception as exc:  # noqa: BLE001 — continue pipeline
            last_err = str(exc)
            logger.warning(
                "[hospitality] %s attempt=%s failed: %s", label, attempt, last_err
            )
            if attempt < max_retries:
                time.sleep(sleep_s * attempt)
    return {
        "success": False,
        "attempts": max_retries,
        "error": last_err or "unknown_error",
        "inserted": 0,
        "updated": 0,
        "skipped": 0,
        "photos_added": 0,
    }


def _clean_and_upsert(
    region_key: str,
    places: list[dict[str, Any]],
    *,
    dry_run: bool,
) -> dict[str, Any]:
    cleaned: list[dict[str, Any]] = []
    clean_skipped = 0
    for place in places:
        row = clean_place(place, region_key, str(place.get("category") or "other"))
        if row is None:
            clean_skipped += 1
            continue
        cleaned.append(row)
    if dry_run:
        return {
            "success": True,
            "cleaned": len(cleaned),
            "clean_skipped": clean_skipped,
            "inserted": 0,
            "updated": 0,
            "skipped": 0,
            "photos_added": 0,
            "dry_run": True,
            "sample_place_ids": [r.get("place_id") for r in cleaned[:5]],
        }
    stats = upsert_hospitality_places(cleaned)
    return {
        "success": True,
        "cleaned": len(cleaned),
        "clean_skipped": clean_skipped,
        "inserted": int(stats.get("inserted") or 0),
        "updated": int(stats.get("updated") or 0),
        "skipped": int(stats.get("skipped") or 0),
        "photos_added": int(stats.get("photos_added") or 0),
        "dry_run": False,
        "sample_place_ids": [r.get("place_id") for r in cleaned[:5]],
    }


def sync_serpapi_stage(
    region_key: str,
    *,
    dry_run: bool = False,
    max_pages: int = 3,
) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        if dry_run:
            from app.services.places_serpapi import fetch_hotels_from_serpapi

            raw = fetch_hotels_from_serpapi(region_key, max_pages=max_pages)
            out = _clean_and_upsert(region_key, raw, dry_run=True)
            out["fetched"] = len(raw)
            out["source"] = "serpapi"
            return out
        payload = import_serpapi_hotels_for_region(
            region_key, max_pages=max_pages, currency="AZN"
        )
        payload["source"] = "serpapi"
        return payload

    return _with_retries(f"serpapi:{region_key}", run)


def sync_booking_stage(
    region_key: str,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        require_rapidapi_key()
        fetched = fetch_rapidapi(region_key, kinds=["hotel", "camping"], currency="AZN")
        out = _clean_and_upsert(region_key, fetched.get("places") or [], dry_run=dry_run)
        out["source"] = "booking"
        out["fetched"] = fetched.get("fetched")
        out["mapped"] = fetched.get("mapped")
        out["warnings"] = fetched.get("errors") or []
        return out

    return _with_retries(f"booking:{region_key}", run)


def sync_geoapify_stage(
    region_key: str,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        require_geoapify_key()
        fetched = fetch_geoapify(region_key, kinds=["hotel", "restaurant"])
        out = _clean_and_upsert(region_key, fetched.get("places") or [], dry_run=dry_run)
        out["source"] = "geoapify"
        out["fetched"] = fetched.get("fetched")
        out["mapped"] = fetched.get("mapped")
        out["warnings"] = fetched.get("errors") or []
        return out

    return _with_retries(
        f"geoapify:{region_key}",
        run,
        # Config errors won't recover on retry — still try once more for flaky HTTP
    )


def sync_tripadvisor_stage(
    region_key: str,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        require_rapidapi_key()
        # restaurants only; TA failure falls back to Google inside fetch_rapidapi
        fetched = fetch_rapidapi(region_key, kinds=["restaurant"], currency="AZN")
        out = _clean_and_upsert(region_key, fetched.get("places") or [], dry_run=dry_run)
        out["source"] = "tripadvisor"
        out["fetched"] = fetched.get("fetched")
        out["mapped"] = fetched.get("mapped")
        out["warnings"] = fetched.get("errors") or []
        return out

    return _with_retries(f"tripadvisor:{region_key}", run)


STAGES: tuple[tuple[str, Callable[..., dict[str, Any]]], ...] = (
    ("serpapi", sync_serpapi_stage),
    ("booking", sync_booking_stage),
    ("geoapify", sync_geoapify_stage),
    ("tripadvisor", sync_tripadvisor_stage),
)


def sync_featured_hospitality(
    regions: list[str] | None = None,
    *,
    dry_run: bool = False,
    region_sleep_s: float = DEFAULT_REGION_SLEEP_S,
    max_pages: int = 3,
    stages: list[str] | None = None,
) -> dict[str, Any]:
    wanted_stages = {s.strip().lower() for s in (stages or [s for s, _ in STAGES])}
    region_keys = [
        r.strip().lower()
        for r in (regions or list(TOURISM_FEATURED_IDS))
        if r and r.strip()
    ]

    region_reports: list[dict[str, Any]] = []
    totals = {
        "inserted": 0,
        "updated": 0,
        "skipped": 0,
        "photos_added": 0,
        "stage_ok": 0,
        "stage_fail": 0,
    }

    for idx, key in enumerate(region_keys, start=1):
        if key not in REGION_COORDINATES:
            region_reports.append(
                {
                    "region": key,
                    "success": False,
                    "error": f"unknown_region:{key}",
                }
            )
            continue

        stage_results: dict[str, Any] = {}
        logger.info(
            "[hospitality] region %s/%s %s (%s)",
            idx,
            len(region_keys),
            key,
            REGION_LABELS.get(key, key),
        )

        for stage_name, stage_fn in STAGES:
            if stage_name not in wanted_stages:
                continue
            kwargs: dict[str, Any] = {"dry_run": dry_run}
            if stage_name == "serpapi":
                kwargs["max_pages"] = max_pages
            result = stage_fn(key, **kwargs)
            stage_results[stage_name] = result
            if result.get("success"):
                totals["stage_ok"] += 1
                totals["inserted"] += int(result.get("inserted") or 0)
                totals["updated"] += int(result.get("updated") or 0)
                totals["skipped"] += int(result.get("skipped") or 0)
                totals["photos_added"] += int(result.get("photos_added") or 0)
            else:
                totals["stage_fail"] += 1
            # Longer pause after RapidAPI stages to reduce 429s
            pause = 1.0
            if stage_name in {"booking", "tripadvisor"}:
                pause = DEFAULT_STAGE_SLEEP_S
            time.sleep(pause)

        region_ok = any(r.get("success") for r in stage_results.values()) if stage_results else False
        region_reports.append(
            {
                "region": to_db_region(key),
                "region_label": REGION_LABELS.get(key, key),
                "index": idx,
                "success": region_ok,
                "stages": stage_results,
            }
        )
        if idx < len(region_keys):
            time.sleep(region_sleep_s)

    return {
        "success": totals["stage_fail"] == 0 and bool(region_reports),
        "dry_run": dry_run,
        "regions_total": len(region_keys),
        "regions_done": len(region_reports),
        "totals": totals,
        "regions": region_reports,
    }
