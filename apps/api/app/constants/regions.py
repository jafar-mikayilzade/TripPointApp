"""Tourism region coordinates and id aliases."""

# Mobile REGIONS ids + legacy aliases (sheki/gabala)
REGION_COORDINATES: dict[str, dict[str, float]] = {
    "quba": {"latitude": 41.3625, "longitude": 48.5128},
    "qusar": {"latitude": 41.601, "longitude": 48.4295},
    "seki": {"latitude": 41.1997, "longitude": 47.1706},
    "sheki": {"latitude": 41.1997, "longitude": 47.1706},
    "qabala": {"latitude": 40.9981, "longitude": 47.8453},
    "gabala": {"latitude": 40.9981, "longitude": 47.8453},
    "lerik": {"latitude": 38.7736, "longitude": 48.415},
    "baku": {"latitude": 40.4093, "longitude": 49.8671},
}

REGION_DB_ID: dict[str, str] = {
    "sheki": "seki",
    "gabala": "qabala",
}

MOCK_REGION_ALIAS: dict[str, str] = {
    "seki": "sheki",
    "qabala": "gabala",
}
