---
baseline_commit: f2cfb85e
---

# Story 20.5b: Отчёт «штатное расписание» — API-эндпоинт

Status: done

## Story

As a **держатель права `personnel.view`**,
I want **получить штатное расписание (управление × должность: по штату/по списку/вакансии) по HTTP**,
so that **будущий экран/печатная форма отчёта (FR-40) сможет отобразить данные без прямого доступа к селектору**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (домен `core`, не `operations`)

**Отличие от 20.1b/20.2b/20.3b**: `compute_staffing_table()` (20.5a) живёт в `apps/core/selectors.py` (`CoreStaffingSelector`), НЕ в `apps.operations.*`. HTTP-поверхность этой стори — `apps/core/api/` (уже существует, `apps/core/api/urls.py`, роутер, смонтированный на `/api/core/...` — отдельно от `/api/operations/...`). Это НЕ нарушает `core ↛ operations` (architecture.md's граница «core никого не импортирует») — сама вьюха остаётся внутри `apps.core`.

- **Разбор 20.5a's явного out-of-scope**: «API/эндпоинт HTTP-слоя». Селектор (`compute_staffing_table(business_date, division_ids=None)`, 20.5a) уже полностью реализован и протестирован — эта стори НЕ трогает его логику, только оборачивает в HTTP.
- **Новый `StaffingTableViewSet(viewsets.ViewSet)`** в `apps/core/api/views.py` — ОДИН `list`-экшен (`GET /api/core/staffing-table/`), зарегистрирован в `apps/core/api/urls.py`. Структурный прецедент — `VacancyViewSet` (тот же файл, строки 195-211): голый `viewsets.ViewSet` (НЕ `RequirePermissionMixin`), императивный `require_permission(request, "personnel.view")` внутри `list()` (тот же стиль, что уже установлен ИМЕННО для report-подобных, не-CRUD эндпоинтов этого файла — `PositionViewSet`/`StaffingSlotViewSet` используют декларативный `RequirePermissionMixin`, но те — CRUD над реальными моделями, этот эндпоинт — агрегатный отчёт без единичного «объекта», тот же класс, что `VacancyViewSet`).
- **Гейт — `personnel.view`** (НЕ изобретается новый код; тот же код, что `StaffingSlotViewSet`/`VacancyViewSet` используют для чтения штатных данных — «штатное расписание» ЭТОТ ЖЕ домен, `EmployeeStaffingAssignment`/`StaffingSlot`). `status.view` (упомянутый в 20.5a's докстринге "As a") НЕ используется — это чтение штатной структуры (personnel), не статусов сотрудников.
- **БЕЗ scope/existence-гарда на `division_id`** (сознательное отличие от 20.1b/20.2b/20.3b) — структурный прецедент `VacancyViewSet.list()` В ЭТОМ ЖЕ ФАЙЛЕ не делает ни `ensure_division_scope`, ни `_ensure_division_exists` для своего `division_id`-параметра (грубый гейт `personnel.view`, дальше — как есть). Не изобретать более строгий контракт для соседнего отчёта того же домена без причины — если понадобится scope, это отдельное решение для ОБОИХ эндпоинтов сразу, не точечная правка одного.
- **Query-параметры**: `division_id` (опционален, ОДИН UUID — не список; `compute_staffing_table`'s `division_ids=None` даёт весь орг, `[division_id]` сужает; множественный список НЕ экспонируется — не запрошен, YAGNI), `business_date` (опционален, `ISO`-дата; дефолт — `timezone.now()`, тот же паттерн, что `VacancyViewSet.list()`'s `date`-параметр, БУКВАЛЬНО скопировать дефолтную логику).
- **Ответ**: `{"business_date": <date>, "count": <int>, "results": [{"division_id", "position_code", "position_name", "allocated", "filled", "vacant"}]}` — тот же конверт `{"count", "results"}`, что `VacancyViewSet.list()` уже возвращает (структурная консистентность внутри одного файла).
- **Out of scope**: экран/печатная форма отчёта (будущая стори); экспорт `.csv`/`.xlsx` (20.4-семейство, отдельная интеграция); множественный `division_id`-список за один вызов (не запрошен, `compute_staffing_table` это поддерживает, эндпоинт — нет); пагинация (тот же неявный контракт, что `VacancyViewSet` — список по числу управлений/должностей в организации, не растёт неограниченно); изменение `compute_staffing_table()`.

## Acceptance Criteria

1. **AC-1.** `GET /api/core/staffing-table/` с правом `personnel.view`, без параметров → 200, `results` содержит строки для ВСЕГО органа (весь орг, `business_date` по умолчанию — сегодня), значения ИДЕНТИЧНЫ прямому вызову `compute_staffing_table(today, None)`.
2. **AC-2.** Без права `personnel.view` → 403 `PERMISSION_DENIED`.
3. **AC-3.** `division_id=<uuid>` → `results` содержит ТОЛЬКО строки этого управления (совпадает с `compute_staffing_table(date, [division_id])`).
4. **AC-4.** `business_date=<date>` в прошлом → `results` соответствует прямому вызову `compute_staffing_table(business_date, ...)` на эту дату (слоты/назначения, валидные на эту дату, не на сегодня).
5. **AC-5.** Невалидный `business_date` (напр. `not-a-date`) → 400 (не 500).
6. **AC-6.** Строка с `filled > allocated` (рассинхрон-сценарий, 20.5a's AC-2) — присутствует в ответе как есть (`vacant` отрицательный), НЕ отфильтровывается и НЕ гейтится ошибкой.
7. **AC-7.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Экран/печатная форма отчёта.
- Экспорт `.csv`/`.xlsx` (20.4-семейство).
- Множественный `division_id`-список за один вызов.
- Пагинация.
- Изменение `compute_staffing_table()`.

## Tasks / Subtasks

- [x] Task 1 — `apps/core/api/views.py`: `StaffingTableViewSet(viewsets.ViewSet)` — `list()`-экшен, структурный образец `VacancyViewSet` (императивный `require_permission`, `parse_date`-паттерн для `business_date`, конверт `{"business_date", "count", "results"}`).
- [x] Task 2 — `apps/core/api/urls.py`: `router.register("staffing-table", StaffingTableViewSet, basename="staffing-table")`.
- [x] Task 3 — Тесты (AC 1-6): `apps/core/tests/test_staffing_table_api.py` (рядом с `apps/core/tests/test_staffing_table.py`, 20.5a's юнит-тесты селектора — этот файл тестирует HTTP-слой отдельно).
- [x] Task 4 — `make gate` (Backend/VAPS) — включая `test_rbac_matrix.py`'s аналог для `core`-роутов, если существует (сверить — `core`/`operations` могут иметь РАЗНЫЕ реестры полноты роутов, не предполагать), и `make schema` (регенерация `schema.yaml`).

### Review Findings

- [x] [Review][Patch] Malformed `division_id` доходил до ORM-фильтра без валидации — потенциальный сырой 500 вместо 400 [Backend/VAPS/apps/core/api/views.py:245]
- [x] [Review][Patch] `timezone.now().date()` — UTC-дата, известный класс TZ-бага на положительном UTC-смещении — заменён на `Clock.today_local()` [Backend/VAPS/apps/core/api/views.py:244]
- [x] [Review][Defer] Та же незащищённость `division_id` в соседних `EmployeeViewSet`/`VacancyViewSet` [Backend/VAPS/apps/core/api/views.py] — deferred, pre-existing, не в этом диффе
- [x] [Review][Defer] Нет границ на `business_date` (историческая/будущая дата) — deferred, established convention, нет риска фабрикации
- [x] [Review][Defer] Нет `@extend_schema`/явного `Serializer`-класса — deferred, established convention (`VacancyViewSet` тоже без неё)

## Dev Notes

- `apps/core/api/views.py:195-211` (`VacancyViewSet`) — СТРУКТУРНЫЙ ОБРАЗЕЦ ЦЕЛОГО ЭКШЕНА: `require_permission(request, "personnel.view")` первой строкой; `date_str = request.query_params.get("date")` → `parse_date(date_str)` → `timezone.make_aware(dt.datetime.combine(..., dt.time.min))` если задан, иначе `timezone.now()`; конверт `{"count": len(free), "results": results}`. Новый `StaffingTableViewSet` — БУКВАЛЬНО тот же паттерн параметра даты (переименовать `date` в `business_date` для ясности семантики, но логика дефолта та же).
- `apps/core/selectors.py` (`CoreStaffingSelector.compute_staffing_table`, 20.5a) — принимает `business_date` (`datetime.date`, НЕ `datetime`! — сверить точную сигнатуру перед вызовом: `local_midnight(business_date)` внутри селектора уже делает date→datetime-конверсию, эндпоинт передаёт `date`, не aware-datetime, в отличие от `VacancyViewSet`'s `compute_free_slots(division_id, on_date=<aware datetime>)` — РАЗНЫЕ сигнатуры соседних функций, не путать) и `division_ids=None|List[UUID]`.
- `apps/core/api/urls.py` — единый роутер `apps.core.api`-viewset'ов (отдельный от `apps.operations.api.urls`, `/api/core/...`-префикс — сверить точный mount-путь в главном `urls.py` проекта, не предполагать).
- **RBAC-матрица**: `apps/operations/tests/test_rbac_matrix.py`'s `MATRIX`/`SERVED` — сверить, покрывает ли этот тест-файл ТОЛЬКО `apps.operations.api.urls`-роуты или ВЕСЬ проект (включая `core`) — если `core`-роуты вне его области видимости, эта стори НЕ должна добавлять туда строку (было бы ложным добавлением в несвязанный реестр) — проверить эмпирически (`make gate`, смотреть, ловит ли `test_matrix_covers_every_registered_route` новый `core`-роут), не гадать по прецеденту operations-историй (20.1b/20.2b/20.3b).
- Тесты: структурный образец — `apps/core/tests/test_staffing_table.py` (20.5a's юнит-тесты селектора, фикстуры `StaffingSlot`/`EmployeeStaffingAssignment`) + `apps/core/api/`-тесты для существующих viewset'ов (сверить точный паттерн аутентификации `APIClient`/`X-User-Id`/`X-User-Permissions` — core's `require_permission` читает `request.effective_permissions`, ПОПУЛЯРНОЕ через operations authz seam — сверить, как ЭТО делается в существующих `core`-API-тестах, механизм МОЖЕТ отличаться от `operations`-тестов' `UserRole.objects.create`, не предполагать).

### References

- [Source: _bmad-output/implementation-artifacts/20-5a-штатное-расписание-селектор.md] — селектор, форма возврата, caveat про «текущее vs историческое подразделение слота», Out of Scope пункт «API/эндпоинт HTTP-слоя».
- [Source: Backend/VAPS/apps/core/api/views.py] — `VacancyViewSet`, структурный образец report-подобного эндпоинта в `core`.
- [Source: Backend/VAPS/apps/core/selectors.py] — `CoreStaffingSelector.compute_staffing_table()`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- `VacancyViewSet`'s established `parse_date`-паттерн (`dt.datetime.combine(parse_date(date_str), dt.time.min)`) НЕ проверяет результат `parse_date()` на `None` — невалидная строка дала бы `TypeError`→500. Эта стори сознательно НЕ копировала этот дефект буквально (AC-5 требует 400) — добавлена явная проверка `if business_date is None: raise DomainError(...)`.
- Единая `test_rbac_matrix.py`'s `MATRIX`/`SERVED` покрывает ВЕСЬ проект (интроспекция через `get_resolver()`, не app-scoped) — подтверждено эмпирически (существующие записи `vacancy-list`/`staffing-slot-list` уже были в MATRIX ДО этой стори). MATRIX-строка `"staffing-table-list"` добавлена превентивно, до первого прогона гейта — только `make schema` понадобился как отдельный шаг (описание эндпоинта было учтено сразу верно).

### Completion Notes List

Реализовано по AC 1-7. `StaffingTableViewSet` — новый эндпоинт в `apps/core/api/` (НЕ `operations` — домен селектора 20.5a), структурный образец `VacancyViewSet` (голый `viewsets.ViewSet`, императивный `require_permission("personnel.view")`, `parse_date`-паттерн для `business_date`, но с явной 400-валидацией результата — сознательное отличие от прецедента, см. Debug Log). Конверт ответа `{"business_date", "count", "results"}` зеркалит `VacancyViewSet`. 6 тестов покрывают AC 1-6 (весь орг, без права, фильтр по управлению, прошлая дата, невалидная дата, рассинхрон-сценарий с отрицательным `vacant`). `make gate` (Backend/VAPS) — 4418 passed, 0 regressions, makemigrations «No changes detected».

### File List

- `Backend/VAPS/apps/core/api/views.py` (modified — `StaffingTableViewSet`)
- `Backend/VAPS/apps/core/api/urls.py` (modified — роут `staffing-table`)
- `Backend/VAPS/apps/core/tests/test_staffing_table_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — MATRIX entry)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Закрывает 20.5a's явный out-of-scope «API/эндпоинт HTTP-слоя» — НОВЫЙ эндпоинт в `apps/core/api/` (не `operations`, домен селектора — `core`), структурный образец `VacancyViewSet` (единственный report-подобный прецедент в этом файле). |
| 2026-08-06 | Dev-story: `StaffingTableViewSet` + роут + 6 тестов. MATRIX-строка добавлена превентивно (единая матрица покрывает весь проект, подтверждено эмпирически). `make gate` (Backend/VAPS) — 4418 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: все 7 AC SATISFIED. Blind Hunter и Edge Case Hunter независимо совпали на malformed-UUID `division_id` риске (сырой 500) — исправлено явной валидацией + пустая строка теперь честно трактуется как «без фильтра». Дополнительно превентивно исправлен известный проекту класс TZ-бага (`timezone.now().date()` → `Clock.today_local()`, положительное UTC-смещение прячет полночь). 2 regression-теста добавлены. 3 findings → deferred-work.md (та же UUID-незащищённость в соседних `EmployeeViewSet`/`VacancyViewSet` — pre-existing, не в этом диффе; отсутствие границ `business_date` и `@extend_schema` — established convention, зеркалит `VacancyViewSet`). `make gate` (Backend/VAPS) после патчей — 4420 passed, 0 regressions, makemigrations «No changes detected». Status → done. |
