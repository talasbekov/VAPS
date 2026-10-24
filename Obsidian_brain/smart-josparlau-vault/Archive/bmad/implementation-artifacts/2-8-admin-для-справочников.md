---
baseline_commit: 40c7a6f6b480e121358767334cfabb778715c8a7
---
# Story 2.8: Django-auth-совместимость `User` — фундамент Admin (1/4)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Декомпозиция эпик-стори «2.8 Admin для справочников».** Exhaustive-анализ кода (create-story, 2026-06-23) вскрыл, что админка в проекте **не поднята вообще** (API-only: DRF + X-User-Id), а кастомная `User` **намеренно несовместима** с Django Admin (FR-33: `AbstractBaseUser` без `PermissionsMixin`, нет `is_staff`/`is_superuser`, `create_superuser` → `NotImplementedError`). Bratan принял подход **«Django Admin + реанимация Django-auth»** (AskUserQuestion, 2026-06-23). Эпик-стори 2.8 разбита на 4 под-стори (см. Dev Notes → «Карта декомпозиции»). **Эта стори (1/4) — только модель+миграция `User`** (изолированная рисковая миграция identity-модели). Регистрация справочников и страж-тест реестра (буквальные AC эпика) закрываются в стори 2.11.

## Story

As a платформа VAPS,
I want чтобы модель `core.User` стала совместимой с Django-auth (`is_staff`, `is_superuser`/`PermissionsMixin`, рабочий `create_superuser`) без слома существующей X-User-Id аутентификации и in-house `PermissionService`,
so that последующие стори (2.10–2.11) смогут поднять Django Admin для редактирования справочников, опираясь на стандартный admin-логин (FR-39; решение «Django-auth» от 2026-06-23).

## Acceptance Criteria

1. **Given** `core.User` (`AbstractBaseUser` без `PermissionsMixin`, без `is_staff`), **When** добавляю `is_staff` + наследование `PermissionsMixin` и реализую `UserManager.create_superuser(username, password)`, **Then** `User.objects.create_superuser("admin", "pw")` создаёт пользователя с `is_staff=True`, `is_superuser=True` и **usable-паролем** (`check_password("pw")` истинно); существующий `create_user(username)` без пароля по-прежнему даёт `set_unusable_password()`.
2. **Given** существующие строки `core_users` (реальные данные пилота), **When** применяю миграцию, **Then** все существующие пользователи получают безопасные дефолты `is_staff=False`, `is_superuser=False`, ни одна строка не теряется и не меняет `id`/`username`; **And** `migrate core <prev>` (reverse) чисто откатывает добавленные поля/таблицы M2M.
3. **Given** DRF-аутентификация `XUserIdAuthentication` и in-house `PermissionService` (RBAC), **When** добавлен Django-auth слой, **Then** оба НЕ затронуты — все существующие API- и RBAC-тесты зелёные (нулевая регрессия); X-User-Id путь не начинает зависеть от `is_staff`/Django-permissions.
4. **Given** изменение модели, **When** `manage.py makemigrations --check --dry-run`, **Then** «No changes detected» (миграция зафиксирована в `0016`); **And** `make gate` зелёный (Postgres :5433, ruff E/F чист, бюджет < 300с).

## Tasks / Subtasks

- [x] **Задача 1. Модель `User` → Django-auth-совместимость (AC: 1,3)**
  - [x] В `apps/core/models.py`: импортировать `PermissionsMixin` (`from django.contrib.auth.models import PermissionsMixin`). Изменить объявление: `class User(AbstractBaseUser, PermissionsMixin):` (порядок MRO: `AbstractBaseUser` первым). `PermissionsMixin` добавляет поля `is_superuser`, M2M `groups`, M2M `user_permissions` — стандартный набор (как у `AbstractUser`).
  - [x] Добавить поле `is_staff = models.BooleanField(default=False)` (доступ к `/admin/`; для follow-on 2.10).
  - [x] Обновить устаревший комментарий «Deliberately AbstractBaseUser without PermissionsMixin…» (`models.py:45-46`) и `create_superuser`-комментарий (`models.py:37-38`) — отразить решение от 2026-06-23 (Django-auth включён для admin-поверхности; авторизация бизнес-логики ОСТАЁТСЯ за `PermissionService`/RBAC, Django-permissions используются ТОЛЬКО для admin).
- [x] **Задача 2. `UserManager.create_superuser` (AC: 1)**
  - [x] Заменить `raise NotImplementedError` (`models.py:36-41`) на рабочую реализацию: `create_superuser(self, username, password=None)` → создаёт пользователя, `set_password(password)`, `is_staff=True`, `is_superuser=True`, `save()`. Сохранить существующий `create_user` без изменений (контракт `set_unusable_password` при отсутствии пароля).
- [x] **Задача 3. Миграция `core/0016` + rollback-заметки (AC: 2,4)**
  - [x] `manage.py makemigrations core` → ожидается `0016_*` с `AddField(is_staff)`, `AddField(is_superuser)`, `AddField(groups)`, `AddField(user_permissions)` (M2M к `auth.Group`/`auth.Permission`). Зависимость от `auth` миграций подтянется автоматически (`django.contrib.auth` уже в `INSTALLED_APPS`).
  - [x] **Rollback:** reverse-миграция дропает 4 поля; существующие пользователи на forward получают дефолты `False`/пустые M2M — потери данных нет, контракт `username`/`id` неизменен. Прогнать round-trip forward→reverse→forward на одноразовой БД (прецедент 2.1) — три шага `exit=0`, существующие строки целы.
- [x] **Задача 4. Тесты (AC: 1,2,3)**
  - [x] Создать `apps/core/tests/test_user_django_auth.py`, `pytestmark = pytest.mark.django_db`. Кейсы: (a) `create_superuser` → `is_staff`/`is_superuser`=True, `check_password` истинно; (b) `create_user` без пароля → `has_usable_password()` False, `is_staff`/`is_superuser`=False (дефолты); (c) существующий пользователь (созданный `create_user`) имеет `is_staff=False` (миграционный дефолт). Прецедент-тест: `apps/core/tests/` (существующие user-тесты, если есть — переиспользовать фикстуры).
  - [x] Регрессия: прогнать существующие RBAC/permission-тесты (`apps/operations/tests/test_permission_*`, `test_api_permissions`) и X-User-Id auth-тесты — должны остаться зелёными без правок.
- [x] **Задача 5. Гейт (AC: 4)**
  - [x] `make gate` (Postgres :5433): `ruff check .` чист, pytest зелёный (+новые тесты), `makemigrations --check` «No changes detected», бюджет < 300с. **Артефакты НЕ коммитить** (за Bratan; прецедент 2.4–2.7).

## Dev Notes

### Контекст: почему это понадобилось (главное открытие)

`core.User` (`apps/core/models.py:44`) — `AbstractBaseUser` **без** `PermissionsMixin`, **без** `is_staff`/`is_superuser`; `UserManager.create_superuser` (`:36`) умышленно `raise NotImplementedError` («No Django superusers… grant roles via operations RBAC», FR-33). Проект **API-only**: `INSTALLED_APPS` (`config/settings.py:10-21`) содержит лишь `auth`+`contenttypes` (нет `contrib.admin/sessions/messages/staticfiles`), `MIDDLEWARE` минимальный, `TEMPLATES = []`, `STATIC*` не задан, `urls.py` без admin-роута. Аутентификация API — `apps.core.auth.authentication.XUserIdAuthentication` (DRF), авторизация — in-house `PermissionService` (RBAC, `apps/operations/rbac`).

Django Admin построен на `is_staff` (вход в `/admin/`) и `has_perm`/`has_module_perms` (`PermissionsMixin`; суперюзер их шунтирует). Чтобы поднять Admin (эпик 2.8), сначала нужно сделать `User` Django-auth-совместимым. **Bratan выбрал реанимацию Django-auth** (а не DRF-CRUD / custom-AdminSite) — AskUserQuestion, 2026-06-23.

### Граница: Django-permissions ТОЛЬКО для admin, бизнес-RBAC не трогаем

`PermissionsMixin` добавляет Django-механику прав (`groups`/`user_permissions`/`has_perm`). **Это НЕ заменяет `PermissionService`.** Бизнес-авторизация (API endpoints, операции) ОСТАЁТСЯ за in-house RBAC (FR-33 в этой части в силе). Django-permissions нужны исключительно как требование admin-сайта; admin-операторы будут **суперюзерами** (`is_superuser=True` шунтирует пер-модельные права — пер-модельные Django-permissions назначать НЕ нужно). Тест AC-3 фиксирует нулевую регрессию RBAC.

### Целевое изменение (точное, минимальное)

```python
# apps/core/models.py
from django.contrib.auth.models import PermissionsMixin  # + импорт

class UserManager(BaseUserManager):
    def create_user(self, username, password=None):   # БЕЗ ИЗМЕНЕНИЙ
        ...
    def create_superuser(self, username, password=None):   # заменить NotImplementedError
        user = self.model(username=username, is_staff=True, is_superuser=True)
        user.set_password(password)
        user.save(using=self._db)
        return user

class User(AbstractBaseUser, PermissionsMixin):   # + PermissionsMixin
    ...
    is_staff = models.BooleanField(default=False)   # + поле
    # is_superuser / groups / user_permissions — приходят из PermissionsMixin
```

`db_table = "core_users"` НЕ менять. `USERNAME_FIELD`/`REQUIRED_FIELDS`/`AUTH_USER_MODEL = "core.User"` (settings:56) — без изменений.

### Риск миграции (изолирована намеренно — поэтому это отдельная стори)

Это правка **identity-модели** (`ARCH-007`/`BR-ACCOUNT-002`): `core_users` связана с `UserEmployeeBinding.user_id` / `UserRole.user_id` (строковый контракт, не FK). Миграция только **добавляет** поля/таблицы M2M — существующие строки безопасны (дефолты `False`). Обязательно: round-trip forward→reverse→forward на свежей БД (прецедент 2.1, см. sprint-status «last gate activity»). Именно из-за риска identity-миграции рисковая часть вынесена в keystone-стори (твои decomposition-правила: «Migration — отдельная стори; рисковая миграция → rollback-заметки»).

### Карта декомпозиции эпик-стори 2.8 (этот файл = 1/4)

| # | Под-стори | Scope | Слой | Закрывает AC эпика | Зависит |
|---|-----------|-------|------|--------------------|---------|
| **2.8** (этот файл) | Django-auth-совместимость `User` | `is_staff`+`PermissionsMixin`+`create_superuser`+миграция `0016` | Model+Migration | — (фундамент) | — |
| 2.10 | Поднять админ-платформу | `INSTALLED_APPS`(admin/sessions/messages/staticfiles)+MIDDLEWARE(Session/Auth/Message)+`TEMPLATES`(admin context_processors)+`STATIC*`+`urls` admin-роут+(`AUTHENTICATION_BACKENDS`=ModelBackend)+smoke (`GET /admin/login/`→200, суперюзер логинится) | Config | — | 2.8 |
| 2.11 | Регистрация справочников + страж-тест реестра | `admin.py` для `core.Position/Rank/DivisionType`, `statuses.StatusType`, `submissions.SubmissionControlSettings` (editable ModelAdmin) + тест «бизнес-модель в `admin.site._registry` → красный» | Admin | **AC-1, AC-2** | 2.10 |
| 2.12 | Edit-safety справочников | `MinValueValidator` (`Position.level`/`sort_order`, `Rank.rank_index`) + `create_defaults` в `seed_core`/`import_references`/`seed_statuses` (Admin-правки не затираются ре-сидом) | Validation | — | 2.11 |

**Справочники под регистрацию (для стори 2.11, НЕ здесь):** `core.Position`, `core.Rank`, `core.DivisionType`, `statuses.StatusType`, `submissions.SubmissionControlSettings` (Story 2.3: «правка — через Admin»). **Бизнес-модели — НЕ регистрировать (страж-тест → красный):** `User`, `Employee`, `Division`, `EmployeeStatus`, `EmployeeDivisionHistory`, `UserEmployeeBinding`, `DivisionHistoricalSlot`, `StaffingSlot`, `EmployeeStaffingAssignment`, `Vacancy`, `SensitiveFieldPolicy`, `Watermark`, `Organization`, и вся RBAC (`Role/UserRole/RolePermission/TemporaryDutyPermission/Permission` → область 2.9).

### Project Structure Notes

- **Создать:** `apps/core/migrations/0016_*.py` (авто), `apps/core/tests/test_user_django_auth.py`.
- **Изменить:** `apps/core/models.py` (User + UserManager). ≤3 кодовых файла — в пределах правила размера. Один слой (модель/миграция), одна ответственность (identity ↔ Django-auth), независимо тестируема и откатываема.
- **НЕ трогать в этой стори:** `config/settings.py`/`urls.py` (→ 2.10), любой `admin.py` (→ 2.11), `seed_*`/`import_references`/валидаторы полей (→ 2.12), `XUserIdAuthentication`, `PermissionService`/RBAC, прочие модели.

### Out of Scope (НЕ реализовывать в 2.8)

- Включение `django.contrib.admin` и зависимостей (apps/middleware/templates/static/urls) → **2.10**.
- Регистрация ModelAdmin справочников + страж-тест реестра → **2.11**.
- `MinValueValidator` / `create_defaults` → **2.12**.
- Любое назначение пер-модельных Django-permissions/групп (admin-операторы = суперюзеры).
- Изменение бизнес-RBAC, X-User-Id auth, прочих моделей.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.8 (line 455-462)] — эпик-стори «Admin для справочников» (AC: справочники editable, бизнес-модели не зарегистрированы, страж-тест реестра).
- [Source: Backend/VAPS/apps/core/models.py:24-64] — `UserManager`/`User` (текущее состояние: `AbstractBaseUser`, `NotImplementedError` в `create_superuser`, FR-33-комментарии).
- [Source: Backend/VAPS/config/settings.py:10-21,23,28,56] — `INSTALLED_APPS` (нет admin), `MIDDLEWARE`, `TEMPLATES=[]`, `AUTH_USER_MODEL`.
- [Source: Backend/VAPS/config/urls.py] — нет admin-роута (API-only).
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml «last gate activity»] — round-trip forward→reverse→forward прецедент (2.1) для рисковых миграций.
- [Decision] AskUserQuestion 2026-06-23: подход к 2.8 = «Django Admin + реанимация Django-auth» (Bratan).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23. baseline_commit `40c7a6f`.

### Debug Log References

- **TDD:** тесты написаны первыми (`test_user_django_auth.py`, 5 кейсов). RED — `pytest apps/core/tests/test_user_django_auth.py` → 5 failed (`NotImplementedError` в `create_superuser`; `User` без `is_staff`/`has_perm`). GREEN после правки модели → 5 passed (1.86s).
- **Миграция:** `makemigrations core` → `0016_user_groups_user_is_staff_user_is_superuser_and_more.py` (AddField groups/is_staff/is_superuser/user_permissions; deps `auth.0012`+`core.0015`). `makemigrations --check` чист.
- **Round-trip (AC-2):** на одноразовой БД `vaps_rt28` прогнан forward→reverse(`core 0015`)→forward — три шага `exit=0`; после reverse колонка `is_staff` исчезла, строка `core_users` уцелела (count=1, посев `create_user('rt_user')` до reverse); после re-forward `rt_user|is_staff=false` (backfill дефолтом). Reverse чисто обратим, данные целы.
- **ruff:** авто-миграция несла 3×E501 (длинные `field=...`). `ruff format` (по файлу) перенёс на多 строк; 2 остаточных — Django-`help_text`-литералы (`groups` 126, `is_superuser` 109), текст менять нельзя (разойдётся с моделью) → `# noqa: E501` на 2 строки. Прецедента noqa в core-миграциях не было (это первая миграция с PermissionsMixin-полями).
- **Регрессия:** `make gate` поймал устаревший `test_authentication.py::test_create_superuser_is_not_supported` (ассертил старый `NotImplementedError`-контракт = FR-33 «нет суперюзеров», который стори осознанно разворачивает). Обновлён в каноничном auth-контракт-файле на `test_create_superuser_creates_admin_user` (новый контракт).
- **Полный `make gate`** (Postgres :5433, docker `vaps-db-1`): **429 passed, 18 deselected** (база 424 → +5), `ruff check .` чист, `makemigrations --check` «No changes detected», 7s (бюджет NFR-8 = 300s). Все permission/RBAC/X-User-Id тесты зелёные (AC-3 нулевая регрессия).

### Completion Notes List

- **Модель `User`** (`apps/core/models.py`): `class User(AbstractBaseUser, PermissionsMixin)` + поле `is_staff = BooleanField(default=False)`; `is_superuser`/`groups`/`user_permissions` пришли из `PermissionsMixin`. `db_table`/`USERNAME_FIELD`/`AUTH_USER_MODEL` неизменны. Комментарии FR-33 обновлены: Django-permissions — **только** для admin-поверхности; бизнес-авторизация остаётся за `PermissionService`.
- **`UserManager.create_superuser(username, password=None)`**: `NotImplementedError` заменён рабочей реализацией (`is_staff=True`, `is_superuser=True`, `set_password`). `create_user` без изменений (контракт `set_unusable_password`).
- **Миграция `core/0016`** — обратимая (4×AddField; backfill `is_staff`/`is_superuser`=False для существующих строк безопасен; M2M `user_set`-аксессоры без клэшей).
- **Граница соблюдена:** admin-app/settings/urls/static/templates НЕ трогались (→ 2.10); регистрация справочников + страж-тест (→ 2.11); валидаторы/`create_defaults` (→ 2.12). X-User-Id auth и in-house RBAC не затронуты.
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.7). Status → review (dev не само-промоутит в done; ревью желательно другой моделью).

### File List

**To Create** — сделано
- `Backend/VAPS/apps/core/migrations/0016_user_groups_user_is_staff_user_is_superuser_and_more.py`
- `Backend/VAPS/apps/core/tests/test_user_django_auth.py`

**To Modify** — сделано
- `Backend/VAPS/apps/core/models.py` (User + UserManager + PermissionsMixin)
- `Backend/VAPS/apps/core/tests/test_authentication.py` (устаревший superuser-тест → новый контракт)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.8 (bmad-create-story, Opus 4.8): декомпозиция эпик-стори «Admin для справочников» (open: админка не поднята + `User` несовместима с Django-auth/FR-33). Решение Bratan: «Django Admin + реанимация Django-auth». Эта стори = фундамент 1/4 (User auth-совместимость). Follow-on 2.10/2.11/2.12. Status → ready-for-dev. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8, TDD): `User(AbstractBaseUser, PermissionsMixin)` + `is_staff` + рабочий `create_superuser`; миграция `core/0016` (обратимая, round-trip forward→reverse→forward на `vaps_rt28` зелёный). Устаревший `test_create_superuser_is_not_supported` обновлён под новый контракт. `make gate` зелёный (Postgres :5433: 429 passed, +5; ruff чист; makemigrations «No changes detected»; 7s). Артефакты НЕ закоммичены агентом. Status → review. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя; scoped diff ~129 строк по 4 файлам). Acceptance Auditor: **ACCEPT** — AC-1..4 SATISFIED, out-of-scope чист, миграция обратима. 0 decision · 2 patch · 2 defer · 9 dismiss. См. ## Review Findings. |
| 2026-06-23 | Применены 2 патча ревью: P1 каноничный `create_superuser` (`**extra_fields` + инвариант-гарды + reject пустого `username`, паритет с `create_user`); P2 тесты (`create_superuser("")`→`ValueError`, `assert is_active` на суперюзере). `make gate` зелёный (Postgres :5433: **430 passed**, +1; ruff чист; makemigrations «No changes detected»; 6s). 2 defer → deferred-work.md. Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat: ревью той же моделью; 3 адверсариальных слоя; scoped diff ~129 строк по 4 файлам). Acceptance Auditor: ACCEPT — AC-1..4 SATISFIED, out-of-scope (admin-app/registration/validators → 2.10/2.11/2.12) чист, `db_table`/`USERNAME_FIELD`/`AUTH_USER_MODEL` неизменны, миграция обратима, устаревший FR-33-тест корректно инвертирован. Edge верифицировал отсутствие related_name-клэша и RBAC-утечки. 0 decision · 2 patch · 2 defer · 9 dismiss._

### Patches

- [x] [Review][Patch] Каноничный `create_superuser` [models.py:37-44] — текущая реализация неканонична: (a) нет `**extra_fields` → хрупко к `manage.py createsuperuser`/росту `REQUIRED_FIELDS` (blind HIGH); (b) нет guard пустого `username`, тогда как `create_user` его ловит `ValueError` → дивергенция, `create_superuser("")` молча создаёт суперюзера с пустым логином (edge HIGH); (c) нет инвариант-гардов `is_staff`/`is_superuser` (blind MED). Фикс: канон-паттерн Django — `def create_superuser(self, username, password=None, **extra_fields)` + `setdefault(is_staff/is_superuser=True)` + `ValueError` если не True + `if not username: raise ValueError` (паритет с `create_user`).
- [x] [Review][Patch] Тесты для усиленного `create_superuser` [test_user_django_auth.py] — добавить: `create_superuser("")` → `ValueError`; `assert user.is_active` на суперюзере (фиксирует предусловие short-circuit прав — docstring «superuser short-circuits all checks» верен только для active; edge MED).

### Deferred

- [x] [Review][Defer] Migration-state автотест (reverse + backfill существующих строк) [migrations/0016] — AC-2 (reverse чисто откатывает + существующие строки → is_staff=False) верифицировано **вручную** (round-trip на одноразовой `vaps_rt28`, документировано в Debug Log), но не покрыто коммит-тестом; авто-тест требует migration-test framework (нет в dev-deps) → отложен как test-hardening (прецедент 2.1: «путь UPDATE-relabel без автотеста» → defer). — deferred (manual-verified)
- [x] [Review][Defer] PermissionsMixin design-hazard [models.py] — `has_perm`/`has_module_perms` теперь живые на каждом `User` app-wide; суперюзер шунтирует ВСЕ Django-проверки. Бизнес-код их НЕ зовёт (Edge верифицировал: `PermissionService` ключуется на `actor_id`-строке, DRF-permissions не трогают Django-perms), утечки сегодня нет. Guard-тест «бизнес-эндпоинты не консультируют Django `has_perm`» + явная фиксация границы → естественный дом 2.9 (RBAC-матрица). — deferred (forward-guard)
