# Руководство разработчика — eventproject

> Обновлено: 2026-06-11.

## Предварительные требования

| Инструмент | Версия | Назначение |
|-----------|--------|-----------|
| Python | 3.10 | Среда выполнения |
| Docker + Docker Compose | актуальные | Полный стек (рекомендуется) |
| PostgreSQL | 15 | Если без Docker |
| Redis | 7.4 | Cache + Celery broker |

## Быстрый старт (Docker, рекомендуется)

```bash
cp .env.example .env        # заполнить SECRET_KEY, DB_PASSWORD, FERNET_KEYS и пр.
docker compose up --build
```

Контейнер приложения сам ждёт БД (`pg_isready`), применяет миграции, собирает статику и стартует на `http://localhost:8000`. Поднимаются: `accr-db` (PostgreSQL), `accr-redis`, `accr-django`, `accr-celery-worker`, `accr-celery-beat`.

## Переменные окружения (.env)

Обязательные: `SECRET_KEY`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `ALLOWED_HOSTS`, **`FERNET_KEYS`** (CSV-список; первый ключ шифрует, остальные — для ротации), `AVALON_API_KEY`.

Опциональные (со значениями по умолчанию): `DEBUG=False`, `SECURE_SSL_REDIRECT=True`, `SECURE_HSTS_SECONDS=31536000`, `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `REDIS_CACHE_URL=redis://redis:6379/1`, `CELERY_BROKER_URL=redis://redis:6379/0`, `CELERY_RESULT_BACKEND`, `MEDIA_ROOT`.

Генерация Fernet-ключа:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> Для локальной разработки без HTTPS установите `SECURE_SSL_REDIRECT=False`, иначе runserver будет редиректить на https.

## Локальная разработка без Docker

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt   # requirements-dev.txt: black, locust (dev/tooling-only)
cp .env.example .env                      # указать локальные DB_HOST/Redis
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Celery (отдельные терминалы):

```bash
celery -A eventproject worker --loglevel=INFO --concurrency=2
celery -A eventproject beat --loglevel=INFO --scheduler django_celery_beat.schedulers:DatabaseScheduler
```

## Frontend (React SPA — Increment 2)

React-кабинет оператора живёт в `frontend/` (React 19 + Vite 8 + TS, TanStack Query v5, Tailwind v4 + shadcn/ui). См. `frontend/README.md`.

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173 (прокси на Django :8000)
```

> ⚠️ Для session/CSRF по локальному HTTP задайте в `.env`: `SECURE_SSL_REDIRECT=False`, `SESSION_COOKIE_SECURE=False`, `CSRF_COOKIE_SECURE=False`, `ALLOWED_HOSTS=localhost,127.0.0.1`, `CSRF_TRUSTED_ORIGINS=http://localhost:8000,http://localhost:5173` (иначе secure-cookie не ставятся / запрос 400/403). Подробности — `frontend/README.md`.

## Наполнение справочников

```bash
python scripts/populate_cities.py        # cities.csv → City
python scripts/populate_categories.py    # categories.csv → Category (справочник)
python scripts/populate_docs.py          # docs.csv → DocumentType
python scripts/country_populate.py       # countries.csv → Country
```

## Тесты

```bash
python manage.py test eventproject.tests --settings=eventproject.settings_test
```

`settings_test.py`: SQLite in-memory, LocMem-кеш, автогенерация Fernet-ключа, отключённые secure-cookies. Покрытие: безопасность (CSRF, брутфорс, rate-limit, session-timeout), RBAC, аудит, шифрование ИИН (включая миграции), структурированное логирование, ExportLog, модели/вью событий.

### Нагрузочные тесты

```bash
pip install locust
locust -f docs/load_tests/locustfile.py --host http://localhost:8000
```

Baseline (100 пользователей, 60 с) — `docs/load_test_baseline_2026-04-14.json`. Учтите: rate-limit 20/h на `add_attendee` даёт 429 под нагрузкой — для нагрузочных прогонов нужен tuning (см. performance-backlog).

## Типовые задачи

| Задача | Как |
|--------|-----|
| Новая миграция | `python manage.py makemigrations && python manage.py migrate` |
| Откат шифрования ИИН | `python manage.py migrate eventproject 0008` (только при наличии FERNET_KEYS) |
| Django shell | `python manage.py shell` |
| Просмотр логов | `logs/app.log` (JSON, ротация 5МБ×3) или `docker compose logs -f accreditation-center` |
| Анализ сессий по nginx-логам | `python log_scan_sessionid.py`, `python logs/log_scan1.py` |
| Ручной импорт KazEnergy | вызвать задачу `eventproject.tasks.kazexpo_import_job` (учтите hardcoded Event=777/Operator=1405) |

## Конвенции

- Секреты только через `.env` (python-decouple); `.env` в .gitignore, заглушки — в `.env.example`.
- Никогда не фильтровать по `Attendee.iin` через ORM — поле шифрованное; использовать `validators/iin.py`.
- Изменения HTML-вью дублировать в `kz_event/views.py` и `en_event/views.py` + соответствующие шаблоны `templates/kz/`, `templates/en/`.
- Все значимые операции с участниками сопровождать `audit_log()`.
- `settings_mac.py` / `urls_mac.py` — legacy, не редактировать и не подключать.
