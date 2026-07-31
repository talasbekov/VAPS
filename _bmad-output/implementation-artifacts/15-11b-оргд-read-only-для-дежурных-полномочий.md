---
baseline_commit: fec21b13671e031c20f88c9230798eee0c641148
---

# Story 15.11b: ОРГД read-only для временных дежурных полномочий (дотяжка FR-34, часть 2/3)

Status: review

## Story

As a **система авторизации**,
I want **чтобы временное дежурное полномочие ОРГД давало ТОЛЬКО чтение, а не полный набор прав постоянной роли ОРГД**,
so that **срочное дежурство не даёт случайно больше прав, чем предусмотрено FR-34 («ОРГД read-only»)**.

## Scope Decision (найдено при create-story)

- **FR-34 (`epics.md:78`)**: «Дежурные полномочия ОМД/ОРГД: срочные, авто-вкл/выкл; **ОРГД read-only**». Story 15.11a закрыла аудит-разрыв; эта часть закрывает второй, независимый разрыв — тот же research-агент (2 прогона в рамках 15.11a) нашёл его читая `seed_operations.py` напрямую.
- **Реальный, ранее незамеченный разрыв (не гипотеза, подтверждено чтением кода):** `ROLE_PERMISSIONS["ORGD"]` в `apps/operations/management/commands/seed_operations.py:78-84` содержит МУТИРУЮЩИЕ коды — `personnel.edit`, `orgstructure.manage`, `document.upload` (не только `.view`-коды). `PermissionService._active_grants()` (`apps/operations/services.py:29-45`) отдаёт `(scope_division_id, role_code)`-пары ИЗ ОБОИХ источников — постоянного `UserRole` И временного `TemporaryDutyPermission` — АБСОЛЮТНО одинаково; `effective_permissions()` затем джойнит `RolePermission` по `role_code` без различения источника. **Итог: временное дежурство ОРГД сегодня даёт ПОЛНЫЙ набор прав постоянной роли ОРГД, включая мутации — FR-34's «read-only» для ВРЕМЕННОГО пути не соблюдается вообще.**
- **Постоянная роль ОРГД (через `UserRole`) НЕ трогается этой стори** — `ROLE_PERMISSIONS["ORGD"]`-набор для штатных сотрудников ОРГД остаётся как есть (мутирующие права — их постоянная зона ответственности, не FR-34's предмет; FR-34 адресует именно ДЕЖУРСТВО, временный грант). Различать источник гранта — единственный корректный путь, не понижать постоянную роль.
- **Конвенция `.view`-суффикса для read-кодов уже последовательно используется по всему `ROLE_PERMISSIONS`-словарю** (`personnel.view`, `orgstructure.view`, `document.view`, `status.view`, `audit.view` — везде читаемые коды оканчиваются на `.view`, мутирующие — нет). Read-only-фильтр для дежурного ОРГД строится на этой УЖЕ существующей конвенции, а не изобретает новую систему флагов «is_read_only» на `Permission`/`RolePermission` — минимальное, не инвазивное решение.
- **Пользователь, у которого ОДНОВРЕМЕННО есть и постоянная роль ОРГД (`UserRole`), и временный дежурный грант ОРГД (`TemporaryDutyPermission`) — read-only фильтр НЕ применяется** (постоянная роль перекрывает временное ограничение — временный грант в этом случае избыточен по факту, но не должен УРЕЗАТЬ уже имеющиеся постоянные права). Различение — по источнику: read-only применяется, только если role_code="ORGD" встречается ИСКЛЮЧИТЕЛЬНО через `duty`-источник (ни разу через `role`-источник) для данного пользователя.
- **`visible_division_ids()` тоже правится** (не только `effective_permissions()`/`has_permission()`) — обе функции читают один и тот же `_active_grants()`, и `visible_division_ids()` джойнит `RolePermission` тем же `role_code`-путём; несогласованность между «может ли мутировать» (`has_permission`) и «что видит для мутации» (`visible_division_ids`) — предмет UX-путаницы (кнопка показана, действие 403). Проверено: сегодняшние вызовы `visible_division_ids()` в кодовой базе (`submissions/selectors.py`, `submissions/api/views.py`, `statuses/api/views.py`) используют коды `daily_report.mark_update`/`status.manage`/`status.view` — ни один не входит в `ROLE_PERMISSIONS["ORGD"]`, так что на практике коллизии нет СЕГОДНЯ, но закрывается на уровне сервиса, а не «повезло не наткнуться».
- **`_active_grants()` меняет форму возврата** с `(scope_division_id, role_code)` на `(scope_division_id, role_code, source)` (`source` ∈ `{"role", "duty"}`) — оба места деструктуризации (`effective_permissions`, `visible_division_ids`) обновляются в этой же стори; чисто внутренний рефакторинг сервиса, не публичный контракт.

## Acceptance Criteria

1. **AC-1 (дежурный ОРГД без постоянной роли — read-only).** Пользователь с ЕДИНСТВЕННЫМ активным грантом `TemporaryDutyPermission(duty_role_code="ORGD")` (без `UserRole(role_code="ORGD")`) — `effective_permissions()` возвращает ТОЛЬКО `.view`-коды из `ROLE_PERMISSIONS["ORGD"]` (`audit.view`, `personnel.view`, `orgstructure.view`, `document.view`); `personnel.edit`/`orgstructure.manage`/`document.upload`/`daily_report.generate`/`daily_report.override_block` — отсутствуют.
2. **AC-2 (`has_permission` отражает урезание).** `has_permission(user_id, "personnel.edit")` — `False` для дежурного ОРГД без постоянной роли; `has_permission(user_id, "personnel.view")` — `True`.
3. **AC-3 (постоянная роль ОРГД не урезается).** Пользователь с `UserRole(role_code="ORGD")` (без временного гранта, ИЛИ с временным грантом ОРГД одновременно) — `effective_permissions()` возвращает ПОЛНЫЙ набор `ROLE_PERMISSIONS["ORGD"]`, включая мутирующие коды.
4. **AC-4 (ОМД не затронут).** Дежурный грант `duty_role_code="OMD"` — поведение НЕ меняется (read-only-фильтр применяется ТОЛЬКО к `"ORGD"`).
5. **AC-5 (`visible_division_ids` согласован).** Для дежурного ОРГД без постоянной роли `visible_division_ids(user_id, "personnel.edit")` не включает дивизионы, доступные ТОЛЬКО через дежурный грант (тот же принцип, что AC-1, на другой функции).
6. **AC-6 (регресс нулевой).** `make gate` зелёный; ни один текущий вызов `visible_division_ids()` в кодовой базе не переходит на другое поведение (все текущие call-сайты используют `.view`/не-ОРГД-коды — существующие тесты остаются зелёными без изменений).

## Out of Scope

- Аудит выдачи/гашения — закрыто 15.11a.
- WS-уведомления + авто-гашение `is_active` — Story 15.11c.
- Новая модель данных `is_read_only`-флага на `Permission`/`RolePermission` — не нужна, `.view`-конвенция уже существует и последовательна.
- Read-only enforcement для дежурства ОМД — FR-34 не требует этого для ОМД (только для ОРГД); ОМД-дежурство остаётся полноправным.
- `visible_division_ids()`'s edge case, когда БУДУЩИЙ вызывающий передаст мутирующий код, которым ОРГД реально владеет (сегодня такого вызова нет) — покрыто на уровне сервиса превентивно, но нового теста «через реальный HTTP route» для этого нет (нет такого route сегодня).

## Tasks / Subtasks

- [x] Task 1 — `_active_grants()`: вернуть `(scope_division_id, role_code, source)`
- [x] Task 2 — Хелпер `_duty_only_role_codes(grants)`: role_code, встречающийся ИСКЛЮЧИТЕЛЬНО через `"duty"`-источник (не через `"role"`)
- [x] Task 3 — `effective_permissions()`: для `role_code == "ORGD"` из `_duty_only_role_codes` — исключить не-`.view`/не-wildcard коды
- [x] Task 4 — `visible_division_ids()`: тот же фильтр на `holding_roles` для мутирующего `permission_code`
- [x] Task 5 — Тесты (AC 1-5 по отдельности + смешанный случай постоянная+временная роль)
- [x] Task 6 — Гейт

## Dev Notes

- `apps/operations/management/commands/seed_operations.py:78-84` — `ROLE_PERMISSIONS["ORGD"]`, читать точный список кодов перед написанием теста (не полагаться на память).
- `apps/operations/rbac/models.py:71-89` — `TemporaryDutyPermission`, `duty_role_code` = `DUTY_ROLE_CHOICES` (`apps/operations/validators.py`).
- `apps/operations/services.py:16-106` — весь `PermissionService`, читать целиком перед правкой (`_active_grants`/`effective_permissions`/`has_permission`/`visible_division_ids`).
- WILDCARD (`"*"`) — не трогать: ADMIN держит `"*"` только через постоянный `UserRole`, дежурных грантов с `duty_role_code="ADMIN"` не бывает (`DUTY_ROLE_CHOICES` не содержит `ADMIN`) — но код должен НЕ ломаться, если это когда-то изменится (не фильтровать `WILDCARD` как «не-.view»).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:78] — FR-34 текст, «ОРГД read-only».
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py:78-84] — `ROLE_PERMISSIONS["ORGD"]`, реальные мутирующие коды.
- [Source: Backend/VAPS/apps/operations/services.py:16-106] — `PermissionService`, текущая реализация без различения источника.
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py:15] — `READ_PERMISSION = "daily_report.mark_update"`, пример вызывающего кода `visible_division_ids` (не ОРГД-код, коллизии нет).
- [Source: Backend/VAPS/apps/operations/statuses/api/views.py:42] — `_BULK_PERMISSION = "status.manage"`, аналогично не ОРГД-код.

## Dev Agent Record

### Context Reference

- Найдено research-агентом в рамках 15.11a (второй прогон, независимое чтение `seed_operations.py`): «настоящий read-only-разрыв в `ROLE_PERMISSIONS["ORGD"]`» — не самостоятельная гипотеза этой стори, происходит из того же исследования.

### Completion Notes

Реализовано по AC 1-6. `_active_grants()` теперь возвращает `(scope_division_id, role_code, source)` (`source ∈ {"role", "duty"}`) — оба места деструктуризации (`effective_permissions`, `visible_division_ids`) обновлены. Новый `_duty_only_role_codes(grants)`-хелпер возвращает role_code'ы, встречающиеся ИСКЛЮЧИТЕЛЬНО через `"duty"`-источник для конкретного пользователя. `effective_permissions()` для `role_code ∈ (_duty_only_role_codes ∩ {"ORGD"})` отбрасывает permission_code'ы, не оканчивающиеся на `.view` (и не `WILDCARD`) — реализовано построчной фильтрацией на уровне `(role_code, permission_code)`-пар из `RolePermission`, а не постфактум над уже объединённым множеством (иначе теряется атрибуция «какой код от какого гранта пришёл» при union). `visible_division_ids()` получил симметричный фильтр — исключает те же `read_only_role_codes` из `holding_roles`, когда `permission_code` сам мутирующий (не `.view`/не `WILDCARD`), чтобы «видимое для мутации» не расходилось с «может мутировать». Пользователь с ОДНОВРЕМЕННО постоянной И временной ролью ОРГД сохраняет полные права (постоянная роль не урезается временной) — покрыто отдельным тестом. ОМД-дежурство не затронуто (фильтр применяется только к `"ORGD"`). 8 новых тестов в `test_permission_temp_duty.py`. `make gate` — 3651 passed (было 3645, +6 — часть тестов покрывает несколько AC сразу), 0 regressions, no drift.

### File List

- `Backend/VAPS/apps/operations/services.py` (modified — `PermissionService._active_grants()`/`_duty_only_role_codes()`/`effective_permissions()`/`visible_division_ids()`)
- `Backend/VAPS/apps/operations/tests/test_permission_temp_duty.py` (modified — 8 новых тестов)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Часть 2/3 расщепления Story 15.11. Разрыв найден чтением `seed_operations.py`+`services.py` — временный дежурный грант ОРГД сегодня даёт полные (включая мутирующие) права постоянной роли, FR-34's «read-only» не соблюдается. |
| 2026-08-01 | Dev-story: source-тег на `_active_grants()` + read-only фильтр для duty-only ОРГД в `effective_permissions()`/`visible_division_ids()`. Постоянная роль ОРГД не урезается. 8 новых тестов. `make gate` — 3651 passed. Status → review. |
