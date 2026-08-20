---
baseline_commit: 665856851e7e66d65bf723af14d93cdda9e92d72
---
# Story 2.11: Регистрация справочников в Admin + страж-тест реестра (3/4)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Под-стори 3/4 эпик-стори «Admin для справочников»** (2.8 User-auth → 2.10 платформа → **2.11 регистрация + страж-тест** → 2.12 edit-safety). Закрывает **буквальный AC эпик-стори 2.8** (AC-1 «справочники editable через Admin», AC-2 «бизнес-модели НЕ зарегистрированы» + страж-тест реестра). Зависит от 2.10 (платформа поднята, done).
>
> **Регистрируем РОВНО 5 справочников/настроек** (нет бизнес-инвариантов, нет записи мимо сервиса): `core.Position`, `core.Rank`, `core.DivisionType`, `statuses.StatusType`, `submissions.SubmissionControlSettings`. **Страж-тест:** реестр admin ⊆ {contrib `Group`} ∪ {эти 5} → любая бизнес-модель (`EmployeeStatus`, `Employee`, `Division`, RBAC, …) в реестре = КРАСНЫЙ (ARCH#L467 «MUST NOT: регистрация submissions/статусов/amendments/документов»).
>
> ⚠️ **Тонкость, не перепутать:** регистрируем `StatusType` (**справочник** типов статусов, seeded, plain reference) — НЕ `EmployeeStatus` (бизнес-инстанс статуса, пишется сервисом с аудитом/конфликт-детектором → ЗАПРЕЩЕНО). И `SubmissionControlSettings` (**настройки**, Story 2.3 «правка через Admin») — НЕ `DailySubmission` (бизнес, E5).

## Story

As a администратор справочников VAPS,
I want чтобы справочники должностей/званий/типов подразделений/типов статусов и настройки контроля сдачи редактировались через стандартный Django Admin, а бизнес-модели были защищены страж-тестом от случайной регистрации,
so that держатель admin-доступа правит справочники без кода, а запись в бизнес-таблицы мимо сервисов (аудит/права) оставалась невозможной (FR-39; ARCH#L467; решение «Django Admin» от 2026-06-23).

## Acceptance Criteria

1. **Справочники editable.** **Given** для каждого из 5 справочников зарегистрирован `ModelAdmin` (`apps/core/admin.py`, `apps/operations/statuses/admin.py`, `apps/operations/submissions/admin.py`), **When** суперюзер открывает их changelist (`reverse("admin:core_position_changelist")` и т.д.), **Then** `200` — редактируемая поверхность доступна для всех 5.
2. **Страж-тест реестра (буквальный AC эпика).** **Given** реестр `admin.site._registry`, **When** прогоняю страж-тест, **Then** зарегистрированы РОВНО справочники (Position/Rank/DivisionType/StatusType/SubmissionControlSettings) + contrib `Group`; **And** реестр ⊆ этого allowlist → любая модель вне него (любая бизнес-модель) = тест КРАСНЫЙ.
3. **Бизнес-модели НЕ зарегистрированы.** **Given** allowlist страж-теста, **Then** явно подтверждено отсутствие в реестре: `EmployeeStatus`, `Employee`, `Division`, `Organization`, `User`, `UserEmployeeBinding`, `StaffingSlot`, `EmployeeStaffingAssignment`, `Vacancy`, `EmployeeDivisionHistory`, `DivisionHistoricalSlot`, `SensitiveFieldPolicy`, `Watermark`, и вся RBAC (`Role/Permission/UserRole/RolePermission/TemporaryDutyPermission`).
4. **Нулевая регрессия, без миграции.** **Given** регистрация (только `admin.py` + тесты), **Then** `makemigrations --check --dry-run` → «No changes detected» (модели не трогаются); все существующие тесты зелёные; boundary-guard 2.9 (`test_authz_boundary.py`) зелёный (admin.py не консультирует Django-auth напрямую); X-User-Id + `PermissionService` не тронуты; устаревший `test_no_project_models_registered_in_admin` (2.10) корректно заменён страж-тестом (теперь справочники ЗАрегистрированы — старый ассерт «ноль apps.* моделей» инвертируется).
5. **Гейт.** **When** `make gate` (Postgres :5433), **Then** `ruff check .` чист, pytest зелёный (+страж/changelist-тесты), `manage.py check` 0 issues, `makemigrations --check` «No changes detected», бюджет < 300с. **Артефакты НЕ коммитить** (за Bratan).

## Tasks / Subtasks

- [x] **Задача 1. `apps/core/admin.py` — core-справочники (AC: 1)**
  - [x] Зарегистрировать `Position`, `Rank`, `DivisionType` через `@admin.register(...)` + `ModelAdmin` (list_display/search_fields/list_filter — см. Dev Notes). Импорт моделей из `apps.core.models`.
- [x] **Задача 2. `apps/operations/statuses/admin.py` — StatusType (AC: 1, 3)**
  - [x] Зарегистрировать **`StatusType`** (справочник) — НЕ `EmployeeStatus`. Импорт из `apps.operations.statuses.models` (реэкспорт-контракт). `ModelAdmin` (priority/is_hard_block/restricts_editing/is_active в list_display).
- [x] **Задача 3. `apps/operations/submissions/admin.py` — SubmissionControlSettings (AC: 1)**
  - [x] Зарегистрировать `SubmissionControlSettings` (singleton). `ModelAdmin` с `has_add_permission` → False, если строка уже есть (CheckConstraint key=1; seeded migration 0001), и `has_delete_permission` → False (singleton не удалять). Иначе add 2-й строки → IntegrityError-врата в UI.
- [x] **Задача 4. Страж-тест реестра (AC: 2, 3, 4)**
  - [x] Заменить устаревший `test_no_project_models_registered_in_admin` (в `apps/core/tests/test_admin_platform.py`) на страж: форсировать `django.contrib.admin.autodiscover()`; собрать `ALLOWED = {Group, Position, Rank, DivisionType, StatusType, SubmissionControlSettings}`; `assert set(admin.site._registry) == ALLOWED` (== ловит И недо-, И пере-регистрацию); **And** явный негатив: каждая бизнес-модель из AC-3 `not in admin.site._registry`.
  - [x] (рекоменд.) Добавить changelist-smoke: суперюзер `GET reverse("admin:<applabel>_<model>_changelist")` → 200 по каждому из 5 (доказывает AC-1 «editable»; URL деривить из `m._meta` — не хардкодить).
- [x] **Задача 5. Гейт (AC: 5)**
  - [x] `make gate` (Postgres :5433): ruff чист, pytest зелёный, `manage.py check` 0 issues, makemigrations «No changes detected». **Артефакты НЕ коммитить.**

## Dev Notes

### Что регистрируем (РОВНО эти 5) и почему именно они

| Модель | app / db_table | Почему справочник (не бизнес) |
|---|---|---|
| `core.Position` | core / `core_positions` | seeded справочник должностей (FR-39), без инвариантов |
| `core.Rank` | core / `core_ranks` | seeded справочник званий (FR-39) |
| `core.DivisionType` | core / `core_division_types` | seeded справочник типов подразделений |
| `statuses.StatusType` | ops_statuses / `ops_status_types` | docstring: «plain reference table», seeded `seed_statuses`; **тип** статуса, не инстанс |
| `submissions.SubmissionControlSettings` | ops_submissions / `ops_submission_control_settings` | docstring: «config… stays Admin-editable once Admin lands in 2.8»; Story 2.3 «правка через Admin»; singleton |

**ARCH#L467 (нормативно):** «Django Admin: только справочники без бизнес-инвариантов + read-only просмотр (аудит, AsyncJob). **MUST NOT: регистрация submissions/статусов/amendments/документов — запись мимо сервиса = мимо аудита и прав.**» Anti-pattern #L485: «регистрация DailySubmission в admin». → `StatusType`/`SubmissionControlSettings` = справочник/настройки (seeded, без сервис-записи) ✓; `EmployeeStatus`/`DailySubmission` = бизнес ✗.

### Рекомендованные admin.py (минимально-корректные)

```python
# apps/core/admin.py
from django.contrib import admin
from apps.core.models import DivisionType, Position, Rank

@admin.register(Position)
class PositionAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "level", "sort_order", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)

@admin.register(Rank)
class RankAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "category", "rank_index", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)

@admin.register(DivisionType)
class DivisionTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "sort_order", "is_active")
    search_fields = ("code", "name")
    list_filter = ("is_active",)
```
```python
# apps/operations/statuses/admin.py
from django.contrib import admin
from apps.operations.statuses.models import StatusType

@admin.register(StatusType)
class StatusTypeAdmin(admin.ModelAdmin):
    list_display = (
        "code", "name", "priority", "is_hard_block",
        "restricts_editing", "is_active",
    )
    search_fields = ("code", "name")
    list_filter = ("is_active", "is_hard_block")
```
```python
# apps/operations/submissions/admin.py
from django.contrib import admin
from apps.operations.submissions.models import SubmissionControlSettings

@admin.register(SubmissionControlSettings)
class SubmissionControlSettingsAdmin(admin.ModelAdmin):
    list_display = ("control_hour",)

    def has_add_permission(self, request):
        # Singleton (CheckConstraint singleton_key=1; seeded в migration 0001).
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False
```
> Проверь реэкспорт: модели statuses/submissions лежат в `models/`-пакетах (`status_type.py`, `control_settings.py`) — импортируй из пакета `...models import StatusType` (реэкспорт-контракт `__init__.py`), не из под-модуля. Если реэкспорта нет — импортируй из под-модуля и НЕ добавляй реэкспорт в этой стори (out of scope).

### Страж-тест (инверсия теста 2.10)

2.10 оставил в `apps/core/tests/test_admin_platform.py` тест `test_no_project_models_registered_in_admin` с ассертами «ноль моделей `apps.*`» и `set(_registry) <= {Group}`. **После регистрации 5 справочников оба ассерта СТАНУТ ЛОЖНЫМИ** → этот тест ОБЯЗАТЕЛЬНО заменить (иначе гейт красный). Новый страж:

```python
ALLOWED = {Group, Position, Rank, DivisionType, StatusType, SubmissionControlSettings}

def test_admin_registry_is_exactly_catalogs():
    from django.contrib import admin
    admin.autodiscover()  # форсировать загрузку всех app/admin.py
    assert set(admin.site._registry) == ALLOWED, list(admin.site._registry)

def test_business_models_not_registered_in_admin():
    for model in (EmployeeStatus, Employee, Division, ...RBAC...):
        assert model not in admin.site._registry
```
`==` (а не `<=`) ловит и пере-регистрацию (бизнес-модель просочилась → красный), и недо-регистрацию (забыли справочник → красный). Это и есть «страж реестра» из AC эпика.

### Gotchas

- **Autodiscover в тестах:** под pytest `admin.autodiscover()` может быть не вызван (нет ASGI/WSGI-старта). Форсируй `admin.autodiscover()` в начале страж-теста, иначе `_registry` может быть неполным → ложно-зелёный (прецедент-замечание из ревью 2.10: registry-тест без autodiscover тавтологичен).
- **admin-URL имена:** app_label для statuses = `ops_statuses`, submissions = `ops_submissions`, core = `core`. URL changelist: `admin:<app_label>_<model_name>_changelist`. Деривь через `reverse(f"admin:{m._meta.app_label}_{m._meta.model_name}_changelist")` — не хардкодь.
- **boundary-guard 2.9:** `test_authz_boundary.py` сканит `apps/operations/**` (включая новые `statuses/admin.py`, `submissions/admin.py`) на `has_perm`/`has_module_perms`/`is_staff`/`is_superuser`/`request.user`. `has_add_permission`/`has_delete_permission` — это НЕ запрещённые токены (имя метода ≠ `.has_perm(`), `request`-параметр не разыменовывается в `.user`. Рекоменд. admin.py ЧИСТ. **Если** вздумаешь звать `request.user.has_perm(...)` в admin.py — guard покраснеет; admin — санкционированная Django-perm-поверхность, тогда whitelist `admin.py` в `test_authz_boundary` (но в этой стори НЕ нужно).
- **Singleton add:** без `has_add_permission`-гейта admin покажет кнопку «Add», и вторая строка упадёт на `CheckConstraint`/`unique` (IntegrityError в UI). Гейт делает UX чистым (DB всё равно защищает).
- **Без миграции:** только `admin.py` + тесты; модели не меняются → `makemigrations --check` «No changes detected». Если случайно тронул модель — стоп, это не та стори.

### Project Structure Notes

- **Создать:** `Backend/VAPS/apps/core/admin.py`, `Backend/VAPS/apps/operations/statuses/admin.py`, `Backend/VAPS/apps/operations/submissions/admin.py`.
- **Изменить:** `Backend/VAPS/apps/core/tests/test_admin_platform.py` (заменить устаревший `test_no_project_models_registered_in_admin` на страж-тест реестра + changelist-smoke). ≤4 файла кода. Одна ответственность (регистрация справочников + страж). Без миграции.
- **НЕ трогать:** модели (любые), `config/settings.py`/`urls.py` (платформа уже в 2.10), `seed_*`/`import_references`/валидаторы (→ 2.12), `XUserIdAuthentication`, `PermissionService`/RBAC.

### Out of Scope (НЕ реализовывать в 2.11)

- **`MinValueValidator` (`Position.level`/`sort_order`, `Rank.rank_index`) + `create_defaults` в `seed_core`/`import_references`/`seed_statuses`** (чтобы admin-правки не затирались ре-сидом) → **2.12**. ⚠️ Зависимость: 2.11 даёт editable-admin, но до 2.12 ре-сид может перезаписать ручные правки — это осознанный порядок (2.12 закрывает).
- **Регистрация любой бизнес-модели** (`EmployeeStatus`, `DailySubmission`, RBAC, …) — ЗАПРЕЩЕНО (ARCH#L467); страж-тест это и защищает.
- **Read-only admin для аудита/AsyncJob** (ARCH#L467) → E4 (аудит).
- **Гейт прав на core API** → 2.13. **Прод-hardening/STATIC_ROOT** → E12.

### References

- [Source: _bmad-output/implementation-artifacts/2-8-admin-для-справочников.md#L83-90] — карта декомпозиции; #L87 строка 2.11 (admin.py для 5 справочников + страж-тест); #L90 список справочников под регистрацию + бизнес-модели НЕ регистрировать (вкл. RBAC → 2.9-область).
- [Source: _bmad-output/planning-artifacts/architecture.md#L467] — нормативно: admin = только справочники, MUST NOT submissions/статусы/amendments/документы; #L485 anti-pattern (DailySubmission в admin); #L616 «FR-39 справочники | core + Django Admin».
- [Source: _bmad-output/implementation-artifacts/2-10-admin-платформа-django-auth-включение.md] — платформа поднята (INSTALLED_APPS/MIDDLEWARE/TEMPLATES/STATIC_URL/admin-роут); registry-тест 2.10 (инвертируется здесь); девиация про contrib `Group`.
- [Source: Backend/VAPS/apps/core/models.py:101-141] — `DivisionType`/`Position`/`Rank` (поля для ModelAdmin).
- [Source: Backend/VAPS/apps/operations/statuses/models/status_type.py] — `StatusType` (docstring «plain reference table»).
- [Source: Backend/VAPS/apps/operations/submissions/models/control_settings.py] — `SubmissionControlSettings` (singleton, docstring «Admin-editable once Admin lands in 2.8»).
- [Source: Backend/VAPS/apps/core/tests/test_admin_platform.py:52-66] — устаревший registry-тест 2.10 (заменить).
- [Source: Backend/VAPS/apps/operations/tests/test_authz_boundary.py] — boundary-guard 2.9 (сканит operations/admin.py — рекоменд. admin.py чист).
- [Decision] AskUserQuestion 2026-06-23 (в 2.8): «Django Admin + реанимация Django-auth» (Bratan).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23. baseline_commit `6658568`.

### Debug Log References

- **Импорты сверены до кода:** реэкспорт-контракт подтверждён — `from apps.operations.statuses.models import StatusType, EmployeeStatus`, `from apps.operations.submissions.models import SubmissionControlSettings` резолвятся (models/-пакеты с `__init__` re-export). App-labels: core / ops_statuses / ops_submissions.
- **TDD:** страж-тесты написаны первыми (инверсия теста 2.10). RED — registry `== {Group}+5` падает (зарегистрирован только Group), changelist `reverse(admin:ops_statuses_statustype_changelist)` → NoReverseMatch (нет admin.py); 4 теста (3 smoke + business-not-registered) зелёные. GREEN после создания 3 admin.py → 6 passed.
- **Boundary-guard 2.9:** новые `apps/operations/statuses/admin.py` + `submissions/admin.py` попадают в скан `test_authz_boundary.py`. `has_add_permission`/`has_delete_permission` — НЕ запрещённые токены (имя метода ≠ `.has_perm(`; `request`-параметр не разыменовывается в `.user`). Guard зелёный.
- **Singleton SubmissionControlSettings:** `has_add_permission`→False при существующей строке (seeded migration 0001), `has_delete_permission`→False — UX-гейт поверх DB-защиты (CheckConstraint singleton_key=1).
- **autodiscover в тестах:** форсирован `admin.autodiscover()` в страж-тестах (под pytest мог не вызваться → неполный `_registry` → ложно-зелёный; замечание из ревью 2.10 учтено).
- **Без миграции:** только `admin.py` + тесты; `makemigrations --check` → «No changes detected».
- **Полный `make gate`** (Postgres :5433): **543 passed (+2), 18 deselected, 28 xfailed**; ruff чист; makemigrations «No changes detected»; 11s.

### Completion Notes List

- **3 admin.py:** `apps/core/admin.py` (Position/Rank/DivisionType), `apps/operations/statuses/admin.py` (StatusType), `apps/operations/submissions/admin.py` (SubmissionControlSettings + singleton-гейты). Все — editable ModelAdmin с list_display/search/filter.
- **Страж-тест реестра (буквальный AC эпика 2.8):** `test_admin_registry_is_exactly_catalogs` (`==` allowlist {Group}+5), `test_business_models_not_registered_in_admin` (Employee/Division/EmployeeStatus/Role/User), `test_catalog_changelists_render` (200 по каждому из 5). Устаревший `test_no_project_models_registered_in_admin` (2.10) заменён.
- **Граница соблюдена:** `StatusType`/`SubmissionControlSettings` (справочник/настройки) зарегистрированы; `EmployeeStatus`/бизнес/RBAC — НЕТ (ARCH#L467). Модели/миграции не тронуты.
- **Зависимость на 2.12:** editable-admin без `create_defaults` подвержен ре-сид-затиранию ручных правок — закрывается в 2.12 (осознанный порядок).
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.10). Status → review.

### File List

**To Create** — сделано
- `Backend/VAPS/apps/core/admin.py`
- `Backend/VAPS/apps/operations/statuses/admin.py`
- `Backend/VAPS/apps/operations/submissions/admin.py`

**To Modify** — сделано
- `Backend/VAPS/apps/core/tests/test_admin_platform.py` (устаревший registry-тест 2.10 → страж реестра + changelist-smoke; +импорты справочников/бизнес-моделей)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.11 (bmad-create-story, Opus 4.8): регистрация 5 справочников в Admin (Position/Rank/DivisionType/StatusType/SubmissionControlSettings) + страж-тест реестра (3/4 декомпозиции 2.8; закрывает буквальный AC эпика). Без моделей/миграции. Тонкость: StatusType (справочник) НЕ EmployeeStatus; SubmissionControlSettings (настройки) НЕ DailySubmission (ARCH#L467). Страж = реестр ⊆ {Group}+5 справочников → бизнес-модель → красный. Зависимость: editable-admin без 2.12 (create_defaults) подвержен ре-сид-затиранию — осознанный порядок. Устаревший registry-тест 2.10 инвертируется. Status → ready-for-dev. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8, TDD): созданы 3 admin.py (core: Position/Rank/DivisionType; statuses: StatusType; submissions: SubmissionControlSettings+singleton-гейты). Страж-тест реестра (инверсия 2.10): registry `=={Group}+5`, business-not-registered (Employee/Division/EmployeeStatus/Role/User), changelist-render 200×5. RED→GREEN (autodiscover форсирован). StatusType (справочник) зарегистрирован, EmployeeStatus (бизнес) — нет; boundary-guard 2.9 зелёный (admin.py чист от Django-perm-токенов). Без миграции (`makemigrations` «No changes detected»). `make gate` зелёный (Postgres :5433: 543 passed +2, 28 xfailed; ruff чист; 11s). Артефакты НЕ закоммичены агентом. Status → review. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 193 строки по 4 файлам). Acceptance Auditor: **ACCEPT** — AC-1..5 SATISFIED (проверено реальным прогоном: check 0 issues, makemigrations clean, gate 543/28, старый тест 2.10 заменён не оставлен падающим, ARCH#L467 граница цела). Edge Hunter эмпирически опроверг почти все находки Blind (autodiscover идемпотентен/не ложно-зелёный; миграция 0001 сеет singleton; поля валидны; swapped-user не авто-регистрируется). 0 decision · 1 patch · 0 defer · 5 dismiss. См. ## Review Findings. |
| 2026-06-23 | Применён 1 патч ревью: `test_submission_settings_singleton_admin_gates` (change-view посеянной строки → 200; add-view → 403; delete-view → 403) — покрыл singleton-гейты `has_add_permission`/`has_delete_permission` + edit-форму через реальный admin. `make gate` зелёный (Postgres :5433: **544 passed +1**, 28 xfailed; ruff чист; makemigrations «No changes detected»; 10s). 0 defer. Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 193 строки по 4 файлам: 3 admin.py + test_admin_platform.py). Acceptance Auditor: ACCEPT — все 5 AC SATISFIED, верифицировано реальным прогоном (check 0 issues, makemigrations «No changes detected», gate 543/28, старый registry-тест 2.10 заменён не оставлен падающим, ARCH#L467 граница StatusType/EmployeeStatus цела). Edge Case Hunter (с кодом + БД) эмпирически опроверг почти все находки Blind Hunter. 0 decision · 1 patch · 0 defer · 5 dismiss._

### Patches

- [x] [Review][Patch] Тест singleton-поведения SubmissionControlSettings [apps/core/tests/test_admin_platform.py] — единственная реальная логика стори (`has_add_permission`/`has_delete_permission`-гейты) не покрыта прямым тестом, а changelist-тест для singleton проверяет список, не edit-форму (blind M1+L2). Добавить behavioural-тест: суперюзер GET change-view посеянной строки → 200 (edit-форма с ArrayField рендерится — AC-1 для singleton); GET add-view → 403 (add запрещён, строка есть); GET delete-view → 403 (delete запрещён). Покрывает singleton-гейты через реальный admin.

### Dismissed (5)

- `autodiscover`/глобальное состояние «ложно-зелёный» (blind HIGH): опровергнуто Edge эмпирически — apps в INSTALLED_APPS, `autodiscover` идемпотентен (1/2/3 вызова → ровно 6 моделей, нет `AlreadyRegistered`), `==` ловит утечку (`register(Employee)` → False verified), `module_has_submodule` ПЕРЕ-выбрасывает ошибки импорта admin.py (не оставляет тихо-незарегистрированным). Пустой реестр при мисконфиге = громкое падение `==`, не маскировка.
- singleton нередактируем без сид-записи (blind HIGH): опровергнуто — миграция `0001` сеет строку (`get_or_create(singleton_key=1)`, verified); fallback (пусто → `super().has_add_permission`) безопасен. Покрытие добавлено патчем.
- `ALLOWED={Group}` без `User` «хрупко/скрытый unregister» (blind MED): опровергнуто — при swapped `AUTH_USER_MODEL=core.User` `django.contrib.auth.admin` НЕ регистрирует `User` (только `Group`); скрытого `unregister` нет (установлено ещё в ревью 2.10).
- два guard-теста дублируются (blind MED): `==` субсумирует `business-not-registered`, но явный негатив = осознанное покрытие AC-3 (защита от ослабления `==`→`>=`/`<=`). Намеренно оставлено.
- поля ModelAdmin не верифицируемы / FieldError (blind LOW): опровергнуто — Edge сверил все `list_display`/`search_fields`/`list_filter` с моделями; `manage.py check` → 0 issues (admin.E108 поймал бы битое поле); changelist-тест рендерит каждый из 5.
