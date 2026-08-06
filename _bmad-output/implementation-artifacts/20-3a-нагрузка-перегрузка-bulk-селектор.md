---
baseline_commit: 4569412
---

# Story 20.3a: Дашборд нагрузки/перегрузки — bulk-селектор перегрузки (селектор)

Status: done

## Story

As a **держатель права `status.view`/`event.manage`** (потребитель будущего дашборда),
I want **получить дни перегрузки ДЛЯ СПИСКА сотрудников ОДНИМ bulk-вызовом (не в цикле по одному)**,
so that **будущий дашборд нагрузки/перегрузки (FR-32, Story 19.2's явно отложенный «Дашборд перегрузки (Epic 20)») не породит N+1-запрос на каждого сотрудника — NFR-4 явно запрещает «COUNT-в-цикле»/bulk-нарушения при масштабе 5000 сотрудников**.

## Scope Decision

- **Разбор эпика**: epics.md's Story 20.3 — «Дашборд нагрузки/перегрузки». Story 19.2's Scope Decision явно откладывает именно ЭТУ работу: «Дашборд перегрузки (Epic 20)» — out of scope там. `detect_overload_days()` (19.2) — ЧИСТАЯ функция над ОДНИМ `Dict[date, Decimal]` одного сотрудника; `compute_fact_load()` (19.1) — ОДИН запрос НА ОДНОГО сотрудника. Ни одна из существующих функций не bulk — вызов в цикле по 5000 сотрудникам был бы ровно тем анти-паттерном, который NFR-4 (epics.md:92, «bulk-селекторы — запрет COUNT-в-цикле») запрещает явно.
- **`compute_fact_load_bulk(employee_ids, start_date, end_date)`** — НОВАЯ bulk-версия `compute_fact_load()` (19.1): ОДИН запрос (`assignment__employee_id__in=employee_ids`) вместо `employee_id=employee_id`, группировка по `employee_id` в Python — БУКВАЛЬНО тот же приём, что 19.5a's `division_month_calendar()` (bulk-версия `month_calendar()`). `compute_fact_load()` (19.1) РЕФАКТОРЕН вызывать `compute_fact_load_bulk([employee_id], ...)` внутри (не дублирует запрос-логику) — тот же приём, что 19.5a's `month_calendar()`→`_dense_calendar()` рефакторинг (Acceptance Auditor построчно перепроверил семантическую идентичность в том ревью; эта стори повторяет тот же дисциплинированный подход, не «переписывает работающий код без нужды»).
- **`compute_overload_summary(employee_ids, start_date, end_date, *, threshold_hours=Decimal("8"))`** — комбинирует `compute_fact_load_bulk()` + `detect_overload_days()` (19.2, чистая функция, ПЕРЕИСПОЛЬЗУЕТСЯ буквально, не переизобретается) ПО-СОТРУДНИКУ (Python-цикл БЕЗ доп. запросов — `detect_overload_days()` ничего не запрашивает у БД, чистая функция над уже загруженным `Dict`).
- **Принимает `employee_ids` СПИСКОМ, НЕ строит ростер сам** (тот же прецедент, что 19.5a: «Селектор принимает УЖЕ ограниченный список employee_ids... НЕ весь ростер подразделения целиком») — построение списка сотрудников подразделения (через `HistoricalEmployeeSelector.roster_on()`, уже существующий) — ответственность ВЫЗЫВАЮЩЕГО кода (будущий 20.3b/API-слой), не этой стори. Тот же принцип: пагинация/масштаб — свойство вызывающего слоя, не селектора.
- **Только ФАКТ, не план** (PROVISIONAL, сужение scope): 19.2's Dev Notes отмечают «дашборд, вероятно, оба» (план И факт), но эта стори НАМЕРЕННО начинает с ФАКТА (что реально произошло — самый actionable сигнал «кто перегружен ПРЯМО СЕЙЧАС», per FR-32's «перегрузка... на дашборде») — bulk-версия плана (`compute_plan_load_bulk`) — симметричная, но ОТДЕЛЬНАЯ будущая стори при явном запросе, не изобретается здесь без потребителя. Подлежит подтверждению с Bratan, если UX дашборда потребует ОБА одновременно.
- **Возвращает `Dict[UUID, List[date]]`**: сотрудник → его дни перегрузки за период (ПУСТОЙ список, не отсутствие ключа, если сотрудник не перегружен — КАЖДЫЙ переданный `employee_id` присутствует как ключ, тот же принцип, что 19.5a/19.6a's вырожденные дефолты).
- **Out of scope**: API/эндпоинт HTTP-слоя (20.3b); экран дашборда (20.3c+); построение ростера/списка `employee_ids` подразделения (переиспользует существующий `HistoricalEmployeeSelector.roster_on()`, не строится заново); bulk-версия ПЛАНА (`compute_plan_load_bulk`, не запрошена); агрегация по подразделению (счётчик «N перегруженных на управление») — эта стори даёт ТОЛЬКО по-сотруднику детализацию, roll-up по подразделению — будущий тонкий composition-слой (тот же паттерн, что 20.2a, при явном запросе); изменение `detect_overload_days()`/`compute_fact_load()`'s ПОВЕДЕНИЯ (только рефакторинг структуры, семантика идентична).

## Acceptance Criteria

1. **AC-1.** `compute_overload_summary([e1, e2], start, end)`: каждый переданный `employee_id` присутствует как ключ результата.
2. **AC-2.** Сотрудник без перегрузки за период → пустой список `[]` (не отсутствие ключа, не исключение).
3. **AC-3.** Сотрудник с перегрузкой (4+ дня подряд по 8+ часов, тот же порог, что 19.2) → список содержит ВСЕ дни квалифицирующей серии.
4. **AC-4.** ДВА сотрудника с РАЗНЫМИ фактами за один и тот же период → каждый получает СВОЙ корректный список, без перекрёстного смешивания дней между сотрудниками (изоляция по `employee_id` в группировке bulk-запроса).
5. **AC-5.** Пустой список `employee_ids=[]` → пустой `dict`, без исключений, БЕЗ запроса к БД (тот же ранний выход, что 19.5a).
6. **AC-6.** ОДИН SQL-запрос на `compute_fact_load_bulk()`/`compute_overload_summary()` НЕЗАВИСИМО от числа `employee_ids` (`CaptureQueriesContext`/`assertNumQueries(1)`) — доказывает bulk-путь.
7. **AC-7.** `compute_fact_load(employee_id, start, end)` (19.1, рефакторенный на bulk-вызов) возвращает ИДЕНТИЧНЫЙ результат тому, что было ДО рефакторинга (регрессионный тест на существующее поведение — не только новые AC).
8. **AC-8.** `threshold_hours` пробрасывается в `detect_overload_days()` без изменений (кастомный порог применяется одинаково ко всем сотрудникам списка).
9. **AC-9.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- API/эндпоинт HTTP-слоя (20.3b).
- Экран дашборда (20.3c+).
- Построение ростера/списка `employee_ids` — переиспользует `HistoricalEmployeeSelector.roster_on()`.
- Bulk-версия ПЛАНА (`compute_plan_load_bulk`, не запрошена).
- Roll-up по подразделению (счётчик «N перегруженных на управление») — будущая тонкая композиция при запросе.
- Изменение поведения `detect_overload_days()`/`compute_fact_load()` (только структурный рефакторинг).

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/load/selectors.py`: `compute_fact_load_bulk(employee_ids, start_date, end_date)` — bulk-запрос + группировка; рефакторинг `compute_fact_load()` на вызов bulk-версии.
- [x] Task 2 — `apps/operations/load/selectors.py`: `compute_overload_summary(employee_ids, start_date, end_date, *, threshold_hours=Decimal("8"))`.
- [x] Task 3 — Тесты (AC 1-8): `apps/operations/load/tests/test_overload_summary.py` (регрессия `compute_fact_load` подтверждена — все 33 существующих теста `test_selectors.py` проходят без изменений, AC-7).
- [x] Task 4 — `make gate` (Backend/VAPS).

## Dev Notes

- `apps/operations/load/selectors.py:156-186` (`compute_fact_load`, 19.1) — текущая реализация: ОДИН запрос `PlacementAssignmentActual.objects.filter(assignment__employee_id=employee_id, ...)`. Bulk-версия меняет ТОЛЬКО фильтр (`assignment__employee_id__in=employee_ids`) — идентичный гейт (`is_current`+`CLOSED`), идентичная построчная обработка (`_split_hours_by_local_day`+`_clip_to_range`+`_merge`), ЕДИНСТВЕННОЕ структурное отличие — группировка построчных результатов ПО `assignment.employee_id` (доступен через `.select_related("assignment")`, уже в запросе) ПЕРЕД `_merge()` (каждый сотрудник — свой аккумулятор `totals`, не общий).
- `apps/operations/statuses/selectors.py` (`division_month_calendar`, 19.5a) — СТРУКТУРНЫЙ ОБРАЗЕЦ рефакторинга «single→bulk с переиспользованием»: `rows_by_employee: dict[UUID, list] = defaultdict(list)`, один проход по bulk-результату, ЗАТЕМ построчная обработка на каждого сотрудника из ВХОДНОГО списка (не только тех, что есть в bulk-результате — сотрудник без фактов получает ПУСТОЙ аккумулятор, что естественно даёт `{}`/`[]`).
- **КРИТИЧНО (урок review 19.5a)**: `employee_ids` может быть генератором/итератором из вызывающего кода — итерировать ДВАЖДЫ (в `.filter(employee_id__in=...)`, затем в финальном dict comprehension по входному списку) исчерпало бы генератор после первого прохода, молча вернув `{}` вместо реальных данных (High-находка 19.5a's ревью, `employee_ids = list(employee_ids)` в начале функции — обязательно повторить этот фикс СРАЗУ, не ждать ревью).
- `apps/operations/load/selectors.py:126-153` (`detect_overload_days`, 19.2) — чистая функция, `(day_hours, *, threshold_hours=Decimal("8"))` → `List[date]`. Вызывать буквально, для каждого сотрудника из bulk-результата `compute_fact_load_bulk()`.
- `apps/operations/load/tests/test_selectors.py` — существующие тесты `compute_fact_load` (19.1) ДОЛЖНЫ остаться зелёными без изменений после рефакторинга — добавить РЕГРЕССИОННЫЙ тест, явно сравнивающий результат `compute_fact_load()` ДО/ПОСЛЕ (или просто убедиться, что все существующие тесты в файле проходят без правок самих тестов — AC-7).
- `apps/operations/load/tests/test_cumulative_service_hours.py` (19.6a) — структурный образец фикстур (`make_object`/`make_event`/`make_assignment`/`make_actual`, `local()`-хелпер) — переиспользовать для новых тестов, не изобретать заново.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1473] — Story 20.3 формулировка.
- [Source: _bmad-output/planning-artifacts/epics.md#L92] — NFR-4: bulk-селекторы, запрет COUNT-в-цикле.
- [Source: _bmad-output/implementation-artifacts/19-2-перегрузка.md] — `detect_overload_days()`, явный out-of-scope «Дашборд перегрузки (Epic 20)».
- [Source: _bmad-output/implementation-artifacts/19-5-календарь-подразделение-дни.md] — прецедент bulk-рефакторинга (`division_month_calendar`), включая generator-exhaustion review-урок.
- [Source: Backend/VAPS/apps/operations/load/selectors.py] — `compute_fact_load()`/`detect_overload_days()` (19.1/19.2).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-9. `compute_fact_load_bulk(employee_ids, start_date, end_date)` — ОДИН bulk-запрос (`employee_id__in=...`), группировка по `str(employee_id)` (НЕ по самому объекту — при первом прогоне тестов обнаружено, что `PlacementAssignment.employee_id` возвращается ORM как `uuid.UUID`, а тестовые фикстуры/вызывающий код передают строки — `str`/`UUID` одной сущности не равны как dict-ключи Python, KeyError при группировке; исправлено нормализацией через `str()` на обеих сторонах). `compute_fact_load()` (19.1) рефакторен в тонкую обёртку над bulk-версией — все 33 существующих теста `test_selectors.py` проходят БЕЗ ИЗМЕНЕНИЙ (AC-7, регрессия исключена). `compute_overload_summary()` — композиция bulk-факта с существующим `detect_overload_days()` (19.2, чистая функция, переиспользована буквально). 8 новых тестов (AC 1-8, включая `CaptureQueriesContext` на пустом входе и на нескольких сотрудниках). Полная бэкенд-сюита — 4321 passed, 0 regressions.

### File List

- `Backend/VAPS/apps/operations/load/selectors.py` (modified — `compute_fact_load_bulk()`, `compute_overload_summary()`, `compute_fact_load()` рефакторен на bulk-обёртку)
- `Backend/VAPS/apps/operations/load/tests/test_overload_summary.py` (new)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Декомпозирована из epics.md's Story 20.3 в 20.3a (bulk-версия `compute_fact_load` + композиция с существующим `detect_overload_days`, 19.1/19.2) по прецеденту 19.5a's bulk-рефакторинга. 20.3b (API)/20.3c+ (экран) — будущие стори. |
| 2026-08-06 | Dev-story: `compute_fact_load_bulk()` + `compute_overload_summary()` + рефакторинг `compute_fact_load()`. При реализации обнаружен и исправлен str/UUID type-mismatch баг в группировке (до коммита, не после ревью). 8 новых тестов + 33 существующих без изменений. `make gate`-эквивалент — 4321 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Edge Case Hunter точной трассировкой опроверг Blind Hunter's опасения про str/UUID-несогласованность (внешний dict самосогласован по построению — тот же объект пишется и читается); `.select_related("assignment")` подтверждён на месте, N+1-тревога снята. Оба ревьюера сошлись на одном реальном дешёвом пробеле — ни один тест не передавал `uuid.UUID`-объект (только строки); добавлен `test_bulk_accepts_uuid_object_input`. `make gate`-эквивалент после патча — 4322 passed, 0 regressions. Status → done. |
