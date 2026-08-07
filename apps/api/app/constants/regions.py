"""Azerbaijan cities + rayons — coordinates, labels, tourism ranking.

`pois.region` and mobile `REGIONS.id` use the canonical lowercase ids below.
Legacy aliases (`sheki`, `gabala`) still resolve for older clients.
"""

from __future__ import annotations

# (id, label, lat, lng, tourism_rank)
# tourism_rank > 0 → featured in Telegram / sorted first in pickers.
# Coords ≈ administrative centre (or main tourism node when noted).
_REGION_ROWS: list[tuple[str, str, float, float, int]] = [
    # —— Capital & Absheron ——
    ("baku", "Bakı", 40.4093, 49.8671, 100),
    ("sumqayit", "Sumqayıt", 40.5897, 49.6686, 25),
    ("absheron", "Abşeron", 40.4482, 49.7267, 40),  # Xırdalan
    ("xizi", "Xızı", 40.9103, 49.0694, 55),  # Altıağac
    ("qobustan", "Qobustan", 40.5333, 48.9333, 70),  # rayon; park near Alat also seeded via hubs
    # —— Quba–Xaçmaz (north tourism belt) ——
    ("quba", "Quba", 41.3625, 48.5128, 95),
    ("qusar", "Qusar", 41.6010, 48.4295, 95),
    ("xacmaz", "Xaçmaz", 41.4635, 48.8063, 75),  # Nabran
    ("siyazen", "Siyəzən", 41.0769, 49.1117, 50),
    ("sabran", "Şabran", 41.2019, 48.9872, 45),
    # —— Şəki–Zaqatala ——
    ("seki", "Şəki", 41.1997, 47.1706, 95),
    ("zaqatala", "Zaqatala", 41.6336, 46.6433, 80),
    ("balaken", "Balakən", 41.7258, 46.4083, 60),
    ("qax", "Qax", 41.4225, 46.9242, 75),
    ("oguz", "Oğuz", 41.0708, 47.4583, 55),
    # —— Dağlıq Şirvan ——
    ("qabala", "Qəbələ", 40.9981, 47.8453, 95),
    ("ismayilli", "İsmayıllı", 40.7849, 48.1514, 90),  # Lahıc
    ("samaxi", "Şamaxı", 40.6304, 48.6414, 85),
    ("agsu", "Ağsu", 40.5703, 48.4009, 30),
    # —— Gəncə–Qazax ——
    ("gence", "Gəncə", 40.6828, 46.3606, 90),
    ("goygol", "Göygöl", 40.5858, 46.3189, 90),
    ("dashkesen", "Daşkəsən", 40.5217, 46.0828, 40),
    ("samux", "Samux", 40.7667, 46.5056, 20),
    ("goranboy", "Goranboy", 40.6103, 46.7897, 25),
    ("gedebey", "Gədəbəy", 40.5656, 45.8161, 50),
    ("samkir", "Şəmkir", 40.8297, 46.0172, 35),
    ("tovuz", "Tovuz", 40.9925, 45.6289, 40),
    ("agstafa", "Ağstafa", 41.1189, 45.4539, 25),
    ("qazax", "Qazax", 41.0933, 45.3661, 30),
    ("naftalan", "Naftalan", 40.5083, 46.8250, 70),
    ("mingechevir", "Mingəçevir", 40.7631, 47.0594, 35),
    ("yevlax", "Yevlax", 40.6636, 47.1421, 15),
    # —— Aran / Şirvan–Salyan ——
    ("berde", "Bərdə", 40.3758, 47.1267, 20),
    ("terter", "Tərtər", 40.3419, 46.9306, 25),
    ("agdas", "Ağdaş", 40.6500, 47.4761, 15),
    ("goycay", "Göyçay", 40.6531, 47.7406, 20),
    ("ucar", "Ucar", 40.5192, 47.6542, 10),
    ("zerdab", "Zərdab", 40.2183, 47.7125, 10),
    ("kurdemir", "Kürdəmir", 40.3453, 48.1569, 15),
    ("haciqabul", "Hacıqabul", 40.0387, 48.9429, 20),
    ("sirvan", "Şirvan", 39.9319, 48.9294, 20),
    ("salyan", "Salyan", 39.5950, 48.9839, 25),
    ("neftcala", "Neftçala", 39.3742, 49.2472, 20),
    ("sabirabad", "Sabirabad", 40.0089, 48.4772, 10),
    ("saatli", "Saatlı", 39.9311, 48.3697, 10),
    ("imisli", "İmişli", 39.8697, 48.0600, 10),
    ("beyleqan", "Beyləqan", 39.7756, 47.6186, 15),
    ("agcabedi", "Ağcabədi", 40.0502, 47.4593, 15),
    ("bilasuvar", "Biləsuvar", 39.4583, 48.5450, 15),
    # —— Lənkəran–Astara ——
    ("lenkeran", "Lənkəran", 38.7543, 48.8506, 85),
    ("astara", "Astara", 38.4560, 48.8786, 70),
    ("lerik", "Lerik", 38.7736, 48.4150, 90),
    ("masalli", "Masallı", 39.0358, 48.6656, 45),
    ("yardimli", "Yardımlı", 38.9075, 48.2406, 50),
    ("celilabad", "Cəlilabad", 39.2096, 48.4919, 20),
    # —— Qarabağ / Şərqi Zəngəzur (tourism returning) ——
    ("susa", "Şuşa", 39.7602, 46.7499, 95),
    ("xankendi", "Xankəndi", 39.8265, 46.7656, 50),
    ("agdam", "Ağdam", 39.9910, 46.9309, 35),
    ("fuzuli", "Füzuli", 39.6003, 47.1431, 30),
    ("cebrayil", "Cəbrayıl", 39.4000, 47.0261, 25),
    ("zengilan", "Zəngilan", 39.0833, 46.6500, 30),
    ("qubadli", "Qubadlı", 39.3444, 46.5800, 25),
    ("lacin", "Laçın", 39.6333, 46.5500, 55),
    ("kelbecer", "Kəlbəcər", 40.1064, 46.0381, 60),  # İstisu
    ("xocali", "Xocalı", 39.9111, 46.7892, 25),
    ("xocavend", "Xocavənd", 39.7953, 47.1131, 25),
    # —— Naxçıvan MR ——
    ("naxcivan", "Naxçıvan", 39.2089, 45.4122, 80),
    ("babek", "Babək", 39.1500, 45.4500, 30),
    ("culfa", "Culfa", 38.9558, 45.6308, 40),
    ("ordubad", "Ordubad", 38.9081, 46.0228, 70),
    ("sahbuz", "Şahbuz", 39.4000, 45.5667, 55),
    ("sederek", "Sədərək", 39.7167, 44.8833, 20),
    ("serur", "Şərur", 39.5528, 44.9806, 25),
    ("kengerli", "Kəngərli", 39.4000, 45.1167, 20),
]

# Legacy client spellings → canonical DB id
REGION_DB_ID: dict[str, str] = {
    "sheki": "seki",
    "gabala": "qabala",
    "ganja": "gence",
    "lankaran": "lenkeran",
    "nakhchivan": "naxcivan",
    "shusha": "susa",
    "shamakhi": "samaxi",
    "zagatala": "zaqatala",
}

# Mock fixtures still use Latinized legacy keys for a few regions
MOCK_REGION_ALIAS: dict[str, str] = {
    "seki": "sheki",
    "qabala": "gabala",
}

REGION_COORDINATES: dict[str, dict[str, float]] = {
    rid: {"latitude": lat, "longitude": lng} for rid, _label, lat, lng, _rank in _REGION_ROWS
}
# Alias coordinates (same as canonical)
for _alias, _canon in REGION_DB_ID.items():
    if _canon in REGION_COORDINATES:
        REGION_COORDINATES[_alias] = dict(REGION_COORDINATES[_canon])

REGION_LABELS: dict[str, str] = {rid: label for rid, label, _lat, _lng, _rank in _REGION_ROWS}
for _alias, _canon in REGION_DB_ID.items():
    if _canon in REGION_LABELS:
        REGION_LABELS[_alias] = REGION_LABELS[_canon]

REGION_TOURISM_RANK: dict[str, int] = {
    rid: rank for rid, _label, _lat, _lng, rank in _REGION_ROWS
}

# Canonical ids only (no aliases) — stable order: tourism rank desc, then label
CANONICAL_REGION_IDS: list[str] = [
    rid
    for rid, _label, _lat, _lng, _rank in sorted(
        _REGION_ROWS, key=lambda r: (-r[4], r[1].casefold())
    )
]

# Telegram keyboard + featured chips (rank >= 50)
TOURISM_FEATURED_IDS: list[str] = [
    rid for rid in CANONICAL_REGION_IDS if REGION_TOURISM_RANK.get(rid, 0) >= 50
]
