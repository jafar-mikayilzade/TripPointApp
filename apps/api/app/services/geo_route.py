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
    """Improve an open path with 2-opt (no return to start). Works for n >= 3."""
    route = list(pois)
    n = len(route)
    if n < 3:
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


def insert_poi_at(path: Sequence[dict[str, Any]], poi: dict[str, Any], index: int) -> list[dict[str, Any]]:
    route = list(path)
    idx = max(0, min(index, len(route)))
    route.insert(idx, poi)
    return route


def best_insertion_index(
    path: Sequence[dict[str, Any]],
    poi: dict[str, Any],
    *,
    index_min: int = 0,
    index_max: int | None = None,
) -> tuple[int, float]:
    """
    Index in [0..len(path)] that yields the shortest open path after inserting poi.
    Returns (index, tour_length_km).
    """
    if _coord(poi) is None:
        return 0, tour_length_km(path)
    hi = len(path) if index_max is None else min(index_max, len(path))
    lo = max(0, index_min)
    if lo > hi:
        lo, hi = 0, len(path)

    best_i = lo
    best_len = float("inf")
    for i in range(lo, hi + 1):
        length = tour_length_km(insert_poi_at(path, poi, i))
        if length < best_len:
            best_len = length
            best_i = i
    return best_i, best_len


def pick_poi_min_insert(
    path: Sequence[dict[str, Any]],
    candidates: Sequence[dict[str, Any]],
    *,
    exclude_ids: set[str] | None = None,
    max_km_from_path: float = 10.0,
    index_min: int = 0,
    index_max: int | None = None,
) -> tuple[dict[str, Any] | None, int]:
    """
    Pick candidate whose best insertion into path yields the shortest tour,
    skipping points farther than max_km_from_path from every path stop (and centroid).
    """
    exclude = exclude_ids or set()
    if not path:
        # Fall back: nearest to nothing — first usable candidate
        for poi in candidates:
            pid = str(poi.get("id") or "")
            if pid and pid in exclude:
                continue
            if _coord(poi) is not None:
                return poi, 0
        return None, 0

    path_coords = [c for p in path if (c := _coord(p)) is not None]
    if not path_coords:
        return None, 0

    best_poi: dict[str, Any] | None = None
    best_idx = 0
    best_len = float("inf")

    for poi in candidates:
        pid = str(poi.get("id") or "")
        if pid and pid in exclude:
            continue
        coord = _coord(poi)
        if coord is None:
            continue
        min_d = min(haversine_km(coord[0], coord[1], pc[0], pc[1]) for pc in path_coords)
        if min_d > max_km_from_path:
            continue
        idx, length = best_insertion_index(
            path, poi, index_min=index_min, index_max=index_max
        )
        if length < best_len:
            best_len = length
            best_poi = poi
            best_idx = idx

    return best_poi, best_idx


def grow_compact_tour(
    pool: Sequence[dict[str, Any]],
    *,
    origin_lat: float,
    origin_lng: float,
    used: set[str] | None = None,
    limit: int = 4,
    max_diameter_km: float = 8.0,
    max_add_from_path_km: float = 3.5,
    prefer_categories: set[str] | None = None,
    rng: Any | None = None,
) -> list[dict[str, Any]]:
    """
    Build a short open-path day set: seed near origin, then repeatedly add the POI
    that least increases tour_length_km while staying close to the existing path.

    Interest categories win over pure geography when enough matches exist.
    Optional rng: among near-tied candidates, pick randomly for replan variety.
    """
    exclude = set(used or set())
    candidates = [
        p
        for p in pool
        if _coord(p) is not None and str(p.get("id") or "") not in exclude
    ]
    if not candidates or limit <= 0:
        return []

    preferred = [
        p
        for p in candidates
        if not prefer_categories
        or str(p.get("category") or "") in prefer_categories
    ]
    # Prefer interest pool for seeding; only fall back if empty
    seed_pool = preferred if preferred else candidates

    def seed_key(p: dict[str, Any]) -> tuple[float, float]:
        c = _coord(p)
        assert c is not None
        d = haversine_km(origin_lat, origin_lng, c[0], c[1])
        rating = float(p.get("rating") or 0)
        return (d, -rating)

    ranked_seeds = sorted(seed_pool, key=seed_key)
    if rng is not None and len(ranked_seeds) > 1:
        top = ranked_seeds[: min(3, len(ranked_seeds))]
        seed = rng.choice(top)
    else:
        seed = ranked_seeds[0]
    chosen: list[dict[str, Any]] = [seed]
    chosen_ids = {str(seed.get("id") or "")}

    while len(chosen) < limit:
        scored: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
        base_len = tour_length_km(order_stops_geo(chosen)) if len(chosen) > 1 else 0.0
        chosen_coords = [_coord(p) for p in chosen if _coord(p)]

        # First pass: interest matches only (if any remain nearby)
        search_pools = [preferred, candidates] if preferred else [candidates]
        for pool_i, search in enumerate(search_pools):
            for poi in search:
                pid = str(poi.get("id") or "")
                if not pid or pid in chosen_ids:
                    continue
                coord = _coord(poi)
                if coord is None:
                    continue
                min_d = min(
                    haversine_km(coord[0], coord[1], c[0], c[1])
                    for c in chosen_coords
                    if c
                )
                if min_d > max_add_from_path_km:
                    continue
                trial = chosen + [poi]
                if cluster_diameter_km(trial) > max_diameter_km:
                    continue
                ordered = order_stops_geo(trial)
                length = tour_length_km(ordered)
                growth = length - base_len
                rating = float(poi.get("rating") or 0)
                interest_miss = (
                    0
                    if (
                        not prefer_categories
                        or str(poi.get("category") or "") in prefer_categories
                    )
                    else 1
                )
                # Interest match first, then compact geography
                score = (interest_miss, growth, min_d, -rating)
                scored.append((score, poi))

            if scored and pool_i == 0:
                # Found interest-matching neighbours — do not fall back yet
                break

        if not scored:
            break

        scored.sort(key=lambda t: t[0])
        if rng is not None and len(scored) > 1:
            # Random among top-3 near-ties for variety
            best_score = scored[0][0]
            near = [
                p
                for s, p in scored[:5]
                if s[0] == best_score[0] and abs(float(s[1]) - float(best_score[1])) < 1.5
            ]
            best = rng.choice(near) if near else scored[0][1]
        else:
            best = scored[0][1]

        chosen.append(best)
        chosen_ids.add(str(best.get("id") or ""))

    return order_stops_geo(chosen)


def insertion_detour_km(
    path: Sequence[dict[str, Any]],
    poi: dict[str, Any],
    index: int,
) -> float:
    """How many km the open path grows when poi is inserted at index."""
    before = tour_length_km(path)
    after = tour_length_km(insert_poi_at(path, poi, index))
    return max(0.0, after - before)


def poi_coord(poi: dict[str, Any]) -> tuple[float, float] | None:
    return _coord(poi)


def cluster_centroid(pois: Sequence[dict[str, Any]]) -> tuple[float, float] | None:
    coords = [c for p in pois if (c := _coord(p)) is not None]
    if not coords:
        return None
    lat = sum(c[0] for c in coords) / len(coords)
    lng = sum(c[1] for c in coords) / len(coords)
    return lat, lng


def _extreme_points(pois: Sequence[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    """Points farthest from centroid — good open-TSP start candidates."""
    usable = [p for p in pois if _coord(p) is not None]
    if not usable:
        return []
    c = cluster_centroid(usable)
    if c is None:
        return usable[:limit]
    ranked = sorted(
        usable,
        key=lambda p: haversine_km(c[0], c[1], *(_coord(p) or c)),
        reverse=True,
    )
    return ranked[:limit]


def order_stops_geo(
    pois: Sequence[dict[str, Any]],
    *,
    start_lat: float | None = None,
    start_lng: float | None = None,
) -> list[dict[str, Any]]:
    """
    Open-path tour: try several NN starts (each POI as start + extremes + optional
    external hint), 2-opt each, keep shortest tour_length_km.
    """
    usable = [p for p in pois if _coord(p) is not None]
    if len(usable) <= 1:
        return list(usable)

    start_coords: list[tuple[float, float]] = []
    seen: set[tuple[float, float]] = set()

    def _add(lat: float, lng: float) -> None:
        key = (round(lat, 5), round(lng, 5))
        if key not in seen:
            seen.add(key)
            start_coords.append((lat, lng))

    # Start from each stop itself (critical for 1-day open TSP)
    for p in usable:
        coord = _coord(p)
        if coord:
            _add(coord[0], coord[1])

    for p in _extreme_points(usable, 3):
        coord = _coord(p)
        if coord:
            _add(coord[0], coord[1])

    c = cluster_centroid(usable)
    if c:
        _add(c[0], c[1])
    if start_lat is not None and start_lng is not None:
        _add(start_lat, start_lng)

    best: list[dict[str, Any]] | None = None
    best_len = float("inf")
    for lat, lng in start_coords:
        route = two_opt(nearest_neighbor_order(usable, start_lat=lat, start_lng=lng))
        length = tour_length_km(route)
        if length < best_len:
            best_len = length
            best = route

    return best if best is not None else list(usable)


def cluster_diameter_km(pois: Sequence[dict[str, Any]]) -> float:
    coords = [_coord(p) for p in pois if _coord(p) is not None]
    if len(coords) < 2:
        return 0.0
    best = 0.0
    for i, a in enumerate(coords):
        assert a is not None
        for b in coords[i + 1 :]:
            assert b is not None
            best = max(best, haversine_km(a[0], a[1], b[0], b[1]))
    return best


def trim_cluster_diameter(
    cluster: Sequence[dict[str, Any]],
    *,
    max_diameter_km: float = 25.0,
) -> list[dict[str, Any]]:
    """Keep core around centroid if cluster is too spread out."""
    pois = [p for p in cluster if _coord(p) is not None]
    if len(pois) <= 2 or cluster_diameter_km(pois) <= max_diameter_km:
        return list(pois)
    c = cluster_centroid(pois)
    if c is None:
        return list(pois)
    ranked = sorted(
        pois,
        key=lambda p: haversine_km(c[0], c[1], *(_coord(p) or c)),
    )
    kept: list[dict[str, Any]] = []
    for p in ranked:
        trial = kept + [p]
        if len(trial) <= 2 or cluster_diameter_km(trial) <= max_diameter_km:
            kept.append(p)
    return kept or ranked[:2]


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
    Steal from rich days into thin ones so middle days are not left with 1 POI.
    Donor must stay above min_size after the move.
    """
    if not clusters:
        return clusters
    clusters = [list(c) for c in clusters]

    def size(i: int) -> int:
        return len(clusters[i])

    # Multiple passes — keep filling until no donor can give
    for _ in range(max(8, len(clusters) * 3)):
        needy = [i for i in range(len(clusters)) if size(i) < min_size]
        if not needy:
            break
        progressed = False
        for i in needy:
            donor = max(range(len(clusters)), key=size)
            if donor == i or size(donor) <= min_size:
                continue
            donor_c = cluster_centroid(clusters[donor])
            if not donor_c or not clusters[donor]:
                continue
            scored: list[tuple[float, int]] = []
            for j, poi in enumerate(clusters[donor]):
                coord = _coord(poi)
                if coord is None:
                    continue
                d = haversine_km(donor_c[0], donor_c[1], coord[0], coord[1])
                scored.append((d, j))
            if not scored:
                continue
            scored.sort(key=lambda t: t[0])
            # Prefer a mid-distance point (not the farthest outlier)
            move_i = scored[len(scored) // 2][1]
            clusters[i].append(clusters[donor].pop(move_i))
            progressed = True
        if not progressed:
            break

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

    clusters = rebalance_clusters(clusters, min_size=2)
    clusters = [
        trim_cluster_diameter(c, max_diameter_km=25.0) if c else [] for c in clusters
    ]
    clusters = order_clusters_from_origin(
        clusters, origin_lat=origin_lat, origin_lng=origin_lng
    )

    if len(clusters) > days:
        kept = clusters[:days]
        for extra in clusters[days:]:
            kept[-1].extend(extra)
        clusters = kept
    while len(clusters) < days:
        clusters.append([])

    return clusters
