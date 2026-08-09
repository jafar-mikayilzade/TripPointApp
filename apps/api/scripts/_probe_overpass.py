"""Quick Overpass connectivity probe with TripPoint UA."""
from __future__ import annotations

import requests

QUERY = (
    '[out:json][timeout:15];'
    'node["amenity"="restaurant"]["name"](around:8000,41.3625,48.5128);'
    'out body 8;'
)
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "TripPoint/1.0 (sync-places; contact=dev@trippoint.local)",
}
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]


def main() -> None:
    for url in MIRRORS:
        host = url.split("/")[2]
        try:
            resp = requests.post(
                url, data={"data": QUERY}, headers=HEADERS, timeout=(5, 30)
            )
            if resp.ok:
                n = len((resp.json() or {}).get("elements") or [])
                print(f"{host} OK status={resp.status_code} elements={n}")
            else:
                print(f"{host} HTTP {resp.status_code} {resp.text[:140]!r}")
        except Exception as exc:
            print(f"{host} ERR {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
