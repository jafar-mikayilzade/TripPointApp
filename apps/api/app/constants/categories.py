"""POI category enums and Google type mapping."""

# Mobile / DB PoiCategory (exact)
APP_CATEGORIES = {
    "restaurant",
    "cafe",
    "hostel",
    "hotel",
    "home_restaurant",
    "guesthouse",
    "camping",
    "nature",
    "waterfall",
    "mountain",
    "lake",
    "historical",
    "monument",
    "other",
}

# all = region sync; tourist_attraction = legacy alias
ALLOWED_CATEGORIES = APP_CATEGORIES | {"all", "tourist_attraction"}

# Food/lodging — curated via admin/Google; OSM sync must not stampede/override
OSM_SKIP_SYNC_CATEGORIES = frozenset(
    {
        "restaurant",
        "cafe",
        "hotel",
        "hostel",
        "guesthouse",
        "home_restaurant",
    }
)

# OSM sync / lazy fill — attractions (+ camping). "all" expands to this set.
OSM_SYNC_ATTRACTION_CATEGORIES = frozenset(
    {
        "nature",
        "waterfall",
        "mountain",
        "lake",
        "historical",
        "monument",
        "camping",
        "other",
    }
)

OSM_SYNC_ATTRACTION_ORDER = [
    "nature",
    "waterfall",
    "mountain",
    "lake",
    "historical",
    "monument",
    "camping",
    "other",
]

# DATA_SOURCE=hybrid routing
HYBRID_GOOGLE_CATEGORIES = frozenset(
    {
        "restaurant",
        "hotel",
        "hostel",
        "guesthouse",
        "home_restaurant",
        "camping",
    }
)
HYBRID_OSM_CATEGORIES = frozenset(
    {
        "nature",
        "waterfall",
        "mountain",
        "lake",
        "historical",
        "monument",
        "other",
        "camping",
    }
)

# Stable order for hybrid "all" sync
HYBRID_GOOGLE_SYNC_ORDER = [
    "restaurant",
    "hotel",
    "hostel",
    "guesthouse",
    "home_restaurant",
    "camping",
]
HYBRID_OSM_SYNC_ORDER = [
    "nature",
    "waterfall",
    "mountain",
    "lake",
    "historical",
    "monument",
    "other",
]

GOOGLE_TYPE_MAP: dict[str, str] = {
    "restaurant": "restaurant",
    "cafe": "cafe",
    "hotel": "lodging",
    "hostel": "lodging",
    "home_restaurant": "restaurant",
    "guesthouse": "lodging",
    "camping": "campground",
    "nature": "tourist_attraction",
    "waterfall": "tourist_attraction",
    "mountain": "tourist_attraction",
    "lake": "tourist_attraction",
    "historical": "tourist_attraction",
    "monument": "tourist_attraction",
    "other": "point_of_interest",
    "tourist_attraction": "tourist_attraction",
    "all": "tourist_attraction",
}

# Mock fixtures only have restaurant/hotel/tourist_attraction buckets
MOCK_CATEGORY_ALIAS: dict[str, str] = {
    "cafe": "restaurant",
    "home_restaurant": "restaurant",
    "hostel": "hotel",
    "guesthouse": "hotel",
    "camping": "hotel",
    "nature": "tourist_attraction",
    "waterfall": "tourist_attraction",
    "mountain": "tourist_attraction",
    "lake": "tourist_attraction",
    "historical": "tourist_attraction",
    "monument": "tourist_attraction",
    "other": "tourist_attraction",
    "tourist_attraction": "tourist_attraction",
}
