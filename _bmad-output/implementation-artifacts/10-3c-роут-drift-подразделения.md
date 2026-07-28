---
baseline_commit: f9f5d37
---

# Story 10.3c: Роут drift-подразделения

Status: done

## Story

As a **руководитель**,
I want **HTTP-эндпоинт `GET /api/operations/traffic-light/division/`, отдающий per-division светофор с детализацией drift ({status, late, drift:{added,removed,changed}})**,
so that **клик по YELLOW-листу дерева (10.3a) открывает КОНКРЕТНУЮ причину расхождения, а не требует повторного похода в дерево целиком**.

## Acceptance Criteria

Источник: `sprint-status.yaml:357-364` ("10.3c — роут PER-DIVISION светофора с drift-деталями (5.5a): @action url_path="division" на том же TrafficLightViewSet... Другая бизнес-логика (per-employee diff, не свёртка), другой потребитель, другой shape; контракт Q3 запрещает тянуть drift в дерево (5.5a на каждый YELLOW-лист = конфликт NFR-4)").

1. **AC-1 (happy path → 200 + {status, late, drift}).** Given держатель `status.view` со scope на подразделение, GET `?division_id=<D>&business_date=<дата>`, When вызываю, Then **200**, `{status, late, drift}` — байт-в-байт из `division_traffic_light(division_id, business_date)` (5.5a, не пересчитывается вьюхой).
2. **AC-2 (GREEN/RED → `drift: null`).** Given подразделение без расхождения ИЛИ без сдачи (RED), Then `drift` — `null` (сервис уже возвращает `None` для этих статусов — вьюха не подставляет `{}`).
3. **AC-3 (чужой scope → 403 ДО existence).** Given держатель БЕЗ scope на `division_id`, Then **403**, тот же порядок гвардов, что `tree` (10.3a): scope → exists → дата — scoped-чужак на фантомный ID получает 403, не 404-oracle.
4. **AC-4 (несуществующее подразделение → 404).** Given валидный UUID, не существующий как `Division`, ПОСЛЕ прохождения scope, Then **404**.
5. **AC-5 (будущая дата → 400).** Given `business_date > Clock.today_local()`, Then **400** — тот же гвард, что `tree`/`ExpenseReportViewSet.period` (фабриковать светофор из сегодняшнего ростера на будущую дату нельзя).
6. **AC-6 (дата до начала данных → 422).** `assert_report_date_has_data(business_date=...)` — тот же гейт, что `tree`.
7. **AC-7 (структурная валидация query → 400).** Отсутствующий/невалидный `division_id`/`business_date` → 400.
8. **AC-8 (грубый гейт права → 403 ДО вьюхи).** Тот же код `status.view` (`_TRAFFIC_LIGHT_PERMISSION`), что и `tree` — единый гейт на весь `TrafficLightViewSet`.
9. **AC-9 (RBAC-матрица + схема).** `MATRIX["ops-traffic-light-division"]`; `schema.yaml`/`schema.d.ts` содержат роут.
10. **AC-10 (регресс нулевой).** `tree`-экшен (10.3a), `division_traffic_light`/`traffic_light_tree` (5.5a/5.5b) — без правок логики. `make gate`/`npm run gate` зелёные.

## Tasks / Subtasks

- [x] Task 1 — Query-сериализатор (`apps/operations/submissions/api/serializers.py`, MOD) (AC: 7)
  - [x] `TrafficLightDivisionFilterSerializer(serializers.Serializer)`: `division_id=UUIDField()` (ОБЯЗАТЕЛЕН — в отличие от `tree`'s `root_division_id`, здесь нет «дефолт из RBAC-скоупа»: один конкретный лист, не всё дерево), `business_date=DateField(required=False)`.
- [x] Task 2 — `division`-экшен на `TrafficLightViewSet` (`apps/operations/submissions/api/views.py`, MOD) (AC: 1-6, 8)
  - [x] `permission_map["division"] = _TRAFFIC_LIGHT_PERMISSION`.
  - [x] `@action(detail=False, methods=["get"], url_path="division")`: валидирует query → `ensure_division_scope(actor, _TRAFFIC_LIGHT_PERMISSION, division_id)` → `_ensure_division_exists(division_id)` (порядок 6.10a/10.3a: scope сначала) → `business_date = form.validated_data.get("business_date") or Clock.today_local()`; `business_date > Clock.today_local()` → 400 (зеркало `tree`) → `assert_report_date_has_data(business_date=business_date)` → `division_traffic_light(division_id, business_date)` → `Response({"status": result.status, "late": result.late, "drift": result.drift})`.
  - [x] `@extend_schema` с `parameters=` (`division_id` required, `business_date` optional) + `inline_serializer` для `{status, late, drift}` (`drift` — `allow_null=True`, вложенный `{added:[UUID], removed:[UUID], changed:[{employee_id,from,to}]}` или `null`).
- [x] Task 3 — RBAC-матрица (AC: 8, 9)
  - [x] `test_rbac_matrix.py` (MOD): `MATRIX["ops-traffic-light-division"] = _MethodGate({"get": "status.view"})`.
- [x] Task 4 — Регенерация схемы (AC: 9)
  - [x] `make schema` + `npm run generate:api`.
- [x] Task 5 — Тесты (`apps/operations/submissions/tests/test_traffic_light_api.py`, MOD или NEW-секция) (AC: 1-6, 10)
  - [x] AC-1: YELLOW-подразделение (снапшот+live расходятся) → 200, `drift.added/removed/changed` заполнены байт-в-байт с прямым вызовом `division_traffic_light`.
  - [x] AC-2: GREEN (совпадает) и RED (нет сдачи) → `drift: null` в обоих случаях.
  - [x] AC-3: держатель со scope на ДРУГОЕ подразделение → 403.
  - [x] AC-4: несуществующий division_id (валидный UUID) → 404, ПОСЛЕ scope (держатель БЕЗ scope на фантомный ID получает 403, не 404).
  - [x] AC-5: `business_date` в будущем → 400.
  - [x] AC-6: дата до начала данных → 422.
  - [x] AC-7: без `division_id`/невалидный UUID/дата → 400.
- [x] Task 6 — Гейт обеих сторон (AC: 9, 10)
  - [x] `make gate`; `cd frontend && npm run gate`.

## Dev Notes

- **Прямой прецедент — `tree`-экшен (10.3a) на ТОМ ЖЕ `TrafficLightViewSet`.** Порядок гвардов (scope→exists→будущая дата→`assert_report_date_has_data`), `_ensure_division_exists`, весь стиль вьюхи — копируются буквально, не изобретаются заново.
- **`division_id` ОБЯЗАТЕЛЕН, в отличие от `tree`'s `root_division_id`.** `tree` без корня дефолтится на «весь видимый скоуп» (руководитель хочет всё дерево). `division` — точечный запрос ОДНОГО листа (клик по конкретному узлу дерева) — «без division_id = весь скоуп» здесь не имеет смысла (какая строка отдаётся?).
- **Другая бизнес-логика, не редукция `tree`.** `division_traffic_light` (5.5a, own-level per-employee diff) — принципиально другой сервис, чем `traffic_light_tree` (5.5b, cascade fold, per-division only status/late БЕЗ drift). Роут `division` НЕ вызывает `tree`'s сервис с фильтром на один узел — это была бы неверная сигнатура (5.5b's `NEUTRAL`/`UNKNOWN` не существуют в 5.5a's словаре статусов).
- **Почему drift НЕ в дереве (Q3, зафиксировано в sprint-status.yaml).** Дерево (`tree`) агрегирует N узлов ОДНИМ bulk-проходом (NFR-4 — константное число запросов). Вычисление `drift` для КАЖДОГО YELLOW-листа дерева means per-node `division_traffic_light`-вызов = N+1 (тот самый анти-паттерн, который 5.5b решал). Drift — по требованию, для ОДНОГО узла за раз, отдельным роутом.

### References

- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml:357-364] — постановка задачи, порядок 10.3a→10.3c→10.3b.
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py:519-658] — `TrafficLightViewSet.tree` (10.3a, прямой прецедент гвардов/стиля).
- [Source: Backend/VAPS/apps/operations/submissions/traffic_light.py:74-150] — `DivisionTrafficLight`/`division_traffic_light` (5.5a, переиспользуется буквально).
- [Source: Backend/VAPS/apps/operations/submissions/api/serializers.py:120-131] — `TrafficLightTreeFilterSerializer` (форма-прецедент).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- Реализация — прямая копия гвардов/стиля `tree` (10.3a): scope→exists→будущая дата→`assert_report_date_has_data`, тот же `_TRAFFIC_LIGHT_PERMISSION`. `division` зовёт `division_traffic_light` (5.5a) напрямую, не `traffic_light_tree` (5.5b) — разные словари статусов (5.5a: GREEN/YELLOW/RED; 5.5b добавляет NEUTRAL/UNKNOWN).
- **Незапланированный, но необходимый фикс — коллизия имени enum.** Новое поле `status` экшена `division` использует ТОТ ЖЕ choice-set (`TrafficLightStatus.choices`), что и узел `tree`. drf-spectacular попытался слить их под авто-хэшированным именем (`Status3a8Enum`), сломав 2 запиненных теста (`test_traffic_light_api.py::test_schema_node_carries_five_typed_fields`, `::test_schema_status_enum_matches_the_service`) И существующий фронтовый файл `trafficLight.ts` (Story 10.4), завязанный на старое имя `TrafficLightNodeStatusEnum` через ARCH-FE-011. Фикс — `ENUM_NAME_OVERRIDES` в `config/settings.py`: даёт слитому enum стабильное общее имя `TrafficLightStatusEnum`. Стабильность подтверждена двукратной регенерацией схемы (byte-identical). Проверено: ни одной оставшейся ссылки на старое имя во всём репо (backend+frontend).
- **Ревью-находка (Edge Case Hunter, доведена до фикса).** `division`-экшен делит enum с `tree` (все 5 значений: GREEN/YELLOW/RED/NEUTRAL/UNKNOWN), но `division_traffic_light` (5.5a) физически не может вернуть NEUTRAL/UNKNOWN (cascade-only, 5.5b). Контракт был технически корректен (тот же enum, что и tree — валидное переиспользование), но вводил в заблуждение потребителя схемы. Фикс — уточняющая фраза в `description` экшена `division`, без выделения отдельного 3-значного enum (общий enum с `tree` — осознанное решение, не баг).
- Побочно обнаружен и НЕ включён в диф стори: предсуществующий, независимый от этой стори дрейф схемы (`maximum: 2147483647` → `9223372036854775807`/`format: int64` на нескольких Rank/StaffingSlot-полях) — окружение-зависимый (вероятно ширина AutoField при регенерации в другом окружении), подтверждён через `git stash`. Отсечён из коммита стори point-fix'ом схемы (вернул int32-формы), чтобы не смешивать чужой дрейф со своими изменениями.
- 3-агентное ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor): все 10 AC подтверждены SATISFIED конкретными тестами; ни одного реального бага сверх пункта выше.

### File List

- `Backend/VAPS/apps/operations/submissions/api/serializers.py` (MOD) — `TrafficLightDivisionFilterSerializer`.
- `Backend/VAPS/apps/operations/submissions/api/views.py` (MOD) — `division`-экшен, `permission_map`, импорты.
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (MOD) — `MATRIX["ops-traffic-light-division"]`.
- `Backend/VAPS/apps/operations/submissions/tests/test_traffic_light_division_api.py` (NEW) — 15 тестов.
- `Backend/VAPS/apps/operations/submissions/tests/test_traffic_light_api.py` (MOD) — 2 запиненных теста под новое имя enum.
- `Backend/VAPS/config/settings.py` (MOD) — `ENUM_NAME_OVERRIDES` (незапланированный фикс).
- `Backend/VAPS/schema.yaml` (регенерирован).
- `frontend/src/shared/api/schema.d.ts` (регенерирован).
- `frontend/src/features/traffic-light/trafficLight.ts` (MOD) — ссылка на переименованный enum (Story 10.4, незапланированный фикс).
