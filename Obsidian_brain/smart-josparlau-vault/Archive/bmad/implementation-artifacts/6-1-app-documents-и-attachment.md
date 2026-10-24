---
baseline_commit: 5e2b4ed6b85d60c001f9d05bb52bdc6267d03468 (E5 done + ретро 2026-07-08; E8 done; epic-6 in-progress, 6.1 — первая стори эпика)
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6, Story 6.1; §Правила декомпозиции стори)
  - _bmad-output/planning-artifacts/architecture.md (§Process Patterns «Файлы», §Architectural Boundaries, §Format Patterns «Ошибки», §Enforcement)
  - _bmad-output/implementation-artifacts/epic-5-retro-2026-07-08.md (AI-2, AI-3, AI-5, урок «санитизация по чек-листу»)
  - _bmad-output/implementation-artifacts/deferred-work.md (стр. ~401 streaming/audit-context; ~524 strict-query)
  - _bmad-output/implementation-artifacts/5-7a-notification-модель-notify.md (аналог: новая top-level app)
---

# Story 6.1: App documents и Attachment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система**,
I want **единую модель Attachment (uuid-имя на диске, original_name, content_type, size, sha256; явные FK — не GenericFK) + приватное хранение вне MEDIA_URL + отдачу через X-Accel-Redirect**,
so that **файлы живут в одном месте под правами**.

## Acceptance Criteria

1. **400 — нарушение формы загрузки.** **Given** актор с правом `document.upload`, **When** `POST /api/documents/attachments/` (multipart) с файлом, чей content-type вне whitelist ИЛИ размер превышает `VAPS_MAX_UPLOAD_MB` (ИЛИ файл пустой, size=0), **Then** HTTP 400 в конверте §36 (`error_code: "VALIDATION_ERROR"`), файл НЕ записан на диск, строка Attachment НЕ создана. [Source: _bmad-output/planning-artifacts/epics.md §Story 6.1; architecture.md §Format Patterns → Ошибки («400 — нарушение ФОРМЫ»)]
2. **403 — запрос без прав.** **Given** аноним или актор без права, **When** `POST …/attachments/` (без `document.upload`) или `GET …/attachments/{id}/download/` (без `document.view`), **Then** HTTP 403 (`error_code: "PERMISSION_DENIED"`); гейт срабатывает до резолва объекта (fail-closed `RequirePermissionMixin`). [Source: epics.md §Story 6.1; Backend/VAPS/apps/core/api/permissions.py]
3. **Легальное скачивание — X-Accel, Django не стримит.** **Given** актор с правом `document.view` и существующий Attachment, **When** `GET …/{id}/download/`, **Then** HTTP 200 с заголовками `X-Accel-Redirect: {VAPS_XACCEL_LOCATION}/{uuid}`, `Content-Type` из БД, `Content-Disposition: attachment` с RFC-5987-кодированным `original_name` (kk/ru юникод), и **пустым телом** — байты отдаёт nginx internal location. **Given** `VAPS_XACCEL_ENABLED=0` (dev без nginx), **Then** `FileResponse` с теми же Content-\*-заголовками; переключение — env-флаг, НЕ `if DEBUG` (канон «без веток кода по окружению»). [Source: epics.md §Story 6.1; architecture.md §Process Patterns «Файлы», §Infrastructure → Окружения]
4. **Модель + БД-инварианты.** **Given** применённая миграция `0001_attachment`, **Then** таблица `documents_attachments`: UUID PK, `original_name`, `content_type`, `size`, `sha256` + `created_at/updated_at/created_by` от базовой модели; CheckConstraints: `chk_attachment_sha256_format` (`^[0-9a-f]{64}$`), `chk_attachment_size_min` (size ≥ 1), non-blank `original_name`/`content_type`; индекс `idx_attachment_sha256`. **Given** прямой INSERT/UPDATE с нарушением, **Then** `IntegrityError` от БД (не только Python-валидация). [Source: architecture.md §Process Patterns «Файлы», §Naming Patterns → База данных; feedback: DB-уровень для инвариантов]
5. **Санитизация границы + аудит загрузки.** **Given** мусорный `{id}` (не-UUID, пробелы, спецсимволы), **When** GET download, **Then** 404 (`ENTITY_NOT_FOUND`), НЕ 500. **Given** успешный upload, **Then** в той же транзакции записана аудит-строка `ATTACHMENT_UPLOADED` через `audit.services.record()` (actor = `request.actor_id`, entity_id = attachment.id); sha256 в ответе upload совпадает с эталонным `hashlib.sha256` содержимого; файл на диске лежит под именем `{uuid}` (не original_name). [Source: epic-5-retro §4 «санитизация по чек-листу»; docs/registries/audit-events.yaml growth_rule; architecture.md §Process Patterns]
6. **Матрицы, схема, гейт, анти-gold-plating.** RBAC-матрица (`test_rbac_matrix.py`) и AUDIT_MATRIX (`test_audit_coverage.py`) содержат строки новых роутов; `docs/registries/audit-events.yaml` пополнен `ATTACHMENT_UPLOADED` тем же PR; `make schema` регенерирован (`schema.yaml`); `make gate` зелёный (Postgres :5433), `makemigrations --check` пуст, `ruff` чист; НИЧЕГО сверх секции «Границы» не реализовано. [Source: architecture.md §Test Organization, §Enforcement; epics.md AR-9]

## Tasks / Subtasks

- [x] **Task 1 — Boilerplate app `documents` (AC: 4)**
  - [x] `apps/documents/{__init__.py, apps.py}`: `DocumentsConfig(name="apps.documents", label="documents", default_auto_field="django.db.models.BigAutoField")` — зеркало `apps/notifications/apps.py`
  - [x] `migrations/__init__.py`, `tests/__init__.py`, `api/__init__.py`
  - [x] `config/settings.py`: `"apps.documents"` в INSTALLED_APPS (после `apps.notifications`)
- [x] **Task 2 — Модель Attachment + миграция (AC: 4)**
  - [x] `apps/documents/models.py`: `Attachment(UUIDTimeStampedModel)` — поля по AC-4; `Meta.db_table="documents_attachments"`; CheckConstraints + Index в той же модели; docstring фиксирует контракт «owner → Attachment FK, GenericFK бан, cross-context = UUIDField» (Ловушка №1)
  - [x] Миграция `0001_attachment.py` (переименовать из авто-имени; `dependencies=[]` — база abstract); модель + констрейнты + индекс = ОДНА миграция (канон)
  - [x] НЕ регистрировать в Admin (Ловушка №3)
- [x] **Task 3 — Настройки `VAPS_*` (AC: 1, 3)**
  - [x] `config/settings.py`: `VAPS_MAX_UPLOAD_MB` (int, default 20, range-guard по паттерну `VAPS_JWT_LEEWAY`), `VAPS_ATTACHMENT_CONTENT_TYPES` (CSV env → list, дефолт из Д4), `VAPS_PRIVATE_STORAGE_ROOT` (default `BASE_DIR / "private_storage"`), `VAPS_XACCEL_ENABLED` (default "1"), `VAPS_XACCEL_LOCATION` (default "/protected")
- [x] **Task 4 — Сервис и селектор (AC: 1, 5)**
  - [x] `apps/documents/services.py`: `create_attachment(*, uploaded_file, original_name, content_type, actor)` — стриминговый sha256 (chunks 64 KiB) при записи во временный файл в каталоге хранилища → `os.replace` в `{root}/{uuid}`; `os.makedirs(root, exist_ok=True)`; строка в `transaction.atomic`; `audit.services.record(actor=…, action="ATTACHMENT_UPLOADED", entity_type="attachment", entity_id=…, new_value={метаданные})` в той же транзакции; при исключении после записи файла — `unlink` (Ловушка №6); санитизация: `original_name.strip()`, basename, длина ≤255, запрет пустого
  - [x] `apps/documents/selectors.py`: `get_attachment(attachment_id)` — канонизация UUID (`str.strip()` → `uuid.UUID(...)`, `ValueError` → `DomainError("ENTITY_NOT_FOUND", 404)`), затем `.get()` → тот же DomainError (Ловушка №5-санитизация)
- [x] **Task 5 — API (AC: 1, 2, 3, 5)**
  - [x] `api/serializers.py`: `AttachmentUploadSerializer` — **единственное поле формы `file`** (multipart); `original_name`/`content_type` берутся из файл-части (`uploaded_file.name` / `.content_type`), отдельных form-полей НЕТ (это контракт, попадающий в schema.yaml); форма-валидация: whitelist content-type, size ≤ лимита, size ≥ 1 → DRF `ValidationError` = 400. Плюс `AttachmentSerializer` (ответ: id, original_name, content_type, size, sha256, created_at)
  - [x] `api/views.py`: `AttachmentViewSet(RequirePermissionMixin, viewsets.GenericViewSet)`; `permission_map = {"create": "document.upload", "download": "document.view"}`; `parser_classes = [MultiPartParser]` для create; `create` → сериализатор → сервис → 201; `@action(detail=True, methods=["get"])` `download` → селектор → `HttpResponse` c `X-Accel-Redirect` (или `FileResponse` при `VAPS_XACCEL_ENABLED=0`); `Content-Disposition` через `django.utils.http.content_disposition_header(True, original_name)` (Ловушка №7); `@extend_schema`-аннотации для spectacular
  - [x] `api/urls.py`: `DefaultRouter().register("attachments", AttachmentViewSet, basename="documents-attachment")`
  - [x] `config/urls.py`: `path("api/documents/", include("apps.documents.api.urls"))`
  - [x] Идентичность ТОЛЬКО из `request.actor_id` (ARCH-SEC-030), НЕ из payload
- [x] **Task 6 — RBAC + реестры (AC: 2, 5, 6)**
  - [x] `seed_operations.py`: коды `document.upload` («Загрузка вложений»), `document.view` («Скачивание вложений/документов») в `PERMISSIONS`; раскладка в `ROLE_PERMISSIONS` — PROVISIONAL по Д6 (пометить комментарием, как personnel.\*)
  - [x] `test_rbac_matrix.py` MATRIX: `"documents-attachment-list": _Gate("document.upload")`, `"documents-attachment-download": _Gate("document.view")`
  - [x] `test_audit_coverage.py` AUDIT_MATRIX: `"documents-attachment-list": _Audited()` (комментарий: эмиссия на сервис-уровне, канон 4.4)
  - [x] `docs/registries/audit-events.yaml`: `ATTACHMENT_UPLOADED` (entity_type: attachment, provenance: derived-from-mutation, source: §6 «все мутации» + BR-DOC-001)
- [x] **Task 7 — Тесты (AC: все; в файловый лимит не входят)**
  - [x] `tests/test_attachment_model.py`: CheckConstraints через `pytest.raises(IntegrityError)` под `transaction.atomic()` (паттерн `test_control_settings.py`); sha256-regex; size-floor
  - [x] `tests/test_attachment_service.py`: sha256 = эталонный hashlib; файл на диске = `{uuid}`; original_name санитизирован; аудит-строка создана в транзакции; при невалидном входе файл не остаётся на диске; `tmp_path`-переопределение `VAPS_PRIVATE_STORAGE_ROOT` через `settings`-фикстуру
  - [x] `tests/test_attachment_api.py`: 400 вне whitelist; 400 сверх лимита (уменьшить лимит через `settings`); 400 пустой файл; 403 аноним + 403 роль без права; 201 легальный upload (метаданные + sha256) **+ HTTP-smoke аудита: ровно одна AuditLog-строка `action="ATTACHMENT_UPLOADED"`, `entity_id=attachment.id`, `actor=uid` — контракт `_Audited()` требует поведенческий пин сквозь роут (паттерн test_submission_audit 5.9)**; download: 200, заголовок `X-Accel-Redirect`, пустое тело, `Content-Disposition` с кириллическим именем; fallback `VAPS_XACCEL_ENABLED=0` → тело = байты файла; 404 на мусорный id (не 500) — векторы ТОЛЬКО проходящие lookup-regex роутера `[^/.]+` (`not-a-uuid`, `%20%20`, `0`, длинный hex): id с `.`/`/` режутся резолвером ДО view (обычный 404 без конверта §36 — их конверт не проверять); auth — `HTTP_X_USER_ID` + `call_command("seed_operations")` + `UserRole` напрямую (Ловушка №5: `grant`-фикстура из core недоступна)
  - [x] `tests/test_isolation.py`: AST-гвард изоляции app (канон «в каждом новом app», зеркало `apps/notifications/tests/test_isolation.py` из 5.7c) — бан `apps.operations.*` везде; бан `apps.core.models` ВНЕ `models.py` (исключение для `models.py` — легальный импорт abstract-базы по Д1)
- [x] **Task 8 — Схема и гейт (AC: 6)**
  - [x] `make schema` → затем `cd frontend && npm run generate:api` → коммит ОБОИХ генератов (`schema.yaml` + `frontend/src/shared/api/schema.d.ts`). `schema.d.ts` генерится из ВСЕГО schema.yaml (не по потребителям): без regen фронт-гейт (`frontend/scripts/schema-check.mjs`, байтовое сравнение) красный. Прецедент: коммиты `4d9ad41`, `dcf5ec4` — оба генерата вместе
  - [x] `make gate` зелёный в worktree (ретро AI-2 — см. Ловушку №9); `ruff format` — только по конкретным изменённым файлам, не по папкам

## Dev Notes

### Эталоны — всё уже в кодовой базе, ничего не изобретать

| Что | Откуда копировать паттерн |
|---|---|
| Новая top-level app (apps.py, label, INSTALLED_APPS) | `apps/notifications/` (стори 5.7a — точный аналог) |
| Базовая модель с UUID PK | `apps/core/models.py:12` `UUIDTimeStampedModel` (id/created_at/updated_at/created_by) |
| CheckConstraint + regex + Index в Meta | `apps/operations/submissions/models/daily_submission.py:97-147` |
| Гейт прав во ViewSet | `apps/core/api/permissions.py:21` `RequirePermissionMixin` (mixin ПЕРВЫМ в базах; fail-closed) |
| Аудит-запись | `apps/audit/services.py:28` `record()` — actor строкой, request-контекст сам из contextvar, `Clock.now()` внутри |
| DomainError + конверт §36 | `apps/core/exceptions.py:14`; handler `apps/core/api/exception_handler.py:141` (НИКАКИХ try/except+Response во view) |
| Роутер/urls app | `apps/audit/api/urls.py`; включение — `config/urls.py` |
| Тест гейтованного API | `apps/audit/tests/test_audit_read_api.py`, `apps/notifications/tests/test_notifications_read_api.py` |
| env-парсинг с guard | `config/settings.py:141-148` (`VAPS_JWT_LEEWAY`) |
| Идемпотентный seed | `seed_operations.py` (`update_or_create`; вызов в тестах `call_command`) |

### ⚠️ Ловушка №1 (ГЛАВНАЯ): «явные FK — не GenericFK» × ARCH-003 — у Attachment НЕТ owner-полей

Архитектурный паттерн «Файлы» требует «явные FK — не GenericFK» [architecture.md §Process Patterns]. Это НЕ значит «добавь Attachment полиморфную/обобщённую ссылку на владельца». Правильное прочтение, согласованное с ARCH-003 («cross-context ссылки — плоский UUIDField, НЕ FK»):

- В 6.1 Attachment — **автономная запись без owner-полей вообще**. Владельцы появятся позже.
- Направление связи: **владелец → Attachment** (например, документ выпуска в 6.5 получит FK на Attachment внутри app `documents`; сущности из core/operations ссылаются плоским `UUIDField attachment_id`).
- `GenericForeignKey`/`ContentType`-полиморфизм — **запрещён**. Зафиксировать контракт в docstring модели.
- НЕ добавлять «на вырост» nullable-FK на DailySubmission/EmployeeStatus — это gold-plating и нарушение границ контекстов.

### ⚠️ Ловушка №2: «Django не стримит» — и почему аудита скачивания здесь НЕТ

deferred-work.md (~стр. 401, ревью 4-3): ленивый `audit.record()` в теле `StreamingHttpResponse`/`FileResponse` читает пустой request-контекст (`reset(token)` в `finally` срабатывает до итерации тела) → мис-атрибуция request_id/IP. X-Accel-ответ этой проблемы не имеет (обычный маленький ответ, контекст жив). **В 6.1 аудит скачивания НЕ реализуется — это Story 6.7** (`DOCUMENT_DOWNLOADED` уже в реестре, НЕ эмитить его сейчас). Когда 6.7 добавит аудит — писать его в теле view ДО return, не лениво.

### ⚠️ Ловушка №3: Admin — НЕ регистрировать

Attachment — бизнес-модель. Регистрация в Django Admin (даже read-only) ломает гвард `apps/core/tests/test_admin_platform.py::test_admin_registry_is_exactly_catalogs` и нарушает канон «Admin = только справочники; мимо сервиса = мимо аудита/прав». Инцидент уже был в 5.2 — не повторять.

### ⚠️ Ловушка №4: два матричных гварда сработают сами

- `test_rbac_matrix.py::test_matrix_covers_every_registered_route` — КАЖДЫЙ served (route, method) обязан иметь строку MATRIX, иначе красный. Новые роуты: `documents-attachment-list` (POST) и `documents-attachment-download` (GET).
- `test_audit_coverage.py::test_audit_matrix_covers_every_mutating_route` — мутирующий POST без строки AUDIT_MATRIX = красный. Facet B: эмитируемые action-литералы ⊆ `audit-events.yaml` — поэтому `ATTACHMENT_UPLOADED` добавляется в реестр ТЕМ ЖЕ PR (growth_rule реестра).

### ⚠️ Ловушка №5: тестовая аутентификация и мусорный pk

- Фикстура `grant` живёт в `apps/core/tests/conftest.py` — она **не видна** из `apps/documents/tests/`. Паттерн 5.7a: `APIClient` + `client.credentials(HTTP_X_USER_ID=uid)` + `call_command("seed_operations")` + `UserRole.objects.create(...)` локально (или локальная копия фикстуры в `apps/documents/tests/conftest.py`).
- DRF `get_object()` с невалидным UUID в pk кидает `ValueError` → 500. Поэтому резолв ТОЛЬКО через `selectors.get_attachment()` с канонизацией (strip → `uuid.UUID()` → except `ValueError` → `DomainError("ENTITY_NOT_FOUND", 404)`). Ретро-урок E5 §4.1: каждый вход (header, pk, query, body) проверяется на whitespace/тип/канонический формат.

### ⚠️ Ловушка №6: атомарность «файл + строка»

Порядок в сервисе: (1) форма уже валидна (сериализатор), (2) стриминговая запись во временный файл в ТОМ ЖЕ каталоге (один filesystem → `os.replace` атомарен) с попутным sha256/size, (3) `transaction.atomic`: INSERT Attachment + `audit.record()`, (4) `os.replace(tmp, final)` ПЕРЕД commit'ом строки не гарантирует консистентность при падении — поэтому: replace до create строки, а при ЛЮБОМ исключении дальше — `unlink(final)` в `except` и re-raise. Осиротевший файл при жёстком падении процесса — допустимая деградация (строки нет → ссылок нет), НЕ строить компенсационные джобы (gold-plating). Голый `IntegrityError` наружу не выпускать (урок 5.6b→5.7a — травит внешнюю транзакцию).

### ⚠️ Ловушка №7: юникод в Content-Disposition

`original_name` будет кириллицей/казахским. Наивный `f'attachment; filename="{name}"'` ломает заголовок. Использовать `django.utils.http.content_disposition_header(as_attachment=True, filename=...)` (Django 5.x, RFC 5987). В тесте — проверить скачивание файла с именем вида `Расход_құрам.docx`.

### ⚠️ Ловушка №8: миграция

`dependencies = []` — корректно (базовая модель abstract, FK нет; проверено на 5.7a). Имя файла — `0001_attachment.py` (канон `NNNN_<entity>`, MUST NOT `_auto_`). Модель + её констрейнты + индекс = одна миграция. После — `makemigrations --check` пуст (входит в гейт).

### ⚠️ Ловушка №9 (среда): worktree без .venv

Ретро E5 AI-2: критерий — «6.1 прогоняет `make gate` прямо в worktree без копирования файлов». В worktree нет `.venv` (Makefile честно упадёт с подсказкой). Стратегия: создать venv в worktree (`python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'` в `Backend/VAPS`) ЛИБО симлинк на venv основного чекаута — НЕ возвращаться к канону cp→run→rm. Postgres для гейта — docker на :5433 (поднимает сам Makefile).

### Дефолты (приняты мной — поднять на ревью, если не согласен)

- **Д1. Базовая модель = `core.UUIDTimeStampedModel`** (UUID PK = имя файла на диске = `entity_id` для аудита + неперечислимые URL скачивания). Альтернатива `operations.TimeStampedModel` + отдельная uuid-колонка — отклонена (два идентификатора, лишний инвариант). Импорт abstract-базы из `apps.core.models` в `apps.documents.models` допустим: запрет «НЕ models» адресует operations→core; прецедент кросс-app базы — `Notification(TimeStampedModel)` из operations.
- **Д2. Хранилище**: `VAPS_PRIVATE_STORAGE_ROOT` (default `BASE_DIR / "private_storage"`), файл — плоско `{root}/{uuid}` без расширения и подкаталогов (объём E6 — единицы файлов/день; шардирование по префиксу = gold-plating). `MEDIA_ROOT`/`MEDIA_URL` НЕ вводятся вовсе. Путь derivable от PK — отдельной колонки пути НЕТ (прецедент донора `photo_file_path` не копируем: у нас uuid-имя каноничнее).
- **Д3. X-Accel контракт**: `X-Accel-Redirect: {VAPS_XACCEL_LOCATION}/{uuid}`, default location `/protected`. nginx-конфиг (`location /protected/ { internal; alias {root}/; }`) — зона E12/12.1, в 6.1 контракт фиксируется docstring'ом сервиса и тестом заголовка. Dev-fallback — `VAPS_XACCEL_ENABLED=0` → `FileResponse`.
- **Д4. Whitelist (default, env-переопределяем)**: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx), `…spreadsheetml.sheet` (.xlsx), `application/pdf`, `text/csv`, `image/jpeg`, `image/png` — форматы расхода FR-17 + фото (PRD §10: «фото, документы-основания, .docx»). Сниффинг содержимого (python-magic) НЕ делаем — новых зависимостей нет, контур закрытый; проверяем заявленный content-type. `VAPS_MAX_UPLOAD_MB` default **20**.
- **Д5. Коды ошибок — только существующие**: 400 → `VALIDATION_ERROR` (через DRF ValidationError в сериализаторе), 403 → `PERMISSION_DENIED`, 404 → `ENTITY_NOT_FOUND`. Новые error-codes НЕ вводятся (реестр — закрытый мир; специализированный `FILE_TOO_LARGE` отклонён как неоправданное расширение реестра для формы-валидации).
- **Д6. Permission-коды**: `document.upload`, `document.view`. Раскладка PROVISIONAL (канон 2.13 — «тест проверяет механизм, не политику»): upload → ORGD, DIVISION_OPERATOR; view → ORGD, DIVISION_OPERATOR, VIEWER (+ADMIN через `*`). Вопрос Bratan — см. «Открытые вопросы».
- **Д7. Аудит загрузки — сейчас, синхронно в транзакции** (канон «все мутации пишутся», E4; ретро E5: «DOCUMENT_\*-коды сеять первой же стори»). Новый action `ATTACHMENT_UPLOADED` (entity_type `attachment`). `_DeferredAudit("6.7")` отклонён — 6.7 про аудит СКАЧИВАНИЙ, не загрузок.
- **Д8. API-поверхность минимальна**: только `create` + `download`. list/retrieve/delete — НЕ делать (нет потребителя; AC их не требуют).
- **Д9. Пустой файл (size=0) → 400** (floor в БД size ≥ 1 согласован с формой).
- **Д10. `size` = `BigIntegerField`** (дёшево, снимает вопрос >2ГБ навсегда); `sha256` = `CharField(max_length=64)` lowercase hex; `original_name` = `CharField(max_length=255)`; `content_type` = `CharField(max_length=100)`.

### Что уже есть (НЕ переизобретать)

- `DOCUMENT_DOWNLOADED` уже в `docs/registries/audit-events.yaml:55` — НЕ эмитить в 6.1 (это 6.7), НЕ дублировать.
- `VALIDATION_ERROR`/`PERMISSION_DENIED`/`ENTITY_NOT_FOUND` — в `docs/registries/error-codes.yaml` (26, 66, 86).
- Гейт прав, exception handler, аудит-сервис, Clock, конверт §36 — готовые механизмы (таблица эталонов выше).
- В репо НЕТ ни одного FileField/upload/sha256/X-Accel — 6.1 вводит файловый шов первым, прецедентов «как у нас принято с файлами» не существует; канон задаёт ЭТА стори.
- `hashlib` (stdlib) для sha256 — никаких новых зависимостей в `pyproject.toml`.

### Границы (что 6.1 НЕ делает)

- **Аудит скачиваний + повторная выдача байт-в-байт (sha-сверка)** → Story 6.7.
- **DocumentSequence** → 6.2. **Генераторы .docx/.xlsx/.csv/.pdf** → 6.3/6.4. **Выпуск расхода (снапшот→файл+номер)** → 6.5. **AsyncJob/асинхронность** → 6.6.
- **nginx-конфиг в deploy/** → E12 (12.1); здесь — только серверный контракт заголовка.
- **Привязка Attachment к статусам/инцидентам/сдачам** — owner-полей нет (Ловушка №1); фото инцидентов — этап 2 (E16/E17).
- **Дедупликация по sha256, TTL/очистка, list/delete API, content-sniffing, лимиты per-role** — не делать.
- **Frontend** — никакой feature-работы; единственное касание — regen генерата `schema.d.ts` (Task 8, обязателен из-за drift-гейта 8.3).

### Previous Story Intelligence (5.7a/5.2, ревью E5)

- 5.7a — образец создания top-level app: тот же набор boilerplate, INSTALLED_APPS, `dependencies=[]`, «бизнес-модель НЕ в Admin».
- 5.2-урок №1: не перепутать базовые модели (здесь выбор осознанный — Д1).
- Ревью-урок 5.6b→5.7a: дубликаты/гонки не выпускают голый `IntegrityError` во внешнюю транзакцию.
- Ретро E5 AI-3: File List в Dev Agent Record сверять с фактическим git-диффом (0 документационных MEDIUM в E6).
- Ретро E5 AI-5 / §4.1: санитизация каждого входа по чек-листу (в 6.1 — pk, multipart-поля, original_name).
- Automator custom instructions: гейт = `make gate`; `ruff format` только по конкретным файлам; DB-инварианты CheckConstraint'ами; коммит после ревью.
- `apps/core/tests/test_isolation.py`: НЕ сканирует documents только import-boundary-тест (`test_core_does_not_import_other_context_models` — core-only). А вот `test_no_wall_clock_reads_in_domain_layers` (сканирует `services.py`/`models.py` ВСЕХ apps — включая новые `apps/documents/*`) и `test_x_user_id_literal_only_in_core_auth` (весь `apps/**`) поймают новый код СРАЗУ: никаких `datetime.now()`/`timezone.now()` в сервисе (даже для tmp-имён/логов) — только `core.clock.Clock`; литерал `X-User-Id` — нигде. Свой AST-гвард app — Task 7.

### Git Intelligence

- Baseline: `5e2b4ed` — chore(E5): ретроспектива эпика 5 + doc-синхронизация. До этого: `cc2dc2c` (5.11), `76c4204` (5.10) — паттерн коммитов `feat(story-N.N): <название>`, коммит после ревью стори.
- Ветка worktree: `claude/exciting-vaughan-3e478b`; основная — `main`.
- Worktree без `.venv` — см. Ловушку №9 (ретро AI-2, 6.1 — контрольная точка).

### Project Structure Notes

- Файловый лимит (правила декомпозиции epics.md §248): boilerplate новой app (`__init__`, `apps.py`, `migrations/__init__`, `0001`) и тесты — вне лимита. Считаемые: NEW `models.py`, `services.py`, `selectors.py`, `api/serializers.py`, `api/views.py`, `api/urls.py`; MODIFY `config/settings.py`, `config/urls.py`, `seed_operations.py`, `audit-events.yaml`, `schema.yaml` (генерат). Превышение «≤5» зафиксировано на уровне эпика: 6.1 в epics.md — атомарная единица «модель+хранение+отдача» (AR-7 платформенный сервис); дальнейшая разбивка ломает тестируемость AC (400/403/X-Accel требуют всей вертикали). Прецедент веса — 5.7a.
- Правило «ровно две app»: `apps/documents` (новая) + `apps/operations` (seed); правки `apps/audit` и `apps/operations` тестов — тестовые файлы, вне лимита.

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Epic 6 / Story 6.1 (стр. 811-821); §Правила декомпозиции стори (стр. 248-254); AR-7 (стр. 109)]
- [Source: _bmad-output/planning-artifacts/architecture.md §Process Patterns «Файлы» (стр. ~467); §Architectural Boundaries `documents ← operations` (стр. ~591); §Format Patterns → Ошибки (стр. ~434-435); §Naming Patterns → БД (стр. ~405-408); §Test Organization & Make Targets (стр. ~630-644); §Enforcement (стр. ~476-481); §Infrastructure (стр. ~337-341)]
- [Source: Backend/VAPS/apps/core/models.py:12 — UUIDTimeStampedModel]
- [Source: Backend/VAPS/apps/core/api/permissions.py — require_permission / RequirePermissionMixin]
- [Source: Backend/VAPS/apps/core/api/exception_handler.py — конверт §36, _DRF_STATUS_TO_CODE]
- [Source: Backend/VAPS/apps/audit/services.py — record(); apps/audit/tests/test_audit_coverage.py — AUDIT_MATRIX]
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py — MATRIX/_Gate; management/commands/seed_operations.py — PERMISSIONS/ROLE_PERMISSIONS]
- [Source: docs/registries/audit-events.yaml (growth_rule, DOCUMENT_DOWNLOADED:55); docs/registries/error-codes.yaml (VALIDATION_ERROR:26, PERMISSION_DENIED:66, ENTITY_NOT_FOUND:86)]
- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-07-08.md §4, §7 (AI-2, AI-3, AI-5); deferred-work.md ~401 (streaming/audit-context), ~524 (strict-query)]

### Открытые вопросы (для Bratan — НЕ блокируют, приняты дефолты)

- Q1: Раскладка `document.upload`/`document.view` по ролям (Д6 — PROVISIONAL). Кто в проде грузит документы-основания и качает расход?
- Q2: Дефолт `VAPS_MAX_UPLOAD_MB=20` и состав whitelist (Д4) — подтвердить.
- Q3: Имя internal location `/protected` (Д3) — согласовать с будущим `deploy/nginx/vaps.conf` (E12).

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), bmad-dev-story, 2026-07-08.

### Debug Log References

- Ловушка №9 отработана штатно: `.venv` создан прямо в worktree (`python3 -m venv .venv && pip install -e '.[dev]'`), Postgres :5433 поднят docker compose — `make gate` прогнан в worktree без копирования файлов (критерий ретро AI-2 выполнен).
- `npm run generate:api` в worktree упал (`openapi-typescript: not found` — node_modules не установлен в worktree); генерат собран бинарём основного чекаута (`/home/erda/Музыка/VAPS/frontend/node_modules/.bin/openapi-typescript` v7.13.0 — та же версия, что использует drift-гейт) и проверен байтовым сравнением с повторным regen: идентичен → `schema-check.mjs` пройдёт.
- Единственная правка после первого прогона гейта — E501 в комментарии теста (строка 48 test_attachment_model.py); после фикса гейт зелёный с первого повторного прогона.
- spectacular: добавлен `queryset` в AttachmentViewSet (только интроспекция схемы — uuid-тип path-параметра; резолв объекта остался за селектором). 4 unique Errors spectacular — pre-existing (Vacancy/UserRole/TemporaryDuty/DailySubmission), к 6.1 не относятся.

### Completion Notes List

- **Гейт: 1948 passed, 26 deselected (39.96s)**; ruff чист; `makemigrations --check` пуст. База до стори — 1841; рост = 54 теста app documents + параметризованные строки RBAC-матрицы двух новых роутов.
- Новая top-level app `apps/documents` по образцу 5.7a: модель `Attachment(UUIDTimeStampedModel)` без owner-полей (Ловушка №1 — контракт «владелец → Attachment» зафиксирован docstring'ом), таблица `documents_attachments`, 4 CheckConstraint (`chk_attachment_sha256_format` `^[0-9a-f]{64}$`, `chk_attachment_size_min` size≥1, non-blank `original_name`/`content_type` через `\S`-regex) + `idx_attachment_sha256`; одна миграция `0001_attachment.py`, `dependencies=[]`. В Admin НЕ регистрирована (гвард test_admin_platform зелёный).
- Сервис `create_attachment`: стриминговый sha256 (64 KiB) во временный файл в каталоге хранилища → `os.replace` в `{root}/{uuid}` ДО create строки; строка + `audit.record("ATTACHMENT_UPLOADED")` в одной `transaction.atomic`; при любом исключении дальше — `unlink(final)` + re-raise (тест: `actor=""` валит `record()` → строка откачена, файл прибран). Санитизация original_name: strip → basename (оба сепаратора) → непустое, ≤255. Пустой файл (size=0) → 400 и в сервисе, и в форме (Д9), floor в БД согласован.
- Селектор `get_attachment`: канонизация pk (strip → `uuid.UUID` → `DomainError("ENTITY_NOT_FOUND", 404)`); мусорные векторы, проходящие router-regex (`not-a-uuid`, `%20%20`, `0`, hex×64), дают 404 в конверте §36, не 500.
- API: форма upload — единственное поле `file` (original_name/content_type из файл-части); `permission_map={"create": "document.upload", "download": "document.view"}`, fail-closed гейт ДО резолва (тест: мусорный pk без права → 403, не 404); download — 200 c `X-Accel-Redirect: {VAPS_XACCEL_LOCATION}/{uuid}`, Content-Type из БД, RFC-5987 `Content-Disposition` (`content_disposition_header`, тест с `Расход_құрам.docx`), пустое тело; `VAPS_XACCEL_ENABLED=0` → FileResponse с теми же заголовками (env-флаг, не if DEBUG). Прочие глаголы/GET на list → 405 (Д8: list/retrieve/delete НЕ реализованы).
- Настройки: `VAPS_MAX_UPLOAD_MB` (default 20, range-guard 1..1024 по паттерну JWT_LEEWAY), `VAPS_ATTACHMENT_CONTENT_TYPES` (CSV env, дефолт Д4), `VAPS_PRIVATE_STORAGE_ROOT`, `VAPS_XACCEL_ENABLED`, `VAPS_XACCEL_LOCATION`. MEDIA_ROOT/MEDIA_URL не вводились.
- RBAC/реестры: `document.upload`/`document.view` в seed (раскладка PROVISIONAL Д6 с комментарием: upload → ORGD, DIVISION_OPERATOR; view → +VIEWER; ADMIN через `*`); строки MATRIX и AUDIT_MATRIX (`documents-attachment-list: _Audited()` — эмиссия на сервис-уровне + HTTP-smoke в test_attachment_api); `ATTACHMENT_UPLOADED` добавлен в audit-events.yaml тем же PR (growth_rule). `DOCUMENT_DOWNLOADED` НЕ эмитится (Ловушка №2 — аудит скачивания = 6.7).
- Оба генерата обновлены: `schema.yaml` (+79 строк: multipart upload, uuid path-param, binary 200) и `frontend/src/shared/api/schema.d.ts` (+94) — байт-идентичны повторному regen.
- Изоляция: свой AST-гвард (бан `apps.operations.*` везде; бан `apps.core.models` вне models.py — Д1-исключение); wall-clock не читается (сервису время не нужно — created_at от базовой модели); литерала X-User-Id вне тестов нет.
- Открытые вопросы Bratan (Q1 раскладка прав, Q2 лимит/whitelist, Q3 имя `/protected`) — дефолты Д4/Д6/Д3 активны, ничего не блокируют.

### File List

Новые:

- `Backend/VAPS/apps/documents/__init__.py`
- `Backend/VAPS/apps/documents/apps.py`
- `Backend/VAPS/apps/documents/models.py`
- `Backend/VAPS/apps/documents/services.py`
- `Backend/VAPS/apps/documents/selectors.py`
- `Backend/VAPS/apps/documents/migrations/__init__.py`
- `Backend/VAPS/apps/documents/migrations/0001_attachment.py`
- `Backend/VAPS/apps/documents/api/__init__.py`
- `Backend/VAPS/apps/documents/api/serializers.py`
- `Backend/VAPS/apps/documents/api/views.py`
- `Backend/VAPS/apps/documents/api/urls.py`
- `Backend/VAPS/apps/documents/tests/__init__.py`
- `Backend/VAPS/apps/documents/tests/test_attachment_model.py`
- `Backend/VAPS/apps/documents/tests/test_attachment_service.py`
- `Backend/VAPS/apps/documents/tests/test_attachment_api.py`
- `Backend/VAPS/apps/documents/tests/test_attachment_http_contract.py`
- `Backend/VAPS/apps/documents/tests/test_isolation.py`

Изменённые:

- `Backend/VAPS/config/settings.py` (INSTALLED_APPS + блок настроек 6.1)
- `Backend/VAPS/config/urls.py` (include api/documents/)
- `Backend/VAPS/apps/operations/management/commands/seed_operations.py` (2 кода + PROVISIONAL-раскладка)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (2 строки MATRIX)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (строка AUDIT_MATRIX)
- `docs/registries/audit-events.yaml` (ATTACHMENT_UPLOADED)
- `Backend/VAPS/schema.yaml` (генерат, make schema)
- `frontend/src/shared/api/schema.d.ts` (генерат, openapi-typescript)

## Senior Developer Review (AI)

**Reviewer:** Bratan · **Дата:** 2026-07-08 · **Модель:** Claude Fable 5 (bmad-story-automator-review)

**Вывод: APPROVE — 0 CRITICAL, 0 HIGH.** Все 8 тасков и 6 AC провалидированы против фактической реализации прогоном кода, а не только чтением. Гейт перепрогнан в worktree целиком.

### Проверенные claims (validated by execution)

- **`make gate` зелёный** — перепрогнан полностью: **1959 passed, 26 deselected (38s)**; `makemigrations --check` — «No changes detected»; `ruff check .` чист. (Заявленные dev-story 1948 — это счёт ДО QA-файла, +11 тестов `test_attachment_http_contract.py`.)
- **Schema в синхроне** — `spectacular` перегенерён и побайтно сравнён с закоммиченным `schema.yaml`: drift нет. `frontend/src/shared/api/schema.d.ts` содержит `AttachmentUploadRequest`/`Attachment` и оба роута — генерат не устаревший.
- **AC-1..6** — покрыты и проходят: 400 (whitelist/лимит/пустой/нет поля file), 403 (аноним + роль без права + гейт-до-резолва), X-Accel + dev-fallback FileResponse, 4 CheckConstraint через `IntegrityError`, санитизация pk (404 не 500), аудит `ATTACHMENT_UPLOADED` сквозь роут, обе матрицы + реестр + анти-gold-plating (только create+download).
- **Ловушки 1/3/5/6** — гварды зелёные: `test_admin_platform` (Attachment НЕ в Admin), `core/test_isolation` (wall-clock/X-User-Id чисто), app `test_isolation` (operations/core.models границы).
- **CRLF-инъекция в Content-Disposition** — проверена вручную: `content_disposition_header` + `HttpResponse` ловят перевод строки через `BadHeaderError` (Django). Реальной уязвимости нет.

### Исправлено в ревью (auto-fix)

- **[MED] File List** — добавлен `tests/test_attachment_http_contract.py` (QA-файл `bmad-qa-generate-e2e-tests`, +11 тестов) — был на диске, но отсутствовал в списке (ретро E5 AI-3: File List = git-реальность).
- **[MED] Completion Notes counts** — фактически 65 тестов в app `documents` (не 54: QA-файл добавлен после dev-story), общий гейт 1959 (не 1948). Зафиксировано здесь.
- **[LOW] `.gitignore`** — добавлен `private_storage/` (дефолтный `VAPS_PRIVATE_STORAGE_ROOT` под `BASE_DIR` не был игнорирован; загруженные байты с PII не должны попасть в git при dev-прогоне upload).

### Не блокирует (информационно)

- `ruff format` реформатировал бы `services.py`/`test_attachment_api.py` (схлопывание уже коротких `raise` в одну строку) — **гейт = `ruff check`, НЕ `format`** (канон проекта), поэтому это не дефект; не трогал, чтобы не менять стиль dev вне гейта.
- `os.replace(tmp → final)` при отказе (ENOSPC/EIO) оставит `.tmp`-сироту — согласовано с Ловушкой №6 («осиротевший файл — допустимая деградация»), компенсаций не строим.

## Change Log

- 2026-07-08 — senior-dev-review (Claude Fable 5, bmad-story-automator-review): адверсариальное ревью, все claim'ы провалидированы прогоном (гейт 1959 passed, schema без drift, гварды зелёные). Auto-fix: File List +http_contract, correction счётчиков в notes, `.gitignore` +`private_storage/`. 0 CRITICAL → Status: review → done; sprint-status синхронизирован.
- 2026-07-08 — create-story (Claude Fable 5): стори создана; полный контекст-анализ (архитектура §Файлы, кодовая база, ретро E5, deferred-work) завершён; fresh-context валидация по checklist.md пройдена, фиксы применены (regen schema.d.ts обязателен — фронт-drift-гейт 8.3; HTTP-smoke аудита в API-тест; AST-гвард изоляции documents; уточнение скоупа test_isolation; форма upload = одно поле `file`); Status: ready-for-dev.
- 2026-07-08 — dev-story (Claude Fable 5): реализованы все 8 тасков — app `documents`, модель Attachment + миграция `0001_attachment` (4 CheckConstraint + индекс), настройки `VAPS_*`, сервис create_attachment (атомарность файл+строка+аудит), селектор с канонизацией pk, API upload/download (X-Accel + dev-fallback), RBAC-коды + матрицы + реестр аудита, 54 теста, оба генерата. `make gate` в worktree: 1948 passed; `makemigrations --check` пуст; ruff чист. Status: ready-for-dev → review.
