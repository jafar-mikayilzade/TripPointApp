"""Encouragement push: mild-weather regions + popular plan destinations."""

from __future__ import annotations

import logging
import random
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.constants.regions import REGION_LABELS, TOURISM_FEATURED_IDS
from app.db import supabase
from app.services.push_notify import send_expo_push
from app.services.weather import fetch_region_weather

logger = logging.getLogger(__name__)

# Featured tourism belt — prefer these for weather tips
_WEATHER_CANDIDATES = [
    rid
    for rid in (
        "quba",
        "qusar",
        "seki",
        "qabala",
        "ismayilli",
        "lenkeran",
        "lerik",
        "goygol",
        "susa",
        "samaxi",
    )
    if rid in REGION_LABELS
]


def _mild_weather_regions(limit: int = 3) -> list[dict[str, Any]]:
    mild: list[dict[str, Any]] = []
    for rid in _WEATHER_CANDIDATES:
        try:
            w = fetch_region_weather(rid, days=3, start_offset=0)
        except Exception:
            logger.exception("encourage weather failed for %s", rid)
            continue
        if not w.get("ok") or not w.get("available"):
            continue
        if w.get("prefer_indoor"):
            continue
        temp = w.get("temp_c")
        try:
            t = float(temp) if temp is not None else None
        except (TypeError, ValueError):
            t = None
        # Mild outdoor window roughly 12–28°C without heavy rain bias
        if t is not None and (t < 10 or t > 32):
            continue
        mild.append(
            {
                "region": rid,
                "label": REGION_LABELS.get(rid, rid),
                "temp_c": t,
                "summary_az": w.get("summary_az") or "Hava uyğundur",
                "display_az": w.get("display_az"),
            }
        )
        if len(mild) >= limit:
            break
    return mild


def _popular_plan_region(days: int = 7) -> dict[str, Any] | None:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        rows = (
            supabase.table("app_events")
            .select("props")
            .eq("name", "plan_route_success")
            .gte("created_at", since)
            .limit(500)
            .execute()
            .data
            or []
        )
    except Exception:
        logger.exception("encourage popular region query failed")
        return None

    counts: Counter[str] = Counter()
    for row in rows:
        props = row.get("props") or {}
        if not isinstance(props, dict):
            continue
        region = str(props.get("region") or "").strip().lower()
        if region and region in REGION_LABELS:
            counts[region] += 1

    if not counts:
        # Fallback: featured tourism id
        rid = next((r for r in TOURISM_FEATURED_IDS if r in REGION_LABELS), "quba")
        return {"region": rid, "label": REGION_LABELS.get(rid, rid), "count": 0}

    rid, count = counts.most_common(1)[0]
    return {"region": rid, "label": REGION_LABELS.get(rid, rid), "count": count}


def _users_with_push(limit: int = 400) -> list[tuple[str, str]]:
    try:
        rows = (
            supabase.table("profiles")
            .select("id, expo_push_token")
            .not_.is_("expo_push_token", "null")
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception:
        logger.exception("encourage load push users failed")
        return []
    out: list[tuple[str, str]] = []
    for row in rows:
        uid = str(row.get("id") or "").strip()
        token = str(row.get("expo_push_token") or "").strip()
        if uid and token:
            out.append((uid, token))
    return out


def _insert_inbox(
    user_ids: list[str],
    *,
    kind: str,
    title: str,
    body: str,
) -> int:
    if not user_ids:
        return 0
    rows = [
        {
            "user_id": uid,
            "kind": kind,
            "title": title,
            "body": body,
            "listing_id": None,
            "actor_id": None,
        }
        for uid in user_ids
    ]
    try:
        # Batch insert (service role)
        supabase.table("notifications").insert(rows).execute()
        return len(rows)
    except Exception:
        logger.exception("encourage inbox insert failed kind=%s", kind)
        return 0


def run_encourage_notifications(*, dry_run: bool = False) -> dict[str, Any]:
    """
    Build 1–2 encouragement messages and Expo-push users with tokens.
    Intended cron: every 5 days (Railway schedule).
    """
    mild = _mild_weather_regions(limit=3)
    popular = _popular_plan_region(days=7)
    users = _users_with_push()
    user_ids = [u for u, _ in users]
    tokens = [t for _, t in users]

    messages: list[dict[str, str]] = []

    if mild:
        pick = random.choice(mild)
        label = pick["label"]
        temp_bit = (
            f" (~{int(pick['temp_c'])}°)"
            if isinstance(pick.get("temp_c"), (int, float))
            else ""
        )
        messages.append(
            {
                "kind": "weather_tip",
                "title": "Səyahət fürsəti",
                "body": (
                    f"Bu həftəsonu {label}-da mülayim hava{temp_bit} gözlənilir — "
                    f"səyahət üçün əla fürsətdir."
                ),
            }
        )

    if popular and popular.get("label"):
        label = popular["label"]
        count = int(popular.get("count") or 0)
        if count > 0:
            body = (
                f"Bu həftə ən çox səyahət planlaması {label} olub — sən də nəzər sal."
            )
        else:
            body = f"{label} bu günlərdə populyardır — yeni marşrut planlamağa dəyər."
        messages.append(
            {
                "kind": "explore_region",
                "title": "Kəşf et",
                "body": body,
            }
        )

    if not messages:
        messages.append(
            {
                "kind": "system_tip",
                "title": "TripPoint",
                "body": "Yeni AI marşrut və İcma elanlarına baxın — növbəti səyahətinizə hazır olun.",
            }
        )

    # Alternate tips across the user base when multiple messages exist
    chosen = random.choice(messages)

    result: dict[str, Any] = {
        "ok": True,
        "dry_run": dry_run,
        "users": len(user_ids),
        "mild_regions": [m["region"] for m in mild],
        "popular": popular,
        "chosen": chosen,
        "inbox_inserted": 0,
        "push": {"sent": 0, "requested": 0},
    }

    if dry_run or not user_ids:
        return result

    inbox_n = _insert_inbox(
        user_ids,
        kind=chosen["kind"],
        title=chosen["title"],
        body=chosen["body"],
    )
    result["inbox_inserted"] = inbox_n

    push = send_expo_push(
        tokens,
        title=chosen["title"],
        body=chosen["body"],
        data={"kind": chosen["kind"], "source": "encourage_job"},
    )
    result["push"] = push
    return result
