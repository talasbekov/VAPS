---
baseline_commit: 955de1e
---

# Story 20.1b: Готовность ОМ — API-эндпоинт

Status: done

## Story

As a **держатель права `event.manage`**,
I want **получить готовность конкретного ОМ по HTTP (`GET .../readiness`)**,
so that **будущий экран дашборда (20.1c) сможет отобразить блокеры и % готовности без прямого доступа к селектору**.

## Scope Decision

- **Разбор 20.1a's явного out-of-scope**: «API/эндпоинт HTTP-слоя (20.1b)» — эта стори закрывает ровно это. Селектор (`SecurityEventReadinessSelector.readiness_for()`, 20.1a) уже полностью реализован и протестирован — эта стори НЕ трогает его логику, только оборачивает в HTTP.
- **Буквальный прецедент — `SecurityEventViewSet.archive()` action** (18.6a, `apps/operations/events/api/views.py`): `@action(detail=True, methods=["get"], url_path="archive")`, `require_permission(request, _PERMISSION)` (`event.manage`, тот же код, что везде в этом viewset — «нет отдельного `event.view`, читающий переиспользует `event.manage`», установленная конвенция), `_get_event_or_404(pk)` (существующий хелпер, `pk.isdigit()`-гейт + `get_object_or_404`). Новый action `readiness` — СТРУКТУРНАЯ КОПИЯ `archive()`, три строки тела.
- **БЕЗ lifecycle-гейта** (в отличие от `archive()`'s явного «только CLOSED» 422) — `readiness_for()` (20.1a) сама по себе НЕ требует конкретной стадии цикла, она ЧИТАЕТ `event.status_code` как один из пяти блокеров (`demand_ready`), а не как предусловие вызова. Готовность ДОЛЖНА быть запрашиваемой на ЛЮБОЙ стадии — это и есть смысл дашборда («что ещё не готово»), гейт на CLOSED убил бы саму цель фичи (на CLOSED-событии готовность больше не актуальна).
- **`SecurityEventReadinessSerializer(serializers.Serializer)`** — composite-сериализатор (НЕ `ModelSerializer`, тот же класс решения, что `SecurityEventArchiveSerializer`, 18.6a) — 5 `BooleanField` + 1 `IntegerField`, буквально зеркалит `readiness_for()`'s dict-ключи (`checklist_ready`/`demand_ready`/`placement_ready`/`acknowledgement_ready`/`conflicts_ready`/`readiness_pct`).
- **URL**: `GET /api/v1/operations/security-events/{id}/readiness` (nested detail action на существующем `SecurityEventViewSet`, не новый top-level роут — тот же паттерн, что `archive`).
- **Out of scope**: экран дашборда (20.1c+); bulk/список-версия (много событий сразу, не запрошена); live WS-обновления (`ACK_REQUIRED`/`ACK_MISSING_ESCALATION`, зарезервированы для будущего, 20.1a's Dev Notes); изменение `SecurityEventReadinessSelector` (только HTTP-обёртка); детализация «что именно не готово» (drill-down, селектор её и не даёт, см. 20.1a's Out of Scope).

## Acceptance Criteria

1. **AC-1.** `GET .../security-events/{id}/readiness` с валидным `id` и правом `event.manage` → 200, тело содержит 6 полей (`checklist_ready`/`demand_ready`/`placement_ready`/`acknowledgement_ready`/`conflicts_ready`/`readiness_pct`), значения ИДЕНТИЧНЫ прямому вызову `SecurityEventReadinessSelector.readiness_for(event)`.
2. **AC-2.** Без права `event.manage` → 403 `PERMISSION_DENIED`.
3. **AC-3.** Несуществующий `id` → 404.
4. **AC-4.** Нечисловой `id` (напр. `abc`) → 404 (не 500) — тот же гейт, что `_get_event_or_404()`'s `pk.isdigit()`-проверка.
5. **AC-5.** Эндпоинт доступен для события в ЛЮБОЙ стадии цикла (`DRAFT`...`CLOSED`, включая `CANCELLED`) — БЕЗ 422 lifecycle-гейта (в отличие от `archive`).
6. **AC-6.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Экран дашборда (20.1c+).
- Bulk/список-версия по многим событиям.
- Live WS-обновления.
- Изменение `SecurityEventReadinessSelector`.
- Drill-down детализация.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `SecurityEventReadinessSerializer`.
- [x] Task 2 — `apps/operations/events/api/views.py`: `SecurityEventViewSet.readiness()` action.
- [x] Task 3 — Тесты (AC 1-5): `apps/operations/events/tests/test_readiness_api.py`.
- [x] Task 4 — `make gate` (Backend/VAPS).

## Dev Notes

- `apps/operations/events/api/views.py:520-533` (`archive` action) — СТРУКТУРНЫЙ ОБРАЗЕЦ, копировать буквально: `@extend_schema(...)` + `@action(detail=True, methods=["get"], url_path="readiness")` + `def readiness(self, request, pk=None, *args, **kwargs): require_permission(request, _PERMISSION); event = _get_event_or_404(pk); result = SecurityEventReadinessSelector.readiness_for(event); return Response(SecurityEventReadinessSerializer(result).data)`. ЕДИНСТВЕННОЕ отличие от `archive()` — НЕТ lifecycle-проверки перед вызовом селектора (см. Scope Decision).
- `apps/operations/events/api/serializers.py:335-348` (`SecurityEventArchiveSerializer`) — структурный образец composite-`Serializer` (не `ModelSerializer`) поверх dict-возврата селектора. Новый `SecurityEventReadinessSerializer`: `checklist_ready = serializers.BooleanField()`, `demand_ready = serializers.BooleanField()`, `placement_ready = serializers.BooleanField()`, `acknowledgement_ready = serializers.BooleanField()`, `conflicts_ready = serializers.BooleanField()`, `readiness_pct = serializers.IntegerField()`.
- `apps/operations/events/api/views.py:142-145` (`_get_event_or_404`) — уже существует, переиспользовать буквально (не дублировать `pk.isdigit()`-логику).
- `apps/operations/events/api/views.py:32` (`require_permission`, `apps.operations.api.permissions`) — тот же импорт, что везде в файле.
- `apps/operations/events/selectors.py` (`SecurityEventReadinessSelector.readiness_for`, 20.1a) — импорт в `views.py` рядом с существующим импортом `SecurityEventArchiveSelector`.
- Тесты: структурный образец — `apps/operations/events/tests/test_archive_api.py` (если существует) или ближайший API-тест этого viewset (`test_security_event_api.py`/аналог) для паттерна DRF `APIClient`/`force_authenticate`-подобного механизма аутентификации, используемого в этом проекте (сверить точный механизм перед написанием, не гадать).

### References

- [Source: _bmad-output/implementation-artifacts/20-1a-готовность-ом-селектор.md] — селектор, Out of Scope пункт «API/эндпоинт HTTP-слоя (20.1b)».
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `SecurityEventViewSet.archive()`, `_get_event_or_404()`, `require_permission`.
- [Source: Backend/VAPS/apps/operations/events/api/serializers.py] — `SecurityEventArchiveSerializer`, composite-`Serializer` прецедент.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `readiness` action — буквальная структурная копия `archive()` (без lifecycle-гейта), `SecurityEventReadinessSerializer` — composite `Serializer` по образцу `SecurityEventArchiveSerializer`. 5 тестов (403/404/нечисловой pk/любая стадия цикла/полный набор полей). При первом прогоне полной сюиты обнаружены 2 ожидаемых сбоя от добавления нового роута (не баг в реализации, а недостающие обновления реестров): `test_rbac_matrix.py::test_matrix_covers_every_registered_route` (AR-9 — новый роут без строки в MATRIX) → добавлена строка `"ops-security-event-readiness": _Gate("event.manage")`; `test_schema_drift.py` → `make schema` перегенерирован (диф только добавляет новый эндпоинт, без постороннего дрейфа). Полная бэкенд-сюита — 4360 passed, 0 regressions.

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `SecurityEventReadinessSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `readiness` action)
- `Backend/VAPS/apps/operations/events/tests/test_readiness_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — MATRIX entry)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Закрывает 20.1a's явный out-of-scope «API/эндпоинт HTTP-слоя» — буквальная структурная копия `archive()` action, БЕЗ lifecycle-гейта (готовность запрашивается на любой стадии цикла, в отличие от archive's только-CLOSED). |
| 2026-08-06 | Dev-story: `readiness` action + сериализатор + 5 тестов. Обновлены RBAC MATRIX и `schema.yaml` (обязательные реестры для нового роута). `make gate`-эквивалент — 4360 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Edge Case Hunter точной трассировкой снял Blind Hunter's Med-тревоги (object-level RBAC — подтверждён как пред-существующий паттерн archive(); readiness_pct/IntegerField — доказано всегда кратно 20). Три дешёвых улучшения тестов применены: value-ассерты на `acknowledgement_ready`/`conflicts_ready` (были только presence-check), параметризация «любая стадия цикла» на 3 статуса вместо одного, ассерт на `error_code` тела 403-ответа. `make gate`-эквивалент после патча — 4362 passed, 0 regressions. Status → done. |
