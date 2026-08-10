"""Apply critical ratings + poi_photos RLS fix when DATABASE_URL is set.

Usage (from apps/api):
  set DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres
  python -m scripts.apply_fix_ratings_sql
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SQL_PATH = (
    Path(__file__).resolve().parents[2]
    / "mobile"
    / "supabase"
    / "migrations"
    / "20260810_fix_ratings_and_poi_photo_insert.sql"
)


def main() -> int:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url or database_url in {"osm", "mock"}:
        print(
            "DATABASE_URL lazımdır (Supabase → Project Settings → Database → URI).\n"
            f"Alternativ: SQL Editor-də bu faylı işə salın:\n  {SQL_PATH}"
        )
        if SQL_PATH.exists():
            print("\n--- SQL ---\n")
            print(SQL_PATH.read_text(encoding="utf-8"))
        return 1

    try:
        import psycopg  # type: ignore
    except ImportError:
        print("psycopg yoxdur. Quraşdırın: pip install 'psycopg[binary]'")
        return 1

    sql = SQL_PATH.read_text(encoding="utf-8")
    with psycopg.connect(database_url) as conn:
        conn.execute(sql)
        conn.commit()
    print("OK: ratings + poi_photos INSERT policy applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
