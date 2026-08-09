"""Run OSM named import for quba/qusar/qabala and print JSON report."""
from __future__ import annotations

import json
import sys

import app.services.places_osm as osm
from app.services.import_osm_named import import_osm_named_regions

osm._OVERPASS_COOLDOWN_UNTIL = 0.0


def main() -> int:
    result = import_osm_named_regions(
        ["quba", "qusar", "qabala"],
        radius_m=25_000,
        dry_run=False,
    )
    text = json.dumps(result, ensure_ascii=False, indent=2)
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    print(text)
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
