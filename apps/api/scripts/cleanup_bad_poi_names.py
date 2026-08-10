"""Delete POIs whose names are not clear Azerbaijani / English Latin script.

Detects Cyrillic, Arabic/Persian, CJK, mojibake, and other unintelligible labels.
Usage:
  python -m scripts.cleanup_bad_poi_names           # dry-run
  python -m scripts.cleanup_bad_poi_names --apply   # delete
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

import app.ssl_insecure  # noqa: E402, F401
from app.db import supabase  # noqa: E402
from app.services.places_tourism_filter import name_has_forbidden_script  # noqa: E402

# Allowed letters: Latin + Azerbaijani diacritics
_ALLOWED_LETTER_RE = re.compile(
    r"[A-Za-zÀ-ÖØ-öø-ÿƏəİıÖöÜüŞşÇçĞğ]"
)
_ANY_LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)
_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
_CJK_RE = re.compile(r"[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]")
_MOJIBAKE_RE = re.compile(
    r"(?:Ã.|Â.|Ð.|Ñ.|�|â€|ï¿½|\uFFFD|Ã¼|Ã¶|Ã§|Ð°|Ð¾|Ñ\x81)"
)
# Random OSM garbage: long runs of consonants without vowels, hex ids, etc.
_VOWEL_RE = re.compile(r"[AEIİIOÖOUÜaeıioöouüƏə]", re.IGNORECASE)


def reason_bad_name(name: str | None) -> str | None:
    if not name or not str(name).strip():
        return "empty"
    name_s = str(name).strip()
    if len(name_s) < 2:
        return "too_short"
    if name_s.isdigit():
        return "digits_only"
    if _MOJIBAKE_RE.search(name_s) or "\ufffd" in name_s:
        return "mojibake"
    if _CJK_RE.search(name_s):
        return "cjk"
    # Armenian / Georgian blocks (not covered well by "forbidden ratio" alone)
    if re.search(r"[\u0530-\u058F\u10A0-\u10FF]", name_s):
        return "armenian_georgian"
    if _ARABIC_RE.search(name_s):
        return "arabic"
    if name_has_forbidden_script(name_s):
        return "forbidden_script"
    # Cyrillic: only when a meaningful share (avoid killing Latin AZ with one lookalike ә/с)
    letters = _ANY_LETTER_RE.findall(name_s)
    if not letters:
        return "no_letters"
    cyr = sum(1 for ch in letters if _CYRILLIC_RE.match(ch))
    if cyr > 0 and (cyr / len(letters)) >= 0.15:
        return "cyrillic"

    allowed = _ALLOWED_LETTER_RE.findall(name_s)
    # If majority of letter chars are outside AZ/EN Latin → drop
    if len(allowed) / max(len(letters), 1) < 0.7:
        return "mixed_script"

    # Garbled latin: almost no vowels in a long alpha string
    alpha_only = "".join(ch for ch in name_s if ch.isalpha())
    if len(alpha_only) >= 8 and not _VOWEL_RE.search(alpha_only):
        return "no_vowels"

    return None


def fetch_all_pois() -> list[dict]:
    rows: list[dict] = []
    page = 0
    page_size = 1000
    while True:
        start = page * page_size
        end = start + page_size - 1
        res = (
            supabase.table("pois")
            .select("id, name, category, region, status, place_id")
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


def delete_pois(ids: list[str]) -> int:
    deleted = 0
    # Also clear dependent photos first (if no ON DELETE CASCADE)
    for i in range(0, len(ids), 50):
        batch = ids[i : i + 50]
        try:
            supabase.table("poi_photos").delete().in_("poi_id", batch).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"  warn poi_photos: {exc}")
        supabase.table("pois").delete().in_("id", batch).execute()
        deleted += len(batch)
        print(f"  deleted {deleted}/{len(ids)}")
    return deleted


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete (default is dry-run)",
    )
    args = parser.parse_args()

    print("Fetching pois…")
    pois = fetch_all_pois()
    print(f"Total: {len(pois)}")

    bad: list[tuple[dict, str]] = []
    for poi in pois:
        why = reason_bad_name(poi.get("name"))
        if why:
            bad.append((poi, why))

    by_reason: dict[str, int] = {}
    for _, why in bad:
        by_reason[why] = by_reason.get(why, 0) + 1

    print(f"Bad names: {len(bad)}")
    for k, v in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")

    print("\nSample (up to 40):")
    for poi, why in bad[:40]:
        print(
            f"  [{why}] {poi.get('region')} / {poi.get('category')} :: {poi.get('name')!r}"
        )

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to delete.")
        return

    ids = [str(p["id"]) for p, _ in bad if p.get("id")]
    print(f"\nDeleting {len(ids)} pois…")
    delete_pois(ids)
    print("Done.")


if __name__ == "__main__":
    main()
