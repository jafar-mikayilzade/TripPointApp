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
    grow_compact_tour,
    haversine_km,
    insert_poi_at,
    insertion_detour_km,
    nearest_poi_to_point,
    order_stops_geo,
    pick_poi_min_insert,
    poi_coord,
    tour_length_km,
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
NATURE_CATS = frozenset({"nature", "waterfall", "mountain", "lake"})
HISTORICAL_CATS = frozenset({"historical", "monument"})

MAX_RESTAURANT_KM = 8.0
ATTRACTIONS_PER_DAY = 3
# Tight corridor — opposite-side stops must not enter the day set
MAX_DAY_DIAMETER_KM = 8.0
MAX_ADD_FROM_PATH_KM = 3.5
# Food/hotel only if they barely bend the path
MAX_FOOD_DETOUR_KM = 1.2
MAX_HOTEL_FROM_PATH_END_KM = 6.0

# Fixed daypart anchors (minutes from midnight) — overridden by travel window
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
    origin_lat: float,
    origin_lng: float,
) -> dict[str, Any]:
    """
    Geography-first day set: grow a compact open tour from the cluster.
    Food is NOT picked here — only added later if detour is tiny.
    """
    del restaurants  # lunch/breakfast deferred to assemble (detour-gated)
    cluster = trim_cluster_diameter(cluster, max_diameter_km=MAX_DAY_DIAMETER_KM)
    if not cluster:
        return {"attractions": []}

    anchor = cluster_centroid(cluster)
    lat = anchor[0] if anchor else origin_lat
    lng = anchor[1] if anchor else origin_lng

    attractions = grow_compact_tour(
        cluster,
        origin_lat=lat,
        origin_lng=lng,
        used=used,
        limit=ATTRACTIONS_PER_DAY,
        max_diameter_km=MAX_DAY_DIAMETER_KM,
        max_add_from_path_km=MAX_ADD_FROM_PATH_KM,
        prefer_categories=interest_cats or None,
    )
    for poi in attractions:
        pid = str(poi.get("id") or "")
        if pid:
            used.add(pid)

    return {"attractions": attractions}


def _role_id(poi: dict[str, Any]) -> str:
    return str(poi.get("id") or "")


def _try_add_food(
    path: list[dict[str, Any]],
    restaurants: list[dict[str, Any]],
    *,
    used_ids: set[str],
    index_min: int,
    index_max: int | None,
    max_detour_km: float,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Insert at most one food stop if open-path detour stays under max_detour_km."""
    if not path or not restaurants:
        return path, None
    poi, idx = pick_poi_min_insert(
        path,
        restaurants,
        exclude_ids=used_ids,
        max_km_from_path=MAX_RESTAURANT_KM,
        index_min=index_min,
        index_max=index_max,
    )
    if poi is None:
        return path, None
    detour = insertion_detour_km(path, poi, idx)
    if detour > max_detour_km:
        return path, None
    used_ids.add(_role_id(poi))
    return insert_poi_at(path, poi, idx), poi


def assemble_day_stops(
    *,
    attractions: list[dict[str, Any]],
    hotel: dict[str, Any] | None,
    restaurants: list[dict[str, Any]] | None = None,
    used: set[str] | None = None,
    window_start_min: int | None = None,
    window_end_min: int | None = None,
    allow_hotel: bool = True,
) -> list[dict[str, Any]]:
    """
    Domain rule: walk order = map order.

    1) Compact attractions geo-ordered
    2) Food only if detour is tiny
    3) Times fit [window_start, window_end] — trim stops that don't fit
    4) Hotel last only if allowed + near path end (multi-day)
    """
    restaurants = restaurants or []
    used_ids = used if used is not None else set()
    start_anchor = window_start_min if window_start_min is not None else ATTRACTION_START
    end_anchor = window_end_min if window_end_min is not None else 19 * 60
    lunch_anchor = max(LUNCH_AT, start_anchor + 90)

    path = order_stops_geo(attractions) if attractions else []
    if not path and not (hotel and allow_hotel):
        return []

    breakfast: dict[str, Any] | None = None
    lunch: dict[str, Any] | None = None

    if path:
        mid = max(1, len(path) // 2)
        path, lunch = _try_add_food(
            path,
            restaurants,
            used_ids=used_ids,
            index_min=max(0, mid - 1),
            index_max=min(len(path), mid + 1),
            max_detour_km=MAX_FOOD_DETOUR_KM,
        )
        # Breakfast only if day starts early enough (before ~11:00)
        if start_anchor <= 11 * 60:
            path, breakfast = _try_add_food(
                path,
                restaurants,
                used_ids=used_ids,
                index_min=0,
                index_max=min(1, len(path)),
                max_detour_km=MAX_FOOD_DETOUR_KM,
            )
        path = order_stops_geo(path)
        if breakfast is not None and path:
            bid = _role_id(breakfast)
            if _role_id(path[-1]) == bid and _role_id(path[0]) != bid:
                path = list(reversed(path))

    lunch_id = _role_id(lunch) if lunch else ""
    breakfast_id = _role_id(breakfast) if breakfast else ""

    stops: list[dict[str, Any]] = []
    last_poi: dict[str, Any] | None = None
    t = start_anchor
    if breakfast is not None and start_anchor <= BREAKFAST_AT + 30:
        t = max(start_anchor, BREAKFAST_AT)

    for i, poi in enumerate(path):
        pid = _role_id(poi)
        dur = _poi_duration(poi)
        if breakfast_id and pid == breakfast_id:
            daypart = "breakfast"
            time_min = t if i > 0 else max(start_anchor, min(t, BREAKFAST_AT + 60))
        elif lunch_id and pid == lunch_id:
            daypart = "lunch"
            time_min = max(lunch_anchor, t)
        else:
            daypart = "attraction"
            cat = str(poi.get("category") or "")
            if not lunch_id and cat in FOOD_CATS and 0 < i < len(path) - 1:
                daypart = "lunch"
                time_min = max(lunch_anchor, t)
            else:
                time_min = t

        # Must finish this stop before leaving the region
        if time_min + dur > end_anchor:
            break

        stops.append(_stop_payload(poi, time_min=time_min, daypart=daypart))
        t = time_min + dur + 25
        last_poi = poi

    if allow_hotel and hotel is not None and last_poi is not None:
        end = poi_coord(last_poi)
        h = poi_coord(hotel)
        if end and h and haversine_km(end[0], end[1], h[0], h[1]) <= MAX_HOTEL_FROM_PATH_END_KM:
            hotel_time = max(EVENING_HOTEL_AT, t)
            stops.append(_stop_payload(hotel, time_min=hotel_time, daypart="hotel"))

    return stops


def _travel_leg_stop(
    *,
    name: str,
    time_min: int,
    duration_min: int,
    lat: float,
    lng: float,
    daypart: str,
) -> dict[str, Any]:
    return {
        "id": None,
        "poi_id": "",
        "name": name,
        "category": "travel",
        "description": None,
        "lat": lat,
        "lng": lng,
        "region": None,
        "rating": None,
        "rating_count": None,
        "time": _minutes_to_hhmm(time_min),
        "duration": _duration_label(duration_min),
        "duration_minutes": duration_min,
        "daypart": daypart,
        "tip": "",
    }


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
    origin_lat: float | None = None,
    origin_lng: float | None = None,
    from_origin: bool = False,
    depart_time: str | None = "08:00",
    return_by_time: str | None = "21:00",
) -> dict[str, Any]:
    from app.services.travel_window import build_travel_context, parse_hhmm

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

    travel = build_travel_context(
        origin_lat=origin_lat,
        origin_lng=origin_lng,
        region_lat=start_lat,
        region_lng=start_lng,
        days=days_n,
        depart_time=depart_time,
        return_by_time=return_by_time,
        from_origin=from_origin,
    )

    clusters = build_day_clusters(
        attractions,
        days=days_n,
        origin_lat=start_lat,
        origin_lng=start_lng,
    )

    allow_hotel = bool(travel.get("allow_hotel"))
    base_hotel = None
    if allow_hotel and accommodations:
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
    last_day_end = int(travel.get("last_day_end_min") or travel.get("day_end_min") or 19 * 60)

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
            origin_lat=start_lat,
            origin_lng=start_lng,
        )

        # Time windows
        if day_i == 1:
            w_start = int(travel.get("day_start_min") or ATTRACTION_START)
        else:
            w_start = BREAKFAST_AT
        if day_i == days_n:
            w_end = last_day_end
        else:
            w_end = 20 * 60

        hotel = (
            base_hotel
            if (base_hotel is not None and allow_hotel and day_i < days_n)
            else None
        )

        stops = assemble_day_stops(
            attractions=pieces["attractions"],
            hotel=hotel,
            restaurants=restaurants,
            used=used,
            window_start_min=w_start,
            window_end_min=w_end,
            allow_hotel=allow_hotel and day_i < days_n,
        )

        # Prepend outbound travel leg on day 1 when coming from elsewhere
        if travel.get("from_origin") and day_i == 1 and stops:
            depart_m = parse_hhmm(travel.get("depart_origin_at"), 8 * 60)
            out_m = int(travel.get("outbound_minutes") or 0)
            o_lat = float(travel.get("origin_lat") or start_lat)
            o_lng = float(travel.get("origin_lng") or start_lng)
            stops = [
                _travel_leg_stop(
                    name="Yola çıxış (cari məkan)",
                    time_min=depart_m,
                    duration_min=out_m,
                    lat=o_lat,
                    lng=o_lng,
                    daypart="travel_out",
                ),
                _travel_leg_stop(
                    name=f"{db_region.title()} — çatış",
                    time_min=int(travel.get("day_start_min") or w_start),
                    duration_min=15,
                    lat=start_lat,
                    lng=start_lng,
                    daypart="travel_arrive",
                ),
            ] + stops

        # Append return leg on last day
        if travel.get("from_origin") and day_i == days_n and stops:
            leave_m = parse_hhmm(travel.get("leave_region_by"), last_day_end)
            ret_m = int(travel.get("return_minutes") or 0)
            o_lat = float(travel.get("origin_lat") or start_lat)
            o_lng = float(travel.get("origin_lng") or start_lng)
            # Ensure leave is after last visit
            last_visit = stops[-1]
            last_t = parse_hhmm(str(last_visit.get("time") or ""), leave_m)
            last_dur = int(last_visit.get("duration_minutes") or 0)
            leave_m = max(leave_m, last_t + last_dur)
            stops = stops + [
                _travel_leg_stop(
                    name="Geri dönüş — yola çıxış",
                    time_min=leave_m,
                    duration_min=ret_m,
                    lat=start_lat,
                    lng=start_lng,
                    daypart="travel_return",
                ),
                _travel_leg_stop(
                    name="Evə / Bakıya çatış",
                    time_min=leave_m + ret_m,
                    duration_min=15,
                    lat=o_lat,
                    lng=o_lng,
                    daypart="travel_home",
                ),
            ]

        notes = ""
        if travel.get("from_origin") and day_i == 1:
            notes = (
                f"Çıxış {travel.get('depart_origin_at')} → "
                f"rayona çatış ~{travel.get('arrive_region_at')} "
                f"(~{travel.get('outbound_minutes')} dəq / {travel.get('distance_km')} km)."
            )
        if travel.get("from_origin") and day_i == days_n:
            extra = (
                f" Geri dönüş üçün ən gec {travel.get('leave_region_by')} "
                f"yola çıxın — {travel.get('return_origin_by')} evdə olun."
            )
            notes = (notes + extra).strip()

        if not stops:
            continue

        day_payloads.append(
            {
                "day": day_i,
                "title": f"{day_i}. gün",
                "stops": stops,
                "estimated_cost": _budget_day_cost(budget),
                "notes": notes,
            }
        )

    if not day_payloads or not any(d["stops"] for d in day_payloads):
        raise ValueError("Bu bölgədə marşrut üçün kifayət qədər yer tapılmadı")

    for i, day in enumerate(day_payloads, start=1):
        day["day"] = i
        day["title"] = f"{i}. gün"

    best_time = ""
    if travel.get("from_origin"):
        best_time = (
            f"Çıxış {travel.get('depart_origin_at')}, "
            f"rayonda {travel.get('arrive_region_at')}–{travel.get('leave_region_by')}, "
            f"evə {travel.get('return_origin_by')}."
        )

    lodging = None
    if base_hotel is not None:
        lodging = {
            **public_poi_fields(base_hotel),
            "note": "Ümumi gecələmə bazası (bütün gecələr eyni otel).",
        }
        # First overnight day note — clarify single hotel once
        for day in day_payloads:
            has_hotel_stop = any(
                str(s.get("daypart") or "") == "hotel"
                or str(s.get("category") or "") in HOTEL_CATS
                for s in (day.get("stops") or [])
            )
            if has_hotel_stop:
                hotel_name = str(base_hotel.get("name") or "Otel")
                prefix = f"Gecələmə: {hotel_name}."
                existing = str(day.get("notes") or "").strip()
                if prefix.lower() not in existing.lower():
                    day["notes"] = f"{prefix} {existing}".strip()
                break

    return {
        "summary": "",
        "days": day_payloads,
        "total_cost": _budget_total(budget, len(day_payloads)),
        "best_time": best_time,
        "region": db_region,
        "travel": travel if travel.get("from_origin") else None,
        "lodging": lodging,
        "meta": {
            "budget": budget,
            "interests": interests,
            "group_type": group_type,
            "ordered_by": "geo_first_compact_tour_travel_window",
            "allow_hotel": allow_hotel,
            "single_base_hotel": bool(base_hotel),
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


def _is_travel_stop(stop: dict[str, Any]) -> bool:
    cat = str(stop.get("category") or "").strip().lower()
    daypart = str(stop.get("daypart") or "").strip().lower()
    return cat == "travel" or daypart.startswith("travel")


def _tip_for_stop(stop: dict[str, Any]) -> str:
    """Category/daypart tip. Unknown/travel → empty (no generic 'must visit')."""
    if _is_travel_stop(stop):
        return ""

    name = (stop.get("name") or "Bu yer").strip()
    daypart = str(stop.get("daypart") or "").strip().lower()
    cat = str(stop.get("category") or "").strip().lower()
    time_s = str(stop.get("time") or "")

    if daypart == "hotel" or cat in HOTEL_CATS:
        return f"{name} — axşam istirahət və gecələmə."

    if cat in FOOD_CATS or daypart in {"breakfast", "lunch"}:
        if daypart == "breakfast" or (
            daypart != "lunch" and time_s.startswith("09")
        ):
            return f"{name} — səhər yeməyi üçün."
        return f"{name} — nahar üçün uyğun seçim."

    if cat in NATURE_CATS:
        return f"{name} — təbiət mənzərəsi üçün qısa dayanacaq."

    if cat in HISTORICAL_CATS:
        return f"{name} — tarixi məkana nəzər yetirin."

    # other / unknown — better empty than misleading template
    return ""


def _claude_tip_mismatch(stop: dict[str, Any], tip: str) -> bool:
    """True if Claude tip clearly conflicts with stop role."""
    if not tip.strip():
        return True
    if _is_travel_stop(stop):
        return True

    dp = str(stop.get("daypart") or "").strip().lower()
    cat = str(stop.get("category") or "").strip().lower()
    low = tip.lower()

    if dp in {"breakfast", "attraction"} and (
        "gecələ" in low or "axşam qal" in low or "otelə" in low
    ):
        return True
    if (dp == "hotel" or cat in HOTEL_CATS) and (
        "səhər yemə" in low or "nahar" in low
    ):
        return True
    if dp == "lunch" and ("səhər yemə" in low or "gecələ" in low):
        return True
    if cat in FOOD_CATS and ("gecələ" in low or "gəzib gör" in low):
        return True
    if cat in NATURE_CATS and ("nahar" in low or "səhər yemə" in low or "gecələ" in low):
        return True
    if cat in HISTORICAL_CATS and ("nahar" in low or "gecələ" in low):
        return True
    # Never keep the old generic visit fluff
    if "gəzib görməyə dəyər" in low:
        return True
    return False


def template_enrich(plan: dict[str, Any], *, region_label: str, days: int) -> dict[str, Any]:
    plan = dict(plan)
    lodging = plan.get("lodging")
    lodging_name = (
        str((lodging or {}).get("name") or "").strip() if isinstance(lodging, dict) else ""
    )
    plan["summary"] = (
        plan.get("summary") or f"{region_label} üçün {days} günlük marşrut hazırdır."
    )
    plan["best_time"] = plan.get("best_time") or "Səhər tezdən başlamaq rahatdır."
    new_days = []
    for day in plan.get("days") or []:
        day = dict(day)
        default_notes = "Səhər → gəzinti → nahar → attraksiya."
        if lodging_name and any(
            str(s.get("daypart") or "") == "hotel"
            or str(s.get("category") or "") in HOTEL_CATS
            for s in (day.get("stops") or [])
        ):
            default_notes = f"Gecələmə: {lodging_name}. {default_notes}"
        day["notes"] = day.get("notes") or default_notes
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            if _is_travel_stop(stop):
                stop["tip"] = ""
            elif not (stop.get("tip") or "").strip():
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

DAYPART / KATEQORİYA QAYDALARI (tip yazarkən MÜTLƏQ):
- travel / travel_*: tip YAZMA (boş string). Yol/transfer üçün “gəz” dili yox.
- breakfast / food (~09:00): yalnız səhər yeməyi tip.
- lunch / food (~13:00): yalnız nahar tip.
- hotel / hostel / guesthouse: yalnız gecələmə tip.
- nature / waterfall / mountain / lake: təbiət tip.
- historical / monument: tarixi tip.
- attraction (digər): yalnız daypart uyğundursa qısa tip; əmin deyilsənsə tip boş burax.
- Ümumi “gəzib görməyə dəyər” şablonu İSTİFADƏ ETMƏ.

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
      "stops": [{{"poi_id": "…", "tip": "daypart/category-yə uyğun və ya boş"}}]
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
                    "Stop sırasını dəyişmə. Tip daypart+category-yə uyğun olsun; "
                    "travel üçün tip boş; naməlum üçün tip boş."
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
            if _is_travel_stop(stop):
                stop["tip"] = ""
                stops.append(stop)
                continue
            pid = str(stop.get("poi_id") or "")
            tip = tip_map.get(pid) or ""
            if tip and not _claude_tip_mismatch(stop, tip):
                stop["tip"] = tip
            else:
                # Mismatch / empty Claude → category tip or empty (never generic visit fluff)
                stop["tip"] = _tip_for_stop(stop)
            stops.append(stop)
        day["stops"] = stops
        merged_days.append(day)
    plan["days"] = merged_days
    return plan
