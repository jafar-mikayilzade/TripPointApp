"""Build multi-day itinerary with geo clusters, daypart slots, Claude tips only."""

from __future__ import annotations

import json
import logging
import math
import random
import re
import time
from typing import Any

import requests

from app.config import ANTHROPIC_API_KEY
from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.services.attraction_classify import (
    attraction_matches_interests,
    classify_attraction_rows,
    interest_attraction_cats,
)
from app.services.geo_route import (
    build_day_clusters,
    cluster_centroid,
    cluster_member_ids,
    filter_pois_clear_of,
    grow_compact_tour,
    haversine_km,
    insert_poi_at,
    insertion_detour_km,
    min_km_to_coords,
    nearest_poi_to_point,
    order_stops_geo,
    pick_poi_min_insert,
    poi_coord,
    trim_cluster_diameter,
)
from app.services.rank_pois import (
    public_poi_fields,
    rating_sort_key,
)
from app.services.places_tourism_filter import (
    name_has_forbidden_script,
    sanitize_tip_text,
)

logger = logging.getLogger(__name__)

DURATION_MINUTES: dict[str, int] = {
    "restaurant": 55,
    "home_restaurant": 55,
    "cafe": 35,
    "hotel": 20,
    "hostel": 20,
    "guesthouse": 20,
    "camping": 20,
    # Denser day packing — still realistic visit windows
    "nature": 55,
    "waterfall": 50,
    "mountain": 55,
    "lake": 50,
    "historical": 45,
    "monument": 30,
    "other": 40,
}

FOOD_CATS = frozenset({"restaurant", "home_restaurant", "cafe"})
HOTEL_CATS = frozenset({"hotel", "hostel", "guesthouse", "camping"})
NATURE_CATS = frozenset({"nature", "waterfall", "mountain", "lake"})
HISTORICAL_CATS = frozenset({"historical", "monument"})

MAX_RESTAURANT_KM = 12.0
ATTRACTIONS_PER_DAY = 5
# Full (middle) days pack denser; travel days still aim for a full walk day
ATTRACTIONS_PER_FULL_DAY = 6
ATTRACTIONS_PER_TRAVEL_DAY = 5
# Compact day bubbles — multi-day must not sprawl into another day's zone
FULL_DAY_DIAMETER_KM = 14.0
FULL_DAY_ADD_FROM_PATH_KM = 7.0
TRAVEL_DAY_DIAMETER_KM = 14.0
TRAVEL_DAY_ADD_FROM_PATH_KM = 7.0
MAX_DAY_DIAMETER_KM = 14.0
MAX_ADD_FROM_PATH_KM = 7.0
# Later days stay clear of earlier days' visited area (avoid mixing routes)
DAY_FOOTPRINT_CLEARANCE_KM = 10.0
# Food/hotel only if they barely bend the path
MAX_FOOD_DETOUR_KM = 2.0
MAX_FOOD_DETOUR_RELAXED_KM = 10.0
MAX_LUNCH_FALLBACK_KM = 35.0

# Fixed daypart anchors (minutes from midnight) — overridden by travel window
BREAKFAST_AT = 9 * 60  # 09:00
LUNCH_AT = 13 * 60  # 13:00
ATTRACTION_START = 10 * 60 + 30  # 10:30 if no breakfast gap
EVENING_HOTEL_AT = 18 * 60  # 18:00


def _format_nightly_price(poi: dict[str, Any]) -> str | None:
    raw = poi.get("price_from")
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    currency = str(poi.get("price_currency") or "AZN").strip().upper() or "AZN"
    rounded = str(int(round(value))) if value >= 1 else f"{value:.2f}"
    return f"gecə/{rounded} {currency}"


def _hotel_tip(hotel: dict[str, Any], *, shared_hotel: bool = False) -> str:
    """Badge already says Gecələmə — tip only carries real nightly price."""
    del shared_hotel
    price = _format_nightly_price(hotel)
    return f"({price})" if price else ""


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
    return interest_attraction_cats(interests)


def _prioritize_attractions_for_interests(
    attractions: list[dict[str, Any]],
    interest_cats: set[str],
    *,
    rng: random.Random,
    exclude_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Interest-first pool with shuffle; soft-exclude previous plan stops."""
    exclude = exclude_ids or set()
    classified = classify_attraction_rows(attractions)

    def pid(p: dict[str, Any]) -> str:
        return str(p.get("id") or p.get("place_id") or "")

    fresh = [p for p in classified if pid(p) and pid(p) not in exclude]
    # Hard-prefer unused POIs on replan; only fall back when pool is empty
    pool = fresh if fresh else classified

    if not interest_cats:
        rng.shuffle(pool)
        return pool

    preferred = [
        p for p in pool if attraction_matches_interests(p, interest_cats)
    ]
    rng.shuffle(preferred)
    # Hard filter: only interest-matching attractions (mountains gated)
    return preferred


def _stop_payload(
    poi: dict[str, Any],
    *,
    time_min: int,
    daypart: str,
    tip: str = "",
) -> dict[str, Any]:
    mins = _poi_duration(poi)
    pub = public_poi_fields(poi)
    # UI badge covers meal/lodging role — avoid duplicate fluff tips
    return {
        **pub,
        "poi_id": str(poi.get("id") or ""),
        "time": _minutes_to_hhmm(time_min),
        "duration": _duration_label(mins),
        "duration_minutes": mins,
        "daypart": daypart,
        "tip": (tip or "").strip(),
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


def _day_pack_params(day_i: int, days_n: int) -> tuple[int, float, float]:
    """
    (attraction_limit, max_diameter_km, max_add_from_path_km)

    Middle days are fully on-site → denser packing.
    Day 1 / last day lose time to travel → still try for several stops.
    """
    if days_n <= 1:
        return ATTRACTIONS_PER_FULL_DAY, FULL_DAY_DIAMETER_KM, FULL_DAY_ADD_FROM_PATH_KM
    if day_i == 1 or day_i == days_n:
        return (
            ATTRACTIONS_PER_TRAVEL_DAY,
            TRAVEL_DAY_DIAMETER_KM,
            TRAVEL_DAY_ADD_FROM_PATH_KM,
        )
    return ATTRACTIONS_PER_FULL_DAY, FULL_DAY_DIAMETER_KM, FULL_DAY_ADD_FROM_PATH_KM


def _seed_away_from_footprint(
    pool: list[dict[str, Any]],
    footprint: list[tuple[float, float]],
    *,
    fallback_lat: float,
    fallback_lng: float,
) -> tuple[float, float]:
    """Pick a grow origin far from earlier days; else cluster/region fallback."""
    if pool and footprint:
        best = max(pool, key=lambda p: min_km_to_coords(p, footprint))
        coord = poi_coord(best)
        if coord:
            return coord
    anchor = cluster_centroid(pool) if pool else None
    if anchor:
        return anchor
    return fallback_lat, fallback_lng


def _take_along_tour(
    cluster: list[dict[str, Any]],
    *,
    used: set[str],
    limit: int,
    prefer_categories: set[str] | None,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """
    Keep tour-segment order (contiguous geography). Never cherry-pick
    non-contiguous POIs from the segment — that recreates day zigzags.
    With rng: rotate the contiguous window slightly for replan variety.
    """
    available = [
        p
        for p in cluster
        if poi_coord(p) is not None and str(p.get("id") or "") not in used
    ]
    if not available or limit <= 0:
        return []

    def contiguous_slice(items: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
        if len(items) <= n:
            return list(items)
        offset = 0
        if rng is not None and len(items) > n:
            # Shift start by 0..2 stops so replans differ without breaking order
            offset = rng.randint(0, min(2, len(items) - n))
        return items[offset : offset + n]

    if prefer_categories:
        matched = [
            p
            for p in available
            if attraction_matches_interests(p, set(prefer_categories))
        ]
        # Hard interest filter — never pad with other categories
        return contiguous_slice(matched, limit)

    return contiguous_slice(available, limit)


def pick_day_pieces(
    *,
    cluster: list[dict[str, Any]],
    restaurants: list[dict[str, Any]],
    used: set[str],
    interest_cats: set[str],
    origin_lat: float,
    origin_lng: float,
    rng: random.Random | None = None,
    attraction_limit: int | None = None,
    max_diameter_km: float | None = None,
    max_add_from_path_km: float | None = None,
    global_pool: list[dict[str, Any]] | None = None,
    avoid_coords: list[tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """
    Pack one day from its exclusive tour segment (contiguous order).

    Food is NOT picked here — only added later if detour is tiny.
    global_pool is a last-resort fill only when the segment is empty/thin,
    and only for POIs clear of earlier days.
    """
    del restaurants  # lunch/breakfast deferred to assemble (detour-gated)
    limit = attraction_limit if attraction_limit is not None else ATTRACTIONS_PER_DAY
    diameter = max_diameter_km if max_diameter_km is not None else MAX_DAY_DIAMETER_KM
    add_km = (
        max_add_from_path_km
        if max_add_from_path_km is not None
        else MAX_ADD_FROM_PATH_KM
    )
    footprint = list(avoid_coords or [])

    # Tour segments are already compact along a path — only trim extreme outliers
    cluster = trim_cluster_diameter(cluster, max_diameter_km=max(diameter, 28.0))

    pool = list(global_pool or [])
    if footprint and pool:
        pool = filter_pois_clear_of(
            pool, footprint, min_clearance_km=DAY_FOOTPRINT_CLEARANCE_KM
        )

    if not cluster and not pool:
        return {"attractions": []}

    attractions = _take_along_tour(
        cluster,
        used=used,
        limit=limit,
        prefer_categories=interest_cats or None,
        rng=rng,
    )

    # Top up until day limit — a 2-POI gap segment must still grow to a full day
    if pool and len(attractions) < limit:
        already = {str(p.get("id") or "") for p in attractions}
        fill_used = set(used) | already
        seed_lat, seed_lng = _seed_away_from_footprint(
            pool,
            footprint,
            fallback_lat=origin_lat,
            fallback_lng=origin_lng,
        )
        # Sparse regions: open the bubble so DB attractions actually get used
        sparse = len(pool) >= 6 and len(attractions) <= 1
        extra = grow_compact_tour(
            pool,
            origin_lat=seed_lat,
            origin_lng=seed_lng,
            used=fill_used,
            limit=limit - len(attractions),
            max_diameter_km=max(diameter, 35.0 if sparse else 22.0),
            max_add_from_path_km=max(add_km, 18.0 if sparse else 10.0),
            prefer_categories=interest_cats or None,
            rng=rng,
        )
        attractions = attractions + extra
        # Still thin? wider radius but KEEP interest filter
        if len(attractions) < min(4, limit):
            already = {str(p.get("id") or "") for p in attractions}
            fill_used = set(used) | already
            extra2 = grow_compact_tour(
                pool,
                origin_lat=seed_lat,
                origin_lng=seed_lng,
                used=fill_used,
                limit=limit - len(attractions),
                max_diameter_km=45.0,
                max_add_from_path_km=25.0,
                prefer_categories=interest_cats or None,
                rng=rng,
            )
            attractions = attractions + extra2
        # Last resort: nearest unused pool members (interest-matched only)
        if len(attractions) < min(3, limit):
            already = {str(p.get("id") or "") for p in attractions}
            ranked = sorted(
                [
                    p
                    for p in pool
                    if str(p.get("id") or "")
                    and str(p.get("id") or "") not in already
                    and str(p.get("id") or "") not in used
                    and poi_coord(p) is not None
                    and (
                        not interest_cats
                        or attraction_matches_interests(p, interest_cats)
                    )
                ],
                key=lambda p: haversine_km(
                    seed_lat,
                    seed_lng,
                    float(poi_coord(p)[0]),  # type: ignore[index]
                    float(poi_coord(p)[1]),  # type: ignore[index]
                ),
            )
            for p in ranked:
                if len(attractions) >= min(3, limit):
                    break
                attractions.append(p)

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
    shared_hotel: bool = False,
) -> list[dict[str, Any]]:
    """
    Domain rule: attractions stay geo-ordered; meals keep fixed clock slots.

    1) Compact attractions geo-ordered (meals NOT in that TSP)
    2) Breakfast first / lunch mid inserted by role (never re-TSP with meals)
    3) Times: breakfast≈09:00, lunch≈13:00, attractions fill around them
    4) Same base hotel last on overnight days (multi-day)
    """
    restaurants = restaurants or []
    used_ids = used if used is not None else set()
    start_anchor = window_start_min if window_start_min is not None else ATTRACTION_START
    end_anchor = window_end_min if window_end_min is not None else 20 * 60 + 30
    lunch_anchor = max(LUNCH_AT, start_anchor + 90)

    # Geo-order attractions ONLY — never mix meals into TSP (that swaps breakfast/lunch clocks)
    path_attr = order_stops_geo(attractions) if attractions else []
    if not path_attr and not (hotel and allow_hotel):
        return []

    breakfast: dict[str, Any] | None = None
    lunch: dict[str, Any] | None = None

    if path_attr:
        mid = max(1, len(path_attr) // 2)
        # Lunch near path midpoint (detour-aware)
        _, lunch = _try_add_food(
            path_attr,
            restaurants,
            used_ids=used_ids,
            index_min=max(0, mid - 1),
            index_max=min(len(path_attr), mid + 1),
            max_detour_km=MAX_FOOD_DETOUR_KM,
        )
        if lunch is None:
            _, lunch = _try_add_food(
                path_attr,
                restaurants,
                used_ids=used_ids,
                index_min=max(0, mid - 1),
                index_max=min(len(path_attr), mid + 1),
                max_detour_km=MAX_FOOD_DETOUR_RELAXED_KM,
            )
        if lunch is None and restaurants:
            mid_poi = path_attr[min(len(path_attr) - 1, len(path_attr) // 2)]
            mid_c = poi_coord(mid_poi)
            if mid_c:
                lunch = _nearest_food(
                    restaurants,
                    lat=mid_c[0],
                    lng=mid_c[1],
                    used=used_ids,
                    max_km=MAX_LUNCH_FALLBACK_KM,
                )
                if lunch is not None:
                    lid = _role_id(lunch)
                    if lid:
                        used_ids.add(lid)
            if lunch is None:
                for poi in path_attr:
                    c = poi_coord(poi)
                    if not c:
                        continue
                    lunch = _nearest_food(
                        restaurants,
                        lat=c[0],
                        lng=c[1],
                        used=used_ids,
                        max_km=MAX_LUNCH_FALLBACK_KM,
                    )
                    if lunch is not None:
                        lid = _role_id(lunch)
                        if lid:
                            used_ids.add(lid)
                        break
        if lunch is None and restaurants:
            candidates = [
                r
                for r in restaurants
                if _role_id(r) and _role_id(r) not in used_ids and poi_coord(r)
            ]
            if candidates:
                lunch = max(candidates, key=rating_sort_key)
                lid = _role_id(lunch)
                if lid:
                    used_ids.add(lid)

        # Breakfast only on long early windows — never after lunch clock
        if start_anchor <= 11 * 60 and (end_anchor - start_anchor) >= 7 * 60 + 30:
            _, breakfast = _try_add_food(
                path_attr,
                restaurants,
                used_ids=used_ids,
                index_min=0,
                index_max=min(1, len(path_attr)),
                max_detour_km=MAX_FOOD_DETOUR_RELAXED_KM,
            )

    # Build role-ordered path: breakfast → morning attrs → lunch → afternoon attrs
    insert_at = min(len(path_attr), max(1, len(path_attr) // 2)) if path_attr else 0
    morning = list(path_attr[:insert_at]) if path_attr else []
    afternoon = list(path_attr[insert_at:]) if path_attr else []
    path: list[tuple[dict[str, Any], str]] = []
    if breakfast is not None:
        path.append((breakfast, "breakfast"))
    for poi in morning:
        path.append((poi, "attraction"))
    if lunch is not None:
        path.append((lunch, "lunch"))
    for poi in afternoon:
        path.append((poi, "attraction"))

    stops: list[dict[str, Any]] = []
    t = start_anchor
    if breakfast is not None:
        t = max(start_anchor, BREAKFAST_AT)

    for poi, daypart in path:
        dur = _poi_duration(poi)
        if daypart == "breakfast":
            time_min = max(start_anchor, BREAKFAST_AT)
            # Hard cap: breakfast must finish before lunch slot
            if time_min + dur > lunch_anchor - 10:
                time_min = max(start_anchor, lunch_anchor - dur - 15)
            if time_min >= lunch_anchor:
                continue
            tip = ""
        elif daypart == "lunch":
            time_min = max(lunch_anchor, t if t <= lunch_anchor + 45 else lunch_anchor)
            tip = ""
        else:
            tip = ""
            time_min = max(t, start_anchor)
            lunch_already = any(s.get("daypart") == "lunch" for s in stops)
            if lunch is not None and not lunch_already and time_min + dur > lunch_anchor:
                # Morning slot too short — drop rather than push lunch into morning
                continue

        if time_min + dur > end_anchor:
            if daypart == "lunch":
                time_min = min(max(lunch_anchor, start_anchor), end_anchor - dur)
                if time_min + dur > end_anchor:
                    continue
            elif daypart == "breakfast":
                continue
            else:
                continue

        # Safety: breakfast never after lunch on the clock
        if daypart == "breakfast" and time_min >= lunch_anchor:
            continue
        if daypart == "lunch" and any(
            s.get("daypart") == "breakfast"
            and str(s.get("time") or "") > _minutes_to_hhmm(time_min)
            for s in stops
        ):
            # Shouldn't happen with role order; skip rather than mislabel
            pass

        stops.append(
            _stop_payload(poi, time_min=time_min, daypart=daypart, tip=tip)
        )
        t = time_min + dur + 8
        if daypart == "breakfast":
            t = max(t, ATTRACTION_START)
        if daypart == "lunch":
            t = max(t, time_min + dur + 8)

    if allow_hotel and hotel is not None:
        hotel_time = max(EVENING_HOTEL_AT, t if stops else start_anchor)
        stops.append(
            _stop_payload(
                hotel,
                time_min=hotel_time,
                daypart="hotel",
                tip=_hotel_tip(hotel, shared_hotel=shared_hotel),
            )
        )

    # Final safety: sort by clock, then fix food labels to match timeline
    stops.sort(key=lambda s: str(s.get("time") or "99:99"))
    _relabel_meal_dayparts(stops)
    return stops


def _parse_stop_minutes(stop: dict[str, Any]) -> int:
    raw = str(stop.get("time") or "00:00")
    parts = raw.split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return 0


def _relabel_meal_dayparts(stops: list[dict[str, Any]]) -> None:
    """Force food badges to match clock order (breakfast morning, lunch midday)."""
    food_idxs = [
        i
        for i, s in enumerate(stops)
        if str(s.get("daypart") or "") in {"breakfast", "lunch"}
        or str(s.get("category") or "") in FOOD_CATS
    ]
    if not food_idxs:
        return
    # Chronological among food stops: first early → breakfast, midday → lunch
    food_idxs.sort(key=lambda i: _parse_stop_minutes(stops[i]))
    assigned_breakfast = False
    assigned_lunch = False
    for i in food_idxs:
        stop = stops[i]
        cat = str(stop.get("category") or "")
        dp = str(stop.get("daypart") or "")
        if cat not in FOOD_CATS and dp not in {"breakfast", "lunch"}:
            continue
        mins = _parse_stop_minutes(stop)
        if mins < 11 * 60 and not assigned_breakfast:
            stop["daypart"] = "breakfast"
            stop["tip"] = ""
            assigned_breakfast = True
        elif mins < 17 * 60 and not assigned_lunch:
            stop["daypart"] = "lunch"
            stop["tip"] = ""
            assigned_lunch = True
        elif dp in {"breakfast", "lunch"}:
            # Extra food stop — keep as plain attraction visit (no meal badge)
            stop["daypart"] = "attraction"
            stop["tip"] = ""


def _travel_leg_stop(
    *,
    name: str,
    time_min: int,
    duration_min: int,
    lat: float,
    lng: float,
    daypart: str,
    tip: str = "",
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
        "tip": tip or "",
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
    variety_seed: int | None = None,
    exclude_poi_ids: list[str] | None = None,
    lodging_type: str | None = "hotel",
) -> dict[str, Any]:
    from app.services.travel_window import build_travel_context, parse_hhmm
    from app.services.rank_pois import filter_accommodations_by_lodging_type

    region_key = region.strip().lower()
    db_region = REGION_DB_ID.get(region_key, region_key)
    coords = REGION_COORDINATES.get(region_key) or REGION_COORDINATES.get(db_region)
    if not coords:
        coords = REGION_COORDINATES["baku"]

    start_lat = float(coords["latitude"])
    start_lng = float(coords["longitude"])

    seed_val = int(variety_seed) if variety_seed is not None else int(time.time_ns() % (2**31))
    rng = random.Random(seed_val)

    restaurants = apply_weather_filter(list(restaurants), weather)
    accommodations = apply_weather_filter(list(accommodations), weather)
    accommodations = filter_accommodations_by_lodging_type(
        accommodations, lodging_type
    )
    attractions = apply_weather_filter(list(attractions), weather)

    restaurants = sorted(restaurants, key=rating_sort_key, reverse=True)
    accommodations = sorted(accommodations, key=rating_sort_key, reverse=True)

    exclude = {str(x) for x in (exclude_poi_ids or []) if str(x).strip()}
    # Also rotate food/lodging away from the previous plan when alternatives exist
    if exclude:
        fresh_r = [r for r in restaurants if str(r.get("id") or "") not in exclude]
        if fresh_r:
            restaurants = fresh_r
        fresh_h = [h for h in accommodations if str(h.get("id") or "") not in exclude]
        if fresh_h:
            accommodations = fresh_h

    # Replan variety among near-tied food/lodging
    if len(restaurants) > 1:
        top = restaurants[: min(8, len(restaurants))]
        rng.shuffle(top)
        restaurants = top + restaurants[len(top) :]
    if len(accommodations) > 1:
        top_h = accommodations[: min(6, len(accommodations))]
        rng.shuffle(top_h)
        accommodations = top_h + accommodations[len(top_h) :]

    interest_cats = _interest_sets(interests)
    attractions = _prioritize_attractions_for_interests(
        attractions,
        interest_cats,
        rng=rng,
        exclude_ids=exclude,
    )
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
        rng=rng,
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
    # Exclusive Voronoi ownership — day B must not steal day A's leftover neighbours
    cluster_ids = cluster_member_ids(clusters)
    # Visited stop coords from earlier days (attractions only; keep days spatially apart)
    day_footprints: list[tuple[float, float]] = []

    for day_i in range(1, days_n + 1):
        limit, diameter, add_km = _day_pack_params(day_i, days_n)
        cluster = list(clusters[day_i - 1]) if day_i - 1 < len(clusters) else []
        foreign_ids: set[str] = set()
        for j, ids in enumerate(cluster_ids):
            if j != day_i - 1:
                foreign_ids |= ids

        if not cluster:
            leftovers = [
                p
                for p in attractions
                if str(p.get("id") or "") not in used
                and str(p.get("id") or "") not in foreign_ids
            ]
            leftovers = filter_pois_clear_of(
                leftovers,
                day_footprints,
                min_clearance_km=DAY_FOOTPRINT_CLEARANCE_KM,
            )
            if interest_cats:
                pref = [
                    p
                    for p in leftovers
                    if attraction_matches_interests(p, interest_cats)
                ]
                leftovers = pref
            if leftovers:
                # Grow a local bubble from the farthest leftover vs earlier days
                seed_lat, seed_lng = _seed_away_from_footprint(
                    leftovers,
                    day_footprints,
                    fallback_lat=start_lat,
                    fallback_lng=start_lng,
                )
                cluster = grow_compact_tour(
                    leftovers,
                    origin_lat=seed_lat,
                    origin_lng=seed_lng,
                    used=used,
                    limit=max(limit, ATTRACTIONS_PER_DAY),
                    max_diameter_km=max(diameter, 35.0),
                    max_add_from_path_km=max(add_km, 18.0),
                    prefer_categories=interest_cats or None,
                    rng=rng,
                )

        # Tour segments are exclusive for ownership, but unused leftovers may fill
        # a thin day. After rebalance, clusters should already be sized fairly.
        owned_elsewhere = foreign_ids
        own_ids = cluster_ids[day_i - 1] if day_i - 1 < len(cluster_ids) else set()
        unassigned = [
            p
            for p in attractions
            if str(p.get("id") or "") not in used
            and str(p.get("id") or "") not in owned_elsewhere
            and str(p.get("id") or "") not in own_ids
        ]
        # Earlier days may leave unused cluster members — allow day N to absorb them
        earlier_leftovers: list[dict[str, Any]] = []
        if day_i > 1:
            for j in range(day_i - 1):
                ids = cluster_ids[j] if j < len(cluster_ids) else set()
                for p in attractions:
                    pid = str(p.get("id") or "")
                    if pid and pid in ids and pid not in used:
                        earlier_leftovers.append(p)
        fill_pool = unassigned + earlier_leftovers
        pieces = pick_day_pieces(
            cluster=cluster,
            restaurants=restaurants,
            used=used,
            interest_cats=interest_cats,
            origin_lat=start_lat,
            origin_lng=start_lng,
            rng=rng,
            attraction_limit=limit,
            max_diameter_km=diameter,
            max_add_from_path_km=add_km,
            global_pool=fill_pool,
            avoid_coords=day_footprints,
        )

        for poi in pieces["attractions"]:
            coord = poi_coord(poi)
            if coord:
                day_footprints.append(coord)
        # Do NOT soft-claim other days' cluster members — that collapses day 2+.
        # Spatial separation uses avoid_coords / day_footprints only.

        # Time windows
        if day_i == 1:
            w_start = int(travel.get("day_start_min") or ATTRACTION_START)
        else:
            w_start = BREAKFAST_AT
        if day_i == days_n:
            w_end = last_day_end
        else:
            w_end = 21 * 60

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
            shared_hotel=bool(base_hotel) and days_n >= 2,
        )

        region_label = str(db_region or region).replace("_", " ").title()
        # Single outbound card (no separate 15-min "arrival" node)
        if travel.get("from_origin") and day_i == 1 and stops:
            depart_m = parse_hhmm(travel.get("depart_origin_at"), 8 * 60)
            out_m = int(travel.get("outbound_minutes") or 0)
            o_lat = float(travel.get("origin_lat") or start_lat)
            o_lng = float(travel.get("origin_lng") or start_lng)
            arrive_at = travel.get("arrive_region_at") or _minutes_to_hhmm(
                int(travel.get("day_start_min") or w_start)
            )
            dist = travel.get("distance_km")
            tip = f"Çatış ~{arrive_at}"
            if dist is not None:
                tip += f" · ~{dist} km"
            stops = [
                _travel_leg_stop(
                    name=f"Yola çıxış → {region_label}",
                    time_min=depart_m,
                    duration_min=max(out_m, 1),
                    lat=o_lat,
                    lng=o_lng,
                    daypart="travel_out",
                    tip=tip,
                ),
            ] + stops

        # Single return card (no separate 15-min "home arrival" node)
        if travel.get("from_origin") and day_i == days_n and stops:
            leave_m = parse_hhmm(travel.get("leave_region_by"), last_day_end)
            ret_m = int(travel.get("return_minutes") or 0)
            o_lat = float(travel.get("origin_lat") or start_lat)
            o_lng = float(travel.get("origin_lng") or start_lng)
            last_visit = stops[-1]
            last_t = parse_hhmm(str(last_visit.get("time") or ""), leave_m)
            last_dur = int(last_visit.get("duration_minutes") or 0)
            leave_m = max(leave_m, last_t + last_dur)
            home_at = travel.get("return_origin_by") or _minutes_to_hhmm(
                leave_m + max(ret_m, 0)
            )
            stops = stops + [
                _travel_leg_stop(
                    name="Geri dönüş → ev",
                    time_min=leave_m,
                    duration_min=max(ret_m, 1),
                    lat=start_lat,
                    lng=start_lng,
                    daypart="travel_return",
                    tip=f"Evə çatış ~{home_at}",
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

        # Meal/lodging are stop badges only — no footer fluff notes

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
        # Lodging appears as a stop in the day list — no duplicate banner notes
        lodging = {**public_poi_fields(base_hotel)}
        price_label = _format_nightly_price(base_hotel)
        if price_label:
            lodging["note"] = f"Gecələmə ({price_label})"

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
            "ordered_by": "interest_geo_compact_path",
            "allow_hotel": allow_hotel,
            "single_base_hotel": bool(base_hotel),
            "variety_seed": seed_val,
            "interest_cats": sorted(interest_cats),
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


def _claude_tip_mismatch(stop: dict[str, Any], tip: str) -> bool:
    """True if Claude tip clearly conflicts with stop role."""
    if not tip.strip():
        return True
    if _is_travel_stop(stop):
        return True
    if not sanitize_tip_text(tip):
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
    """Minimal copy — UI shows region/days/weather; avoid filler notes."""
    plan = dict(plan)
    # Compact title only; mobile renders chips (no long "hazırdır" blurb)
    plan["summary"] = f"{region_label} · {days} gün"
    plan["best_time"] = ""
    new_days = []
    for day in plan.get("days") or []:
        day = dict(day)
        notes = str(day.get("notes") or "").strip()
        # Keep only real travel timing; drop meal/lodging footer fluff
        keep = False
        if notes and (
            notes.startswith("Çıxış")
            or "Geri dönüş" in notes
            or "yola çıx" in notes.lower()
        ):
            # Strip meal/lodging sentences that may have been appended
            parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", notes) if p.strip()]
            kept = [
                p
                for p in parts
                if "nahar" not in p.lower()
                and "gecələmə" not in p.lower()
                and "geceleme" not in p.lower()
            ]
            notes = " ".join(kept).strip()
            keep = bool(notes)
        day["notes"] = notes if keep else ""
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            if _is_travel_stop(stop):
                tip = str(stop.get("tip") or "").strip()
                stop["tip"] = tip if tip.startswith("Çatış") or tip.startswith("Evə") else ""
            else:
                dp = str(stop.get("daypart") or "").lower()
                tip = sanitize_tip_text(str(stop.get("tip") or ""))
                if dp in {"lunch", "breakfast"}:
                    tip = ""
                elif dp == "hotel":
                    # Prefer structured price already on tip; else rebuild from fields
                    if tip and tip.startswith("(") and "gecə" in tip.lower():
                        pass
                    else:
                        tip = _hotel_tip(stop)
                stop["tip"] = tip
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
    api_key = ANTHROPIC_API_KEY
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

Cavab YALNIZ JSON (qısa — artıq mətn YAZMA):
{{
  "summary": "{region_label} · {days} gün",
  "best_time": "",
  "days": [
    {{
      "day": 1,
      "notes": "",
      "stops": [{{"poi_id": "…", "tip": "max 8 söz və ya boş"}}]
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
    # Keep compact title; ignore long Claude summary / best_time fluff
    plan["summary"] = f"{region_label} · {days} gün"
    plan["best_time"] = ""

    tip_days = {
        int(d.get("day")): d for d in (tips.get("days") or []) if d.get("day") is not None
    }
    merged_days = []
    for day in plan.get("days") or []:
        day = dict(day)
        tip_day = tip_days.get(int(day.get("day") or 0))
        # Do not replace skeleton travel notes with Claude filler
        tip_map = {
            str(s.get("poi_id")): str(s.get("tip") or "").strip()
            for s in (tip_day or {}).get("stops") or []
            if s.get("poi_id")
        }
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            if _is_travel_stop(stop):
                tip = str(stop.get("tip") or "").strip()
                stop["tip"] = tip if tip.startswith("Çatış") or tip.startswith("Evə") else ""
                stops.append(stop)
                continue
            pid = str(stop.get("poi_id") or "")
            tip = tip_map.get(pid) or ""
            dp = str(stop.get("daypart") or "").lower()
            existing = str(stop.get("tip") or "").strip()
            if dp in {"lunch", "breakfast"}:
                stop["tip"] = ""
            elif dp == "hotel":
                if existing.startswith("(") and "gecə" in existing.lower():
                    stop["tip"] = existing
                else:
                    stop["tip"] = _hotel_tip(stop)
            elif tip and not _claude_tip_mismatch(stop, tip) and len(tip.split()) <= 12:
                stop["tip"] = sanitize_tip_text(tip)
            elif existing and not any(
                x in existing.lower()
                for x in ("nahar", "səhər yemə", "gecələmə", "bütün gecələr")
            ):
                stop["tip"] = sanitize_tip_text(existing)
            else:
                stop["tip"] = ""
            if name_has_forbidden_script(str(stop.get("name") or "")):
                if dp not in {"lunch", "breakfast", "hotel"}:
                    stop["tip"] = ""
            stops.append(stop)
        day["stops"] = stops
        merged_days.append(day)
    plan["days"] = merged_days
    return plan
