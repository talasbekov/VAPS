---
baseline_commit: 52eb05b
---

# Story 10.1c: Схема daily-submissions

Status: done

## Story

As a **фронтенд-разработчик**,
I want **`@extend_schema`-аннотации на `list`/`retrieve`/`create`/`amend` `DailySubmissionViewSet`, регенерированные `schema.yaml`/`schema.d.ts`**,
so that **типы сдачи дня приходят из реальной схемы (ARCH-FE-011), а не из рукописного зеркала сериализаторов, и `tsc` реально работает контракт-тестом (10.3 живёт на Решении №3 — временном зеркале)**.

## Acceptance Criteria

Источник: `sprint-status.yaml:341-346` ("10.1c — бэк: @extend_schema для DailySubmissionViewSet + regen схемы. Сегодня spectacular эмитит «No response body» ⇒ типов сдачи в schema.d.ts НЕТ, 10.3 живёт на рукописном зеркале сериализаторов (Решение №3 стори) и tsc не работает контракт-тестом").

1. **AC-1 (`list`/`retrieve`/`create`/`amend` эмитят тело ответа в schema.yaml).** `@extend_schema` на все 4 действия (`export`/`override_block` уже аннотированы, не трогаются); `test_schema_drift.py` зелёный.
2. **AC-2 (`list` — пагинированный конверт, не голый массив).** `GET /api/operations/daily-submissions/` реально отдаёт `{count, next, previous, results}` (`DailySubmissionPagination`, `LimitOffsetPagination`) — схема отражает ЭТУ форму, не `DailySubmissionSerializer(many=True)` напрямую (иначе схема расходится с реальным телом ответа — тот же класс дефекта, что "закладка на будущее в схеме без реального раскрытия").
3. **AC-3 (query-параметры `list` в схеме).** `DailySubmissionFilterSerializer` (`division_id`, `business_date`, оба `required=False`) отражены как `parameters=` (GET без body — spectacular требует явных `parameters`, паттерн 10.1b).
4. **AC-4 (`retrieve` — детальная проекция).** `responses={200: DailySubmissionDetailSerializer}` — включает `snapshot`/`reason`/`sanction`/`triggered_by_status_id` (в отличие от list-проекции).
5. **AC-5 (`create`/`amend` — форма запроса + 201).** `request=DailySubmissionCreateSerializer`/`DailySubmissionAmendSerializer`, `responses={201: DailySubmissionSerializer}`.
6. **AC-6 (`schema.d.ts` регенерирован, `frontend/src/features/daily-grid/DaySubmissionPanel.tsx`-зеркало МОЖЕТ быть сверено).** `npm run generate:api` подхватывает новые типы; сверка рукописного зеркала (Решение №3 10.3) с реальной схемой — closes the gap, НЕ обязательно переписывать сам компонент этой стори (замена рукописных типов реальными — отдельный, самостоятельный кусок фронта, если структуры разошлись; если совпали — просто доказательство, что зеркало было точным).
7. **AC-7 (регресс нулевой).** Поведение вьюхи (логика list/retrieve/create/amend) НЕ меняется — только аннотации. `make gate`/`npm run gate` зелёные.

## Tasks / Subtasks

- [x] Task 1 — `@extend_schema` на 4 действия (`apps/operations/submissions/api/views.py`, MOD) (AC: 1-5)
  - [x] `list`: `@extend_schema(parameters=[OpenApiParameter("division_id", str, OpenApiParameter.QUERY, required=False), OpenApiParameter("business_date", str, OpenApiParameter.QUERY, required=False)], responses={200: inline_serializer("DailySubmissionListResponse", {"count": IntegerField(), "next": CharField(allow_null=True), "previous": CharField(allow_null=True), "results": DailySubmissionSerializer(many=True)})})` — ручной пагинированный конверт (ViewSet — не GenericViewSet, spectacular не автовычисляет `pagination_class`).
  - [x] `retrieve`: `@extend_schema(responses={200: DailySubmissionDetailSerializer})`.
  - [x] `create`: `@extend_schema(request=DailySubmissionCreateSerializer, responses={201: DailySubmissionSerializer})`.
  - [x] `amend`: `@extend_schema(request=DailySubmissionAmendSerializer, responses={201: DailySubmissionSerializer})`.
- [x] Task 2 — Регенерация схемы (AC: 1, 6)
  - [x] `make schema` (бэк) + `npm run generate:api` (фронт).
- [x] Task 3 — Сверка рукописного зеркала (AC: 6)
  - [x] Найти рукописное зеркало типов сдачи дня в `frontend/src/features/daily-grid/` (Решение №3 стори 10.3) — сверить поля/типы со сгенерированной схемой; расхождения — задокументировать в Completion Notes (замена самого зеркала на схемные типы — отдельная стори, если требует правки компонента; в скоуп 10.1c — только доказать совпадение/расхождение).
- [x] Task 4 — Тесты (AC: 1, 7)
  - [x] `test_schema_drift.py` зелёный (существующий гейт).
  - [x] Регресс: полный набор `apps/operations/submissions/tests/` без изменений поведения.
- [x] Task 5 — Гейт обеих сторон (AC: 6, 7)
  - [x] `make gate`; `cd frontend && npm run gate`.

## Dev Notes

- **Только аннотации, не рефакторинг ViewSet.** `DailySubmissionViewSet` остаётся `viewsets.ViewSet` (не `GenericViewSet`/`ModelViewSet`) — переход на generic-класс дал бы spectacular автовычисление `pagination_class`/`serializer_class`, но это архитектурная правка вне скоупа "добавить @extend_schema" (прецедент: `AuditLogViewSet` — `ReadOnlyModelViewSet` — существует как отдельный, более старый паттерн; смешивать два стиля в одну стори — расширение скоупа).
- **`list`-конверт вручную, не через `PaginatedResponse` DRF-spectacular helper** — `pagination_class` не читается spectacular'ом с bare `ViewSet` (только `GenericAPIView`/`GenericViewSet` производные); `inline_serializer`-конверт — тот же путь, что уже используют `MyPermissionsViewSet`/`BulkStatusCreateResponse` (10.1a) в этом же кодбейсе.
- **`export`/`override_block` НЕ трогаются** — уже аннотированы (7.7-precedent для override_block, story 10.8 для export).

### References

- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml:341-346] — постановка задачи (вынесена из 10.3).
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py:138-263] — `DailySubmissionViewSet` (list/retrieve/create/amend без аннотаций; export/override_block — с).
- [Source: Backend/VAPS/apps/operations/submissions/api/serializers.py] — существующие сериализаторы (переиспользуются буквально, не пишутся заново).
- [Source: Backend/VAPS/apps/operations/statuses/api/views.py] — прецедент `@extend_schema` с `OpenApiParameter` (10.1b) и `inline_serializer` (10.1a).
- [Source: _bmad-output/implementation-artifacts/10-3-экран-сдачи-дня.md] — Решение №3 (рукописное зеркало типов), которое эта стори проверяет.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- **Реальный баг, пойман в процессе (не ревью)**: `list`-конверт изначально был возвращён как `responses={200: inline_serializer(...)}` БЕЗ `extend_schema_serializer(many=False)` — spectacular's эвристика "action == list" завернула УЖЕ пагинированный конверт в ЕЩЁ ОДИН внешний массив (`type: array, items: {$ref: DailySubmissionListResponse}`). Тот же класс дефекта, что `_SingleIssuedExpenseReport`/`MyPermissionsViewSet` уже решали для своих одиночных ответов — применён тот же `many=False`-паттерн. Проверено регенерацией и прямым чтением `schema.yaml`.
- Только аннотации — логика `list`/`retrieve`/`create`/`amend` НЕ тронута (подтверждено диффом: только импорт `OpenApiParameter` + 4 декоратора + 2 несвязанных reformat длинных строк).
- Все ТРИ рукописных зеркала (`DaySubmission`, `DaySubmissionCreateBody`, `DayAmendBody` в `daySubmission.ts`/`amendment.ts`) сверены со сгенерированной схемой поле-в-поле — расхождений нет, замена на схемные алиасы не обязательна (AC-6), задокументирована как необязательный follow-up.
- 3-слойное ревью — 0 новых багов сверх уже пойманного в процессе `many=False`; 1 документационный пробел (комментарий `daySubmission.ts` изначально называл только 2 из 3 сверенных типов) — исправлен.
- Полный регресс: `apps/operations/` (1848 passed, 3 pre-existing concurrency-teardown ERROR — задокументированы в памяти, не регрессия), `test_schema_drift`/`test_isolation` зелёные, `makemigrations --check` "No changes detected"; фронт `npm run gate` — 874 vitest passed, build, size-gate 209.3KB/300 — зелёный.

### File List

- `Backend/VAPS/apps/operations/submissions/api/views.py` (modified — `@extend_schema` на list/retrieve/create/amend, `OpenApiParameter` импорт)
- `Backend/VAPS/schema.yaml` (regenerated — `DailySubmissionListResponse`/`DailySubmissionDetail`/полные request/response body для 4 действий)
- `frontend/src/shared/api/schema.d.ts` (regenerated)
- `frontend/src/features/daily-grid/daySubmission.ts` (modified — докстринг: сверка зеркала со схемой, все три типа)
- `frontend/src/features/daily-grid/amendment.ts` (modified — докстринг: сверка зеркала со схемой)
