"""Telegram user bot — link account + AI/manual route (MVP in-memory sessions).

Production note: replace _SESSIONS with DB/Redis for multi-worker Railway.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from app.constants.regions import REGION_DB_ID
from app.db import supabase
from app.services.plan_route_run import (
    BOT_REGION_KEYS,
    REGION_LABELS,
    format_plan_for_telegram,
    run_plan_route,
)
from app.services.telegram_notify import send_telegram_message

logger = logging.getLogger(__name__)

# chat_id -> session dict. MVP only — not shared across workers.
_SESSIONS: dict[str, dict[str, Any]] = {}

MAX_MANUAL_STOPS = 8

BTN_AI = "🤖 AI marşrut"
BTN_MANUAL = "🗺️ Manual marşrut"
BTN_HELP = "ℹ️ Kömək"
BTN_CANCEL = "❌ Ləğv et"
BTN_DONE = "✅ Hazır"

BUDGET_MAP: dict[str, str] = {
    "1": "budget",
    "2": "mid",
    "3": "premium",
    "budget": "budget",
    "qənaətcil": "budget",
    "qenaetcil": "budget",
    "mid": "mid",
    "orta": "mid",
    "premium": "premium",
}

INTEREST_MAP: dict[str, str] = {
    "1": "nature",
    "2": "history",
    "3": "food",
    "4": "family",
    "5": "active",
    "6": "photo",
    "nature": "nature",
    "təbiət": "nature",
    "tebiət": "nature",
    "tebiet": "nature",
    "history": "history",
    "tarix": "history",
    "food": "food",
    "yemək": "food",
    "yemek": "food",
    "family": "family",
    "ailə": "family",
    "aile": "family",
    "active": "active",
    "aktiv": "active",
    "photo": "photo",
    "foto": "photo",
}

MAIN_KEYBOARD: dict[str, Any] = {
    "keyboard": [
        [{"text": BTN_AI}, {"text": BTN_MANUAL}],
        [{"text": BTN_HELP}],
    ],
    "resize_keyboard": True,
}

FLOW_KEYBOARD: dict[str, Any] = {
    "keyboard": [[{"text": BTN_CANCEL}]],
    "resize_keyboard": True,
}

MANUAL_KEYBOARD: dict[str, Any] = {
    "keyboard": [
        [{"text": BTN_DONE}, {"text": BTN_CANCEL}],
    ],
    "resize_keyboard": True,
}


def _chat_key(chat_id: str | int) -> str:
    return str(chat_id)


def _reply(
    chat_id: str | int,
    text: str,
    *,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    send_telegram_message(text, chat_id=chat_id, reply_markup=reply_markup)


def _clear_session(chat_id: str | int) -> None:
    _SESSIONS.pop(_chat_key(chat_id), None)


def _get_session(chat_id: str | int) -> dict[str, Any]:
    return _SESSIONS.setdefault(_chat_key(chat_id), {"mode": "idle", "step": None, "data": {}})


def _region_menu_text() -> str:
    lines = ["Region seç (nömrə və ya ad):"]
    for i, key in enumerate(BOT_REGION_KEYS, start=1):
        lines.append(f"{i}. {REGION_LABELS.get(key, key)}")
    return "\n".join(lines)


def _parse_region(text: str) -> str | None:
    raw = (text or "").strip().lower()
    if raw.isdigit():
        idx = int(raw) - 1
        if 0 <= idx < len(BOT_REGION_KEYS):
            return BOT_REGION_KEYS[idx]
    # label / key match
    for key in BOT_REGION_KEYS:
        label = REGION_LABELS.get(key, key).lower()
        if raw in {key, label, label.replace("ə", "e"), label.replace("ə", "a")}:
            return key
    aliases = {"sheki": "seki", "gabala": "qabala", "şəki": "seki", "qəbələ": "qabala"}
    if raw in aliases:
        return aliases[raw]
    if raw in REGION_LABELS or raw in BOT_REGION_KEYS:
        return raw if raw in BOT_REGION_KEYS else REGION_DB_ID.get(raw, raw)
    return None


def _lookup_user_id(chat_id: str | int) -> str | None:
    try:
        res = (
            supabase.table("profiles")
            .select("id")
            .eq("telegram_chat_id", str(chat_id))
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return str(rows[0]["id"])
    except Exception:
        logger.exception("lookup telegram_chat_id failed")
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
            return False, "Kod tapılmadı və ya artıq istifadə olunub. App-də yenidən bağlayın."

        row = rows[0]
        expires_at = row.get("expires_at")
        if expires_at:
            try:
                exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < datetime.now(timezone.utc):
                    supabase.table("telegram_link_codes").delete().eq("code", code_clean).execute()
                    return False, "Kodun müddəti bitib. App-də yenidən «Telegram bağla» basın."
            except ValueError:
                pass

        user_id = str(row["user_id"])
        chat_s = str(chat_id)

        # Detach this chat from any other profile
        supabase.table("profiles").update(
            {"telegram_chat_id": None, "telegram_linked_at": None}
        ).eq("telegram_chat_id", chat_s).execute()

        now_iso = datetime.now(timezone.utc).isoformat()
        supabase.table("profiles").update(
            {"telegram_chat_id": chat_s, "telegram_linked_at": now_iso}
        ).eq("id", user_id).execute()

        supabase.table("telegram_link_codes").delete().eq("code", code_clean).execute()
        return True, "Hesab bağlandı ✅ TripPoint menyusundan seçin."
    except Exception:
        logger.exception("link_account failed")
        return False, "Bağlama alınmadı. Bir az sonra yenidən yoxlayın."


def _help_text() -> str:
    return (
        "TripPoint bot\n\n"
        f"{BTN_AI} — region, gün, büdcə, maraqlar → AI marşrut\n"
        f"{BTN_MANUAL} — region + stop siyahısı (xəritə app-də)\n\n"
        "Hesabı bağlamaq: app → Profil → Telegram bağla"
    )


def _show_main_menu(chat_id: str | int, preface: str | None = None) -> None:
    text = (preface + "\n\n" if preface else "") + "Nə etmək istəyirsiniz?"
    _reply(chat_id, text, reply_markup=MAIN_KEYBOARD)


def _start_ai(chat_id: str | int) -> None:
    _SESSIONS[_chat_key(chat_id)] = {
        "mode": "ai",
        "step": "region",
        "data": {},
    }
    _reply(chat_id, "AI marşrut\n\n" + _region_menu_text(), reply_markup=FLOW_KEYBOARD)


def _start_manual(chat_id: str | int) -> None:
    _SESSIONS[_chat_key(chat_id)] = {
        "mode": "manual",
        "step": "region",
        "data": {"stops": []},
    }
    _reply(chat_id, "Manual marşrut\n\n" + _region_menu_text(), reply_markup=FLOW_KEYBOARD)


def _search_pois(region_key: str, query: str) -> list[dict[str, Any]]:
    db_region = REGION_DB_ID.get(region_key, region_key)
    q = (query or "").strip()
    try:
        if q:
            res = (
                supabase.table("pois")
                .select("id, name, region, category")
                .eq("region", db_region)
                .eq("status", "approved")
                .ilike("name", f"%{q}%")
                .limit(8)
                .execute()
            )
        else:
            res = (
                supabase.table("pois")
                .select("id, name, region, category")
                .eq("region", db_region)
                .eq("status", "approved")
                .limit(8)
                .execute()
            )
        return list(res.data or [])
    except Exception:
        logger.exception("POI search failed")
        return []


def _handle_ai_step(chat_id: str | int, text: str, session: dict[str, Any]) -> None:
    step = session.get("step")
    data = session.setdefault("data", {})

    if step == "region":
        region = _parse_region(text)
        if not region:
            _reply(chat_id, "Region tapılmadı.\n\n" + _region_menu_text(), reply_markup=FLOW_KEYBOARD)
            return
        data["region"] = region
        session["step"] = "days"
        _reply(
            chat_id,
            f"Region: {REGION_LABELS.get(region, region)}\nNeçə gün? (1–7)",
            reply_markup=FLOW_KEYBOARD,
        )
        return

    if step == "days":
        if not text.isdigit() or not (1 <= int(text) <= 7):
            _reply(chat_id, "1–7 arası rəqəm yazın.", reply_markup=FLOW_KEYBOARD)
            return
        data["days"] = int(text)
        session["step"] = "budget"
        _reply(
            chat_id,
            "Büdcə seçin:\n1. Qənaətcil\n2. Orta\n3. Premium",
            reply_markup=FLOW_KEYBOARD,
        )
        return

    if step == "budget":
        key = text.strip().lower()
        budget = BUDGET_MAP.get(key)
        if not budget:
            _reply(chat_id, "1 / 2 / 3 və ya qənaətcil / orta / premium yazın.", reply_markup=FLOW_KEYBOARD)
            return
        data["budget"] = budget
        session["step"] = "interests"
        _reply(
            chat_id,
            "Maraqlar (bir və ya bir neçə, vergüllə):\n"
            "1 təbiət  2 tarix  3 yemək\n"
            "4 ailə  5 aktiv  6 foto\n"
            "Məs: 1,3 və ya təbiət,yemək",
            reply_markup=FLOW_KEYBOARD,
        )
        return

    if step == "interests":
        parts = re.split(r"[,;\s]+", text.strip().lower())
        interests: list[str] = []
        for p in parts:
            if not p:
                continue
            mapped = INTEREST_MAP.get(p)
            if mapped and mapped not in interests:
                interests.append(mapped)
        if not interests:
            _reply(chat_id, "Ən azı bir maraq seçin (məs: 1 və ya təbiət).", reply_markup=FLOW_KEYBOARD)
            return
        data["interests"] = interests
        _reply(chat_id, "Marşrut hazırlanır…", reply_markup=FLOW_KEYBOARD)
        try:
            plan = run_plan_route(
                region=data["region"],
                days=int(data["days"]),
                budget=str(data.get("budget") or "mid"),
                interests=interests,
            )
            _clear_session(chat_id)
            _reply(chat_id, format_plan_for_telegram(plan), reply_markup=MAIN_KEYBOARD)
        except ValueError as exc:
            _clear_session(chat_id)
            _reply(chat_id, f"Xəta: {exc}", reply_markup=MAIN_KEYBOARD)
        except Exception:
            logger.exception("AI plan failed")
            _clear_session(chat_id)
            _reply(chat_id, "Marşrut hazırlanmadı. Bir az sonra yenidən yoxlayın.", reply_markup=MAIN_KEYBOARD)
        return

    _clear_session(chat_id)
    _show_main_menu(chat_id)


def _handle_manual_step(chat_id: str | int, text: str, session: dict[str, Any]) -> None:
    step = session.get("step")
    data = session.setdefault("data", {})
    stops: list[str] = list(data.get("stops") or [])

    if step == "region":
        region = _parse_region(text)
        if not region:
            _reply(chat_id, "Region tapılmadı.\n\n" + _region_menu_text(), reply_markup=FLOW_KEYBOARD)
            return
        data["region"] = region
        session["step"] = "stops"
        sample = _search_pois(region, "")
        hint = ""
        if sample:
            hint = "\nNümunələr:\n" + "\n".join(f"• {p.get('name')}" for p in sample[:5])
        _reply(
            chat_id,
            f"Region: {REGION_LABELS.get(region, region)}\n"
            f"Stop adı yazın (max {MAX_MANUAL_STOPS}).\n"
            f"Bitirəndə «{BTN_DONE}» basın.{hint}",
            reply_markup=MANUAL_KEYBOARD,
        )
        return

    if step == "stops":
        if text.strip() == BTN_DONE or text.strip().lower() in {"hazır", "hazir", "done"}:
            if not stops:
                _reply(chat_id, "Ən azı bir stop əlavə edin.", reply_markup=MANUAL_KEYBOARD)
                return
            region = data.get("region") or ""
            label = REGION_LABELS.get(region, region)
            lines = [f"🗺️ Manual marşrut — {label}", ""]
            for i, name in enumerate(stops, start=1):
                lines.append(f"{i}. {name}")
            lines.append("\nXəritə / redaktə: trippoint://ai-komekci")
            _clear_session(chat_id)
            _reply(chat_id, "\n".join(lines), reply_markup=MAIN_KEYBOARD)
            return

        if len(stops) >= MAX_MANUAL_STOPS:
            _reply(
                chat_id,
                f"Maksimum {MAX_MANUAL_STOPS} stop. «{BTN_DONE}» basın.",
                reply_markup=MANUAL_KEYBOARD,
            )
            return

        region = str(data.get("region") or "")
        found = _search_pois(region, text)
        if found:
            name = str(found[0].get("name") or text.strip())
            # If multiple, let user pick by showing list once then use first match for MVP
            if len(found) > 1 and text.strip().lower() not in {
                str(p.get("name") or "").lower() for p in found
            }:
                listing = "\n".join(f"{i}. {p.get('name')}" for i, p in enumerate(found[:5], start=1))
                data["pending_choices"] = [str(p.get("name") or "") for p in found[:5]]
                session["step"] = "pick_stop"
                _reply(
                    chat_id,
                    f"Bir neçə yer tapıldı — nömrə seçin:\n{listing}",
                    reply_markup=MANUAL_KEYBOARD,
                )
                return
        else:
            name = text.strip()
            if len(name) < 2:
                _reply(chat_id, "Daha uzun ad yazın və ya «Hazır» basın.", reply_markup=MANUAL_KEYBOARD)
                return

        stops.append(name)
        data["stops"] = stops
        data.pop("pending_choices", None)
        _reply(
            chat_id,
            f"Əlavə olundu ({len(stops)}/{MAX_MANUAL_STOPS}): {name}\n"
            f"Növbəti stop və ya «{BTN_DONE}».",
            reply_markup=MANUAL_KEYBOARD,
        )
        return

    if step == "pick_stop":
        choices: list[str] = list(data.get("pending_choices") or [])
        pick = text.strip()
        name: str | None = None
        if pick.isdigit():
            idx = int(pick) - 1
            if 0 <= idx < len(choices):
                name = choices[idx]
        else:
            for c in choices:
                if c.lower() == pick.lower():
                    name = c
                    break
        if not name:
            _reply(chat_id, "Nömrə ilə seçin.", reply_markup=MANUAL_KEYBOARD)
            return
        stops.append(name)
        data["stops"] = stops
        data.pop("pending_choices", None)
        session["step"] = "stops"
        _reply(
            chat_id,
            f"Əlavə olundu ({len(stops)}/{MAX_MANUAL_STOPS}): {name}\n"
            f"Növbəti stop və ya «{BTN_DONE}».",
            reply_markup=MANUAL_KEYBOARD,
        )
        return

    _clear_session(chat_id)
    _show_main_menu(chat_id)


def handle_telegram_update(update: dict[str, Any]) -> dict[str, Any]:
    """Process one Telegram Update. Always returns quickly; never raises to caller."""
    try:
        message = update.get("message") or update.get("edited_message")
        if not isinstance(message, dict):
            return {"ok": True, "ignored": True}

        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is None:
            return {"ok": True, "ignored": True}

        text = (message.get("text") or "").strip()
        if not text:
            return {"ok": True, "ignored": True}

        # /start CODE
        if text.startswith("/start"):
            parts = text.split(maxsplit=1)
            code = parts[1].strip() if len(parts) > 1 else ""
            if code:
                ok, msg = _link_account(chat_id, code)
                _clear_session(chat_id)
                if ok:
                    _show_main_menu(chat_id, msg)
                else:
                    _reply(chat_id, msg)
                return {"ok": True, "linked": ok}

            user_id = _lookup_user_id(chat_id)
            if not user_id:
                _reply(
                    chat_id,
                    "Salam! Əvvəl TripPoint app-də Profil → «Telegram bağla» basın, "
                    "sonra buraya qayıdıb /start edin.",
                )
                return {"ok": True, "linked": False}
            _clear_session(chat_id)
            _show_main_menu(chat_id, "Xoş gəldiniz!")
            return {"ok": True}

        user_id = _lookup_user_id(chat_id)
        if not user_id:
            _reply(
                chat_id,
                "Hesab bağlı deyil.\nApp → Profil → Telegram bağla → botda /start CODE",
            )
            return {"ok": True, "linked": False}

        if text == BTN_CANCEL or text.lower() in {"ləğv", "legv", "cancel", "/cancel"}:
            _clear_session(chat_id)
            _show_main_menu(chat_id, "Ləğv edildi.")
            return {"ok": True}

        if text == BTN_HELP or text.lower() in {"kömək", "komek", "/help", "help"}:
            _reply(chat_id, _help_text(), reply_markup=MAIN_KEYBOARD)
            return {"ok": True}

        if text == BTN_AI:
            _start_ai(chat_id)
            return {"ok": True}

        if text == BTN_MANUAL:
            _start_manual(chat_id)
            return {"ok": True}

        session = _get_session(chat_id)
        mode = session.get("mode") or "idle"

        if mode == "ai":
            _handle_ai_step(chat_id, text, session)
            return {"ok": True}
        if mode == "manual":
            _handle_manual_step(chat_id, text, session)
            return {"ok": True}

        _show_main_menu(chat_id)
        return {"ok": True}
    except Exception:
        logger.exception("handle_telegram_update failed")
        return {"ok": True, "error": True}
