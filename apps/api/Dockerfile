FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Fully pinned + hashed: Railway, CI and local all resolve to the same tree.
COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY main.py .
COPY start.py .
COPY app ./app

EXPOSE 8000

CMD ["python", "start.py"]
