"""Tests for app.services.travel_window."""

from __future__ import annotations

from app.services.travel_window import (
    build_travel_context,
    estimate_drive_minutes,
    minutes_to_hhmm,
    parse_hhmm,
)


class TestParseHhmm:
    def test_valid_time(self):
        assert parse_hhmm("08:30", 0) == 8 * 60 + 30

    def test_invalid_returns_default(self):
        assert parse_hhmm("invalid", 540) == 540
        assert parse_hhmm(None, 600) == 600

    def test_out_of_range_returns_default(self):
        assert parse_hhmm("25:00", 480) == 480


class TestMinutesToHhmm:
    def test_formats_midnight_wrap(self):
        assert minutes_to_hhmm(25 * 60) == "01:00"

    def test_formats_morning(self):
        assert minutes_to_hhmm(8 * 60 + 5) == "08:05"


class TestEstimateDriveMinutes:
    def test_minimum_drive_time(self):
        # Same point still gets buffer minimum
        assert estimate_drive_minutes(40.4, 49.8, 40.4, 49.8) >= 25

    def test_longer_distance_more_time(self):
        short = estimate_drive_minutes(40.4, 49.8, 40.5, 49.8)
        long = estimate_drive_minutes(40.4, 49.8, 41.4, 49.8)
        assert long > short


class TestBuildTravelContext:
    def test_no_origin_flag(self):
        ctx = build_travel_context(
            origin_lat=None,
            origin_lng=None,
            region_lat=40.4,
            region_lng=49.8,
            days=1,
        )
        assert ctx["from_origin"] is False
        assert ctx["allow_hotel"] is False

    def test_near_region_skips_travel(self):
        ctx = build_travel_context(
            origin_lat=40.41,
            origin_lng=49.81,
            region_lat=40.4,
            region_lng=49.8,
            days=1,
            from_origin=True,
        )
        assert ctx["from_origin"] is False

    def test_far_origin_sets_windows(self):
        # Baku-ish to Sheki-ish distance
        ctx = build_travel_context(
            origin_lat=40.4093,
            origin_lng=49.8671,
            region_lat=41.1918,
            region_lng=47.1706,
            days=2,
            depart_time="08:00",
            return_by_time="21:00",
            from_origin=True,
        )
        assert ctx["from_origin"] is True
        assert ctx["outbound_minutes"] > 0
        assert ctx["arrive_region_at"] is not None
        assert ctx["allow_hotel"] is True

    def test_multi_day_allows_hotel(self):
        ctx = build_travel_context(
            origin_lat=40.4093,
            origin_lng=49.8671,
            region_lat=41.1918,
            region_lng=47.1706,
            days=3,
            from_origin=True,
        )
        assert ctx["allow_hotel"] is True
