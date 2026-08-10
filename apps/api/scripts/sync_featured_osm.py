"""Sequentially import OSM tourism POIs for all featured regions.

Usage (from apps/api):
  python -m scripts.sync_featured_osm
  python -m scripts.sync_featured_osm --dry-run
  python -m scripts.sync_featured_osm --regions baku,quba
"""

from __future__ import annotations

# Must run before any HTTP client is created (Supabase / Overpass).
import app.ssl_insecure  # noqa: F401

import argparse
import json
import sys
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from app.constants.regions import TOURISM_FEATURED_IDS
from app.services.import_osm_named import import_osm_named_for_region


def emit(payload: dict[str, Any]) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((text + "\n").encode("utf-8", errors="replace"))


def sync_region_with_retries(
    region: str,
    *,
    radius_m: int,
    dry_run: bool,
    max_attempts: int = 4,
    pause_s: float = 8.0,
) -> dict[str, Any]:
    last: dict[str, Any] = {}
    for attempt in range(1, max_attempts + 1):
        try:
            # Clear Overpass cooldown between retries so a timeout does not
            # permanently skip the rest of the region.
            import app.services.places_osm as osm_mod

            osm_mod._OVERPASS_COOLDOWN_UNTIL = 0.0
            report = import_osm_named_for_region(
                region, radius_m=radius_m, dry_run=dry_run
            )
            report["attempt"] = attempt
            errors = list(report.get("selector_errors") or [])
            # Retry if Overpass cooled down mid-region with almost no data
            if errors and int(report.get("cleaned") or 0) == 0 and attempt < max_attempts:
                wait = pause_s * attempt
                emit(
                    {
                        "region": region,
                        "status": "retry",
                        "attempt": attempt,
                        "wait_s": wait,
                        "errors": errors,
                    }
                )
                time.sleep(wait)
                last = report
                continue
            return report
        except Exception as exc:  # noqa: BLE001
            last = {
                "success": False,
                "region": region,
                "attempt": attempt,
                "error": str(exc),
            }
            if attempt >= max_attempts:
                return last
            wait = pause_s * attempt
            emit(
                {
                    "region": region,
                    "status": "retry_exception",
                    "attempt": attempt,
                    "wait_s": wait,
                    "error": str(exc),
                }
            )
            time.sleep(wait)
    return last


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import OSM named tourism POIs for featured regions (sequential)"
    )
    parser.add_argument(
        "--regions",
        default="",
        help="Comma-separated region ids (default: all TOURISM_FEATURED_IDS)",
    )
    parser.add_argument("--radius-m", type=int, default=35_000)
    parser.add_argument("--pause-s", type=float, default=12.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    if not regions:
        regions = list(TOURISM_FEATURED_IDS)

    emit(
        {
            "status": "start",
            "regions": regions,
            "count": len(regions),
            "radius_m": args.radius_m,
            "dry_run": args.dry_run,
        }
    )

    reports: list[dict[str, Any]] = []
    total_inserted = 0
    total_cleaned = 0
    failed: list[str] = []

    for idx, region in enumerate(regions, start=1):
        emit({"status": "region_start", "index": idx, "of": len(regions), "region": region})
        report = sync_region_with_retries(
            region,
            radius_m=args.radius_m,
            dry_run=args.dry_run,
            pause_s=max(5.0, args.pause_s / 2),
        )
        reports.append(report)
        if report.get("success"):
            total_inserted += int(report.get("inserted") or 0)
            total_cleaned += int(report.get("cleaned") or 0)
            emit(
                {
                    "status": "region_done",
                    "region": region,
                    "inserted": report.get("inserted"),
                    "cleaned": report.get("cleaned"),
                    "by_category": report.get("by_category"),
                }
            )
        else:
            failed.append(region)
            emit({"status": "region_failed", "region": region, "report": report})

        if idx < len(regions):
            time.sleep(args.pause_s)

    # One more pass for failures
    if failed and not args.dry_run:
        emit({"status": "retry_failed_batch", "regions": failed})
        still_failed: list[str] = []
        for region in failed:
            time.sleep(args.pause_s)
            report = sync_region_with_retries(
                region,
                radius_m=args.radius_m,
                dry_run=False,
                max_attempts=5,
                pause_s=args.pause_s,
            )
            reports.append(report)
            if report.get("success") and int(report.get("cleaned") or 0) > 0:
                total_inserted += int(report.get("inserted") or 0)
                total_cleaned += int(report.get("cleaned") or 0)
                emit(
                    {
                        "status": "region_recovered",
                        "region": region,
                        "inserted": report.get("inserted"),
                        "cleaned": report.get("cleaned"),
                    }
                )
            else:
                still_failed.append(region)
        failed = still_failed

    summary = {
        "success": len(failed) == 0,
        "regions_done": len(regions) - len(failed),
        "regions_failed": failed,
        "total_cleaned": total_cleaned,
        "total_inserted": total_inserted,
        "dry_run": args.dry_run,
    }
    emit(summary)
    return 0 if summary["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
