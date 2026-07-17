#!/usr/bin/env bash
# Story 10.10 — запуск реального бэка для full-flow e2e (webServer Playwright).
# Compose-Postgres (:5433) + Django runserver из .venv + БД vaps_e2e с сидом.
#
# Правило окружения (CLAUDE.md): если :5433 занят ЧУЖИМ контейнером — НЕ
# останавливать чужое; поднять изолированный postgres:16 на :5434 (креды
# vaps/vaps/vaps) и запускать с VAPS_DB_PORT=5434. Здесь: заданный извне
# VAPS_DB_PORT означает «БД уже поднята снаружи» — compose не трогаем.
#
# Порт бэка: E2E_BACKEND_PORT (дефолт 8000; на машинах, где :8000 занят чужим
# сервисом, задать другой — playwright.config читает ту же переменную и
# направляет туда preview-прокси и healthcheck).
set -euo pipefail

cd "$(dirname "$0")/../../Backend/VAPS"

BACKEND_PORT="${E2E_BACKEND_PORT:-8000}"

if [ -z "${VAPS_DB_PORT:-}" ]; then
  # Штатный путь: compose-Postgres проекта на :5433.
  docker compose up -d --wait db
  VAPS_DB_PORT=5433
fi

export VAPS_DB=postgres
export VAPS_DB_NAME=vaps_e2e
export VAPS_DB_USER=vaps
export VAPS_DB_PASSWORD=vaps
export VAPS_DB_HOST=localhost
export VAPS_DB_PORT
# Без nginx (runserver): байты вложений отдаёт сам Django (FileResponse) —
# иначе download-эндпоинт вернёт 200 с X-Accel-Redirect и ПУСТЫМ телом.
export VAPS_XACCEL_ENABLED=0

# createdb vaps_e2e при отсутствии (psycopg уже в .venv — зависимость Django).
.venv/bin/python - <<'PY'
import os

import psycopg

conn = psycopg.connect(
    dbname="postgres",
    user=os.environ["VAPS_DB_USER"],
    password=os.environ["VAPS_DB_PASSWORD"],
    host=os.environ["VAPS_DB_HOST"],
    port=os.environ["VAPS_DB_PORT"],
)
conn.autocommit = True
name = os.environ["VAPS_DB_NAME"]
with conn.cursor() as cur:
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
    if cur.fetchone() is None:
        cur.execute(f'CREATE DATABASE "{name}"')
        print(f"serve-backend: created database {name}")
conn.close()
PY

.venv/bin/python manage.py migrate --noinput

if [ -z "${E2E_SKIP_SEED:-}" ]; then
  # Детерминированный сид (гвард имени БД внутри). E2E_SKIP_SEED=1 — только
  # для red-прогонов TDD (пустой стенд обязан ронять спек).
  .venv/bin/python scripts/e2e_seed.py
fi

# exec — процесс runserver становится корневым: Playwright честно гасит его
# по завершении прогона. --noreload: не плодить дочерний перезапускающийся
# процесс (kill сироты не достанет).
exec .venv/bin/python manage.py runserver "127.0.0.1:${BACKEND_PORT}" --noreload
