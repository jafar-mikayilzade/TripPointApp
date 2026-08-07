"""Unit tests for SerpAPI hotel mapping (no network)."""

from __future__ import annotations

from app.services.places_clean import clean_place
from app.services.places_serpapi import map_serpapi_property_to_place


def test_map_hotel_with_price() -> None:
    prop = {
        "type": "hotel",
        "name": "Quba Palace",
        "property_token": "TokEn123",
        "gps_coordinates": {"latitude": 41.36, "longitude": 48.51},
        "overall_rating": 4.5,
        "reviews": 120,
        "extracted_hotel_class": 4,
        "rate_per_night": {"extracted_lowest": 85.5},
        "description": "Mountain view",
        "link": "https://example.com",
        "amenities": ["Free Wi-Fi", "Pool"],
        "check_in_time": "2:00 PM",
        "check_out_time": "12:00 PM",
        "images": [{"thumbnail": "https://img.example/t.jpg"}],
    }
    mapped = map_serpapi_property_to_place(prop, currency="AZN")
    assert mapped is not None
    assert mapped["place_id"] == "serpapi:TokEn123"
    assert mapped["category"] == "hotel"
    assert mapped["price_from"] == 85.5
    assert mapped["price_currency"] == "AZN"
    assert mapped["hotel_class"] == 4
    assert mapped["data_source"] == "serpapi"

    row = clean_place(mapped, "quba", "hotel")
    assert row is not None
    assert row["region"] == "quba"
    assert row["price_from"] == 85.5
    assert row["price_currency"] == "AZN"
    assert row["amenities"] == ["Free Wi-Fi", "Pool"]
    assert row["thumbnail_url"] == "https://img.example/t.jpg"


def test_map_vacation_rental_is_guesthouse() -> None:
    prop = {
        "type": "vacation rental",
        "name": "Cottage",
        "property_token": "vr1",
        "gps_coordinates": {"latitude": 41.4, "longitude": 48.4},
    }
    mapped = map_serpapi_property_to_place(prop, currency="AZN")
    assert mapped is not None
    assert mapped["category"] == "guesthouse"
