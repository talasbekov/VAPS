# Руководство по развёртыванию — eventproject

> Обновлено: 2026-06-11. Продакшен: `accr.sgork.kz` (за Nginx).

## Топология Docker Compose

```
nginx (вне compose, TLS, auth_request → /auth_check/)
  └─> accr-django :8000  (gunicorn eventproject.wsgi --workers 2 --timeout 120)
        ├─> accr-db :5432      PostgreSQL 15-alpine, том ./postgres_data
        └─> accr-redis :6379   Redis 7.4-alpine (db0 — Celery, db1 — cache)
      accr-celery-worker       celery -A eventproject worker --concurrency=2
      accr-celery-beat         celery beat --scheduler DatabaseScheduler
```

| Сервис | Контейнер | Healthcheck | Зависимости |
|--------|-----------|-------------|-------------|
| db | accr-db | `pg_isready -U event -d eventdb` (5s×5) | — |
| redis | accr-redis | `redis-cli ping` (5s×5) | — |
| accreditation-center | accr-django | `curl -sf localhost:8000/api/health/` (30s, start 10s) | db, redis (healthy) |
| celery-worker | accr-celery-worker | — | db, redis, app |
| celery-beat | accr-celery-beat | — | db, redis, app |

Тома приложения: `./:/app`, `./media`, `./static`, `./staticfiles`, `./logs`, `/tmp:/tmp` (временные ZIP).

## Старт приложения

Команда контейнера приложения последовательно выполняет: ожидание БД (`pg_isready`) → `migrate --noinput` → `collectstatic --noinput` → запуск сервера. В Dockerfile прод-команда — Gunicorn (`--bind 0.0.0.0:8000 --workers 2 --timeout 120`).

## Развёртывание

```bash
git pull
cp .env.example .env   # при первом деплое; заполнить все секреты
docker compose build
docker compose up -d
docker compose ps      # дождаться healthy
curl -s localhost:8000/api/health/   # {"status":"ok","db":"ok"}
```

Миграции применяются автоматически при старте. **Перед миграциями 0009–0010 (шифрование ИИН) обязательно наличие корректных `FERNET_KEYS` и бэкап БД** — миграция шифрует данные батчами транзакционно.

## Секреты продакшена

`SECRET_KEY`, `DB_PASSWORD`/`POSTGRES_PASSWORD`, `FERNET_KEYS` (потеря ключей = потеря всех ИИН!), `AVALON_API_KEY`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` (https://accr.sgork.kz). Хранить вне репозитория; `.env` только на сервере.

**Ротация Fernet-ключей**: добавить новый ключ первым в `FERNET_KEYS` (старые оставить для расшифровки), перезапустить, при необходимости пересохранить записи для перешифрования.

## Мониторинг и логи

- **Health**: `/healthz/` (liveness), `/api/health/` (readiness с проверкой БД, 503 при недоступности).
- **Логи**: JSON в stdout контейнеров + `logs/app.log` (ротация 5МБ×3). Поля: timestamp, level, user_id, role, action, obj_type, obj_id, ip. Каждый HTTP-запрос — событие `request.completed`.
- **Аудит безопасности**: события `attendee.*`, `event.create`; скрипты `logs/log_scan1.py` (мульти-IP-сессии) и `log_scan_sessionid.py` для разбора nginx-логов.
- **Блокировки axes**: модель `AccessAttempt` в БД (`/embankment/` → Axes).

## Бэкап

| Что | Как |
|-----|-----|
| БД | `docker exec accr-db pg_dump -U event eventdb > backup_$(date +%F).sql` |
| Медиа (PII!) | архив каталога `media/` (фото/сканы участников, QR-коды) |
| `.env` | копия в защищённом хранилище — без FERNET_KEYS бэкап БД бесполезен для поля iin |

## Регламентные процессы

- Импорт KazEnergy: django-crontab `*/2 * * * *` — проверить, что crontab установлен (`python manage.py crontab add`) либо что задача идёт через Celery.
- Очистка архивов: задача `cleanup_old_archives` (ZIP старше 2 ч в `media/archives/`).
- Удаление старых мероприятий: ручной вызов `/flush_outdated_events/` (старше 900 дней).

## Известные продакшен-риски

1. `--workers 2` Gunicorn и отсутствие `CONN_MAX_AGE` — ограниченная пропускная способность (см. performance-backlog.md).
2. `runserver` в docker-compose команде приложения (dev-режим) при том, что Dockerfile содержит gunicorn — убедитесь, что в продакшене используется gunicorn-команда.
3. Том `./:/app` монтирует весь репозиторий, включая `.git` и venv-каталоги — для продакшена лучше собирать код в образ.
4. PostgreSQL порт 5432 проброшен наружу — закрыть фаерволом.
