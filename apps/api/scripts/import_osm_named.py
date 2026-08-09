"""CLI: import named OSM tourism POIs for Quba / Qusar / Qəbələ.

Usage (from apps/api):
  python -m scripts.import_osm_named --regions quba,qusar,qabala --dry-run
  python -m scripts.import_osm_named --regions quba,qusar,qabala
"""

from __future__ import annotations

import argparse
import json
import sys

from app.services.import_osm_named import DEFAULT_REGIONS, import_osm_named_regions


def emit(payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        print(text)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((text + "\n").encode("utf-8", errors="replace"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import named OSM waterfall/lake/nature/mountain/restaurant → pois"
    )
    parser.add_argument("--regions", default=",".join(DEFAULT_REGIONS))
    parser.add_argument("--radius-m", type=int, default=40_000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    try:
        result = import_osm_named_regions(
            regions,
            radius_m=args.radius_m,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        emit({"success": False, "error": str(exc)})
        return 1

    emit(result)
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
