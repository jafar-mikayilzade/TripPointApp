"""Telegram user bot — guest + optional app link + AI/manual (inline UX).

Sessions persist in Supabase `bot_sessions` (survives Railway restart).
# TODO: optional email OTP (not required).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.constants.regions import REGION_DB_ID
from app.db import supabase
from app.services.bot_sessions import (
    clear_session as _db_clear_session,
    get_last_plan,
    load_session,
    save_last_plan,
    save_session,
)
from app.services.plan_route_run import (
    BOT_REGION_KEYS,
    REGION_EMOJI,
    REGION_LABELS,
    format_plan_for_telegram,
    run_plan_route,
)
from app.services.telegram_notify import (
    answer_callback_query,
    edit_telegram_message,
    send_telegram_message,
)

logger = logging.getLogger(__name__)

# Hot cache in front of Postgres; bounded so a busy bot cannot grow unbounded.
# Evicted entries are reloaded by load_session() on the next update — no data loss.
_SESSION_CACHE: dict[str, dict[str, Any]] = {}
_SESSION_CACHE_MAX = 200


def _remember_session(key: str, session: dict[str, Any]) -> None:
    if key in _SESSION_CACHE:
        del _SESSION_CACHE[key]
    elif len(_SESSION_CACHE) >= _SESSION_CACHE_MAX:
        _SESSION_CACHE.pop(next(iter(_SESSION_CACHE)), None)
    _SESSION_CACHE[key] = session

MAX_MANUAL_STOPS = 8
POI_PAGE_SIZE = 8
LISTINGS_LIMIT = 12
FAVORITES_LIMIT = 15

BTN_AI = "🤖 AI marşrut"
BTN_MANUAL = "🗺️ Manual marşrut"
BTN_LAST = "📄 Son marşrut"
BTN_HELP = "ℹ️ Kömək"
BTN_LINK_APP = "🔗 App hesabı bağla"
BTN_ICMA = "👥 İcma"
BTN_FAVS = "⭐ Sevimlilər"
BTN_ADMIN = "🛡 Admin"
BTN_CANCEL = "❌ Ləğv et"
BTN_DONE = "✅ Hazır"
BTN_SKIP_LOC = "❌ Keç"
BTN_SHARE_LOC = "📍 Lokasiyamı göndər"

INTERESTS: list[tuple[str, str]] = [
    ("nature", "Təbiət"),
    ("history", "Tarixi"),
]

LISTING_TYPE_EMOJI: dict[str, str] = {
    "tour": "🏕",
    "carpool": "🚗",
    "local_service": "🛎",
}

FLOW_KEYBOARD: dict[str, Any] = {
    "keyboard": [[{"text": BTN_CANCEL}]],
    "resize_keyboard": True,
}

MANUAL_KEYBOARD: dict[str, Any] = {
    "keyboard": [[{"text": BTN_DONE}, {"text": BTN_CANCEL}]],
    "resize_keyboard": True,
}

LOCATION_KEYBOARD: dict[str, Any] = {
    "keyboard": [
        [{"text": BTN_SHARE_LOC, "request_location": True}],
        [{"text": BTN_SKIP_LOC}],
    ],
    "resize_keyboard": True,
    "one_time_keyboard": True,
}


def _ik(rows: list[list[dict[str, str]]]) -> dict[str, Any]:
    return {"inline_keyboard": rows}


def _btn(text: str, data: str) -> dict[str, str]:
    return {"text": text[:64], "callback_data": data[:64]}


def _chat_key(chat_id: str | int) -> str:
    return str(chat_id)


def _reply(
    chat_id: str | int,
    text: str,
    *,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    send_telegram_message(text, chat_id=chat_id, reply_markup=reply_markup)


def _edit_or_reply(
    chat_id: str | int,
    text: str,
    *,
    message_id: int | None,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    if message_id is not None and edit_telegram_message(
        chat_id, message_id, text, reply_markup=reply_markup
    ):
        return
    _reply(chat_id, text, reply_markup=reply_markup)


def _clear_session(chat_id: str | int) -> None:
    key = _chat_key(chat_id)
    _SESSION_CACHE.pop(key, None)
    _db_clear_session(chat_id)


def _get_session(chat_id: str | int) -> dict[str, Any]:
    key = _chat_key(chat_id)
    if key not in _SESSION_CACHE:
        _remember_session(key, load_session(key))
    return _SESSION_CACHE[key]


def _set_session(chat_id: str | int, session: dict[str, Any]) -> None:
    key = _chat_key(chat_id)
    _remember_session(key, session)
    save_session(key, session)


def _flush_session(chat_id: str | int) -> None:
    key = _chat_key(chat_id)
    if key in _SESSION_CACHE:
        save_session(key, _SESSION_CACHE[key])


def _save_last(chat_id: str | int, text: str) -> None:
    save_last_plan(chat_id, text)
    # Keep cache in sync
    session = _get_session(chat_id)
    session["last_plan"] = text


def _is_admin_user(user_id: str | None) -> bool:
    if not user_id:
        return False
    try:
        rows = (
            supabase.table("profiles")
            .select("role")
            .eq("id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        return bool(rows) and str(rows[0].get("role") or "") == "admin"
    except Exception:
        logger.exception("lookup admin role failed")
        return False


def _resolve_profile_id(email_or_id: str) -> str | None:
    key = (email_or_id or "").strip()
    if not key:
        return None
    try:
        if "@" in key:
            rows = (
                supabase.table("profiles")
                .select("id")
                .ilike("email", key)
                .limit(1)
                .execute()
                .data
                or []
            )
        else:
            rows = (
                supabase.table("profiles")
                .select("id")
                .eq("id", key)
                .limit(1)
                .execute()
                .data
                or []
            )
        if rows and rows[0].get("id"):
            return str(rows[0]["id"])
    except Exception:
        logger.exception("resolve profile failed %s", key)
    return None


def _admin_set_verified(email_or_id: str, *, verified: bool) -> tuple[bool, str]:
    pid = _resolve_profile_id(email_or_id)
    if not pid:
        return False, "Profil tapılmadı."
    patch: dict[str, Any] = {
        "is_verified": verified,
        "verified_at": datetime.now(timezone.utc).isoformat() if verified else None,
    }
    try:
        supabase.table("profiles").update(patch).eq("id", pid).execute()
        return True, ("Təsdiqləndi: " if verified else "Təsdiq götürüldü: ") + pid
    except Exception:
        logger.exception("set verified failed")
        return False, "Yeniləmə uğursuz oldu."


def _admin_set_sponsored(
    poi_id: str, *, sponsored: bool, days: int = 30
) -> tuple[bool, str]:
    pid = (poi_id or "").strip()
    if not pid:
        return False, "poi_uuid lazımdır."
    until = None
    if sponsored:
        until = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    patch: dict[str, Any] = {
        "is_sponsored": sponsored,
        "sponsor_until": until,
    }
    try:
        res = supabase.table("pois").update(patch).eq("id", pid).execute()
        if not (res.data or []):
            # some clients return empty data; verify exists
            check = (
                supabase.table("pois").select("id").eq("id", pid).limit(1).execute().data
                or []
            )
            if not check:
                return False, "POI tapılmadı."
        if sponsored:
            return True, f"Sponsor aktiv: {pid} ({days} gün)"
        return True, f"Sponsor silindi: {pid}"
    except Exception:
        logger.exception("set sponsored failed")
        return False, "Yeniləmə uğursuz oldu."


def _main_keyboard(chat_id: str | int) -> dict[str, Any]:
    user_id = _lookup_user_id(chat_id)
    linked = bool(user_id)
    rows: list[list[dict[str, str]]] = [
        [{"text": BTN_AI}, {"text": BTN_MANUAL}],
        [{"text": BTN_LAST}, {"text": BTN_HELP}],
    ]
    if linked:
        rows.append([{"text": BTN_ICMA}, {"text": BTN_FAVS}])
        if _is_admin_user(user_id):
            rows.append([{"text": BTN_ADMIN}])
    else:
        rows.append([{"text": BTN_LINK_APP}])
    return {"keyboard": rows, "resize_keyboard": True}


def _ai_result_keyboard() -> dict[str, Any]:
    return _ik(
        [
            [
                _btn("🔄 Yenidən", "ai:again"),
                _btn("✏️ Dəyiş", "ai:edit"),
                _btn("🏠 Menyu", "menu"),
            ]
        ]
    )


def _region_inline(prefix: str) -> dict[str, Any]:
    rows: list[list[dict[str, str]]] = []
    row: list[dict[str, str]] = []
    for key in BOT_REGION_KEYS:
        emoji = REGION_EMOJI.get(key, "📍")
        label = REGION_LABELS.get(key, key)
        row.append(_btn(f"{emoji} {label}", f"{prefix}:{key}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([_btn("🏠 Menyu", "menu")])
    return _ik(rows)


def _days_inline() -> dict[str, Any]:
    row = [_btn(f"{i} gün", f"ai:d:{i}") for i in range(1, 8)]
    return _ik([row[:4], row[4:], [_btn("🏠 Menyu", "menu")]])


def _budget_inline() -> dict[str, Any]:
    return _ik(
        [
            [
                _btn("Ekonom", "ai:b:budget"),
                _btn("Orta", "ai:b:mid"),
                _btn("Premium", "ai:b:premium"),
            ],
            [_btn("🏠 Menyu", "menu")],
        ]
    )


def _interests_inline(selected: list[str]) -> dict[str, Any]:
    rows: list[list[dict[str, str]]] = []
    row: list[dict[str, str]] = []
    for key, label in INTERESTS:
        mark = "✅ " if key in selected else ""
        row.append(_btn(f"{mark}{label}", f"ai:i:{key}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([_btn("✅ Hazır", "ai:i_done"), _btn("🏠 Menyu", "menu")])
    return _ik(rows)


def _from_origin_inline() -> dict[str, Any]:
    return _ik(
        [
            [
                _btn("✅ Bəli — cari məkandan", "ai:fo:1"),
                _btn("❌ Xeyr", "ai:fo:0"),
            ],
            [_btn("🏠 Menyu", "menu")],
        ]
    )


def _manual_poi_keyboard(
    choices: list[dict[str, Any]],
    *,
    offset: int,
    has_more: bool,
) -> dict[str, Any]:
    rows: list[list[dict[str, str]]] = []
    for i, poi in enumerate(choices):
        name = str(poi.get("name") or "Məkan")[:40]
        rows.append([_btn(f"➕ {name}", f"man:a:{offset + i}")])
    nav: list[dict[str, str]] = []
    if offset > 0:
        nav.append(_btn("⬅️ Əvvəl", f"man:p:{max(0, offset - POI_PAGE_SIZE)}"))
    if has_more:
        nav.append(_btn("➡️ Daha", f"man:p:{offset + POI_PAGE_SIZE}"))
    if nav:
        rows.append(nav)
    rows.append([_btn("✅ Hazır", "man:done"), _btn("🏠 Menyu", "menu")])
    return _ik(rows)


def _ensure_telegram_user(
    chat_id: str | int,
    *,
    username: str | None = None,
) -> None:
    chat_s = str(chat_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        existing = (
            supabase.table("telegram_users")
            .select("telegram_chat_id")
            .eq("telegram_chat_id", chat_s)
            .limit(1)
            .execute()
        )
        if existing.data:
            update_payload: dict[str, Any] = {"last_seen_at": now_iso}
            if username:
                update_payload["username"] = username
            supabase.table("telegram_users").update(update_payload).eq(
                "telegram_chat_id", chat_s
            ).execute()
        else:
            payload: dict[str, Any] = {
                "telegram_chat_id": chat_s,
                "created_at": now_iso,
                "last_seen_at": now_iso,
            }
            if username:
                payload["username"] = username
            supabase.table("telegram_users").insert(payload).execute()
    except Exception:
        logger.warning("ensure telegram_users failed", exc_info=True)


def _lookup_user_id(chat_id: str | int) -> str | None:
    chat_s = str(chat_id)
    try:
        res = (
            supabase.table("telegram_users")
            .select("linked_user_id")
            .eq("telegram_chat_id", chat_s)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows and rows[0].get("linked_user_id"):
            return str(rows[0]["linked_user_id"])
    except Exception:
        logger.exception("lookup linked_user_id failed")
    try:
        res = (
            supabase.table("profiles")
            .select("id")
            .eq("telegram_chat_id", chat_s)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            return str(rows[0]["id"])
    except Exception:
        logger.exception("lookup profiles telegram failed")
    return None


def _link_account(chat_id: str | int, code: str) -> tuple[bool, str]:
    code_clean = (code or "").strip()
    if not code_clean or len(code_clean) > 64:
        return False, "Kod düzgün deyil. App-də yenidən «Telegram bağla» basın."
    try:
        res = (
            supabase.table("telegram_link_codes")
            .select("code, user_id, expires_at")
            .eq("code", code_clean)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return False, "Kod tapılmadı və ya artıq istifadə olunub."

        row = rows[0]
        expires_at = row.get("expires_at")
        if expires_at:
            try:
                exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < datetime.now(timezone.utc):
                    supabase.table("telegram_link_codes").delete().eq(
                        "code", code_clean
                    ).execute()
                    return False, "Kodun müddəti bitib. App-də yenidən bağlayın."
            except ValueError:
                pass

        user_id = str(row["user_id"])
        chat_s = str(chat_id)
        now_iso = datetime.now(timezone.utc).isoformat()

        supabase.table("profiles").update(
            {"telegram_chat_id": None, "telegram_linked_at": None}
        ).eq("telegram_chat_id", chat_s).execute()
        supabase.table("profiles").update(
            {"telegram_chat_id": chat_s, "telegram_linked_at": now_iso}
        ).eq("id", user_id).execute()

        try:
            supabase.table("telegram_users").update({"linked_user_id": None}).eq(
                "linked_user_id", user_id
            ).execute()
            _ensure_telegram_user(chat_id)
            supabase.table("telegram_users").update({"linked_user_id": user_id}).eq(
                "telegram_chat_id", chat_s
            ).execute()
        except Exception:
            logger.warning("telegram_users link update failed", exc_info=True)

        supabase.table("telegram_link_codes").delete().eq("code", code_clean).execute()
        return True, "App hesabı bağlandı ✅"
    except Exception:
        logger.exception("link_account failed")
        return False, "Bağlama alınmadı."


def _help_text(chat_id: str | int) -> str:
    user_id = _lookup_user_id(chat_id)
    linked = bool(user_id)
    lines = [
        "TripPoint bot (app lazım deyil)",
        "",
        f"{BTN_AI} — region/gün/büdcə/maraq (düymələrlə)",
        f"{BTN_MANUAL} — rayondan məkan seçib marşrut",
        f"{BTN_LAST} — son marşrut",
        "Cari məkandan: AI-də «Bəli» → lokasiya paylaş",
    ]
    if linked:
        lines.append(f"{BTN_ICMA} — Tur / Carpool / Yerli xidmət")
        lines.append(f"{BTN_FAVS} — Elanlar / Yerlər / Marşrutlar / Abunə / Bildiriş")
        if _is_admin_user(user_id):
            lines.append(f"{BTN_ADMIN} — Məkan / Şəkil / Şikayət növbələri")
            lines.append("/verify email|uuid — profil badge")
            lines.append("/unverify email|uuid")
            lines.append("/sponsor poi_uuid [gün] — sponsor (default 30)")
            lines.append("/unsponsor poi_uuid")
    else:
        lines.append(f"{BTN_LINK_APP} — opsional app birləşdirmə")
    return "\n".join(lines)


def _admin_menu_keyboard() -> dict[str, Any]:
    return _ik(
        [
            [
                _btn("📍 Məkanlar", "adm:pois"),
                _btn("🖼 Şəkillər", "adm:photos"),
            ],
            [_btn("🚩 Şikayətlər", "adm:reports")],
            [_btn("🏠 Menyu", "menu")],
        ]
    )


def _item_action_keyboard(entity: str, target_id: str) -> dict[str, Any]:
    """Per-item approve/reject under Admin növbə."""
    if entity == "rep":
        return _ik(
            [
                [
                    _btn("✅ Bağla", f"adm:ok:rep:{target_id}"),
                    _btn("🗑 Elanı sil", f"adm:dl:rep:{target_id}"),
                ],
                [_btn("⬅️ Növbə", "adm:reports")],
            ]
        )
    return _ik(
        [
            [
                _btn("✅ Təsdiq", f"adm:ok:{entity}:{target_id}"),
                _btn("❌ Rədd", f"adm:no:{entity}:{target_id}"),
            ],
            [
                _btn(
                    "⬅️ Növbə",
                    "adm:pois"
                    if entity == "poi"
                    else "adm:photos"
                    if entity == "pho"
                    else "adm:home",
                )
            ],
        ]
    )


def _fetch_admin_counts() -> dict[str, int]:
    counts = {"pois": 0, "photos": 0, "reports": 0}
    try:
        pois = (
            supabase.table("pois")
            .select("id", count="exact")
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        counts["pois"] = int(pois.count or 0)
    except Exception:
        logger.exception("admin count pois failed")
    try:
        photos = (
            supabase.table("poi_photos")
            .select("id", count="exact")
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        counts["photos"] = int(photos.count or 0)
    except Exception:
        logger.exception("admin count photos failed")
    try:
        reports = (
            supabase.table("listing_reports")
            .select("id", count="exact")
            .eq("status", "open")
            .limit(1)
            .execute()
        )
        counts["reports"] = int(reports.count or 0)
    except Exception:
        logger.exception("admin count reports failed")
    return counts


def _show_admin_home(
    chat_id: str | int,
    *,
    message_id: int | None = None,
) -> None:
    user_id = _lookup_user_id(chat_id)
    if not _is_admin_user(user_id):
        _edit_or_reply(
            chat_id,
            "Bu bölmə yalnız admin üçündür.",
            message_id=message_id,
            reply_markup=_ik([[_btn("🏠 Menyu", "menu")]]),
        )
        return
    counts = _fetch_admin_counts()
    text = (
        "🛡 Admin nəzarəti\n\n"
        f"📍 Gözləyən məkan: {counts['pois']}\n"
        f"🖼 Gözləyən şəkil: {counts['photos']}\n"
        f"🚩 Açıq şikayət: {counts['reports']}\n\n"
        "Növbəni açın — hər elementdə ✅ / ❌ düymələri var.\n"
        "Yeni hadisələr də birbaşa TG mesajı kimi gəlir."
    )
    _edit_or_reply(
        chat_id,
        text,
        message_id=message_id,
        reply_markup=_admin_menu_keyboard(),
    )


def _show_admin_queue(
    chat_id: str | int,
    kind: str,
    *,
    message_id: int | None = None,
) -> None:
    user_id = _lookup_user_id(chat_id)
    if not _is_admin_user(user_id):
        _edit_or_reply(
            chat_id,
            "Bu bölmə yalnız admin üçündür.",
            message_id=message_id,
            reply_markup=_ik([[_btn("🏠 Menyu", "menu")]]),
        )
        return

    try:
        if kind == "pois":
            rows = (
                supabase.table("pois")
                .select("id, name, region, category")
                .eq("status", "pending")
                .order("created_at", desc=True)
                .limit(5)
                .execute()
                .data
                or []
            )
            title = "📍 Gözləyən məkanlar"
            if not rows:
                _edit_or_reply(
                    chat_id,
                    f"{title}\n\nBoş növbə.",
                    message_id=message_id,
                    reply_markup=_admin_menu_keyboard(),
                )
                return
            _edit_or_reply(
                chat_id,
                f"{title}\nAşağıda {len(rows)} element — hər birində təsdiq/rədd:",
                message_id=message_id,
                reply_markup=_admin_menu_keyboard(),
            )
            for row in rows:
                pid = str(row.get("id") or "")
                text = (
                    f"📍 {row.get('name') or '—'}\n"
                    f"Region: {row.get('region') or '—'}\n"
                    f"Kateqoriya: {row.get('category') or '—'}"
                )
                _reply(chat_id, text, reply_markup=_item_action_keyboard("poi", pid))
            return

        if kind == "photos":
            rows = (
                supabase.table("poi_photos")
                .select("id, poi_id, photo_url")
                .eq("status", "pending")
                .order("created_at", desc=True)
                .limit(5)
                .execute()
                .data
                or []
            )
            title = "🖼 Gözləyən şəkillər"
            if not rows:
                _edit_or_reply(
                    chat_id,
                    f"{title}\n\nBoş növbə.",
                    message_id=message_id,
                    reply_markup=_admin_menu_keyboard(),
                )
                return
            poi_ids = list({str(r.get("poi_id")) for r in rows if r.get("poi_id")})
            name_by_id: dict[str, str] = {}
            if poi_ids:
                pois = (
                    supabase.table("pois")
                    .select("id, name")
                    .in_("id", poi_ids)
                    .execute()
                    .data
                    or []
                )
                name_by_id = {str(p["id"]): str(p.get("name") or "Məkan") for p in pois}
            _edit_or_reply(
                chat_id,
                f"{title}\nAşağıda {len(rows)} element:",
                message_id=message_id,
                reply_markup=_admin_menu_keyboard(),
            )
            for row in rows:
                pid = str(row.get("id") or "")
                poi_name = name_by_id.get(str(row.get("poi_id") or ""), "Məkan")
                url = str(row.get("photo_url") or "").strip()
                text = f"🖼 {poi_name}"
                if url:
                    text += f"\n{url}"
                _reply(chat_id, text, reply_markup=_item_action_keyboard("pho", pid))
            return

        # reports
        rows = (
            supabase.table("listing_reports")
            .select("id, reason, details, listing_id")
            .eq("status", "open")
            .order("created_at", desc=True)
            .limit(5)
            .execute()
            .data
            or []
        )
        title = "🚩 Açıq şikayətlər"
        if not rows:
            _edit_or_reply(
                chat_id,
                f"{title}\n\nBoş növbə.",
                message_id=message_id,
                reply_markup=_admin_menu_keyboard(),
            )
            return
        listing_ids = list({str(r.get("listing_id")) for r in rows if r.get("listing_id")})
        title_by_id: dict[str, str] = {}
        if listing_ids:
            listings = (
                supabase.table("listings")
                .select("id, title")
                .in_("id", listing_ids)
                .execute()
                .data
                or []
            )
            title_by_id = {
                str(l["id"]): str(l.get("title") or "Elan") for l in listings
            }
        _edit_or_reply(
            chat_id,
            f"{title}\nAşağıda {len(rows)} element:",
            message_id=message_id,
            reply_markup=_admin_menu_keyboard(),
        )
        for row in rows:
            rid = str(row.get("id") or "")
            listing_title = title_by_id.get(str(row.get("listing_id") or ""), "Elan")
            reason = str(row.get("reason") or "digər")
            details = str(row.get("details") or "").strip()
            text = f"🚩 {listing_title}\nSəbəb: {reason}"
            if details:
                text += f"\n{details[:200]}"
            _reply(chat_id, text, reply_markup=_item_action_keyboard("rep", rid))
    except Exception:
        logger.exception("admin queue %s failed", kind)
        _edit_or_reply(
            chat_id,
            "Növbə yüklənmədi. Bir az sonra yenidən yoxlayın.",
            message_id=message_id,
            reply_markup=_admin_menu_keyboard(),
        )


def _admin_moderate(
    action: str,
    entity: str,
    target_id: str,
) -> tuple[bool, str]:
    """Apply moderation. Returns (ok, user_message)."""
    tid = (target_id or "").strip()
    if not tid:
        return False, "ID yoxdur"

    try:
        if entity == "poi":
            status = "approved" if action == "ok" else "rejected"
            supabase.table("pois").update(
                {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", tid).execute()
            return True, f"Məkan {('təsdiqləndi' if action == 'ok' else 'rədd edildi')} ✅"

        if entity == "pho":
            status = "approved" if action == "ok" else "rejected"
            supabase.table("poi_photos").update({"status": status}).eq("id", tid).execute()
            return True, f"Şəkil {('təsdiqləndi' if action == 'ok' else 'rədd edildi')} ✅"

        if entity == "rep":
            if action == "ok":
                supabase.table("listing_reports").update({"status": "dismissed"}).eq(
                    "id", tid
                ).execute()
                return True, "Şikayət bağlandı ✅"
            if action == "dl":
                rep = (
                    supabase.table("listing_reports")
                    .select("listing_id")
                    .eq("id", tid)
                    .limit(1)
                    .execute()
                    .data
                    or []
                )
                listing_id = str(rep[0].get("listing_id") or "") if rep else ""
                if listing_id:
                    try:
                        supabase.rpc("cancel_listing", {"p_listing_id": listing_id}).execute()
                    except Exception:
                        supabase.table("listings").update({"status": "cancelled"}).eq(
                            "id", listing_id
                        ).execute()
                supabase.table("listing_reports").update({"status": "actioned"}).eq(
                    "id", tid
                ).execute()
                return True, "Elan ləğv edildi, şikayət bağlandı ✅"
            return False, "Naməlum əməliyyat"

        return False, "Naməlum tip"
    except Exception:
        logger.exception("admin_moderate failed %s %s %s", action, entity, tid)
        return False, "Əməliyyat alınmadı"


def _handle_admin_callback(
    chat_id: str | int,
    data: str,
    *,
    message_id: int | None = None,
    callback_query_id: str | None = None,
) -> bool:
    if data == "adm:home":
        _show_admin_home(chat_id, message_id=message_id)
        return True
    if data in {"adm:pois", "adm:photos", "adm:reports"}:
        _show_admin_queue(chat_id, data.split(":")[-1], message_id=message_id)
        return True

    # adm:ok:poi:UUID | adm:no:poi:UUID | adm:ok:pho:UUID | adm:dl:rep:UUID
    parts = data.split(":")
    if len(parts) == 4 and parts[0] == "adm" and parts[1] in {"ok", "no", "dl"}:
        user_id = _lookup_user_id(chat_id)
        if not _is_admin_user(user_id):
            if callback_query_id:
                answer_callback_query(callback_query_id, text="Yalnız admin")
            return True
        action, entity, target_id = parts[1], parts[2], parts[3]
        ok, msg = _admin_moderate(action, entity, target_id)
        if callback_query_id:
            answer_callback_query(callback_query_id, text=msg[:180])
        if message_id is not None:
            edit_telegram_message(
                chat_id,
                message_id,
                f"🛡 {msg}",
                reply_markup={"inline_keyboard": []},
            )
        else:
            _reply(chat_id, msg, reply_markup=_admin_menu_keyboard())
        return True

    return False


def _show_main_menu(chat_id: str | int, preface: str | None = None) -> None:
    text = (preface + "\n\n" if preface else "") + "Nə etmək istəyirsiniz?"
    _reply(chat_id, text, reply_markup=_main_keyboard(chat_id))


def _show_ai_home(
    chat_id: str | int,
    *,
    message_id: int | None = None,
) -> None:
    """AI starts directly with region select (no preset templates)."""
    _set_session(
        chat_id,
        {
            "mode": "ai",
            "step": "region",
            "data": {"interests": [], "group_type": "solo"},
        },
    )
    _edit_or_reply(
        chat_id,
        "🤖 AI marşrut — region seçin:",
        message_id=message_id,
        reply_markup=_region_inline("ai:r"),
    )


def _run_and_send_plan(chat_id: str | int, data: dict[str, Any]) -> None:
    _reply(chat_id, "⏳ Marşrut hazırlanır…", reply_markup=_main_keyboard(chat_id))
    try:
        plan = run_plan_route(
            region=str(data["region"]),
            days=int(data["days"]),
            budget=str(data.get("budget") or "mid"),
            interests=list(data.get("interests") or []),
            group_type=str(data.get("group_type") or "solo"),
            from_origin=bool(data.get("from_origin")),
            origin_lat=data.get("origin_lat"),
            origin_lng=data.get("origin_lng"),
        )
        text = format_plan_for_telegram(plan)
        _save_last(chat_id, text)
        _clear_session(chat_id)
        _reply(chat_id, text, reply_markup=_ai_result_keyboard())
    except ValueError as exc:
        _clear_session(chat_id)
        _reply(chat_id, f"Xəta: {exc}", reply_markup=_main_keyboard(chat_id))
    except Exception:
        logger.exception("AI plan failed")
        _clear_session(chat_id)
        _reply(
            chat_id,
            "Marşrut hazırlanmadı. Bir az sonra yenidən yoxlayın.",
            reply_markup=_main_keyboard(chat_id),
        )


def _ask_from_origin(chat_id: str | int, message_id: int | None) -> None:
    session = _get_session(chat_id)
    session["mode"] = "ai"
    session["step"] = "from_origin"
    _edit_or_reply(
        chat_id,
        "🚗 Cari məkandan gedirsiniz?\n"
        "(App-dəki «Cari məkandan gedirəm» — yol vaxtı üçün)",
        message_id=message_id,
        reply_markup=_from_origin_inline(),
    )


def _request_location(chat_id: str | int) -> None:
    session = _get_session(chat_id)
    session["step"] = "await_location"
    _reply(
        chat_id,
        "📍 Lokasiyanızı paylaşın (düymə) və ya «Keç» basın.",
        reply_markup=LOCATION_KEYBOARD,
    )


def _list_region_pois(
    region_key: str,
    *,
    offset: int = 0,
    limit: int = POI_PAGE_SIZE,
    query: str = "",
) -> tuple[list[dict[str, Any]], bool]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    q = (query or "").strip()
    try:
        qb = (
            supabase.table("pois")
            .select("id, name, region, category")
            .eq("region", db_region)
            .eq("status", "approved")
            .order("name")
        )
        if q:
            qb = qb.ilike("name", f"%{q}%")
        # fetch one extra to know if more pages
        res = qb.range(offset, offset + limit).execute()
        rows = list(res.data or [])
        has_more = len(rows) > limit
        return rows[:limit], has_more
    except Exception:
        logger.exception("list region pois failed")
        return [], False


def _show_manual_poi_page(
    chat_id: str | int,
    *,
    message_id: int | None,
    offset: int = 0,
) -> None:
    session = _get_session(chat_id)
    data = session.setdefault("data", {})
    region = str(data.get("region") or "")
    stops: list[str] = list(data.get("stops") or [])
    pois, has_more = _list_region_pois(region, offset=offset)
    data["poi_page"] = pois
    data["poi_offset"] = offset
    label = REGION_LABELS.get(region, region)
    stop_line = f"Seçilib: {len(stops)}/{MAX_MANUAL_STOPS}"
    if stops:
        stop_line += " — " + ", ".join(stops[-3:])
    if not pois:
        text = (
            f"🗺️ {label}\n{stop_line}\n\n"
            "Bu rayonda təsdiqlənmiş məkan tapılmadı.\n"
            "Ad yazıb əlavə edə və ya «Hazır» basın."
        )
        _edit_or_reply(
            chat_id,
            text,
            message_id=message_id,
            reply_markup=_ik(
                [[_btn("✅ Hazır", "man:done"), _btn("🏠 Menyu", "menu")]]
            ),
        )
        return

    text = (
        f"🗺️ {label} — məkan seçin\n{stop_line}\n\n"
        "Düyməyə basın. Ad da yaza bilərsiniz. Bitirəndə ✅ Hazır."
    )
    _edit_or_reply(
        chat_id,
        text,
        message_id=message_id,
        reply_markup=_manual_poi_keyboard(pois, offset=offset, has_more=has_more),
    )
    if message_id is None:
        _reply(chat_id, "Ad yazmaq / ✅ Hazır:", reply_markup=MANUAL_KEYBOARD)


def _start_manual(chat_id: str | int, message_id: int | None = None) -> None:
    _set_session(
        chat_id,
        {
            "mode": "manual",
            "step": "region",
            "data": {"stops": []},
        },
    )
    _edit_or_reply(
        chat_id,
        "🗺️ Manual marşrut — region seçin:",
        message_id=message_id,
        reply_markup=_region_inline("man:r"),
    )


def _finish_manual(chat_id: str | int) -> None:
    session = _get_session(chat_id)
    data = session.get("data") or {}
    stops: list[str] = list(data.get("stops") or [])
    if not stops:
        _reply(
            chat_id,
            "Ən azı bir məkan seçin.",
            reply_markup=MANUAL_KEYBOARD,
        )
        return
    region = data.get("region") or ""
    label = REGION_LABELS.get(str(region), region)
    lines = [f"🗺️ Manual marşrut — {label}", ""]
    for i, name in enumerate(stops, start=1):
        lines.append(f"{i}. {name}")
    lines.append("\nXəritə: trippoint://ai-komekci")
    text_out = "\n".join(lines)
    _save_last(chat_id, text_out)
    _clear_session(chat_id)
    _reply(chat_id, text_out, reply_markup=_main_keyboard(chat_id))


def _icma_menu_keyboard() -> dict[str, Any]:
    return _ik(
        [
            [
                _btn("🏕 Tur", "icma:tour"),
                _btn("🚗 Carpool", "icma:carpool"),
            ],
            [_btn("🛎 Yerli xidmət", "icma:local_service")],
            [_btn("🏠 Menyu", "menu")],
        ]
    )


def _show_icma(chat_id: str | int, *, message_id: int | None = None) -> None:
    _edit_or_reply(
        chat_id,
        "👥 İcma — hansı elan növünə baxmaq istəyirsiniz?",
        message_id=message_id,
        reply_markup=_icma_menu_keyboard(),
    )


def _format_listing_row(row: dict[str, Any]) -> str:
    emoji = LISTING_TYPE_EMOJI.get(str(row.get("type") or ""), "📌")
    title = str(row.get("title") or "Elan").strip()
    region = str(row.get("region") or "").strip()
    price = row.get("price")
    extra: list[str] = []
    if region:
        extra.append(region)
    if price is not None:
        extra.append(f"{price}₼")
    suffix = f" ({', '.join(extra)})" if extra else ""
    return f"{emoji} {title}{suffix}"


def _show_icma_by_type(
    chat_id: str | int,
    listing_type: str,
    *,
    message_id: int | None,
) -> None:
    titles = {
        "tour": "🏕 Turlar",
        "carpool": "🚗 Carpool",
        "local_service": "🛎 Yerli xidmət",
    }
    heading = titles.get(listing_type, "Elanlar")
    try:
        res = (
            supabase.table("listings")
            .select("id, title, type, region, departure_at, price")
            .eq("status", "active")
            .eq("type", listing_type)
            .order("created_at", desc=True)
            .limit(LISTINGS_LIMIT)
            .execute()
        )
        rows = list(res.data or [])
    except Exception:
        logger.exception("icma listings by type failed")
        _edit_or_reply(
            chat_id,
            f"{heading} indi yüklənmədi.",
            message_id=message_id,
            reply_markup=_icma_menu_keyboard(),
        )
        return

    if not rows:
        _edit_or_reply(
            chat_id,
            f"{heading}\n\nAktiv elan yoxdur.",
            message_id=message_id,
            reply_markup=_icma_menu_keyboard(),
        )
        return

    lines = [heading, ""]
    for row in rows:
        lines.append(_format_listing_row(row))
    lines.append("\nƏtraflı: app → İcma")
    _edit_or_reply(
        chat_id,
        "\n".join(lines),
        message_id=message_id,
        reply_markup=_icma_menu_keyboard(),
    )


def _handle_icma_callback(
    chat_id: str | int, data: str, *, message_id: int | None
) -> bool:
    if not data.startswith("icma:"):
        return False
    section = data.split(":", 1)[1]
    if section == "menu":
        _show_icma(chat_id, message_id=message_id)
        return True
    if section in {"tour", "carpool", "local_service"}:
        _show_icma_by_type(chat_id, section, message_id=message_id)
        return True
    return False


def _favorites_menu_keyboard() -> dict[str, Any]:
    return _ik(
        [
            [_btn("📋 Elanlar", "fav:listings"), _btn("📍 Yerlər", "fav:pois")],
            [_btn("🗺️ Marşrutlar", "fav:routes"), _btn("🔔 Abunə", "fav:subs")],
            [_btn("📬 Bildiriş", "fav:notifs")],
            [_btn("🏠 Menyu", "menu")],
        ]
    )


def _show_favorites(chat_id: str | int, *, message_id: int | None = None) -> None:
    user_id = _lookup_user_id(chat_id)
    if not user_id:
        _reply(
            chat_id,
            "Sevimlilər üçün app hesabını bağlayın (Profil → Telegram bağla).",
            reply_markup=_main_keyboard(chat_id),
        )
        return
    _edit_or_reply(
        chat_id,
        "⭐ Sevimlilər — hansı hissəyə baxmaq istəyirsiniz?",
        message_id=message_id,
        reply_markup=_favorites_menu_keyboard(),
    )


def _show_fav_listings(chat_id: str | int, user_id: str, *, message_id: int | None) -> None:
    try:
        res = (
            supabase.table("favorites")
            .select("target_id")
            .eq("user_id", user_id)
            .eq("target_type", "listing")
            .limit(FAVORITES_LIMIT)
            .execute()
        )
        ids = [str(r["target_id"]) for r in (res.data or []) if r.get("target_id")]
    except Exception:
        logger.exception("fav listings ids failed")
        _edit_or_reply(
            chat_id,
            "Elanlar yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    if not ids:
        _edit_or_reply(
            chat_id,
            "📋 Sevimli elan yoxdur.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    try:
        lr = (
            supabase.table("listings")
            .select("id, title, type, region, price, status")
            .in_("id", ids)
            .execute()
        )
        by_id = {str(L["id"]): L for L in (lr.data or [])}
    except Exception:
        logger.exception("fav listings fetch failed")
        _edit_or_reply(
            chat_id,
            "Elanlar yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    lines = ["📋 Sevimli elanlar", ""]
    for lid in ids:
        L = by_id.get(lid)
        if not L:
            continue
        emoji = LISTING_TYPE_EMOJI.get(str(L.get("type") or ""), "📌")
        title = str(L.get("title") or "Elan")
        region = str(L.get("region") or "").strip()
        suffix = f" · {region}" if region else ""
        lines.append(f"{emoji} {title}{suffix}")
    if len(lines) == 2:
        lines.append("Sevimli elan tapılmadı.")
    lines.append("\n⬅️ geri üçün yenə Sevimlilər bölməsindən seçin")
    _edit_or_reply(
        chat_id,
        "\n".join(lines),
        message_id=message_id,
        reply_markup=_favorites_menu_keyboard(),
    )


def _show_fav_pois(chat_id: str | int, user_id: str, *, message_id: int | None) -> None:
    try:
        res = (
            supabase.table("favorites")
            .select("target_id")
            .eq("user_id", user_id)
            .eq("target_type", "poi")
            .limit(FAVORITES_LIMIT)
            .execute()
        )
        ids = [str(r["target_id"]) for r in (res.data or []) if r.get("target_id")]
    except Exception:
        logger.exception("fav poi ids failed")
        _edit_or_reply(
            chat_id,
            "Yerlər yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    if not ids:
        _edit_or_reply(
            chat_id,
            "📍 Sevimli yer yoxdur.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    try:
        pr = (
            supabase.table("pois")
            .select("id, name, region, category")
            .in_("id", ids)
            .execute()
        )
        by_id = {str(p["id"]): p for p in (pr.data or [])}
    except Exception:
        logger.exception("fav pois fetch failed")
        _edit_or_reply(
            chat_id,
            "Yerlər yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    lines = ["📍 Sevimli yerlər", ""]
    for pid in ids:
        p = by_id.get(pid)
        if not p:
            continue
        name = str(p.get("name") or "Məkan")
        region = str(p.get("region") or "").strip()
        suffix = f" · {region}" if region else ""
        lines.append(f"• {name}{suffix}")
    if len(lines) == 2:
        lines.append("Sevimli yer tapılmadı.")
    _edit_or_reply(
        chat_id,
        "\n".join(lines),
        message_id=message_id,
        reply_markup=_favorites_menu_keyboard(),
    )


def _show_fav_routes(chat_id: str | int, user_id: str, *, message_id: int | None) -> None:
    try:
        res = (
            supabase.table("saved_routes")
            .select("id, title, source, region, days_count, summary")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(FAVORITES_LIMIT)
            .execute()
        )
        rows = list(res.data or [])
    except Exception:
        logger.exception("saved routes failed")
        _edit_or_reply(
            chat_id,
            "Marşrutlar yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    if not rows:
        _edit_or_reply(
            chat_id,
            "🗺️ Saxlanmış marşrut yoxdur.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    lines = ["🗺️ Saxlanmış marşrutlar", ""]
    for r in rows:
        src = "🤖" if r.get("source") == "ai" else "🗺️"
        title = str(r.get("title") or "Marşrut")
        days = r.get("days_count")
        region = str(r.get("region") or "").strip()
        bits = []
        if days:
            bits.append(f"{days} gün")
        if region:
            bits.append(region)
        suffix = f" ({', '.join(bits)})" if bits else ""
        lines.append(f"{src} {title}{suffix}")
    _edit_or_reply(
        chat_id,
        "\n".join(lines),
        message_id=message_id,
        reply_markup=_favorites_menu_keyboard(),
    )


def _show_fav_subscriptions(
    chat_id: str | int, user_id: str, *, message_id: int | None
) -> None:
    try:
        res = (
            supabase.table("subscriptions")
            .select("target_type, target_id")
            .eq("user_id", user_id)
            .limit(FAVORITES_LIMIT)
            .execute()
        )
        rows = list(res.data or [])
    except Exception:
        logger.exception("subscriptions failed")
        _edit_or_reply(
            chat_id,
            "Abunəliklər yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    if not rows:
        _edit_or_reply(
            chat_id,
            "🔔 Abunəlik yoxdur.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return

    listing_ids = [
        str(r["target_id"]) for r in rows if r.get("target_type") == "listing"
    ]
    organizer_ids = [
        str(r["target_id"]) for r in rows if r.get("target_type") == "organizer"
    ]
    listing_names: dict[str, str] = {}
    org_names: dict[str, str] = {}
    try:
        if listing_ids:
            lr = (
                supabase.table("listings")
                .select("id, title, type")
                .in_("id", listing_ids)
                .execute()
            )
            for L in lr.data or []:
                emoji = LISTING_TYPE_EMOJI.get(str(L.get("type") or ""), "📌")
                listing_names[str(L["id"])] = f"{emoji} {L.get('title') or 'Tur'}"
        if organizer_ids:
            pr = (
                supabase.table("profiles")
                .select("id, full_name")
                .in_("id", organizer_ids)
                .execute()
            )
            for p in pr.data or []:
                org_names[str(p["id"])] = f"👤 {p.get('full_name') or 'Təşkilatçı'}"
    except Exception:
        logger.exception("subscription names failed")

    lines = ["🔔 Abunəliklər", ""]
    for r in rows:
        tid = str(r.get("target_id") or "")
        if r.get("target_type") == "listing":
            lines.append(listing_names.get(tid) or f"📌 Tur {tid[:8]}…")
        else:
            lines.append(org_names.get(tid) or f"👤 {tid[:8]}…")
    _edit_or_reply(
        chat_id,
        "\n".join(lines),
        message_id=message_id,
        reply_markup=_favorites_menu_keyboard(),
    )


def _show_fav_notifications(
    chat_id: str | int, user_id: str, *, message_id: int | None
) -> None:
    try:
        res = (
            supabase.table("notifications")
            .select("kind, title, body, created_at, read_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(FAVORITES_LIMIT)
            .execute()
        )
        rows = list(res.data or [])
    except Exception:
        logger.exception("notifications failed")
        _edit_or_reply(
            chat_id,
            "Bildirişlər yüklənmədi.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    if not rows:
        _edit_or_reply(
            chat_id,
            "📬 Bildiriş yoxdur.",
            message_id=message_id,
            reply_markup=_favorites_menu_keyboard(),
        )
        return
    lines = ["📬 Bildirişlər", ""]
    for n in rows:
        unread = "•" if not n.get("read_at") else "○"
        title = str(n.get("title") or "Bildiriş")
        body = str(n.get("body") or "").strip()
        if body:
            lines.append(f"{unread} {title}\n  {body[:120]}")
        else:
            lines.append(f"{unread} {title}")
    _edit_or_reply(
        chat_id,
        "\n".join(lines),
        message_id=message_id,
        reply_markup=_favorites_menu_keyboard(),
    )


def _handle_fav_callback(
    chat_id: str | int, data: str, *, message_id: int | None
) -> bool:
    """Handle fav:* callbacks. Returns True if handled."""
    if not data.startswith("fav:"):
        return False
    user_id = _lookup_user_id(chat_id)
    if not user_id:
        _edit_or_reply(
            chat_id,
            "App hesabı bağlı deyil.",
            message_id=message_id,
            reply_markup=_main_keyboard(chat_id),
        )
        return True
    section = data.split(":", 1)[1]
    if section == "menu":
        _show_favorites(chat_id, message_id=message_id)
        return True
    if section == "listings":
        _show_fav_listings(chat_id, user_id, message_id=message_id)
        return True
    if section == "pois":
        _show_fav_pois(chat_id, user_id, message_id=message_id)
        return True
    if section == "routes":
        _show_fav_routes(chat_id, user_id, message_id=message_id)
        return True
    if section == "subs":
        _show_fav_subscriptions(chat_id, user_id, message_id=message_id)
        return True
    if section == "notifs":
        _show_fav_notifications(chat_id, user_id, message_id=message_id)
        return True
    return False


def _handle_callback(update: dict[str, Any]) -> dict[str, Any]:
    cq = update.get("callback_query") or {}
    cq_id = str(cq.get("id") or "")
    data = str(cq.get("data") or "")
    message = cq.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    message_id = message.get("message_id")
    from_user = cq.get("from") or {}

    if chat_id is None:
        return {"ok": True, "ignored": True}

    _ensure_telegram_user(
        chat_id,
        username=str(from_user["username"]) if from_user.get("username") else None,
    )

    is_admin_action = data.startswith("adm:ok:") or data.startswith("adm:no:") or data.startswith(
        "adm:dl:"
    )
    if not is_admin_action:
        answer_callback_query(cq_id)

    if data == "menu":
        _clear_session(chat_id)
        _show_main_menu(chat_id)
        return {"ok": True}

    if _handle_admin_callback(
        chat_id,
        data,
        message_id=message_id,
        callback_query_id=cq_id if is_admin_action else None,
    ):
        return {"ok": True}

    if _handle_fav_callback(chat_id, data, message_id=message_id):
        return {"ok": True}

    if _handle_icma_callback(chat_id, data, message_id=message_id):
        return {"ok": True}

    if data == "ai:again" or data == "ai:edit":
        _show_ai_home(chat_id, message_id=message_id)
        return {"ok": True}

    if data.startswith("ai:r:"):
        region = data.split(":")[-1]
        if region not in BOT_REGION_KEYS:
            return {"ok": True}
        session = _get_session(chat_id)
        session["mode"] = "ai"
        session["data"]["region"] = region
        session["step"] = "days"
        label = REGION_LABELS.get(region, region)
        _edit_or_reply(
            chat_id,
            f"Region: {label}\nNeçə gün?",
            message_id=message_id,
            reply_markup=_days_inline(),
        )
        return {"ok": True}

    if data.startswith("ai:d:"):
        days = data.split(":")[-1]
        if not days.isdigit() or not (1 <= int(days) <= 7):
            return {"ok": True}
        session = _get_session(chat_id)
        session["data"]["days"] = int(days)
        session["step"] = "budget"
        _edit_or_reply(
            chat_id,
            "Büdcə seçin:",
            message_id=message_id,
            reply_markup=_budget_inline(),
        )
        return {"ok": True}

    if data.startswith("ai:b:"):
        budget = data.split(":")[-1]
        if budget not in {"budget", "mid", "premium"}:
            return {"ok": True}
        session = _get_session(chat_id)
        session["data"]["budget"] = budget
        session["step"] = "interests"
        session["data"].setdefault("interests", [])
        _edit_or_reply(
            chat_id,
            "Maraqlar (bir neçə seçin), sonra ✅ Hazır:",
            message_id=message_id,
            reply_markup=_interests_inline(list(session["data"]["interests"])),
        )
        return {"ok": True}

    if data.startswith("ai:i:") and data != "ai:i_done":
        interest = data.split(":")[-1]
        session = _get_session(chat_id)
        selected: list[str] = list(session["data"].get("interests") or [])
        if interest in selected:
            selected = [x for x in selected if x != interest]
        elif interest in {k for k, _ in INTERESTS}:
            selected.append(interest)
        session["data"]["interests"] = selected
        if "family" in selected:
            session["data"]["group_type"] = "family"
        _edit_or_reply(
            chat_id,
            "Maraqlar (bir neçə seçin), sonra ✅ Hazır:",
            message_id=message_id,
            reply_markup=_interests_inline(selected),
        )
        return {"ok": True}

    if data == "ai:i_done":
        session = _get_session(chat_id)
        interests = list(session["data"].get("interests") or [])
        if not interests:
            _edit_or_reply(
                chat_id,
                "Ən azı bir maraq seçin, sonra ✅ Hazır:",
                message_id=message_id,
                reply_markup=_interests_inline([]),
            )
            return {"ok": True}
        _ask_from_origin(chat_id, message_id)
        return {"ok": True}

    if data == "ai:fo:0":
        session = _get_session(chat_id)
        session["data"]["from_origin"] = False
        session["data"].pop("origin_lat", None)
        session["data"].pop("origin_lng", None)
        payload = dict(session.get("data") or {})
        _clear_session(chat_id)
        _run_and_send_plan(chat_id, payload)
        return {"ok": True}

    if data == "ai:fo:1":
        _request_location(chat_id)
        return {"ok": True}

    if data.startswith("man:r:"):
        region = data.split(":")[-1]
        if region not in BOT_REGION_KEYS:
            return {"ok": True}
        session = _get_session(chat_id)
        session["mode"] = "manual"
        session["data"] = {"stops": [], "region": region}
        session["step"] = "stops"
        _show_manual_poi_page(chat_id, message_id=message_id, offset=0)
        return {"ok": True}

    if data.startswith("man:p:"):
        raw = data.split(":")[-1]
        offset = int(raw) if raw.isdigit() else 0
        _show_manual_poi_page(chat_id, message_id=message_id, offset=offset)
        return {"ok": True}

    if data.startswith("man:a:"):
        raw = data.split(":")[-1]
        if not raw.isdigit():
            return {"ok": True}
        idx = int(raw)
        session = _get_session(chat_id)
        data_s = session.setdefault("data", {})
        stops: list[str] = list(data_s.get("stops") or [])
        page: list[dict[str, Any]] = list(data_s.get("poi_page") or [])
        page_off = int(data_s.get("poi_offset") or 0)
        local_i = idx - page_off
        if local_i < 0 or local_i >= len(page):
            return {"ok": True}
        if len(stops) >= MAX_MANUAL_STOPS:
            _reply(
                chat_id,
                f"Maksimum {MAX_MANUAL_STOPS}. ✅ Hazır basın.",
                reply_markup=MANUAL_KEYBOARD,
            )
            return {"ok": True}
        name = str(page[local_i].get("name") or "Məkan")
        if name not in stops:
            stops.append(name)
            data_s["stops"] = stops
        _show_manual_poi_page(
            chat_id, message_id=message_id, offset=page_off
        )
        return {"ok": True}

    if data == "man:done":
        _finish_manual(chat_id)
        return {"ok": True}

    return {"ok": True}


def _handle_manual_text(chat_id: str | int, text: str, session: dict[str, Any]) -> None:
    data = session.setdefault("data", {})
    stops: list[str] = list(data.get("stops") or [])
    step = session.get("step")

    if step != "stops":
        return

    if text.strip() == BTN_DONE or text.strip().lower() in {"hazır", "hazir", "done"}:
        _finish_manual(chat_id)
        return

    if len(stops) >= MAX_MANUAL_STOPS:
        _reply(
            chat_id,
            f"Maksimum {MAX_MANUAL_STOPS}. «{BTN_DONE}» basın.",
            reply_markup=MANUAL_KEYBOARD,
        )
        return

    region = str(data.get("region") or "")
    found, _ = _list_region_pois(region, offset=0, limit=5, query=text)
    name = text.strip()
    if found:
        name = str(found[0].get("name") or name)
    if len(name) < 2:
        _reply(chat_id, "Daha uzun ad yazın və ya düymədən seçin.", reply_markup=MANUAL_KEYBOARD)
        return
    if name not in stops:
        stops.append(name)
        data["stops"] = stops
    _reply(
        chat_id,
        f"Əlavə olundu ({len(stops)}/{MAX_MANUAL_STOPS}): {name}\n"
        f"Düymədən seçin, ad yazın və ya «{BTN_DONE}».",
        reply_markup=MANUAL_KEYBOARD,
    )


def _extract_chat_id(update: dict[str, Any]) -> str | int | None:
    cq = update.get("callback_query") or {}
    if cq:
        message = cq.get("message") or {}
        chat = message.get("chat") or {}
        return chat.get("id")
    message = update.get("message") or update.get("edited_message") or {}
    chat = message.get("chat") or {}
    return chat.get("id")


def handle_telegram_update(update: dict[str, Any]) -> dict[str, Any]:
    """Process one Telegram Update. Never raises to caller."""
    chat_id = _extract_chat_id(update)
    try:
        if update.get("callback_query"):
            return _handle_callback(update)

        message = update.get("message") or update.get("edited_message")
        if not isinstance(message, dict):
            return {"ok": True, "ignored": True}

        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is None:
            return {"ok": True, "ignored": True}

        from_user = message.get("from") or {}
        _ensure_telegram_user(
            chat_id,
            username=str(from_user["username"]) if from_user.get("username") else None,
        )

        loc = message.get("location")
        if isinstance(loc, dict) and loc.get("latitude") is not None:
            session = _get_session(chat_id)
            if session.get("mode") == "ai" and session.get("step") == "await_location":
                data = dict(session.get("data") or {})
                data["from_origin"] = True
                data["origin_lat"] = float(loc["latitude"])
                data["origin_lng"] = float(loc["longitude"])
                _clear_session(chat_id)
                _run_and_send_plan(chat_id, data)
                return {"ok": True}

        text = (message.get("text") or "").strip()
        if not text:
            return {"ok": True, "ignored": True}

        if text.startswith("/start"):
            parts = text.split(maxsplit=1)
            code = parts[1].strip() if len(parts) > 1 else ""
            _clear_session(chat_id)
            if code:
                ok, msg = _link_account(chat_id, code)
                _show_main_menu(
                    chat_id,
                    msg if ok else msg + "\n\nYenə də menyudan istifadə edə bilərsiniz.",
                )
                return {"ok": True, "linked": ok}
            _show_main_menu(
                chat_id,
                "Xoş gəldiniz! AI və ya Manual marşrut seçin.",
            )
            return {"ok": True, "guest": True}

        if text == BTN_CANCEL or text.lower() in {"ləğv", "legv", "cancel", "/cancel"}:
            _clear_session(chat_id)
            _show_main_menu(chat_id, "Ləğv edildi.")
            return {"ok": True}

        if text == BTN_SKIP_LOC:
            session = _get_session(chat_id)
            if session.get("mode") == "ai" and session.get("step") == "await_location":
                data = dict(session.get("data") or {})
                data["from_origin"] = False
                data.pop("origin_lat", None)
                data.pop("origin_lng", None)
                _clear_session(chat_id)
                _reply(
                    chat_id,
                    "Lokasiya olmadan davam (cari məkan nəzərə alınmadı).",
                    reply_markup=_main_keyboard(chat_id),
                )
                _run_and_send_plan(chat_id, data)
                return {"ok": True}

        if text == BTN_HELP or text.lower() in {"kömək", "komek", "/help", "help"}:
            _reply(chat_id, _help_text(chat_id), reply_markup=_main_keyboard(chat_id))
            return {"ok": True}

        if text == BTN_LINK_APP or text.lower() in {"bağla", "bagla", "link"}:
            if _lookup_user_id(chat_id):
                _show_main_menu(
                    chat_id,
                    "Artıq bağlısınız — İcma və Sevimlilər menyudadır.",
                )
            else:
                _reply(
                    chat_id,
                    "App opsionaldır.\n"
                    "1) TripPoint → Profil → Telegram bağla\n"
                    "2) Botda Start\n\n"
                    "App yoxdursa da AI/manual işləyir.",
                    reply_markup=_main_keyboard(chat_id),
                )
            return {"ok": True}

        if text == BTN_ICMA:
            if not _lookup_user_id(chat_id):
                _reply(
                    chat_id,
                    "İcma üçün app hesabını bağlayın.",
                    reply_markup=_main_keyboard(chat_id),
                )
                return {"ok": True}
            _show_icma(chat_id)
            return {"ok": True}

        if text == BTN_FAVS:
            _show_favorites(chat_id)
            return {"ok": True}

        if text == BTN_ADMIN:
            user_id = _lookup_user_id(chat_id)
            if not _is_admin_user(user_id):
                _reply(
                    chat_id,
                    "Bu bölmə yalnız admin üçündür.",
                    reply_markup=_main_keyboard(chat_id),
                )
                return {"ok": True}
            _show_admin_home(chat_id)
            return {"ok": True}

        lower = text.lower()
        if lower.startswith("/verify") or lower.startswith("/unverify"):
            user_id = _lookup_user_id(chat_id)
            if not _is_admin_user(user_id):
                _reply(chat_id, "Yalnız admin.", reply_markup=_main_keyboard(chat_id))
                return {"ok": True}
            parts = text.split(maxsplit=1)
            if len(parts) < 2 or not parts[1].strip():
                _reply(chat_id, "İstifadə: /verify email|uuid")
                return {"ok": True}
            ok, msg = _admin_set_verified(parts[1].strip(), verified=lower.startswith("/verify"))
            _reply(chat_id, msg, reply_markup=_main_keyboard(chat_id))
            return {"ok": True}

        if lower.startswith("/sponsor") or lower.startswith("/unsponsor"):
            user_id = _lookup_user_id(chat_id)
            if not _is_admin_user(user_id):
                _reply(chat_id, "Yalnız admin.", reply_markup=_main_keyboard(chat_id))
                return {"ok": True}
            parts = text.split()
            if len(parts) < 2:
                _reply(chat_id, "İstifadə: /sponsor poi_uuid [gün] | /unsponsor poi_uuid")
                return {"ok": True}
            days = 30
            if lower.startswith("/sponsor") and len(parts) >= 3:
                try:
                    days = max(1, min(365, int(parts[2])))
                except ValueError:
                    days = 30
            ok, msg = _admin_set_sponsored(
                parts[1].strip(),
                sponsored=lower.startswith("/sponsor"),
                days=days,
            )
            _reply(chat_id, msg, reply_markup=_main_keyboard(chat_id))
            return {"ok": True}

        if text == BTN_LAST or text.lower() in {"/last", "son"}:
            last = get_last_plan(chat_id)
            if last:
                _reply(chat_id, last, reply_markup=_ai_result_keyboard())
            else:
                _reply(
                    chat_id,
                    "Hələ son marşrut yoxdur. AI və ya Manual seçin.",
                    reply_markup=_main_keyboard(chat_id),
                )
            return {"ok": True}

        if text == BTN_AI:
            _show_ai_home(chat_id)
            return {"ok": True}

        if text == BTN_MANUAL:
            _start_manual(chat_id)
            return {"ok": True}

        session = _get_session(chat_id)
        if session.get("mode") == "manual":
            _handle_manual_text(chat_id, text, session)
            return {"ok": True}

        _show_main_menu(chat_id)
        return {"ok": True}
    except Exception:
        logger.exception("handle_telegram_update failed")
        return {"ok": True, "error": True}
    finally:
        if chat_id is not None:
            _flush_session(chat_id)
