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
→ FastAPI (`DATA_SOURCE=mock` / `osm` / `google`)  
→ clean/map to schema  
→ Supabase upsert `on_conflict=place_id` (**SERVICE_ROLE yalnız serverdə**)  
→ Mobile yenidən Supabase-dən oxuyur

### Auth

Yalnız Supabase Auth (email / Google). Python auth etmir.

`SUPABASE_SERVICE_KEY` / Places API key **heç vaxt** mobile `EXPO_PUBLIC_*` içində olmamalıdır.

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

Server env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATA_SOURCE=osm`  
Service role key yalnız Railway Variables-də — heç vaxt `EXPO_PUBLIC_*` içində olmamalıdır.

Əgər `Railpack could not determine...` / `start.sh not found` görürsənsə: root `Dockerfile` push olunmayıb və ya Builder hələ Railpack-dir — Settings → Build → **Dockerfile** seç və Redeploy et.

## Repo layout

```
TripPoint/
  Dockerfile         # Railway monorepo API build
  railway.toml
  apps/mobile/       # Expo app
  apps/api/          # FastAPI worker
  docs/              # architecture & contracts
  .cursor/rules      # agent guidance
```

## Non-goals (don't break)

- Auth rewrite
- Listings/feed-i Python-a keçirmək (ayrı task olmadan)
- Google Places və ya service role key-i Expo app-ə qoymaq
