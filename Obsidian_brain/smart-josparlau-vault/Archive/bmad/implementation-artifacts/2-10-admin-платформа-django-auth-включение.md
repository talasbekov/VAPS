---
baseline_commit: 665856851e7e66d65bf723af14d93cdda9e92d72
---
# Story 2.10: Поднять админ-платформу `django.contrib.admin` (2/4)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Под-стори 2/4 эпик-стори «Admin для справочников»** (декомпозиция в 2.8: 2.8 User-auth-совместимость → **2.10 платформа** → 2.11 регистрация справочников + страж-тест → 2.12 edit-safety). 2.8 (done) сделала `core.User` Django-auth-совместимой; **2.10 поднимает саму платформу** `django.contrib.admin` + её зависимости (sessions/messages/staticfiles, middleware, TEMPLATES, STATIC_URL, `admin/`-роут) и доказывает её smoke-тестом. **Ни одна модель НЕ регистрируется** (это 2.11) — admin-index поднимается пустым.
>
> **Чисто config-стори:** правки только в `config/settings.py` + `config/urls.py` + новый smoke-тест. Без моделей, без миграции (contrib-приложения везут свои миграции). **Главный риск — Django system-checks `admin.E40x`:** гейт гоняет `makemigrations --check --dry-run`, который триггерит system-check; неверная admin-конфигурация (нет context-processor / не тот порядок middleware) → гейт КРАСНЫЙ. Точная минимально-корректная конфигурация — в Dev Notes.

## Story

As a администратор справочников VAPS,
I want чтобы в проекте был поднят Django Admin (`/admin/`) с рабочим входом для суперпользователя поверх уже Django-auth-совместимой модели `core.User`,
so that последующая стори 2.11 смогла зарегистрировать справочники для редактирования через стандартную админку (FR-39; решение «Django Admin» от 2026-06-23).

## Acceptance Criteria

1. **Платформа поднята.** **Given** включены `django.contrib.{admin,sessions,messages,staticfiles}` + корректные MIDDLEWARE/TEMPLATES/STATIC_URL + роут `path("admin/", admin.site.urls)`, **When** `GET /admin/login/`, **Then** ответ `200` и страница логина рендерится (TEMPLATES-бэкенд + staticfiles-теги резолвятся).
2. **Суперпользователь входит.** **Given** суперюзер из `User.objects.create_superuser("admin", "pw")` (2.8), **When** аутентифицируюсь (`client.force_login` или `client.login`) и `GET /admin/`, **Then** ответ `200` — admin-index рендерится (с НУЛЁМ зарегистрированных моделей — это норма для 2.10).
3. **System-checks чисты, миграции нет.** **Given** config-правки, **When** `manage.py check` и `makemigrations --check --dry-run`, **Then** `0` system-check issues (все `admin.E40x` удовлетворены) и «No changes detected» — новой миграции НЕТ (contrib-приложения везут свои миграции; модели не трогаются).
4. **Нулевая регрессия + граница цела.** **Given** поднятие платформы, **Then** все существующие тесты зелёные (settings/app/api/RBAC/auth); X-User-Id API-путь и in-house `PermissionService` НЕ затронуты; boundary-guard стори 2.9 (`test_authz_boundary.py`) остаётся зелёным (admin-код живёт в `config/`, не в бизнес-слоях); **And** НИ ОДНА модель не зарегистрирована в admin (`admin.site._registry` пуст — регистрация в 2.11).
5. **Гейт.** **When** `make gate` (Postgres :5433), **Then** `ruff check .` чист (E/F), pytest зелёный (+smoke-тесты), `makemigrations --check` «No changes detected», бюджет < 300с (NFR-8). **Артефакты НЕ коммитить** (за Bratan; прецедент 2.4–2.9).

## Tasks / Subtasks

- [x] **Задача 1. INSTALLED_APPS — включить admin + зависимости (AC: 1,3)**
  - [x] В `config/settings.py` добавить в `INSTALLED_APPS` (наверх, ДО `apps.*`): `django.contrib.admin`, `django.contrib.sessions`, `django.contrib.messages`, `django.contrib.staticfiles`. (`django.contrib.auth`/`contenttypes` уже есть.) Порядок: contrib-блок первым, затем `rest_framework`, затем `apps.*` (admin autodiscover должен видеть app'ы).
- [x] **Задача 2. MIDDLEWARE — добавить в правильном порядке (AC: 1,2,3)**
  - [x] Заменить минимальный MIDDLEWARE на корректный для admin набор (порядок критичен для `admin.E408/E409/E410`): `SessionMiddleware` → `CommonMiddleware` (уже есть) → `CsrfViewMiddleware` → `AuthenticationMiddleware` → `MessageMiddleware` (+ рекомендуется `XFrameOptionsMiddleware` для clickjacking-защиты admin). `SessionMiddleware` ОБЯЗАН быть до `AuthenticationMiddleware` (E410); `CsrfViewMiddleware` нужен функционально (без него POST-логин admin → 403).
- [x] **Задача 3. TEMPLATES — DjangoTemplates backend + context-processors (AC: 1,3)**
  - [x] Заменить `TEMPLATES = []` на сконфигурированный `DjangoTemplates`-бэкенд с `APP_DIRS=True` и тремя обязательными context-processors: `django.template.context_processors.request` (`admin.E403`), `django.contrib.auth.context_processors.auth` (`admin.E402`), `django.contrib.messages.context_processors.messages` (`admin.E404`). (Точный блок — в Dev Notes.) **Это самая значимая правка** (сейчас `TEMPLATES=[]`).
- [x] **Задача 4. STATIC_URL (AC: 1)**
  - [x] Добавить `STATIC_URL = "static/"`. С `staticfiles` + `DEBUG` admin-ассеты резолвятся под `runserver`/тест-клиентом (`{% static %}` не падает `ImproperlyConfigured`). **`STATIC_ROOT`/`collectstatic`/nginx-alias/whitenoise → E12** (прод-статика; ARCH L335 «static — nginx alias», не whitenoise).
- [x] **Задача 5. URL-роут admin (AC: 1,2)**
  - [x] В `config/urls.py`: `from django.contrib import admin` + `path("admin/", admin.site.urls)` в `urlpatterns` (рядом с существующими `api/core/`, `api/operations/`). Нулевая регистрация моделей — admin-index поднимется пустым (норма для 2.10).
- [x] **Задача 6. Smoke-тесты (AC: 1,2,4)**
  - [x] Создать `apps/core/tests/test_admin_platform.py` (`pytestmark = pytest.mark.django_db`): (a) `GET /admin/login/` → `200`; (b) `create_superuser` + `client.force_login(su)` + `GET /admin/` → `200`; (c) `admin.site._registry == {}` (НИ одной модели — граница 2.10↔2.11; превратится в обратное в 2.11). Тест-клиент — стандартный Django `Client` (не DRF APIClient; admin — server-rendered).
  - [x] Регрессия: прогнать существующие settings/app-тесты (`test_settings.py`, все `test_app.py`), RBAC/API-suite и boundary-guard 2.9 — должны остаться зелёными без правок.
- [x] **Задача 7. Гейт (AC: 5)**
  - [x] `make gate` (Postgres :5433): `ruff check .` чист, pytest зелёный (+smoke), `manage.py check` 0 issues, `makemigrations --check` «No changes detected», бюджет < 300с. **Артефакты НЕ коммитить.**

## Dev Notes

### Контекст: что и зачем (2/4 декомпозиции 2.8)

2.8 (done) включила `PermissionsMixin` + `is_staff` + рабочий `create_superuser` на `core.User` — модель стала Django-auth-совместимой, но **сама админка не поднята**: `INSTALLED_APPS` без `admin/sessions/messages/staticfiles`, `MIDDLEWARE` = только `CommonMiddleware`, `TEMPLATES = []`, нет `STATIC_URL`, нет `admin/`-роута (проект API-only: DRF + X-User-Id). 2.10 поднимает платформу; 2.11 зарегистрирует справочники; 2.12 — edit-safety.

**Архитектура admin САНКЦИОНИРУЕТ** (не «Молчание=СТОП»): architecture.md#L69/L120 «Django Admin для справочников», #L616 «FR-39 справочники | core + Django Admin (только справочники)». Единственное admin-MUST-NOT (#L467): «только справочники без бизнес-инвариантов + read-only; MUST NOT регистрация submissions/статусов/amendments/документов» — это ограничение **2.11** (регистрация), не 2.10.

### Текущее состояние правимых файлов (прочитано)

- **`config/settings.py`** (`:10-21` INSTALLED_APPS без admin-блока; `:23-25` MIDDLEWARE=только `CommonMiddleware`; `:27` ROOT_URLCONF; `:28` `TEMPLATES = []`; `:29` `WSGI_APPLICATION = None`; `:56` `AUTH_USER_MODEL="core.User"`; `:7-8` DEBUG env-default-on, `ALLOWED_HOSTS=["*"]`; STATIC_* отсутствует). **Сохранить:** DEBUG/ALLOWED_HOSTS/DATABASES/REST_FRAMEWORK/TIME_ZONE/AUTH_USER_MODEL — не трогать.
- **`config/urls.py`** (`:1-6`: `include("apps.core.api.urls")`, `include("apps.operations.api.urls")`; admin-роута нет).
- **`core.User`** (`models.py:57-79`) — `AbstractBaseUser + PermissionsMixin`, `is_staff`/`is_superuser`/`groups`/`user_permissions` (миграция `core/0016`, 2.8); `create_superuser` каноничен (`:37-54`). Полностью admin-совместима. **`AUTHENTICATION_BACKENDS` задавать НЕ нужно** — Django по умолчанию `["django.contrib.auth.backends.ModelBackend"]`, что admin и требует.

### Минимально-КОРРЕКТНАЯ конфигурация (Django 5.1.x; проверено по `admin/checks.py`)

Гейт гоняет `makemigrations --check` → триггерит system-check; перечисленные `admin.E40x` роняют гейт, если что-то не так.

```python
# config/settings.py
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "apps.core",
    "apps.operations",
    "apps.operations.statuses",
    "apps.operations.rbac",
    "apps.operations.submissions",
    "apps.migration_legacy",
]

MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",   # до Auth (admin.E410)
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",              # POST-логин admin
    "django.contrib.auth.middleware.AuthenticationMiddleware",  # admin.E408
    "django.contrib.messages.middleware.MessageMiddleware",   # admin.E409
    "django.middleware.clickjacking.XFrameOptionsMiddleware", # admin clickjacking
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",   # admin.E403
                "django.contrib.auth.context_processors.auth",  # admin.E402
                "django.contrib.messages.context_processors.messages",  # admin.E404
            ],
        },
    },
]

STATIC_URL = "static/"
```
```python
# config/urls.py
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/core/", include("apps.core.api.urls")),
    path("api/operations/", include("apps.operations.api.urls")),
]
```

### Gotchas

- **Порядок middleware enforced system-check'ом:** `SessionMiddleware` ДО `AuthenticationMiddleware` (E410); присутствие `AuthenticationMiddleware` (E408) и `MessageMiddleware` (E409). Нарушишь — `manage.py check`/`makemigrations` падают → гейт красный.
- **`TEMPLATES=[]` → backend обязателен:** три context-processor'а (`request`/`auth`/`messages`) при `APP_DIRS=True` обязательны (E402/E403/E404). Это главная правка.
- **`STATIC_URL` обязателен:** admin-шаблоны зовут `{% static %}`; без `STATIC_URL` → `ImproperlyConfigured` при рендере `/admin/login/` (500). Smoke-тест AC-1 это ловит.
- **CSRF:** без `CsrfViewMiddleware` POST-логин admin → 403 (нет admin.E-кода, но функционально обязателен). `force_login` в тесте обходит форму, но реальный вход и AC-1 рендер требуют CSRF в стеке.
- **Миграции:** добавление `admin/sessions/messages` тянет ИХ миграции (LogEntry, django_session) — они уже в Django, `makemigrations --check` остаётся «No changes detected» (новых миграций по нашим моделям нет). pytest-django прогонит их при создании тест-БД.
- **`makemigrations --check` зелёный ТОЛЬКО при корректном admin:** мисконфиг → system-check fail → makemigrations abort → гейт красный. Поэтому AC-3 = и «No changes detected», и 0 system-check issues.
- **Boundary-guard 2.9 (`test_authz_boundary.py`):** сканит `operations/**` + `core/{api,services,selectors}`; `config/settings.py`/`urls.py` ВНЕ области скана (`APPS_DIR=parents[2]=apps/`). Admin-код в `config/` границу не нарушает. **НЕ** добавлять admin-код в бизнес-файлы.
- **Тест-клиент:** admin — server-rendered → стандартный `django.test.Client`, НЕ DRF `APIClient`. `client.force_login(superuser)` для AC-2.
- **WSGI/ASGI:** `WSGI_APPLICATION=None` не трогать (`runserver` берёт дефолтный WSGI; тест-клиент идёт через URLconf). ASGI/uvicorn для прод (WS) — E12.

### Project Structure Notes

- **Создать:** `Backend/VAPS/apps/core/tests/test_admin_platform.py` (smoke).
- **Изменить:** `Backend/VAPS/config/settings.py` (INSTALLED_APPS/MIDDLEWARE/TEMPLATES/STATIC_URL), `Backend/VAPS/config/urls.py` (admin-роут). ≤3 файла, один слой (config), одна ответственность (поднять admin-платформу), независимо тестируема и откатываема. Миграции НЕТ.
- **НЕ трогать:** любой `admin.py` / регистрацию моделей (→ 2.11), `MinValueValidator`/`create_defaults` (→ 2.12), `XUserIdAuthentication`, `PermissionService`/RBAC, модели, `seed_*`, DRF REST_FRAMEWORK-конфиг.

### Out of Scope (НЕ реализовывать в 2.10)

- **Регистрация любых моделей в admin** (`admin.site.register`, `admin.py`) + страж-тест реестра → **2.11**. AC-4 фиксирует пустой `_registry`.
- `MinValueValidator` / `create_defaults` справочников → **2.12**.
- `STATIC_ROOT` / `collectstatic` / nginx static-alias / whitenoise → **E12** (прод-статика; ARCH#L335 nginx alias).
- Прод-сплит настроек (`config/settings/{base,production}.py`) → **E12** (ARCH#L501 envisioned, ещё не построен).
- Явный `AUTHENTICATION_BACKENDS` — Django-дефолт `ModelBackend` достаточен; не задавать без нужды.
- Security-hardening (CSP, security headers, rate-limit, HTTPS-редирект, IP-фильтр) → прод-hardening эпик (ARCH#L319, «не блокирует первый релиз: закрытый LAN»).
- ASGI/WSGI-приложение, Celery/beat, WS → E11/E12.

### References

- [Source: _bmad-output/implementation-artifacts/2-8-admin-для-справочников.md#L83-90] — карта декомпозиции эпик-стори 2.8 → 2.10 scope (config: INSTALLED_APPS/MIDDLEWARE/TEMPLATES/STATIC*+urls+smoke); [#L46-48] почему админка не поднята; [#L50-52] граница «Django-permissions только для admin».
- [Source: _bmad-output/planning-artifacts/architecture.md#L69,L120,L467,L616] — Django Admin санкционирован (только справочники; MUST NOT регистрация бизнес-моделей → 2.11); [#L335] прод-статика = nginx alias (не whitenoise) → E12; [#L319] prod-hardening отдельный эпик; [#L501] сплит настроек envisioned; [#L117,L648] стек Django 5.x/Python 3.12; [#L33] «Молчание=СТОП» (sessions/CSRF/CSP не специфицированы → стоковые дефолты).
- [Source: Backend/VAPS/config/settings.py:10-29,56] — текущее состояние (нет admin-блока, TEMPLATES=[], нет STATIC).
- [Source: Backend/VAPS/config/urls.py:1-6] — текущие роуты (нет admin).
- [Source: Backend/VAPS/apps/core/models.py:37-79] — `User`/`create_superuser` admin-совместимы (2.8); миграция `core/0016`.
- [Source: Backend/VAPS/apps/core/tests/test_settings.py; apps/*/tests/test_app.py] — все settings/app-тесты на `in`-членстве → аддитивные правки безопасны (нулевая регрессия).
- [Source: Backend/VAPS/apps/operations/tests/test_authz_boundary.py] — boundary-guard 2.9; `config/` вне области скана → admin-конфиг границу не нарушает.
- [Source: .venv/.../django/contrib/admin/checks.py::check_dependencies] — `admin.E401-E410` (INSTALLED_APPS/MIDDLEWARE-порядок/context-processors).
- [Source: Backend/VAPS/Makefile] — `make gate` (ruff + pytest + `makemigrations --check` → system-check), бюджет < 300с.
- [Decision] AskUserQuestion 2026-06-23 (в 2.8): подход = «Django Admin + реанимация Django-auth» (Bratan).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23. baseline_commit `6658568`.

### Debug Log References

- **TDD:** smoke-тест `test_admin_platform.py` написан первым. RED — `pytest` → 3 failed (`LookupError: No installed app with label 'admin'`: платформа не поднята). GREEN после config-правок → 3 passed (1.26s).
- **Открытие на GREEN:** `admin.site._registry` НЕ пуст после поднятия — `django.contrib.auth.admin` авто-регистрирует `Group` (framework-дефолт; кастомный `core.User` swapped → contrib НЕ регистрирует User). Буквальное AC-4 «`_registry` пуст» физически недостижимо в Django. Скорректировал тест на РЕАЛЬНУЮ границу 2.10↔2.11: «ни одна модель `apps.*` не зарегистрирована» (`test_no_project_models_registered_in_admin`) — `Group` (contrib) допустим, наши справочники/бизнес-модели = ноль. Решение что делать с `Group` (оставить/unregister) — за 2.11 (там страж-тест реестра).
- **Конфигурация (config/settings.py):** INSTALLED_APPS += admin/sessions/messages/staticfiles (contrib-блок наверх); MIDDLEWARE = Session→Common→Csrf→Auth→Message→XFrameOptions (порядок под admin.E408/E409/E410); `TEMPLATES=[]` → DjangoTemplates+APP_DIRS+3 context-processor'а (request/auth/messages = admin.E402/E403/E404); `STATIC_URL="static/"`. config/urls.py += `path("admin/", admin.site.urls)`.
- **System-checks (AC-3):** `manage.py check` → «System check identified no issues (0 silenced)» — все admin.E40x удовлетворены. `makemigrations --check` → «No changes detected» (contrib-приложения везут свои миграции LogEntry/django_session; наши модели не тронуты — миграции НЕТ).
- **Регрессия/граница:** boundary-guard 2.9 (`test_authz_boundary.py`) зелёный (admin-код в `config/`, вне области скана); все settings/app-тесты на `in`-членстве — зелёные; X-User-Id auth + PermissionService не тронуты.
- **Полный `make gate`** (Postgres :5433): **540 passed (+3), 18 deselected, 28 xfailed**; ruff чист; makemigrations «No changes detected»; 20s (бюджет NFR-8 = 300s).

### Completion Notes List

- **config/settings.py:** admin-платформа поднята минимально-корректно (INSTALLED_APPS/MIDDLEWARE-порядок/TEMPLATES-backend/STATIC_URL). `DEBUG`/`ALLOWED_HOSTS`/`DATABASES`/`REST_FRAMEWORK`/`AUTH_USER_MODEL`/`TIME_ZONE` неизменны. `AUTHENTICATION_BACKENDS` не задавался (Django-дефолт `ModelBackend` достаточен).
- **config/urls.py:** добавлен `admin/`-роут; `api/core/`+`api/operations/` неизменны.
- **Граница соблюдена:** НИ одной модели `apps.*` не зарегистрировано (регистрация справочников + страж-тест реестра → 2.11; `Group` = contrib-дефолт, не наша модель). Валидаторы/`create_defaults` → 2.12. `STATIC_ROOT`/collectstatic/nginx → E12.
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.9). Status → review (dev не само-промоутит в done; ревью желательно другой моделью).

### File List

**To Create** — сделано
- `Backend/VAPS/apps/core/tests/test_admin_platform.py`

**To Modify** — сделано
- `Backend/VAPS/config/settings.py` (INSTALLED_APPS + MIDDLEWARE + TEMPLATES + STATIC_URL)
- `Backend/VAPS/config/urls.py` (admin-роут)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.10 (bmad-create-story, Opus 4.8): поднятие admin-платформы (2/4 декомпозиции 2.8). Config-стори: INSTALLED_APPS(admin/sessions/messages/staticfiles)+MIDDLEWARE(порядок под admin.E40x)+TEMPLATES(3 context-processor'а)+STATIC_URL+admin-роут+smoke. Без моделей/миграции. Главный риск — system-checks admin.E40x в гейте; точная минимально-корректная конфигурация заложена. Exhaustive-анализ: admin санкционирован архитектурой, все deps вендорены (нет нового pip), все settings-тесты на `in`-членстве (нулевая регрессия), boundary-guard 2.9 не задет (config вне скана). Status → ready-for-dev. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8, TDD): admin-платформа поднята (config/settings.py: admin/sessions/messages/staticfiles + MIDDLEWARE-порядок + TEMPLATES-backend + STATIC_URL; config/urls.py: admin-роут). RED→GREEN smoke (`apps/core/tests/test_admin_platform.py`, 3 теста). Открытие: `_registry` не пуст — Django авто-регистрирует contrib `Group`; AC-4 скорректирован на реальную границу «ноль моделей `apps.*`» (Group=framework-дефолт, наши модели → 2.11). `manage.py check` 0 issues (admin.E40x ок); makemigrations «No changes detected» (миграции нет). `make gate` зелёный (Postgres :5433: 540 passed +3, 28 xfailed; ruff чист; 20s). boundary-guard 2.9 зелёный (config вне скана). Артефакты НЕ закоммичены агентом. Status → review. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 76 строк по 3 файлам config + smoke). Acceptance Auditor: **ACCEPT** — AC-1..5 SATISFIED, проверено реальным прогоном команд (check 0 issues, makemigrations clean, gate 540/28 воспроизведено до числа); девиация AC-4 оправдана; out-of-scope чист. Edge Hunter опроверг главные находки Blind (реальный CSRF-логин → 302; DRF csrf_exempt → API не сломан). 0 decision · 2 patch · 2 defer · 3 dismiss. См. ## Review Findings. |
| 2026-06-23 | Применены 2 патча ревью: P1 реальный POST-login smoke (`Client(enforce_csrf_checks=True)` GET→POST username/password+csrftoken→302; +kwargs в create_superuser) — теперь покрыт session/ModelBackend/CSRF-flow, не только force_login; P2 registry-allowlist `set(_registry) <= {Group}` (ловит любую неожиданную авто-регистрацию). `make gate` зелёный (Postgres :5433: **541 passed +1**, 28 xfailed; ruff чист; makemigrations «No changes detected»; 11s). 2 defer → deferred-work.md (prod-hardening + STATIC_ROOT → E12). Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 76 строк по 3 файлам: config/settings.py, config/urls.py, test_admin_platform.py). Acceptance Auditor: ACCEPT — все 5 AC SATISFIED, верифицировано РЕАЛЬНЫМ прогоном (manage.py check 0 issues, makemigrations «No changes detected», gate 540 passed/28 xfailed воспроизведено до числа, девиация AC-4 оправдана/ничего не маскирует). Edge Case Hunter (с кодом) опроверг главные находки Blind Hunter: прогнал реальный CSRF-enforced логин (GET→POST→302), подтвердил `APIView.csrf_exempt==True` (DRF API не ломается от CsrfViewMiddleware, 14 API-POST-тестов зелёные). 0 decision · 2 patch · 2 defer · 3 dismiss._

### Patches

- [x] [Review][Patch] Реальный POST-login smoke [apps/core/tests/test_admin_platform.py] — позитивные тесты используют `force_login`+GET (AC-2 это допускает), но не исполняют ни одного POST → CSRF/session/auth-backend-flow тестами не покрыт (blind HIGH/MED). Edge подтвердил, что реальный логин работает (302). Добавить тест `Client(enforce_csrf_checks=True)`: GET `/admin/login/` (взять csrftoken) → POST username/password+csrftoken → 302 на `/admin/`; усиливает smoke до «суперюзер реально логинится» (+ kwargs в `create_superuser` для читаемости).
- [x] [Review][Patch] Усилить registry-страж до allowlist [apps/core/tests/test_admin_platform.py] — рядом с проверкой `apps.*` добавить `assert set(admin.site._registry) <= {Group}` — ловит ЛЮБУЮ неожиданную авто-регистрацию (новый contrib-app/proxy вне `apps.*`), не только наши модели (edge LOW + blind MED).

### Deferred

- [x] [Review][Defer] Прод-security-hardening материализован монтированием `/admin/` [config/settings.py] — `DEBUG`-default-1 + `ALLOWED_HOSTS=["*"]` + нет `SecurityMiddleware` + нет `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` (`check --deploy`: W001/W009/W012/W016/W018). Пре-существующее, но `/admin/` (cookie-сессия) делает риск материальным. → E12 prod-hardening (ARCH#L319 «не блокирует первый релиз: закрытый LAN»). — deferred (prod-config)
- [x] [Review][Defer] STATIC_ROOT/collectstatic — admin-ассеты под не-DEBUG/прод [config/settings.py] — smoke `200` не проверяет рендер CSS/JS; под `DEBUG=False` без STATIC_ROOT+collectstatic+nginx-alias админка «голая». → E12 (ARCH#L335 «static — nginx alias»). — deferred (prod-static)

### Dismissed (3)

- Порядок middleware «неканоничен» (blind MED): ложно — `Session→Common→Csrf→Auth→Message→XFrame` = дефолт Django `startproject` (Common ДО Csrf — штатно); `manage.py check` → 0 issues. `SecurityMiddleware` отсутствует by-design (→ E12).
- `create_superuser("admin","pw")` хрупок / «pw станет email» (blind HIGH): опровергнуто — кастомный менеджер `(username, password=None, **extra)` из 2.8 (нет email-арга); позиционные корректны (Auditor+Edge подтвердили). kwargs всё равно применены в P1 для читаемости.
- «smoke слеп к DEBUG=False, убрать формулировку» (edge LOW): pytest-django форсит `DEBUG=False` — все тесты и так под ним; Edge отдельно проверил admin под настоящим `DEBUG=False` → 200. Комментарий «под DEBUG/runserver» точен (runserver-дев). Чинить нечего.
