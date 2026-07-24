"""Telegram user bot — guest + optional app link + AI/manual (inline UX).

Production note: replace _SESSIONS / _LAST_PLANS with DB/Redis for multi-worker.
# TODO: optional email OTP (not required).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.constants.regions import REGION_DB_ID
from app.db import supabase
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

# chat_id -> session / last plan text. MVP — not shared across workers.
_SESSIONS: dict[str, dict[str, Any]] = {}
_LAST_PLANS: dict[str, str] = {}

MAX_MANUAL_STOPS = 8

BTN_AI = "🤖 AI marşrut"
BTN_MANUAL = "🗺️ Manual marşrut"
BTN_LAST = "📄 Son marşrut"
BTN_HELP = "ℹ️ Kömək"
BTN_LINK_APP = "🔗 App hesabı bağla"
BTN_CANCEL = "❌ Ləğv et"
BTN_DONE = "✅ Hazır"
BTN_SKIP_LOC = "❌ Keç"
BTN_SHARE_LOC = "📍 Lokasiyamı göndər"

INTERESTS: list[tuple[str, str]] = [
    ("nature", "🌿 Təbiət"),
    ("history", "🏛 Tarix"),
    ("food", "🍽 Yemək"),
    ("family", "👨‍👩‍👧 Ailə"),
    ("active", "🏃 Aktiv"),
    ("photo", "📷 Foto"),
]

PRESETS: list[dict[str, Any]] = [
    {
        "id": "0",
        "label": "🏔 Quba · 1 gün · Orta · 👨‍👩‍👧",
        "region": "quba",
        "days": 1,
        "budget": "mid",
        "interests": ["family"],
        "group_type": "family",
    },
    {
        "id": "1",
        "label": "🏔 Quba · 2 gün · Orta · 🌿",
        "region": "quba",
        "days": 2,
        "budget": "mid",
        "interests": ["nature"],
        "group_type": "solo",
    },
    {
        "id": "2",
        "label": "🏛 Şəki · 2 gün · Orta · 🏛",
        "region": "seki",
        "days": 2,
        "budget": "mid",
        "interests": ["history"],
        "group_type": "solo",
    },
    {
        "id": "3",
        "label": "🌲 Qəbələ · 1 gün · Orta · 🌿",
        "region": "qabala",
        "days": 1,
        "budget": "mid",
        "interests": ["nature"],
        "group_type": "solo",
    },
    {
        "id": "4",
        "label": "🏙 Bakı · 1 gün · Orta · 🍽",
        "region": "baku",
        "days": 1,
        "budget": "mid",
        "interests": ["food", "history"],
        "group_type": "solo",
    },
    {
        "id": "5",
        "label": "🌿 Lerik · 2 gün · Qənaət · 🌿",
        "region": "lerik",
        "days": 2,
        "budget": "budget",
        "interests": ["nature", "active"],
        "group_type": "solo",
    },
]

MAIN_KEYBOARD: dict[str, Any] = {
    "keyboard": [
        [{"text": BTN_AI}, {"text": BTN_MANUAL}],
        [{"text": BTN_LAST}, {"text": BTN_HELP}],
        [{"text": BTN_LINK_APP}],
    ],
    "resize_keyboard": True,
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
    return {"text": text, "callback_data": data[:64]}


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
    _SESSIONS.pop(_chat_key(chat_id), None)


def _get_session(chat_id: str | int) -> dict[str, Any]:
    return _SESSIONS.setdefault(
        _chat_key(chat_id), {"mode": "idle", "step": None, "data": {}}
    )


def _save_last(chat_id: str | int, text: str) -> None:
    _LAST_PLANS[_chat_key(chat_id)] = text


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


def _preset_keyboard() -> dict[str, Any]:
    rows: list[list[dict[str, str]]] = []
    for p in PRESETS:
        rows.append([_btn(p["label"], f"ai:p:{p['id']}")])
    rows.append([_btn("🛠 Özüm seçim", "ai:custom")])
    rows.append([_btn("🏠 Menyu", "menu")])
    return _ik(rows)


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
                _btn("💸 Qənaətcil", "ai:b:budget"),
                _btn("⚖️ Orta", "ai:b:mid"),
                _btn("✨ Premium", "ai:b:premium"),
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


def _help_text() -> str:
    return (
        "TripPoint bot (app lazım deyil)\n\n"
        f"{BTN_AI} — hazır paket və ya öz seçim (düymələrlə)\n"
        f"{BTN_MANUAL} — stop siyahısı\n"
        f"{BTN_LAST} — son AI marşrut\n"
        "Cari məkandan: AI seçimində «Bəli» → lokasiya paylaş\n"
        f"{BTN_LINK_APP} — opsional app birləşdirmə"
    )


def _show_main_menu(chat_id: str | int, preface: str | None = None) -> None:
    text = (preface + "\n\n" if preface else "") + "Nə etmək istəyirsiniz?"
    _reply(chat_id, text, reply_markup=MAIN_KEYBOARD)


def _show_ai_home(
    chat_id: str | int,
    *,
    message_id: int | None = None,
) -> None:
    _SESSIONS[_chat_key(chat_id)] = {"mode": "ai", "step": "pick", "data": {}}
    text = (
        "🤖 AI marşrut\n\n"
        "Hazır paket seçin (1 toxunuş) və ya «Özüm seçim»:"
    )
    _edit_or_reply(chat_id, text, message_id=message_id, reply_markup=_preset_keyboard())


def _run_and_send_plan(chat_id: str | int, data: dict[str, Any]) -> None:
    _reply(chat_id, "⏳ Marşrut hazırlanır…", reply_markup=MAIN_KEYBOARD)
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
        _reply(chat_id, f"Xəta: {exc}", reply_markup=MAIN_KEYBOARD)
    except Exception:
        logger.exception("AI plan failed")
        _clear_session(chat_id)
        _reply(
            chat_id,
            "Marşrut hazırlanmadı. Bir az sonra yenidən yoxlayın.",
            reply_markup=MAIN_KEYBOARD,
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


def _start_custom_wizard(chat_id: str | int, message_id: int | None) -> None:
    _SESSIONS[_chat_key(chat_id)] = {
        "mode": "ai",
        "step": "region",
        "data": {"interests": [], "group_type": "solo"},
    }
    _edit_or_reply(
        chat_id,
        "Region seçin:",
        message_id=message_id,
        reply_markup=_region_inline("ai:r"),
    )


def _search_pois(region_key: str, query: str) -> list[dict[str, Any]]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    q = (query or "").strip()
    try:
        query_builder = (
            supabase.table("pois")
            .select("id, name, region, category")
            .eq("region", db_region)
            .eq("status", "approved")
        )
        if q:
            query_builder = query_builder.ilike("name", f"%{q}%")
        res = query_builder.limit(8).execute()
        return list(res.data or [])
    except Exception:
        logger.exception("POI search failed")
        return []


def _start_manual(chat_id: str | int, message_id: int | None = None) -> None:
    _SESSIONS[_chat_key(chat_id)] = {
        "mode": "manual",
        "step": "region",
        "data": {"stops": []},
    }
    _edit_or_reply(
        chat_id,
        "🗺️ Manual marşrut — region seçin:",
        message_id=message_id,
        reply_markup=_region_inline("man:r"),
    )


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
    answer_callback_query(cq_id)

    if data == "menu":
        _clear_session(chat_id)
        _show_main_menu(chat_id)
        return {"ok": True}

    if data == "ai:again" or data == "ai:edit":
        _show_ai_home(chat_id, message_id=message_id)
        return {"ok": True}

    if data == "ai:custom":
        _start_custom_wizard(chat_id, message_id)
        return {"ok": True}

    if data.startswith("ai:p:"):
        preset_id = data.split(":")[-1]
        preset = next((p for p in PRESETS if p["id"] == preset_id), None)
        if not preset:
            _reply(chat_id, "Paket tapılmadı.", reply_markup=MAIN_KEYBOARD)
            return {"ok": True}
        _SESSIONS[_chat_key(chat_id)] = {
            "mode": "ai",
            "step": "from_origin",
            "data": {
                "region": preset["region"],
                "days": preset["days"],
                "budget": preset["budget"],
                "interests": list(preset["interests"]),
                "group_type": preset.get("group_type") or "solo",
            },
        }
        _ask_from_origin(chat_id, message_id)
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
        else:
            if interest in {k for k, _ in INTERESTS}:
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
        sample = _search_pois(region, "")
        hint = ""
        if sample:
            hint = "\nNümunələr:\n" + "\n".join(
                f"• {p.get('name')}" for p in sample[:5]
            )
        label = REGION_LABELS.get(region, region)
        _reply(
            chat_id,
            f"Region: {label}\nStop adı yazın (max {MAX_MANUAL_STOPS})."
            f"\nBitirəndə «{BTN_DONE}».{hint}",
            reply_markup=MANUAL_KEYBOARD,
        )
        return {"ok": True}

    return {"ok": True}


def _handle_manual_text(chat_id: str | int, text: str, session: dict[str, Any]) -> None:
    data = session.setdefault("data", {})
    stops: list[str] = list(data.get("stops") or [])
    step = session.get("step")

    if step == "stops":
        if text.strip() == BTN_DONE or text.strip().lower() in {"hazır", "hazir", "done"}:
            if not stops:
                _reply(chat_id, "Ən azı bir stop əlavə edin.", reply_markup=MANUAL_KEYBOARD)
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
            _reply(chat_id, text_out, reply_markup=MAIN_KEYBOARD)
            return

        if len(stops) >= MAX_MANUAL_STOPS:
            _reply(
                chat_id,
                f"Maksimum {MAX_MANUAL_STOPS}. «{BTN_DONE}» basın.",
                reply_markup=MANUAL_KEYBOARD,
            )
            return

        region = str(data.get("region") or "")
        found = _search_pois(region, text)
        name = text.strip()
        if found:
            name = str(found[0].get("name") or name)
        if len(name) < 2:
            _reply(chat_id, "Daha uzun ad yazın.", reply_markup=MANUAL_KEYBOARD)
            return
        stops.append(name)
        data["stops"] = stops
        _reply(
            chat_id,
            f"Əlavə olundu ({len(stops)}/{MAX_MANUAL_STOPS}): {name}\n"
            f"Növbəti və ya «{BTN_DONE}».",
            reply_markup=MANUAL_KEYBOARD,
        )


def handle_telegram_update(update: dict[str, Any]) -> dict[str, Any]:
    """Process one Telegram Update. Never raises to caller."""
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

        # Location for fromOrigin flow
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
                "Xoş gəldiniz! App lazım deyil — paket və ya öz seçimlə AI marşrut.",
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
                    reply_markup=MAIN_KEYBOARD,
                )
                _run_and_send_plan(chat_id, data)
                return {"ok": True}

        if text == BTN_HELP or text.lower() in {"kömək", "komek", "/help", "help"}:
            _reply(chat_id, _help_text(), reply_markup=MAIN_KEYBOARD)
            return {"ok": True}

        if text == BTN_LINK_APP or text.lower() in {"bağla", "bagla", "link"}:
            if _lookup_user_id(chat_id):
                _reply(
                    chat_id,
                    "Bu Telegram artıq app hesabına bağlıdır ✅",
                    reply_markup=MAIN_KEYBOARD,
                )
            else:
                _reply(
                    chat_id,
                    "App opsionaldır.\n"
                    "1) TripPoint → Profil → Telegram bağla\n"
                    "2) Botda Start\n\n"
                    "App yoxdursa da AI/manual işləyir.",
                    reply_markup=MAIN_KEYBOARD,
                )
            return {"ok": True}

        if text == BTN_LAST or text.lower() in {"/last", "son"}:
            last = _LAST_PLANS.get(_chat_key(chat_id))
            if last:
                _reply(chat_id, last, reply_markup=_ai_result_keyboard())
            else:
                _reply(
                    chat_id,
                    "Hələ son marşrut yoxdur. AI və ya Manual seçin.",
                    reply_markup=MAIN_KEYBOARD,
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
