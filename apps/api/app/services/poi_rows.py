"""Shared helpers for POI row lists (live map + AI candidates)."""

from __future__ import annotations

import re
from typing import Any

from app.constants.regions import REGION_COORDINATES
from app.constants.tourism_hubs import hub_as_center, hubs_for_region


def dedupe_poi_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge rows sharing a place id; curated seeds and stronger hubs win."""
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = str(row.get("place_id") or row.get("id") or "")
        if not pid:
            continue
        prev = by_id.get(pid)
        if prev is None:
            by_id[pid] = row
            continue
        if row.get("is_seed") and not prev.get("is_seed"):
            by_id[pid] = row
        elif float(row.get("hub_weight") or 0) > float(prev.get("hub_weight") or 0):
            by_id[pid] = {**prev, **row}
    return list(by_id.values())


def centers_for_region(
    region_key: str,
    *,
    fallback_radius_m: int,
    fallback_weight: float = 0.6,
) -> list[dict[str, Any]]:
    """Tourism hubs for a region, or a single region-center fallback."""
    hubs = hubs_for_region(region_key)
    if hubs:
        return [hub_as_center(h) for h in hubs]
    coords = REGION_COORDINATES[region_key]
    return [
        {
            "id": "region_center",
            "name": region_key,
            "lat": float(coords["latitude"]),
            "lng": float(coords["longitude"]),
            "radius_m": fallback_radius_m,
            "weight": fallback_weight,
        }
    ]


def normalize_place_name(name: str) -> str:
    """Casefolded, punctuation-free name used for duplicate detection."""
    text = (name or "").casefold().strip()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text)
