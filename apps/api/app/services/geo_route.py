"""Haversine distance + nearest-neighbor / 2-opt tour order."""

from __future__ import annotations

import math
from typing import Any, Sequence

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in kilometers."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _coord(poi: dict[str, Any]) -> tuple[float, float] | None:
    try:
        lat = float(poi["lat"])
        lng = float(poi["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng):
        return None
    return lat, lng


def nearest_neighbor_order(
    pois: Sequence[dict[str, Any]],
    *,
    start_lat: float,
    start_lng: float,
) -> list[dict[str, Any]]:
    """Greedy NN from a start coordinate. Keeps original dict references."""
    remaining = [p for p in pois if _coord(p) is not None]
    if not remaining:
        return []

    ordered: list[dict[str, Any]] = []
    cur_lat, cur_lng = start_lat, start_lng

    while remaining:
        best_i = 0
        best_d = float("inf")
        for i, poi in enumerate(remaining):
            coord = _coord(poi)
            if coord is None:
                continue
            d = haversine_km(cur_lat, cur_lng, coord[0], coord[1])
            if d < best_d:
                best_d = d
                best_i = i
        nxt = remaining.pop(best_i)
        ordered.append(nxt)
        coord = _coord(nxt)
        if coord:
            cur_lat, cur_lng = coord

    return ordered


def tour_length_km(pois: Sequence[dict[str, Any]]) -> float:
    if len(pois) < 2:
        return 0.0
    total = 0.0
    for a, b in zip(pois, pois[1:]):
        ca, cb = _coord(a), _coord(b)
        if ca and cb:
            total += haversine_km(ca[0], ca[1], cb[0], cb[1])
    return total


def two_opt(pois: Sequence[dict[str, Any]], *, max_passes: int = 40) -> list[dict[str, Any]]:
    """Improve an open path with 2-opt (no return to start)."""
    route = list(pois)
    n = len(route)
    if n < 4:
        return route

    improved = True
    passes = 0
    while improved and passes < max_passes:
        improved = False
        passes += 1
        best = tour_length_km(route)
        for i in range(n - 1):
            for k in range(i + 2, n):
                # reverse segment (i+1 .. k)
                candidate = route[: i + 1] + list(reversed(route[i + 1 : k + 1])) + route[k + 1 :]
                length = tour_length_km(candidate)
                if length + 1e-9 < best:
                    route = candidate
                    best = length
                    improved = True
                    break
            if improved:
                break
    return route


def order_stops_geo(
    pois: Sequence[dict[str, Any]],
    *,
    start_lat: float,
    start_lng: float,
) -> list[dict[str, Any]]:
    """NN seed then 2-opt polish."""
    seed = nearest_neighbor_order(pois, start_lat=start_lat, start_lng=start_lng)
    return two_opt(seed)
