"""Tests for app.services.geo_route — core routing / clustering logic."""

from __future__ import annotations

from typing import Any

import pytest

from app.services.geo_route import (
    build_day_clusters,
    cluster_member_ids,
    filter_pois_clear_of,
    haversine_km,
    nearest_neighbor_order,
    split_tour_at_largest_gaps,
    tour_length_km,
    two_opt,
)


class TestHaversine:
    def test_same_point_is_zero(self):
        assert haversine_km(40.4, 49.8, 40.4, 49.8) == 0.0

    def test_known_approximate_distance(self):
        # ~0.1° longitude at lat 40° ≈ 8.5 km
        d = haversine_km(40.4093, 49.8671, 40.4093, 49.9671)
        assert 7.0 < d < 10.0

    def test_symmetry(self):
        a = haversine_km(40.1, 49.1, 41.2, 50.3)
        b = haversine_km(41.2, 50.3, 40.1, 49.1)
        assert abs(a - b) < 0.001


class TestNearestNeighbor:
    def test_visits_all_pois(self, sample_pois: list[dict[str, Any]]):
        ordered = nearest_neighbor_order(
            sample_pois, start_lat=40.4, start_lng=49.8
        )
        assert len(ordered) == len(sample_pois)
        assert {p["id"] for p in ordered} == {p["id"] for p in sample_pois}

    def test_empty_input(self):
        assert nearest_neighbor_order([], start_lat=40.0, start_lng=49.0) == []

    def test_skips_invalid_coords(self):
        pois = [
            {"id": "ok", "lat": 40.4, "lng": 49.8},
            {"id": "bad", "lat": "nope"},
        ]
        ordered = nearest_neighbor_order(pois, start_lat=40.4, start_lng=49.8)
        assert len(ordered) == 1
        assert ordered[0]["id"] == "ok"


class TestTwoOpt:
    def test_does_not_increase_tour_length(self, sample_pois: list[dict[str, Any]]):
        nn = nearest_neighbor_order(sample_pois, start_lat=40.4, start_lng=49.8)
        improved = two_opt(nn)
        assert tour_length_km(improved) <= tour_length_km(nn) + 0.01


class TestSplitTourAtLargestGaps:
    def test_single_day_returns_whole_tour(self, line_tour_pois: list[dict[str, Any]]):
        clusters = split_tour_at_largest_gaps(line_tour_pois, days=1)
        assert len(clusters) == 1
        assert len(clusters[0]) == len(line_tour_pois)

    def test_two_days_split_at_largest_gap(self, line_tour_pois: list[dict[str, Any]]):
        clusters = split_tour_at_largest_gaps(line_tour_pois, days=2)
        assert len(clusters) == 2
        south_ids = {p["id"] for p in clusters[0]}
        north_ids = {p["id"] for p in clusters[1]}
        assert "a1" in south_ids or "a1" in north_ids
        assert south_ids.isdisjoint(north_ids)
        assert len(south_ids) + len(north_ids) == len(line_tour_pois)

    def test_more_days_than_pois(self):
        pois = [{"id": "x", "lat": 40.4, "lng": 49.8}]
        clusters = split_tour_at_largest_gaps(pois, days=3)
        assert len(clusters) == 3
        assert sum(len(c) for c in clusters) == 1

    def test_empty_tour(self):
        clusters = split_tour_at_largest_gaps([], days=2)
        assert len(clusters) == 2
        assert all(len(c) == 0 for c in clusters)


class TestBuildDayClusters:
    def test_no_poi_overlap_between_days(self, sample_pois: list[dict[str, Any]]):
        for days in (2, 3, 4):
            clusters = build_day_clusters(
                sample_pois,
                days=days,
                origin_lat=40.4,
                origin_lng=49.8,
            )
            assert len(clusters) == days
            ids = cluster_member_ids(clusters)
            flat = [pid for s in ids for pid in s]
            assert len(flat) == len(set(flat)), f"overlap at days={days}"

    def test_returns_empty_clusters_for_no_pois(self):
        clusters = build_day_clusters([], days=3, origin_lat=40.4, origin_lng=49.8)
        assert len(clusters) == 3
        assert all(len(c) == 0 for c in clusters)


class TestFilterPoisClearOf:
    def test_excludes_nearby_pois(self):
        pois = [
            {"id": "near", "lat": 40.40, "lng": 49.80},
            {"id": "far", "lat": 40.60, "lng": 49.80},
        ]
        footprint = [(40.40, 49.80)]
        clear = filter_pois_clear_of(
            pois, footprint, min_clearance_km=5.0, soft_fallback=False
        )
        ids = {p["id"] for p in clear}
        assert "far" in ids
        assert "near" not in ids

    def test_soft_fallback_keeps_something(self):
        pois = [{"id": "only", "lat": 40.40, "lng": 49.80}]
        footprint = [(40.40, 49.80)]
        clear = filter_pois_clear_of(
            pois, footprint, min_clearance_km=50.0, soft_fallback=True
        )
        assert len(clear) >= 1
