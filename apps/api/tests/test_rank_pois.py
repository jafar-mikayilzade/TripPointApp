"""Tests for app.services.rank_pois."""

from __future__ import annotations

from app.services.rank_pois import (
    bucket_route_candidates,
    mix_home_places,
    public_poi_fields,
    rating_sort_key,
    tourism_score,
)


def _poi(
    pid: str,
    *,
    category: str = "nature",
    rating: float | None = 4.5,
    count: int = 50,
) -> dict:
    return {
        "id": pid,
        "place_id": pid,
        "name": f"POI {pid}",
        "category": category,
        "lat": 40.4,
        "lng": 49.8,
        "rating": rating,
        "rating_count": count,
    }


class TestRatingSortKey:
    def test_higher_rating_first(self):
        high = _poi("a", rating=4.9)
        low = _poi("b", rating=3.0)
        assert rating_sort_key(high) > rating_sort_key(low)

    def test_null_rating_last(self):
        null = _poi("a", rating=None)
        rated = _poi("b", rating=3.0)
        assert rating_sort_key(rated) > rating_sort_key(null)

    def test_orders_descending(self):
        rows = [_poi("a", rating=3.0), _poi("b", rating=5.0), _poi("c", rating=4.0)]
        ordered = sorted(rows, key=rating_sort_key, reverse=True)
        assert [r["id"] for r in ordered] == ["b", "c", "a"]


class TestTourismScore:
    def test_waterfall_scores_above_cafe(self):
        wf = _poi("w", category="waterfall", rating=4.0)
        cafe = _poi("c", category="cafe", rating=4.0)
        assert tourism_score(wf) > tourism_score(cafe)

    def test_seed_boost(self):
        base = _poi("a", category="nature")
        seeded = {**base, "is_seed": True}
        assert tourism_score(seeded) > tourism_score(base)


class TestMixHomePlaces:
    def test_respects_limit(self):
        rows = [_poi(f"p{i}", category="nature") for i in range(20)]
        rows += [_poi(f"r{i}", category="restaurant") for i in range(10)]
        mixed = mix_home_places(rows, limit=10)
        assert len(mixed) <= 10

    def test_includes_multiple_categories(self):
        rows = [_poi(f"n{i}", category="nature") for i in range(5)]
        rows += [_poi(f"h{i}", category="hotel") for i in range(5)]
        rows += [_poi(f"r{i}", category="restaurant") for i in range(5)]
        mixed = mix_home_places(rows, limit=9)
        cats = {r["category"] for r in mixed}
        assert len(cats) >= 2


class TestBucketRouteCandidates:
    def test_returns_three_buckets(self):
        rows = [
            _poi("r1", category="restaurant"),
            _poi("h1", category="hotel"),
            _poi("a1", category="historical"),
        ]
        buckets = bucket_route_candidates(rows, per_bucket=5)
        assert "restaurants" in buckets
        assert "accommodations" in buckets
        assert "attractions" in buckets
        assert len(buckets["restaurants"]) == 1

    def test_interest_filter_prefers_matching(self):
        rows = [
            _poi("h1", category="historical"),
            _poi("n1", category="nature"),
        ]
        buckets = bucket_route_candidates(
            rows,
            per_bucket=2,
            prefer_attraction_cats={"historical"},
        )
        ids = [r["id"] for r in buckets["attractions"]]
        assert "h1" in ids


class TestPublicPoiFields:
    def test_strips_to_public_shape(self):
        row = {**_poi("x"), "internal_field": "secret"}
        pub = public_poi_fields(row)
        assert "internal_field" not in pub
        assert pub["id"] == "x"
        assert pub["name"] == "POI x"
