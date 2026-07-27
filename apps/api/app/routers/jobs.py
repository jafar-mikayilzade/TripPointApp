"""Secret-protected scheduled jobs (Railway cron → HTTP)."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from app.config import CRON_SECRET
from app.security import secret_matches
from app.services.jobs_cleanup import run_nightly_cleanup
from app.services.jobs_dup_alert import run_duplicate_poi_alert
from app.services.jobs_enrich import run_place_details_enrichment
from app.services.jobs_weekly_report import run_weekly_report

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _require_cron_secret(x_cron_secret: str | None) -> None:
    # CRON_SECRET only — never TELEGRAM_NOTIFY_SECRET. The mobile app ships the
    # notify secret in its bundle (EXPO_PUBLIC_NOTIFY_SECRET), so accepting it
    # here would let any user trigger destructive maintenance jobs.
    expected = (CRON_SECRET or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "cron_secret_unset",
                "message": "Set CRON_SECRET on the server to enable cron jobs.",
            },
        )
    if not secret_matches(x_cron_secret, expected):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


@router.post("/nightly")
def jobs_nightly(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
) -> dict[str, object]:
    """03:00 cleanup: pending, expired listings, spots_left, profile ratings."""
    _require_cron_secret(x_cron_secret)
    return run_nightly_cleanup()


@router.post("/enrich-places")
def jobs_enrich_places(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, object]:
    """Batch Google Place Details for sparse POIs (quota-friendly)."""
    _require_cron_secret(x_cron_secret)
    return run_place_details_enrichment(limit=limit)


@router.post("/weekly-report")
def jobs_weekly_report(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
) -> dict[str, object]:
    """Weekly Telegram admin digest."""
    _require_cron_secret(x_cron_secret)
    return run_weekly_report(send=True)


@router.post("/dup-alert")
def jobs_dup_alert(
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
) -> dict[str, object]:
    """Manual duplicate POI scan → Telegram (also runs inside nightly)."""
    _require_cron_secret(x_cron_secret)
    return run_duplicate_poi_alert(send=True)
