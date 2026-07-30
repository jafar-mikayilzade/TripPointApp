"""Overpass QL selectors per app category.

Prefer `node` for dense amenities (fast). Use `nwr` (node/way/relation)
for tourism / nature / historic — many Azerbaijan POIs are ways, not nodes.
"""

OSM_CATEGORY_FILTERS: dict[str, list[str]] = {
    "restaurant": [
        'node["amenity"="restaurant"]["name"]',
    ],
    # Disabled: amenity=cafe is noisy for tourism (tea houses, game cafes, etc.)
    "cafe": [],
    "hotel": [
        'nwr["tourism"="hotel"]["name"]',
    ],
    "hostel": [
        'nwr["tourism"="hostel"]["name"]',
    ],
    "home_restaurant": [
        'node["amenity"="canteen"]["name"]',
        'node["amenity"="biergarten"]["name"]',
        'node["amenity"="restaurant"]["cuisine"~"home|homemade|family",i]["name"]',
    ],
    "guesthouse": [
        'nwr["tourism"="guest_house"]["name"]',
        'nwr["tourism"="chalet"]["name"]',
        'nwr["tourism"="alpine_hut"]["name"]',
    ],
    "nature": [
        'nwr["tourism"="viewpoint"]["name"]',
        'nwr["leisure"="nature_reserve"]["name"]',
        'nwr["leisure"="park"]["name"]',
    ],
    "waterfall": [
        'nwr["waterway"="waterfall"]["name"]',
    ],
    "mountain": [
        'node["natural"="peak"]["name"]',
    ],
    "lake": [
        'nwr["water"="lake"]["name"]',
        'nwr["natural"="water"]["water"="lake"]["name"]',
    ],
    "historical": [
        'nwr["tourism"="museum"]["name"]',
        'nwr["historic"="castle"]["name"]',
        'nwr["historic"="ruins"]["name"]',
    ],
    "monument": [
        'nwr["historic"="monument"]["name"]',
        'nwr["historic"="memorial"]["name"]',
    ],
    "camping": [
        'nwr["tourism"="camp_site"]["name"]',
        'nwr["tourism"="caravan_site"]["name"]',
    ],
    "other": [
        'nwr["tourism"="information"]["name"]',
        'nwr["shop"="souvenir"]["name"]',
    ],
    "tourist_attraction": [
        'nwr["tourism"="attraction"]["name"]',
        'nwr["tourism"="museum"]["name"]',
        'nwr["historic"="monument"]["name"]',
    ],
}
