"""CLI: import SerpAPI Google Hotels for one region into pois.

Usage (from apps/api):
  python -m scripts.import_serpapi_hotels quba
  python -m scripts.import_serpapi_hotels quba --max-pages 3
"""

from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Import SerpAPI hotels → pois")
    parser.add_argument("region", help="Region id, e.g. quba")
    parser.add_argument("--max-pages", type=int, default=5)
    parser.add_argument("--currency", default="AZN")
    args = parser.parse_args()

    from app.services.import_serpapi_hotels import import_serpapi_hotels_for_region

    try:
        result = import_serpapi_hotels_for_region(
            args.region,
            max_pages=args.max_pages,
            currency=args.currency,
        )
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
