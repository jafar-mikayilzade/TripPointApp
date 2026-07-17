# TripPoint API (FastAPI worker)

OSM / mock / Google Places sync → Supabase `pois` upsert.

## Local

```bash
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # Windows
pip install -r requirements.txt
copy .env.example .env         # fill secrets
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Railway deploy

1. Push repo to GitHub (`.env` gitignore-dadır — secret commit olunmur).
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Service settings:
   - **Root Directory:** `apps/api`
   - Build uses `Dockerfile` + `railway.toml`
4. **Variables** (Settings → Variables):

   | Name | Value |
   |------|--------|
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_SERVICE_KEY` | service role key |
   | `DATA_SOURCE` | `osm` |
   | `GOOGLE_PLACES_API_KEY` | optional |

5. **Settings → Networking → Generate Domain** → copy public HTTPS URL.
6. Mobile `apps/mobile/.env`:

   ```env
   EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.up.railway.app
   ```

7. Expo-nu restart et. Yoxla:

   ```text
   https://YOUR-SERVICE.up.railway.app/
   https://YOUR-SERVICE.up.railway.app/api/sync-places?region=quba&category=restaurant
   ```

OSM sync 30–90 s çəkə bilər — normaldır.
