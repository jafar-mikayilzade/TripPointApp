"""Overpass QL selectors per app category."""

OSM_CATEGORY_FILTERS: dict[str, list[str]] = {
    "restaurant": [
        'node["amenity"="restaurant"]["name"]',
    ],
    "cafe": [
        'node["amenity"="cafe"]["name"]',
    ],
    "hotel": [
        'node["tourism"="hotel"]["name"]',
    ],
    "hostel": [
        'node["tourism"="hostel"]["name"]',
    ],
    "home_restaurant": [
        'node["amenity"="canteen"]["name"]',
        'node["amenity"="biergarten"]["name"]',
    ],
    "guesthouse": [
        'node["tourism"="guest_house"]["name"]',
        'node["tourism"="chalet"]["name"]',
    ],
    "nature": [
        'node["tourism"="viewpoint"]["name"]',
        'node["tourism"="attraction"]["name"]',
        'node["leisure"="nature_reserve"]["name"]',
    ],
    "waterfall": [
        'node["waterway"="waterfall"]["name"]',
    ],
    "mountain": [
        'node["natural"="peak"]["name"]',
    ],
    "lake": [
        'node["natural"="water"]["name"]',
        'node["water"="lake"]["name"]',
    ],
    "historical": [
        'node["tourism"="museum"]["name"]',
        'node["historic"="castle"]["name"]',
        'node["historic"="ruins"]["name"]',
        'node["historic"="archaeological_site"]["name"]',
    ],
    "monument": [
        'node["historic"="monument"]["name"]',
        'node["historic"="memorial"]["name"]',
    ],
    "other": [
        'node["tourism"="information"]["name"]',
        'node["amenity"="marketplace"]["name"]',
    ],
    "tourist_attraction": [
        'node["tourism"="attraction"]["name"]',
        'node["tourism"="museum"]["name"]',
        'node["historic"="monument"]["name"]',
    ],
    "all": [
        'node["amenity"="restaurant"]["name"]',
        'node["amenity"="cafe"]["name"]',
        'node["tourism"="hotel"]["name"]',
        'node["tourism"="hostel"]["name"]',
        'node["tourism"="guest_house"]["name"]',
        'node["tourism"="viewpoint"]["name"]',
        'node["tourism"="attraction"]["name"]',
        'node["tourism"="museum"]["name"]',
        'node["waterway"="waterfall"]["name"]',
        'node["natural"="peak"]["name"]',
        'node["natural"="water"]["name"]',
        'node["historic"]["name"]',
    ],
}
