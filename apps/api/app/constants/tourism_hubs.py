"""Tourism hubs per region — live/plan fetch centers (not only city hall).

Camera still uses REGION_COORDINATES; data fetch is hub-driven.
Regions without an entry fall back to a single region-centre circle.
"""

from __future__ import annotations

from typing import Any, TypedDict

from app.constants.regions import REGION_DB_ID


class TourismHub(TypedDict):
    id: str
    name: str
    lat: float
    lng: float
    radius_m: int
    weight: float


def _hub(
    hub_id: str,
    name: str,
    lat: float,
    lng: float,
    radius_m: int = 8_000,
    weight: float = 1.0,
) -> TourismHub:
    return {
        "id": hub_id,
        "name": name,
        "lat": lat,
        "lng": lng,
        "radius_m": radius_m,
        "weight": weight,
    }


# Weights: 1.0 = primary tourism zone, ~0.35 = city fill-in only
TOURISM_HUBS: dict[str, list[TourismHub]] = {
    "baku": [
        _hub("icherisheher", "İçərişəhər", 40.3663, 49.8350, 3_000, 1.0),
        _hub("boulevard", "Dənizkənarı bulvar", 40.372, 49.855, 4_000, 0.9),
        _hub("flame_towers", "Flame Towers / dağüstü park", 40.3592, 49.8280, 3_500, 0.85),
        _hub("baku_center", "Bakı mərkəz", 40.4093, 49.8671, 5_000, 0.45),
    ],
    "quba": [
        _hub("qachresh", "Qəçrəş", 41.421, 48.428, 7_000, 1.0),
        _hub("tangaalti", "Təngəaltı", 41.305, 48.405, 6_000, 0.9),
        _hub("quba_center", "Quba mərkəz", 41.3625, 48.5128, 4_500, 0.35),
    ],
    "qusar": [
        _hub("shahdag", "Şahdağ", 41.275, 48.035, 12_000, 1.0),
        _hub("laza", "Laza", 41.348, 48.175, 8_000, 0.95),
        _hub("qusar_center", "Qusar mərkəz", 41.601, 48.4295, 6_000, 0.35),
    ],
    "seki": [
        _hub("sheki_old", "Şəki qala / köhnə şəhər", 41.2045, 47.1708, 5_000, 1.0),
        _hub("kish", "Kiş", 41.251, 47.188, 6_000, 0.9),
        _hub("seki_center", "Şəki mərkəz", 41.1997, 47.1706, 5_000, 0.4),
    ],
    "qabala": [
        _hub("tufandag", "Tufandağ / turizm zonası", 40.965, 47.872, 10_000, 1.0),
        _hub("nohur", "Nohur gölü", 40.938, 47.785, 7_000, 0.95),
        _hub("qabala_center", "Qəbələ mərkəz", 40.9981, 47.8453, 6_000, 0.4),
    ],
    "lerik": [
        _hub("lerik_hills", "Lerik dağ / təbiət", 38.790, 48.390, 10_000, 1.0),
        _hub("lerik_center", "Lerik mərkəz", 38.7736, 48.415, 6_000, 0.4),
    ],
    "ismayilli": [
        _hub("lahij", "Lahıc", 40.845, 48.375, 8_000, 1.0),
        _hub("ivanovka", "İvanovka", 40.74, 48.03, 6_000, 0.85),
        _hub("ismayilli_center", "İsmayıllı mərkəz", 40.7849, 48.1514, 6_000, 0.4),
    ],
    "samaxi": [
        _hub("samaxi_old", "Şamaxı tarixi mərkəz", 40.6304, 48.6414, 6_000, 1.0),
        _hub("pirgulu", "Pirqulu / rəsədxana", 40.72, 48.58, 8_000, 0.9),
    ],
    "gence": [
        _hub("gence_center", "Gəncə mərkəz", 40.6828, 46.3606, 6_000, 1.0),
        _hub("imamzade", "İmamzadə kompleksi", 40.715, 46.375, 4_000, 0.85),
    ],
    "goygol": [
        _hub("goygol_lake", "Göygöl gölü", 40.41, 46.32, 10_000, 1.0),
        _hub("maralgol", "Maralgöl", 40.38, 46.30, 6_000, 0.95),
        _hub("goygol_center", "Göygöl mərkəz", 40.5858, 46.3189, 5_000, 0.35),
    ],
    "lenkeran": [
        _hub("hirkan", "Hirkan meşəsi", 38.68, 48.78, 10_000, 1.0),
        _hub("lenkeran_center", "Lənkəran mərkəz", 38.7543, 48.8506, 6_000, 0.5),
    ],
    "astara": [
        _hub("astara_center", "Astara mərkəz", 38.456, 48.8786, 7_000, 1.0),
        _hub("istisu_astara", "Astara isti su / təbiət", 38.42, 48.75, 8_000, 0.85),
    ],
    "zaqatala": [
        _hub("zaqatala_reserve", "Zaqatala qoruğu", 41.68, 46.72, 10_000, 1.0),
        _hub("zaqatala_center", "Zaqatala mərkəz", 41.6336, 46.6433, 6_000, 0.45),
    ],
    "qax": [
        _hub("ilisu", "İlisu", 41.47, 46.98, 8_000, 1.0),
        _hub("qax_center", "Qax mərkəz", 41.4225, 46.9242, 5_000, 0.4),
    ],
    "balaken": [
        _hub("balaken_center", "Balakən mərkəz", 41.7258, 46.4083, 8_000, 1.0),
    ],
    "xacmaz": [
        _hub("nabran", "Nabran", 41.78, 48.68, 10_000, 1.0),
        _hub("xacmaz_center", "Xaçmaz mərkəz", 41.4635, 48.8063, 6_000, 0.35),
    ],
    "xizi": [
        _hub("altiaghaj", "Altıağac", 40.87, 48.95, 10_000, 1.0),
        _hub("xizi_center", "Xızı mərkəz", 40.9103, 49.0694, 5_000, 0.35),
    ],
    "qobustan": [
        _hub("gobustan_park", "Qobustan qoruğu / petroqliflər", 40.125, 49.375, 8_000, 1.0),
        _hub("qobustan_center", "Qobustan mərkəz", 40.5333, 48.9333, 5_000, 0.3),
    ],
    "absheron": [
        _hub("fire_temple", "Atəşgah", 40.415, 50.008, 4_000, 1.0),
        _hub("yanardag", "Yanardağ", 40.502, 49.885, 4_000, 0.95),
        _hub("absheron_center", "Xırdalan / Abşeron", 40.4482, 49.7267, 6_000, 0.4),
    ],
    "susa": [
        _hub("susa_fortress", "Şuşa qala / mərkəz", 39.7602, 46.7499, 5_000, 1.0),
        _hub("jidir_duzu", "Cıdır düzü", 39.748, 46.740, 3_000, 0.9),
    ],
    "naxcivan": [
        _hub("naxcivan_center", "Naxçıvan mərkəz", 39.2089, 45.4122, 6_000, 1.0),
        _hub("momine_khatun", "Möminə Xatun", 39.205, 45.405, 3_000, 0.9),
    ],
    "ordubad": [
        _hub("ordubad_old", "Ordubad köhnə şəhər", 38.9081, 46.0228, 6_000, 1.0),
        _hub("gemigaya", "Gəmiqaya", 39.05, 45.95, 10_000, 0.85),
    ],
    "sahbuz": [
        _hub("batabat", "Batabat gölləri", 39.52, 45.78, 8_000, 1.0),
        _hub("sahbuz_center", "Şahbuz mərkəz", 39.4, 45.5667, 5_000, 0.4),
    ],
    "naftalan": [
        _hub("naftalan_center", "Naftalan kurort", 40.5083, 46.825, 5_000, 1.0),
    ],
    "kelbecer": [
        _hub("istisu", "İstisu", 39.95, 46.10, 10_000, 1.0),
        _hub("kelbecer_center", "Kəlbəcər mərkəz", 40.1064, 46.0381, 6_000, 0.4),
    ],
    "lacin": [
        _hub("lacin_center", "Laçın mərkəz", 39.6333, 46.55, 8_000, 1.0),
    ],
    "yardimli": [
        _hub("yardimli_nature", "Yardımlı təbiət", 38.9075, 48.2406, 10_000, 1.0),
    ],
    "gedebey": [
        _hub("gedebey_hills", "Gədəbəy dağ / göllər", 40.5656, 45.8161, 10_000, 1.0),
    ],
    "oguz": [
        _hub("oguz_center", "Oğuz mərkəz", 41.0708, 47.4583, 8_000, 1.0),
    ],
    "siyazen": [
        _hub("siyazen_coast", "Siyəzən sahil", 41.0769, 49.1117, 8_000, 1.0),
    ],
    "sabran": [
        _hub("sabran_center", "Şabran mərkəz", 41.2019, 48.9872, 8_000, 1.0),
    ],
    "masalli": [
        _hub("masalli_center", "Masallı mərkəz", 39.0358, 48.6656, 8_000, 1.0),
    ],
}


def resolve_hub_region_key(region_key: str) -> str:
    key = region_key.strip().lower()
    return REGION_DB_ID.get(key, key)


def hubs_for_region(region_key: str) -> list[TourismHub]:
    """Return hubs for region; empty list → caller uses REGION_COORDINATES centre."""
    key = resolve_hub_region_key(region_key)
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
