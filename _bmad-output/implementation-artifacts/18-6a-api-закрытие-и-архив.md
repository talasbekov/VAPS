---
baseline_commit: abce96f
---

# Story 18.6a: API — закрытие и архив

Status: review

## Story

As a **держатель права `event.manage`**,
I want **закрыть ОМ и прочитать его полную историю через REST API**,
so that **фронтовый экран закрытия (18.6c) сможет вызвать уже готовые `close_security_event()` (18.1) и `SecurityEventArchiveSelector` (18.2) сервисы, не дублируя их логику**.

## Scope Decision

- **18.6 decomposed (2026-08-05), тот же прецедент, что 17.7 (2026-08-04)**: у Epic 18 (18.1-18.5) нулевая API-поверхность — все пять стори чисто сервисно-слойные (модель+сервис+тесты, без `@action`/сериализаторов). Единая стори «API/экраны закрытия + аудит + e2e» нарушила бы декомпозиционные правила проекта (backend+frontend, несколько эндпоинтов, реализация+e2e в одном месте) — разбито на 18.6a (эта стори, API: закрытие+архив), 18.6b (API: опрос+налёт+перегрузка), 18.6c (frontend), 18.6d (e2e), зеркально 17.7a-e.
- **Только API-обёртка, НЕ новая бизнес-логика**: `close_security_event()` (18.1, `services.py:2019`) и `SecurityEventArchiveSelector.full_history()` (18.2, `selectors.py:76`) уже полностью реализованы и протестированы на сервисном уровне — эта стори добавляет `@action`'ы на существующий `SecurityEventViewSet`, тонкие сериализаторы (валидация присутствия/типа полей, НЕ бизнес-правил — те остаются в сервисе, тот же принцип, что `JournalEntryCreateSerializer`, 17.7a) и API-тесты. Никаких новых моделей/миграций.
- **Обе actions на существующем `SecurityEventViewSet`, НЕ новый ViewSet**: `close`/`archive` — операции над ОДНИМ `SecurityEvent` (detail=True), буквально та же форма, что `bulletin`/`checklist`/`staffing-demand/approve` и др. — не самостоятельный ресурс со своим URL-неймспейсом (в отличие от `JournalEntryViewSet`, у которого свой глобальный id-namespace).
- **Permission — переиспользуется `event.manage`** (`_PERMISSION` в `views.py:90`), НЕ новый код: и `close`, и `archive` — управление/просмотр состояния ОДНОГО мероприятия, тот же класс действий, что `staffing_demand_approve`/`force_requests` (GET) — обе reads/writes на этом ViewSet по умолчанию используют единый `event.manage`, отдельные коды (`event.journal.view`/`event.journal.create`) — задокументированное ИСКЛЮЧЕНИЕ для журнала (FR-29's read/write audit-trail различие), не общий паттерн. Никакой новой строки в `seed_operations.py` не требуется.
- **`close`: `POST .../close/`** — тело: `{"summaries": [{"sector": str, "summary": str}, ...]}`, полный replacement-набор (не diff, буквально контракт `close_security_event()`). Сериализатор валидирует presence/type ТОЛЬКО (список объектов с двумя строковыми полями) — все бизнес-гварды (покрытие всех секторов, дубликаты, IN_PROGRESS-гейт) уже в сервисе, 400/422 транслируются автоматически через `domain_exception_handler` (никакого try/except в `@action`, established convention — ни одна существующая action в этом ViewSet его не делает).
- **`archive`: `GET .../archive/`** — читает `SecurityEventArchiveSelector.full_history(event)` (dict из ORM-инстансов/списков, НЕ JSON-примитивы) → оборачивается композитным `SecurityEventArchiveSerializer` (`serializers.Serializer`, не `ModelSerializer` — тот же класс решения, что `AssignmentVersionReturnResponseSerializer`/`GenerateForceRequestsResponseSerializer`, композитный ответ из нескольких моделей). 422 на не-`CLOSED` событие — уже гейтится сервисом, автоматическая трансляция.
- **Новый сериализатор `SecurityEventClosureSummarySerializer`** (`ModelSerializer`, поля `id`/`event`/`sector`/`summary`/`created_at`/`updated_at`, `read_only_fields = fields` — read-only response shape, тот же паттерн, что `JournalEntrySerializer`) — единственный сериализатор для `SecurityEventClosureSummary` (18.1), которого пока нет.
- **Out of scope**: опрос/налёт/перегрузка API (18.6b — record_assignment_actual_time/compute_service_hours/flag_post_overload, отдельные сервисы, отдельная стори); фронтовый экран (18.6c); e2e (18.6d); новые permission-коды; пагинация архива (single-event fetch, тот же выбор, что сам селектор).

## Acceptance Criteria

1. **AC-1.** `POST /api/operations/security-events/{id}/close/` с полным набором итогов по всем направлениям на `IN_PROGRESS`-событии → 200, `status_code=CLOSED`, тело — `SecurityEventSerializer`.
2. **AC-2.** `POST .../close/` с пропущенным направлением → 400 `VALIDATION_ERROR`, `details.missing_sectors` содержит недостающий сектор (буквально проброшенный `detail` из `close_security_event()`).
3. **AC-3.** `POST .../close/` на уже `CLOSED`-событии → 422 `INVALID_LIFECYCLE_TRANSITION` (не идемпотентно — буквальный сервисный гейт).
4. **AC-4.** `POST .../close/` без права `event.manage` → 403 (permission-гейт ДО 404-lookup, тот же порядок, что все остальные actions).
5. **AC-5.** `GET /api/operations/security-events/{id}/archive/` на `CLOSED`-событии → 200, тело содержит `event`/`checklist_items`/`sector_posts`/`staffing_demands`/`journal_entries`/`closure_summaries`/`current_assignment_version` (последнее — `null`, если нет текущей версии).
6. **AC-6.** `GET .../archive/` на НЕ-`CLOSED`-событии → 422 `INVALID_LIFECYCLE_TRANSITION`.
7. **AC-7.** `GET .../archive/` без права `event.manage` → 403.
8. **AC-8.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- API для опроса/налёта часов/перегрузки (Story 18.6b).
- Фронтовый экран закрытия/опроса (Story 18.6c).
- e2e полного цикла ОМ (Story 18.6d).
- Новые permission-коды (переиспользуется `event.manage`).
- Пагинация архива.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `SecurityEventClosureSummarySerializer` (ModelSerializer, read-only) + `SecurityEventSectorSummaryItemSerializer`/`SecurityEventCloseSerializer` (thin request-валидация `summaries`) + `SecurityEventArchiveSerializer` (композитный, вложенные существующие сериализаторы + новый closure-summary)
- [x] Task 2 — `apps/operations/events/api/views.py`: `@action(detail=True, methods=["post"], url_path="close")` → `close_security_event()` → `SecurityEventSerializer`; `@action(detail=True, methods=["get"], url_path="archive")` → `SecurityEventArchiveSelector.full_history()` → `SecurityEventArchiveSerializer`; оба — `require_permission(request, _PERMISSION)` ДО `_get_event_or_404(pk)`, `@extend_schema` на каждом (описание + коды ошибок, буквальный образец соседних actions)
- [x] Task 3 — API-тесты (AC 1-7): успешное закрытие/недостающий сектор/повторное закрытие/403-без-права/успешный архив/архив-не-closed/403-без-права — `apps/operations/events/tests/test_closure_archive_api.py`, паттерн `APIClient` + `HTTP_X_USER_ID` + `Role`/`RolePermission`/`UserRole`-фикстуры (буквальный образец существующих API-тестов ViewSet'а)
- [x] Task 4 — `make gate`

## Dev Notes

- `Backend/VAPS/apps/operations/events/services.py:2019` (`close_security_event(event, *, actor, summaries)`) — `summaries: list[dict]` вида `{"sector": str, "summary": str}`, ПОЛНЫЙ replacement-набор (не diff). Ошибки: пустой `actor` → `VALIDATION_ERROR` 400; не-`IN_PROGRESS` → `INVALID_LIFECYCLE_TRANSITION` 422 (под `select_for_update()`); пустой `sector`/`summary` в элементе → `VALIDATION_ERROR` 400; дубликат сектора в payload → `VALIDATION_ERROR` 400 `detail={"duplicate_sector": ...}`; недостающие секторы → `VALIDATION_ERROR` 400 `detail={"missing_sectors": [...]}`; секторы вне `sector_posts` → `VALIDATION_ERROR` 400 `detail={"unknown_sectors": [...]}`. НЕ идемпотентна на уже-`CLOSED` (терминальный переход, повторный вызов → 422 — отличие от `issue_bulletin()`'s идемпотентности). Возвращает мутированный `event`.
- `Backend/VAPS/apps/operations/events/selectors.py:76` (`SecurityEventArchiveSelector.full_history(event)`) — `@staticmethod`, гейт не-`CLOSED` → `INVALID_LIFECYCLE_TRANSITION` 422. Возвращает ПЛОСКИЙ `dict` (не сериализатор, не JSON-примитивы): `{"event": event, "checklist_items": [...], "sector_posts": [...], "staffing_demands": [...], "journal_entries": [...], "closure_summaries": [...], "current_assignment_version": AssignmentVersion|None}`. Шесть отдельных запросов по дизайну (single-event fetch, без пагинации).
- `Backend/VAPS/apps/operations/events/api/views.py:90` (`_PERMISSION = "event.manage"`) — переиспользуется буквально, никакой новой строки в `seed_operations.py`.
- `Backend/VAPS/apps/operations/events/api/views.py:130` (`_get_event_or_404(pk)`) — валидирует `pk.isdigit()` ДО `get_object_or_404` (integer BigAutoField PK, не UUID) — переиспользовать буквально, не изобретать свою 404-логику.
- Установленный порядок в КАЖДОЙ существующей action этого ViewSet: `require_permission(request, _PERMISSION)` → `_get_event_or_404(pk)` → вызов сервиса → `Response(Serializer(...).data)`. НИ ОДНА action не делает try/except вокруг `DomainError` — трансляция полностью автоматическая через `apps/core/api/exception_handler.py`'s `domain_exception_handler` (единственная точка формирования ошибки, `architecture.md`'s §Format Patterns прямо запрещает обходить её ручным `Response`).
- `Backend/VAPS/apps/operations/events/api/serializers.py:283` (`JournalEntryCreateSerializer`) — буквальный образец «тонкой» request-валидации (presence/type, не бизнес-правила) для нового `SecurityEventCloseSerializer`.
- `Backend/VAPS/apps/operations/events/api/serializers.py:248` (`AssignmentVersionReturnResponseSerializer`) — образец композитного response-сериализатора для нового `SecurityEventArchiveSerializer` (несколько вложенных существующих сериализаторов вместо `ModelSerializer` — селектор возвращает НЕ одну модель).
- `Backend/VAPS/apps/operations/events/models.py:705` (`SecurityEventClosureSummary`) — поля `event`(FK)/`sector`(CharField)/`summary`(TextField) + `TimeStampedModel`'s `id`/`created_at`/`updated_at`; `unique_together(event, sector)`.
- Тестовый паттерн: `APIClient()` + `c.credentials(HTTP_X_USER_ID=actor)` (не JWT/сессия), фикстуры `Role`/`RolePermission(permission_code_id=...)`/`UserRole`, отдельный `no_permission_client` для 403-кейса, `pytestmark = pytest.mark.django_db`. Ассерты — статус-код + буквальное тело/`details`, не только «не упало» (established anti-vacuous-assert convention).

### References

- [Source: Backend/VAPS/apps/operations/events/services.py] — `close_security_event()` (18.1).
- [Source: Backend/VAPS/apps/operations/events/selectors.py] — `SecurityEventArchiveSelector` (18.2).
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `SecurityEventViewSet`, `_get_event_or_404`, `_PERMISSION`, `journal_entries`-action (17.7a, ближайший структурный образец combined-verb action).
- [Source: Backend/VAPS/apps/operations/events/api/serializers.py] — `JournalEntryCreateSerializer` (тонкая валидация), `AssignmentVersionReturnResponseSerializer` (композитный response).
- [Source: _bmad-output/implementation-artifacts/17-7a-api-журнал-штаба.md] — структурный прецедент «API-обёртка над готовым сервисом» стори.
- [Source: epics.md FR-30, Story 18.6] — «API/экраны закрытия + аудит + e2e полного цикла ОМ» (эта стори — API-часть закрытия+архива).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. `close`/`archive` — `@action`'ы на существующем `SecurityEventViewSet`, буквально тот же порядок, что все соседние actions (`require_permission` → `_get_event_or_404` → сервис → `Response(Serializer(...).data)`, ни одного try/except — трансляция `DomainError`→JSON полностью автоматическая). Новые сериализаторы: `SecurityEventClosureSummarySerializer` (ModelSerializer, read-only), `SecurityEventCloseSerializer`/`SecurityEventSectorSummaryItemSerializer` (тонкая presence/type-валидация `summaries`, вся бизнес-логика в `close_security_event()`), `SecurityEventArchiveSerializer` (композитный `Serializer`, оборачивает уже существующие сериализаторы + новый closure-summary — `SecurityEventArchiveSelector.full_history()` возвращает dict из нескольких моделей, не одну). Никаких новых permission-кодов (переиспользован `event.manage`), никаких новых моделей/миграций.

Незапланированная, но обязательная правка вне Tasks-списка: два closed-world guard-теста (`test_rbac_matrix.py`, `test_audit_coverage.py`) провалились на первом прогоне `make gate` — оба явно перечисляют КАЖДЫЙ зарегистрированный маршрут ViewSet'а, новые `ops-security-event-close`/`ops-security-event-archive` в них отсутствовали. Добавлены записи (`_Gate("event.manage")` на оба в rbac-matrix; `_Audited()` на `close` в audit-coverage — `archive` read-only, не мутирует, в этой матрице не нужен). `make schema` перегенерирован — диф чисто аддитивный (162 строки, только новые `operationId`'ы `security_event_close`/`security_event_archive`), без изменений существующих путей.

7 API-тестов (`test_closure_archive_api.py`), паттерн `APIClient`+`HTTP_X_USER_ID`+`Role`/`RolePermission`/`UserRole` буквально скопирован с `test_journal_entries_api.py` (17.7a). Обнаружена и обойдена ловушка: `APIClient.post()` по умолчанию шлёт `multipart`, который манглит вложенный список объектов (`summaries`) — `format="json"` явно на каждом вызове (прецедент `test_amend_replace_api.py`). `make gate` — 4150 passed (было 4123), 0 regressions, `makemigrations --check --dry-run` зелёный (миграций и не ожидалось).

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `SecurityEventClosureSummarySerializer`, `SecurityEventSectorSummaryItemSerializer`, `SecurityEventCloseSerializer`, `SecurityEventArchiveSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `close`/`archive` actions on `SecurityEventViewSet`)
- `Backend/VAPS/apps/operations/events/tests/test_closure_archive_api.py` (new — 7 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — `ops-security-event-close`/`ops-security-event-archive` gate entries)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — `ops-security-event-close` audited entry)
- `Backend/VAPS/schema.yaml` (regenerated — additive, new `security_event_close`/`security_event_archive` operations)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-05 | Story создана (create-story). 18.6 разбита на 18.6a-d (тот же прецедент, что 17.7a-e) — эта стори: API-обёртка над `close_security_event()` (18.1) и `SecurityEventArchiveSelector` (18.2), никакой новой бизнес-логики/permission-кодов/моделей. Status → ready-for-dev. |
| 2026-08-05 | Dev-story: `close`/`archive` actions + 4 новых сериализатора + 7 API-тестов + rbac-matrix/audit-coverage closed-world guard записи + `make schema` (аддитивный диф). `make gate` — 4150 passed, 0 regressions. Status → review. |
