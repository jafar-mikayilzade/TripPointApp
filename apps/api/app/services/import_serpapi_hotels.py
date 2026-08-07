"""Import SerpAPI Google Hotels into pois (one region at a time)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.constants.regions import REGION_COORDINATES, REGION_LABELS
from app.services.places_clean import clean_place, to_db_region
from app.services.places_serpapi import fetch_hotels_from_serpapi
from app.services.places_sync import _insert_if_missing

logger = logging.getLogger(__name__)


def import_serpapi_hotels_for_region(
    region: str,
    *,
    max_pages: int = 5,
    currency: str = "AZN",
) -> dict[str, Any]:
    region_key = (region or "").strip().lower()
    if region_key not in REGION_COORDINATES:
        raise ValueError(
            f"Unknown region '{region}'. Example: quba, baku, seki."
        )

    raw = fetch_hotels_from_serpapi(
        region_key,
        max_pages=max_pages,
        currency=currency,
    )
    cleaned: list[dict[str, Any]] = []
    for place in raw:
        row = clean_place(place, region_key, str(place.get("category") or "hotel"))
        if row is None:
            continue
        cleaned.append(row)

    inserted, skipped = _insert_if_missing(cleaned)
    db_region = to_db_region(region_key)
    return {
        "success": True,
        "data_source": "serpapi",
        "region": db_region,
        "region_label": REGION_LABELS.get(region_key, region_key),
        "fetched": len(raw),
        "cleaned": len(cleaned),
        "inserted": inserted,
        "skipped": skipped,
        "currency": currency,
        "max_pages": max_pages,
        "message": (
            f"{REGION_LABELS.get(region_key, region_key)}: "
            f"{inserted} new hotels, {skipped} already in DB "
            f"(fetched {len(raw)})."
        ),
    }


def import_serpapi_hotels_endpoint_response(
    region: str,
    *,
    max_pages: int = 5,
    currency: str = "AZN",
) -> JSONResponse:
    try:
        payload = import_serpapi_hotels_for_region(
            region,
            max_pages=max_pages,
            currency=currency,
        )
        return JSONResponse(content=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    except RuntimeError as exc:
        logger.exception("serpapi hotels import failed")
        raise HTTPException(
            status_code=502,
            detail={"error": "serpapi_failed", "message": str(exc)},
        ) from exc
    except Exception as exc:
        logger.exception("serpapi hotels import unexpected error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "import_failed",
                "message": "Hotel import failed. Check server logs.",
            },
        ) from exc
