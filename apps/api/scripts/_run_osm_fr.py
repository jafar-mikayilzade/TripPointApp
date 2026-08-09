"""Direct Overpass fetch via French mirror — used when other mirrors are rate-limited."""

from __future__ import annotations

import json
import sys
import time
from typing import Any

import requests

from app.constants.regions import REGION_COORDINATES, REGION_LABELS
from app.services.import_osm_named import CATEGORY_SELECTORS, DEFAULT_RADIUS_M
from app.services.places_clean import clean_place, to_db_region
from app.services.places_osm import _parse_overpass_places, osm_element_to_place
from app.services.places_sync import _insert_if_missing

MIRROR = "https://overpass.openstreetmap.fr/api/interpreter"
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "TripPoint/1.0 (import-osm-named; contact=dev@trippoint.local)",
}


def _query(lat: float, lng: float, selector: str, radius_m: int) -> str:
    around = f"(around:{int(radius_m)},{lat},{lng})"
    needs_center = selector.lstrip().startswith(("way", "rel", "nwr"))
    out_clause = "out center" if needs_center else "out body"
    return (
        f"[out:json][timeout:25];\n"
        f"{selector}{around};\n"
        f"{out_clause} 60;"
    )


def fetch_selector(lat: float, lng: float, selector: str, radius_m: int) -> list[dict[str, Any]]:
    q = _query(lat, lng, selector, radius_m)
    resp = requests.post(MIRROR, data={"data": q}, headers=HEADERS, timeout=(8, 45))
    if resp.status_code == 429:
        raise RuntimeError("rate_limited")
    resp.raise_for_status()
    return _parse_overpass_places(resp.json(), result_limit=60)


def import_region(region: str, *, radius_m: int = DEFAULT_RADIUS_M) -> dict[str, Any]:
    key = region.strip().lower()
    coords = REGION_COORDINATES[key]
    lat, lng = float(coords["latitude"]), float(coords["longitude"])
    raw: list[dict[str, Any]] = []
    seen: set[str] = set()
    errors: list[str] = []

    for app_cat, selector in CATEGORY_SELECTORS:
        try:
            batch = fetch_selector(lat, lng, selector, radius_m)
            for p in batch:
                p["category"] = app_cat
                p["data_source"] = "osm"
                pid = str(p.get("place_id") or "")
                if pid and pid not in seen:
                    seen.add(pid)
                    raw.append(p)
            print(f"  [{key}] {app_cat}: +{len(batch)}", flush=True)
        except Exception as exc:
            msg = f"{app_cat}: {exc}"
            errors.append(msg)
            print(f"  [{key}] FAIL {msg}", flush=True)
            if "rate_limited" in str(exc):
                time.sleep(20)
            continue
        time.sleep(2.0)

    cleaned: list[dict[str, Any]] = []
    skipped_no_name = 0
    for place in raw:
        name = str(place.get("name") or "").strip()
        if not name:
            skipped_no_name += 1
            continue
        row = clean_place(place, key, str(place.get("category") or "other"))
        if row is None or not str(row.get("name") or "").strip():
            skipped_no_name += 1
            continue
        cleaned.append(row)

    inserted, skipped_existing = _insert_if_missing(cleaned) if cleaned else (0, 0)
    by_cat: dict[str, int] = {}
    for r in cleaned:
        c = str(r.get("category"))
        by_cat[c] = by_cat.get(c, 0) + 1

    return {
        "region": to_db_region(key),
        "region_label": REGION_LABELS.get(key, key),
        "fetched": len(raw),
        "cleaned": len(cleaned),
        "by_category": by_cat,
        "inserted": inserted,
        "skipped_existing": skipped_existing,
        "skipped_no_name": skipped_no_name,
        "errors": errors,
        "success": True,
    }


def main() -> int:
    regions = ["quba", "qusar", "qabala"]
    reports = []
    total_ins = 0
    for region in regions:
        print(f"=== {region} ===", flush=True)
        try:
            rep = import_region(region, radius_m=25_000)
        except Exception as exc:
            rep = {"region": region, "success": False, "error": str(exc)}
            print(f"REGION FAIL {exc}", flush=True)
        reports.append(rep)
        total_ins += int(rep.get("inserted") or 0)
        time.sleep(3)

    out = {
        "success": all(r.get("success") for r in reports),
        "total_inserted": total_ins,
        "regions": reports,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2), flush=True)
    return 0 if out["success"] else 1


if __name__ == "__main__":
    # Ensure package imports work when run as script
    raise SystemExit(main())
