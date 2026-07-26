"""Build multi-day itinerary with geo clusters, daypart slots, Claude tips only."""

from __future__ import annotations

import json
import logging
import os
import random
import re
import time
from typing import Any

import requests

from app.constants.regions import REGION_COORDINATES, REGION_DB_ID
from app.services.attraction_classify import (
    INTEREST_ATTRACTION_CATS,
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
    tour_length_km,
    trim_cluster_diameter,
)
from app.services.rank_pois import (
    prefer_high_rated,
    public_poi_fields,
    rating_sort_key,
)
from app.services.places_tourism_filter import (
    name_has_forbidden_script,
    sanitize_tip_text,
)

logger = logging.getLogger(__name__)

DURATION_MINUTES: dict[str, int] = {
    "restaurant": 60,
    "home_restaurant": 60,
    "cafe": 40,
    "hotel": 25,
    "hostel": 25,
    "guesthouse": 25,
    # Denser day packing — still realistic visit windows
    "nature": 75,
    "waterfall": 60,
    "mountain": 75,
    "lake": 60,
    "historical": 55,
    "monument": 35,
    "other": 45,
}

FOOD_CATS = frozenset({"restaurant", "home_restaurant", "cafe"})
HOTEL_CATS = frozenset({"hotel", "hostel", "guesthouse"})
NATURE_CATS = frozenset({"nature", "waterfall", "mountain", "lake"})
HISTORICAL_CATS = frozenset({"historical", "monument"})

MAX_RESTAURANT_KM = 10.0
ATTRACTIONS_PER_DAY = 5
# Full (middle) days pack denser; travel days still aim for a full walk day
ATTRACTIONS_PER_FULL_DAY = 6
ATTRACTIONS_PER_TRAVEL_DAY = 5
MAX_DAY_DIAMETER_KM = 12.0
MAX_ADD_FROM_PATH_KM = 5.0
# Compact day bubbles — multi-day must not sprawl into another day's zone
FULL_DAY_DIAMETER_KM = 14.0
FULL_DAY_ADD_FROM_PATH_KM = 5.0
TRAVEL_DAY_DIAMETER_KM = 12.0
TRAVEL_DAY_ADD_FROM_PATH_KM = 4.5
# Later days stay clear of earlier days' visited area
DAY_FOOTPRINT_CLEARANCE_KM = 4.0
# Food/hotel only if they barely bend the path
MAX_FOOD_DETOUR_KM = 2.0
MAX_HOTEL_FROM_PATH_END_KM = 8.0

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
    pool = fresh if len(fresh) >= 4 else classified

    if not interest_cats:
        rng.shuffle(pool)
        return pool

    preferred = [
        p for p in pool if str(p.get("category") or "") in interest_cats
    ]
    others = [
        p for p in pool if str(p.get("category") or "") not in interest_cats
    ]
    rng.shuffle(preferred)
    rng.shuffle(others)

    if len(preferred) >= 3:
        # Keep a thin filler so geo corridors still work
        filler = others[: max(2, len(preferred) // 4)]
        return preferred + filler
    return preferred + others


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
) -> list[dict[str, Any]]:
    """
    Keep tour-segment order (contiguous geography). Never cherry-pick
    non-contiguous POIs from the segment — that recreates day zigzags.
    """
    available = [
        p
        for p in cluster
        if poi_coord(p) is not None and str(p.get("id") or "") not in used
    ]
    if not available or limit <= 0:
        return []

    if prefer_categories:
        chosen: list[dict[str, Any]] = []
        for p in available:
            if len(chosen) >= limit:
                break
            if str(p.get("category") or "") in prefer_categories:
                chosen.append(p)
        if len(chosen) < min(2, limit):
            # Not enough interest hits — fall back to contiguous prefix
            return available[:limit]
        if len(chosen) < limit:
            chosen_ids = {str(p.get("id") or "") for p in chosen}
            for p in available:
                if len(chosen) >= limit:
                    break
                pid = str(p.get("id") or "")
                if pid not in chosen_ids:
                    chosen.append(p)
        order = {str(p.get("id") or ""): i for i, p in enumerate(available)}
        chosen.sort(key=lambda p: order.get(str(p.get("id") or ""), 10**9))
        return chosen

    return available[:limit]


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
    del rng
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
    )
    if interest_cats and len(attractions) < min(2, limit):
        attractions = _take_along_tour(
            cluster,
            used=used,
            limit=limit,
            prefer_categories=None,
        )

    # Empty/thin segment only — never raid another day's neighbourhood
    if pool and len(attractions) < min(2, limit):
        already = {str(p.get("id") or "") for p in attractions}
        fill_used = set(used) | already
        seed_lat, seed_lng = _seed_away_from_footprint(
            pool,
            footprint,
            fallback_lat=origin_lat,
            fallback_lng=origin_lng,
        )
        extra = grow_compact_tour(
            pool,
            origin_lat=seed_lat,
            origin_lng=seed_lng,
            used=fill_used,
            limit=limit - len(attractions),
            max_diameter_km=diameter,
            max_add_from_path_km=add_km,
            prefer_categories=interest_cats or None,
            rng=None,
        )
        attractions = attractions + extra

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
    end_anchor = window_end_min if window_end_min is not None else 20 * 60 + 30
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
        # Short transfer buffer so more stops fit a normal day window
        t = time_min + dur + 15
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
) -> dict[str, Any]:
    from app.services.travel_window import build_travel_context, parse_hhmm

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
    attractions = apply_weather_filter(list(attractions), weather)

    restaurants = sorted(restaurants, key=rating_sort_key, reverse=True)
    accommodations = sorted(accommodations, key=rating_sort_key, reverse=True)

    interest_cats = _interest_sets(interests)
    exclude = {str(x) for x in (exclude_poi_ids or []) if str(x).strip()}
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
                    if str(p.get("category") or "") in interest_cats
                ]
                rest = [
                    p
                    for p in leftovers
                    if str(p.get("category") or "") not in interest_cats
                ]
                leftovers = pref + rest
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
                    max_diameter_km=diameter,
                    max_add_from_path_km=add_km,
                    prefer_categories=interest_cats or None,
                    rng=rng,
                )

        # Tour segments are exclusive — do not top up from other days' POIs.
        # Only unassigned leftovers (not in any cluster) may fill a thin day.
        owned_elsewhere = foreign_ids
        unassigned = [
            p
            for p in attractions
            if str(p.get("id") or "") not in used
            and str(p.get("id") or "") not in owned_elsewhere
            and str(p.get("id") or "")
            not in (cluster_ids[day_i - 1] if day_i - 1 < len(cluster_ids) else set())
        ]
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
            global_pool=unassigned if len(cluster) < 2 else [],
            avoid_coords=day_footprints,
        )

        for poi in pieces["attractions"]:
            coord = poi_coord(poi)
            if coord:
                day_footprints.append(coord)
        # Soft-claim unused neighbours of this day's stops so the next day
        # cannot park 50m from yesterday's last café
        if pieces["attractions"]:
            for p in attractions:
                pid = str(p.get("id") or "")
                if not pid or pid in used:
                    continue
                if min_km_to_coords(p, day_footprints[-len(pieces["attractions"]) :]) < (
                    DAY_FOOTPRINT_CLEARANCE_KM * 0.75
                ):
                    used.add(pid)

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

    # Food / generic tips — empty (UI shows time + duration only)
    if cat in FOOD_CATS or daypart in {"breakfast", "lunch"}:
        return ""

    if cat in NATURE_CATS or cat in HISTORICAL_CATS:
        return ""

    return ""


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
        # Keep only real travel timing notes from skeleton; drop template fluff
        notes = str(day.get("notes") or "").strip()
        if (
            not notes
            or "Səhər →" in notes
            or notes.startswith("Gecələmə:")
            or "gəzinti → nahar" in notes.lower()
        ):
            # Preserve outbound/return timing if present
            if "Çıxış" in notes or "Geri dönüş" in notes or "yola çıx" in notes.lower():
                day["notes"] = notes
            else:
                day["notes"] = ""
        else:
            day["notes"] = notes
        stops = []
        for stop in day.get("stops") or []:
            stop = dict(stop)
            if _is_travel_stop(stop):
                # Keep short travel tip (arrive time); drop fluff
                tip = str(stop.get("tip") or "").strip()
                stop["tip"] = tip if tip.startswith("Çatış") or tip.startswith("Evə") else ""
            elif not (stop.get("tip") or "").strip():
                stop["tip"] = ""
            else:
                stop["tip"] = sanitize_tip_text(str(stop.get("tip") or ""))
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
            if tip and not _claude_tip_mismatch(stop, tip) and len(tip.split()) <= 12:
                stop["tip"] = sanitize_tip_text(tip)
            else:
                stop["tip"] = ""
            if name_has_forbidden_script(str(stop.get("name") or "")):
                stop["tip"] = ""
            stops.append(stop)
        day["stops"] = stops
        merged_days.append(day)
    plan["days"] = merged_days
    return plan
