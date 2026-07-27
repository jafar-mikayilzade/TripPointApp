"""Shared pytest fixtures and env defaults for CI/local runs."""

from __future__ import annotations

import os
import random
from typing import Any

import pytest

# Must be set before any `app.*` import that reads config at import time.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("DATA_SOURCE", "mock")


@pytest.fixture
def sample_pois() -> list[dict[str, Any]]:
    """Spread POIs around Baku region for geo/cluster tests."""
    rng = random.Random(42)
    out: list[dict[str, Any]] = []
    for i in range(24):
        out.append(
            {
                "id": f"p{i}",
                "name": f"Place {i}",
                "lat": 40.4 + rng.uniform(-0.2, 0.2),
                "lng": 49.8 + rng.uniform(-0.2, 0.2),
                "rating": rng.uniform(3.5, 5.0),
                "category": "nature",
            }
        )
    return out


@pytest.fixture
def line_tour_pois() -> list[dict[str, Any]]:
    """POIs on a straight north-south line with one large gap in the middle."""
    return [
        {"id": "a1", "lat": 40.30, "lng": 49.80, "name": "South 1"},
        {"id": "a2", "lat": 40.32, "lng": 49.80, "name": "South 2"},
        {"id": "a3", "lat": 40.34, "lng": 49.80, "name": "South 3"},
        # ~25 km gap
        {"id": "b1", "lat": 40.58, "lng": 49.80, "name": "North 1"},
        {"id": "b2", "lat": 40.60, "lng": 49.80, "name": "North 2"},
        {"id": "b3", "lat": 40.62, "lng": 49.80, "name": "North 3"},
    ]
