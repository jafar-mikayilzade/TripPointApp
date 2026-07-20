"""Build multi-day itinerary with geo order + fixed time slots; Claude only for tips."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import requests

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.services.geo_route import order_stops_geo
from app.services.rank_pois import (
    ATTRACTION_CATS,
    prefer_high_rated,
    public_poi_fields,
    rating_sort_key,
)

logger = logging.getLogger(__name__)

INTEREST_ATTRACTION_CATS: dict[str, set[str]] = {
    "nature": {"nature", "waterfall", "mountain", "lake"},
    "history": {"historical", "monument"},
    "food": set(),  # restaurants handled separately
    "family": {"historical", "nature", "lake", "other", "monument"},
    "active": {"mountain", "nature", "waterfall"},
    "photo": {"nature", "waterfall", "historical", "monument", "lake"},
}

DURATION_MINUTES: dict[str, int] = {
    "restaurant": 75,
    "home_restaurant": 75,
    "cafe": 45,
    "hotel": 30,
    "hostel": 30,
    "guesthouse": 30,
    "nature": 120,
    "waterfall": 90,
    "mountain": 120,
    "lake": 90,
    "historical": 75,
    "monument": 45,
    "other": 60,
}

TRAVEL_BUFFER_MIN = 25
DAY_START_HOUR = 9
DAY_START_MINUTE = 0
STOPS_PER_DAY = 4  # daytime stops before optional hotel


def apply_weather_filter(
    pois: list[dict[str, Any]], weather: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Mirror mobile applyWeatherPoiFilter."""
    if not weather or not weather.get("prefer_indoor"):
        return pois
    exclude = set(weather.get("exclude_categories") or [])
    if not exclude:
        return pois
    filtered = [p for p in pois if str(p.get("category") or "") not in exclude]
    return filtered if len(filtered) >= 5 else pois


def _minutes_to_hhmm(total_minutes: int) -> str:
    h = (total_minutes // 60) % 24
    m = total_minutes % 60
    return f"{h:02d}:{m:02d}"


def _duration_label(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} dəq"
    hours = minutes / 60
    if abs(hours - round(hours)) < 0.05:
        return f"{int(round(hours))} saat"
    return f"{hours:.1f} saat".replace(".0", "")


def _poi_duration(poi: dict[str, Any]) -> int:
    cat = str(poi.get("category") or "other")
    return DURATION_MINUTES.get(cat, 60)


def _interest_sets(interests: list[str]) -> set[str]:
    cats: set[str] = set()
    for raw in interests:
        key = str(raw or "").strip().lower()
        cats |= INTEREST_ATTRACTION_CATS.get(key, set())
    return cats


def _pick_unique(
    pool: list[dict[str, Any]],
    *,
    used: set[str],
    limit: int,
    category_allow: set[str] | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for poi in prefer_high_rated(pool, limit=len(pool) or 1):
        pid = str(poi.get("id") or "")
        if not pid or pid in used:
            continue
        cat = str(poi.get("category") or "")
        if category_allow is not None and cat not in category_allow:
            continue
        used.add(pid)
        out.append(poi)
        if len(out) >= limit:
            break
    return out


def select_day_stops(
    *,
    day_index: int,
    days_count: int,
    attractions: list[dict[str, Any]],
    restaurants: list[dict[str, Any]],
    accommodations: list[dict[str, Any]],
    used: set[str],
    interest_cats: set[str],
    want_food: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pick ~4 daytime stops (attractions + 1 lunch) + hotel for overnight nights."""
    day_pois: list[dict[str, Any]] = []

    preferred_pool = [
        p
        for p in attractions
        if not interest_cats or str(p.get("category") or "") in interest_cats
    ]
    other_pool = [p for p in attractions if p not in preferred_pool]

    attr_need = STOPS_PER_DAY - (1 if (want_food or restaurants) else 0)
    attr_need = max(2, attr_need)

    day_pois.extend(
        _pick_unique(preferred_pool, used=used, limit=attr_need, category_allow=None)
    )
    if len([p for p in day_pois if str(p.get("category") or "") in ATTRACTION_CATS]) < attr_need:
        need = attr_need - len(
            [p for p in day_pois if str(p.get("category") or "") in ATTRACTION_CATS]
        )
        day_pois.extend(_pick_unique(other_pool, used=used, limit=need))

    if restaurants:
        lunch = _pick_unique(restaurants, used=used, limit=1)
        day_pois.extend(lunch)

    if len(day_pois) < 3:
        day_pois.extend(
            _pick_unique(attractions, used=used, limit=3 - len(day_pois))
        )

    hotels: list[dict[str, Any]] = []
    if accommodations and days_count >= 2 and day_index < days_count:
        hotels = _pick_unique(accommodations, used=used, limit=1)

    return day_pois, hotels


def assign_times(ordered: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cursor = DAY_START_HOUR * 60 + DAY_START_MINUTE
    stops: list[dict[str, Any]] = []
    for poi in ordered:
        mins = _poi_duration(poi)
        pub = public_poi_fields(poi)
        stops.append(
            {
                **pub,
                "poi_id": str(poi.get("id") or ""),
                "time": _minutes_to_hhmm(cursor),
                "duration": _duration_label(mins),
                "duration_minutes": mins,
                "tip": "",
            }
        )
        cursor += mins + TRAVEL_BUFFER_MIN
    return stops


def build_skeleton(
    *,
    region: str,
    days: int,
    budget: str,
    interests: list[str],
    group_type: str,
    restaurants: list[dict[str, Any]],
    accommodations: list[dict[str, Any]],
    attractions: list[dict[str, Any]],
    weather: dict[str, Any] | None,
) -> dict[str, Any]:
    region_key = region.strip().lower()
    db_region = REGION_DB_ID.get(region_key, region_key)
    coords = REGION_COORDINATES.get(region_key) or REGION_COORDINATES.get(db_region)
    if not coords:
        # fallback baku
        coords = REGION_COORDINATES["baku"]

    start_lat = float(coords["latitude"])
    start_lng = float(coords["longitude"])

    restaurants = apply_weather_filter(list(restaurants), weather)
    accommodations = apply_weather_filter(list(accommodations), weather)
    attractions = apply_weather_filter(list(attractions), weather)

    # Sort pools by rating for stable picks
    restaurants = sorted(restaurants, key=rating_sort_key, reverse=True)
    accommodations = sorted(accommodations, key=rating_sort_key, reverse=True)
    attractions = sorted(attractions, key=rating_sort_key, reverse=True)

    interest_cats = _interest_sets(interests)
    want_food = any(str(i).lower() == "food" for i in interests) or True

    used: set[str] = set()
    day_payloads: list[dict[str, Any]] = []

    for day_i in range(1, days + 1):
        daytime, hotels = select_day_stops(
            day_index=day_i,
            days_count=days,
            attractions=attractions,
            restaurants=restaurants,
            accommodations=accommodations,
            used=used,
            interest_cats=interest_cats,
            want_food=want_food,
        )
        if not daytime and not hotels:
            break

        # Start from highest-rated attraction in the day set, else region center
        seed_lat, seed_lng = start_lat, start_lng
        if daytime:
            top = max(daytime, key=rating_sort_key)
            try:
                seed_lat = float(top["lat"])
                seed_lng = float(top["lng"])
            except (KeyError, TypeError, ValueError):
                pass

        ordered_day = order_stops_geo(daytime, start_lat=seed_lat, start_lng=seed_lng)
        # Hotel last (not in geo zigzag of sightseeing)
        ordered_day.extend(hotels)

        stops = assign_times(ordered_day)
        day_payloads.append(
            {
                "day": day_i,
                "title": f"{day_i}. gün",
                "stops": stops,
                "estimated_cost": _budget_day_cost(budget),
                "notes": "",
            }
        )

    if not day_payloads or not any(d["stops"] for d in day_payloads):
        raise ValueError("Bu bölgədə marşrut üçün kifayət qədər yer tapılmadı")

    return {
        "summary": "",
        "days": day_payloads,
        "total_cost": _budget_total(budget, days),
        "best_time": "",
        "region": db_region,
        "meta": {
            "budget": budget,
            "interests": interests,
            "group_type": group_type,
            "ordered_by": "haversine_nn_2opt",
        },
    }


def _budget_day_cost(budget: str) -> str:
    b = (budget or "mid").lower()
    if b in {"budget", "low", "qenaetcil"}:
        return "20-40 AZN"
    if b in {"premium", "high"}:
        return "80-150 AZN"
    return "40-80 AZN"


def _budget_total(budget: str, days: int) -> str:
    b = (budget or "mid").lower()
    if b in {"budget", "low", "qenaetcil"}:
        low, high = 20 * days, 40 * days
    elif b in {"premium", "high"}:
        low, high = 80 * days, 150 * days
    else:
        low, high = 40 * days, 80 * days
    return f"{low}-{high} AZN"


def template_enrich(plan: dict[str, Any], *, region_label: str, days: int) -> dict[str, Any]:
    """Fallback when Claude key missing or call fails."""
    plan = dict(plan)
    plan["summary"] = plan.get("summary") or f"{region_label} üçün {days} günlük marşrut hazırdır."
    plan["best_time"] = plan.get("best_time") or "Səhər tezdən başlamaq rahatdır."
    new_days = []
    for day in plan.get("days") or []:
        day = dict(day)
        day["notes"] = day.get("notes") or "Stoplar coğrafi yaxınlığa görə sıralanıb."
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            if not (stop.get("tip") or "").strip():
                name = stop.get("name") or "Bu yer"
                stop["tip"] = f"{name} — qısa dayanıb ətrafı gəzməyə dəyər."
            stops.append(stop)
        day["stops"] = stops
        new_days.append(day)
    plan["days"] = new_days
    return plan


def _strip_json_fence(text: str) -> str:
    clean = text.strip()
    if clean.startswith("```json"):
        clean = re.sub(r"^```json\n?", "", clean)
        clean = re.sub(r"\n?```$", "", clean)
    elif clean.startswith("```"):
        clean = re.sub(r"^```\n?", "", clean)
        clean = re.sub(r"\n?```$", "", clean)
    return clean.strip()


def enrich_with_claude(
    plan: dict[str, Any],
    *,
    region_label: str,
    days: int,
    budget: str,
    interests: list[str],
    group_type: str,
    weather: dict[str, Any] | None,
) -> dict[str, Any]:
    """Ask Claude only for summary / tips / notes — do not reorder stops."""
    api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip().strip('"').strip("'")
    if not api_key:
        return template_enrich(plan, region_label=region_label, days=days)

    # Compact fixed skeleton for the model
    skeleton = {
        "days": [
            {
                "day": d.get("day"),
                "stops": [
                    {
                        "poi_id": s.get("poi_id"),
                        "name": s.get("name"),
                        "category": s.get("category"),
                        "time": s.get("time"),
                    }
                    for s in (d.get("stops") or [])
                ],
            }
            for d in (plan.get("days") or [])
        ]
    }

    weather_note = ""
    if weather and weather.get("prefer_indoor"):
        weather_note = (
            f"Hava: {weather.get('summary_az') or 'yağışlı'} — tip-lərdə qapalı məkan üstün tut."
        )

    user_prompt = f"""Region: {region_label}
Gün: {days}, büdcə: {budget}, qrup: {group_type}
Maraqlar: {', '.join(interests) or 'ümumi'}
{weather_note}

Aşağıdakı MARŞRUT ARTİQ HAZIRDIR (sıra və vaxtlar sabitdir).
YALNIZ mətn əlavə et. Stop əlavə/çıxar/sıra dəyişmə.

FIXED_ITINERARY:
{json.dumps(skeleton, ensure_ascii=False)}

Cavab YALNIZ JSON:
{{
  "summary": "1-2 cümlə",
  "best_time": "qısa",
  "days": [
    {{
      "day": 1,
      "notes": "qısa qeyd",
      "stops": [{{"poi_id": "…", "tip": "1 cümlə"}}]
    }}
  ]
}}
Hər stop üçün tip ver; poi_id FIXED_ITINERARY-dəki ilə eyni olsun."""

    try:
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 900,
                "system": (
                    "Azərbaycan turizm köməkçisisən. Yalnız JSON qaytar. "
                    "Stop sırasını dəyişmə, yeni yer əlavə etmə."
                ),
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=45,
        )
        if not res.ok:
            logger.warning("Claude tips failed: %s", res.text[:300])
            return template_enrich(plan, region_label=region_label, days=days)

        content = (res.json().get("content") or [{}])[0].get("text") or ""
        tips = json.loads(_strip_json_fence(content))
        return _merge_tips(plan, tips, region_label=region_label, days=days)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Claude tips error: %s", exc)
        return template_enrich(plan, region_label=region_label, days=days)


def _merge_tips(
    plan: dict[str, Any],
    tips: dict[str, Any],
    *,
    region_label: str,
    days: int,
) -> dict[str, Any]:
    plan = template_enrich(plan, region_label=region_label, days=days)
    if tips.get("summary"):
        plan["summary"] = str(tips["summary"]).strip()
    if tips.get("best_time"):
        plan["best_time"] = str(tips["best_time"]).strip()

    tip_days = {int(d.get("day")): d for d in (tips.get("days") or []) if d.get("day") is not None}
    merged_days = []
    for day in plan.get("days") or []:
        day = dict(day)
        tip_day = tip_days.get(int(day.get("day") or 0))
        if tip_day and tip_day.get("notes"):
            day["notes"] = str(tip_day["notes"]).strip()
        tip_map = {
            str(s.get("poi_id")): str(s.get("tip") or "").strip()
            for s in (tip_day or {}).get("stops") or []
            if s.get("poi_id")
        }
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            pid = str(stop.get("poi_id") or "")
            if tip_map.get(pid):
                stop["tip"] = tip_map[pid]
            stops.append(stop)
        day["stops"] = stops
        merged_days.append(day)
    plan["days"] = merged_days
    return plan
