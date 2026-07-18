"""Supabase service-role client."""

from __future__ import annotations

from supabase import Client, create_client

from app.config import SUPABASE_SERVICE_KEY, SUPABASE_URL, validate_settings

validate_settings()

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
