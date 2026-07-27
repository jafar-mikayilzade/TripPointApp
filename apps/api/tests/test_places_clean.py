"""Tests for app.services.places_clean."""

from __future__ import annotations

from app.services.places_clean import (
    category_from_osm_tags,
    clean_place,
    resolve_db_category,
    to_db_region,
)


class TestCategoryFromOsmTags:
    def test_restaurant(self):
        assert category_from_osm_tags({"amenity": "restaurant"}) == "restaurant"

    def test_waterfall(self):
        assert category_from_osm_tags({"waterway": "waterfall"}) == "waterfall"

    def test_historical_museum(self):
        assert category_from_osm_tags({"tourism": "museum"}) == "historical"

    def test_monument(self):
        assert category_from_osm_tags({"historic": "monument"}) == "monument"

    def test_unknown_returns_other(self):
        assert category_from_osm_tags({}) == "other"

    def test_cafe_ignored_category_still_maps(self):
        assert category_from_osm_tags({"amenity": "cafe"}) == "cafe"


class TestResolveDbCategory:
    def test_all_keeps_osm_category(self):
        place = {"category": "waterfall"}
        assert resolve_db_category(place, "all") == "waterfall"

    def test_specific_filter_overrides(self):
        place = {"category": "nature"}
        assert resolve_db_category(place, "hotel") == "hotel"


class TestCleanPlace:
    def test_valid_google_shape(self):
        place = {
            "place_id": "ChIJ123",
            "name": "Test POI",
            "geometry": {"location": {"lat": 40.4, "lng": 49.8}},
            "rating": 4.5,
            "user_ratings_total": 120,
        }
        row = clean_place(place, region="baku", category="all")
        assert row is not None
        assert row["name"] == "Test POI"
        assert row["lat"] == 40.4
        assert row["rating"] == 4.5
        assert row["rating_count"] == 120
        assert row["status"] == "approved"

    def test_missing_coords_returns_none(self):
        row = clean_place({"place_id": "x", "name": "No coords"}, "baku", "all")
        assert row is None

    def test_cafe_sync_ignored(self):
        place = {
            "place_id": "cafe1",
            "name": "Tea house",
            "lat": 40.4,
            "lng": 49.8,
            "category": "cafe",
        }
        assert clean_place(place, "baku", "cafe") is None

    def test_invalid_rating_ignored(self):
        place = {
            "place_id": "x",
            "name": "Bad rating",
            "lat": 40.4,
            "lng": 49.8,
            "rating": 99,
        }
        row = clean_place(place, "baku", "all")
        assert row is not None
        assert row["rating"] is None


class TestToDbRegion:
    def test_known_region(self):
        assert to_db_region("baku") == to_db_region("BAKU")

    def test_unknown_passthrough(self):
        assert to_db_region("custom-region") == "custom-region"
