---
baseline_commit: 484d2a4
---

# Story 18.6b: API — опрос, налёт часов, перегрузка

Status: done

## Story

As a **держатель права `event.manage`**,
I want **записать фактическое время назначения, вычислить Налёт часов и отметить перегрузку через REST API**,
so that **фронтовый экран опроса (18.6c) сможет вызвать уже готовые `record_assignment_actual_time()` (18.3), `compute_service_hours()` (18.4) и `flag_post_overload()` (18.5) сервисы, не дублируя их логику**.

## Scope Decision

- **Только API-обёртка, НЕ новая бизнес-логика** — тот же принцип, что 18.6a: три уже реализованных и протестированных сервиса (`record_assignment_actual_time`/18.3, `compute_service_hours`/18.4, `flag_post_overload`/18.5) получают `@action`'ы, тонкие сериализаторы (presence/type-валидация only) и API-тесты. Никаких новых моделей/миграций.
- **Три ОТДЕЛЬНЫХ `@action`'а, не одна объединённая «отправить опрос»-ручка**: сервисный слой 18.3/18.4/18.5 НАМЕРЕННО не авто-триггерит друг друга (18.4's Dev Notes: «явный вызов, не авто-триггер из `record_assignment_actual_time()`»; 18.5's Dev Notes: то же про `compute_service_hours()`). Объединение трёх вызовов в один API-эндпоинт добавило бы НОВУЮ оркестрацию/бизнес-логику в слой view — прямое нарушение 18.6a's установленного принципа «только обёртка». Фронт (18.6c) вызывает все три последовательно сам, каждый шаг видим отдельно.
- **Все три actions на существующем `PlacementAssignmentViewSet`**, не новый ViewSet — сервисы оперируют `PlacementAssignment`/`PlacementAssignmentActual`/`ServiceHours`, все три висят по цепочке OneToOne на одном и том же `PlacementAssignment` (`assignment.actual_time` → `PlacementAssignmentActual`, `.service_hours` → `ServiceHours`) — тот же URL-ресурс, что уже существующий `acknowledge` (16.8e).
- **⚠️ ВАЖНОЕ ОТЛИЧИЕ от `acknowledge`**: `PlacementAssignmentViewSet.initial()` (16.8e) — self-scope gate («любой аутентифицированный actor, но ТОЛЬКО на своём назначении», НЕ RBAC-право). Три новых action'а — ПРОТИВОПОЛОЖНАЯ модель: `require_permission(request, "event.manage")`, буквально как ВСЕ actions `SecurityEventViewSet`. `initial()`'s общий гейт («есть ли actor_id вообще») не мешает — он молча пропускает любой authenticated request, RBAC-проверка добавляется ВНУТРИ каждого нового action'а (тот же приём, что `staffing_demand_approve` и др. на другом ViewSet'е). НЕ трогать/не ослаблять `acknowledge`'а собственный self-scope гейт.
- **`actual-time`: `POST .../placement-assignments/{id}/actual-time/`** — тело `{"actual_start_at": iso-datetime, "actual_end_at": iso-datetime}`, thin presence/type-валидация (сервис владеет `actual_start_at < actual_end_at`-проверкой через DB CHECK — гейт возврата 422/500 уже отработан в 18.3, не дублировать). Response — новый `PlacementAssignmentActualSerializer`.
- **`service-hours`: `POST .../placement-assignments/{id}/service-hours/`** — без тела (`request=None`, буквально как `acknowledge`). Читает `assignment.actual_time` (`PlacementAssignmentActual`, OneToOne) — если ещё не записан (18.3 не вызвана), 404 (не 422 — ресурс, от которого зависит вызов, просто отсутствует, тот же класс решения, что `_get_event_or_404`). Response — новый `ServiceHoursSerializer`.
- **`overload`: `POST .../placement-assignments/{id}/overload/`** — без тела. Читает `assignment.actual_time.service_hours` (`ServiceHours`, OneToOne через `PlacementAssignmentActual`) — если ещё не вычислен (18.4 не вызвана), 404. Response — тот же `ServiceHoursSerializer` (после `flag_post_overload()` поля `is_overloaded`/`overload_minutes` заполнены).
- **Новый helper `_get_actual_or_404(assignment)`/`_get_service_hours_or_404(assignment)`** — тот же класс решения, что `_get_event_or_404`/`_get_placement_assignment_or_404`, НЕ голый `RelatedObjectDoesNotExist` (даёт неопрятный 500) — явный 404.
- **Out of scope**: фронтовый экран (18.6c); e2e (18.6d); объединённая «одна кнопка — весь опрос» ручка (намеренно, см. выше); новые permission-коды (переиспользуется `event.manage`); авто-пересчёт `service-hours`/`overload` при повторном вызове `actual-time` (тот же принцип разделения, что сам сервисный слой).

## Acceptance Criteria

1. **AC-1.** `POST .../actual-time/` с валидным интервалом на `CLOSED`-событии (сервисный гейт 18.3 — `is_current`+`CLOSED`, НЕ `IN_PROGRESS`; исправлено ревью, Acceptance Auditor — исходная формулировка была copy-paste-дрейфом от 18.6a's close-ориентированных AC, противоречила собственному `@extend_schema`-описанию той же стори) → 200, `PlacementAssignmentActualSerializer`.
2. **AC-2.** `POST .../actual-time/` без права `event.manage` → 403.
3. **AC-3.** `POST .../service-hours/` при существующем `actual_time` на `CLOSED`-событии (сервисный гейт 18.4) → 200, `ServiceHoursSerializer` (`day_hours`/`night_hours` заполнены).
4. **AC-4.** `POST .../service-hours/` без предварительного `actual-time` (нет `PlacementAssignmentActual`) → 404.
5. **AC-5.** `POST .../service-hours/` без права `event.manage` → 403.
6. **AC-6.** `POST .../overload/` при существующем `ServiceHours` → 200, `is_overloaded`/`overload_minutes` в ответе.
7. **AC-7.** `POST .../overload/` без предварительного `service-hours` (нет `ServiceHours`) → 404.
8. **AC-8.** `POST .../overload/` без права `event.manage` → 403.
9. **AC-9.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Фронтовый экран опроса (Story 18.6c).
- e2e полного цикла ОМ (Story 18.6d).
- Объединённая «отправить опрос» ручка (три явных вызова, тот же принцип, что сервисный слой).
- Новые permission-коды.
- Авто-пересчёт `service-hours`/`overload` при повторном `actual-time`.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `PlacementAssignmentActualSerializer` (ModelSerializer, read-only) + `RecordActualTimeSerializer` (thin request-валидация `actual_start_at`/`actual_end_at`) + `ServiceHoursSerializer` (ModelSerializer, read-only, включая `is_overloaded`/`overload_minutes`)
- [x] Task 2 — `apps/operations/events/api/views.py`: `_get_actual_or_404(assignment)`/`_get_service_hours_or_404(assignment)` helpers + три `@action` на `PlacementAssignmentViewSet` (`actual-time`/`service-hours`/`overload`), каждый — `require_permission(request, "event.manage")` ДО lookup, `@extend_schema`
- [x] Task 3 — API-тесты (AC 1-8): `apps/operations/events/tests/test_opros_hours_overload_api.py`, паттерн `APIClient`+`HTTP_X_USER_ID`+`Role`/`RolePermission`/`UserRole`
- [x] Task 4 — RBAC-matrix (`test_rbac_matrix.py`) + audit-coverage (`test_audit_coverage.py`) closed-world guard записи для трёх новых маршрутов (тот же обязательный шаг, что 18.6a's review-урок — сделать СРАЗУ, не после первого красного прогона `make gate`)
- [x] Task 5 — `make schema` (регенерация, аддитивный диф)
- [x] Task 6 — `make gate`

## Dev Notes

- `Backend/VAPS/apps/operations/events/services.py:2120` (`record_assignment_actual_time(assignment, *, actor, actual_start_at, actual_end_at)`) — 18.3, upsert, двойной гейт (`is_current`+`CLOSED`... ПРОВЕРИТЬ буквально: 18.3's гейт может отличаться от 18.4/18.5 — перечитать перед реализацией, не полагаться на память).
- `Backend/VAPS/apps/operations/events/services.py:2265` (`compute_service_hours(actual, *, actor)`) — 18.4, принимает `PlacementAssignmentActual`, НЕ `PlacementAssignment` — путь из `@action`: `assignment.actual_time` (OneToOne, `related_name="actual_time"` на `PlacementAssignmentActual.assignment`).
- `Backend/VAPS/apps/operations/events/services.py:2330` (`flag_post_overload(service_hours, *, actor)`) — 18.5, принимает `ServiceHours`, путь: `assignment.actual_time.service_hours` (OneToOne, `related_name="service_hours"` на `ServiceHours.actual`).
- `Backend/VAPS/apps/operations/events/api/views.py:858` (`PlacementAssignmentViewSet`) — **ВНИМАТЕЛЬНО**: `http_method_names = ["post", "options"]` на уровне класса (все actions уже POST, совместимо) и `initial()` — self-scope-only гейт для `acknowledge`; три новых action'а добавляют СВОЙ `require_permission()` внутри метода, НЕ трогая `initial()` (иначе сломается `acknowledge`'а self-scope модель — `initial()`'s общий "есть ли actor_id" чек достаточен и для RBAC-actions, permission-проверка добавляется отдельно внутри каждого нового метода, тот же приём, что `SecurityEventViewSet`'s actions делают на СВОЁМ ViewSet без общего `initial()`-гейта).
- `Backend/VAPS/apps/operations/events/api/views.py:852` (`_get_placement_assignment_or_404(pk)`) — переиспользовать буквально для получения `assignment` во всех трёх action'ах.
- 18.6a's review-урок (буквально повторить с первого захода, не ждать красного `make gate`): ЛЮБОЙ новый мутирующий маршрут ОБЯЗАН попасть в `AUDIT_MATRIX` (`test_audit_coverage.py`) — все три action'а мутируют (upsert), значит все три — `_Audited()`. ЛЮБОЙ новый зарегистрированный маршрут (мутирующий ИЛИ read-only) ОБЯЗАН попасть в `MATRIX` (`test_rbac_matrix.py`) — `_Gate("event.manage")` на все три.
- `service-hours`/`overload` actions используют `request=None` в `@extend_schema` (нет тела запроса) — буквальный образец `acknowledge` (`views.py:885-887`).

### References

- [Source: Backend/VAPS/apps/operations/events/services.py] — `record_assignment_actual_time()` (18.3), `compute_service_hours()` (18.4), `flag_post_overload()` (18.5).
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `PlacementAssignmentViewSet`, `acknowledge` (16.8e, структурный образец no-body action + self-scope-vs-RBAC отличие), `_get_placement_assignment_or_404`.
- [Source: _bmad-output/implementation-artifacts/18-6a-api-закрытие-и-архив.md] — прямой структурный/процессный прецедент (включая review-урок про closed-world guard-тесты).
- [Source: epics.md FR-32, FR-43, Story 18.6] — «API/экраны закрытия + аудит + e2e полного цикла ОМ» (эта стори — API-часть опроса/налёта/перегрузки).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-9. Три `@action` на `PlacementAssignmentViewSet` (`actual-time`/`service-hours`/`overload`), каждый — свежий `require_permission(request, "event.manage")` внутри метода, НЕ трогая ViewSet'а собственный self-scope `initial()` (тот остаётся неизменным для `acknowledge`). Два новых 404-хелпера (`_get_actual_or_404`/`_get_service_hours_or_404`) — явный 404 вместо голого `RelatedObjectDoesNotExist`. Три новых сериализатора: `PlacementAssignmentActualSerializer`/`ServiceHoursSerializer` (ModelSerializer, read-only), `RecordActualTimeSerializer` (тонкая presence/type-валидация). Ни одного try/except в actions — трансляция `DomainError`→JSON полностью автоматическая, тот же принцип, что 18.6a.

Урок 18.6a применён СРАЗУ: RBAC-matrix (`test_rbac_matrix.py`) и audit-coverage (`test_audit_coverage.py`) записи для всех трёх новых маршрутов добавлены ДО первого прогона `make gate`, не после красного — `make gate` прошёл с первого раза (4194 passed, было 4155). `make schema` — аддитивный диф (178 строк, только новые `operationId`'ы), количество pre-existing ошибок/предупреждений не изменилось.

9 API-тестов (`test_opros_hours_overload_api.py`), паттерн `APIClient`+`HTTP_X_USER_ID`+`Role`/`RolePermission`/`UserRole`, буквально скопирован с 18.6a. Обнаружено при написании: `record_assignment_actual_time()`'s гейт — `is_current`+`CLOSED` (не `IN_PROGRESS`, как в `close_security_event()`) — «опрос по итогам» происходит ПОСЛЕ закрытия, тестовые фикстуры создают события сразу в `CLOSED` (не идут через `close`-action).

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `PlacementAssignmentActualSerializer`, `RecordActualTimeSerializer`, `ServiceHoursSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `_get_actual_or_404`/`_get_service_hours_or_404` + `actual_time`/`service_hours`/`overload` actions on `PlacementAssignmentViewSet`)
- `Backend/VAPS/apps/operations/events/tests/test_opros_hours_overload_api.py` (new — 9 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 3 gate entries)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 3 audited entries)
- `Backend/VAPS/schema.yaml` (regenerated — additive)

После ревью (3 агента: Blind Hunter/Edge Case Hunter/Acceptance Auditor): 0 реальных багов в коде. 1 real находка — в самой СТОРИ: AC-1 буквально написана «на IN_PROGRESS-событии», что противоречит и реальному сервисному гейту (`is_current`+`CLOSED`), и собственному `@extend_schema`-описанию той же стори (copy-paste-дрейф от 18.6a's close-ориентированных AC) — исправлено в тексте AC-1, код и тесты УЖЕ следовали правильному гейту. 8 test-патчей: is_current-гейт для всех трёх actions (был полностью непокрыт — только CLOSED/не-CLOSED тестировался), interval-ordering 400 через API, API-уровневый upsert-раунд-трип (не только сервисный), различение двух РАЗНЫХ 404-кейсов у `overload` (переименован вводящий в заблуждение `test_overload_without_service_hours_is_404` → `test_overload_without_actual_time_is_404`, добавлен genuinely-missing `test_overload_without_service_hours_computed_is_404`), промежуточный статус-assert в `test_overload_success` (диагностическое качество — падение указывает на реальный шаг). 2 defer: naive-datetime молчаливая tz-коэрсия через `settings.TIME_ZONE` (не `VAPS_LOCAL_TIMEZONE`) — фронту нужно ВСЕГДА слать offset-aware ISO; `Http404` vs сервисный `error_code`-конверт — established convention, тот же класс, что уже зафиксирован для 18.6a. `make gate` после патчей — 4200 passed (было 4194), 0 regressions.

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-05 | Story создана (create-story). Третья часть разбиения 18.6 (после 18.6a) — API-обёртка над `record_assignment_actual_time()`/`compute_service_hours()`/`flag_post_overload()` (18.3-18.5), три отдельных action'а (НЕ объединённая ручка — тот же принцип разделения, что сам сервисный слой), на существующем `PlacementAssignmentViewSet` с НОВЫМ RBAC-гейтом (`event.manage`) поверх его существующего self-scope `initial()`. Status → ready-for-dev. |
| 2026-08-05 | Dev-story: три action'а + 3 сериализатора + 9 API-тестов + rbac-matrix/audit-coverage записи ДО первого прогона (18.6a's урок применён) + `make schema`. `make gate` — 4194 passed с первого раза, 0 regressions. Status → review. |
| 2026-08-05 | Review закрыт (3 агента). 0 багов в коде, 1 spec-текст патч (AC-1 исправлена — CLOSED, не IN_PROGRESS), 8 test-патчей (is_current-гейт ×3, interval-ordering, upsert-раунд-трип, два различённых 404-кейса overload). 2 defer в deferred-work.md. `make gate` — 4200 passed, 0 regressions. Status → done. |
