"""Build multi-day itinerary with geo order + fixed time slots; Claude only for tips."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import requests

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.services.geo_route import (
    build_day_clusters,
    cluster_centroid,
    haversine_km,
    nearest_poi_to_point,
    order_stops_geo,
    poi_coord,
)
from app.services.rank_pois import (
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


def select_stops_from_cluster(
    *,
    cluster: list[dict[str, Any]],
    restaurants: list[dict[str, Any]],
    used: set[str],
    interest_cats: set[str],
    want_food: bool,
) -> list[dict[str, Any]]:
    """Pick daytime stops only from this day's geographic cluster (+ nearby lunch)."""
    if not cluster:
        return []

    day_pois: list[dict[str, Any]] = []
    preferred_pool = [
        p
        for p in cluster
        if not interest_cats or str(p.get("category") or "") in interest_cats
    ]
    other_pool = [p for p in cluster if p not in preferred_pool]

    attr_need = STOPS_PER_DAY - (1 if want_food else 0)
    attr_need = max(2, min(attr_need, len(cluster)))

    day_pois.extend(_pick_unique(preferred_pool, used=used, limit=attr_need))
    if len(day_pois) < attr_need:
        day_pois.extend(
            _pick_unique(other_pool, used=used, limit=attr_need - len(day_pois))
        )
    if len(day_pois) < min(2, len(cluster)):
        day_pois.extend(
            _pick_unique(cluster, used=used, limit=min(2, len(cluster)) - len(day_pois))
        )

    # Lunch: nearest restaurant to cluster centroid (not global top)
    if want_food and restaurants:
        centroid = cluster_centroid(cluster) or cluster_centroid(day_pois)
        if centroid:
            lunch = nearest_poi_to_point(
                restaurants,
                lat=centroid[0],
                lng=centroid[1],
                exclude_ids=used,
            )
            if lunch is not None:
                pid = str(lunch.get("id") or "")
                if pid:
                    used.add(pid)
                day_pois.append(lunch)

    return day_pois


def pick_base_hotel(
    accommodations: list[dict[str, Any]],
    *,
    origin_lat: float,
    origin_lng: float,
    first_cluster: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Single base hotel near region center / first-day zone — reused every night."""
    if not accommodations:
        return None
    anchor = cluster_centroid(first_cluster)
    lat = anchor[0] if anchor else origin_lat
    lng = anchor[1] if anchor else origin_lng
    # Prefer hotels near the first-day zone / region center (not a far "top-rated" hotel)
    scored: list[tuple[float, dict[str, Any]]] = []
    for poi in accommodations:
        coord = poi_coord(poi)
        if coord is None:
            continue
        d = haversine_km(lat, lng, coord[0], coord[1])
        scored.append((d, poi))
    if not scored:
        return None
    scored.sort(key=lambda t: t[0])
    close = [poi for dist, poi in scored if dist <= 12.0]
    if close:
        return max(close, key=rating_sort_key)
    return scored[0][1]


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
        coords = REGION_COORDINATES["baku"]

    start_lat = float(coords["latitude"])
    start_lng = float(coords["longitude"])

    restaurants = apply_weather_filter(list(restaurants), weather)
    accommodations = apply_weather_filter(list(accommodations), weather)
    attractions = apply_weather_filter(list(attractions), weather)

    restaurants = sorted(restaurants, key=rating_sort_key, reverse=True)
    accommodations = sorted(accommodations, key=rating_sort_key, reverse=True)
    attractions = sorted(attractions, key=rating_sort_key, reverse=True)

    interest_cats = _interest_sets(interests)
    want_food = True

    days_n = max(1, int(days))
    clusters = build_day_clusters(
        attractions,
        days=days_n,
        origin_lat=start_lat,
        origin_lng=start_lng,
    )

    base_hotel = None
    if days_n >= 2 and accommodations:
        first_nonempty = next((c for c in clusters if c), [])
        base_hotel = pick_base_hotel(
            accommodations,
            origin_lat=start_lat,
            origin_lng=start_lng,
            first_cluster=first_nonempty,
        )

    used: set[str] = set()
    if base_hotel and base_hotel.get("id"):
        used.add(str(base_hotel["id"]))

    day_payloads: list[dict[str, Any]] = []

    for day_i in range(1, days_n + 1):
        cluster = clusters[day_i - 1] if day_i - 1 < len(clusters) else []
        # Skip trailing empty days; if middle empty, try borrow leftover unused attractions
        if not cluster:
            leftovers = [
                p
                for p in attractions
                if str(p.get("id") or "") not in used
            ]
            if leftovers:
                # nearest leftovers to region center as emergency day
                cluster = leftovers[:STOPS_PER_DAY]

        daytime = select_stops_from_cluster(
            cluster=cluster,
            restaurants=restaurants,
            used=used,
            interest_cats=interest_cats,
            want_food=want_food,
        )
        if not daytime:
            continue

        centroid = cluster_centroid(daytime) or (start_lat, start_lng)
        ordered_day = order_stops_geo(
            daytime, start_lat=centroid[0], start_lng=centroid[1]
        )

        # Same base hotel at end of each overnight day (not a new far hotel)
        if base_hotel is not None and day_i < days_n:
            ordered_day.append(base_hotel)

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

    # Renumber days sequentially if some were skipped
    for i, day in enumerate(day_payloads, start=1):
        day["day"] = i
        day["title"] = f"{i}. gün"

    return {
        "summary": "",
        "days": day_payloads,
        "total_cost": _budget_total(budget, len(day_payloads)),
        "best_time": "",
        "region": db_region,
        "meta": {
            "budget": budget,
            "interests": interests,
            "group_type": group_type,
            "ordered_by": "geo_clusters_nn_2opt",
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
