"""Outbound/return drive windows for day-trip planning from a home origin (e.g. Baku)."""

from __future__ import annotations

from typing import Any

from app.services.geo_route import haversine_km

# Rural Azerbaijan driving average + buffer for traffic/breaks
AVG_SPEED_KMH = 55.0
DRIVE_BUFFER_MIN = 20
# Treat origin as "elsewhere" if farther than this from region center
ELSEWHERE_MIN_KM = 35.0


def parse_hhmm(value: str | None, default_min: int) -> int:
    if not value or not isinstance(value, str):
        return default_min
    parts = value.strip().split(":")
    if len(parts) != 2:
        return default_min
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError:
        return default_min
    if not (0 <= h < 24 and 0 <= m < 60):
        return default_min
    return h * 60 + m


def minutes_to_hhmm(total_minutes: int) -> str:
    total_minutes = int(total_minutes) % (24 * 60)
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def estimate_drive_minutes(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> int:
    km = haversine_km(lat1, lng1, lat2, lng2)
    return max(25, int(round(km / AVG_SPEED_KMH * 60)) + DRIVE_BUFFER_MIN)


def build_travel_context(
    *,
    origin_lat: float | None,
    origin_lng: float | None,
    region_lat: float,
    region_lng: float,
    days: int,
    depart_time: str | None = "08:00",
    return_by_time: str | None = "21:00",
    from_origin: bool = False,
) -> dict[str, Any]:
    """
    Compute outbound/return windows.
    1-day: visit window = [arrive_region, leave_region]; no overnight.
    2+ days: day1 starts at arrive; last day ends by leave_region; hotel nights allowed.
    """
    days_n = max(1, int(days))
    depart_min = parse_hhmm(depart_time, 8 * 60)
    return_by_min = parse_hhmm(return_by_time, 21 * 60)

    ctx: dict[str, Any] = {
        "from_origin": False,
        "outbound_minutes": 0,
        "return_minutes": 0,
        "depart_origin_at": None,
        "arrive_region_at": None,
        "leave_region_by": None,
        "return_origin_by": None,
        "day_start_min": 9 * 60 + 30,  # default local start
        "day_end_min": 19 * 60,
        "allow_hotel": days_n >= 2,
    }

    if (
        not from_origin
        or origin_lat is None
        or origin_lng is None
    ):
        return ctx

    dist = haversine_km(origin_lat, origin_lng, region_lat, region_lng)
    if dist < ELSEWHERE_MIN_KM:
        # Already in/near region — no long transfer
        return ctx

    outbound = estimate_drive_minutes(origin_lat, origin_lng, region_lat, region_lng)
    ret = outbound  # symmetric estimate
    arrive = depart_min + outbound
    leave_region = return_by_min - ret

    # Keep a usable visit window (at least ~3h)
    if leave_region - arrive < 180:
        # Push depart earlier conceptually: shrink return buffer
        leave_region = arrive + 180
        if leave_region > return_by_min - 60:
            leave_region = return_by_min - 60

    ctx.update(
        {
            "from_origin": True,
            "outbound_minutes": outbound,
            "return_minutes": ret,
            "depart_origin_at": minutes_to_hhmm(depart_min),
            "arrive_region_at": minutes_to_hhmm(arrive),
            "leave_region_by": minutes_to_hhmm(leave_region),
            "return_origin_by": minutes_to_hhmm(return_by_min),
            "day_start_min": arrive,
            "day_end_min": leave_region if days_n == 1 else 19 * 60,
            "last_day_end_min": leave_region,
            "allow_hotel": days_n >= 2,
            "origin_lat": origin_lat,
            "origin_lng": origin_lng,
            "distance_km": round(dist, 1),
        }
    )
    return ctx
