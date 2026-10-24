---
baseline_commit: b12603a934e756820514cfe43a026cde3c0e6713 (+ незакоммиченные изменения стори 1.1 в рабочем дереве)
---

# Story 1.2: Кастомная модель User и identity-контракт

Status: done

## Story

As a система,
I want кастомный AUTH_USER_MODEL (core) + authentication class, ставящий request.actor_id из X-User-Id,
so that смена модели пользователя не потребуется после появления данных и идентичность читается из одной точки.

## Acceptance Criteria

1. **Given** запрос с `X-User-Id: u123`, **When** он проходит DRF authentication, **Then** `request.actor_id == "u123"`.
2. **Given** запрос без заголовка к защищённому endpoint, **Then** 403 `PERMISSION_DENIED`.
3. **And** AST-чек: чтение X-User-Id вне core/auth — ошибка; существующие тесты operations зелёные.

## Tasks / Subtasks

- [x] Task 1: Кастомная модель User + AUTH_USER_MODEL + миграция (AC: 3 — фундамент, ради которого стори существует)
  - [x] В `apps/core/models.py` добавить `User(AbstractBaseUser)`: UUID PK (по образцу `UUIDTimeStampedModel` — ARCH-002: core = UUID PK), `username = CharField(max_length=100, unique=True)` (семантика: external auth account id, та же строка, что в `UserEmployeeBinding.user_id` / `UserRole.user_id`), `is_active = BooleanField(default=True)`, `created_at/updated_at`
  - [x] `USERNAME_FIELD = "username"`, `REQUIRED_FIELDS = []`, `objects = UserManager(BaseUserManager)` с `create_user(username, password=None)` (без пароля → `set_unusable_password()`)
  - [x] **НЕ** `AbstractUser`, **НЕ** `PermissionsMixin` — groups/permissions Django не тянуть, авторизация = собственный PermissionService (FR-33)
  - [x] `db_table = "core_users"` (naming pattern: `core_<plural_snake>`)
  - [x] В `config/settings.py`: `AUTH_USER_MODEL = "core.User"`
  - [x] Миграция: сгенерировать `makemigrations core`, переименовать в `0014_user.py` (ручное имя, MUST NOT `_auto_`); зависимость от `0013_sensitivefieldpolicy`
- [x] Task 2: Пакет core/auth + DRF authentication class (AC: 1, 2)
  - [x] Создать пакет `apps/core/auth/` (`__init__.py` + `authentication.py`) — это ПАКЕТ внутри app core, НЕ отдельный Django app (структура архитектуры: «auth/ — identity: X-User-Id authentication class → JWT; пакет, не app»)
  - [x] `XUserIdAuthentication(BaseAuthentication)`: `authenticate(request)` читает `request.headers.get("X-User-Id")`; заголовок есть → `request.actor_id = <значение>` (атрибут на DRF Request) и `return None`; заголовка нет → просто `return None`
  - [x] **MUST NOT**: `raise AuthenticationFailed` при отсутствии заголовка (это даст 401, а AC-2 требует 403 от permission-слоя); DB-lookup модели User на каждый запрос (строк User в БД ещё нет; всё низовье ключуется на строке actor_id)
  - [x] Сохранить в docstring ссылку на контракт: MVP-замена JWT `sub` claim (спека §7007); при переходе на JWT меняется ТОЛЬКО этот класс (ARCH-SEC-030)
  - [x] В `config/settings.py`: `REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] = ["apps.core.auth.authentication.XUserIdAuthentication"]`; `"UNAUTHENTICATED_USER": None` сохранить как есть
- [x] Task 3: Перевод operations на request.actor_id, удаление identity.py (AC: 3)
  - [x] `apps/operations/api/permissions.py`: `require_permission` берёт `user_id = getattr(request, "actor_id", None)` вместо `get_user_id(request)`; остальная логика (PermissionService, PermissionDenied("PERMISSION_DENIED")) не меняется
  - [x] `apps/operations/api/views.py:120` (`MyPermissionsViewSet.list`): тот же переход на `getattr(request, "actor_id", None)`
  - [x] Удалить `apps/operations/api/identity.py` целиком (единственное место чтения X-User-Id переезжает в core/auth)
  - [x] Проверить grep'ом: импортов `apps.operations.api.identity` больше нет нигде
- [x] Task 4: AST-чек «чтение X-User-Id вне core/auth — ошибка» (AC: 3)
  - [x] В `apps/core/tests/test_isolation.py` добавить тест по образцу существующих: обойти все `apps/**/*.py` (исключая `tests/` в path.parts и каталог `apps/core/auth/`), `ast.walk` по `ast.Constant`, собрать строковые константы; нормализованное значение содержит `x-user-id` или `x_user_id` → offender
  - [x] Тест должен ловить оба написания: `"X-User-Id"` (headers API) и `"HTTP_X_USER_ID"` (META)
  - [x] Убедиться, что тест красный, если временно вернуть чтение заголовка в operations (проверка, что чек не мёртвый)
- [x] Task 5: Тесты и зелёный gate (AC: 1, 2, 3)
  - [x] Создать `apps/core/tests/test_authentication.py`: (а) APIClient с `HTTP_X_USER_ID="u123"` на реальный endpoint → во view виден `request.actor_id == "u123"` (проще всего через существующий `/api/operations/my-permissions/` либо прямой вызов `XUserIdAuthentication().authenticate()` на DRF Request); (б) без заголовка → `actor_id` отсутствует/None; (в) защищённый operations-endpoint без заголовка → 403 PERMISSION_DENIED; (г) `User.objects.create_user("u123")` → UUID PK, unusable password, `is_active`
  - [x] Адаптировать `apps/operations/tests/test_api_permissions.py`: он строит запросы `APIRequestFactory` НАПРЯМУЮ — DRF authentication там не запускается, `request.actor_id` не появится. Адаптация: прогонять запрос через `XUserIdAuthentication` или выставлять `request.actor_id` явно (тестируется require_permission, не транспорт заголовка)
  - [x] Остальные operations-тесты (`test_roles_api`, `test_user_roles_api`, `test_temp_duty_api` — используют `client.credentials(HTTP_X_USER_ID=...)` через APIClient) должны пройти БЕЗ правок: APIClient идёт через полный DRF dispatch → authentication запускается
  - [x] `make gate` зелёный (ruff + 110+ тестов на Postgres + makemigrations --check + tzdata)

### Review Findings

- [x] [Review][Patch] (бывш. Decision, решение 2026-06-11: пересобрать) Swappable User-модель не в initial-миграции — `migrations.swappable_dependency(AUTH_USER_MODEL)` резолвится в `("core", "__first__")` = `0001_initial`, а не `0014_user`; FK-миграция другого app может примениться до создания `core_users` на свежей БД. Исправлено: `CreateModel(User)` перенесён в `0001_initial`, `0014_user.py` удалена — безопасно сейчас (прода нет, БД одноразовые). Часть про InconsistentMigrationHistory отклонена — admin/sessions не установлены [Backend/VAPS/apps/core/migrations/0001_initial.py]
- [x] [Review][Patch] `UserManager` без `create_superuser` — `manage.py createsuperuser` падал бы с AttributeError. Исправлено: явная заглушка с NotImplementedError («core.User has no superusers; grant roles via operations RBAC») + тест [Backend/VAPS/apps/core/models.py]
- [x] [Review][Patch] `create_user("")` сохранял пустой username. Исправлено: guard `ValueError("The given username must be set")` + тест [Backend/VAPS/apps/core/models.py]
- [x] [Review][Patch] AST-чек X-User-Id сканировал только `apps/`. Исправлено: добавлен охват `config/` и исключение модуля `tests.py` (симметрия с каталогами tests/) [Backend/VAPS/apps/core/tests/test_isolation.py]
- [x] [Review][Patch] DoD-чекбоксы стори не были проставлены при Status: review. Исправлено: проставлены с пометкой про перенос миграции
- [x] [Review][Defer] `User.is_active` нигде не енфорсится — auth без DB-lookup по дизайну стори; деактивация пользователя ничего не отзывает. Закрыть в Story 5.1 (login) [Backend/VAPS/apps/core/auth/authentication.py:17-19] — deferred, по дизайну MVP
- [x] [Review][Defer] `X-User-Permissions` доверяется клиенту в `apps/core/api/views.py:26` вне core/auth — pre-existing дыра границы ARCH-SEC-030, новый AST-чек её не видит и создаёт ложный сигнал «граница закрыта» — deferred, pre-existing
- [x] [Review][Defer] Поглощённый операнд в `test_core_does_not_import_other_context_models` (`startswith(prefix)` поглощает `.models`-клаузу; `apps.foo` матчит `apps.foobar`) — известный pre-existing deferred-баг, стори явно запретила чинить здесь [Backend/VAPS/apps/core/tests/test_isolation.py] — deferred, pre-existing
- [x] [Review][Defer] actor_id не валидируется на входе — длина/charset не ограничены, дубли заголовка X-User-Id склеиваются WSGI в «a, b» (сегодня fail-closed через 403) — уйдёт при переходе на JWT (Story 5.1) [Backend/VAPS/apps/core/auth/authentication.py:17-19] — deferred, MVP-транспорт

## Dev Notes

### Цель (одним предложением)

Зарезервировать swappable-слот пользователя СЕЙЧАС (пока ни одна таблица не ссылается на auth.User и прод-данных нет — потом смена AUTH_USER_MODEL означает пересоздание БД, это и есть «потом катастрофа» из эпика) и свести чтение идентичности к одной точке `request.actor_id`, чтобы переход X-User-Id → JWT менял один класс.

### Текущее состояние кода (прочитано 2026-06-11 — НЕ перепроверять, состояние зафиксировано)

- **AUTH_USER_MODEL НЕ задан**; `INSTALLED_APPS` = django.contrib.auth, contenttypes, rest_framework, apps.core, apps.operations (`config/settings.py:10-16`). Admin и sessions НЕ установлены — классической ошибки InconsistentMigrationHistory от admin при смене user-модели не будет.
- **FK/OneToOne на auth.User НЕТ НИГДЕ** (проверено grep по всем models и миграциям). Все идентичности — строки: `UserEmployeeBinding.user_id = CharField(100, unique)` (`apps/core/models.py:218`), `UserRole.user_id = CharField(100)` (`apps/operations/models.py:37`), `TemporaryDutyPermission.user_id` (`apps/operations/models.py:86`). Комментарии в коде: «BR-ACCOUNT-001/002, ARCH-007: external auth account id, never core_employees.id».
- **X-User-Id читается ровно в одном месте**: `apps/operations/api/identity.py` — функция `get_user_id(request)` (8 строк, docstring «MVP stand-in for the JWT sub claim (spec §7007)»). Потребители: `apps/operations/api/permissions.py:9` (`require_permission`) и `apps/operations/api/views.py:120` (`MyPermissionsViewSet.list`). Больше никто.
- `REST_FRAMEWORK` (`config/settings.py:58-62`): `DEFAULT_AUTHENTICATION_CLASSES: []`, `DEFAULT_PERMISSION_CLASSES: []`, `UNAUTHENTICATED_USER: None`. MIDDLEWARE — только CommonMiddleware.
- `apps/core/auth/`, authentication.py, `request.actor_id`, `request.user_context` — НЕ существуют нигде. Создаются этой сторей.
- Последние миграции: core `0013_sensitivefieldpolicy`, operations `0004_temporarydutypermission`. Все имена ручные.
- AST-тесты изоляции: `apps/core/tests/test_isolation.py` (core не импортирует другие контексты) и `apps/operations/tests/test_isolation.py` (operations не импортирует core.models). Механизм: `_module_files()` собирает `*.py` без `tests` в `path.parts`, `_imports()` парсит `ast.ImportFrom`/`ast.Import` через `ast.walk`. Новый чек делать в этом же стиле, но по `ast.Constant` (ищем строку-литерал, не импорт).
- Тесты operations передают заголовок двумя способами: `client.credentials(HTTP_X_USER_ID="admin-1")` (test_roles_api:15, test_user_roles_api:15,59, test_temp_duty_api:18 — полный DRF dispatch, совместимы с authentication class) и `APIRequestFactory().get("/", HTTP_X_USER_ID="auth-9")` (test_api_permissions:12,30,40 — БЕЗ dispatch, authentication НЕ запустится → требует адаптации, см. Task 5).

### Что НЕ трогать (Out of Scope)

- **JWT, login/session API** — Story 5.1 (вход оператора). Эта стори только резервирует слот и точку чтения.
- **`UserEmployeeBinding` / `UserRole` — НЕ переводить на FK к User.** ARCH-007 («user_id — строка») не отменён; binding внешнего account id к Employee остаётся строковым. User-модель пока пустует — это страховка схемы, не носитель данных.
- **`created_by` в базовых моделях** — Story 1.4 (она потребитель actor_id, не наоборот).
- **Рефактор `models.py` → пакет `models/`** — НЕ в этой стори (см. Project Structure Notes).
- **django.contrib.admin / sessions** — не добавлять в INSTALLED_APPS; admin появится со справочниками (E2).
- **PermissionService и его логика** — не трогать; меняется только источник user_id в require_permission.
- **`Backend/PersonnelStatus/` — ДОНОР, не трогать.**
- Никаких data-миграций: данных User нет, существующие user_id-строки остаются строками.

### Архитектурные нормы, которые исполняет стори

- **ARCH-SEC-030 (Auth-контракт)**: единственная точка извлечения идентичности; наполняется из X-User-Id; при JWT меняется только она. MUST NOT: читать заголовок/парсить токен вне неё. [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security]
- **Layer Contract**: «Актор: authentication class (core) ставит `request.actor_id: str` (user_id, ARCH-007); чтение X-User-Id вне core запрещено (AST-чек)». [Source: architecture.md#Layer Contract (кто кого вызывает)]
  - ⚠️ Терминологическое расхождение в архитектуре: ARCH-SEC-030 называет точку `request.user_context` и говорит «middleware», Layer Contract и AC эпика — `request.actor_id` и «authentication class». **Канон этой стори: `request.actor_id`, DRF authentication class** (epics.md AC — самый конкретный документ; Layer Contract совпадает). Норму ARCH-SEC-030 «одна точка, замена только её» стори исполняет полностью.
- **Граница core/auth** (таблица границ): «request.actor_id ставит только authentication class; чтение X-User-Id вне core/auth — бан; enforcement: AST». [Source: architecture.md#Architectural Boundaries]
- **ARCH-002**: core — UUID PK → User получает UUID PK. [Source: architecture.md#Technical Constraints, Брownfield-якорь]
- **ARCH-007 / BR-ACCOUNT-002**: user_id — строка end-to-end; username в User = та же строка external account id. [Source: architecture.md#Technical Constraints]
- Структура: `apps/core/auth/` — пакет, не app («промоушен при появлении моделей» — модели User это НЕ касается, User живёт в core/models.py). [Source: architecture.md#Complete Project Directory Structure]
- Naming: `db_table = "core_users"`; миграция `0014_user.py` ручным именем. [Source: architecture.md#Naming Patterns]
- Enforcement: `make gate` зелёный до закрытия стори. [Source: architecture.md#Enforcement Guidelines]

### Решения, принятые при создании стори (дефолты; менять только осознанно)

1. **`AbstractBaseUser`, не `AbstractUser` и не `PermissionsMixin`**: Django-вская система groups/permissions конфликтует по смыслу с собственным RBAC (PermissionService, 8 ролей/17 прав — FR-33); тянуть её таблицы — мусор в схеме. AbstractBaseUser даёт password/last_login/is_authenticated — достаточно для будущего login (5.1).
2. **`username` = external auth account id** (max_length=100 — ровно как user_id в UserEmployeeBinding/UserRole): когда появятся данные, `User.username == UserEmployeeBinding.user_id` свяжет миры без миграции типов.
3. **authenticate() возвращает None, side-effect — `request.actor_id`**: строк User в БД нет → возвращать нечего; lookup на каждый запрос запрещён архитектурой производительности; DRF гарантированно вызывает авторов на каждом запросе (perform_authentication в initial() трогает request.user до permission-проверок), поэтому actor_id будет выставлен до require_permission. `UNAUTHENTICATED_USER: None` уже стоит — request.user останется None, ничего не ломается.
4. **`getattr(request, "actor_id", None)` в потребителях** — защита от путей, где authentication не запускалась (прямые вызовы в unit-тестах).
5. **AST-чек по строковым константам** (а не по импортам): запрещаем сам литерал заголовка вне core/auth — ловит и `request.headers.get("X-User-Id")`, и `request.META["HTTP_X_USER_ID"]`, в любом модуле.
6. **identity.py удаляется, а не переадресуется**: оставить шим = второй канал чтения идентичности, ровно то, что стори запрещает.

### Подводные камни для dev-агента

- **Смена AUTH_USER_MODEL инвалидирует существующие локальные БД** (dev SQLite, постоянный Postgres-том из compose, если туда мигрировали). Тестовые БД pytest создаёт с нуля — не проблема. Если локальная dev-БД мигрирована ранее — пересоздать, НЕ городить миграционную хирургию. Прод-БД не существует (донор — прод), поэтому это безопасно именно сейчас.
- **makemigrations сгенерирует миграцию сам — переименовать файл в `0014_user.py`** до коммита; `makemigrations --check` в gate поймает дрейф, если модель и миграция разойдутся.
- **Не поднимать AuthenticationFailed из authenticate()** при пустом заголовке: DRF превратит это в 401, а AC-2 требует 403 PERMISSION_DENIED (его даёт require_permission при user_id=None — уже реализовано, поведение сохраняется).
- **`request.actor_id` ставить на DRF Request** (тот объект, что получает authenticate) — view получает тот же wrapper; `Request.__getattr__` делегирует к HttpRequest только при отсутствии атрибута на wrapper'е, конфликтов нет.
- **test_api_permissions.py упадёт без адаптации** (APIRequestFactory не запускает authentication) — это тест require_permission, а не транспорта: выставить actor_id руками или прогнать через XUserIdAuthentication. Не превращать его в e2e.
- **Не импортировать ничего operations-ового в core/auth** — core никого не импортирует (AST-тест изоляции уже это сторожит).
- В рабочем дереве лежат **незакоммиченные изменения стори 1.1** (Makefile, docker-compose.yml, pyproject.toml, E501-фиксы в ~40 файлах) — НЕ откатывать, НЕ путать со своими правками; File List этой стори — только её файлы.
- ruff после правок: `make gate` гоняет линт первым — новые файлы держать в E,F-чистоте сразу.
- В `test_isolation.py` есть известный pre-existing deferred-баг (поглощённый операнд в условии) — НЕ чинить в этой стори, просто добавить свой тест рядом.

### Технические версии (зафиксированы архитектурой 2026-06-10, повторный веб-ресёрч не требуется)

- Django 5.0–5.1 (pyproject `Django>=5.0,<5.2`): кастомная user-модель — стабильный API (AbstractBaseUser/BaseUserManager без изменений в 5.x).
- DRF >= 3.15: BaseAuthentication-контракт стабилен; authenticate() → None = «не аутентифицирован, пробуй дальше».
- Окружение: venv в `Backend/VAPS/.venv` (создан сторей 1.1), Postgres 16 на порту 5433 через `docker compose up -d --wait db`, `make gate` — штамп закрытия.

### Git-интеллидженс

- HEAD = `b12603a` (гигиена репо); **вся работа стори 1.1 не закоммичена** — рабочее дерево содержит Makefile/compose/pyproject/E501-фиксы. Паттерны брать из `Backend/VAPS/apps/` (ручные миграции, AST-тесты, селекторы), не из донора (`Backend/PersonnelStatus/`).
- Прецедент структуры тестов и Dev Notes — стори 1.1 (`_bmad-output/implementation-artifacts/1-1-тестовый-фундамент-на-postgresql.md`): ревью там потребовало полный File List и снятие ruff-exclude для миграций — миграцию 0014 сразу форматировать ruff'ом.

### Зависимости

- Depends on: Story 1.1 (make gate — штамп закрытия; Postgres-harness для прогона сьюта).
- Blocks: Story 1.4 (created_by заполняется из actor_id), Story 1.6+ (импорт/сервисы пишут от актора), Story 5.1 (login/session — потребитель User-модели), Story 2.9 (RBAC-матрица роль×операция поверх actor_id).

### Тесты стори

- Unit: `apps/core/tests/test_authentication.py` — authenticate() с заголовком/без; User.objects.create_user (UUID PK, unusable password).
- Integration: защищённый operations-endpoint без заголовка → 403 PERMISSION_DENIED; с заголовком — существующее поведение (сьют operations: test_roles_api, test_user_roles_api, test_temp_duty_api проходят без правок).
- AST: новый чек в `apps/core/tests/test_isolation.py` — литерал X-User-Id вне `apps/core/auth/` = offender; самопроверка чека (временное нарушение → красный).
- Manual (DoD): `make gate` зелёный; grep `X-User-Id|HTTP_X_USER_ID` по `apps/` находит только core/auth и тесты.

### Definition of Done

- [x] `AUTH_USER_MODEL = "core.User"`, `makemigrations --check` чист (User перенесён в `0001_initial` по решению ревью 2026-06-11 — swappable-модель обязана жить в initial; `0014_user.py` удалена)
- [x] `request.actor_id` ставится XUserIdAuthentication из X-User-Id; без заголовка защищённый endpoint отвечает 403 PERMISSION_DENIED
- [x] `apps/operations/api/identity.py` удалён; permissions.py/views.py читают actor_id
- [x] AST-чек на X-User-Id вне core/auth добавлен и нетривиально красный при нарушении
- [x] Существующие тесты operations зелёные (адаптация только test_api_permissions, по смыслу)
- [x] `make gate` зелёный
- [x] Нет FK на User, нет data-миграций, ARCH-007 (user_id строкой) не нарушен

### Project Structure Notes

- `apps/core/auth/` создаётся точно по целевой структуре архитектуры (пакет внутри core, не app).
- Известное расхождение с целевой структурой: `core/models.py` — файл, а не пакет `models/` («рефактор при первом касании» из структуры). Осознанное решение этой стори: НЕ совмещать смену AUTH_USER_MODEL с рефактором пакета моделей — два рискованных движения в одной стори нарушают правило одной ответственности; User добавляется в существующий models.py, рефактор остаётся за отдельной сторей при следующем касании.
- `project-context.md` в репо отсутствует (проверено glob'ом при активации) — раздел project-context не применим.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] — формулировка и AC
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] — место в walking skeleton, «AUTH_USER_MODEL — сейчас, потом катастрофа»
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] — ARCH-SEC-030
- [Source: _bmad-output/planning-artifacts/architecture.md#Layer Contract (кто кого вызывает)] — request.actor_id, AST-чек
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural Boundaries] — граница core/auth
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure] — auth/ пакет, не app
- [Source: Backend/VAPS/apps/operations/api/identity.py] — текущая точка чтения X-User-Id (удаляется)
- [Source: Backend/VAPS/apps/operations/api/permissions.py] — require_permission (мигрирует на actor_id)
- [Source: Backend/VAPS/apps/core/models.py:216-228] — UserEmployeeBinding (user_id строкой, не трогать)
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py] — образец AST-теста
- [Source: _bmad-output/implementation-artifacts/1-1-тестовый-фундамент-на-postgresql.md] — gate-харнесс, незакоммиченное состояние, уроки ревью

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Fable 5)

### Debug Log References

- RED: `test_authentication.py` падал на ImportError (модуль core/auth не существовал) — подтверждено до имплементации.
- Самопроверка AST-чека: временный литерал `"X-User-Id"` в `operations/api/permissions.py` → тест красный; нарушение убрано → зелёный (чек не мёртвый).
- Первый `make gate` упал на ruff E501 в сгенерированной `0014_user.py` — миграция отформатирована вручную (урок ревью 1.1).
- Финальный `make gate`: ruff чист, 116 passed на Postgres, `makemigrations --check` чист, 4s.

### Completion Notes List

Ultimate context engine analysis completed - comprehensive developer guide created (2026-06-11).

- Task 1: `User(AbstractBaseUser)` + `UserManager(BaseUserManager)` в `core/models.py` (UUID PK, `username` CharField(100, unique) = external account id, `is_active`, `created_at/updated_at`, `db_table="core_users"`); без `PermissionsMixin`/`AbstractUser`. `AUTH_USER_MODEL = "core.User"`. Миграция `0014_user.py` (ручное имя, зависимость 0013).
- Task 2: пакет `apps/core/auth/` (не app) с `XUserIdAuthentication(BaseAuthentication)`: заголовок есть → `request.actor_id`, всегда `return None`; без AuthenticationFailed и без DB-lookup. Docstring фиксирует контракт ARCH-SEC-030 / спека §7007. Подключён в `DEFAULT_AUTHENTICATION_CLASSES`; `UNAUTHENTICATED_USER: None` сохранён.
- Task 3: `require_permission` и `MyPermissionsViewSet.list` читают `getattr(request, "actor_id", None)`; `apps/operations/api/identity.py` удалён; grep подтвердил отсутствие импортов identity.
- Task 4: AST-чек `test_x_user_id_literal_only_in_core_auth` в `core/tests/test_isolation.py` — обходит `apps/**/*.py` (кроме tests и core/auth), ловит `x_user_id`/`x-user-id` в строковых константах (оба написания: headers API и META). Нетривиальность проверена временным нарушением.
- Task 5: `test_authentication.py` — 5 тестов (authenticate с/без заголовка, actor_id через полный DRF dispatch, 403 PERMISSION_DENIED без заголовка, create_user → UUID PK + unusable password). `test_api_permissions.py` адаптирован: запросы прогоняются через `XUserIdAuthentication` (APIRequestFactory не запускает dispatch). Остальные operations-тесты прошли без правок. AC-1 ✓, AC-2 ✓ (403 PERMISSION_DENIED), AC-3 ✓.
- Бонус по DoD «документация»: уточнена строка в `apps/operations/README.md` (точка чтения заголовка теперь core/auth).
- ARCH-007 не нарушен: FK на User нет, data-миграций нет, все user_id остались строками.

### File List

**Создано:**
- `Backend/VAPS/apps/core/auth/__init__.py`
- `Backend/VAPS/apps/core/auth/authentication.py`
- `Backend/VAPS/apps/core/tests/test_authentication.py`

**Изменено:**
- `Backend/VAPS/apps/core/migrations/0001_initial.py` (CreateModel(User) — перенесён сюда из 0014 по итогам ревью: swappable-модель обязана жить в initial)
- `Backend/VAPS/config/settings.py` (AUTH_USER_MODEL + DEFAULT_AUTHENTICATION_CLASSES)
- `Backend/VAPS/apps/core/models.py` (User + UserManager)
- `Backend/VAPS/apps/operations/api/permissions.py` (actor_id)
- `Backend/VAPS/apps/operations/api/views.py` (actor_id в MyPermissionsViewSet)
- `Backend/VAPS/apps/core/tests/test_isolation.py` (AST-чек X-User-Id)
- `Backend/VAPS/apps/operations/tests/test_api_permissions.py` (адаптация под actor_id)
- `Backend/VAPS/apps/operations/README.md` (точка чтения заголовка → core/auth)

**Удалено:**
- `Backend/VAPS/apps/operations/api/identity.py`

## Change Log

- 2026-06-11: Story 1.2 имплементирована целиком (Tasks 1–5). Кастомный `core.User` (AUTH_USER_MODEL), пакет `core/auth` с `XUserIdAuthentication` → `request.actor_id`, operations переведены на actor_id, `identity.py` удалён, AST-чек на литерал X-User-Id вне core/auth. `make gate` зелёный (ruff, 116 тестов на Postgres, makemigrations --check). Статус → review.
- 2026-06-11: Code review (3 слоя: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Все 3 AC — PASS. 5 патчей применено: CreateModel(User) → 0001_initial (swappable в initial, 0014 удалена), guard пустого username + create_superuser-заглушка, AST-чек расширен на config/ и tests.py-симметрию, DoD проставлен. 4 находки отложены (deferred-work.md: is_active без енфорса → 5.1, X-User-Permissions вне границы, поглощённый операнд, валидация actor_id → JWT). `make gate` зелёный (118 тестов). Статус → done.
