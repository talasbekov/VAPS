---
baseline_commit: c7be721
---

# Story 17.7a: API — журнал штаба

Status: review

## Story

As a **держатель права `event.journal.create`/`event.journal.view`**,
I want **REST-эндпоинты для записи и чтения журнала штаба (17.1/17.2)**,
so that **фронтенд (17.7c) и внешние клиенты могут вызвать `create_journal_entry()` без прямого доступа к сервисному слою**.

## Scope Decision

- **Нестится ПОД `SecurityEventViewSet`** (`apps/operations/events/api/views.py:128-`), буквальный образец `direct_assignments`'s (16.8) `@action(detail=True, methods=["get", "post"], url_path="...")` — комбинированный GET (список)/POST (создание) на ОДНОМ action, не два отдельных маршрута. `POST /api/operations/security-events/{id}/journal-entries/`, `GET /api/operations/security-events/{id}/journal-entries/`.
- **RBAC уже сеяна** (17.1) — `event.journal.create`/`event.journal.view`, новый код не нужен. `require_permission()` — буквальный образец `direct_assignments`'s вызова.
- **Сервисный слой уже есть** (17.1/17.2) — `create_journal_entry(event, *, actor, entry_type, text, post=None, participant_ids=None, photo_attachment_id=None)`. Этот эндпоинт — ТОНКАЯ обёртка (сериализатор запроса → сервис → сериализатор ответа), логику не дублирует.
- **Детальный эндпоинт** — `GET /api/operations/journal-entries/{id}/` — отдельный ViewSet (`JournalEntryViewSet`, `retrieve`-only, буквальный образец `AssignmentVersionViewSet`'s `list`/`retrieve`-only структуры до появления action'ов) — журнал-запись не «принадлежит» событию по URL для detail-чтения (id уникален глобально).
- **Фильтрация списка по `entry_type`** — query-параметр `?entry_type=INCIDENT` (опционален, без параметра — все типы).
- **`JournalEntrySelector`'s методы** (17.2, `incidents_for_object`/`incidents_for_participant`) — ЭТА стори их НЕ подключает к API (нет запроса от epics.md на «Паспорт Объекта»/«карточка участника» эндпоинты в 17.7's scope; 17.2's Scope Decision явно отложила UI-подключение на «Story 17.7 или дальше» — здесь только базовый CRUD-по-событию/detail, селекторы остаются для будущей стори, если понадобятся).
- **Сериализаторы** — `JournalEntryCreateSerializer` (request: `entry_type`, `text`, опционально `post`/`participant_ids`/`photo_attachment_id`), `JournalEntrySerializer` (response: все поля модели).

## Acceptance Criteria

1. **AC-1.** `POST /api/operations/security-events/{id}/journal-entries/` с `{"entry_type": "BRIEFING", "text": "..."}`, актор с `event.journal.create`, событие `IN_PROGRESS` → 201, тело — созданная запись.
2. **AC-2.** То же без `event.journal.create` → 403.
3. **AC-3.** `entry_type=INCIDENT` без `post` → 400 (тот же `DomainError` из сервиса, транслированный DRF-хендлером).
4. **AC-4.** `GET /api/operations/security-events/{id}/journal-entries/` → список записей события, актор с `event.journal.view`.
5. **AC-5.** `GET .../journal-entries/?entry_type=INCIDENT` → только INCIDENT-записи.
6. **AC-6.** `GET /api/operations/journal-entries/{id}/` → detail одной записи по её собственному id.
7. **AC-7.** Событие не `IN_PROGRESS` → 422 (сервисный `INVALID_LIFECYCLE_TRANSITION`, транслированный).
8. **AC-8.** `make gate` (Backend/VAPS) зелёный, включая `make schema` (drift-тест).

## Out of Scope

- Подключение `JournalEntrySelector`'s методов к API (несуществующие в epics.md 17.7 эндпоинты «Паспорт»/«карточка»).
- Фронтенд (17.7c).
- e2e (17.7e).
- Аплоад фото (существующий 6.1-эндпоинт, не трогается — `photo_attachment_id` принимается готовым).

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `JournalEntryCreateSerializer`, `JournalEntrySerializer`
- [x] Task 2 — `apps/operations/events/api/views.py`: `SecurityEventViewSet.journal_entries` `@action` (GET+POST, буквальный образец `direct_assignments`), `JournalEntryViewSet` (retrieve-only)
- [x] Task 3 — `apps/operations/api/urls.py`: `router.register("journal-entries", JournalEntryViewSet, basename="ops-journal-entry")`
- [x] Task 4 — Тесты (AC 1-8): create/403/400-INCIDENT-без-post/list/filter/detail/422-не-IN_PROGRESS
- [x] Task 5 — `make gate` + `make schema`

## Dev Notes

- `apps/operations/events/api/views.py:376-404` (`SecurityEventViewSet.direct_assignments`) — буквальный образец GET+POST combined `@action`, `require_permission()`, `record()`-паттерн (хотя `create_journal_entry()` УЖЕ пишет свой аудит-ряд внутри сервиса — эндпоинт НЕ дублирует `record()`, только вызывает сервис).
- `apps/operations/events/api/views.py:538-` (`AssignmentVersionViewSet`) — образец `retrieve`-only структуры для отдельного `JournalEntryViewSet`.
- `apps/operations/events/services.py` — `create_journal_entry()` (17.1/17.2), сигнатура и guard-порядок уже финализированы, эндпоинт НЕ добавляет собственную валидацию сверх маппинга полей запроса.
- `apps/operations/api/urls.py` — `DefaultRouter()`, `router.register(prefix, ViewSet, basename=...)`.

### References

- [Source: Backend/VAPS/apps/operations/events/api/views.py:376-404] — `direct_assignments` (образец).
- [Source: Backend/VAPS/apps/operations/events/api/views.py:538-] — `AssignmentVersionViewSet`.
- [Source: Backend/VAPS/apps/operations/events/services.py] — `create_journal_entry()`.
- [Source: Backend/VAPS/apps/operations/api/urls.py] — router-регистрация.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. `journal_entries`-action на `SecurityEventViewSet` (GET+POST, буквальный образец `direct_assignments`), `JournalEntryViewSet` (retrieve-only). Найдено при прогоне `make gate`: (1) `test_matrix_covers_every_registered_route` (RBAC-матрица) и `test_audit_matrix_covers_every_mutating_route` требовали строк для двух новых роутов — добавлены (`_MethodGate` для journal-entries, т.к. GET/POST гейтятся РАЗНЫМИ кодами — `event.journal.view`/`event.journal.create`; `_Gate("event.journal.view")` для detail); (2) permission-гейт стоял ПОСЛЕ `_get_event_or_404()` — анонимный/безправый actor получал 404 вместо 403 на несуществующем pk (RBAC-матрица ловит ЭТО как поведенческий тест, не только структурный) — порядок исправлен на permission-ДО-404, тот же порядок, что у остальных `@action`'ов этого ViewSet. `schema.yaml` перегенерирован (+123 строки — новые сериализаторы/эндпоинты). `make gate` — 4041 passed (было 4001 после закрытия 17.6's ревью), 0 regressions, ruff чист, drift-check чист.

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `JournalEntrySerializer`, `JournalEntryCreateSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `SecurityEventViewSet.journal_entries`, `JournalEntryViewSet`)
- `Backend/VAPS/apps/operations/api/urls.py` (modified — `journal-entries`-роутер)
- `Backend/VAPS/apps/operations/events/tests/test_journal_entries_api.py` (new — 10 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 2 новые строки матрицы)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 1 новая строка матрицы)
- `Backend/VAPS/schema.yaml` (regenerated)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story), часть декомпозиции 17.7 (research подтвердил: `AssignmentVersionViewSet`/router УЖЕ существуют реально, RBAC уже сеяна — 17.7 расширяет существующую инфраструктуру, не строит с нуля). |
| 2026-08-04 | Dev-story: `journal_entries`-action + `JournalEntryViewSet` + сериализаторы + роутинг + 10 новых тестов. Побочный фикс: RBAC/audit-матрицы + guard-порядок (permission ДО 404). `make gate` — 4041 passed, 0 regressions. Status → review. |
