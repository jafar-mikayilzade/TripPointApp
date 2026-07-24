"""In-process plan-route runner (shared by HTTP + Telegram bot)."""

from __future__ import annotations

from typing import Any

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.services.live_route_candidates import load_live_route_candidates
from app.services.plan_itinerary import build_skeleton, enrich_with_claude

REGION_LABELS: dict[str, str] = {
    "quba": "Quba",
    "qusar": "Qusar",
    "seki": "Şəki",
    "sheki": "Şəki",
    "qabala": "Qəbələ",
    "gabala": "Qəbələ",
    "lerik": "Lerik",
    "baku": "Bakı",
}

REGION_EMOJI: dict[str, str] = {
    "quba": "🏔",
    "qusar": "🏔",
    "seki": "🏛",
    "qabala": "🌲",
    "lerik": "🌿",
    "baku": "🏙",
}

# Canonical region keys for bot menus (no alias duplicates)
BOT_REGION_KEYS: list[str] = ["quba", "qusar", "seki", "qabala", "lerik", "baku"]


def run_plan_route(
    *,
    region: str,
    days: int,
    budget: str = "mid",
    interests: list[str] | None = None,
    group_type: str = "solo",
    from_origin: bool = False,
    origin_lat: float | None = None,
    origin_lng: float | None = None,
) -> dict[str, Any]:
    """Build itinerary. Raises ValueError on user/input errors."""
    region_key = (region or "").strip().lower()
    if region_key not in REGION_COORDINATES:
        raise ValueError(
            "Region düzgün deyil. Seçim: "
            + ", ".join(REGION_LABELS[k] for k in BOT_REGION_KEYS if k in REGION_LABELS)
        )

    days_n = int(days)
    if days_n < 1 or days_n > 7:
        raise ValueError("Gün sayı 1–7 arası olmalıdır")

    use_origin = bool(
        from_origin and origin_lat is not None and origin_lng is not None
    )

    db_region = REGION_DB_ID.get(region_key, region_key)
    region_label = REGION_LABELS.get(region_key) or REGION_LABELS.get(db_region) or db_region
    interest_list = [str(i) for i in (interests or [])]

    loaded = load_live_route_candidates(
        region_key,
        per_bucket=16,
        interests=interest_list or None,
        source="google",
    )
    buckets = loaded["buckets"]
    restaurants = buckets["restaurants"]
    accommodations = buckets["accommodations"]
    attractions = buckets["attractions"]
    candidate_source = str(loaded.get("source") or "google")

    if not (restaurants or accommodations or attractions):
        raise ValueError("Bu bölgədə yer tapılmadı")

    skeleton = build_skeleton(
        region=region_key,
        days=days_n,
        budget=budget or "mid",
        interests=interest_list,
        group_type=(group_type or "solo").strip() or "solo",
        restaurants=restaurants,
        accommodations=accommodations,
        attractions=attractions,
        weather=None,
        origin_lat=float(origin_lat) if use_origin else None,
        origin_lng=float(origin_lng) if use_origin else None,
        from_origin=use_origin,
        depart_time="08:00",
        return_by_time="21:00",
        variety_seed=None,
        exclude_poi_ids=[],
    )

    plan = enrich_with_claude(
        skeleton,
        region_label=region_label,
        days=days_n,
        budget=budget or "mid",
        interests=interest_list,
        group_type=(group_type or "solo").strip() or "solo",
        weather=None,
    )

    travel = plan.pop("travel", None) or skeleton.get("travel")
    lodging = plan.pop("lodging", None) or skeleton.get("lodging")
    plan.pop("meta", None)

    return {
        "success": True,
        "summary": plan.get("summary"),
        "days": plan.get("days"),
        "total_cost": plan.get("total_cost"),
        "best_time": plan.get("best_time") or skeleton.get("best_time"),
        "region": db_region,
        "regionLabel": region_label,
        "travel": travel,
        "lodging": lodging,
        "source": "fastapi_geo",
        "candidatesSource": candidate_source,
        "fromOrigin": use_origin,
    }


def format_plan_for_telegram(plan: dict[str, Any]) -> str:
    """Compact AZ text for Telegram (under ~4000 chars)."""
    label = plan.get("regionLabel") or plan.get("region") or ""
    lines: list[str] = [f"📍 {label} — AI marşrut"]
    if plan.get("fromOrigin"):
        lines.append("🚗 Cari məkandan gediş nəzərə alınıb")
    summary = (plan.get("summary") or "").strip()
    if summary:
        lines.append(summary)
    if plan.get("total_cost"):
        lines.append(f"💰 Təxmini: {plan['total_cost']}")
    if plan.get("best_time"):
        lines.append(f"🗓 Ən yaxşı vaxt: {plan['best_time']}")

    days = plan.get("days") or []
    if isinstance(days, list):
        for day in days[:7]:
            if not isinstance(day, dict):
                continue
            dnum = day.get("day") or day.get("day_number") or "?"
            title = (day.get("title") or day.get("theme") or "").strip()
            lines.append(f"\nGün {dnum}" + (f" — {title}" if title else ""))
            stops = day.get("stops") or day.get("items") or []
            if isinstance(stops, list):
                for stop in stops[:6]:
                    if isinstance(stop, dict):
                        name = stop.get("name") or stop.get("title") or "Stop"
                        lines.append(f"• {name}")
                    else:
                        lines.append(f"• {stop}")

    lines.append("\nApp-də xəritə: trippoint://marsrut")
    return "\n".join(lines).strip()
