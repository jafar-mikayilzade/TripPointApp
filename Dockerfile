# Railway monorepo root build — API only
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/main.py .
COPY apps/api/start.py .
COPY apps/api/app ./app

EXPOSE 8000

CMD ["python", "start.py"]
