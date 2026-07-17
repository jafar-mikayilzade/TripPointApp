# TripPoint API (FastAPI worker)

OSM / mock / Google Places sync → Supabase `pois` upsert.

## Local

```bash
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Railway deploy (monorepo)

Repo root-da `Dockerfile` + `railway.toml` var — Railpack/Expo-nu keçir, yalnız API build olunur.

### 1) Push et

Root `Dockerfile` və `railway.toml` GitHub-da olmalıdır.

### 2) Railway service

1. [railway.app](https://railway.app) → project → service
2. **Settings → Source**
   - Repo: TripPoint
   - **Root Directory:** boş burax (repo root) **və ya** `apps/api`
3. **Settings → Build**
   - Builder: **Dockerfile** (avtomatik `Dockerfile` tapılmalıdır)
   - Əgər hələ Railpack işləyirsə: Builder-i əl ilə **Dockerfile** seç
4. **Settings → Deploy → Start Command** (ehtiyat):

   ```bash
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

5. **Variables:**

   | Name | Value |
   |------|--------|
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | service role key |
   | `DATA_SOURCE` | `osm` |

6. **Networking → Generate Domain**

7. Redeploy (Deployments → Redeploy)

### 3) Mobile

```env
EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.up.railway.app
```

### Yoxla

```text
https://YOUR-SERVICE.up.railway.app/
https://YOUR-SERVICE.up.railway.app/api/sync-places?region=quba&category=restaurant
```

### Tipik xəta: `Railpack could not determine...` / `start.sh not found`

Səbəb: Railway monorepo root-da Expo (`apps/mobile`) görür.
Həll: root `Dockerfile` push et + Builder = **Dockerfile** + Redeploy.
Root Directory `apps/api` qoyursansa, `apps/api/Dockerfile` istifadə olunur.
