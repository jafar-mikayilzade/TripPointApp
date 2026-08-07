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

Filter: `status = approved`, `region` = app region id (**lowercase**, e.g. `quba`, `baku`, `susa`, …)

### Sync (background)

Mobile → `{API_URL}/api/sync-places?region=&category=`  
→ FastAPI (`DATA_SOURCE=mock` / `osm` / `google` / `hybrid`)  
→ clean/map to schema  
→ Supabase upsert `on_conflict=place_id` (**SERVICE_ROLE yalnız serverdə**)  
→ Mobile yenidən Supabase-dən oxuyur

### Auth

Yalnız Supabase Auth (email / Google). FastAPI istifadəçi yaratmır — gələn
`Authorization: Bearer <session token>`-i Supabase-də yoxlayır (`app/auth.py`).

Service role ilə yazan / pullu API yandıran endpoint-lər sessiya tələb edir:

| Endpoint | Tələb |
|----------|-------|
| `POST /api/plan-route` | Supabase sessiya (Claude/weather kvotası) |
| `POST /api/pois/upsert-google-place` | Supabase sessiya |
| `GET /api/sync-places` | Supabase sessiya **və ya** `X-Cron-Secret` |
| `POST /api/telegram/notify` | Sessiya və ya `X-Notify-Secret`; moderasiya düymələri yalnız DB-də açıq (`pending`/`open`) sətir üçün əlavə olunur |
| `POST /api/jobs/*` | Yalnız `X-Cron-Secret` |

`SUPABASE_SERVICE_KEY` / Places API key **heç vaxt** mobile `EXPO_PUBLIC_*` içində olmamalıdır.

`profiles` UPDATE RLS istifadəçiyə `role`, `is_verified`, `telegram_chat_id`
dəyişməyə icazə vermir (`20260731_profiles_update_rls.sql`).

### AI marşrut (plan-route)

| Priority | Endpoint | Notes |
|----------|----------|--------|
| **Only** | FastAPI `POST /api/plan-route` | Geo itinerary (Haversine NN), optional Claude tips, **DB `pois` candidates** (OSM live opt-in only), `varietySeed` / travel window |

Köhnə Supabase Edge `plan-route` funksiyası silinib (auth-suz Anthropic proxy idi).

Mobile: `apps/mobile/lib/planRoute.ts` — FastAPI + bir retry; API yoxdursa açıq xəta.

### Rate limit + live cache

- In-memory IP limits: `plan-route` 5/min, `live-places` 30/min, `sync-places` 10/min, `pois/upsert-google-place` 20/min, `telegram/notify` 10/min, `telegram/webhook` 120/min, `notify/dispatch` 30/min (`app/rate_limit.py`).
- `live-places` DB-only (`pois` + seeds); Overpass yoxdur. Viewport/region TTL ~12 dəq. OSM yalnız `sync-places` background.

### Live places / cafe

Home + Qur live map və DB oxuma `cafe` kateqoriyasını atır (turizm səsi). Home filter çiplərində də `cafe` yoxdur; `PoiCategory` tipində legacy sətirlər üçün qala bilər.

## POI contract (upsert)

| Field | Rule |
|-------|------|
| `place_id` | UNIQUE — upsert açarı |
| `name`, `lat`, `lng` | tələb olunur |
| `region` | app REGIONS id (canonical lowercase: `baku`, `quba`, `seki`, `susa`, … — full list in `apps/mobile/constants/regions.ts`) |
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

Server env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATA_SOURCE=osm` (default; Google Places lazım deyil). Alternativ: `hybrid` / `google` → `GOOGLE_PLACES_API_KEY`.  

**AI planlama = DB-first:** `plan-route` / Telegram / `route-candidates` default `source=db` (`pois` cədvəli). Canlı Overpass AI yolunda yoxdur.  
**OSM = sync filler:** `GET /api/sync-places?region=…&category=all` Overpass-dən attractions (waterfall/nature/historical/…) gətirir; `place_id` varsa **pass**, yoxdursa **insert**. Hotel/restaurant OSM sync-dən çıxarılıb (əl / admin Google upsert). Mobile rayon seçəndə `triggerRegionPlacesSync` non-blocking çağırır.  
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

Secret: header `X-Cron-Secret` = `CRON_SECRET`. Fallback yoxdur — `CRON_SECRET`
qurulmayanda bu endpoint-lər 503 qaytarır.

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
| Push send (app) | FastAPI `POST /api/notify/dispatch` → `notify_dispatch.py` + `push_notify.py` |
| Push send (server) | FastAPI `POST /api/notify/push` — `X-Notify-Secret`, server/tooling only |
| Smart abunə | `subscriptions.ts` — organizer + region fans + Telegram/push mirror; listing spam-guard |
| Notify auth | Supabase session token (`Authorization: Bearer`). Bundle-da server sirri yoxdur |
| Anti-spam | `/dispatch` yalnız `notification_ids` alır; alıcı və mətn bazadakı sətirlərdən oxunur (`actor_id = caller`, ≤15 dəq). `notifications` INSERT RLS-i onsuz da alıcının abunə olmasını tələb edir |
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
2. Railway: `CRON_SECRET` (**məcburi**, `TELEGRAM_NOTIFY_SECRET`-dən fərqli olmalıdır),
   `TELEGRAM_NOTIFY_SECRET`, optional `SENTRY_DSN`
3. Mobile `.env`: notify sirri **yoxdur** — bildirişlər istifadəçi sessiyası ilə gedir
4. Mobile: `npx expo prebuild` / EAS rebuild (`expo-notifications`, image manipulator)
5. Cron: nightly + enrich + weekly-report
6. Manual smoke: live POI → favorit; plan-route; listing create → abunə bildiriş; `/verify` + `/sponsor` bot

### Manual test script

```bash
# Jobs (secret required → 401 without)
curl -i -X POST "$API_URL/api/jobs/nightly"
curl -X POST "$API_URL/api/jobs/nightly" -H "X-Cron-Secret: $CRON_SECRET"

# Push — server route (secret required, 503 if unset)
curl -X POST "$API_URL/api/notify/push" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Secret: $TELEGRAM_NOTIFY_SECRET" \
  -d '{"user_ids":["USER_UUID"],"title":"Test","body":"TripPoint"}'

# Push — app route (401 without a valid Supabase session token)
curl -i -X POST "$API_URL/api/notify/dispatch" \
  -H "Content-Type: application/json" \
  -d '{"notification_ids":["ROW_UUID"]}'
```

App: Expo start → live marker favorit → DB id; Sevimlilər → Marşrutlarım; Profil verified badge (admin `/verify`).

## Non-goals (don't break)

- Auth rewrite
- Listings/feed-i Python-a keçirmək (ayrı task olmadan)
- Google Places və ya service role key-i Expo app-ə qoymaq
- Scraper, OCR, OR-Tools, Redis, Trip Chat, full offline, business claim panel
