---
baseline_commit: 6b85e79
---

# Story 13.6: Errors-журнал на сервере

Status: review

## Story

As a **разработчик**,
I want **structured JSON-логи с `request_id` + ротацию + команду просмотра последних ошибок**,
so that **диагностика без внешних сервисов (GlitchTip остаётся DEFERRED)**.

`epics.md#L1389-1395`, последняя стори эпика 13 (кроме ретро).

## Scope Decision (найдено при create-story)

13.2 (`Scope Decision`, done) уже исследовала это: `config/settings.py` не содержит `LOGGING`-словаря, `structlog`/`python-json-logger` не установлены — и явно задокументировала полноценную structured-application-logging инфраструктуру как **будущий долг, не имитируемый в 13.2**. 13.6 — буквально ЭТОТ долг, теперь в скоупе явно. Разница с 13.2: та экспортировала уже-структурные `AuditLog`-строки (бизнес-мутации); эта стори строит НОВУЮ инфраструктуру для application-исключений (`logger.exception(...)`, `apps/core/api/exception_handler.py:175` — уже вызывается на каждый необработанный 500, но БЕЗ конфигурированного handler'а результат уходит в Python-дефолт, не в структурный файл).

**«Запись связывается с багрепортом» — через УЖЕ СУЩЕСТВУЮЩЕЕ поле, не новую FK-связь.** `BugReport.last_request_ids` (`apps/operations/bugreports/models.py:20-24`, стори 13.1a) УЖЕ существует — JSONField, куда фронт кладёт последние `X-Request-Id` из ответов. Раз оба конца (лог-запись И `BugReport`) несут ОДИН И ТОТ ЖЕ `request_id` (единый источник — `apps.core.middleware`'s contextvar, `apps/core/api/exception_handler.py:69-71`'s `_request_id`), связь — это СОВПАДЕНИЕ значения ключа, не FK/миграция. Эта стори делает связь ПРОВЕРЯЕМОЙ: команда просмотра ошибок принимает `--request-id` и, если задан, дополнительно ищет `BugReport`-строки с этим id в `last_request_ids`.

## Acceptance Criteria

1. **AC-1 (JSON-форматтер, stdlib-only).** `apps/core/logging_json.py`: `RequestJsonFormatter(logging.Formatter)` — каждая запись лога сериализуется в ОДНУ строку JSON: `timestamp` (ISO, `Clock`-совместимый часовой пояс), `level`, `logger`, `message`, `request_id` (из `apps.core.middleware.get_request_id()` — та же contextvar, что уже питает error-конверт §36), `exception` (traceback-текст, если запись логирует исключение — `None` иначе). БЕЗ новых зависимостей (`pythonjsonlogger`/`structlog` НЕ установлены и НЕ добавляются — `json.dumps` стандартной библиотеки достаточно).
2. **AC-2 (Django `LOGGING`-словарь + ротация).** `config/settings.py` получает `LOGGING` (сейчас отсутствует полностью): `RotatingFileHandler` (stdlib `logging.handlers`, БЕЗ новой зависимости) с `RequestJsonFormatter`, путь/`maxBytes`/`backupCount` — через env (`VAPS_ERROR_LOG_PATH` дефолт `BASE_DIR/logs/errors.log`, `VAPS_ERROR_LOG_MAX_BYTES` дефолт 10MB, `VAPS_ERROR_LOG_BACKUP_COUNT` дефолт 5) — тот же env-driven стиль, что `VAPS_DB_*`/`VAPS_REDIS_URL` уже в этом файле. `django.request`-логгер (Django's встроенный per-500 логгер) И `apps.core.api.exception_handler`'s собственный logger — ОБА маршрутизированы на этот handler на уровне ERROR.
3. **AC-3 (`logs/`-директория — гитигнорирована, создаётся при необходимости).** `RotatingFileHandler` не создаёт родительскую директорию сам — `Backend/VAPS/logs/` создаётся явно (или `LOGGING`-конфиг гарантирует её существование до создания handler'а), добавлена в `Backend/VAPS/.gitignore`.
4. **AC-4 (500-ошибка → запись в лог с `request_id`).** Необработанное исключение, дошедшее до `apps/core/api/exception_handler.py`'s `logger.exception(...)` (строка 175) — реально пишет JSON-строку в файл, `request_id`-поле совпадает с тем же значением, что ушло в HTTP-ответ (`_envelope`'s `request_id`, тот же `_request_id(context)`-вызов).
5. **AC-5 (команда просмотра последних ошибок).** `manage.py tail_errors [--n N] [--request-id ID]` (`apps/core/management/commands/tail_errors.py`, зеркалит `apps/audit/management/commands/export_diagnostics.py`'s CLI-конвенцию): без флагов — последние N (дефолт 20) записей файла, читаемым текстом (не сырой JSON — timestamp/level/logger/message/request_id/exception построчно). С `--request-id ID` — фильтрует записи ЭТИМ `request_id` И дополнительно печатает любые `BugReport`-строки, чей `last_request_ids` содержит этот id (см. Scope Decision — ПРОВЕРЯЕМАЯ связь лог↔багрепорт).
6. **AC-6 (регресс нулевой).** `make gate` зелёный.

## Out of Scope

- Внешний сервис агрегации логов (GlitchTip) — явно DEFERRED буквой стори, не открывать заново.
- Логирование ВСЕХ запросов (access-log/APM) — буква просит «errors-журнал», не полный трейсинг; только ERROR+ уровень.
- Автоматическая привязка `BugReport` к конкретной лог-записи через миграцию/новое FK-поле — связь уже существует через совпадение `request_id` (см. Scope Decision), новых полей на `BugReport` не добавляется.
- Отправка/уведомление разработчика при появлении новой ошибки (это уже частично покрыто 13.5b/13.5c для СОВСЕМ другого класса событий — «отставание по сдаче»/«пульс» — не error-журнал; смешивать нельзя).
- Ротация/архивация СТАРЫХ бэкапов лога за пределами `backupCount` (`RotatingFileHandler`'s штатное поведение — удаляет старейший бэкап сам, доп. логика не нужна).

## Tasks / Subtasks

- [x] Task 1 — JSON-форматтер (AC: 1)
  - [x] `apps/core/logging_json.py`: `RequestJsonFormatter`
  - [x] `request_id` — из `apps.core.middleware.get_request_id()`, не из параметра `record`
  - [x] `exception`-поле — traceback-текст через `self.formatException(record.exc_info)`, если `record.exc_info` установлен
- [x] Task 2 — `LOGGING`-конфиг + ротация (AC: 2, 3)
  - [x] `config/settings.py`: `LOGGING`-словарь, env-driven путь/`maxBytes`/`backupCount`
  - [x] `Backend/VAPS/logs/`-директория создаётся при отсутствии (до инициализации handler'а)
  - [x] `Backend/VAPS/.gitignore`: `logs/`
- [x] Task 3 — Реальная связь через `logger.exception` (AC: 4)
  - [x] Живой прогон: необработанное исключение → JSON-строка в файле, `request_id` совпадает с HTTP-ответом
- [x] Task 4 — `tail_errors`-команда (AC: 5)
  - [x] `apps/operations/bugreports/management/commands/tail_errors.py`: `--n`/`--request-id` (перенесена из `apps/core/` — см. Completion Notes, найденная архитектурная граница)
  - [x] `--request-id`-режим ищет `BugReport.objects.filter(last_request_ids__contains=[request_id])`, печатает найденные
- [x] Task 5 — Тесты + реальный прогон (AC: 6)
  - [x] Юнит: `RequestJsonFormatter` — валидный JSON, все поля на месте, `request_id` из contextvar (не хардкод)
  - [x] Юнит: forматтер с `exc_info` даёт непустой `exception`; без — `None`
  - [x] Интеграционный: реальный HTTP-запрос через `RequestContextMiddleware` + `domain_exception_handler` с реально пойманным исключением → файл лога содержит запись с ТЕМ ЖЕ `request_id`, что в JSON-ответе
  - [x] Команда: `tail_errors` без флагов — читает N последних строк реального файла
  - [x] Команда: `tail_errors --request-id X` — фильтрует + находит совпадающий `BugReport` (живой сценарий: создан `BugReport` с `last_request_ids=["X"]`, лог-запись с тем же `request_id`, команда печатает оба)
  - [x] `make gate` зелёный, явно прогнан (3060 passed)

## Dev Notes

- **`request_id`-инфраструктура УЖЕ существует — не изобретать заново.** `apps/core/middleware.py`'s `get_request_id()` — единственный легитимный источник (тот же contextvar, что `_request_id(context)` в `exception_handler.py:69-71` уже использует для HTTP-конверта). Форматтер читает ЕГО, не пытается вытащить request из `LogRecord` (запись лога может произойти вне HTTP-контекста, contextvar корректно вернёт пустую строку/`None` там, зеркалит `RequestContextMiddleware`'s собственный дефолт).
- **`logger.exception(...)` уже вызывается — правится только КОНФИГ, не место вызова.** `apps/core/api/exception_handler.py:175` (`logger.exception("Unhandled exception surfaced to the API boundary")`) — существующий код, НЕ трогается этой стори. Без `LOGGING`-конфига результат уходит в Python's дефолтный `lastResort`-handler (stderr, без JSON, без ротации) — эта стори ТОЛЬКО добавляет `LOGGING`-словарь + форматтер, не трогает вызывающий код.
- **`BugReport.last_request_ids` — уже готовый крюк, найден при research, не новое поле.** Комментарий модели (`apps/operations/bugreports/models.py:20-24`) ЯВНО предвидел этот сценарий: «the frontend accumulates the last few from response X-Request-Id headers and sends them as-is» — эта стори реализует ЧИТАЮЩУЮ сторону (команда, которая ищет по этому полю), не пишущую (фронт уже пишет, 13.1a).
- **Никаких новых зависимостей.** `pythonjsonlogger`/`structlog` НЕ установлены (`pip show` подтверждает при create-story) — `json.dumps` + `logging.handlers.RotatingFileHandler` (оба stdlib) полностью достаточны для буквы стори («structured JSON-логи ... ротацию»), добавление зависимости требовало бы HALT/approval по dev-story протоколу без необходимости.
- **`export_diagnostics.py` (13.2) — CLI-конвенция для копирования, не код для переиспользования.** Тот же стиль management-команды (аргументы, `self.stdout.write`), но НЕ импортировать из него — разные домены (диагностика-экспорт vs. просмотр ошибок).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1389-1395] — буква стори 13.6.
- [Source: _bmad-output/implementation-artifacts/13-2-выгрузка-диагностики-носителем.md] — Scope Decision, явно откладывающий эту инфраструктуру как будущий долг («не имитируется») — теперь эта стори её строит.
- [Source: Backend/VAPS/apps/core/middleware.py] — `get_request_id()`, единственный легитимный источник request_id.
- [Source: Backend/VAPS/apps/core/api/exception_handler.py#L69-71,175] — `_request_id(context)` (HTTP-конверт), `logger.exception(...)` (уже существующий вызов, эта стори конфигурирует его вывод).
- [Source: Backend/VAPS/apps/operations/bugreports/models.py#L20-24] — `BugReport.last_request_ids`, уже готовый крюк для связи лог↔багрепорт.
- [Source: Backend/VAPS/apps/audit/management/commands/export_diagnostics.py] — CLI-конвенция для зеркалирования (аргументы, `self.stdout.write`), НЕ для импорта.
- [Source: Backend/VAPS/config/settings.py] — env-driven конфиг-стиль (`VAPS_DB_*`/`VAPS_REDIS_URL`), куда добавляется `LOGGING`.

## Dev Agent Record

### Context Reference

- Собрано напрямую при create-story: 13.2's Scope Decision (нашла отсутствие LOGGING-инфраструктуры, явно отложила её), `exception_handler.py`'s уже существующий `logger.exception`-вызов + `_request_id`-паттерн, `BugReport.last_request_ids`'s уже готовый крюк для связи (найден чтением модели — избавляет от новой FK/миграции), подтверждено отсутствие `pythonjsonlogger`/`structlog` в venv (нет новых зависимостей).

### Completion Notes

- **AC-1**: `RequestJsonFormatter` — stdlib-only (`json.dumps`), `request_id` читается из `get_request_id()`-contextvar (тот же источник, что HTTP-конверт §36), `exception`-поле через `formatException`.
- **AC-2/AC-3**: `LOGGING`-словарь добавлен в `config/settings.py` (ранее отсутствовал полностью), env-driven (`VAPS_ERROR_LOG_PATH`/`VAPS_ERROR_LOG_MAX_BYTES`/`VAPS_ERROR_LOG_BACKUP_COUNT`, тот же стиль, что `VAPS_DB_*`), `Backend/VAPS/logs/`-директория создаётся явно ДО применения `LOGGING` (`RotatingFileHandler` сам не создаёт родительскую директорию), `logs/` — в `.gitignore`.
- **AC-4**: `django.request` и `apps.core.api.exception_handler`-логгеры маршрутизированы на `errors_journal`-handler. Доказано живым тестом: `RuntimeError` реально поймана/переброшена через `domain_exception_handler` внутри `RequestContextMiddleware`-обёртки — JSON-строка в файле несёт ТОТ ЖЕ `request_id`, что HTTP-конверт (`test_unhandled_exception_writes_journal_entry_matching_envelope_request_id`).
- **AC-5**: `tail_errors`-команда — `--n`/`--request-id`, `--request-id`-режим ищет `BugReport.last_request_ids__contains` (уже существующее поле 13.1a — связь без новой FK/миграции, как и планировалось в Scope Decision).
- **Найдена и закрыта живая регрессия ДО отправки на ревью (не ревью нашло — сам, прогоняя `make gate`)**: команда изначально жила в `apps/core/management/commands/`, но импортировала `BugReport` (`apps.operations.bugreports.models`) — `test_isolation.py::test_core_does_not_import_other_context_models` покраснел (`apps.core` не должен импортировать модели других контекстов, направление зависимости строго ОБРАТНОЕ). Исправлено: команда+её тест перенесены в `apps/operations/bugreports/management/commands/`/`tests/` (мирроит `export_diagnostics.py`'s размещение в домене, которого касается — не `apps/core/`), докстринг объясняет решение явно.
- **AC-6**: `make gate` — 3060 passed, "No changes detected" (не API-поверхность — новые классы/команды не сериализуются в OpenAPI-схему).

### File List

- `Backend/VAPS/apps/core/logging_json.py` (NEW) — `RequestJsonFormatter`.
- `Backend/VAPS/config/settings.py` (MOD) — `LOGGING`-словарь, `VAPS_ERROR_LOG_*` env-переменные.
- `Backend/VAPS/.gitignore` (MOD) — `logs/`.
- `Backend/VAPS/apps/operations/bugreports/management/__init__.py` (NEW).
- `Backend/VAPS/apps/operations/bugreports/management/commands/__init__.py` (NEW).
- `Backend/VAPS/apps/operations/bugreports/management/commands/tail_errors.py` (NEW) — команда просмотра ошибок (изначально `apps/core/`, перенесена — см. Completion Notes).
- `Backend/VAPS/apps/core/tests/test_logging_json.py` (NEW) — 6 тестов.
- `Backend/VAPS/apps/operations/bugreports/tests/test_tail_errors.py` (NEW) — 6 тестов (изначально `apps/core/tests/`, перенесён вместе с командой).

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story). Последняя стори эпика 13 (кроме ретро) — 13.2's явно отложенный structured-logging долг теперь в скоупе. Связь лог↔багрепорт реализована через УЖЕ существующее `BugReport.last_request_ids` (13.1a), без новой FK/миграции. |
| 2026-07-29 | dev-story: JSON-форматтер, `LOGGING`-конфиг+ротация, `tail_errors`-команда, 12 тестов. Сам нашёл и закрыл живую регрессию до ревью (архитектурная граница apps.core↛other-context-models — команда перенесена в `apps/operations/bugreports/`). `make gate` 3060 passed. Status → review |
