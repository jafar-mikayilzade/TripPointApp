"""CLI: Geoapify Places → Supabase pois.

Usage (from apps/api):
  python -m scripts.sync_geoapify --regions quba,qusar,qabala --dry-run
  python -m scripts.sync_geoapify --regions quba,qusar,qabala
"""

from __future__ import annotations

import argparse
import json
import sys

from app.services.places_geoapify import GeoapifyConfigError, GeoapifyEndpointError, require_geoapify_key
from app.services.sync_geoapify import DEFAULT_KINDS, DEFAULT_REGIONS, sync_geoapify_regions


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
    parser = argparse.ArgumentParser(description="Sync Geoapify places into pois")
    parser.add_argument("--regions", default=",".join(DEFAULT_REGIONS))
    parser.add_argument("--kinds", default=",".join(DEFAULT_KINDS))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]

    try:
        require_geoapify_key()
    except GeoapifyConfigError as exc:
        emit({"success": False, "error": "missing_geoapify_key", "message": str(exc)})
        return 2

    try:
        result = sync_geoapify_regions(
            regions,
            kinds=kinds,  # type: ignore[arg-type]
            dry_run=args.dry_run,
        )
    except (GeoapifyConfigError, GeoapifyEndpointError, ValueError) as exc:
        emit({"success": False, "error": str(exc)})
        return 1

    emit(result)
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    sys.exit(main())
