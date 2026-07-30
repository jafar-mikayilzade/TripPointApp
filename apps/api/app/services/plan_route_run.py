"""In-process plan-route runner (shared by HTTP + Telegram bot)."""

from __future__ import annotations

from typing import Any

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID, REGION_LABELS
from app.services.live_route_candidates import load_live_route_candidates
from app.services.plan_itinerary import build_skeleton, enrich_with_claude

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
    depart_time: str | None = "08:00",
    return_by_time: str | None = "21:00",
    start_day_offset: int = 0,
) -> dict[str, Any]:
    """Build itinerary. Raises ValueError on user/input errors."""
    region_key = (region or "").strip().lower()
    if region_key not in REGION_COORDINATES:
        raise ValueError(
            "Region düzgün deyil. Seçim: "
            + ", ".join(REGION_LABELS[k] for k in BOT_REGION_KEYS if k in REGION_LABELS)
        )

    days_n = int(days)
    if days_n < 1 or days_n > 3:
        raise ValueError("Gün sayı 1–3 arası olmalıdır")

    use_origin = bool(
        from_origin and origin_lat is not None and origin_lng is not None
    )
    offset = max(0, min(4, int(start_day_offset or 0)))
    depart = (depart_time or "08:00").strip() or "08:00"
    return_by = (return_by_time or "21:00").strip() or "21:00"

    db_region = REGION_DB_ID.get(region_key, region_key)
    region_label = REGION_LABELS.get(region_key) or REGION_LABELS.get(db_region) or db_region
    interest_list = [str(i) for i in (interests or [])]

    weather_payload: dict[str, Any] | None = None
    try:
        from app.services.weather import fetch_region_weather

        raw = fetch_region_weather(region_key, days_n, start_offset=offset)
        if raw.get("ok"):
            weather_payload = {
                "prefer_indoor": bool(raw.get("prefer_indoor")),
                "summary_az": raw.get("summary_az") or raw.get("display_az"),
                "exclude_categories": list(raw.get("exclude_categories") or []),
                "prefer_categories": list(raw.get("prefer_categories") or []),
            }
    except Exception:
        weather_payload = None

    loaded = load_live_route_candidates(
        region_key,
        per_bucket=16,
        interests=interest_list or None,
        source="db",
    )
    buckets = loaded["buckets"]
    restaurants = buckets["restaurants"]
    accommodations = buckets["accommodations"]
    attractions = buckets["attractions"]
    candidate_source = str(loaded.get("source") or "db")

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
        weather=weather_payload,
        origin_lat=float(origin_lat) if use_origin else None,
        origin_lng=float(origin_lng) if use_origin else None,
        from_origin=use_origin,
        depart_time=depart,
        return_by_time=return_by,
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
        weather=weather_payload,
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
        "departTime": depart if use_origin else None,
        "returnByTime": return_by if use_origin else None,
        "startDayOffset": offset,
        "weatherSummary": (weather_payload or {}).get("summary_az"),
    }


def format_plan_for_telegram(plan: dict[str, Any]) -> str:
    """Compact AZ text for Telegram (under ~4000 chars)."""
    label = plan.get("regionLabel") or plan.get("region") or ""
    lines: list[str] = [f"📍 {label} — AI marşrut"]
    offset = int(plan.get("startDayOffset") or 0)
    if offset == 0:
        lines.append("🗓 Başlanğıc: bugün")
    elif offset == 1:
        lines.append("🗓 Başlanğıc: sabah")
    elif offset > 1:
        lines.append(f"🗓 Başlanğıc: +{offset} gün")
    if plan.get("fromOrigin"):
        lines.append("🚗 Cari məkandan gediş nəzərə alınıb")
        if plan.get("departTime"):
            lines.append(f"🕐 Çıxış: {plan['departTime']}")
        if plan.get("returnByTime"):
            lines.append(f"🕐 Qayıdış: {plan['returnByTime']}")
    weather = (plan.get("weatherSummary") or "").strip()
    if weather:
        lines.append(f"🌤 {weather}")
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
