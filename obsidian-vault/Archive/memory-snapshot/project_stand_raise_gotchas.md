---
name: project-stand-raise-gotchas
description: "Подъём стенда Personnel-Records + PersonalRecordFront — две ямы, которые не видны из кода"
metadata: 
  node_type: memory
  type: project
  originSessionId: be7b91bc-b843-47a0-85ad-a0e84beeb1e2
---

Стенд: Django `:8100` (`local_postgres`, БД vaps-db-5434) + Next-хост
`PersonalRecordFront :3106`. Обе стороны поднимаются через `.claude/launch.json`
(`personnel-django`, `personalrecord-next-local`) — preview-инструментами, тогда
доступны консоль браузера и сеть.

Две ямы, каждая маскирует другую:

1. **Привязки user↔employee не делает ни один сид.** Все сотрудники стенда
   создаются с `user=None`, `seed_operations` — только RBAC. Любая ручка,
   определяющая подразделение через `User → Employee → StaffUnit → Division`
   (например `statuses/absence_statistics`), отвечает 400 «Пользователь не
   привязан к сотруднику», и дашборд выглядит сломанным. Лечится привязкой
   учётки к сотруднику, у которого есть `staff_unit.division`.

2. **Легаси-восьмёрка красных тестов** — из импорт-коммита донора `7577182f`
   (`Employee(full_name=, position=, division=)`, `StatusApplicationService()` с
   аргументами). Pre-existing, подтверждено A/B; не принимать за свой регресс.
   Двойка из `statuses/` была невидима, пока приложению не добавили
   `__init__.py` (см. [[feedback-namespace-pkg-breaks-pytest-collection]]).

CORS dev-портов уже починен шаблоном в `sqlite.py` — если снова «Failed to
fetch» при живом бэке, смотреть не туда.

- Общая dev-БД `vaps` (docker 5433) несёт **дрейф схемы чужой ветки**: колонка
  `alert_hour` NOT NULL в `ops_submission_control_settings`, которой нет ни в
  одной миграции текущих веток → `seed_e2e_expense_chain` падает IntegrityError,
  а `migrate` говорит «No migrations to apply». Для стенда — СВОЯ БД
  (`CREATE DATABASE vaps_stand` в том же контейнере) + `VAPS_DB_NAME=vaps_stand`.
- Порты :8000 и :5173 на ноутбуке заняты чужими процессами — Django на :8010,
  vite на :5199 (`VITE_PROXY_TARGET=http://127.0.0.1:8010` в
  `frontend/.env.development.local`, gitignored).

**Старый стек (Personnel-Records + PersonalRecordFront/Next) локально, 08.08.2026:**
- Бэк: `DJANGO_SETTINGS_MODULE=organization_management.config.settings.sqlite`
  (готовый dev-модуль: sqlite, InMemory channels, без Redis) + `runserver 127.0.0.1:8100`.
- У app `common` (UserRole/Role/Permission) **нет миграций в репо** — таблиц
  user_roles неоткуда взяться; `makemigrations common` локально, НЕ коммитить.
- Сиды `create_test_data` и `setup_demo_roles` **сломаны** (устарели против
  моделей: поля `division`/`UserRole.RoleType` больше нет) — сеять руками через
  shell: superuser + Division + Employee(+user link) + StaffUnit(+employee).
- Фронт: `npm run dev -- -p 3000` — ТОЛЬКО :3000: клиентский ApiClient бьёт в
  бэк НАПРЯМУЮ (fallback `localhost:8100` зашит, rewrites-прокси не используется),
  а CORS_ALLOWED_ORIGINS бэка пускает только `:3000`. `NEXT_PUBLIC_API_URL` в
  `.env.local` НЕ задавать (уводит клиента на кросс-ориджин). Логин admin/admin123
  через NextAuth → `/api/token/`.

**Стенд ветки e55 (актуальный, 10.08.2026):** весь порт живёт в
`claude/smart-josparlau-e55` (срезы ≤150 + A1 objects; origin отстаёт — срез 74;
main несёт только M1-M3). Бэк: `DJANGO_SETTINGS_MODULE=...settings.local_postgres`
(sqlite для e55 МЁРТВ — EXCLUDE/GiST миграции) → контейнер vaps-db-5434, база
`personnel_records` С ЖИВЫМИ ДАННЫМИ стройки (14 emp, users erda/observer/admin;
пароль admin сброшен на admin123) — НЕ пересоздавать. runserver :8100, фронт
`npm run dev -- -p 3000`. В venv доставить psycopg2-binary (django.contrib.postgres).
Реестр lib/api-gaps.ts УСТАРЕЛ: /api/ops/objects/, /api/core/staffing-slots/,
/api/documents/attachments/ уже живые, а баннеры пишут «на бэке нет»;
/api/operations/expense-reports/ — честный 404.
