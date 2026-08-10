"""Lodging/food top-up after featured OSM sync (hotels often timed out on nwr)."""

from __future__ import annotations

import app.ssl_insecure  # noqa: F401

import json
import sys
import time

from dotenv import load_dotenv

load_dotenv()

from app.constants.regions import TOURISM_FEATURED_IDS
from app.services import import_osm_named as mod

LODGING_SELECTORS = [
    ("hotel", 'node["tourism"="hotel"]["name"]'),
    ("hotel", 'way["tourism"="hotel"]["name"]'),
    ("guesthouse", 'node["tourism"="guest_house"]["name"]'),
    ("guesthouse", 'way["tourism"="guest_house"]["name"]'),
    ("guesthouse", 'nwr["tourism"="chalet"]["name"]'),
    ("guesthouse", 'nwr["tourism"="apartment"]["name"]'),
    ("hostel", 'nwr["tourism"="hostel"]["name"]'),
    ("restaurant", 'node["amenity"="restaurant"]["name"]'),
]


def main() -> int:
    # Temporarily restrict selectors for a faster lodging pass
    previous = list(mod.CATEGORY_SELECTORS)
    mod.CATEGORY_SELECTORS = LODGING_SELECTORS
    total_inserted = 0
    try:
        for idx, region in enumerate(TOURISM_FEATURED_IDS, start=1):
            print(json.dumps({"status": "start", "index": idx, "region": region}), flush=True)
            try:
                import app.services.places_osm as osm_mod

                osm_mod._OVERPASS_COOLDOWN_UNTIL = 0.0
                report = mod.import_osm_named_for_region(
                    region, radius_m=35_000, dry_run=False
                )
            except Exception as exc:  # noqa: BLE001
                print(json.dumps({"status": "failed", "region": region, "error": str(exc)}), flush=True)
                time.sleep(8)
                continue
            inserted = int(report.get("inserted") or 0)
            total_inserted += inserted
            print(
                json.dumps(
                    {
                        "status": "done",
                        "region": region,
                        "inserted": inserted,
                        "cleaned": report.get("cleaned"),
                        "by_category": report.get("by_category"),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            time.sleep(4)
    finally:
        mod.CATEGORY_SELECTORS = previous

    print(json.dumps({"success": True, "total_inserted": total_inserted}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
