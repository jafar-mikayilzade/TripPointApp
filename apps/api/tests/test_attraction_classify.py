"""Tests for app.services.attraction_classify."""

from __future__ import annotations

from app.services.attraction_classify import (
    attraction_matches_interests,
    classify_attraction_rows,
    interest_attraction_cats,
    looks_like_mountain_peak,
    refine_attraction_category,
)


class TestInterestAttractionCats:
    def test_nature_interest(self):
        cats = interest_attraction_cats(["nature"])
        assert cats == {"nature"}
        assert "mountain" not in cats

    def test_mountain_only_when_selected(self):
        cats = interest_attraction_cats(["nature", "mountain"])
        assert "nature" in cats
        assert "mountain" in cats

    def test_food_interest_empty(self):
        assert interest_attraction_cats(["food"]) == set()

    def test_multiple_interests_union(self):
        cats = interest_attraction_cats(["nature", "history", "waterfall"])
        assert "historical" in cats
        assert "nature" in cats
        assert "waterfall" in cats
        assert "mountain" not in cats


class TestMountainInterestGate:
    def test_dual_tag_peak_blocked_without_mountain(self):
        row = {
            "name": "Haramtala",
            "category": "nature",
            "categories": ["nature", "mountain"],
        }
        assert looks_like_mountain_peak(row)
        assert not attraction_matches_interests(row, {"nature", "waterfall", "lake"})

    def test_elevation_name_blocked(self):
        row = {"name": "Yerfi 2076.7 metr", "category": "nature"}
        assert looks_like_mountain_peak(row)
        assert not attraction_matches_interests(row, {"nature"})

    def test_mountain_allowed_when_selected(self):
        row = {"name": "Haramtala", "category": "mountain"}
        assert attraction_matches_interests(row, {"nature", "mountain"})

    def test_waterfall_not_treated_as_peak(self):
        row = {"name": "Laza waterfall", "category": "waterfall"}
        assert not looks_like_mountain_peak(row)
        assert attraction_matches_interests(row, {"waterfall"})


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
