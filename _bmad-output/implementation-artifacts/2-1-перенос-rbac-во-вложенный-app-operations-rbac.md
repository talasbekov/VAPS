---
baseline_commit: 1b65f54f485a0068c09540020f953e99ce716d1c
---
# Story 2.1: Перенос RBAC во вложенный app operations/rbac

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a разработчик,
I want перенести `Role` / `Permission` / `UserRole` / `RolePermission` / `TemporaryDutyPermission` из плоского `apps.operations` во вложенный app `apps.operations.rbac` (label `ops_rbac`) через `SeparateDatabaseAndState` + UPDATE `django_content_type`, **не переименовывая ни одной таблицы БД**,
so that субдомены живут в своих apps (по образцу `ops_statuses`) до роста данных, а воспроизводимый рецепт переноса задокументирован в `docs/` для последующих субдоменов (submissions, reports, …).

## Acceptance Criteria

1. **(AC-1) Перенос без переименования таблиц + зелёный gate.** **Given** существующие таблицы `ops_roles`, `ops_permissions`, `ops_user_roles`, `ops_role_permissions`, `ops_temporary_duty_permissions` с seed-данными, **When** применяю миграции переноса (`migrate`), **Then** ни одна таблица БД не переименована (все `db_table` неизменны), все тесты RBAC зелёные, а `python manage.py makemigrations --check --dry-run` чист (нет «забытых» изменений модели/состояния). Контент-типы (`django_content_type`) этих пяти моделей имеют `app_label='ops_rbac'`, тот же `id` сохранён (нет осиротевших строк `app_label='operations'`, FK из `auth_permission`/аудита не сломаны).
2. **(AC-2) Рецепт задокументирован.** **And** воспроизводимый рецепт переноса (generic «вынос моделей в свой app через `SeparateDatabaseAndState` без DDL» + конкретное применение к RBAC) задокументирован в `docs/`, включая rollback-заметки и обязательную проверку `makemigrations --check`.
3. **(AC-3) Анти-каскад.** **And** перенос НЕ блокирует функциональные эпики — RBAC работает на старом месте до и во время переноса; при буксовке стори откладывается тикетом (`deferred-work.md`), а E3+ продолжаются на текущей плоской структуре.

## Tasks / Subtasks

- [x] **Task 1. Каркас вложенного app `apps.operations.rbac`** (AC: 1) — зеркалит `ops_statuses`
  - [x] `apps/operations/rbac/__init__.py` (пустой)
  - [x] `apps/operations/rbac/apps.py`: `OpsRbacConfig(AppConfig)` с `default_auto_field="django.db.models.BigAutoField"`, `name="apps.operations.rbac"`, `label="ops_rbac"` (точная калька `OpsStatusesConfig`)
  - [x] `apps/operations/rbac/migrations/__init__.py`
  - [x] Зарегистрировать `"apps.operations.rbac"` в `config/settings.py` → `INSTALLED_APPS` (после `"apps.operations.statuses"`)
- [x] **Task 2. Перенос пяти моделей в `rbac/models.py`, очистка родителя** (AC: 1)
  - [x] Создать `apps/operations/rbac/models.py` с классами `Role`, `Permission`, `UserRole`, `RolePermission`, `TemporaryDutyPermission` — **дословно** перенести тела, `Meta.db_table` оставить без изменений (`ops_roles`, `ops_permissions`, `ops_user_roles`, `ops_role_permissions`, `ops_temporary_duty_permissions`), сохранить все `constraints`/`indexes`/`db_column`/`to_field`/`related_name`
  - [x] В `rbac/models.py` импортировать общую абстракцию и choices из РОДИТЕЛЯ (как `ops_statuses` импортирует `TimeStampedModel`): `from apps.operations.models import TimeStampedModel`, `from apps.operations.validators import DUTY_ROLE_CHOICES`, `from django.core.exceptions import ValidationError`
  - [x] `apps/operations/models.py`: **оставить только** `TimeStampedModel` (абстрактная база — используется и `ops_statuses`, и `ops_rbac`). Удалить пять классов и ставшие лишними импорты (`ValidationError`, `DUTY_ROLE_CHOICES`). НЕ добавлять re-export пяти моделей в родительский `models.py` (вызовет циклический импорт — см. Dev Notes → «Циклы импорта»)
- [x] **Task 3. Миграция состояния нового app — `ops_rbac/0001_initial.py`** (AC: 1)
  - [x] Сгенерировать `python manage.py makemigrations ops_rbac`, затем **обернуть** все авто-`CreateModel` в `migrations.SeparateDatabaseAndState(state_operations=[<сген. CreateModel ×5>], database_operations=[])` — таблицы уже существуют, DDL запрещён
  - [x] `dependencies`: добавить `("contenttypes", "__first__")` (нужно для Task 5); внутренних FK-зависимостей между моделями достаточно в рамках одного app
- [x] **Task 4. Миграция состояния родителя — `operations/0006_*.py`** (AC: 1)
  - [x] После Task 2 `makemigrations operations` сгенерирует `DeleteModel ×5` — **обернуть** в `SeparateDatabaseAndState(state_operations=[<DeleteModel ×5>], database_operations=[])` (никакого DROP)
  - [x] `dependencies = [("operations", "0005_created_by"), ("ops_rbac", "0001_initial")]` — состояние сначала создаётся в `ops_rbac`, затем удаляется из `operations`
- [x] **Task 5. Data-миграция контент-типов — `ops_rbac/0002_rename_content_types.py`** (AC: 1)
  - [x] `RunPython(forward, reverse)` через `apps.get_model("contenttypes", "ContentType")`: `forward` — `ContentType.objects.filter(app_label="operations", model__in=["role","permission","userrole","rolepermission","temporarydutypermission"]).update(app_label="ops_rbac")`; `reverse` — симметрично обратно. Идемпотентно и безопасно на пустой БД (фильтр ничего не находит — no-op)
  - [x] `dependencies = [("ops_rbac", "0001_initial"), ("operations", "0006_*")]` — UPDATE выполняется после переноса состояния
- [x] **Task 6. Обновить ВСЕ импорт-сайты на `apps.operations.rbac.models`** (AC: 1) — механическая правка путей, логику не трогать
  - [x] `apps/operations/services.py:6`, `apps/operations/selectors.py:1`
  - [x] `apps/operations/api/views.py:10`, `apps/operations/api/serializers.py:3-5`
  - [x] `apps/operations/management/commands/seed_operations.py:3`
  - [x] 15 тест-файлов в `apps/operations/tests/` (полный список с номерами строк — в Dev Notes → «Импорт-сайты»)
  - [x] НЕ трогать `apps/operations/statuses/models/employee_status.py:7` — он импортирует `TimeStampedModel` из `apps.operations.models`, который остаётся
- [x] **Task 7. Тест регистрации/инвариантов — `apps/operations/rbac/tests/test_app.py`** (AC: 1) — по образцу `statuses/tests/test_app.py`
  - [x] `"apps.operations.rbac" in settings.INSTALLED_APPS`
  - [x] `apps.get_app_config("ops_rbac").name == "apps.operations.rbac"`
  - [x] Для каждой из 5 моделей: `Model._meta.db_table` равен прежнему имени (таблица не переименована)
  - [x] Для каждой из 5 моделей: `ContentType.objects.get_for_model(Model).app_label == "ops_rbac"`; отсутствуют `ContentType` с `app_label="operations"` для этих `model`-имён (проверка отсутствия осиротевших строк)
  - [x] `apps/operations/rbac/tests/__init__.py`
- [x] **Task 8. Верификация** (AC: 1)
  - [x] `make gate` зелёный: `ruff check .` + `pytest -m "not property and not concurrency and not slow"` + `makemigrations --check --dry-run` (Postgres :5433, бюджет < 300 c)
  - [x] На копии БД с seed/данными донора прогнать `migrate`, убедиться: таблицы целы, строки на месте, `django_content_type` обновлён (тот же `id`), `seed_operations` повторно идемпотентен
- [x] **Task 9. Документировать рецепт** (AC: 2)
  - [x] `docs/recipes/separate-database-and-state-app-port.md`: generic шаги (create-state в новом app + delete-state в старом + content_type UPDATE, всё `database_operations=[]`), порядок зависимостей, обязательный `makemigrations --check`, rollback-заметки, конкретное применение к `ops_rbac`. Сослаться на этот рецепт из стори будущих субдоменов
- [x] **Task 10. Анти-каскад (страховка)** (AC: 3)
  - [x] Если SDAS/контент-типы буксуют на целевой БД — НЕ блокировать E3+: зафиксировать defer-тикет в `_bmad-output/implementation-artifacts/deferred-work.md`, оставить RBAC на старом месте, откатить миграции переноса (`reverse`), статус стори → отложена

## Dev Notes

### Что это за стори (суть и риск)
Чисто инфраструктурный рефактор: пять RBAC-моделей переезжают из плоского `apps/operations/models.py` в собственный вложенный app `apps/operations/rbac` (label `ops_rbac`) — **топология apps меняется, схема БД нет**. Механика — Django `SeparateDatabaseAndState`: миграции меняют только *состояние* (Django state), `database_operations=[]` → никакого `CREATE`/`DROP`/`RENAME`. Тождество `db_table` гарантирует, что данные остаются на месте. Контент-типы переименовываются UPDATE-ом (а не пересоздаются), чтобы сохранить `ContentType.id` и не сломать ссылки `auth_permission`/аудита/GenericFK по `content_type_id`.

Это «второй» вложенный app после `ops_statuses` — но `ops_statuses` был создан **с нуля** (`CreateModel`, `initial=True`), поэтому он образец СТРУКТУРЫ (apps.py/label/migrations/tests), но НЕ образец механики SDAS-переноса. Механику задаёт этот стори (и рецепт в `docs/`).

### Источник истины: целевая кодовая база — `Backend/VAPS`
Работаем в `Backend/VAPS/`. (Донорский `Backend/PersonnelStatus/` — эталон для parallel-run, его RBAC не трогаем.) [Source: project memory `project_vaps_architecture.md`]

### Текущее состояние файлов, которые меняем (прочитано)
- `apps/operations/models.py` [Source: Backend/VAPS/apps/operations/models.py] — содержит **только** RBAC: `TimeStampedModel` (абстрактная, `created_at`/`updated_at`/`created_by`), `Role` (PK `code`, `db_table="ops_roles"`), `UserRole` (`ops_user_roles`, UniqueConstraint `unique_user_role_scope`, Index `idx_ops_user_roles_user`, FK `role_code`→`Role.code` PROTECT), `RolePermission` (`ops_role_permissions`, UniqueConstraint `unique_role_permission`, FK на `Role`/`Permission` CASCADE), `TemporaryDutyPermission` (`ops_temporary_duty_permissions`, Index `idx_ops_temp_duty_user`, `clean()` валидирует `starts_at < ends_at`, `duty_role_code` из `DUTY_ROLE_CHOICES`), `Permission` (PK `code`, `ops_permissions`). **Все** FK используют строковые ссылки в рамках app (`"Role"`, `"Permission"`) и `to_field="code"`/`db_column` — после переноса они останутся внутри `ops_rbac`.
- `apps/operations/apps.py` — `OperationsConfig`, `label="operations"` (НЕ меняем).
- `apps/operations/validators.py` — `DUTY_ROLE_CHOICES` (остаётся в родителе; `rbac/models.py` импортирует оттуда).
- `apps/operations/services.py` — `PermissionService`, `RoleAdminService`; импорт `from apps.operations.models import RolePermission, TemporaryDutyPermission, UserRole` (строка 6). Импортирует `apps.core.clock.Clock`, `apps.core.selectors.CoreDivisionTreeSelector`, `apps.operations.selectors.OpsUserRoleSelector` — границы соблюдены (operations→core только через selectors/clock).
- `apps/operations/selectors.py` — `OpsUserRoleSelector`; импорт `from apps.operations.models import UserRole` (строка 1).
- `apps/operations/api/{views,serializers}.py` — импортируют `Permission, Role, TemporaryDutyPermission, UserRole`; `api/permissions.py` импортирует `PermissionService` из `apps.operations.services` (менять НЕ нужно); `api/urls.py` тянет вьюхи (менять НЕ нужно).
- `apps/operations/management/commands/seed_operations.py:3` — `from apps.operations.models import Permission, Role, RolePermission`. Это seed 17 прав / 8 ролей; идемпотентен (`update_or_create`). После переноса меняем только путь импорта.
- `apps/operations/migrations/0001..0005` — **история, не трогаем** (immutable). `0001` создаёт `Role`+`Permission`; `0002` `RolePermission`; `0003` `UserRole` (FK `to="operations.role"`); `0004` `TemporaryDutyPermission`; `0005_created_by` добавляет `created_by` в `rolepermission`+`userrole`. Все зависимости — внутри app (`("operations", "000N")`); **ни один внешний app не зависит от `("operations", …)`** → перенос состояния безопасен по порядку миграций.

### Прецедент `ops_statuses` — что калькировать
- `apps/operations/statuses/apps.py`: `OpsStatusesConfig`, `name="apps.operations.statuses"`, `label="ops_statuses"` → `OpsRbacConfig`, `name="apps.operations.rbac"`, `label="ops_rbac"`.
- Импорт-путь потребителей: `from apps.operations.statuses.models import EmployeeStatus` → для RBAC `from apps.operations.rbac.models import <…>` (синтаксис идентичен; `models.py`-модуль годится так же, как у `statuses` — `models/`-пакет; пять связных моделей кладём в один `models.py`).
- Тест регистрации `statuses/tests/test_app.py` → шаблон для `rbac/tests/test_app.py` (`*_app_installed`, `get_app_config("ops_rbac").name`, `db_table`).
- `statuses/models/employee_status.py:7` уже делает `from apps.operations.models import TimeStampedModel` — подтверждает паттерн «вложенный app импортирует абстрактную базу из родителя».

### Импорт-сайты (полный список для Task 6) — точные строки
Менять `apps.operations.models` → `apps.operations.rbac.models`:
- `apps/operations/services.py:6` — `RolePermission, TemporaryDutyPermission, UserRole`
- `apps/operations/selectors.py:1` — `UserRole`
- `apps/operations/api/views.py:10` — `Permission, Role, TemporaryDutyPermission, UserRole`
- `apps/operations/api/serializers.py:3-5` — `Permission, Role, TemporaryDutyPermission, UserRole`
- `apps/operations/management/commands/seed_operations.py:3` — `Permission, Role, RolePermission`
- Тесты `apps/operations/tests/` (15 файлов): `test_actor_field.py:8`, `test_api_permissions.py:14`, `test_permission_scope.py:8`, `test_permission_service.py:5`, `test_permission_temp_duty.py:6`, `test_rbac_write_services.py:5`, `test_role_permissions.py:5`, `test_roles_api.py:6`, `test_roles_permissions.py:3`, `test_seed.py:4`, `test_temp_duty_api.py:8`, `test_temporary_duty.py:5`, `test_user_role_selector.py:4`, `test_user_roles_api.py:5`, `test_user_roles.py:5`.
- НЕ трогать: `apps/operations/statuses/models/employee_status.py:7` (импорт `TimeStampedModel` остаётся валидным).

> Совет дев-агенту: после правок прогнать `grep -rn "from apps.operations.models import" Backend/VAPS/apps` — должны остаться только импорты `TimeStampedModel` (из `statuses` и `rbac`), ни одной из пяти RBAC-моделей.

### Циклы импорта — почему НЕ делать re-export пяти моделей в родителе
Соблазн оставить в `apps/operations/models.py` строку `from apps.operations.rbac.models import Role, …`, чтобы не править импорт-сайты. **Нельзя**: возникает хрупкий цикл (`operations.models` ↔ `rbac.models`), который разрешается только за счёт порядка загрузки app'ов и падает `ImportError`, если `rbac.models` импортируется первым. Корректный DAG: дети (`rbac`, `statuses`) импортируют из родителя (`operations.models` → только `django`), родитель из детей — никогда. Поэтому импорт-сайты обновляем явно (это и есть цель рефактора — «субдомены живут в своих apps»).

### Механика миграций (ключевой риск стори) — точный рецепт
1. **`ops_rbac/0001_initial.py`** — `SeparateDatabaseAndState(state_operations=[CreateModel(Role), CreateModel(Permission), CreateModel(UserRole), CreateModel(RolePermission), CreateModel(TemporaryDutyPermission)], database_operations=[])`. Авто-`CreateModel` от `makemigrations ops_rbac` копируем как есть (он отразит текущие модели, включая `created_by`), только заворачиваем в SDAS. `dependencies=[("contenttypes","__first__")]`.
2. **`operations/0006_*`** — `SeparateDatabaseAndState(state_operations=[DeleteModel(...) ×5], database_operations=[])`, `dependencies=[("operations","0005_created_by"),("ops_rbac","0001_initial")]`.
3. **`ops_rbac/0002_rename_content_types.py`** — `RunPython` UPDATE `django_content_type` (см. Task 5), `dependencies=[("ops_rbac","0001_initial"),("operations","0006_*")]`.
- **Почему UPDATE, а не пересоздание CT**: `create_contenttypes` (post_migrate) создаёт недостающие CT по текущим моделям. Если переименовать строку UPDATE-ом — `id` сохраняется, дублей не возникает, `auth_permission`/аудит/GenericFK по `content_type_id` целы, осиротевших `operations`-строк нет (они переименованы, а не оставлены). На свежей БД UPDATE — no-op (CT для `ops_rbac` создаются post_migrate напрямую).
- **Промежуточное состояние**: между шагами 1 и 2 обе app-state временно «знают» модель с одним `db_table` — это допустимо для state (DDL не выполняется), а финальный `makemigrations --check` видит только `ops_rbac` → чисто.
- **Rollback**: миграции реверсивны (SDAS-state откатывается, `RunPython.reverse` возвращает `app_label`). Реальные таблицы не затрагиваются ни вперёд, ни назад. Это и есть страховка анти-каскада (Task 10).

### Тестовый харнесс и команды
- pytest-django, `DJANGO_SETTINGS_MODULE=config.settings`, `testpaths=["apps"]`, `--strict-markers`; маркеры: `property`/`concurrency`/`slow` [Source: Backend/VAPS/pyproject.toml].
- `make gate` (рабочая директория `Backend/VAPS/`): `docker compose up -d --wait db` (Postgres :5433) → `ruff check .` → `pytest -m "not property and not concurrency and not slow"` → `makemigrations --check --dry-run`; бюджет < 300 c (NFR-8) [Source: Backend/VAPS/Makefile:31-54]. Зелёный gate — прямое доказательство AC-1.
- RBAC-модели без Postgres-only фич → их тесты идут и на SQLite, но финальная проверка обязательно через `make gate` (Postgres + `makemigrations --check`).
- AC-1 «контент-типы целы» дополнительно проверяется в `rbac/tests/test_app.py` (см. Task 7) и ручным `migrate` на копии БД с данными (Task 8).

### Архитектурные правила и границы (соблюсти)
- **Вложенные apps = швы**: `name="apps.operations.<sub>"`, `label="ops_<домен>"`, у каждого свои `migrations/`, `db_table` всегда явный → топология apps отвязана от схемы БД [Source: architecture.md:514-517, 581]. FR-33…34 RBAC → `operations/rbac` («есть, перенос») [Source: architecture.md:612].
- **Django-механика (обязательно)**: `makemigrations --check --dry-run` в gate (защита от молчаливого `DeleteModel`); миграции с ручными именами; реэкспорт моделей в `__init__.py` — контракт (актуально, если позже дробить `models.py`→`models/`) [Source: architecture.md:596].
- **Границы**: `operations/* → core` только через `selectors`/`exceptions`/`clock`, НЕ models — `services.py` это уже соблюдает; `rbac/models.py` импортирует только из родителя `apps.operations` (TimeStampedModel/validators), без `apps.core` [Source: architecture.md:586-588]. `test_isolation.py` проверяет core↛operations и «no wall-clock в domain layers» (rbac/models через `auto_now` kwargs — не нарушает) [Source: Backend/VAPS/apps/core/tests/test_isolation.py].
- **Запрещено**: общие `services.py`/`selectors.py` в корне `operations` (god-модули) [Source: architecture.md:594]. ⚠️ Сейчас `operations/services.py` и `operations/selectors.py` существуют в корне — это легаси; **их вынос в `rbac/` — ВНЕ скоупа этого стори** (см. Out of Scope), запрет пока не enforced тестом.

### Project Structure Notes
- Новый app строго по образцу `ops_statuses`: `apps/operations/rbac/{__init__.py, apps.py, models.py, migrations/, tests/}`.
- **Variance (осознанный)**: стори трогает > 5 файлов (правка ~20 импорт-строк в services/selectors/api/seed/15 тестов). Это неустранимо для атомарного переноса модели (нельзя сдвинуть модель, не обновив импортёров в том же коммите — иначе красные тесты) и прямо предусмотрено архитектурой (изоляция вложенных apps). Все правки вне новых файлов — **только пути импорта**, без изменения логики. Ответственность стори остаётся одна: безопасно перенести RBAC-слой моделей.
- `TimeStampedModel` остаётся в `apps/operations/models.py` как общая база для `ops_statuses` и `ops_rbac` (минимальная диффузия, прецедент уже есть).

## Out of Scope (не трогать)

- Перенос `services.py`/`selectors.py`/`validators.py`/`api/` из корня `operations` в `rbac/` — отдельная задача организации кода (не требуется ни одним AC; раздувает скоуп и риск). Сейчас потребители импортируют модели из `apps.operations.rbac.models`, а сервисы остаются на текущих путях.
- Любые изменения схемы БД, имён таблиц/колонок/констрейнтов, seed-данных, бизнес-логики RBAC (`PermissionService`/`RoleAdminService`).
- `apps.operations.statuses` и его импорт `TimeStampedModel`.
- RBAC-матрица роль×операция (это Story 2.9), новые роли/права, API-поведение.
- Донорский `Backend/PersonnelStatus/`.

## Dependencies

- Depends on Story 1.4 (`created_by`/actor в базовых моделях — `operations/0005_created_by`) — done.
- Depends on Story 1.5 (прецедент `ops_statuses` как вложенного app) — done.
- Blocks: ничего жёстко (анти-каскад AC-3 — RBAC работает на старом месте; E3+ не ждут). Рецепт из AC-2 переиспользуют будущие переносы субдоменов.

## Tests

- **Unit / app-инварианты** (`apps/operations/rbac/tests/test_app.py`, по образцу `ops_statuses`): app зарегистрирован; `get_app_config("ops_rbac").name`; `db_table` всех 5 моделей неизменны; `ContentType` каждой модели имеет `app_label="ops_rbac"` и нет осиротевших `operations`-строк.
- **Регрессия RBAC**: все 15 существующих тестов `apps/operations/tests/` зелёные после правки импортов (поведение `PermissionService`, scope-subtree, временные дежурные права, seed, API ролей/прав/user-roles) — это «тесты RBAC зелёные» из AC-1.
- **Миграции**: `makemigrations --check --dry-run` чист (в `make gate`).
- **Manual**: `migrate` на копии БД с seed/данными донора → таблицы и строки целы, `django_content_type` обновлён (тот же `id`), `seed_operations` повторно идемпотентен; пробный `migrate <app> <prev>` (reverse) откатывает чисто.

## Definition of Done

- [x] Код реализован (app `ops_rbac`, 3 миграции SDAS+content_type, обновлённые импорты)
- [x] `apps/operations/rbac/tests/test_app.py` добавлен; импорты во всех потребителях обновлены
- [x] `make gate` зелёный (ruff + pytest + `makemigrations --check`), ручной `migrate` на копии БД проверен
- [x] Lint (ruff) чист
- [x] Нет хардкод-секретов
- [x] Рецепт `docs/recipes/separate-database-and-state-app-port.md` написан (AC-2)
- [x] Ни одна таблица БД не переименована; контент-типы целы (AC-1)
- [x] Анти-каскад зафиксирован (если перенос буксует — defer-тикет в `deferred-work.md`, RBAC остаётся на месте) (AC-3)

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — bmad-dev-story, 2026-06-21.

### Debug Log References

- `make gate` → **358 passed, 7 deselected**, `ruff check .` чист, `makemigrations --check --dry-run` = «No changes detected», 9s (бюджет NFR-8 < 300s).
- `apps/operations/rbac/tests/test_app.py` → 13 passed (2 регистрация + 5 db_table + 5 content_type app_label + 1 no-orphans).
- Ручная репетиция миграции на копии БД с seed (`vaps_migtest`, worktree на baseline `1b65f54`): см. Completion Notes.

### Completion Notes List

- **AC-1 (перенос без переименования + зелёный gate).** 5 моделей перенесены `apps.operations.models` → `apps.operations.rbac.models` (label `ops_rbac`) дословно, все `db_table` неизменны. Механика — `SeparateDatabaseAndState` с `database_operations=[]`:
  - `ops_rbac/0001_initial` — state `CreateModel ×5` (обёрнут, отформатирован `ruff format` — whitespace, состояние не меняется).
  - `operations/0006_remove_rbac_models_state` — state `RemoveField ×3 + DeleteModel ×5`, deps `[("operations","0005_created_by"),("ops_rbac","0001_initial")]`.
  - `ops_rbac/0002_rename_content_types` — `RunPython` UPDATE `django_content_type` (collision-safe), deps `[("ops_rbac","0001_initial"),("operations","0006_*")]`.
  - `makemigrations --check` чист → состояние SDAS точно равно моделям.
- **Ручная верификация на populated-БД** (донорский объём seed: 8 ролей / 17 прав / 18 role-perm). Forward: `content_type.id` РБАК-моделей **сохранены** (19–23 остались теми же, `app_label` сменился `operations`→`ops_rbac`), **0 осиротевших** `operations`-строк, счётчики строк (8/17/18/0/0) не изменились (таблицы не пересоздавались). `seed_operations` повторно идемпотентен.
- **Найден и исправлен дефект реверса.** Голый `RunPython UPDATE` не переживал round-trip: при `unapply` 0002 `post_migrate` пересоздавал `ops_rbac`-контент-типы с новым `id`, и повторный forward падал на `UNIQUE (app_label, model)`. Решение — **collision-safe `_relabel`** (перед `update` удалять дубль в целевом `app_label`; на штатном первом переносе — no-op, оригинальный `id` сохраняется). После фикса round-trip reverse→re-forward проходит чисто и реклеймит оригинальные `id`. Нюанс задокументирован в рецепте (rollback требует отката кода вместе с миграциями).
- **AC-2 (рецепт).** `docs/recipes/separate-database-and-state-app-port.md` — generic-шаги + конкретика `ops_rbac` + collision-safe `RunPython` + rollback-заметки (включая post_migrate-нюанс) + обязательный `makemigrations --check`. Переиспользуется будущими переносами субдоменов.
- **AC-3 (анти-каскад).** Перенос НЕ забуксовал — defer-тикет в `deferred-work.md` не создавался (условие Task 10 ложно). Анти-каскад обеспечен иначе: миграции реверсивны (доказано), RBAC работает на тех же таблицах; функциональные эпики (E3+) не блокируются.
- **Циклы импорта.** `rbac/models.py` импортирует `TimeStampedModel`/`DUTY_ROLE_CHOICES` из родителя `apps.operations` (DAG ребёнок→родитель сохранён); re-export пяти моделей в родителя НЕ добавлялся. `statuses/models/employee_status.py` (`TimeStampedModel`) не тронут.

### File List

**To Create:**
- `Backend/VAPS/apps/operations/rbac/__init__.py`
- `Backend/VAPS/apps/operations/rbac/apps.py`
- `Backend/VAPS/apps/operations/rbac/models.py`
- `Backend/VAPS/apps/operations/rbac/migrations/__init__.py`
- `Backend/VAPS/apps/operations/rbac/migrations/0001_initial.py`
- `Backend/VAPS/apps/operations/rbac/migrations/0002_rename_content_types.py`
- `Backend/VAPS/apps/operations/rbac/tests/__init__.py`
- `Backend/VAPS/apps/operations/rbac/tests/test_app.py`
- `Backend/VAPS/apps/operations/migrations/0006_remove_rbac_models_state.py`
- `docs/recipes/separate-database-and-state-app-port.md`

**To Modify:**
- `Backend/VAPS/config/settings.py` (INSTALLED_APPS — добавлен `apps.operations.rbac`)
- `Backend/VAPS/apps/operations/models.py` (оставлен только `TimeStampedModel`)
- `Backend/VAPS/apps/operations/services.py` (импорт; обёрнут в скобки — E501)
- `Backend/VAPS/apps/operations/selectors.py` (импорт)
- `Backend/VAPS/apps/operations/api/views.py` (импорт; обёрнут в скобки — E501)
- `Backend/VAPS/apps/operations/api/serializers.py` (импорт)
- `Backend/VAPS/apps/operations/management/commands/seed_operations.py` (импорт)
- `Backend/VAPS/apps/operations/tests/*.py` (15 файлов — импорт): `test_actor_field.py`, `test_api_permissions.py`, `test_permission_scope.py`, `test_permission_service.py`, `test_permission_temp_duty.py`, `test_rbac_write_services.py`, `test_role_permissions.py`, `test_roles_api.py`, `test_roles_permissions.py`, `test_seed.py`, `test_temp_duty_api.py`, `test_temporary_duty.py`, `test_user_role_selector.py`, `test_user_roles_api.py`, `test_user_roles.py`

**НЕ менялся** (анти-каскад не сработал): `_bmad-output/implementation-artifacts/deferred-work.md`.

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-21 | Перенос RBAC (`Role`/`Permission`/`UserRole`/`RolePermission`/`TemporaryDutyPermission`) в вложенный app `ops_rbac` через `SeparateDatabaseAndState` (без DDL) + `RunPython` UPDATE контент-типов; обновлены 20 импорт-сайтов; рецепт в `docs/`. Найден/исправлен дефект реверса (collision-safe relabel). `make gate` зелёный (358 passed). Status → review. |
| 2026-06-22 | Code review проход 2 (bmad-code-review, 3 слоя Opus 4.8, scoped diff `1b65f54..HEAD` по путям 2.1): 0 decision · 1 patch · 2 defer · 7 dismiss; Acceptance Auditor AC-1/2/3 — SATISFIED (статически). Patch ПРИМЕНЁН+ВЕРИФИЦИРОВАН: `ops_rbac/0001` `dependencies` += `("operations","0005_created_by")` (явное ребро DAG `0005 → ops_rbac/0001 → 0006`, без цикла); `makemigrations --check` чист, ruff чист. 2 defer (`elidable=True`/squash-риск + путь UPDATE-relabel без автотеста) → `deferred-work.md`. Status ОСТАЁТСЯ review: полный `make gate` (Postgres :5433 + round-trip forward→reverse→forward) за Bratan — тем более после правки миграции. Изменение рабочего дерева (`0001_initial.py` + BMAD-трекинг) НЕ закоммичено агентом. |

## Review Findings (bmad-code-review, 2026-06-21)

Слои: **Blind Hunter** (только diff) · **Edge Case Hunter** (diff + repo read) · **Acceptance Auditor** (diff + spec). Все три отработали, Opus 4.8, scoped-diff по путям 2-1 (906 строк).

**Acceptance Auditor: AC-1 / AC-2 / AC-3 — все SATISFIED.** Независимо подтверждены: `db_table` ×5 неизменны; контент-типы релейблятся UPDATE-ом (не пересоздаются); нет re-export пяти моделей в родителе (циклов нет, DAG ребёнок→родитель); 20 импорт-сайтов — path-only без правки логики; `TimeStampedModel` остаётся в родителе; `statuses` не тронут; Out-of-Scope соблюдён; File List консистентен (`docs/recipes/separate-database-and-state-app-port.md` существует на диске, корректно вне diff — `docs/` untracked).

### Decision-needed

- [x] [Review][Decision] **Безусловный каскадный `.delete()` контент-типов на reverse/round-trip пути** — `apps/operations/rbac/migrations/0002_rename_content_types.py` (`_relabel`). Forward-путь безопасен и верифицирован (свежая БД: `.delete()` целевого `app_label` — no-op; прод-БД: UPDATE сохраняет `id`, 0 осиротевших, `auth.Permission.content_type` цел — единственный потребитель `content_type_id`, аудита/GenericFK в кодбазе нет). Риск только на reverse/rollback: `_relabel` безусловно и молча удаляет CT целевого `app_label` (снять post_migrate-дубль) → каскад на `auth_permission`. Дефолтные 4 права дубля удаляются осознанно, но любые реальные гранты на транзиентном дубле снимаются без лога/аудита. Blind+Edge сошлись независимо. Решение: **(A)** harden — лог числа удаляемых строк + скоуп delete по реально осиротевшим; **(B)** принять как документированный узкий риск (рецепт уже фиксирует «rollback требует отката кода вместе с миграциями»). → **РЕЗОЛВ: (A) harden, применено 2026-06-21.** `_relabel` делает `.delete()` только при `source.exists()` (standalone-CT не затирается вслепую) + логирует число удалённых строк (+каскад) → reverse аудируем. ruff/py_compile зелёные; полный `make gate` (Postgres :5433 + round-trip forward→reverse→forward) — за Bratan.

### Patch

- [x] [Review][Patch] Добавить `elidable=True` в `RunPython` релейбла CT [apps/operations/rbac/migrations/0002_rename_content_types.py] — одноразовая data-правка, корректная squash-семантика. **Применено 2026-06-21.**

### Dismissed (для протокола — не переоткрывать)

- **Blind Hunter #1** «`created_by` отсутствует в перенесённых моделях → `makemigrations` не no-op» (заявлен major) — **ложноположительный слепого слоя**. Верифицировано с диска: `TimeStampedModel` (`operations/models.py:15`) содержит `created_by`; `rbac`-модели наследуют, `0001` материализует inherited-поле, `makemigrations --check` = «No changes detected» (358 passed). Зависимый Blind #3 (реверс `created_by`) падает вместе с корнем.
- **Edge #3** (dep `contenttypes/__first__` вместо `0002`) — спекулятивно; UPDATE трогает только `app_label`, существующий с contenttypes 0001; спайк осознанно выбрал `__first__`.
- **Edge #2 / Blind #7** (atomic, «split app_labels» при сбое в середине цикла) — миграции атомарны по умолчанию на Postgres (gate-БД); частичного релейбла не будет.
- **Blind #2/#4/#5/#8/#11/#12** — самопризнанные не-дефекты (ordering load-bearing но корректен; FK-casing ок; choices-литерал в миграции — штатная сериализация Django; `initial=True` при `database_operations=[]` безопасен).
- **Acceptance Auditor** информационные ×2 (правка `deferred-work.md` в working-tree — от ревью 1.9–1.12, ортогональна 2.1; greenness gate — dev-attested, не противоречит diff) — не нарушения.

## Review Findings — Проход 2 (bmad-code-review, 2026-06-22)

Слои: **Blind Hunter** (только diff) · **Edge Case Hunter** (diff + repo) · **Acceptance Auditor** (diff + spec), Opus 4.8, scoped-diff `1b65f54..HEAD` по путям 2.1 (637 строк) + untracked рецепт. Контрольный проход №2 по ПОСТ-harden состоянию (после прохода 1). Итог: **0 decision · 1 patch · 2 defer · 7 dismiss**. **Acceptance Auditor: AC-1/AC-2/AC-3 — все SATISFIED** (статически: `db_table` ×5 неизменны; CT релейблятся UPDATE-ом с сохранением `id`; нет осиротевших `operations`-CT; нет утечек импортов RBAC-моделей — только `TimeStampedModel` в родителе; Out-of-Scope соблюдён; рецепт AC-2 на диске покрывает rollback + `makemigrations --check`). Пасс-1 резолвы (collision-safe `_relabel` + `elidable=True`) на месте, не регрессировали.

### Patch

- [x] [Review][Patch] **`ops_rbac/0001_initial` не зависит от `operations/0005` — недо-ограниченный DAG миграций.** `dependencies = [("contenttypes", "__first__")]` — нет ребра к `operations`. Таблицы `ops_roles…` физически создаёт `operations/0001-0005` (реальный DDL), а `ops_rbac/0001` — state-only (`database_operations=[]`). Порядок `operations/0005` ↔ `ops_rbac/0001` держится сейчас лишь КОСВЕННО (через `operations/0006`, зависящий от обоих) → топологический тайбрейк, не явное ребро. На свежей БД работает (gate зелёный, planner находит валидный порядок), но фрагильно: добавление будущих миграций может сменить тайбрейк, и модель временно «висит» в ops_rbac-state без таблицы. Фикс однозначен и без цикла (`0005 → ops_rbac/0001 → 0006`): добавить `("operations", "0005_created_by")` в `dependencies`. Не влияет на applied-БД (зависимости не перечитываются) и на `makemigrations --check` (сравнивает только финальное состояние). [Backend/VAPS/apps/operations/rbac/migrations/0001_initial.py:14-17] (blind+edge) — ✅ **ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО (2026-06-22):** в `dependencies` добавлено `("operations", "0005_created_by")` (с комментарием про порядок DAG). `makemigrations --check --dry-run` = «No changes detected» (граф с новым ребром загружается без цикла, состояние не дрейфует, exit 0); `ruff check --select E,F` чист. Полный `make gate` (pytest на Postgres :5433 + round-trip forward→reverse→forward) — за Bratan (правка миграции требует прогона на реальной БД).

### Defer

- [x] [Review][Defer] **`elidable=True` на data-правке ГЛОБАЛЬНОЙ `django_content_type` — риск при будущем squash.** `RunPython(..., elidable=True)` (патч прохода 1 ради squash-семантики одноразовой data-миграции) означает, что `squashmigrations` может ВЫБРОСИТЬ relabel. На свежей БД он и так no-op, но БД, домигрированная до `operations/0005`-эпохи и НЕ дошедшая до ops_rbac, при применении squashed-набора потеряет UPDATE → осиротевшие `operations`-CT. В контексте VAPS (single closed-circuit pilot, fresh-БД) сценарий почти невозможен → severity low; оставляем `elidable=True` (стандарт для одноразовых data-миграций). Дешёвое усиление на будущее: оговорка в рецепте «при squash сохранять relabel non-elidable ЛИБО гарантировать свежесть всех целевых БД». [Backend/VAPS/apps/operations/rbac/migrations/0002_rename_content_types.py:66] (blind+edge) — deferred, риск low в текущем deploy-контексте → оговорка в рецепте
- [x] [Review][Defer] **Путь UPDATE relabel не покрыт автотестами (на свежей БД — no-op).** `test_app.py` проверяет `ContentType.app_label == "ops_rbac"`, но на свежей тест-БД это удовлетворяется `post_migrate` (создаёт ops_rbac-CT напрямую), а НЕ ветвью UPDATE из `0002`. Collision-safe `_relabel` / round-trip forward→reverse→forward имеют нулевое автопокрытие — проверяются лишь ручным `migrate` на populated-БД (Task 8, dev-attested) + round-trip за Bratan. Migration-state-тест (создать pre-state `operations`-CT → применить → проверить relabel + сохранённый `id`) — нетривиальный test-hardening, ближе к E7/тест-канону. [Backend/VAPS/apps/operations/rbac/tests/test_app.py:34-37, 0002_rename_content_types.py:32-47] (blind+edge) — deferred, ручная верификация + round-trip за Bratan покрывают операционно; авто-тест → test-hardening

### Dismissed (для протокола — не переоткрывать)

- (1) **`apps.operations.submissions` в INSTALLED_APPS** (Blind High) — out-of-2.1-scope (это 2.3); app существует на диске (Edge+Auditor верифицировали) → не build-break, не дефект 2.1.
- (2) **Реверс-асимметрия** (relabel no-op при «code-revert-first») — false positive: guard `source.exists()` скипает лишь при ОТСУТСТВИИ ops_rbac-строк, а откат кода их не удаляет → на документированном откате (revert code + `migrate reverse`) строки есть, relabel срабатывает.
- (3) **Каскад `.delete()` в `auth_permission`** — НЕ живой data-loss-путь: `core.User` = `AbstractBaseUser` без `PermissionsMixin`, нет `auth.Group`/`user_permissions`/`has_perm` → auto-CT-права никем не ссылаются (Edge верифицировал); + пасс-1 захарденил guard.
- (4) **RemoveField перед DeleteModel → partial-reverse out-of-lockstep** — стандартный вывод автодетектора; срабатывает лишь при ручном `migrate operations 0005` без отката ops_rbac = операторская ошибка; рецепт документирует корректный откат.
- (5) **Гонка relabel-UPDATE с post_migrate при КОНКУРЕНТНОМ migrate** — миграции не запускаются параллельно (атомарны на Postgres); параллельный migrate = операторская ошибка.
- (6) **`source+dupe` оба есть → UNIQUE при partial** — пасс-1 collision-safe (delete dupe → update source), атомарно на Postgres.
- (7) **`print()` не verbosity-aware** — намеренный аудит-лог удалённых строк (пасс-1 harden), Low-нит, миграция запускается редко; не переоткрываем.
