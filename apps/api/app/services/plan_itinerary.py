"""Build multi-day itinerary with geo clusters, daypart slots, Claude tips only."""

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
    trim_cluster_diameter,
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
    "food": set(),
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

FOOD_CATS = frozenset({"restaurant", "home_restaurant", "cafe"})
HOTEL_CATS = frozenset({"hotel", "hostel", "guesthouse"})

MAX_RESTAURANT_KM = 10.0
ATTRACTIONS_PER_DAY = 3

# Fixed daypart anchors (minutes from midnight)
BREAKFAST_AT = 9 * 60  # 09:00
LUNCH_AT = 13 * 60  # 13:00
ATTRACTION_START = 10 * 60 + 30  # 10:30 if no breakfast gap
EVENING_HOTEL_AT = 18 * 60  # 18:00


def apply_weather_filter(
    pois: list[dict[str, Any]], weather: dict[str, Any] | None
) -> list[dict[str, Any]]:
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
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for poi in prefer_high_rated(pool, limit=len(pool) or 1):
        pid = str(poi.get("id") or "")
        if not pid or pid in used:
            continue
        used.add(pid)
        out.append(poi)
        if len(out) >= limit:
            break
    return out


def _stop_payload(
    poi: dict[str, Any],
    *,
    time_min: int,
    daypart: str,
) -> dict[str, Any]:
    mins = _poi_duration(poi)
    pub = public_poi_fields(poi)
    return {
        **pub,
        "poi_id": str(poi.get("id") or ""),
        "time": _minutes_to_hhmm(time_min),
        "duration": _duration_label(mins),
        "duration_minutes": mins,
        "daypart": daypart,
        "tip": "",
    }


def _nearest_food(
    restaurants: list[dict[str, Any]],
    *,
    lat: float,
    lng: float,
    used: set[str],
    max_km: float = MAX_RESTAURANT_KM,
) -> dict[str, Any] | None:
    poi = nearest_poi_to_point(restaurants, lat=lat, lng=lng, exclude_ids=used)
    if poi is None:
        return None
    coord = poi_coord(poi)
    if coord is None:
        return None
    if haversine_km(lat, lng, coord[0], coord[1]) > max_km:
        return None
    return poi


def pick_day_pieces(
    *,
    cluster: list[dict[str, Any]],
    restaurants: list[dict[str, Any]],
    used: set[str],
    interest_cats: set[str],
) -> dict[str, Any]:
    """Pick attractions + optional breakfast/lunch near cluster (not yet ordered)."""
    cluster = trim_cluster_diameter(cluster, max_diameter_km=25.0)
    if not cluster:
        return {"attractions": [], "breakfast": None, "lunch": None}

    preferred = [
        p
        for p in cluster
        if not interest_cats or str(p.get("category") or "") in interest_cats
    ]
    other = [p for p in cluster if p not in preferred]

    attractions = _pick_unique(preferred, used=used, limit=ATTRACTIONS_PER_DAY)
    if len(attractions) < ATTRACTIONS_PER_DAY:
        attractions.extend(
            _pick_unique(other, used=used, limit=ATTRACTIONS_PER_DAY - len(attractions))
        )
    if not attractions:
        attractions = _pick_unique(cluster, used=used, limit=min(2, len(cluster)))

    centroid = cluster_centroid(attractions) or cluster_centroid(cluster)
    breakfast = None
    lunch = None
    if centroid:
        lunch = _nearest_food(
            restaurants, lat=centroid[0], lng=centroid[1], used=used
        )
        if lunch is not None:
            used.add(str(lunch.get("id") or ""))
        # Optional light breakfast if another food spot exists nearby
        breakfast = _nearest_food(
            restaurants, lat=centroid[0], lng=centroid[1], used=used, max_km=8.0
        )
        if breakfast is not None:
            used.add(str(breakfast.get("id") or ""))

    return {
        "attractions": attractions,
        "breakfast": breakfast,
        "lunch": lunch,
    }


def assemble_day_stops(
    *,
    attractions: list[dict[str, Any]],
    breakfast: dict[str, Any] | None,
    lunch: dict[str, Any] | None,
    hotel: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """
    Geo-order attractions, then place breakfast morning / lunch midday / hotel evening.
    Times are assigned by daypart (not naive cumulative from a mixed list).
    """
    if not attractions and not breakfast and not lunch and not hotel:
        return []

    ordered_attr = order_stops_geo(attractions) if attractions else []

    stops: list[dict[str, Any]] = []

    # Morning breakfast
    cursor = BREAKFAST_AT
    if breakfast is not None:
        stops.append(_stop_payload(breakfast, time_min=cursor, daypart="breakfast"))
        cursor = BREAKFAST_AT + _poi_duration(breakfast) + 20
    else:
        cursor = ATTRACTION_START

    # Prefix before lunch, suffix after — never reorder geo path (no zigzag).
    morning_budget_end = LUNCH_AT - 15
    morning_attrs: list[dict[str, Any]] = []
    afternoon_attrs: list[dict[str, Any]] = []

    if lunch is None or not ordered_attr:
        morning_attrs = list(ordered_attr)
    else:
        t = cursor
        split_at = len(ordered_attr)
        for i, poi in enumerate(ordered_attr):
            dur = _poi_duration(poi)
            # Keep at least one morning stop when schedule allows
            if i == 0 and t < LUNCH_AT - 45:
                morning_attrs.append(poi)
                t += dur + 25
                continue
            if t + dur > morning_budget_end:
                split_at = i
                break
            morning_attrs.append(poi)
            t += dur + 25
        afternoon_attrs = ordered_attr[split_at:]
        # Ensure lunch sits mid-day when everything fit before noon
        if not afternoon_attrs and len(morning_attrs) > 1:
            split = max(1, len(morning_attrs) // 2)
            afternoon_attrs = morning_attrs[split:]
            morning_attrs = morning_attrs[:split]

    t = cursor
    for poi in morning_attrs:
        stops.append(_stop_payload(poi, time_min=t, daypart="attraction"))
        t += _poi_duration(poi) + 25

    if lunch is not None:
        lunch_time = max(LUNCH_AT, t)
        stops.append(_stop_payload(lunch, time_min=lunch_time, daypart="lunch"))
        t = lunch_time + _poi_duration(lunch) + 25
    else:
        t = max(t, LUNCH_AT)

    for poi in afternoon_attrs:
        stops.append(_stop_payload(poi, time_min=t, daypart="attraction"))
        t += _poi_duration(poi) + 25

    if hotel is not None:
        hotel_time = max(EVENING_HOTEL_AT, t)
        stops.append(_stop_payload(hotel, time_min=hotel_time, daypart="hotel"))

    return stops


def pick_base_hotel(
    accommodations: list[dict[str, Any]],
    *,
    origin_lat: float,
    origin_lng: float,
    first_cluster: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not accommodations:
        return None
    anchor = cluster_centroid(first_cluster)
    lat = anchor[0] if anchor else origin_lat
    lng = anchor[1] if anchor else origin_lng
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
        if not cluster:
            leftovers = [p for p in attractions if str(p.get("id") or "") not in used]
            if leftovers:
                cluster = leftovers[:ATTRACTIONS_PER_DAY]

        pieces = pick_day_pieces(
            cluster=cluster,
            restaurants=restaurants,
            used=used,
            interest_cats=interest_cats,
        )
        hotel = base_hotel if (base_hotel is not None and day_i < days_n) else None

        stops = assemble_day_stops(
            attractions=pieces["attractions"],
            breakfast=pieces["breakfast"],
            lunch=pieces["lunch"],
            hotel=hotel,
        )
        if not stops:
            continue

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
            "ordered_by": "geo_clusters_daypart_open_tsp",
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


def _tip_for_stop(stop: dict[str, Any]) -> str:
    name = (stop.get("name") or "Bu yer").strip()
    daypart = str(stop.get("daypart") or "")
    cat = str(stop.get("category") or "")
    if daypart == "breakfast" or (
        daypart == "" and cat in FOOD_CATS and str(stop.get("time") or "").startswith("09")
    ):
        return f"{name} — səhər yeməyi üçün rahat başlanğıc."
    if daypart == "lunch" or (cat in FOOD_CATS and daypart != "hotel"):
        return f"{name} — nahar üçün yaxşı seçim."
    if daypart == "hotel" or cat in HOTEL_CATS:
        return f"{name} — axşam istirahət və gecələmə üçün."
    return f"{name} — gəzib görməyə dəyər."


def template_enrich(plan: dict[str, Any], *, region_label: str, days: int) -> dict[str, Any]:
    plan = dict(plan)
    plan["summary"] = (
        plan.get("summary") or f"{region_label} üçün {days} günlük marşrut hazırdır."
    )
    plan["best_time"] = plan.get("best_time") or "Səhər tezdən başlamaq rahatdır."
    new_days = []
    for day in plan.get("days") or []:
        day = dict(day)
        day["notes"] = (
            day.get("notes")
            or "Səhər yeməyi → gəzinti → nahar → attraksiya; otel axşama saxlanılıb."
        )
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            if not (stop.get("tip") or "").strip():
                stop["tip"] = _tip_for_stop(stop)
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
    api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip().strip('"').strip("'")
    if not api_key:
        return template_enrich(plan, region_label=region_label, days=days)

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
                        "daypart": s.get("daypart"),
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

MARŞRUT SABİTDİR — sıra/vaxt/daypart dəyişmə, stop əlavə/çıxarma.

DAYPART QAYDALARI (tip yazarkən MÜTLƏQ riayət et):
- breakfast / səhər (~09:00): yalnız səhər yeməyi / başlanğıc tip. Axşam/gecələmə demə.
- lunch / nahar (~13:00): yalnız nahar tip.
- attraction: gəzinti tip. Yemək/otel demə.
- hotel: yalnız axşam istirahət / gecələmə tip. Səhər yeməyi demə.

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
      "stops": [{{"poi_id": "…", "tip": "1 cümlə (daypart-a uyğun)"}}]
    }}
  ]
}}"""

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
                    "Azərbaycan turizm köməkçisisən. Yalnız JSON. "
                    "Stop sırasını dəyişmə. Tip daypart+category-yə uyğun olsun."
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

    tip_days = {
        int(d.get("day")): d for d in (tips.get("days") or []) if d.get("day") is not None
    }
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
                # Keep Claude tip only if it doesn't obviously mismatch daypart
                tip = tip_map[pid]
                dp = str(stop.get("daypart") or "")
                low = tip.lower()
                bad = False
                if dp in {"breakfast", "attraction"} and (
                    "gecələ" in low or "axşam qal" in low or "otel" in low
                ):
                    bad = True
                if dp == "hotel" and ("səhər yemə" in low or "nahar" in low):
                    bad = True
                if dp == "lunch" and ("səhər yemə" in low or "gecələ" in low):
                    bad = True
                stop["tip"] = _tip_for_stop(stop) if bad else tip
            stops.append(stop)
        day["stops"] = stops
        merged_days.append(day)
    plan["days"] = merged_days
    return plan
