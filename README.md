# TripPoint

Monorepo: Expo mobile app + Python FastAPI worker + Supabase.

## Structure

| Path | Role |
|------|------|
| `apps/mobile` | Expo / React Native (UI, auth, POI read from Supabase) |
| `apps/api` | FastAPI (`/api/sync-places`, Places/mock → Supabase upsert) |
| `docs/ARCHITECTURE.md` | System design & POI contract |

## Setup

### API

```bash
cd apps/api
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install fastapi uvicorn supabase python-dotenv
# (və ya requirements.txt varsa: pip install -r requirements.txt)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Mobile

```bash
cd apps/mobile
npm install
npx expo start --dev-client
```

Mobile `.env` içində lokal API üçün:

```env
EXPO_PUBLIC_API_URL=http://<PC-LAN-IP>:8000
```

## Cursor

`TripPoint.code-workspace` faylını aç — mobile + api + docs bir pəncərədə.

## Git

Lokal monorepo; remote push ayrıca qərar verilir. `.env` və credentials gitignore-dadır.
