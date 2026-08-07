"""CLI: RapidAPI Booking + TripAdvisor → Supabase pois.

Usage (from apps/api):
  python -m scripts.sync_tourism --regions quba,qabala,qusar --dry-run
  python -m scripts.sync_tourism --regions quba,qabala,qusar
"""

from __future__ import annotations

import argparse
import json
import sys

from app.services.places_rapidapi import (
    RapidApiConfigError,
    RapidApiEndpointError,
    require_rapidapi_key,
)
from app.services.sync_tourism import DEFAULT_KINDS, DEFAULT_REGIONS, sync_tourism_regions


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync RapidAPI tourism POIs into Supabase pois"
    )
    parser.add_argument(
        "--regions",
        default=",".join(DEFAULT_REGIONS),
        help="Comma-separated region ids (default: quba,qabala,qusar)",
    )
    parser.add_argument(
        "--kinds",
        default=",".join(DEFAULT_KINDS),
        help="Comma-separated: hotel,restaurant,camping",
    )
    parser.add_argument("--currency", default="AZN")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch + map only; do not write to Supabase",
    )
    args = parser.parse_args()

    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]

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

    try:
        require_rapidapi_key()
    except RapidApiConfigError as exc:
        emit(
            {
                "success": False,
                "error": "missing_rapidapi_key",
                "message": str(exc),
                "env": "Add RAPIDAPI_KEY to apps/api/.env (see .env.example)",
                "subscribe": {
                    "booking": "https://rapidapi.com/DataCrawler/api/booking-com15",
                    "tripadvisor": "https://rapidapi.com/apiheya/api/tripadvisor16",
                },
            }
        )
        return 2

    try:
        result = sync_tourism_regions(
            regions,
            kinds=kinds,  # type: ignore[arg-type]
            currency=args.currency,
            dry_run=args.dry_run,
        )
    except (RapidApiConfigError, RapidApiEndpointError, ValueError) as exc:
        emit({"success": False, "error": str(exc)})
        return 1

    emit(result)
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
