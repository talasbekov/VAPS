---
baseline_commit: 43958d2
---

# Story 19.4b: GET /api/operations/statuses/calendar/ — месячный календарь сотрудника

Status: done

## Story

As a **держатель права `status.view`**,
I want **получить месячный календарь статусов сотрудника через API**,
so that **будущий React-экран (19.4c+) сможет отрисовать «Календарь Сотрудник × месяц» (FR-37), не изобретая собственный запрос**.

## Scope Decision

- **Продолжение 19.4a** — эта стори добавляет ТОЛЬКО тонкий GET-роут поверх уже существующего `EmployeeStatusSelector.month_calendar()` (19.4a). Никакой новой бизнес-логики.
- **`GET /api/operations/statuses/calendar/`** — НОВЫЙ `@action` на УЖЕ существующем `StatusViewSet` (роутер `statuses` уже зарегистрирован, `apps/operations/api/urls.py:58`) — та же вьюха, что `bulk`/`on-date`, не новый ViewSet/роут.
- **Query-параметры: `division_id`, `employee_id`, `year`, `month`** — `division_id` ОБЯЗАТЕЛЕН, несмотря на то, что технически достаточно `employee_id` (сотрудник однозначно определяет свой календарь) — ПРИЧИНА: буквальное переиспользование УЖЕ существующего scope-паттерна `on_date` (`_ensure_division_scope(actor, "status.view", division_id)` ДО существования, `division_id` — вход, контролируемый пользователем, не требует резолва через БД перед scope-чеком). Альтернатива (резолвить `division_id` сотрудника ИЗ `employee_id` через `HistoricalEmployeeSelector.division_at()`, затем чек scope) потребовала бы СНАЧАЛА подтвердить существование сотрудника, ЗАТЕМ scope — инвертированный порядок относительно принятого в проекте «scope раньше existence» (6.10a, `_ensure_division_exists` вызывается ПОСЛЕ scope именно чтобы не давать oracle постороннему актору) — не изобретается новый oracle-паттерн, переиспользуется существующий буквально.
- **Employee-in-division проверка через `HistoricalEmployeeSelector.roster_on(today, [division_id])`** — ТОТ ЖЕ вызов, что `on_date` использует для получения состава подразделения; `employee_id` ДОЛЖЕН быть в ростере `division_id` на СЕГОДНЯШНЮЮ дату (не на месяц запроса — «сегодня» как точка проверки принадлежности, тот же выбор, что `on_date`'s `business_date`, но здесь всегда «сейчас», поскольку `division_id`/`employee_id` — про ТЕКУЩУЮ орг-принадлежность, а не про исторический срез затребованного месяца, который может быть в прошлом/будущем). Не в ростере → 404 (тот же `ENTITY_NOT_FOUND`-паттерн, что `_ensure_division_exists`).
- **`year`/`month` валидируются DRF `IntegerField`** (границы 1-12 для месяца, разумный диапазон для года) — ДО вызова `month_calendar()` (та уже кидает `ValueError` за пределами 1-12, 19.4a's review-фикс, но HTTP-слой обязан вернуть чистый 400, не 500 от `ValueError`, просочившегося наружу).
- **Ответ — плоский объект `{date: status_type_code}`** (JSON keys — ISO-даты строками, DRF's `DictField` с `date`-ключами не сериализуется напрямую в JSON — конвертация в `Dict[str, str]` на границе вьюхи).
- **Out of scope**: React-экран/компонент (19.4c+); справочник Подразделение × дни (19.5); цвета статусов в ответе (фронт мапит `status_type_code` → `StatusType.color` сам, через уже существующий `/statuses/types/` эндпоинт, 10.1b2 — не дублируется здесь).

## Acceptance Criteria

1. **AC-1.** `GET .../calendar/?division_id=<X>&employee_id=<Y>&year=2026&month=8` держателем `status.view` на `X`, `Y` — активный сотрудник `X` → 200, тело — объект с 31 ключом (датами ISO `YYYY-MM-DD`), значения — коды статусов.
2. **AC-2.** Актор БЕЗ `status.view` на `division_id` → 403 `PERMISSION_DENIED` (тот же код/структура, что `on_date`).
3. **AC-3.** Несуществующий `division_id` (валидный UUID, не в БД) → 404 `ENTITY_NOT_FOUND` (сначала должен пройти scope-чек — держатель БЕЗ прав на фантомный `division_id` получает 403, НЕ 404-oracle; проверяется отдельным тестом).
4. **AC-4.** `employee_id`, НЕ входящий в ростер `division_id` (сотрудник существует, но в ДРУГОМ подразделении, ИЛИ не существует вовсе) → 404 (отдельный код, напр. `ENTITY_NOT_FOUND` с `detail={"employee_id": ...}`).
5. **AC-5.** `month=13`/`month=0` → 400 `VALIDATION_ERROR` (DRF-уровень, до вызова селектора — НЕ 500 от `ValueError`, просочившегося наружу).
6. **AC-6.** Отсутствие любого обязательного параметра (`division_id`/`employee_id`/`year`/`month`) → 400.
7. **AC-7.** OpenAPI-схема (`drf-spectacular`) генерируется без ошибок (`make schema` / `spectacular --fail-on-warn`, если используется в гейте — проверить существующую конвенцию).
8. **AC-8.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- React-экран/компонент (19.4c+, будущая стори).
- Календарь по Подразделению × дни (19.5).
- Цветовая палитра в ответе — фронт использует существующий `/statuses/types/`.
- Кэширование/пагинация ответа (месяц — не более 31 записи, не требуется).

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/statuses/api/serializers.py`: `StatusMonthCalendarQuerySerializer` (`division_id`, `employee_id` — UUIDField; `year`, `month` — IntegerField с `min_value`/`max_value` на `month`).
- [x] Task 2 — `apps/operations/statuses/api/views.py`: `@action(detail=False, methods=["get"], url_path="calendar", url_name="calendar")` на `StatusViewSet`; добавить `"calendar": _VIEW_PERMISSION` в `permission_map`; scope→existence(division)→ростер-проверка(employee)→вызов `month_calendar()`→сериализация ключей в ISO-строки.
- [x] Task 3 — Тесты (AC 1-6): `apps/operations/statuses/tests/test_status_month_calendar_api.py`.
- [x] Task 4 — `docs/registries/error-codes.yaml`: подтверждено — `ENTITY_NOT_FOUND`/`PERMISSION_DENIED`/`VALIDATION_ERROR` уже покрывают этот эндпоинт, новый код не понадобился.
- [x] Task 5 — `make gate` (Backend/VAPS), включая `make schema` (регенерация `schema.yaml`) + `apps/operations/tests/test_rbac_matrix.py` (обнаружено гейтом — новый роут требовал строки в MATRIX, AR-9).

## Dev Notes

- `apps/operations/statuses/api/views.py:46-80` (`_ensure_division_scope`/`_ensure_division_exists`) — переиспользуются буквально, БЕЗ изменений.
- `apps/operations/statuses/api/views.py:152-171` (`on_date`-метод) — СТРУКТУРНЫЙ образец: query-сериализатор → `is_valid(raise_exception=True)` → scope → existence → `HistoricalEmployeeSelector.roster_on(...)` → селектор → `Response(...)`. Новый `calendar`-метод копирует ЭТУ структуру, меняя предмет запроса (один сотрудник, не список).
- `apps/core/selectors.py:420+` (`HistoricalEmployeeSelector.roster_on`) — уже возвращает `{division_id: [employee_id, ...]}` — членство проверяется через `employee_id in roster.get(division_id, [])`, никакого нового селектора не требуется.
- `apps/operations/statuses/selectors.py` (`EmployeeStatusSelector.month_calendar`, 19.4a) — возвращает `Dict[datetime.date, str]`; JSON-сериализация требует `{d.isoformat(): code for d, code in result.items()}` на границе вьюхи (DRF `Response()` сам не умеет `date`-ключи в dict).
- `apps/operations/statuses/api/views.py:84` (`StatusViewSet(RequirePermissionMixin, viewsets.ViewSet)`) — `permission_map` (line ~88) уже словарь `{action_name: permission_code}`; добавить `"calendar": _VIEW_PERMISSION` рядом с `"on_date"`.

### References

- [Source: Backend/VAPS/apps/operations/statuses/api/views.py] — `on_date` (10.1b), структурный образец.
- [Source: Backend/VAPS/apps/operations/statuses/selectors.py] — `EmployeeStatusSelector.month_calendar` (19.4a).
- [Source: Backend/VAPS/apps/core/selectors.py] — `HistoricalEmployeeSelector.roster_on`.
- [Source: _bmad-output/implementation-artifacts/19-4-календарь-сотрудник-месяц.md] — 19.4a (backend-селектор, предшествующая стори).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. `GET /api/operations/statuses/calendar/` — новый `@action` на существующем `StatusViewSet`, структурная копия `on_date` (scope→existence(division)→ростер-членство(employee)→селектор→ответ). `StatusMonthCalendarQuerySerializer` валидирует `month` (1-12) на границе — `ValueError` из `month_calendar()` (19.4a) никогда не долетает до вьюхи. Ответ — `{ISO-дата: status_type_code}` (конвертация `date`-ключей в строки на границе, DRF `Response()` не сериализует `date` как JSON-ключ напрямую). Гейт поймал 2 забытых места: (1) `apps/operations/tests/test_rbac_matrix.py` — AR-9 completeness-гейт требует строку в `MATRIX` для каждого зарегистрированного роута; (2) `schema.yaml` — `make schema` регенерация (проверяется `test_schema_yaml_matches_fresh_generation`). 9 тестов (happy-path, 403 foreign-scope, 403-before-404 порядок, 404 несуществующее подразделение, 404 сотрудник в чужом подразделении, 404 несуществующий сотрудник, 400 невалидный month, 400 отсутствующие обязательные параметры ×2). `make gate` — 4261 passed, 0 regressions.

**Ревью (Blind Hunter + Edge Case Hunter + Acceptance Auditor)** — все 8 AC подтверждены (порядок scope→existence, `roster_on`-переиспользование/ARCH-003, `Clock.today_local()` — всё проверено буквально по коду). Blind Hunter's «High» находка (UUID/str mismatch в `employee_id not in roster.get(...)`, якобы делающая КАЖДОГО сотрудника 404) — ОПРОВЕРГНУТА независимо: Edge Case Hunter прочитал реальный `HistoricalEmployeeSelector.roster_on()` и подтвердил, что `Employee.objects.values_list("id", ...)` на `UUIDField` отдаёт `uuid.UUID`, тот же тип, что DRF's `UUIDField.to_internal_value()` — обе стороны `in`-проверки совпадают по типу; вдобавок `test_happy_path_returns_dense_month` УЖЕ проходил в исходном гейте (не смог бы, будь finding реальным). 1 действие применено: `inline_serializer(..., fields={})` в OpenAPI-схеме вводил в заблуждение (пустой объект вместо реальной формы `{дата: код}`) — заменён на `serializers.DictField(child=serializers.CharField())`, тот же паттерн, что уже используется в `submissions/api/views.py`. 4 регрессионных теста добавлены на найденные пробелы покрытия (год-граница 2000/2100, отсутствующие `year`/`month`, пустой ростер подразделения + случайный `employee_id`). Находка «сотрудник, уволенный после запрошенного месяца, получает 404 при запросе прошлого месяца» — НЕ исправлена: это УЖЕ задокументированное намеренное поведение (docstring `calendar`-метода явно объясняет выбор «сейчас», не «на дату запроса»), не баг. `make gate` — 4266 passed после фикса.

### File List

- `Backend/VAPS/apps/operations/statuses/api/serializers.py` (modified — added `StatusMonthCalendarQuerySerializer`)
- `Backend/VAPS/apps/operations/statuses/api/views.py` (modified — added `calendar` action + import + `permission_map` entry)
- `Backend/VAPS/apps/operations/statuses/tests/test_status_month_calendar_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — added `ops-status-calendar` to `MATRIX`)
- `Backend/VAPS/schema.yaml` (regenerated)

## Change Log

| Date | Change |
|---|---|
| 2026-08-05 | Story created (create-story workflow, 19.4b — API-слой над 19.4a), baseline `43958d2` |
| 2026-08-05 | Implemented (dev-story), status → review |
| 2026-08-05 | Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): fixed misleading empty response schema, added 4 boundary/coverage tests; status → done |
