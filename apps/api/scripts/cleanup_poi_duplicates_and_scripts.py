"""Cleanup POI duplicates + non AZ/EN script names.

Rules:
1) Duplicate groups (same normalized name + region, optionally near coords):
   keep the richest row (photos/phone/description/website/address/rating…).
2) Delete names with Cyrillic / Arabic / CJK / other non AZ-EN Latin scripts.

Usage (from apps/api):
  python -m scripts.cleanup_poi_duplicates_and_scripts
  python -m scripts.cleanup_poi_duplicates_and_scripts --apply
"""

from __future__ import annotations

import argparse
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

import app.ssl_insecure  # noqa: E402, F401
from app.db import supabase  # noqa: E402
from scripts.cleanup_bad_poi_names import reason_bad_name  # noqa: E402

SELECT_COLS = (
    "id, name, description, category, region, lat, lng, address, phone, website, "
    "rating, rating_count, thumbnail_url, photo_urls, amenities, cuisine, "
    "opening_hours, external_url, place_id, data_source, price_from, hotel_class, "
    "status, created_at"
)

# Same place if within ~120 m (generic names use tighter radius)
NEAR_M = 120.0
NEAR_GENERIC_M = 40.0

_GENERIC_NAMES = {
    "restoran",
    "restaurant",
    "kafe",
    "cafe",
    "hotel",
    "otel",
    "hostel",
    "motel",
    "guesthouse",
    "qonaq evi",
    "camping",
    "kemping",
}


def _norm_name(name: str | None) -> str:
    s = unicodedata.normalize("NFKC", str(name or "")).casefold().strip()
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _truthy_str(v: Any) -> bool:
    return bool(v) and str(v).strip() not in {"", "None", "null"}


def richness_score(poi: dict[str, Any], photo_count: int = 0) -> int:
    """Higher = keep. Prefer photo, phone, extra info."""
    score = 0
    photos = poi.get("photo_urls")
    n_photos = photo_count
    if isinstance(photos, list):
        n_photos = max(n_photos, len([u for u in photos if _truthy_str(u)]))
    if _truthy_str(poi.get("thumbnail_url")):
        n_photos = max(n_photos, 1)
    score += min(n_photos, 8) * 25  # photos weight heavy

    if _truthy_str(poi.get("phone")):
        score += 40
    if _truthy_str(poi.get("description")) and len(str(poi.get("description"))) >= 20:
        score += 30
    elif _truthy_str(poi.get("description")):
        score += 10
    if _truthy_str(poi.get("website")) or _truthy_str(poi.get("external_url")):
        score += 20
    if _truthy_str(poi.get("address")):
        score += 15
    if _truthy_str(poi.get("opening_hours")):
        score += 10
    if _truthy_str(poi.get("cuisine")):
        score += 8
    if isinstance(poi.get("amenities"), list) and poi["amenities"]:
        score += min(len(poi["amenities"]), 6) * 3
    if poi.get("rating") is not None:
        try:
            score += int(float(poi["rating"]) * 4)
        except (TypeError, ValueError):
            pass
    if poi.get("rating_count"):
        try:
            score += min(int(poi["rating_count"]), 50)
        except (TypeError, ValueError):
            pass
    if poi.get("price_from") is not None:
        score += 8
    if poi.get("hotel_class") is not None:
        score += 5
    if poi.get("status") == "approved":
        score += 5
    # Prefer rows with place_id / known source slightly
    if _truthy_str(poi.get("place_id")):
        score += 3
    if _truthy_str(poi.get("data_source")):
        score += 2
    # Tie-break: older created_at slightly preferred (stable id)
    return score


def fetch_all_pois() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 0
    page_size = 1000
    while True:
        start = page * page_size
        end = start + page_size - 1
        res = (
            supabase.table("pois")
            .select(SELECT_COLS)
            .order("id")
            .range(start, end)
            .execute()
        )
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        page += 1
    return rows


def fetch_photo_counts(poi_ids: list[str]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for i in range(0, len(poi_ids), 200):
        batch = poi_ids[i : i + 200]
        try:
            res = (
                supabase.table("poi_photos")
                .select("poi_id")
                .in_("poi_id", batch)
                .eq("status", "approved")
                .execute()
            )
            for row in res.data or []:
                pid = row.get("poi_id")
                if pid:
                    counts[str(pid)] += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  warn poi_photos count: {exc}")
    return counts


def find_duplicate_ids_to_delete(
    pois: list[dict[str, Any]], photo_counts: dict[str, int]
) -> tuple[list[str], list[dict[str, Any]]]:
    """Group by normalized name + region; split by proximity; keep richest."""
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for poi in pois:
        name = _norm_name(poi.get("name"))
        region = str(poi.get("region") or "").strip().lower()
        if not name or len(name) < 2:
            continue
        by_key[(name, region)].append(poi)

    delete_ids: list[str] = []
    reports: list[dict[str, Any]] = []

    for (name, region), group in by_key.items():
        if len(group) < 2:
            continue

        # Cluster by proximity
        near_m = NEAR_GENERIC_M if name in _GENERIC_NAMES else NEAR_M
        clusters: list[list[dict[str, Any]]] = []
        for poi in group:
            placed = False
            try:
                lat = float(poi["lat"])
                lng = float(poi["lng"])
            except (TypeError, ValueError, KeyError):
                # No coords → only merge via shared place_id later
                clusters.append([poi])
                continue
            for cluster in clusters:
                try:
                    clat = float(cluster[0]["lat"])
                    clng = float(cluster[0]["lng"])
                except (TypeError, ValueError, KeyError):
                    continue
                if _haversine_m(lat, lng, clat, clng) <= near_m:
                    cluster.append(poi)
                    placed = True
                    break
            if not placed:
                clusters.append([poi])

        # Also merge clusters that share place_id
        place_id_map: dict[str, list[dict[str, Any]]] = defaultdict(list)
        leftovers: list[list[dict[str, Any]]] = []
        for cluster in clusters:
            pids = {
                str(p.get("place_id")).strip()
                for p in cluster
                if _truthy_str(p.get("place_id"))
            }
            if len(pids) == 1:
                place_id_map[next(iter(pids))].extend(cluster)
            else:
                leftovers.append(cluster)
        final_clusters = leftovers + [
            members for members in place_id_map.values() if members
        ]

        for cluster in final_clusters:
            # Deduplicate by id inside cluster
            uniq: dict[str, dict[str, Any]] = {}
            for p in cluster:
                if p.get("id"):
                    uniq[str(p["id"])] = p
            members = list(uniq.values())
            if len(members) < 2:
                continue

            ranked = sorted(
                members,
                key=lambda p: (
                    richness_score(p, photo_counts.get(str(p["id"]), 0)),
                    # prefer longer description / name stability
                    len(str(p.get("description") or "")),
                    str(p.get("created_at") or ""),
                ),
                reverse=True,
            )
            keep = ranked[0]
            drop = ranked[1:]
            keep_score = richness_score(keep, photo_counts.get(str(keep["id"]), 0))
            for d in drop:
                delete_ids.append(str(d["id"]))
                reports.append(
                    {
                        "keep_id": keep["id"],
                        "keep_name": keep.get("name"),
                        "keep_score": keep_score,
                        "drop_id": d["id"],
                        "drop_name": d.get("name"),
                        "drop_score": richness_score(
                            d, photo_counts.get(str(d["id"]), 0)
                        ),
                        "region": region,
                        "category": keep.get("category"),
                    }
                )

    # unique preserve order
    seen: set[str] = set()
    ordered: list[str] = []
    for i in delete_ids:
        if i not in seen:
            seen.add(i)
            ordered.append(i)
    return ordered, reports


def delete_pois(ids: list[str]) -> int:
    deleted = 0
    for i in range(0, len(ids), 40):
        batch = ids[i : i + 40]
        try:
            supabase.table("poi_photos").delete().in_("poi_id", batch).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"  warn poi_photos: {exc}")
        # favorites / ratings may block; try best-effort
        for table in ("favorites", "ratings"):
            try:
                supabase.table(table).delete().eq("target_type", "poi").in_(
                    "target_id", batch
                ).execute()
            except Exception:
                pass
        supabase.table("pois").delete().in_("id", batch).execute()
        deleted += len(batch)
        print(f"  deleted {deleted}/{len(ids)}")
    return deleted


def _safe_print(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((text + "\n").encode("utf-8", errors="replace"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--skip-scripts", action="store_true")
    parser.add_argument("--skip-dupes", action="store_true")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    _safe_print("Fetching pois…")
    pois = fetch_all_pois()
    _safe_print(f"Total pois: {len(pois)}")

    ids_all = [str(p["id"]) for p in pois if p.get("id")]
    _safe_print("Counting approved poi_photos…")
    photo_counts = fetch_photo_counts(ids_all)

    delete_set: set[str] = set()
    script_bad: list[tuple[dict[str, Any], str]] = []

    if not args.skip_scripts:
        _cyr = re.compile(r"[\u0400-\u04FF]")
        for poi in pois:
            why = reason_bad_name(poi.get("name"))
            if why is None and _cyr.search(str(poi.get("name") or "")):
                why = "cyrillic_any"
            if why:
                script_bad.append((poi, why))
                if poi.get("id"):
                    delete_set.add(str(poi["id"]))
        by_reason: dict[str, int] = {}
        for _, why in script_bad:
            by_reason[why] = by_reason.get(why, 0) + 1
        _safe_print(f"\nBad-script names: {len(script_bad)}")
        for k, v in sorted(by_reason.items(), key=lambda x: -x[1]):
            _safe_print(f"  {k}: {v}")
        _safe_print("Sample bad names (30):")
        for poi, why in script_bad[:30]:
            _safe_print(
                f"  [{why}] {poi.get('region')}/{poi.get('category')} :: {poi.get('name')!r}"
            )

    dupe_ids: list[str] = []
    reports: list[dict[str, Any]] = []
    if not args.skip_dupes:
        # Only consider non-script-bad rows for duplicate keep logic;
        # but still remove poorer duplicates among remaining.
        remaining = [p for p in pois if str(p.get("id")) not in delete_set]
        dupe_ids, reports = find_duplicate_ids_to_delete(remaining, photo_counts)
        for i in dupe_ids:
            delete_set.add(i)
        _safe_print(f"\nDuplicate rows to drop: {len(dupe_ids)}")
        _safe_print("Sample duplicates (25):")
        for r in reports[:25]:
            _safe_print(
                f"  KEEP score={r['keep_score']} {r['keep_name']!r} "
                f"| DROP score={r['drop_score']} {r['drop_name']!r} "
                f"({r['region']}/{r['category']})"
            )

    _safe_print(f"\nTOTAL to delete: {len(delete_set)}")
    if not args.apply:
        _safe_print("Dry-run only. Re-run with --apply to delete.")
        return

    ids = sorted(delete_set)
    _safe_print(f"Deleting {len(ids)} pois…")
    delete_pois(ids)
    _safe_print("Done.")


if __name__ == "__main__":
    main()
