---
baseline_commit: c0c79ade
---

# Story 20.6b: Отчёт «сводка по статусам» — API-эндпоинт

Status: done

## Story

As a **держатель права `status.view`**,
I want **получить сводку по статусам (11 отчётных колонок, org-wide/по-подразделению) по HTTP**,
so that **будущий экран/печатная форма отчёта (20.6c+) сможет отобразить сводку без прямого доступа к селектору**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (`statuses`-субдомен, не `submissions`)

**Отличие от 20.2b**: `compute_status_summary()` (20.6a) живёт в `apps/operations/statuses/services/strength_report.py` — субдомен `statuses`, у которого УЖЕ есть HTTP-поверхность (`apps/operations/statuses/api/`, `StatusViewSet`) — НЕ новый субдомен (в отличие от 20.3b's `load`). Новый экшен добавляется на СУЩЕСТВУЮЩИЙ `StatusViewSet`.

- **Разбор 20.6a's явного out-of-scope**: «API/эндпоинт HTTP-слоя (20.6b)». Обёртка (`compute_status_summary(business_date, division_id=None)`, 20.6a) уже полностью реализована и протестирована — эта стори НЕ трогает её логику, только оборачивает в HTTP.
- **Новый `summary` action на `StatusViewSet`** (`apps/operations/statuses/api/views.py`), `@action(detail=False, methods=["get"], url_path="summary")` → `GET /api/operations/statuses/summary/`. Гейт — `_VIEW_PERMISSION` (`status.view`), уже используемый этим же viewset'ом для `on_date`/`calendar` (не изобретается новый код).
- **`business_date` обязателен, `division_id` опционален** — зеркалит `compute_status_summary()`'s сигнатуру буквально (`division_id=None` → org-wide агрегат по поддереву; `division_id=<uuid>` → поддерево этого управления).
- **Scope-гейт ТОЛЬКО когда `division_id` задан** (структурный образец `on_date`'s `_ensure_division_scope`, тот же модуль-локальный хелпер в этом же файле) — org-wide вызов (`division_id` отсутствует) гейтится ТОЛЬКО грубым `status.view` (нет конкретного управления, которое можно бы scope-проверить; тот же принцип, что 20.2b/20.3b's org-wide действия без division-scope).
- **БЕЗ проверки "дата до начала данных" (`assert_report_date_has_data`)** — СОЗНАТЕЛЬНОЕ архитектурное ограничение, НЕ забывчивость: эта функция живёт в `apps.operations.submissions.services`, а `statuses ↛ submissions` — однонаправленная субдоменная цепочка (architecture.md: «statuses ← submissions ← reports»), enforced AST-тестом `test_statuses_does_not_import_submissions` (`apps/operations/tests/test_isolation.py`). Копировать `report_data_horizon()`'s логику локально (тот приём, что 20.1e/20.3b использовали для мелких хелперов) здесь НЕ тривиально — сама функция читает earliest-known-data-point через ORM-запросы к моделям `submissions`-домена, дублирование потребовало бы читать чужие модели напрямую (хуже, чем дублировать чистую функцию). Эта стори добавляет ТОЛЬКО future-date-гейт (самодостаточный, без чужих моделей) — историческая горизонт-проверка остаётся ОТКРЫТЫМ вопросом, зафиксированным в Dev Notes, не решается здесь.
- **Future-date-гейт добавлен превентивно** (урок 20.2b/20.3b): `business_date > сегодня` → 400 (тот же паттерн, что `period`/20.3b, `Clock.today_local()` — НЕ `timezone.now().date()`, урок 20.5b's TZ-патча).
- **Ответ**: `{"business_date", "division_id" (nullable), "staff_total", "list_total", "vacancies", "attached", "columns": {...11 ключей}}` — плоская форма `ReportTotals`, зеркалящая уже установленную схему из `period`'s `totals`-inline_serializer (20.2b's Dev Notes уже описывали эту точную форму).
- **Out of scope**: экран/печатная форма отчёта (20.6c+); экспорт `.csv`/`.xlsx` (20.4-семейство); per-StatusType (не-collapsed) детализация; проверка «дата до начала данных» (архитектурно заблокирована, см. выше — зафиксировано как открытый вопрос); изменение `compute_status_summary()`/`StrengthReportService`.

## Acceptance Criteria

1. **AC-1.** `GET /api/operations/statuses/summary/?business_date=<date>` (без `division_id`) с правом `status.view` → 200, тело — плоский `ReportTotals`, ИДЕНТИЧНЫЙ прямому вызову `compute_status_summary(business_date)`.
2. **AC-2.** `division_id=<uuid>` → тело ИДЕНТИЧНО `compute_status_summary(business_date, division_id=X)` (агрегат по поддереву `X`).
3. **AC-3.** Без права `status.view` → 403 `PERMISSION_DENIED`.
4. **AC-4.** `division_id` задан, держатель БЕЗ scope на это управление → 403 (тот же паттерн, что `on_date`).
5. **AC-5.** Несуществующий `division_id` → 404.
6. **AC-6.** Отсутствующий `business_date` → 400 `VALIDATION_ERROR`.
7. **AC-7.** `business_date` в будущем → 400 (превентивный гейт).
8. **AC-8.** Ответ содержит все 11 отчётных колонок в `columns`.
9. **AC-9.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Экран/печатная форма отчёта (20.6c+).
- Экспорт `.csv`/`.xlsx` (20.4-семейство).
- Per-StatusType (не-collapsed) детализация.
- Проверка «дата до начала данных» (архитектурно заблокирована — `statuses ↛ submissions`, зафиксировано как открытый вопрос).
- Изменение `compute_status_summary()`/`StrengthReportService`.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/statuses/api/serializers.py`: `StatusSummaryFilterSerializer` (`business_date` обязателен, `division_id` опционален).
- [x] Task 2 — `apps/operations/statuses/api/views.py`: `StatusViewSet.summary()` action — `permission_map`-запись, future-date-гейт, условный `_ensure_division_scope`/`_ensure_division_exists` (только если `division_id` задан).
- [x] Task 3 — Тесты (AC 1-8): `apps/operations/statuses/tests/test_status_summary_api.py`.
- [x] Task 4 — `make gate` (Backend/VAPS) — включая `test_rbac_matrix.py` (новая строка `statuses-summary` или аналог, сверить точное имя роута эмпирически) и `make schema`.

### Review Findings

- [x] [Review][Patch] Эндпоинт был единственным потребителем `StrengthReportService` без гарда «дата до начала данных» — спека ошибочно считала это архитектурно заблокированным; добавлен локальный `_assert_status_summary_has_data()` [Backend/VAPS/apps/operations/statuses/api/views.py:93]
- [x] [Review][Patch] Отсутствовал тест на невалидный формат `business_date` [Backend/VAPS/apps/operations/statuses/tests/test_status_summary_api.py]
- [x] [Review][Defer] `compute_status_summary()` молчаливо отбрасывает `warnings`/`violations` [Backend/VAPS/apps/operations/statuses/services/strength_report.py] — deferred, pre-existing дизайн-решение 20.6a
- [x] [Review][Defer] Тесты AC-3/AC-6 проверяют только HTTP-статус, не `error_code` — deferred, established convention всего файла

## Dev Notes

- `apps/operations/statuses/api/views.py:91-101` (`StatusViewSet`, `permission_map`) — добавить `"summary": _VIEW_PERMISSION` рядом с `on_date`/`calendar`.
- `apps/operations/statuses/api/views.py:152-181` (`on_date` action) — СТРУКТУРНЫЙ ОБРАЗЕЦ: форма → (опционально) `_ensure_division_scope`/`_ensure_division_exists` → вызов селектора → `Response`. Новый `summary` — тот же порядок, НО scope/existence-гейт ТОЛЬКО когда `division_id is not None` (в отличие от `on_date`, где `division_id` обязателен).
- `apps/operations/statuses/api/views.py:53-73` (`_ensure_division_scope`/`_ensure_division_exists`) — module-local хелперы, переиспользовать буквально (уже существуют в этом файле, НЕ дублировать заново).
- `apps/operations/statuses/services/strength_report.py` (`compute_status_summary`, 20.6a) — `ReportTotals(staff_total, list_total, vacancies, columns, attached)`, `columns` — dict из 11 ключей (`REPORT_COLUMNS`). Ответ — плоский dict, `columns` как есть (`dict(totals.columns)`).
- **Future-date-гейт**: `Clock.today_local()` (НЕ `timezone.now().date()` — урок 20.5b's TZ-патча, положительное UTC-смещение Asia/Qyzylorда прячет полночь). `apps.core.clock.Clock` — уже импортируется этим файлом (`views.py:33`).
- **РЕШЕНО ревью (Edge Case Hunter, была ошибочно помечена «архитектурно заблокировано» при create-story)**: `report_data_horizon()`'s САМА функция недоступна субдомену `statuses` (живёт в `submissions`), но её ДВЕ половины (`EmployeeStatusSelector.earliest_start()` — `statuses`; `HistoricalEmployeeSelector.earliest_history_start()` — `core`) обе легально читаемы `statuses`. Локальный `_assert_status_summary_has_data()` (module-local ARCH-003-копия, тот же приём, что `_ensure_division_scope`) закрывает этот пробел — гейт добавлен в review-проходе, см. Review Findings.
- RBAC MATRIX: та же единая `test_rbac_matrix.py`'s `MATRIX`/`SERVED` (подтверждено эмпирически в 20.5b — покрывает ВЕСЬ проект через `get_resolver()`), имя роута — `url_name`/`basename`-производное от `StatusViewSet`'s `basename="ops-status"` + `url_path="summary"` → вероятно `"status-summary"` (сверить эмпирически при первом прогоне гейта, DRF `@action`-naming конвенция — не то же самое, что router basename напрямую, `bulk`/`on-date` дали `"status-bulk"`/`"status-on-date"` — свериться с MATRIX's существующими записями для этого же viewset'а перед добавлением строки).

### References

- [Source: _bmad-output/implementation-artifacts/20-6a-сводка-по-статусам-селектор.md] — селектор, форма возврата, Out of Scope пункт «API/эндпоинт HTTP-слоя (20.6b)».
- [Source: _bmad-output/implementation-artifacts/20-2b-расход-отстающие-api.md] — прецедент, урок про границы дат (future-date-гейт применён здесь превентивно).
- [Source: _bmad-output/implementation-artifacts/20-5b-штатное-расписание-api.md] — прецедент, урок про `Clock.today_local()` vs `timezone.now().date()`.
- [Source: Backend/VAPS/apps/operations/statuses/api/views.py] — `StatusViewSet.on_date`, structural precedent.
- [Source: _bmad-output/planning-artifacts/architecture.md#L587] — субдоменная цепочка `statuses ← submissions ← reports`, обоснование НЕ импортировать `report_data_horizon()`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Точное имя роута (`ops-status-summary`, basename `ops-status` + `url_name="summary"`) подтверждено эмпирически первым прогоном тестов (`reverse()` резолвнулся) — совпало с предположением в Dev Notes. MATRIX-строка добавлена превентивно до первого прогона гейта — только `make schema` понадобился отдельным шагом.

### Completion Notes List

Реализовано по AC 1-9. Новый `summary` action на СУЩЕСТВУЮЩЕМ `StatusViewSet` (`apps/operations/statuses/api/`, не новый субдомен). `business_date` обязателен, `division_id` опционален (org-wide без него). Future-date-гейт (`Clock.today_local()`, урок 20.5b) применён превентивно; проверка «дата до начала данных» НЕ добавлена — архитектурно заблокирована (`statuses ↛ submissions`, `report_data_horizon()` живёт в чужом субдомене), зафиксирована как открытый вопрос в Dev Notes. Scope/existence-гейт (`_ensure_division_scope`/`_ensure_division_exists`, уже существующие module-local хелперы) применяется ТОЛЬКО когда `division_id` задан. 7 тестов покрывают AC 1-7 (org-wide, по-подразделению, без права, чужой scope, несуществующее управление, отсутствующая дата, будущая дата) + AC-8 (все 11 колонок явно проверены в первом тесте). `make gate` (Backend/VAPS) — 4437 passed, 0 regressions, makemigrations «No changes detected».

### File List

- `Backend/VAPS/apps/operations/statuses/api/serializers.py` (modified — `StatusSummaryFilterSerializer`)
- `Backend/VAPS/apps/operations/statuses/api/views.py` (modified — `summary` action + `_assert_status_summary_has_data()` + imports + permission_map)
- `Backend/VAPS/apps/operations/statuses/tests/test_status_summary_api.py` (new, modified after review)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — MATRIX entry)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, twice)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Закрывает 20.6a's явный out-of-scope «API/эндпоинт HTTP-слоя» — новый `summary`-action на существующем `StatusViewSet` (не новый субдомен, в отличие от 20.3b). Future-date-гейт применён превентивно (урок 20.2b), но проверка «дата до начала данных» НЕ добавлена — архитектурно заблокирована (`statuses ↛ submissions`), зафиксирована как открытый вопрос. |
| 2026-08-06 | Dev-story: `summary` action + сериализатор + 7 тестов. MATRIX-строка добавлена превентивно (имя роута подтверждено эмпирически). `make gate` (Backend/VAPS) — 4437 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor, включая исследовательский суб-агент по консюмерам `StrengthReportService`). Acceptance Auditor: все 9 AC SATISFIED. Blind Hunter и Edge Case Hunter независимо совпали на самом серьёзном пробеле — эндпоинт единственный без гарда «дата до начала данных»; исследование ОПРОВЕРГЛО исходную предпосылку спеки «архитектурно заблокировано» (обе половины `report_data_horizon()` доступны `statuses` через существующие импорты) — добавлен локальный `_assert_status_summary_has_data()` ПОСЛЕ scope/existence-гейта (порядок 6.10a) + тест на невалидный формат даты. 2 findings → deferred-work.md (отброшенные `warnings`/`violations` — pre-existing решение 20.6a; тесты без проверки `error_code` — established convention файла). `make gate` (Backend/VAPS) после патча — 4439 passed, 0 regressions, makemigrations «No changes detected». Status → done. |
