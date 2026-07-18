"""POI category enums and Google type mapping."""

# Mobile / DB PoiCategory (exact)
APP_CATEGORIES = {
    "restaurant",
    "cafe",
    "hostel",
    "hotel",
    "home_restaurant",
    "guesthouse",
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

GOOGLE_TYPE_MAP: dict[str, str] = {
    "restaurant": "restaurant",
    "cafe": "cafe",
    "hotel": "lodging",
    "hostel": "lodging",
    "home_restaurant": "restaurant",
    "guesthouse": "lodging",
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
    "nature": "tourist_attraction",
    "waterfall": "tourist_attraction",
    "mountain": "tourist_attraction",
    "lake": "tourist_attraction",
    "historical": "tourist_attraction",
    "monument": "tourist_attraction",
    "other": "tourist_attraction",
    "tourist_attraction": "tourist_attraction",
}
