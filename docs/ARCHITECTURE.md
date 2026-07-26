# TripPoint Architecture

## Overview

TripPoint üç qatdan ibarətdir. Auth və mövcud Supabase axını qorunur; Python kənar worker-dir.

| Layer | Tech | Responsibility |
|-------|------|----------------|
| Mobile | Expo / React Native (`apps/mobile`) | UI, auth session, xəritə/siyahı oxuma |
| Data | Supabase (Postgres + Auth + RLS) | profiles, pois, listings, … — **source of truth** |
| Worker | Python FastAPI (`apps/api`) | Places/mock sync, təmizləmə, upsert, marşrut riyaziyyatı, keş |

## Data flow

### Read (default)

Mobile → Supabase Client → `pois` (+ `poi_photos`)

Filter: `status = approved`, `region` = `quba|qusar|seki|lerik|qabala` (**lowercase**)

### Sync (background)

Mobile → `{API_URL}/api/sync-places?region=&category=`  
→ FastAPI (`DATA_SOURCE=mock` / `osm` / `google` / `hybrid`)  
→ clean/map to schema  
→ Supabase upsert `on_conflict=place_id` (**SERVICE_ROLE yalnız serverdə**)  
→ Mobile yenidən Supabase-dən oxuyur

### Auth

Yalnız Supabase Auth (email / Google). Python auth etmir.

`SUPABASE_SERVICE_KEY` / Places API key **heç vaxt** mobile `EXPO_PUBLIC_*` içində olmamalıdır.

### AI marşrut (plan-route)

| Priority | Endpoint | Notes |
|----------|----------|--------|
| **Only** | FastAPI `POST /api/plan-route` | Geo itinerary (Haversine NN), optional Claude tips, live Google candidates, `varietySeed` / travel window |
| ~~Edge~~ | Supabase Edge `plan-route` | **Deprecated** — mobile çağırmır (parity riski). Emergency reference only. |

Mobile: `apps/mobile/lib/planRoute.ts` — FastAPI + bir retry; API yoxdursa açıq xəta.

### Rate limit + live cache

- In-memory IP limits: `plan-route` 5/min, `live-places` 30/min, `sync-places` 10/min, `pois/upsert-google-place` 20/min (`app/rate_limit.py`).
- `live-places` viewport/region TTL ~12 dəq (`live_home_places.py`). Multi-worker üçün sonra Redis.

### Live places / cafe

Home + Qur live map və DB oxuma `cafe` kateqoriyasını atır (turizm səsi). Home filter çiplərində də `cafe` yoxdur; `PoiCategory` tipində legacy sətirlər üçün qala bilər.

## POI contract (upsert)

| Field | Rule |
|-------|------|
| `place_id` | UNIQUE — upsert açarı |
| `name`, `lat`, `lng` | tələb olunur |
| `region` | app REGIONS id: `quba`, `qusar`, `seki`, `lerik`, `qabala` |
| `status` | `pending \| approved \| rejected` — sync ilə gələnlər adətən `approved` |
| `category` | app enum (`restaurant`, `cafe`, `hotel`, …); Google `tourist_attraction` → map et |

**Region id uyğunluğu:** mobile `seki` / `qabala` istifadə edir; API mock-da bəzən `sheki` / `gabala` ola bilər. Sync yazmazdan əvvəl eyni id-lərə map edin ki, xəritə filteri boş qayıtmasın.

Optional: `address`, `website`, `phone`, `description`  
`geom`: DB trigger ilə `lat`/`lng`-dən (varsa); API `geom` göndərməyə məcbur deyil.

## Local dev

```bash
# API
cd apps/api
# .venv aktiv et, sonra:
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Mobile
cd apps/mobile
npx expo start --dev-client
```

Mobile `.env`:

```env
EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:8000
```

Real telefonda `localhost` işləmir — LAN IP istifadə et.

## Production (Railway)

Monorepo root-da `Dockerfile` + `railway.toml` API-ni Docker ilə build edir (Railpack/Expo-nu keçir).
Ətraflı: `apps/api/README.md`.

```env
# Mobile — lokal IP əvəzinə Railway HTTPS
EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.up.railway.app
```

Server env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATA_SOURCE=hybrid` (və ya `osm` / `google`), hybrid üçün `GOOGLE_PLACES_API_KEY`  
Service role key yalnız Railway Variables-də — heç vaxt `EXPO_PUBLIC_*` içində olmamalıdır.

Əgər `Railpack could not determine...` / `start.sh not found` görürsənsə: root `Dockerfile` push olunmayıb və ya Builder hələ Railpack-dir — Settings → Build → **Dockerfile** seç və Redeploy et.

## Repo layout

```
TripPoint/
  Dockerfile         # Railway monorepo API build
  railway.toml
  apps/mobile/       # Expo app
  apps/api/
    main.py          # thin entry (create_app)
    start.py
    app/
      factory.py / config.py / db.py
      routers/       # HTTP
      services/      # sync, OSM, mock, google, clean
      constants/     # regions, categories, OSM filters
      data/          # mock fixtures
  docs/
  .cursor/rules
```

## Scheduled jobs (Railway cron → FastAPI)

Secret: header `X-Cron-Secret` = `CRON_SECRET` (yoxdursa `TELEGRAM_NOTIFY_SECRET`).

| Endpoint | Tövsiyə olunan cədvəl | İş |
|----------|----------------------|-----|
| `POST /api/jobs/nightly` | hər gün 03:00 UTC | pending cleanup; expired listings; spots; rating_avg; **dublikat POI Telegram alert** (silmir) |
| `POST /api/jobs/enrich-places?limit=50` | hər gecə | Google Place Details (phone/website/description/opening_hours) — max 50/run |
| `POST /api/jobs/weekly-report` | bazar ertəsi 08:00 UTC | Admin Telegram həftəlik stats |

Nümunə (curl):

```bash
curl -X POST "$API_URL/api/jobs/nightly" -H "X-Cron-Secret: $CRON_SECRET"
```

## Push + events + bot sessions

| Piece | Where |
|-------|--------|
| Expo push token | `profiles.expo_push_token` — mobile `registerExpoPushToken` on session |
| Push send | FastAPI `POST /api/notify/push` + `push_notify.py` |
| Smart abunə | `subscriptions.ts` — organizer + region fans + Telegram/push mirror; listing spam-guard |
| Notify auth | Mobile `EXPO_PUBLIC_NOTIFY_SECRET` → header `X-Notify-Secret` (= Railway `TELEGRAM_NOTIFY_SECRET` or `CRON_SECRET`) |
| Product events | `app_events` + mobile `trackEvent` (`plan_route_success`, `favorite_add`, `listing_create`, `listing_join`) |
| Bot sessions | `bot_sessions` table — API service role only; survives Railway restart |
| Live Google → favorite | FastAPI `POST /api/pois/upsert-google-place` (service role) then favorite |

Migration: `apps/mobile/supabase/migrations/20260726_backlog_push_events_sessions_sponsor.sql`

## Sponsored POI + verified badge

- `pois.is_sponsored` / `sponsor_until` — home siyahıda sponsorlar əvvəl; UI «Sponsor» chip
- `profiles.is_verified` / `verified_at` — profil + elan creator badge
- Telegram admin (linked admin): `/verify`, `/unverify`, `/sponsor`, `/unsponsor`

## Observability

- API: optional `SENTRY_DSN` → `sentry-sdk` in `factory.py`
- Mobile: `lib/sentry.ts` no-op stub until `@sentry/react-native` + DSN + rebuild

## FINAL STATUS (backlog STEP 0–15)

| STEP | Status |
|------|--------|
| 0 Baseline | ✅ |
| 1 Release hygiene | ✅ |
| 2 Live POI → favorite | ✅ |
| 3 Rate limiting | ✅ |
| 4 live-places TTL cache | ✅ |
| 5 plan-route single source | ✅ |
| 6 Push notifications | ✅ (native rebuild + migration lazımdır) |
| 7 Smart abunə notify | ✅ |
| 8 Marşrutlarım UX | ✅ |
| 9 Sentry | ✅ API optional; mobile stub |
| 10 app_events + trackEvent | ✅ |
| 11 bot_sessions Postgres | ✅ (migration apply) |
| 12 Sponsored POI | ✅ |
| 13 Verified badge | ✅ |
| 14 Enrich UX + dup flag | ✅ (hours label + nightly Telegram) |
| 15 Docs | ✅ |

**Deploy checklist (manual):**

1. Supabase-də migration-ları tətbiq et (`20260726_photo_variants…`, `20260726_backlog_push…`)
2. Railway: `CRON_SECRET`, `TELEGRAM_NOTIFY_SECRET`, optional `SENTRY_DSN`
3. Mobile `.env`: `EXPO_PUBLIC_NOTIFY_SECRET` = eyni `TELEGRAM_NOTIFY_SECRET` dəyəri
4. Mobile: `npx expo prebuild` / EAS rebuild (`expo-notifications`, image manipulator)
5. Cron: nightly + enrich + weekly-report
6. Manual smoke: live POI → favorit; plan-route; listing create → abunə bildiriş; `/verify` + `/sponsor` bot

### Manual test script

```bash
# Jobs (secret required → 401 without)
curl -i -X POST "$API_URL/api/jobs/nightly"
curl -X POST "$API_URL/api/jobs/nightly" -H "X-Cron-Secret: $CRON_SECRET"

# Push (secret if configured)
curl -X POST "$API_URL/api/notify/push" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Secret: $TELEGRAM_NOTIFY_SECRET" \
  -d '{"user_ids":["USER_UUID"],"title":"Test","body":"TripPoint"}'
```

App: Expo start → live marker favorit → DB id; Sevimlilər → Marşrutlarım; Profil verified badge (admin `/verify`).

## Non-goals (don't break)

- Auth rewrite
- Listings/feed-i Python-a keçirmək (ayrı task olmadan)
- Google Places və ya service role key-i Expo app-ə qoymaq
- Scraper, OCR, OR-Tools, Redis, Trip Chat, full offline, business claim panel
