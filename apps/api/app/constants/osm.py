"""Overpass QL selectors per app category.

Prefer `node` for dense amenities (fast). Use `nwr` (node/way/relation)
for tourism / nature / historic — many Azerbaijan POIs are ways, not nodes.
"""

OSM_CATEGORY_FILTERS: dict[str, list[str]] = {
    "restaurant": [
        'node["amenity"="restaurant"]["name"]',
    ],
    "cafe": [
        'node["amenity"="cafe"]["name"]',
    ],
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
        'nwr["boundary"="protected_area"]["name"]',
        'nwr["leisure"="park"]["name"]',
    ],
    "waterfall": [
        'nwr["waterway"="waterfall"]["name"]',
        'nwr["natural"="waterfall"]["name"]',
    ],
    "mountain": [
        'node["natural"="peak"]["name"]',
        'nwr["natural"="ridge"]["name"]',
    ],
    "lake": [
        'nwr["natural"="water"]["water"="lake"]["name"]',
        'nwr["water"="lake"]["name"]',
        'nwr["natural"="water"]["name"]',
    ],
    "historical": [
        'nwr["tourism"="museum"]["name"]',
        'nwr["historic"="castle"]["name"]',
        'nwr["historic"="ruins"]["name"]',
        'nwr["historic"="archaeological_site"]["name"]',
        'nwr["historic"="manor"]["name"]',
        'nwr["tourism"="attraction"]["historic"]["name"]',
    ],
    "monument": [
        'nwr["historic"="monument"]["name"]',
        'nwr["historic"="memorial"]["name"]',
        'nwr["tourism"="artwork"]["name"]',
    ],
    "other": [
        'nwr["tourism"="information"]["name"]',
        'nwr["amenity"="marketplace"]["name"]',
        'nwr["shop"="souvenir"]["name"]',
        'nwr["tourism"="yes"]["name"]',
    ],
    "tourist_attraction": [
        'nwr["tourism"="attraction"]["name"]',
        'nwr["tourism"="museum"]["name"]',
        'nwr["historic"="monument"]["name"]',
    ],
    # Legacy bulk selector — unused by balanced all-sync, kept for tooling
    "all": [
        'node["amenity"="restaurant"]["name"]',
        'node["amenity"="cafe"]["name"]',
        'nwr["tourism"="hotel"]["name"]',
        'nwr["tourism"="hostel"]["name"]',
        'nwr["tourism"="guest_house"]["name"]',
        'nwr["tourism"="viewpoint"]["name"]',
        'nwr["tourism"="attraction"]["name"]',
        'nwr["tourism"="museum"]["name"]',
        'nwr["waterway"="waterfall"]["name"]',
        'node["natural"="peak"]["name"]',
        'nwr["natural"="water"]["name"]',
        'nwr["historic"]["name"]',
    ],
}
