# Документация проекта eventproject

> **Тип:** Монолит | **Язык:** Python 3.10 | **Фреймворк:** Django 5.1.3 + DRF 3.15.2
> **Домен:** Система аккредитации участников охранных мероприятий (Казахстан)
> **Дата генерации:** 2026-06-11 (полное пересканирование, exhaustive)

---

## Быстрый справочник

| Параметр | Значение |
|---------|---------|
| Язык | Python 3.10 |
| Фреймворк | Django 5.1.3 + Django REST Framework 3.15.2 |
| База данных | PostgreSQL 15 (Docker: сервис `db`, база `eventdb`) |
| Кеш | Redis 7.4 db1, `KEY_PREFIX=eventproject`, TTL 300 с |
| Очереди | Celery 5.5.3 + Redis db0 (worker concurrency=2 + beat) |
| WSGI | Gunicorn (2 workers, timeout 120 с) |
| Деплой | Docker Compose (5 сервисов) |
| Продакшен | `accr.sgork.kz` |
| Admin URL | `/embankment/` |
| Архитектурный паттерн | Django MVT монолит + DRF API-слой |
| Точка входа | `manage.py` → `eventproject/wsgi.py` |
| Интеграции | KazEnergy / Avalon (pull каждые 2 мин, django-crontab) |
| Безопасность | Fernet-шифрование ИИН, RBAC (4 роли), axes, ratelimit, аудит-лог |

---

## Документация

### Основные документы

- [Бизнес-процессы](./WIKI/business-processes.md) — простым языком: что система делает, роли, потоки заявок, QR, автоимпорт
- [Обзор проекта](./WIKI/project-overview.md) — назначение, возможности, роли, состояние на июнь 2026
- [Архитектура](./WIKI/architecture.md) — стек, паттерны, RBAC, безопасность, async, риски
- [Модели данных](./WIKI/data-models.md) — 10 моделей, шифрование ИИН, история миграций
- [API-контракты](./WIKI/api-contracts.md) — DRF API, HTML-маршруты (3 языка), интеграции, лимиты

### Техническое руководство

- [Анализ структуры кода](./WIKI/source-tree-analysis.md) — аннотированное дерево, точки входа, legacy-артефакты
- [Руководство разработчика](./WIKI/development-guide.md) — окружение, тесты, конвенции
- [Руководство по развёртыванию](./WIKI/deployment-guide.md) — Docker Compose, секреты, бэкап, мониторинг
- [RBAC-матрица](./WIKI/rbac-matrix.md) — роли, доступы, известные пробелы
- [Спецификация интеграций](./WIKI/integration-spec-v1.md) — контракт с KazEnergy/Avalon

### Аудит и roadmap

- [Аудит системы аккредитации](./WIKI/accreditation-gap-analysis.md) — пробелы, риски, приоритеты
- [Runbook production-readiness](./WIKI/ops-runbook-production-readiness.md) — готовность к бою, NFR

### Производительность

- [Performance backlog](./WIKI/performance-backlog.md) — открытые оптимизации
- [Baseline нагрузочного теста 2026-04-14](./load_test_baseline_2026-04-14.json) + [locust-сценарии](./load_tests/locustfile.py)

### Спеки и планы hardening-эпиков

- [`superpowers/specs/`](./superpowers/specs/) — design-документы завершённых hd-* задач
- [`superpowers/plans/`](./superpowers/plans/) — их implementation-планы

### Отчёты

- [Overnight-отчёт 2026-08-21](./OUTPUT/overnight-2026-08-21.md) — реализация 5 пунктов докладной записки (PDN consent gate, дашборд, валидация ФИО, CSV-экспорт Face ID, дедлайн подачи)
- [Overnight-отчёт 2026-08-23](./OUTPUT/overnight-2026-08-23.md) — закрытие роадмапа hardening целиком: как снимались «блокеры», что нашло ревью, открытые вопросы

---

## Приложения Django

| Приложение | Модели | Назначение |
|-----------|-------|-----------|
| `eventproject` | Event, Category, Operator, Request, Attendee, ExportLog | Ядро: бизнес-логика, DRF API, безопасность |
| `directories` | Sex, Country, DocumentType, City, Category | Справочные данные (3 языка) |
| `kz_event` | — | Казахский интерфейс (`/kz/`), зеркало view-слоя |
| `en_event` | — | Английский интерфейс (`/en/`), зеркало view-слоя |
| `qr_event` | QrIin | QR-коды по ИИН с валидацией ИИН РК |

---

## Быстрый старт для разработчика

```bash
# Docker (рекомендовано)
cp .env.example .env   # заполнить SECRET_KEY, DB_PASSWORD, FERNET_KEYS
docker compose up --build

# Или локально
python3.10 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # dev-инструменты (black, locust): pip install -r requirements-dev.txt
python manage.py migrate
python manage.py runserver
```

- Панель администратора: http://localhost:8000/embankment/
- QR-генератор: http://localhost:8000/qr/
- Health check: http://localhost:8000/api/health/
- Тесты: `python manage.py test eventproject.tests --settings=eventproject.settings_test`

---

## Ключевые особенности для AI-агентов

1. **Справочники через коды, не FK** — `countryId`, `docTypeId`, `sexId` в Attendee хранятся как CharField-коды.
2. **Казахстан = `"1000000105"`** — для граждан РК ИИН обязателен.
3. **`Attendee.iin` зашифрован** (Fernet) — `filter(iin=...)` невозможен; дубликаты через `validators/iin.py`.
4. **Многоязычность без i18n** — отдельные приложения `kz_event`/`en_event` с зеркальными views; правки HTML-логики дублировать в 3 местах.
5. **Интеграции не имеют URL** — `kazenergy_receive`/`kazexpo_receive` вызываются только из cron-задачи (`*/2 мин`) через RequestFactory + `async_to_sync`; ID события/оператора в Celery-задаче захардкожены (777/1405).
6. **Двойной view-слой** — старый монолитный `eventproject/views.py` сосуществует с пакетом `eventproject/views/`; актуальная логика в пакете.
7. **RBAC через `User.role`** — динамическое свойство (superuser → operator.role → "user"); permission-классы в `permissions.py`.
8. **Все операции с участниками аудируются** — `audit.py::audit_log()`, JSON-логи с фиксированными полями.
9. **Секреты только из `.env`** (python-decouple); `settings_mac.py` — legacy, не использовать.
10. **Тестовый профиль** — `settings_test.py` (SQLite in-memory, автогенерация Fernet-ключа).
