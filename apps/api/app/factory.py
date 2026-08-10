"""FastAPI app factory."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ALLOW_ORIGINS, SENTRY_DSN, validate_settings
from app.rate_limit import RateLimitMiddleware
from app.routers import (
    health,
    sync,
    weather,
    route_candidates,
    plan_route,
    live_places,
    telegram,
    jobs,
    pois,
    ratings,
    notify_push,
)


def _init_sentry() -> None:
    if not SENTRY_DSN:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[FastApiIntegration()],
            traces_sample_rate=0.05,
            send_default_pii=False,
        )
    except Exception:
        # Optional dependency / misconfig — never block boot
        pass


def create_app() -> FastAPI:
    validate_settings()
    _init_sentry()

    application = FastAPI(title="TripPoint Backend", version="1.0.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ALLOW_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(RateLimitMiddleware)
    application.include_router(health.router)
    application.include_router(sync.router)
    application.include_router(weather.router)
    application.include_router(route_candidates.router)
    application.include_router(plan_route.router)
    application.include_router(live_places.router)
    application.include_router(telegram.router)
    application.include_router(jobs.router)
    application.include_router(pois.router)
    application.include_router(ratings.router)
    application.include_router(notify_push.router)
    return application
