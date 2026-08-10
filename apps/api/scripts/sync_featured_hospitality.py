"""CLI: sync hotels + restaurants for all featured tourism regions.

Sources (sequential, with retries):
  SerpAPI → Booking (RapidAPI) → Geoapify → TripAdvisor (RapidAPI)

Usage (from apps/api):
  python -m scripts.sync_featured_hospitality
  python -m scripts.sync_featured_hospitality --regions quba,qabala --dry-run
  python -m scripts.sync_featured_hospitality --stages serpapi,booking
"""

from __future__ import annotations

import argparse
import json
import sys

import app.ssl_insecure  # noqa: F401

from dotenv import load_dotenv

load_dotenv()

from app.constants.regions import TOURISM_FEATURED_IDS
from app.services.sync_featured_hospitality import sync_featured_hospitality


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync featured-region hotels/restaurants from SerpAPI, Booking, Geoapify, TripAdvisor"
    )
    parser.add_argument(
        "--regions",
        default="",
        help="Comma-separated region ids (default: all TOURISM_FEATURED_IDS)",
    )
    parser.add_argument(
        "--stages",
        default="serpapi,booking,geoapify,tripadvisor",
        help="Comma-separated stages to run",
    )
    parser.add_argument("--max-pages", type=int, default=3, help="SerpAPI hotel pages")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--region-sleep",
        type=float,
        default=2.5,
        help="Seconds between regions",
    )
    args = parser.parse_args()

    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    if not regions:
        regions = list(TOURISM_FEATURED_IDS)
    stages = [s.strip() for s in args.stages.split(",") if s.strip()]

    def emit(payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        try:
            sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
        print(text, flush=True)

    emit(
        {
            "status": "start",
            "regions": regions,
            "stages": stages,
            "dry_run": args.dry_run,
            "max_pages": args.max_pages,
        }
    )

    result = sync_featured_hospitality(
        regions,
        dry_run=args.dry_run,
        region_sleep_s=args.region_sleep,
        max_pages=args.max_pages,
        stages=stages,
    )
    emit(result)
    return 0 if result.get("success") or result.get("totals", {}).get("stage_ok", 0) > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
