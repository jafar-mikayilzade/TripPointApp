"""Tests for app.services.weather — forecast analysis (no API calls)."""

from __future__ import annotations

from app.services.weather import analyze_forecast, build_daily_forecast


def _slot(*, mm: float = 0.0, pop: float = 0.0, desc: str = "clear sky", dt_txt: str = "") -> dict:
    rain = {"3h": mm} if mm > 0 else {}
    return {
        "pop": pop,
        "rain": rain,
        "weather": [{"description": desc, "main": "Clear"}],
        "dt_txt": dt_txt,
        "main": {"temp": 18.0},
    }


class TestAnalyzeForecast:
    def test_clear_weather_prefers_outdoor(self):
        slots = [_slot() for _ in range(8)]
        result = analyze_forecast(slots, days=1)
        assert result["prefer_indoor"] is False
        assert result["exclude_categories"] == []
        assert "uyğundur" in result["summary_az"]

    def test_heavy_rain_prefers_indoor(self):
        slots = [_slot(mm=5.0, pop=0.8, desc="heavy rain") for _ in range(4)]
        result = analyze_forecast(slots, days=1)
        assert result["prefer_indoor"] is True
        assert "nature" in result["exclude_categories"]
        assert "historical" in result["prefer_categories"]

    def test_moderate_rain_not_indoor(self):
        slots = [_slot(mm=1.0, pop=0.3) for _ in range(4)]
        result = analyze_forecast(slots, days=1)
        assert result["prefer_indoor"] is False

    def test_respects_days_window(self):
        slots = [_slot(mm=6.0) for _ in range(24)]
        result = analyze_forecast(slots, days=2)
        assert result["heavy_slots"] >= 1


class TestBuildDailyForecast:
    def test_groups_by_day_with_offset(self):
        slots = [
            _slot(dt_txt="2026-07-28 09:00:00", desc="açıq"),
            _slot(dt_txt="2026-07-28 15:00:00", desc="açıq"),
            _slot(dt_txt="2026-07-29 12:00:00", desc="yağış", mm=5.0, pop=0.8),
        ]
        days = build_daily_forecast(slots, trip_days=2, start_offset=1)
        assert len(days) == 1
        assert days[0]["date"] == "2026-07-29"
        assert days[0]["prefer_indoor"] is True
