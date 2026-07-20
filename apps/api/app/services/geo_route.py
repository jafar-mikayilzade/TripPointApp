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


def poi_coord(poi: dict[str, Any]) -> tuple[float, float] | None:
    return _coord(poi)


def cluster_centroid(pois: Sequence[dict[str, Any]]) -> tuple[float, float] | None:
    coords = [c for p in pois if (c := _coord(p)) is not None]
    if not coords:
        return None
    lat = sum(c[0] for c in coords) / len(coords)
    lng = sum(c[1] for c in coords) / len(coords)
    return lat, lng


def nearest_poi_to_point(
    pois: Sequence[dict[str, Any]],
    *,
    lat: float,
    lng: float,
    exclude_ids: set[str] | None = None,
) -> dict[str, Any] | None:
    """Closest POI to a point (Haversine)."""
    exclude = exclude_ids or set()
    best: dict[str, Any] | None = None
    best_d = float("inf")
    for poi in pois:
        pid = str(poi.get("id") or "")
        if pid and pid in exclude:
            continue
        coord = _coord(poi)
        if coord is None:
            continue
        d = haversine_km(lat, lng, coord[0], coord[1])
        if d < best_d:
            best_d = d
            best = poi
    return best


def farthest_point_seeds(
    pois: Sequence[dict[str, Any]],
    *,
    k: int,
    origin_lat: float,
    origin_lng: float,
) -> list[dict[str, Any]]:
    """
    Pick k geographic day anchors.
    First seed: closest high-rated-ish point to region center (closest to origin).
    Next seeds: maximize min distance to already chosen seeds.
    """
    candidates = [p for p in pois if _coord(p) is not None]
    if not candidates or k <= 0:
        return []
    k = min(k, len(candidates))

    # First: nearest to region center
    first = nearest_poi_to_point(candidates, lat=origin_lat, lng=origin_lng)
    if first is None:
        return []
    seeds: list[dict[str, Any]] = [first]
    seed_ids = {str(first.get("id") or "")}

    while len(seeds) < k:
        best_poi: dict[str, Any] | None = None
        best_score = -1.0
        for poi in candidates:
            pid = str(poi.get("id") or "")
            if pid in seed_ids:
                continue
            coord = _coord(poi)
            if coord is None:
                continue
            min_d = float("inf")
            for s in seeds:
                sc = _coord(s)
                if sc is None:
                    continue
                min_d = min(min_d, haversine_km(coord[0], coord[1], sc[0], sc[1]))
            if min_d == float("inf"):
                continue
            if min_d > best_score:
                best_score = min_d
                best_poi = poi
        if best_poi is None:
            break
        seeds.append(best_poi)
        seed_ids.add(str(best_poi.get("id") or ""))

    return seeds


def assign_to_nearest_seed(
    pois: Sequence[dict[str, Any]],
    seeds: Sequence[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    """Assign each POI to nearest seed → one cluster per seed."""
    clusters: list[list[dict[str, Any]]] = [[] for _ in seeds]
    seed_coords = [_coord(s) for s in seeds]
    for poi in pois:
        coord = _coord(poi)
        if coord is None:
            continue
        best_i = 0
        best_d = float("inf")
        for i, sc in enumerate(seed_coords):
            if sc is None:
                continue
            d = haversine_km(coord[0], coord[1], sc[0], sc[1])
            if d < best_d:
                best_d = d
                best_i = i
        clusters[best_i].append(poi)
    return clusters


def rebalance_clusters(
    clusters: list[list[dict[str, Any]]],
    *,
    min_size: int = 2,
) -> list[list[dict[str, Any]]]:
    """
    Move POIs from largest cluster into empty/tiny clusters so each day has something.
    """
    if not clusters:
        return clusters
    clusters = [list(c) for c in clusters]

    def size(i: int) -> int:
        return len(clusters[i])

    # Fill empty / tiny from largest
    for i in range(len(clusters)):
        while size(i) < min_size:
            donor = max(range(len(clusters)), key=size)
            if donor == i or size(donor) <= min_size:
                break
            # move farthest-from-donor-centroid point (or just last) to needy cluster
            donor_c = cluster_centroid(clusters[donor])
            if not donor_c or not clusters[donor]:
                break
            # pick point in donor farthest from donor centroid (edge of big cluster)
            move_i = 0
            move_d = -1.0
            for j, poi in enumerate(clusters[donor]):
                coord = _coord(poi)
                if coord is None:
                    continue
                d = haversine_km(donor_c[0], donor_c[1], coord[0], coord[1])
                if d > move_d:
                    move_d = d
                    move_i = j
            clusters[i].append(clusters[donor].pop(move_i))

    return clusters


def order_clusters_from_origin(
    clusters: list[list[dict[str, Any]]],
    *,
    origin_lat: float,
    origin_lng: float,
) -> list[list[dict[str, Any]]]:
    """Order day clusters by centroid distance from region center (near → far)."""
    indexed: list[tuple[float, int, list[dict[str, Any]]]] = []
    for i, cluster in enumerate(clusters):
        c = cluster_centroid(cluster)
        if c is None:
            dist = float("inf")
        else:
            dist = haversine_km(origin_lat, origin_lng, c[0], c[1])
        indexed.append((dist, i, cluster))
    indexed.sort(key=lambda t: (t[0], t[1]))
    return [t[2] for t in indexed]


def build_day_clusters(
    attractions: Sequence[dict[str, Any]],
    *,
    days: int,
    origin_lat: float,
    origin_lng: float,
) -> list[list[dict[str, Any]]]:
    """
    Farthest-point seeds + nearest assignment + rebalance + near→far day order.
    Returns up to `days` non-empty clusters when possible.
    """
    usable = [p for p in attractions if _coord(p) is not None]
    if not usable:
        return [[] for _ in range(max(1, days))]

    k = max(1, min(days, len(usable)))
    seeds = farthest_point_seeds(
        usable, k=k, origin_lat=origin_lat, origin_lng=origin_lng
    )
    if not seeds:
        return [list(usable)]

    clusters = assign_to_nearest_seed(usable, seeds)
    # Ensure we have exactly len(seeds) clusters; pad if days > seeds (shouldn't)
    while len(clusters) < days and len(usable) > len(clusters):
        clusters.append([])

    min_size = 1 if len(usable) < days * 2 else 2
    clusters = rebalance_clusters(clusters, min_size=min_size)
    clusters = order_clusters_from_origin(
        clusters, origin_lat=origin_lat, origin_lng=origin_lng
    )

    # Trim / pad to requested days
    if len(clusters) > days:
        # merge overflow into last kept day
        kept = clusters[:days]
        for extra in clusters[days:]:
            kept[-1].extend(extra)
        clusters = kept
    while len(clusters) < days:
        clusters.append([])

    return clusters
