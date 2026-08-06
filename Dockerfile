# Railway monorepo root build — API only
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Fully pinned + hashed: Railway, CI and local all resolve to the same tree.
COPY apps/api/requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY apps/api/main.py .
COPY apps/api/start.py .
COPY apps/api/app ./app

EXPOSE 8000

CMD ["python", "start.py"]
