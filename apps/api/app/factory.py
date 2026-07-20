"""FastAPI app factory."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import validate_settings
from app.routers import health, sync, weather, route_candidates, plan_route


def create_app() -> FastAPI:
    validate_settings()

    application = FastAPI(title="TripPoint Backend", version="1.0.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(health.router)
    application.include_router(sync.router)
    application.include_router(weather.router)
    application.include_router(route_candidates.router)
    application.include_router(plan_route.router)
    return application
