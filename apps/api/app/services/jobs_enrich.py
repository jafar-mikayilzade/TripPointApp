"""Batch Google Place Details enrichment for sparse POI rows."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from app.config import GOOGLE_PLACES_API_KEY
from app.db import supabase

logger = logging.getLogger(__name__)

GOOGLE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
DEFAULT_BATCH = 50
SLEEP_SECONDS = 0.12


def fetch_place_details(place_id: str, *, timeout_seconds: float = 20) -> dict[str, Any]:
    if not GOOGLE_PLACES_API_KEY:
        raise RuntimeError("GOOGLE_PLACES_API_KEY is not set")

    params = {
        "place_id": place_id,
        "fields": (
            "formatted_phone_number,international_phone_number,website,"
            "editorial_summary,opening_hours,rating,user_ratings_total"
        ),
        "language": "az",
        "key": GOOGLE_PLACES_API_KEY,
    }
    response = requests.get(GOOGLE_DETAILS_URL, params=params, timeout=timeout_seconds)
    response.raise_for_status()
    payload = response.json()
    status = payload.get("status")
    if status not in {"OK", "ZERO_RESULTS"}:
        error_message = payload.get("error_message") or status
        raise RuntimeError(f"Place Details error: {error_message}")
    return payload.get("result") or {}


def _format_opening_hours(result: dict[str, Any]) -> str | None:
    hours = result.get("opening_hours") or {}
    weekday = hours.get("weekday_text")
    if isinstance(weekday, list) and weekday:
        return "\n".join(str(line) for line in weekday if line)
    return None


def _pick_candidates(limit: int) -> list[dict[str, Any]]:
    """POIs with Google place_id missing phone/website/description/hours."""
    rows = (
        supabase.table("pois")
        .select("id, place_id, phone, website, description, opening_hours")
        .eq("status", "approved")
        .limit(500)
        .execute()
        .data
        or []
    )
    candidates: list[dict[str, Any]] = []
    for row in rows:
        place_id = str(row.get("place_id") or "")
        # Google place ids typically look like ChIJ…; skip OSM-style ids
        if not place_id.startswith("ChIJ"):
            continue
        sparse = (
            not (row.get("phone") or "").strip()
            or not (row.get("website") or "").strip()
            or not (row.get("description") or "").strip()
            or not (row.get("opening_hours") or "").strip()
        )
        if sparse:
            candidates.append(row)
        if len(candidates) >= limit:
            break
    return candidates


def run_place_details_enrichment(*, limit: int = DEFAULT_BATCH) -> dict[str, Any]:
    if not GOOGLE_PLACES_API_KEY:
        return {"ok": False, "error": "GOOGLE_PLACES_API_KEY missing", "updated": 0}

    batch_limit = max(1, min(int(limit), 100))
    candidates = _pick_candidates(batch_limit)
    updated = 0
    errors = 0

    for row in candidates:
        place_id = str(row["place_id"])
        poi_id = str(row["id"])
        try:
            details = fetch_place_details(place_id)
            patch: dict[str, Any] = {}

            phone = details.get("international_phone_number") or details.get(
                "formatted_phone_number"
            )
            if phone and not (row.get("phone") or "").strip():
                patch["phone"] = str(phone).strip()

            website = details.get("website")
            if website and not (row.get("website") or "").strip():
                patch["website"] = str(website).strip()

            summary = details.get("editorial_summary") or {}
            overview = summary.get("overview") if isinstance(summary, dict) else None
            if overview and not (row.get("description") or "").strip():
                patch["description"] = str(overview).strip()[:2000]

            hours_text = _format_opening_hours(details)
            if hours_text and not (row.get("opening_hours") or "").strip():
                patch["opening_hours"] = hours_text[:4000]

            rating = details.get("rating")
            if rating is not None:
                try:
                    value = float(rating)
                    if 0 < value <= 5:
                        patch["rating"] = round(value, 2)
                except (TypeError, ValueError):
                    pass

            count = details.get("user_ratings_total")
            if count is not None:
                try:
                    patch["rating_count"] = int(count)
                except (TypeError, ValueError):
                    pass

            if patch:
                supabase.table("pois").update(patch).eq("id", poi_id).execute()
                updated += 1
        except Exception:
            errors += 1
            logger.exception("enrich place_id=%s failed", place_id)

        time.sleep(SLEEP_SECONDS)

    return {
        "ok": True,
        "candidates": len(candidates),
        "updated": updated,
        "errors": errors,
    }
