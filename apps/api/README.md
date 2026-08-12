# TripPoint API (FastAPI worker)

OSM / Google / hybrid / mock sync → Supabase `pois` upsert.

**`DATA_SOURCE=hybrid`:** restaurant/hotel/hostel/guesthouse/home_restaurant → Google; nature/waterfall/mountain/lake/historical/monument/other → OSM. `category=all` hər ikisini merge + dedupe edir.

## Layout

```
main.py / start.py     # thin entrypoints
app/
  factory.py           # create_app()
  config.py / db.py
  constants/           # regions, categories, OSM filters
  data/                # mock fixtures
  services/            # fetch + clean + sync
  routers/             # HTTP routes
```

Yeni endpoint/məntiq üçün `main.py`-yə yığmayın — uyğun `routers/` / `services/` moduluna yazın.

## Local

```bash
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.lock
copy .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Asılılıqlar

| Fayl | Rol |
|------|-----|
| `requirements.txt` / `requirements-dev.txt` | Əl ilə redaktə olunan giriş — yalnız aralıqlar (`>=x,<y`) |
| `requirements.lock` / `requirements-dev.lock` | Generasiya olunur — bütün tranzitiv paketlər pin + sha256 |

Docker, Railway və CI **yalnız `.lock` fayllarını** quraşdırır (`--require-hashes`), ona görə üç mühit də eyni ağaca düşür. `requirements.txt`-də versiya aralığını dəyişdikdən sonra lock-u yenidən yaratmaq lazımdır — əks halda CI-dakı "Lock is in sync" addımı düşür.

Lock-lar `--universal` rejimində yaradılır: platformadan asılı paketlər marker ilə gəlir (məs. `uvloop ... ; sys_platform != 'win32'`), ona görə eyni fayl həm Linux deploy-da, həm Windows-da lokal quraşdırılır.

```bash
cd apps/api
pip install uv
uv pip compile --universal --python-version 3.12 --generate-hashes -o requirements.lock requirements.txt
uv pip compile --universal --python-version 3.12 --generate-hashes -o requirements-dev.lock requirements-dev.txt
```

`--python-version 3.12` deploy runtime-ının minimumudur — lokal interpretator daha yeni ola bilər. Paketləri qəsdən yeniləmək üçün əmrə `--upgrade` əlavə et.

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
4. **Settings → Deploy → Custom Start Command:**

   ```bash
   python start.py
   ```

   (`$PORT` yazma — `start.py` env-dən oxuyur.)

5. **Variables:**

   | Name | Value |
   |------|--------|
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | service role key |
   | `DATA_SOURCE` | `hybrid` (və ya `osm` / `google`) |
   | `GOOGLE_PLACES_API_KEY` | Places API key (`google` / `hybrid` üçün) |
   | `OPENWEATHER_API_KEY` | optional — `/api/weather` |
   | `ANTHROPIC_API_KEY` | optional — `/api/plan-route` tips only; without it template tips are used |

### Plan route

`POST /api/plan-route` — Haversine NN + 2-opt sıra, vaxt slotları serverdə; Claude yalnız summary/tip (əgər key varsa).

6. **Networking → Generate Domain**

7. Redeploy (Deployments → Redeploy)

### 3) Mobile

```env
EXPO_PUBLIC_API_URL=https://trippointapp-production.up.railway.app
```

### Yoxla

```text
https://trippointapp-production.up.railway.app/
https://trippointapp-production.up.railway.app/api/sync-places?region=quba&category=restaurant
```

### Tipik xəta: `Railpack could not determine...` / `start.sh not found`

Səbəb: Railway monorepo root-da Expo (`apps/mobile`) görür.
Həll: root `Dockerfile` push et + Builder = **Dockerfile** + Redeploy.
Root Directory `apps/api` qoyursansa, `apps/api/Dockerfile` istifadə olunur.
