"""Tests for app.services.attraction_classify."""

from __future__ import annotations

from app.services.attraction_classify import (
    classify_attraction_rows,
    interest_attraction_cats,
    refine_attraction_category,
)


class TestInterestAttractionCats:
    def test_nature_interest(self):
        cats = interest_attraction_cats(["nature"])
        assert "waterfall" in cats
        assert "lake" in cats

    def test_food_interest_empty(self):
        assert interest_attraction_cats(["food"]) == set()

    def test_multiple_interests_union(self):
        cats = interest_attraction_cats(["nature", "history"])
        assert "historical" in cats
        assert "waterfall" in cats


class TestRefineAttractionCategory:
    def test_waterfall_by_name_az(self):
        row = {"name": "Afurja şəlaləsi", "category": "tourist_attraction"}
        assert refine_attraction_category(row) == "waterfall"

    def test_historical_museum_type(self):
        row = {"name": "Gallery", "types": ["museum"], "category": "tourist_attraction"}
        assert refine_attraction_category(row) == "historical"

    def test_preserves_restaurant(self):
        row = {"name": "Dolma", "category": "restaurant"}
        assert refine_attraction_category(row) == "restaurant"

    def test_lake_by_name(self):
        row = {"name": "Batabat göl", "category": "tourist_attraction"}
        assert refine_attraction_category(row) == "lake"

    def test_default_tourist_attraction_to_nature(self):
        row = {"name": "Random spot", "category": "tourist_attraction"}
        assert refine_attraction_category(row) == "nature"


class TestClassifyAttractionRows:
    def test_classifies_in_place(self):
        rows = [
            {"name": "Şəlalə", "category": "tourist_attraction"},
            {"name": "Restoran", "category": "restaurant"},
        ]
        out = classify_attraction_rows(rows)
        assert out[0]["category"] == "waterfall"
        assert out[1]["category"] == "restaurant"
