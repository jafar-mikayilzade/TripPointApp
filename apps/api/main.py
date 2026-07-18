"""TripPoint API entrypoint — keep this file thin; put logic under `app/`."""

from app.factory import create_app

app = create_app()
