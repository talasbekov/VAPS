---
baseline_commit: 26e3c13
---

# Story 16.8f: API — конфликты версии

Status: review

## Story

As a **любой держатель права чтения Расстановки (assignment.create/.submit/.return/.approve)**,
I want **`GET /api/operations/assignment-versions/{id}/conflicts`**,
so that **я вижу СВЕЖИЙ (пересчитанный) список конфликтующих назначений версии, не только последний сохранённый снимок из `retrieve`**.

`epics.md:1438`: «Story 16.8: API/экраны расстановки + аудит + e2e». Часть 6/9 расщепления (16.8a-e done — черновик+список/деталь, подача, возврат, утверждение, ознакомление).

## Scope Decision (найдено при create-story)

- **Тонкая HTTP-обёртка вокруг УЖЕ существующей `detect_placement_conflicts(version)`** (16.3b-d, `services.py:746-…`) — **READ+RECOMPUTE, не аудируется** (та же конвенция, что `validate_duty_plan()`, 14.11f: "может вызываться часто", сервис САМ пишет `conflict_severity`/`conflict_codes` В БД на каждый вызов — полный пересчёт, не аккумуляция; это НЕ побочный эффект, изобретённый здесь, это уже существующее поведение сервиса 16.3b-d, эндпоинт лишь его вызывает).
- **Действие GET на `AssignmentVersionViewSet`** (не новый ресурс — та же модель `AssignmentVersion`, естественное расширение существующего ViewSet, 16.8a-d), `@action(detail=True, methods=["get"])`.
- **Ответ — ТОЛЬКО конфликтующие строки** (`conflict_severity != ""`), НЕ все `assignments` версии — это то, чем этот эндпоинт РЕАЛЬНО отличается от `retrieve`'s уже существующего вложенного полного списка (16.8a). Если фильтровать не по conflict_severity, эндпоинт был бы избыточным дублем `retrieve`. Сериализатор — переиспользуется `PlacementAssignmentSerializer` (16.8a, `many=True`), НЕ новый.
- **Право — любой из `_ASSIGNMENT_READ_PERMISSIONS`** (`assignment.create/.submit/.return/.approve`, уже существующая константа, 16.8a) — то же, что `list`/`retrieve`, НЕ новый код.
- **`http_method_names` уже `["get", "post", "options"]`** (расширен 16.8b) — GET уже открыт, никаких изменений на уровне класса не требуется.
- **Пустой список — валидный ответ, НЕ 404.** Версия без конфликтов (или ещё не пересчитанная) → `200`, `[]` — отсутствие конфликтов не ошибка.
- **Побочный эффект (перезапись `conflict_severity`/`conflict_codes` в БД) — намеренный, не скрывается.** `detect_placement_conflicts()`'s собственный докстринг уже документирует полный пересчёт при каждом вызове (16.3b-d) — GET, технически не идемпотентный в строгом REST-смысле (мутирует состояние), НО детерминированный (тот же вход → тот же результат) и не создаёт новых сущностей/аудит-строк. Тот же класс, что HTTP GET-эндпоинты, триггерящие кеш/материализацию — приемлемо, т.к. УЖЕ так спроектирован сервисным слоем (не изобретается здесь).

## Acceptance Criteria

1. **AC-1 (`GET .../{id}/conflicts` — конфликтующие есть).** Версия с реальным (двойное назначение) конфликтом → `200`, список содержит ТОЛЬКО строки с непустым `conflict_severity`, поля `conflict_severity`/`conflict_codes` совпадают с ожидаемым (`SOFT`/`["DOUBLE_ASSIGNMENT_CONFLICT"]`).
2. **AC-2 (конфликтов нет — пустой список, не 404).** Версия без конфликтов → `200`, `[]`.
3. **AC-3 (пересчёт СВЕЖИЙ, не устаревший снимок).** Версия изначально БЕЗ конфликта (сохранённый `conflict_severity=""`), затем появляется вторая пересекающаяся версия того же сотрудника ПОСЛЕ первого пересчёта → повторный `GET .../conflicts` возвращает конфликт (доказывает вызов реального пересчёта на каждый GET, не чтение устаревшего сохранённого значения).
4. **AC-4 (несуществующая версия → 404, не 500, включая нечисловой `pk`).**
5. **AC-5 (без любого из `_ASSIGNMENT_READ_PERMISSIONS` → 403).**
6. **AC-6 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `.../conflicts`-эндпоинт для СПИСКА версий (bulk) — не запрашивалось, единичный `{id}` достаточен.
- Изменение самого `detect_placement_conflicts()` — переиспользуется как есть.
- `.../экраны` (16.8h) / e2e (16.8i).

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/views.py`: `conflicts`-действие на `AssignmentVersionViewSet` (GET, AC: 1-5) — `_require_any_permission(request, _ASSIGNMENT_READ_PERMISSIONS)` → `_get_assignment_version_or_404()` → `detect_placement_conflicts(version)` → фильтр `conflict_severity != ""` → `PlacementAssignmentSerializer(qs, many=True).data`
- [x] Task 2 — MATRIX-строка (`_AnyOfGate`, образец `list`/`retrieve`) — AUDIT_MATRIX-строка НЕ нужна (подтверждено чтением: `test_audit_coverage.py`'s гейт покрывает только мутирующие маршруты, `list`/`retrieve` там тоже отсутствуют)
- [x] Task 3 — `make schema` регенерация
- [x] Task 4 — Тесты (AC 1-6, включая нечисловой pk сразу, включая РЕАЛЬНЫЙ конфликт через overlapping-события — 16.8d's тестовый паттерн переиспользуется буквально)
- [x] Task 5 — Гейт

## Dev Notes

- `apps/operations/events/services.py::detect_placement_conflicts()` (16.3b-d, строки 746-…) — читать целиком: full recompute, DOUBLE_ASSIGNMENT_CONFLICT (intra+cross-version) / REST_VIOLATION_CONFLICT / post-requirement mismatch / 3-day overload — все коды пишутся в ОДНОМ проходе на `PlacementAssignment.conflict_severity`/`.conflict_codes`.
- `apps/operations/events/api/views.py::AssignmentVersionViewSet.list`/`.retrieve` (16.8a) — образец `_require_any_permission(request, _ASSIGNMENT_READ_PERMISSIONS)`.
- Для AC-1/3 нужен РЕАЛЬНЫЙ конфликт — переиспользовать 16.8d's тестовый хелпер-паттерн (`test_assignment_version_approve_api.py`'s `test_approve_with_conflict_without_override_is_409` — два overlapping-события, общий `employee_id`, обе версии `SUBMITTED`).
- 14.11f's `validate`-эндпоинт (`apps.operations.duties.api.views`) — референс для "GET/POST-дай-результат-без-аудита"-паттерна, если понадобится подтвердить, что `test_audit_coverage.py`'s гейт не требует строки для read-only действия.
- Тесты 16.8a-e's ревью нашли одинаковый пробел ПЯТЬ раз (нечисловой `pk`) — писать этот тест СРАЗУ.

### References

- [Source: _bmad-output/implementation-artifacts/16-8e-api-отметить-ознакомление.md] — литеральный образец предыдущей стори цикла.
- [Source: Backend/VAPS/apps/operations/events/services.py:746-…] — `detect_placement_conflicts()` (16.3b-d).
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `AssignmentVersionViewSet` (16.8a-e), точка расширения; `_ASSIGNMENT_READ_PERMISSIONS`/`_require_any_permission`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `conflicts`-действие (GET) на `AssignmentVersionViewSet` — `_require_any_permission()` → `_get_assignment_version_or_404()` → `detect_placement_conflicts(version)` (полный пересчёт, существующее поведение сервиса) → фильтр `[a for a in touched if a.conflict_severity]` → `PlacementAssignmentSerializer(conflicted, many=True).data`. MATRIX-строка `_AnyOfGate` (та же четвёрка кодов, что `list`/`retrieve`). AUDIT_MATRIX-строка НЕ добавлена — подтверждено чтением `test_audit_coverage.py`: гейт покрывает только мутирующие маршруты, `list`/`retrieve` там тоже отсутствуют как прецедент. 6 новых поведенческих тестов (AC 1-6), включая нечисловой `pk` сразу и доказательство СВЕЖЕГО пересчёта (два последовательных GET, второй после появления реального конфликта). `make gate` — 3913 passed (было 3897, +16), 0 regressions, ruff чист, `make schema` (26 новых строк), миграций нет.

### File List

- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `conflicts`-действие)
- `Backend/VAPS/apps/operations/events/tests/test_assignment_version_conflicts_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 1 новая строка MATRIX)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, новый эндпоинт)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-03 | Story создана (create-story). Часть 6/9 расщепления Story 16.8. GET-действие на `AssignmentVersionViewSet` (не новый ресурс) — тонкая обёртка над `detect_placement_conflicts()` (16.3b-d), READ+RECOMPUTE (сервис сам пишет в БД на каждый вызов — существующее поведение, не изобретается здесь), фильтр на ТОЛЬКО конфликтующие строки (отличие от `retrieve`'s полного списка). Ultimate context engine analysis completed - comprehensive developer guide created. |
| 2026-08-03 | Dev-story: `conflicts`-действие. 6 новых тестов, включая доказательство свежего пересчёта. `make gate` — 3913 passed, 0 regressions, ruff чист, `make schema`. Status → review. |
