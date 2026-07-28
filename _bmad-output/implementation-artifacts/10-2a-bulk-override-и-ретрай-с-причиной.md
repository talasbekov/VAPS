---
baseline_commit: 67aa31d
---

# Story 10.2a: Bulk-override и ретрай с причиной

Status: done

## Story

As a **оператор управления**,
I want **отправить bulk-обновление повторно с `override: true` + причиной, когда единственная причина отказа — soft-конфликты (409 `STATUS_OVERLAP_WARNING`)**,
so that **массовое обновление не упирается в стену при законном обходе (BR-003), а обход остаётся аудируемым событием (SM-C1), а не молчаливым обходом мимо системы**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/10-2-экран-массового-обновления.md` (Решение №4, "10.2a обязана забрать"); `apps/operations/statuses/services/status_service.py:248-343` (`create_status` override/`_assert_no_conflict` — эталонный single-status паттерн); `frontend/src/shared/api/useApiMutation.ts:99-115` (`confirmOverride` — уже существующий, ОБЩИЙ ретрай-механизм, не построенный этой стори).

1. **AC-1 (bulk override обходит ТОЛЬКО soft, атомарно).** Given payload, где ВСЕ отказавшие строки — soft-конфликты (409), When повторяю с `override: true, override_reason: "<10-500 символов>"`, Then все строки создаются одной транзакцией; каждая обойдённая строка получает `Override`-запись (ссылка на созданный `EmployeeStatus`, `conflicts` — снапшот обойдённых soft-конфликтов, `reason`, `created_by=actor`).
2. **AC-2 (hard никогда не обходится — даже с override:true).** Given payload с ХОТЯ БЫ ОДНОЙ hard-строкой (422 `OVERLAPPING_HARD_STATUS`), When повторяю с `override: true`, Then hard-строка отказывает как обычно (422, в `detail.rows[]`), НИЧЕГО не пишется — override двигает только soft-ветку `_assert_no_conflict`-эквивалента, hard-проверка `report.hard` НЕ читает `override` (тот же инвариант, что single-status).
3. **AC-3 (override требует непустую причину → 400 ДО conflict-детекции).** Given `override: true, override_reason: ""` (или отсутствует), Then **400** `VALIDATION_ERROR`, `detail.field="override_reason"`, ничего не проверяется/не пишется (мираж single-status: `if override and not (override_reason or "").strip()`).
4. **AC-4 (10–500 символов — НЕ бэк-граница, только фронт).** Бэк проверяет ТОЛЬКО непустоту (Решение 8.5 явно зафиксировано: расхождение бэк/фронт по длине — ФРОНТ несёт границу 10–500 через `ConflictDialog`/`REASON_MIN`/`REASON_MAX`; бэк-валидацию длины НЕ добавлять).
5. **AC-5 (аудит per-row).** Каждая обойдённая строка пишет `OVERRIDE_APPLIED` (уже в реестре, `docs/registries/audit-events.yaml:152`, provenance 4.4/3.5) через `record_many` (не `record` в цикле — NFR-4 constant-query контракт бесперебоен). Существующий `STATUS_CREATED`/`STATUS_BULK_CREATED` — без изменений.
6. **AC-6 (override:false/отсутствует — регресс нулевой).** Без `override` в теле — идентичное поведение существующему 10.1a (все soft → 409 агрегат, 0 строк написано). `BulkStatusCreateSerializer.override` — `default=False`, полностью обратно совместимое расширение.
7. **AC-7 (фронт: ConflictDialog открывается, `confirmOverride` уходит правильным телом).** Given чисто-soft bulk-отказ (409 `STATUS_OVERLAP_WARNING`, тот же код, что и `OVERRIDABLE_CODES`), Then `DailyUpdatePage` БОЛЬШЕ НЕ гасит `conflict`-стейт — рендерит `ConflictDialog`; «Подтвердить оверрайд» (после 10–500 валидации внутри диалога) зовёт `mutation.confirmOverride(reason)`, который спредит ИСХОДНОЕ тело `{business_date, rows}` + `override: true, override_reason: reason` (уже реализовано в `useApiMutation`, НЕ переписывается) — ОДИН повторный POST.
8. **AC-8 (mixed/hard-отказ — ConflictDialog НЕ открывается).** Given агрегат содержит hard-строку (422), Then `error_code` = `OVERLAPPING_HARD_STATUS` (НЕ в `OVERRIDABLE_CODES`) → `useApiMutation` не поднимает `conflict`-стейт (естественное следствие кода агрегата, без доп. логики во фронте) — инлайн-панель по-прежнему рендерит per-row детали.
9. **AC-9 (успешный оверрайд обновляет UI как обычный успех).** После успешного `confirmOverride`-запроса — тот же `onSuccess`-путь, что обычный bulk-успех (10.2: `yesterday` обновляется, счётчик применённых, дельты гасятся). Никакой отдельной ветки успеха для override.
10. **AC-10 (регресс нулевой).** Существующие 10.1a/10.1b/10.1b2 API-тесты, `bulk_status_service`-юнит-тесты (3.8), `status_service.create_status` (3.5/3.6) — без правок логики. `make gate`/`npm run gate` зелёные.

## Tasks / Subtasks

- [x] Task 1 — Бэк: `bulk_create_statuses` принимает override (AC: 1, 2, 3, 5, 6)
  - [x] Сигнатура: `bulk_create_statuses(rows, *, actor, business_date, allowed_division_ids, override=False, override_reason="")`.
  - [x] Guard ДО conflict-детекции (мираж `create_status`): `if override and not (override_reason or "").strip(): raise DomainError("VALIDATION_ERROR", 400, detail={"field": "override_reason"}, ...)`.
  - [x] В per-row цикле: `if report.soft: if override: bypassed[row_index] = report.soft (via _conflict_details); continue  # не в row_errors  else: raise DomainError(...)` (существующая ветка). `report.hard` — БЕЗ изменений, всегда raise.
  - [x] После bulk_create EmployeeStatus: для строк с bypassed-конфликтами — `Override.objects.bulk_create([...])`, каждая ссылается на СООТВЕТСТВУЮЩИЙ созданный `EmployeeStatus` (порядок `rows`/`objects`/`created` идентичен и сохраняется `bulk_create` — Postgres возвращает PK-заполненные объекты).
  - [x] `record_many` для `OVERRIDE_APPLIED` (по одной записи на обойдённую строку), ПОСЛЕ существующего `STATUS_CREATED`-`record_many`/`STATUS_BULK_CREATED`-`record`.
- [x] Task 2 — Сериализатор (AC: 3, 4, 6)
  - [x] `BulkStatusCreateSerializer`: `override = serializers.BooleanField(required=False, default=False)`, `override_reason = serializers.CharField(required=False, allow_blank=True, default="")` — верхнеуровневые (не per-row: single reason на весь bulk-ретрай, зеркалит `confirmOverride`'а спред всего тела).
- [x] Task 3 — Вьюха (AC: 1, 6)
  - [x] `bulk`-экшен: пробрасывает `override=form.validated_data["override"], override_reason=form.validated_data["override_reason"]` в сервис.
  - [x] `@extend_schema` description дополняется упоминанием override-поведения.
- [x] Task 4 — Фронт: снять squash conflict-стейта (AC: 7, 8, 9)
  - [x] `DailyUpdatePage.tsx`: убрать `useEffect` с `dismissConflict()`-сквошем; заменить на рендер `<ConflictDialog conflict={mutation.conflict} onOverride={mutation.confirmOverride} onCancel={mutation.dismissConflict} />`.
  - [x] `bulkErrors.ts`: обновить докстринг-комментарий "ещё одна причина не звать ConflictDialog (Решение №4 стори)" — Решение №4 закрыто этой стори, комментарий больше не актуален.
  - [x] Тело мутации (`BulkRequestBody`/`toBulkRequest`): убедиться, что тип позволяет опциональные `override`/`override_reason` (через каст `useApiMutation` уже делает `as TVariables` — TS-поверхность мутации не обязана менять форму, но schema.d.ts после regen должна содержать поля).
- [x] Task 5 — Регенерация схемы (AC: 6, 10)
  - [x] `make schema` + `npm run generate:api`.
- [x] Task 6 — Бэк-тесты (`test_bulk_status_api.py`, MOD или новый файл `test_bulk_status_override_api.py`) (AC: 1-6, 10)
  - [x] AC-1: чисто-soft payload + override:true+валидная причина → 201, `EmployeeStatus.objects.count()==N`, `Override.objects.count()==N` (или сколько строк реально было soft), `Override.conflicts` непусты.
  - [x] AC-2: mixed (1 hard + 1 soft) + override:true → 422 (hard код), 0 EmployeeStatus, 0 Override (override НЕ спасает hard).
  - [x] AC-3: override:true, override_reason:"" → 400, `detail.field=="override_reason"`, 0 записей.
  - [x] AC-3b: override_reason="x" (1 символ, короче фронт-границы 10) → бэк ПРИНИМАЕТ (только непустота) — 201, доказывает AC-4 (бэк не проверяет длину).
  - [x] AC-5: audit — `AuditLog.objects.filter(action="OVERRIDE_APPLIED").count()` == число обойдённых строк, `entity_type="override"`.
  - [x] AC-6: override отсутствует в payload (как раньше) → идентичное существующему поведению (409 агрегат, 0 записей) — регресс-пин повторяет существующий `test_bulk_soft_conflict_409_rows_nothing_written`.
- [x] Task 7 — Юнит-тест бэк-сервиса (`apps/operations/statuses/tests/test_bulk_status_service.py`, если существует — MOD, иначе через API-тесты Task 6 достаточно) (AC: 1, 2)
- [x] Task 8 — Фронт-тесты (`DailyUpdatePage.test.tsx`) (AC: 7, 8, 9)
  - [x] Чисто-soft 409-ответ на bulk → `ConflictDialog` рендерится (MSW handler возвращает `STATUS_OVERLAP_WARNING`).
  - [x] Ввод валидной причины (10-500) + «Подтвердить оверрайд» → второй POST с `override:true, override_reason` в теле (MSW handler ассертит тело второго запроса, возвращает 201) → диалог закрывается, `yesterday`/счётчик обновляются как обычный успех.
  - [x] Mixed/hard-ответ (422 `OVERLAPPING_HARD_STATUS`) на bulk → `ConflictDialog` НЕ рендерится, инлайн-панель показывает per-row детали (существующий путь, регресс-пин).
- [x] Task 9 — Гейт обеих сторон (AC: 10)
  - [x] `make gate`; `cd frontend && npm run gate`.
- [x] Task 10 — Ревью-фикс: `ConflictDialog` для bulk-агрегата (AC: 7, ранее не описан в спеке)
  - [x] `ConflictList` (`shared/ui/ConflictDialog.tsx`) читал только `details.conflicts[]` (форма single-status пути, 3.5) — bulk-агрегат несёт `details.rows[]`, диалог открывался БЕЗ итемизированного списка. Добавлена ветка `bulkRowLabel`/`details.rows[]`-рендер; regression-тест `ConflictDialog.test.tsx`.

## Dev Notes

- **`confirmOverride` — уже построенный, ОБЩИЙ механизм** (`frontend/src/shared/api/useApiMutation.ts:99-115`, Story 8.5): спредит исходное тело мутации + `override:true, override_reason:reason`, один повторный `mutate()`. Эта стори НЕ строит новую фронт-инфраструктуру — только снимает squash в `DailyUpdatePage` и делает бэк способным принять поля, которые `confirmOverride` уже отправляет.
- **Почему bulk был OUT в 10.2**: `bulk_status_service.py` (3.8) был написан ДО существования `override`-паттерна (3.5 появилась позже в хронологии эпиков, но `create_status` уже несёт его) — сериализатор 10.1a не принимал поля, кнопка была бы мёртвой (Решение №4 10.2). Эта стори — буквальное закрытие того дефера.
- **Override — только про SOFT.** `report.hard` в bulk-цикле НЕ читает `override` вообще (как и в `_assert_no_conflict`) — hard-конфликт технически недостижим для обхода архитектурно, не только политикой. Тест AC-2 — не просто happy-path негатив, а доказательство инварианта на уровне кода.
- **`Override.status` — FK, не флэт-UUID** (`apps/operations/statuses/models/override.py:26`, внутри одного app — statuses↔statuses, не cross-context) — Override-объекты создаются ПОСЛЕ `EmployeeStatus.objects.bulk_create()`, так как FK требует существующий PK. Postgres-бэкенд Django возвращает bulk_create'нутые объекты с заполненными PK (без доп. запроса) — этим пользуемся, не делаем повторный SELECT.
- **10–500 — только фронт** (уже задокументировано 8.5, не новое решение): бэк принимает ЛЮБУЮ непустую строку. Тест AC-3b (1-символьная причина проходит бэк) — явное доказательство границы ответственности, а не подразумеваемое.
- **`OVERRIDE_APPLIED` уже в реестре** (`docs/registries/audit-events.yaml:152`, добавлен для single-status 3.5/4.4) — переиспользуется буквально для bulk-контекста, новой registry-записи не требуется.

### References

- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py:190-244,248-343] — эталонный single-status override-паттерн (`_assert_no_conflict`, `create_status`).
- [Source: Backend/VAPS/apps/operations/statuses/services/bulk_status_service.py] — расширяемый bulk-сервис (Story 3.8).
- [Source: Backend/VAPS/apps/operations/statuses/models/override.py] — `Override` модель (FK на `EmployeeStatus`).
- [Source: frontend/src/shared/api/useApiMutation.ts:36-52,99-115] — `confirmOverride`/`conflict`/`dismissConflict` (Story 8.5, уже построено).
- [Source: frontend/src/shared/ui/ConflictDialog.tsx] — общий диалог (`REASON_MIN=10`, `REASON_MAX=500`).
- [Source: frontend/src/features/daily-grid/DailyUpdatePage.tsx:280-300] — squash-эффект, который эта стори снимает.
- [Source: _bmad-output/implementation-artifacts/10-2-экран-массового-обновления.md] — Решение №4, deferred-work строка "10.2a — создать".
- [Source: docs/registries/audit-events.yaml:152] — `OVERRIDE_APPLIED` (переиспользуется).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- **ОТКЛОНЕНИЕ ОТ СПЕКИ (Task 2/3, обнаружено при реализации):** спека предполагала `override = serializers.BooleanField(required=False, default=False)` + `form.validated_data["override"]` (dict-индексация). Фактически — БЕЗ `default=` + `form.validated_data.get("override", False)`: openapi-typescript генерирует поле схемы с `default:` как ВСЕГДА присутствующее в TS-типе (не `field?:`), что сломало бы `tsc` на существующем `mutate(body)`-вызове (обязательные `override`/`override_reason` в каждом теле). `comment`/`document_basis`/`source_ref` уже задают прецедент «просто `required=False`» → optional-поле в сгенерированном типе; та же форма применена здесь. Найдено на этапе `tsc -b`, не ревью — исправлено сразу.
- 3-слойное ревью (Blind Hunter / Edge Case Hunter / Acceptance Auditor) — 0 логических багов, все 10 AC подтверждены. Единственная реальная находка (Blind Hunter): `ConflictDialog`'s `ConflictList` читал только `details.conflicts[]` (форма single-status пути 3.5) — bulk-агрегат несёт `details.rows[]`, диалог открывался бы БЕЗ итемизированного списка конфликтов (не крашился — `Array.isArray`-гвард молча ничего не рендерил). Исправлено (Task 10): `ConflictList` теперь рендерит `details.rows[]` как fallback, когда `details.conflicts[]` отсутствует; regression-тест в `ConflictDialog.test.tsx`.
- `Override.status` — FK (не флэт-UUID, statuses↔statuses внутри одного app) — Override-объекты создаются ПОСЛЕ `EmployeeStatus.objects.bulk_create()` (нужен PK); порядок `rows`/`objects`/`created` идентичен (подтверждено ревью цитатой Django-исходника: `bulk_create` возвращает `objs` в исходном порядке).
- Полный регресс: бэк `apps/operations/` (1848 passed, 3 pre-existing concurrency-teardown ERROR — задокументированы в памяти, не регрессия), `test_schema_drift` зелёный; фронт `npm run gate` — 869 vitest passed, build, size-gate 209.1KB/300 — зелёный.

### File List

- `Backend/VAPS/apps/operations/statuses/services/bulk_status_service.py` (modified — `override`/`override_reason` kwargs, `bypassed`-дикт, `Override.bulk_create`, `OVERRIDE_APPLIED` audit)
- `Backend/VAPS/apps/operations/statuses/api/serializers.py` (modified — `BulkStatusCreateSerializer.override`/`override_reason`, без `default=`)
- `Backend/VAPS/apps/operations/statuses/api/views.py` (modified — пробрасывает override/override_reason через `.get()`)
- `Backend/VAPS/apps/operations/statuses/tests/test_bulk_status_override_api.py` (new, 7 тестов)
- `Backend/VAPS/schema.yaml` (regenerated — `override`/`override_reason` в `BulkStatusCreateRequest`)
- `frontend/src/shared/api/schema.d.ts` (regenerated)
- `frontend/src/features/daily-grid/DailyUpdatePage.tsx` (modified — снят squash-эффект, `ConflictDialog` рендерится, инлайн-панель гейтится `conflict === null`)
- `frontend/src/features/daily-grid/bulkErrors.ts` (modified — обновлён докстринг-комментарий)
- `frontend/src/features/daily-grid/DailyUpdatePage.test.tsx` (modified — обновлён 409-тест на mixed/hard, добавлены 2 новых теста: чисто-soft override retry, отмена диалога; jsdom `<dialog>` полифилл)
- `frontend/src/shared/ui/ConflictDialog.tsx` (modified — Task 10, `details.rows[]`-рендер)
- `frontend/src/shared/ui/ConflictDialog.test.tsx` (modified — Task 10, regression-тест)
