"""Nightly duplicate POI scan — Telegram alert only (no auto-delete)."""

from __future__ import annotations

import logging
from typing import Any

from app.db import supabase
from app.services.geo_route import haversine_m as _haversine_m
from app.services.poi_rows import normalize_place_name as _normalize_name
from app.services.telegram_notify import notify_all_admins

logger = logging.getLogger(__name__)

DUP_RADIUS_M = 80
MAX_PAIRS_ALERT = 25
FETCH_LIMIT = 800


def find_duplicate_poi_pairs() -> list[dict[str, Any]]:
    try:
        rows = (
            supabase.table("pois")
            .select("id, name, lat, lng, region, place_id, status")
            .eq("status", "approved")
            .limit(FETCH_LIMIT)
            .execute()
            .data
            or []
        )
    except Exception:
        logger.exception("dup scan fetch failed")
        return []

    parsed: list[dict[str, Any]] = []
    for row in rows:
        try:
            lat = float(row["lat"])
            lng = float(row["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        name = _normalize_name(str(row.get("name") or ""))
        if not name:
            continue
        parsed.append(
            {
                "id": str(row["id"]),
                "name": str(row.get("name") or ""),
                "norm": name,
                "lat": lat,
                "lng": lng,
                "region": row.get("region"),
                "place_id": row.get("place_id"),
            }
        )

    pairs: list[dict[str, Any]] = []
    n = len(parsed)
    for i in range(n):
        a = parsed[i]
        for j in range(i + 1, n):
            b = parsed[j]
            similar = (
                a["norm"] == b["norm"]
                or a["norm"] in b["norm"]
                or b["norm"] in a["norm"]
            )
            if not similar:
                ta = a["norm"].split(" ", 1)[0]
                tb = b["norm"].split(" ", 1)[0]
                if not ta or ta != tb:
                    continue
            dist = _haversine_m((a["lat"], a["lng"]), (b["lat"], b["lng"]))
            if dist > DUP_RADIUS_M:
                continue
            # Same Google place_id → same entity, skip
            if a.get("place_id") and a.get("place_id") == b.get("place_id"):
                continue
            pairs.append(
                {
                    "a_id": a["id"],
                    "b_id": b["id"],
                    "a_name": a["name"],
                    "b_name": b["name"],
                    "region": a.get("region") or b.get("region"),
                    "meters": round(dist),
                }
            )
            if len(pairs) >= MAX_PAIRS_ALERT:
                return pairs
    return pairs


def run_duplicate_poi_alert(*, send: bool = True) -> dict[str, Any]:
    pairs = find_duplicate_poi_pairs()
    result: dict[str, Any] = {"ok": True, "duplicate_pairs": len(pairs)}
    if not pairs:
        return result

    lines = [
        f"TripPoint: ehtimal olunan dublikat POI ({len(pairs)} cüt)",
        "Avtomatik silinmir — yoxlayın.",
        "",
    ]
    for p in pairs[:MAX_PAIRS_ALERT]:
        lines.append(
            f"• {p['a_name'][:40]} ↔ {p['b_name'][:40]} "
            f"({p['meters']}m, {p.get('region') or '?'})\n"
            f"  {p['a_id']} / {p['b_id']}"
        )
    text = "\n".join(lines)
    if send:
        notify_all_admins(text)
        result["telegram_sent"] = True
    else:
        result["preview"] = text[:500]
    return result
