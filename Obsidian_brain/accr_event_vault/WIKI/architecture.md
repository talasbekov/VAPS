# Архитектура — eventproject

> Обновлено: 2026-06-11 (исчерпывающее сканирование).

## Краткое описание

**eventproject** — система аккредитации участников охранных мероприятий Республики Казахстан. Операторы формируют заявки на аккредитацию делегаций (фото, сканы документов, ИИН), отправляют их администратору; участники также импортируются из внешних систем регистрации (KazEnergy/Avalon) по pull-модели. Монолит Django MVT с постепенно добавляемым DRF REST API.

## Технологический стек

| Категория | Технология | Версия | Примечание |
|-----------|------------|--------|------------|
| Язык | Python | 3.10 | |
| Фреймворк | Django | 5.1.3 | MVT, серверный рендеринг |
| REST API | Django REST Framework | 3.15.2 | + simplejwt 5.3.1 (установлен, не активирован) |
| БД | PostgreSQL | 15-alpine | база `eventdb` |
| Очереди | Celery | 5.5.3 | broker/backend: Redis db 0 |
| Кеш | Redis | 7.4-alpine | db 1, `KEY_PREFIX=eventproject`, TTL 300 с |
| Планировщик | django-crontab + django-celery-beat | | crontab: импорт каждые 2 мин; beat: DatabaseScheduler (без активных задач) |
| WSGI | Gunicorn | | 2 workers, timeout 120 с |
| Контейнеризация | Docker Compose | | 5 сервисов |
| Безопасность | django-axes 7.0.1, django-ratelimit 4.1.0, django-fernet-fields 0.6 | | |
| Конфигурация | python-decouple | 3.8 | все секреты из `.env` |
| Логирование | python-json-logger | | структурированный JSON |

## Архитектурный паттерн

Монолит Django MVT + тонкий слой DRF поверх него:

```
Браузер ──HTML/сессии──> Django views (eventproject/views/*) ──> Модели ──> PostgreSQL
SPA/API-клиент ──/api/v1/──> DRF ViewSets + RBAC permissions ──┘
KazEnergy/Avalon <──pull каждые 2 мин── cron job (RequestFactory → async view)
Celery worker <──Redis db0── задачи (cleanup архивов, импорт)
```

- Бизнес-логика в основном во view-функциях (`eventproject/views/`), разнесённых по доменам: `event.py`, `operator.py`, `request.py`, `attendee.py`, `file_download.py`, `health.py`, `integration/`.
- Языковые зеркала `kz_event`/`en_event` — дублирование view-слоя (без моделей), различия только в шаблонах/сортировке.
- DRF-слой (Story 2.x): `serializers/`, `permissions.py`, `api/urls.py`, RFC 7807 exception handler.

## RBAC

Роли: `superuser` > `superoperator` > `operator` > `user` (+ `system` для Celery в аудите). Хранятся в `Operator.role`; `User.role` — динамическое свойство. Permission-классы: `IsSuperuser`, `IsSuperoperator`, `IsOperator`. Видимость данных: оператор — только свои события (`user.operator.events`), superoperator/superuser — все (`serializers/rbac.py::get_operator_events`). HTML-слой использует декораторы `login_required`/`superuser_required`.

## Безопасность

| Механизм | Реализация |
|----------|------------|
| Шифрование PII | `Attendee.iin` — EncryptedCharField (Fernet), ключи `FERNET_KEYS` из env, поддержка ротации (список ключей). Дубликаты проверяются в памяти (`validators/iin.py`) |
| Брутфорс | django-axes: 10 попыток → блок IP 1 ч, только `REMOTE_ADDR` (X-Forwarded-For не доверяется) |
| Rate limiting | `@ratelimit(ip, 20/h)` на add/update attendee; `RatelimitMiddleware` → 429 |
| Сессии | Secure cookies, таймаут по ролям: superuser 4 ч / оператор 12 ч (`RoleBasedSessionTimeoutMiddleware`) |
| CSRF | `CSRF_COOKIE_SAMESITE='Strict'`, Secure, trusted origins из env |
| Заголовки | HSTS 1 год + subdomains, SSL redirect, nosniff, X-Frame-Options SAMEORIGIN |
| Аудит | `audit.py::audit_log()` — структурированные записи: user_id, role, action (`attendee.create/update/delete`, `event.create`, `request.completed`), obj_type/id, IP |
| Секреты | python-decouple, `.env` (gitignored), `.env.example` с заглушками |

### Middleware (по порядку)

Security → Session → CORS → **Axes** → **Ratelimit (custom)** → Common → CSRF → Authentication → **RoleBasedSessionTimeout (custom)** → **RequestLogging (custom)** → Message → XFrameOptions.

## Логирование

JSON-формат (python-json-logger) с фиксированным набором полей: timestamp, level, user_id, role, action, obj_type, obj_id, ip, message. `StructuredContextFilter` гарантирует наличие полей. Handlers: console JSON + RotatingFileHandler `logs/app.log` (5 МБ × 3). Логгеры: django, celery, eventproject, request_logger — все INFO.

## Асинхронная обработка

- **Celery worker** (concurrency=2): `cleanup_old_archives` (удаление ZIP старше 2 ч из `media/archives/`), `kazexpo_import_job` (импорт из внешнего API).
- **Celery beat**: DatabaseScheduler подключён, активных PeriodicTask нет — фактическое расписание ведёт **django-crontab**: `*/2 * * * * eventproject.cron.kazexpo_import_job`.
- **Async views**: интеграции написаны как `async def` с `httpx.AsyncClient` + `sync_to_async` для ORM; вызываются из синхронного кода через `async_to_sync`.
- Задача `create_event_archive` (фоновая архивация с прогрессом в Redis, retry, лимит 5 ГБ) — закомментирована; статус архива по-прежнему читается из cache (`archive_status_{event_id}`, TTL 1 ч).

## Данные и поток аккредитации

1. Оператор создаёт заявку (`Active`) и добавляет участников (валидация дат, файлов 1KB–9MB, ИИН для граждан РК, дубликаты).
2. `Checking` (предпросмотр) ⇄ `Active` → `Sent` (фиксируется `registration_time`).
3. Администратор выгружает JSON/ZIP → заявки `Exported`; delta-экспорты фиксируются в `ExportLog` (`dateAdd > exported_before`).
4. Параллельно каждые 2 минуты пулятся анкеты из KazEnergy/Avalon с ACK-подтверждением каждой анкеты.

## Тестирование

44+ тестов в `eventproject/tests/` (запуск с `settings_test.py`: SQLite in-memory, LocMem cache, авто-генерация Fernet-ключа): RBAC (9), аудит (9), шифрование (11), безопасность — CSRF/брутфорс/rate-limit/session-timeout (6), структурированное логирование (6), ExportLog (4), плюс модели/представления событий и DRF bootstrap. Нагрузочные тесты — Locust (`docs/load_tests/locustfile.py`), baseline в `docs/load_test_baseline_2026-04-14.json`.

## Известные архитектурные риски

- `CONN_MAX_AGE` не задан — новое соединение PostgreSQL на каждый запрос; пула (pgbouncer) нет.
- Gunicorn 2 sync-воркера — мало для продакшен-нагрузки (рекомендация: 2×CPU+1).
- p99 логина ~3000 мс под нагрузкой 100 пользователей (стоимость хеширования пароля) — в пределах NFR5 (<5000 мс), но на пределе роста.
- Дублирование view-кода в kz_event/en_event (3 копии логики).
- ID события/оператора для импорта KazEnergy захардкожены (777/1405) в задаче.
- `settings_mac.py` — legacy dev-конфиг с hardcoded SECRET_KEY и `CORS_ORIGIN_ALLOW_ALL=True`; не использовать.

Подробный план оптимизаций — в [performance-backlog.md](./performance-backlog.md).
