---
baseline_commit: c5779d9 ("2.8 story"; HEAD на main; E1 1.1–1.10/1.12 done, 1.11 review; E2 done 14/14; рабочее дерево чистое). 1.11-review-хвост (прод-выгрузка донора за Bratan) к 3.1 отношения не имеет — в File List не включать.
---

# Story 3.1: DomainError и единый exception_handler

Status: done

<!-- ЭТО ПЛАТФОРМЕННАЯ КОДОВАЯ СТОРИ (AR-7, фундамент Epic 3). Продукт — единая точка формирования
     ошибок: класс DomainError + единый DRF exception_handler. Все последующие стори (3.3 валидации,
     3.4 конфликт-детектор, 3.6 lifecycle, 3.8 bulk, 3.14 смоук) ОПИРАЮТСЯ на него, а не переизобретают
     маппинг статус→HTTP. «Реализовать протокол ошибок ОДИН раз». -->
<!-- ЗАКРЫТЫЙ МИР: каждый код, который эмитит handler, ОБЯЗАН существовать в docs/registries/error-codes.yaml
     (построен стори 1.12). Кода нет в реестре → СТОП и спроси, не выдумывай (architecture.md:33-35, 398). -->
<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a разработчик,
I want `core.exceptions.DomainError(code, http_status, detail, overridable)` + единый DRF `exception_handler` с маппингом `IntegrityError` по ИМЕНИ constraint'а,
so that протокол ошибок реализован ОДИН раз (400 = форма, 422 = бизнес-правило, 409 = конфликт состояния), и ни одна view не формирует ошибки руками.

## Acceptance Criteria

1. **Given** конкурентная/повторная вставка, нарушающая `excl_hard_status_overlap`, **When** сервис ловит `IntegrityError`, **Then** клиент получает **`422 OVERLAPPING_HARD_STATUS`** (РЕШЕНО Bratan 2026-06-24: канон-реестр + FR-11, hard-overlap = нарушение бизнес-правила, НЕ overridable soft-конфликт) с телом-конвертом (§36), а НЕ 500.
2. **Given** невалидная форма (DRF-сериализатор отклонил), **When** запрос проходит через handler, **Then** клиент получает `400 VALIDATION_ERROR` с ошибками по полям внутри `details` (DRF-формат сохранён, обёрнут в §36-конверт).
3. **Given** сервис/код поднимает `DomainError("CODE", 422, detail=..., overridable=False)`, **When** исключение долетает до DRF-границы, **Then** ответ имеет статус `http_status` из исключения и тело строго формата §36: `{error_code, message, details, request_id, timestamp}`; `overridable` НЕ выносится в корень тела (это свойство кода в реестре).
4. **Given** `IntegrityError` от любого constraint'а, **When** handler читает имя constraint'а **через `exc.__cause__.diag.constraint_name`** (psycopg3-диагностика, НЕ подстрочный матч англоязычного сообщения), **Then** имя резолвится по таблице `constraint_name → (error_code, http_status, overridable)`; неизвестное имя → `500 INTERNAL_ERROR` без утечки внутренних деталей наружу (логируется как аномалия).
5. **Given** симметричная гонка двух hard-вставок, разрешённая Postgres через deadlock (`OperationalError`/`DeadlockDetected`, имени constraint'а в сообщении нет), **When** handler её ловит, **Then** клиент получает тот же конфликтный исход (как AC-1), а НЕ 500 (deferred-work.md L31).
6. **Given** in-house `PermissionService`/gate поднимает `rest_framework.exceptions.PermissionDenied("PERMISSION_DENIED")`, **When** запрос проходит через новый handler, **Then** ответ ОСТАЁТСЯ `403` с `error_code="PERMISSION_DENIED"` (нулевая регрессия RBAC-контракта 2.9/2.13/2.14); порядок `DEFAULT_AUTHENTICATION_CLASSES` НЕ изменён (пин `test_api_gate.py:88`).
7. **Given** любое НЕ-`DomainError` исключение, которое DRF умеет обрабатывать (404, 405, `Throttled`, DRF `ValidationError`), **When** оно проходит, **Then** handler делегирует встроенному `rest_framework.views.exception_handler` и переоформляет результат в §36-конверт — стандартное поведение DRF сохранено, форма ответа унифицирована.
8. **Given** реестр `docs/registries/error-codes.yaml`, **When** handler эмитит любой код, **Then** этот код ПРИСУТСТВУЕТ в реестре (закрытый мир; тест проверяет, что используемые в маппинг-таблице коды ⊆ реестр).

## Tasks / Subtasks

- [x] **Task 1 — `core.exceptions.DomainError` (чистый класс)** (AC: 3, 8)
  - [x] Создать `Backend/VAPS/apps/core/exceptions.py` — **чистый модуль**, как `core/sorting.py`: НИКАКОГО ORM, `apps.operations`, DRF-импорта в самом классе (чтобы operations и любой контекст могли импортировать; ARCH#L585 «core ↛ all», нельзя зависеть только от `apps.core.models`). DRF можно импортировать в handler-модуле (Task 2), но НЕ тащить тяжёлые зависимости в класс.
  - [x] Сигнатура: `DomainError(code, http_status, detail=None, overridable=False, message=None)`. Хранит `code`, `http_status`, `detail`, `overridable`, опц. `message`. Наследник `Exception` (НЕ `APIException` — класс чист от DRF; handler разворачивает в Response).
  - [x] **MUST: имя поля на проводе — `details` (мн.ч.)** по §36, kwarg `detail` (ед.ч.) — зафиксировано в докстринге; `detail=None` нормализуется в `{}`.
  - [x] Тесты `apps/core/tests/test_exceptions.py` (без БД): 5 тестов — хранение полей, `overridable=False` по умолчанию, `detail=None→{}`, `message` дефолт=code, `isinstance(Exception)`.

- [x] **Task 2 — единый DRF `exception_handler` + §36-конверт** (AC: 2, 3, 4, 5, 7)
  - [x] Создан `Backend/VAPS/apps/core/api/exception_handler.py` (API-плумбинг отдельно от чистого класса). Функция `domain_exception_handler(exc, context)`.
  - [x] **§36-конверт**: `{error_code, message, details, request_id, timestamp}`. `timestamp` — через `core.clock`, ISO 8601 +05:00 (Asia/Qyzylorda). `request_id` — `getattr(request, "request_id", None)`, `null` до стори 4.3.
  - [x] Ветка `DomainError`: статус = `exc.http_status`, `error_code=exc.code`, `details=exc.detail`.
  - [x] Ветка `IntegrityError`: имя через `exc.__cause__.diag.constraint_name` (psycopg3) → `CONSTRAINT_ERROR_MAP`. Неизвестное → `500 INTERNAL_ERROR` + `logger.error`.
  - [x] Ветка `OperationalError` → конфликтный исход (deferred-work.md L31).
  - [x] Иначе: `drf_exception_handler` → если `response`, переоформить в §36 (field-errors в `details` для 400; статусы без кода реестра — 405/429 — остаются DRF-native, закрытый мир). `None` → `500 INTERNAL_ERROR` без утечки `str(exc)`, traceback в `logger.exception`.
  - [x] **MUST NOT** соблюдён: ноль `try/except`+ручной Response во view.

- [x] **Task 3 — `CONSTRAINT_ERROR_MAP` + проводка в settings** (AC: 1, 4, 6, 8)
  - [x] Таблица `CONSTRAINT_ERROR_MAP` в handler-модуле. Сид: `"excl_hard_status_overlap": ("OVERLAPPING_HARD_STATUS", 422, False)` (Решение №1). Плюс `_DRF_STATUS_TO_CODE` (400/401/403/404 → коды реестра) для переоформления DRF-ответов.
  - [x] **Закрытый мир (AC-8):** `emitted_codes()` (все коды handler'а: CONSTRAINT_ERROR_MAP + _DRF_STATUS_TO_CODE + INTERNAL_ERROR) ⊆ реестр. ОТКЛОНЕНИЕ от плана: PyYAML НЕ в venv → тест читает `error-codes.yaml` dependency-free regex-парсом (а не `yaml.safe_load`); тест всегда гоняется в gate (не требует доустановки).
  - [x] Проводка: в `config/settings.py` добавлен ключ `"EXCEPTION_HANDLER": "apps.core.api.exception_handler.domain_exception_handler"`. `DEFAULT_AUTHENTICATION_CLASSES` не тронут — пин `test_api_gate.py::test_auth_class_order_is_identity_then_resolver` зелёный.

- [x] **Task 4 — тесты handler'а (Postgres) + регрессия** (AC: 1, 2, 5, 6, 7, 8)
  - [x] `apps/core/tests/test_exception_handler.py` (`pytestmark = django_db`, Postgres): 10 тестов — (а) реальный hard-overlap → `excl_hard_status_overlap` → 422 OVERLAPPING_HARD_STATUS, не 500; (б) `DomainError` → §36-конверт + статус (прямой вызов handler'а, НЕ тестовая APIView — проще/детерминированнее, покрывает контракт тела); (в) DRF `ValidationError` → 400 с field-errors в `details`; (г) `PermissionDenied` → 403 `error_code`; (д) `ValueError` → 500 без утечки; + IntegrityError-unknown → 500, NotFound → 404 ENTITY_NOT_FOUND, MethodNotAllowed → 405 native (граница закрытого мира), AC-8 закрытый мир.
  - [x] Deadlock/`OperationalError` (AC-5): ОТКЛОНЕНИЕ от плана — вместо `concurrency`-маркера (gate-excluded flaky-репро) сделан ДЕТЕРМИНИРОВАННЫЙ branch-тест `test_operational_error_maps_to_conflict_not_500` в основном файле → гоняется в gate, надёжно доказывает маппинг. Реальный конкурентный deadlock-репро остаётся за 3.14/ARCH-DEFERRED-044 (at-scale сюита).
  - [x] `make gate` зелёный (Postgres :5433): **842 passed, 18 deselected, ruff чист (E,F ≤88), `makemigrations --check` «No changes detected», 21s**. Регрессия: 2 устаревших теста 403-тела (`test_authentication.py`, `test_actor_field.py`) обновлены `detail`→`error_code` под §36 (AC-6); service/model/DB-слой `pytest.raises(...)` — зелёные (handler только на HTTP-границе).

### Review Findings (code-review проход 1, 2026-06-24, Opus 4.8 — same-model caveat)

3 слоя (Blind Hunter / Edge Case Hunter / Acceptance Auditor). **Acceptance Auditor: ACCEPT — AC-1..8 SATISFIED, проверено вживую на реальном Postgres** (15 handler+unit, RBAC-пин, операции 516, ruff, makemigrations — все зелёные). Blind+Edge независимо сошлись на одной HIGH-находке. Итог: **0 decision · 2 patch (ПРИМЕНЕНЫ+верифицированы) · 2 defer · 2 dismiss.**

- [x] [Review][Patch] **HIGH (blind+edge):** ветка `OperationalError` маппила ВЕСЬ класс (connection-lost / timeout / shutdown / disk-full) → `422 OVERLAPPING_HARD_STATUS` — реальный DB-сбой маскировался под бизнес-422, клиент/мониторинг не видели 5xx [`exception_handler.py`]. → СУЖЕНО до SQLSTATE `40P01`/`40001` (deadlock/serialization) через `exc.__cause__.sqlstate`; прочие OperationalError падают в `500`. +3 теста (deadlock→422, serialization→422, non-conflict→500).
- [x] [Review][Patch] **MED (blind+edge):** `_reshape_drf` ветка `"detail" in data` обнуляла `details` даже когда `detail` — список / поле сериализатора буквально названо `detail` → терялись field-errors [`exception_handler.py`]. → страж `isinstance(data["detail"], str)` (ErrorDetail — str-subclass); field-errors сохраняются. +1 тест (`test_validation_error_on_field_named_detail_preserves_errors`).
- [x] [Review][Patch] **MED (blind, test-quality):** OperationalError-тест был вакуумен (re-read того же `CONSTRAINT_ERROR_MAP`); `detail`-путь не покрыт; AC-1 не ассертил путь [`test_exception_handler.py`]. → хардкод `422`/`OVERLAPPING_HARD_STATUS`, +detail-field тест, +AC-1 `details=={}`.
- [x] [Review][Defer] **MED (edge):** 429/406/415 остаются DRF-native (нет кода в реестре) — осознанная граница AC-7↔AC-8 (закрытый мир); follow-up при потребности фронта. → `deferred-work.md`
- [x] [Review][Defer] **MED (edge):** IntegrityError→422 без end-to-end покрытия + no-savepoint broken-conn для БУДУЩИХ write-view (write-эндпоинта статусов ещё нет) — владеют 3.3+. → `deferred-work.md`
- **dismiss×2:** `_timestamp` зависит от `VAPS_LOCAL_TIMEZONE` (clock.py зависит app-wide — misconfig ломает всё, не handler-специфично); `401→AUTH_REQUIRED` сегодня dead code (forward-compat, корректен изолированно, безвреден).

**`make gate` после патчей:** 845 passed (+3), 18 deselected, ruff чист, `makemigrations --check` «No changes detected», 22s.

## Dev Notes

### Цель (одним предложением)

Единая точка формирования ошибок (`DomainError` + один DRF `exception_handler`), чтобы протокол «400=форма / 422=бизнес-правило / 409=конфликт» был реализован ОДИН раз, а каждая последующая стори Epic 3+ просто поднимала `DomainError` или полагалась на маппинг `IntegrityError`, не переизобретая статус→HTTP и не делая `try/except Response` во view.

### ✅ Решение №1 (РЕШЕНО Bratan 2026-06-24) — код для `excl_hard_status_overlap`

**`excl_hard_status_overlap → ("OVERLAPPING_HARD_STATUS", 422, False)`.** Решено по канон-реестру + FR-11.

Контекст (расхождение источников, разрешено в пользу реестра):
- **epics.md:480 (AC стори):** «клиент получает 409 STATUS_OVERLAP» — **ПЕРЕОПРЕДЕЛЕНО** (до-реестровая формулировка; epics 2026-06-11 старше реестра 2026-06-19).
- **error-codes.yaml (канон, 1.12) + FR-11 (epics.md:42):** 4 hard-типа → **422**; `excl_hard_status_overlap` покрывает ИМЕННО hard-типы (condition: hard-types AND `cancelled_at IS NULL`) → **`OVERLAPPING_HARD_STATUS` (422, overridable=false)**, описание «backstop — excl_hard_status_overlap». Голого `STATUS_OVERLAP` в реестре нет (есть `STATUS_OVERLAP_WARNING` 409 soft / `OVERLAPPING_HARD_STATUS` 422 hard).
- Семантика: hard-overlap — нарушение бизнес-правила (422), НЕ overridable soft-конфликт (409). Реестр в реестр ничего добавлять не нужно.

### Что это за стори и чем отличается от 2.x/1.x

- Платформенная **кодовая** стори (AR-7: «DomainError + exception_handler» — первый платформенный сервис). Не спайк (1.9–1.11), не документ-артефакт (1.12), не модель/миграция.
- **Фундамент Epic 3.** После неё 3.2 (модель статуса + `excl_hard_status_overlap`), 3.3 (валидации → 422), 3.4 (конфликт-детектор → 422/409+override), 3.6/3.8/3.9/3.14 — все эмитят `DomainError`/полагаются на handler.
- **Greenfield, но с долгами:** `core/exceptions.py` и `EXCEPTION_HANDLER` сегодня НЕ существуют (подтверждено), но есть три явных обещания в коде/доках, которые 3.1 ОБЯЗАНА закрыть (deferred-work.md L31/L32, comment `employee_status.py:43`, comment `core/api/views.py:88`).

### Точные источники и формы (НЕ угадывать)

| Что | Где | Форма |
|---|---|---|
| Сигнатура `DomainError` | architecture.md:433 | `core.exceptions.DomainError(code, http_status, detail, overridable=False)` |
| Семантика статусов | architecture.md:432 | 400=форма(DRF по полям) · 422=бизнес-правило(hard, окно дат) · 409=конфликт(дубль/soft; тело несёт details+overridable) · 500 без деталей наружу |
| §36-конверт тела | VAPS_7.8.2 §36 «Standard API Error Format» | `{error_code, message, details, request_id, timestamp}` — `error_code` (НЕ `code`), `details` мн.ч., БЕЗ корневого `overridable`/`conflict_code` |
| Файл exceptions.py | architecture.md:509 | `apps/core/exceptions.py` (сосед `clock.py`/`sorting.py`) |
| Маппинг по имени | architecture.md:433 + deferred-work.md L50 | `exc.__cause__.diag.constraint_name` (psycopg3), НЕ подстрока англо-сообщения (хрупко к lc_messages/ренеймам) |
| Реестр кодов | docs/registries/error-codes.yaml | закрытый мир: эмитимый код ∈ реестр, иначе СТОП |
| MUST NOT | architecture.md:433 | никаких `try/except`+ручной `Response` во view |

### §36-конверт (целевое тело — единственная форма)

```json
{
  "error_code": "VALIDATION_ERROR",
  "message": "Проверьте заполнение формы.",
  "details": { "starts_at": ["Дата начала должна быть раньше даты окончания."] },
  "request_id": "uuid-или-null",
  "timestamp": "2026-06-24T10:00:00+05:00"
}
```
- **Подводный камень рассогласования:** API-OPS-001 (ранний пример в спеке) кладёт `conflicts` в КОРЕНЬ тела; §36 (нормативный, «one shape») — внутри `details`. Канонизировать на **§36** (`details.conflicts[]`), плоскую форму API-OPS-001 НЕ воспроизводить.
- `conflict_code` (REST_VIOLATION_CONFLICT, DOUBLE_ASSIGNMENT_CONFLICT, …) — это под-значения ВНУТРИ `details.conflicts[]` у `SOFT_CONFLICT_DETECTED`, НЕ самостоятельные HTTP-коды. Их генерит конфликт-детектор 3.4, не 3.1.
- `EMPTY_GROUP` — код **422** в реестре, НЕ soft-conflict; не дублировать как conflict_code.

### Маппинг IntegrityError/DB-ошибок — три пути (deferred-work.md L31, L32, L50)

1. **Именованный constraint** → `diag.constraint_name` → `CONSTRAINT_ERROR_MAP`. Сид: только `excl_hard_status_overlap` (AC-case). Прочие — добавляют стори-владельцы constraint'ов.
2. **Deadlock-исход (L31):** симметричная гонка двух hard-вставок → Postgres `DeadlockDetected` → Django `OperationalError`; имени constraint'а в сообщении НЕТ. Без обработки = 500. **3.1 ОБЯЗАНА** трактовать `OperationalError`/deadlock как конфликтный исход (AC-5). Тест — маркер `concurrency`.
3. **DataError-путь (L32) — ОСОЗНАННО НЕ В СКОУПЕ семантики:** `date_start > date_end` бьёт в вычисление generated-колонки `period` (`DataError`, SQLSTATE 22000) ДО `chk_status_dates` — мимо маппинга по имени. 3.1 должна не дать ему утечь 500-стактрейсом (попадёт в общую ветку → `500 INTERNAL_ERROR` без деталей), но **семантический `422` с полевой ошибкой для порядка дат — это стори 3.3** (валидация в сервисе ДО БД). Зафиксировать как known-gap, закрываемый 3.3; не чинить здесь.

### Регрессионная поверхность (держать зелёным)

- **`PermissionDenied("PERMISSION_DENIED")` → 403** с этим `error_code` — контракт RBAC 2.9/2.13/2.14. Источники: `apps/core/api/permissions.py:14-18,51`, `apps/operations/api/permissions.py:10,14`, `apps/operations/api/views.py:126`. `XUserIdAuthentication` НАМЕРЕННО не поднимает 401 (`authentication.py:11-14`), чтобы не маскировать 403 — не ломать.
- **Порядок `DEFAULT_AUTHENTICATION_CLASSES`** — пин `test_api_gate.py:88`. Добавлять ТОЛЬКО ключ `EXCEPTION_HANDLER`, ничего не переупорядочивая.
- **~16 `pytest.raises(ValidationError|IntegrityError|DataError)`** на service/model/DB-слое (`test_employee_status_concurrency.py:63`, `test_divisions.py:31`, `test_control_settings.py:32,47`, `core/services.py`-тесты, `core/models.py clean()`-тесты) — handler стоит ТОЛЬКО на HTTP-границе, raise-сайты не трогаются → остаются зелёными.
- **Django `ValidationError` (не DRF!)** из сервисов/`clean()` сегодня НЕ долетает до HTTP (диспетчер увольнения отложен, `core/api/views.py:88`). Если handler начнёт ловить `django.core.exceptions.ValidationError` → меняет поведение будущих service-backed endpoint'ов — это маппинг **3.3** (→422). 3.1 НЕ должна молча его глотать; ограничить скоуп DRF-`ValidationError` (через делегирование default-handler'у).
- **DRF-дефолты** (404/405/serializer-validation) — сохранять делегированием в `rest_framework.views.exception_handler`.

### Что НЕ строить / НЕ трогать (Out of Scope)

- **Конфликт-детектор / hard-soft матрица → 3.4** (AR-8). 3.1 транслирует уже поднятый конфликт, не вычисляет пересечения интервалов.
- **Override-сущность (запись reason/actor/object/time) → 3.5.** 3.1 несёт только флаг `overridable` на ошибке; `override без причины → 400` — 3.5.
- **Сам `ExclusionConstraint excl_hard_status_overlap` → 3.2** (модель статуса). 3.1 маппит ВИОЛЕЙШН по имени, не создаёт constraint. (Сейчас он уже есть в `apps/operations/statuses/models/employee_status.py:46` от прежних стори — использовать для теста AC-1.)
- **Семантический 422 для порядка дат (DataError-путь) → 3.3.**
- **Реестр бизнес-кодов** — не авторствуется 3.1; коды берутся из готового `error-codes.yaml`.
- **403/scope/RBAC** — производит `PermissionService`/gate (СУЩЕСТВУЕТ), 3.1 лишь сохраняет контракт.
- **Фронтовый `ApiError`-union, ConflictDialog, override-retry → 8.4/8.5.** 3.1 backend-only; обязана выдать тело-форму, которую фронт типизирует (422→ValidationError, 409+overridable→ConflictError, 500→ServerError).
- **request-id middleware → 4.3.** 3.1 эмитит поле `request_id` (null до 4.3), не строит middleware.
- **At-scale конкурентная сюита → ARCH-DEFERRED-044.** Здесь — единичный транзакционный/deadlock тест под маркером `concurrency`.
- **Миграции** — 3.1 их НЕ создаёт (`makemigrations --check` обязан быть «No changes detected»).

### Решения, принятые при создании стори (дефолты; менять осознанно)

1. **`DomainError` наследует `Exception`, не `APIException`** — чтобы класс был чист от DRF и импортировался из operations/любого контекста (как `sorting.py`). Разворачивает в Response сам handler.
2. **Класс и handler — РАЗНЫЕ файлы:** `core/exceptions.py` (чистый класс) + `core/api/exception_handler.py` (DRF-плумбинг). Сохраняет core-чистоту (ARCH#L585).
3. **`request_id` — поле есть, значение `null` до 4.3.** Форвард-совместимость без зависимости на Epic 4.
4. **Неизвестный constraint / неизвестное исключение → 500 INTERNAL_ERROR без деталей**, а не «угаданный 409». Закрытый мир: не фабриковать код. Аномалия — в лог.
5. **Канонизация на §36** (`details.conflicts[]`), плоскую форму API-OPS-001 не воспроизводить.
6. **`excl_hard_status_overlap → 422 OVERLAPPING_HARD_STATUS`** (РЕШЕНО Bratan 2026-06-24; реестр+FR-11). epics-AC L480 «409 STATUS_OVERLAP» переопределён каноном.
7. **Имя constraint'а — из `diag.constraint_name`**, не из подстроки сообщения (deferred-work.md L50: хрупко к lc_messages/ренеймам).

### Подводные камни для dev-агента

- **detail vs details:** конструктор `detail` (ед.ч.), провод `details` (мн.ч.). Не путать. На проводе строго `details`.
- **`error_code`, не `code`:** корневое поле тела — `error_code` (§36). В реестре ключи — голые коды, но в JSON-ответе поле зовётся `error_code`.
- **psycopg3 diag:** `exc.__cause__` у Django `IntegrityError` — это `psycopg.errors.*`; `.diag.constraint_name` даёт имя без парсинга текста. Проверить, что `__cause__` не `None` (защитный `getattr`).
- **500 не должен течь:** `str(exc)`/traceback наружу — НЕЛЬЗЯ (architecture.md:432). Только `{error_code: "INTERNAL_ERROR", message: <generic>, ...}`; полный traceback — в `logger.exception`.
- **Не глотать Django `ValidationError`:** это 3.3. Делегировать default-handler'у (он Django-ValidationError не ловит → она станет 500 на будущем endpoint'е, что корректно для 3.1; 3.3 добавит сервис-валидацию до БД).
- **Тест AC-1 на Postgres:** `excl_hard_status_overlap`/`DataError`/generated-колонки — ТОЛЬКО Postgres (`VAPS_DB=postgres`, gate уже на :5433). SQLite их не воспроизведёт (ARCH-DATA-020).
- **ruff E/F, строки ≤88**, нет `per-file-ignores` — следить за длиной (особенно докстринги/маппинг-литералы).
- **`makemigrations --check` обязан быть чист** — 3.1 без моделей; если что-то тронуло модель — ошибка скоупа.

### Технические версии / окружение

- Django 5.x + DRF 3.15+, Python 3.12+, PostgreSQL (prod + тесты), psycopg3 (даёт `.diag`), pytest + pytest-django (architecture.md:117).
- `core.clock` для `timestamp` (СУЩЕСТВУЕТ, ARCH-DATA-022). `core/exceptions.py` — stdlib + опц. typing; никаких новых зависимостей. `PyYAML` (есть) для теста закрытого мира.
- Gate: `make gate` (Backend/VAPS/Makefile:31-54) — `docker compose up -d --wait db` (Postgres :5433) + `ruff check .` + pytest (не property/concurrency/slow) + `makemigrations --check`, бюджет 300s (NFR-8). `concurrency`-тест — в `test-full` (1500s).

### Git-интеллидженс (последние коммиты)

- HEAD `c5779d9` («2.8 story») на `main`; E2 done (14/14), E1 1.12 done, 1.11 review (прод-выгрузка за Bratan — к 3.1 не относится). Дерево чистое.
- Паттерн коммитов: `feat(EN): стори X.Y — <суть>`. Прецедент 2.x: dev-story делает RED→GREEN+make gate зелёный, артефакты коммитит Bratan (или по решению). Урок ревью 2.4–2.11: File List полный/честный; Completion Notes без вранья (каждое «проверено» — с командой `make gate` + числами).
- Стиль тестов слоя: `apps/core/tests/conftest.py` фикстура `grant` (X-User-Id + RBAC seed); `APIClient`/`APIRequestFactory`; `pytestmark = pytest.mark.django_db`.

### Зависимости

- **Depends on:** `error-codes.yaml` (реестр, 1.12 done — источник кодов); `core/clock.py` (timestamp); `excl_hard_status_overlap` в `employee_status.py` (для теста AC-1, уже в коде). Архитектурно — AR-7, ARCH-DATA-020.
- **Blocks / питает:** **весь Epic 3** — 3.3 (валидации→422), 3.4 (детектор→422/409+override), 3.6/3.8/3.9 (lifecycle/bulk эмитят DomainError), 3.14 (конкурентный смоук гоняет IntegrityError→409 под реальной гонкой). Кросс-эпик: **8.4/8.5** (фронт типизирует тело-форму), **4.3** (request-id наполнит поле).
- **Связана:** 3.2 (модель статуса + constraint), deferred-work.md L31/L32/L50 (явные обещания), `core/api/views.py:88` (отложенный диспетчер увольнения с DomainError-маппингом → 2.9/E5).

### Тесты стори

- **Unit (без БД):** `test_exceptions.py` — `DomainError` хранит поля, дефолты, `detail=None→{}`.
- **Integration (Postgres, `django_db`):** `test_exception_handler.py` — AC-1 (реальный overlap→конфликт-код, не 500), AC-2 (DRF ValidationError→400 field-errors в details), AC-3 (DomainError→§36+статус), AC-6 (PermissionDenied→403 регрессия), AC-7 (delegation 404/405), неизвестное→500 без утечки, AC-8 (коды маппинга ⊆ реестр).
- **Concurrency (маркер, test-full):** deadlock/OperationalError→конфликт (AC-5).
- **Регрессия:** `make gate` зелёный; существующие `pytest.raises(...)`-тесты слоя зелёные; `makemigrations --check` чист; ruff чист.

### Definition of Done

- [x] `core/exceptions.py` (чистый `DomainError(code, http_status, detail, overridable=False)`); `core/api/exception_handler.py` (единый handler, §36-конверт, IntegrityError-by-name + deadlock + delegation + 500-no-leak).
- [x] `REST_FRAMEWORK["EXCEPTION_HANDLER"]` проведён; порядок auth-классов не тронут (пин `test_api_gate.py:88` зелёный).
- [x] `CONSTRAINT_ERROR_MAP` сидирован `excl_hard_status_overlap` (код по Решению №1); коды ⊆ реестр (AC-8 тест).
- [x] Решение №1 (409 vs 422) РЕШЕНО Bratan 2026-06-24 → 422 OVERLAPPING_HARD_STATUS; отражено в коде/тесте.
- [x] Все 8 AC покрыты тестами; deadlock-кейс — детерминированный branch-тест в gate (реальный репро → 3.14, задокументировано).
- [x] `make gate` зелёный (Postgres :5433: 842 passed, ruff E/F чист, `makemigrations --check` «No changes detected», 21s); регрессия RBAC/слоя зелёная.
- [x] MUST NOT соблюдён: ноль `try/except`+ручной Response во view; ноль миграций; core-чистота `exceptions.py` (без ORM/operations).
- [x] Completion Notes без вранья (каждое «проверено» — с командой + числами make gate).

### Project Structure Notes

- **Создаются:** `Backend/VAPS/apps/core/exceptions.py`, `Backend/VAPS/apps/core/api/exception_handler.py`, `Backend/VAPS/apps/core/tests/test_exceptions.py`, `Backend/VAPS/apps/core/tests/test_exception_handler.py`.
- **Изменяется:** `Backend/VAPS/config/settings.py` (только +ключ `EXCEPTION_HANDLER` в `REST_FRAMEWORK`).
- Лимит «≤5 файлов» (CLAUDE.md) соблюдён (4 новых + 1 правка), одна ответственность (единая точка ошибок).
- Вне перечисленного — ноль изменений. Без моделей/миграций. `apps/operations`, донор, `pyproject.toml`, `Makefile` не трогаются.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.1 (476-483)] — user-story + AC (excl_hard_status_overlap→409 STATUS_OVERLAP; форма→400, бизнес→422 с кодом реестра).
- [Source: _bmad-output/planning-artifacts/epics.md (42, 109, 104)] — FR-11 (hard→422/soft→409+override), AR-7 (DomainError+exception_handler), AR-2 (фронт DomainError-парсинг).
- [Source: _bmad-output/planning-artifacts/epics.md#Story-8.4/8.5 (969-983)] — фронт-контракт: typed ApiError union (422/409 overridable/500); «протокол ошибок реализован один раз».
- [Source: _bmad-output/planning-artifacts/architecture.md (432-433, 483, 509)] — семантика статусов; сигнатура DomainError + MUST NOT try/except Response; IntegrityError по имени constraint; путь exceptions.py.
- [Source: _bmad-output/planning-artifacts/architecture.md (437, 450, 462-463, 748)] — тест IntegrityError→409 + транзакционный; PermissionService→DomainError 403 (ARCH-SEC-031); конкурентность/идемпотентность; ARCH-DATA-020 excl_hard_status_overlap.
- [Source: docs/registries/error-codes.yaml] — закрытый мир кодов: OVERLAPPING_HARD_STATUS(422), STATUS_OVERLAP_WARNING(409), SOFT_CONFLICT_DETECTED(409)+conflict_code[], PERMISSION_DENIED(403), VALIDATION_ERROR(400), INTERNAL_ERROR(500), …
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §36 / §60 / §1255 / API-OPS-001] — §36 канон-конверт {error_code,message,details,request_id,timestamp}; §60 добавления кодов; API-OPS-001 ранняя плоская conflicts (НЕ воспроизводить).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (L31, L32, L50)] — deadlock/OperationalError мимо имени→409; DataError generated-колонки (→3.3); diag.constraint_name vs подстрока.
- [Source: Backend/VAPS/config/settings.py (95-105)] — REST_FRAMEWORK без EXCEPTION_HANDLER; auth-цепочка XUserId→EffectivePermissionsResolver (пин test_api_gate.py:88).
- [Source: Backend/VAPS/apps/core/api/permissions.py / apps/operations/api/permissions.py] — PermissionDenied("PERMISSION_DENIED")→403 (регрессионный контракт).
- [Source: Backend/VAPS/apps/operations/statuses/models/employee_status.py (43-46)] — comment-контракт «3.1 maps IntegrityError to 409 by this exact name» + ExclusionConstraint excl_hard_status_overlap.
- [Source: Backend/VAPS/apps/core/{clock.py,sorting.py}] — образец чистого core-модуля + источник timestamp.
- [Source: Backend/VAPS/Makefile (31-54) + pyproject.toml] — gate (Postgres :5433, 300s), ruff E/F ≤88, маркеры property/concurrency/slow.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **TDD RED→GREEN:** `test_exceptions.py` сперва упал `ModuleNotFoundError: apps.core.exceptions` → реализован `DomainError` → 5 passed. `test_exception_handler.py` упал `ModuleNotFoundError: apps.core.api.exception_handler` → реализован handler + проводка → 10 passed (Postgres :5433).
- **make gate (Postgres :5433, 2026-06-24):** первый прогон — `ruff check` упал 6×E501 (>88) в новых файлах; разбиты длинные строки → второй прогон зелёный: **842 passed, 18 deselected, ruff чист, `makemigrations --check` «No changes detected», 21s** (бюджет NFR-8 = 300s).
- **AC-1 на реальном Postgres:** вставка двух пересекающихся hard-статусов (VACATION, один employee_id) → реальный `IntegrityError` от `excl_hard_status_overlap`; `exc.__cause__.diag.constraint_name` резолвится → 422 OVERLAPPING_HARD_STATUS (не 500). Подтверждено вживую.
- **Регрессия RBAC-контракта:** `test_api_gate.py::test_auth_class_order_is_identity_then_resolver` (пин порядка auth-классов) зелёный; 2 теста 403-тела обновлены `detail`→`error_code` под §36 (фокус-прогон 37 passed по 5 файлам).
- **Закрытый мир:** PyYAML отсутствует в venv → `_registry_codes()` парсит `error-codes.yaml` regex'ом (без зависимости); `emitted_codes()` ⊆ реестр — зелёно.
- **request_id:** инфра отсутствует (стори 4.3) → поле `request_id=null` форвард-совместимо; тест ассертит `None`.

### Completion Notes List

Реализована единая точка формирования ошибок (AR-7, фундамент Epic 3). Все 8 AC удовлетворены, проверено `make gate` на реальном Postgres.

- ✅ **Task 1:** `core/exceptions.py` — чистый `DomainError(code, http_status, detail, overridable, message)` (наследник `Exception`, без ORM/DRF). 5 unit-тестов.
- ✅ **Task 2:** `core/api/exception_handler.py` — `domain_exception_handler`: §36-конверт; ветки DomainError / IntegrityError-by-`diag.constraint_name` / OperationalError-deadlock / DRF-delegation+reshape / unknown→500-no-leak.
- ✅ **Task 3:** `CONSTRAINT_ERROR_MAP` (excl_hard_status_overlap → 422 OVERLAPPING_HARD_STATUS, Решение №1) + `EXCEPTION_HANDLER` проведён в `config/settings.py` (auth-порядок не тронут).
- ✅ **Task 4:** 15 новых тестов (5+10); `make gate` зелёный 842 passed.
- **Решение №1 РЕШЕНО Bratan 2026-06-24:** hard-overlap → 422 OVERLAPPING_HARD_STATUS (канон-реестр+FR-11); epics-AC L480 «409» переопределён. Зафиксировано в коде, тесте и комментарии `employee_status.py`.
- **Отклонения от плана (осознанные, задокументированы):** (1) closed-world тест — regex-парс реестра вместо `yaml.safe_load` (PyYAML нет в venv; тест всегда в gate); (2) AC-5 — детерминированный branch-тест OperationalError→422 в основном файле (gate-run) вместо flaky concurrency-маркера; реальный deadlock-репро → 3.14/ARCH-DEFERRED-044; (3) DomainError-тест — прямой вызов handler'а, не тестовая APIView (проще, тот же контракт тела).
- **Out-of-scope соблюдён:** ноль моделей/миграций; DataError-путь (порядок дат) НЕ глотается семантически — уходит в 500-no-leak, 422-валидация → 3.3; детектор/override/фронт не трогались.
- **Доп. правка (in-scope):** стале-комментарий в `employee_status.py` «3.1 maps … to 409» → «422 OVERLAPPING_HARD_STATUS» (forward-ref к этой же стори).
- Артефакты НЕ закоммичены агентом (за Bratan, прецедент E2).

### File List

Новые:
- `Backend/VAPS/apps/core/exceptions.py`
- `Backend/VAPS/apps/core/api/exception_handler.py`
- `Backend/VAPS/apps/core/tests/test_exceptions.py`
- `Backend/VAPS/apps/core/tests/test_exception_handler.py`

Изменённые:
- `Backend/VAPS/config/settings.py` (+`EXCEPTION_HANDLER` в `REST_FRAMEWORK`)
- `Backend/VAPS/apps/operations/statuses/models/employee_status.py` (комментарий 409→422; код constraint не тронут)
- `Backend/VAPS/apps/core/tests/test_authentication.py` (403-тело `detail`→`error_code`)
- `Backend/VAPS/apps/core/tests/test_actor_field.py` (403-тело `detail`→`error_code`)

### Change Log

- 2026-06-24 — Story 3.1 реализована (DomainError + единый DRF exception_handler, §36-конверт, IntegrityError-by-constraint-name + deadlock + closed-world). make gate зелёный (842 passed). Status → review.
- 2026-06-24 — code-review проход 1 (3 слоя, Opus 4.8): Auditor ACCEPT (AC-1..8 SATISFIED). 2 patch применены (OperationalError сужен до SQLSTATE 40P01/40001 — DB-сбой больше не маскируется под 422; `_reshape_drf` страж `detail`-поля) + test-quality. 2 defer → deferred-work.md, 2 dismiss. make gate зелёный (845 passed). Status → done.
