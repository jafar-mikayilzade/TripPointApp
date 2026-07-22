"""Tourism hubs per region — live/plan fetch centers (not only city hall).

Expand later: add hubs as product learns which zones matter.
Camera still uses REGION_COORDINATES; data fetch is hub-driven.
"""

from __future__ import annotations

from typing import Any, TypedDict


class TourismHub(TypedDict):
    id: str
    name: str
    lat: float
    lng: float
    radius_m: int
    weight: float


# Weights: 1.0 = primary tourism zone, ~0.35 = city fill-in only
TOURISM_HUBS: dict[str, list[TourismHub]] = {
    "quba": [
        {
            "id": "qachresh",
            "name": "Qəçrəş",
            "lat": 41.421,
            "lng": 48.428,
            "radius_m": 7_000,
            "weight": 1.0,
        },
        {
            "id": "tangaalti",
            "name": "Təngəaltı",
            "lat": 41.305,
            "lng": 48.405,
            "radius_m": 6_000,
            "weight": 0.9,
        },
        {
            "id": "quba_center",
            "name": "Quba mərkəz",
            "lat": 41.3625,
            "lng": 48.5128,
            "radius_m": 4_500,
            "weight": 0.35,
        },
    ],
    "qusar": [
        {
            "id": "shahdag",
            "name": "Şahdağ",
            "lat": 41.275,
            "lng": 48.035,
            "radius_m": 12_000,
            "weight": 1.0,
        },
        {
            "id": "laza",
            "name": "Laza",
            "lat": 41.348,
            "lng": 48.175,
            "radius_m": 8_000,
            "weight": 0.95,
        },
        {
            "id": "qusar_center",
            "name": "Qusar mərkəz",
            "lat": 41.601,
            "lng": 48.4295,
            "radius_m": 6_000,
            "weight": 0.35,
        },
    ],
    "seki": [
        {
            "id": "sheki_old",
            "name": "Şəki qala / köhnə şəhər",
            "lat": 41.2045,
            "lng": 47.1708,
            "radius_m": 5_000,
            "weight": 1.0,
        },
        {
            "id": "kish",
            "name": "Kiş",
            "lat": 41.251,
            "lng": 47.188,
            "radius_m": 6_000,
            "weight": 0.9,
        },
        {
            "id": "seki_center",
            "name": "Şəki mərkəz",
            "lat": 41.1997,
            "lng": 47.1706,
            "radius_m": 5_000,
            "weight": 0.4,
        },
    ],
    "sheki": [],  # alias → seki via resolve
    "qabala": [
        {
            "id": "tufandag",
            "name": "Tufandağ / turizm zonası",
            "lat": 40.965,
            "lng": 47.872,
            "radius_m": 10_000,
            "weight": 1.0,
        },
        {
            "id": "nohur",
            "name": "Nohur gölü",
            "lat": 40.938,
            "lng": 47.785,
            "radius_m": 7_000,
            "weight": 0.95,
        },
        {
            "id": "qabala_center",
            "name": "Qəbələ mərkəz",
            "lat": 40.9981,
            "lng": 47.8453,
            "radius_m": 6_000,
            "weight": 0.4,
        },
    ],
    "gabala": [],
    "lerik": [
        {
            "id": "lerik_hills",
            "name": "Lerik dağ / təbiət",
            "lat": 38.790,
            "lng": 48.390,
            "radius_m": 10_000,
            "weight": 1.0,
        },
        {
            "id": "lerik_center",
            "name": "Lerik mərkəz",
            "lat": 38.7736,
            "lng": 48.415,
            "radius_m": 6_000,
            "weight": 0.4,
        },
    ],
    "baku": [
        {
            "id": "icherisheher",
            "name": "İçərişəhər",
            "lat": 40.3663,
            "lng": 49.8350,
            "radius_m": 3_000,
            "weight": 1.0,
        },
        {
            "id": "boulevard",
            "name": "Dənizkənarı bulvar",
            "lat": 40.372,
            "lng": 49.855,
            "radius_m": 4_000,
            "weight": 0.9,
        },
        {
            "id": "baku_center",
            "name": "Bakı mərkəz",
            "lat": 40.4093,
            "lng": 49.8671,
            "radius_m": 5_000,
            "weight": 0.45,
        },
    ],
}


def resolve_hub_region_key(region_key: str) -> str:
    key = region_key.strip().lower()
    if key == "sheki":
        return "seki"
    if key == "gabala":
        return "qabala"
    return key


def hubs_for_region(region_key: str) -> list[TourismHub]:
    """Return hubs for region; fall back to empty (caller uses REGION_COORDINATES)."""
    key = resolve_hub_region_key(region_key)
    hubs = TOURISM_HUBS.get(key)
    if hubs:
        return list(hubs)
    # Alias empty lists that redirect
    if key in TOURISM_HUBS and not TOURISM_HUBS[key]:
        # sheki/gabala aliases stored empty — already resolved above
        pass
    return list(TOURISM_HUBS.get(key) or [])


def hub_as_center(hub: TourismHub) -> dict[str, Any]:
    return {
        "id": hub["id"],
        "name": hub["name"],
        "lat": float(hub["lat"]),
        "lng": float(hub["lng"]),
        "radius_m": int(hub["radius_m"]),
        "weight": float(hub["weight"]),
    }
