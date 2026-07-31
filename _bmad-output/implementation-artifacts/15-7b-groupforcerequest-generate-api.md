---
baseline_commit: 017a74f
---

# Story 15.7b: `POST /security-events/{id}/force-requests/generate` — генерация+рассылка запросов Группам (FR-24)

Status: review

## Story

As a **оператор, завершивший утверждение Потребности**,
I want **сгенерировать и отправить агрегированные запросы Группам одним действием**,
so that **брокеры (15.8) видят, сколько людей запрошено по каждой Группе**.

## Scope Decision (найдено при create-story)

- **Финальная часть разбитого `15-7`** (15.7a — модель done; эта стори — генерация+рассылка).
- **Генерация И рассылка — ОДНО действие, не два.** Донор-текст (найден косвенно, через комментарий во frontend-прототипе, процитировавший «Smart Josparlau.dc.html:611-612 «запросы будут сформированы автоматически»») предполагает атомарность генерации+отправки. epics.md/architecture.md НЕ дают явного текста, различающего «генерацию» от «рассылки» как раздельных операторских действий — консервативно объединено в один эндпоинт (тот же принцип, что везде в Epic 15: не изобретать лишние промежуточные состояния без спеки).
- **Транзит СТРОГО из `DEMAND`.** Потребность должна быть утверждена (15.5c) до генерации запросов — симметрично предыдущим гейтам линейного цикла. НЕ переводит `SecurityEvent.status_code` дальше (это остаётся `DEMAND` — переход в `BROKERAGE` — Story 15.8's работа, при первом реальном выделении брокером).
- **Агрегация — по `SecurityEventStaffingDemand.group`-ТЕКСТУ, сматченному на `Group.name`.** Открытый вопрос: `StaffingDemand.group` — свободный текст (15.5a, не переведён на FK), `GroupForceRequest.group` — FK (15.7a). Сопоставление по `Group.objects.get_or_create(name=text)`? РЕШЕНИЕ: сопоставление по `Group.name` СТРОГОЕ (без авто-создания новых Групп «на лету» из опечаток) — строки `StaffingDemand`, чьё `group`-текстовое поле НЕ совпадает ни с одной активной `Group.name`, пропускаются с явным предупреждением в ответе (не молча теряются, не роняют весь запрос ошибкой 500). Это открытый вопрос, задокументированный явно — донор-спека не даёт правила сопоставления текст↔справочник.
- **Идемпотентная regenerate-семантика.** Повторный вызов на том же ОМ — пересчитывает и ЗАМЕНЯЕТ существующие `GroupForceRequest`-строки (`UniqueConstraint(event, group)` из 15.7a естественно это форсит через `update_or_create`), не дублирует. `allocated_count`/уже-`PARTIALLY_ALLOCATED`-статус СОХРАНЯЮТСЯ при regenerate (не сбрасываются в `NOT_SENT`) — иначе повторная генерация после начала брокериджа стёрла бы прогресс 15.8.
- **Аудит — на каждом вызове** (реальная бизнес-операция — рассылка запросов, не черновик).
- **Permission — `event.manage`.**

## Acceptance Criteria

1. **AC-1 (успешная генерация).** `POST /security-events/{id}/force-requests/generate` на ОМ в `DEMAND` → 200, для каждой уникальной сматченной Группы — одна `GroupForceRequest`-строка (`requested_count` = сумма `need` по этой Группе), статус `SENT`.
2. **AC-2 (несматченные Группы — предупреждение, не ошибка).** `StaffingDemand.group`-текст без совпадения в `Group.name` (активных) → строка пропущена, `unmatched_groups` в ответе содержит список пропущенных текстов.
3. **AC-3 (идемпотентная regenerate).** Повторный вызов — обновляет `requested_count` существующих строк (не дублирует, `UniqueConstraint` естественно форсит), НЕ сбрасывает `allocated_count`/`PARTIALLY_ALLOCATED`/`ALLOCATED`-статус уже начатых Групп.
4. **AC-4 (конфликт статуса).** Вызов НЕ из `DEMAND` → 422.
5. **AC-5 (permission).** Требует `event.manage` — без него 403.
6. **AC-6 (`GET /force-requests`).** Список текущих `GroupForceRequest` для ОМ.
7. **AC-7 (регресс нулевой).** `make gate` зелёный, оба роута — в живых реестрах.

## Out of Scope

- Переход `SecurityEvent.status_code` в `BROKERAGE` — Story 15.8.
- Выделение (`allocated_count`-запись) — Story 15.8.
- Авто-создание новых `Group`-записей из несматченного текста — явно НЕ делается (см. Scope Decision).

## Tasks / Subtasks

- [x] Task 1 — `services.py`: `generate_force_requests(event, *, actor)` — агрегация+матчинг+`update_or_create`+аудит
- [x] Task 2 — ViewSet `@action`-ы: `POST .../force-requests/generate`, `GET .../force-requests`
- [x] Task 3 — Живые реестры
- [x] Task 4 — Тесты (генерация/матчинг/regenerate-сохраняет-прогресс/конфликт/403/список/аудит)
- [x] Task 5 — Гейт + схема

## Dev Notes

- Читать `apps/operations/events/services.py::approve_staffing_demand()` (15.5c) — образец гейта+аудита.
- `update_or_create(event=event, group=group, defaults={"requested_count": total})` — НЕ включать `status`/`allocated_count` в `defaults`, чтобы не затирать прогресс при regenerate (только создание новой строки должно проставлять `status=SENT`).

### References

- [Source: Backend/VAPS/apps/operations/events/services.py] — `approve_staffing_demand()` (15.5c).
- [Source: Backend/VAPS/apps/operations/events/models.py] — `GroupForceRequest`/`Group`/`SecurityEventStaffingDemand`.

## Dev Agent Record

### Context Reference

_(заполняется dev-story)_

### Completion Notes

Реализовано по AC 1-7. `generate_force_requests()` — агрегация `event.staffing_demands` по `group`-тексту в Python-словаре (малый event-scoped набор строк, не требует SQL-уровневой `Sum`), строгий матчинг на активные `Group.name` (несовпадения — в `unmatched_groups`, не молча теряются и не роняют запрос). `update_or_create()` с `defaults={"requested_count": total_need}` — НЕ включает `status`/`allocated_count`, поэтому regenerate обновляет только счётчик, сохраняя уже начатый брокериджем прогресс (доказано тестом с явной сменой `allocated_count`/`status` перед повторной генерацией). `status=SENT` проставляется явно ТОЛЬКО на реально созданных строках (`created=True`-ветка `update_or_create`). Строгий `DEMAND`-гейт, `select_for_update()`. `POST .../force-requests/generate` + `GET .../force-requests` — оба на `SecurityEventViewSet`, `event.manage`. Аудит на КАЖДОМ вызове (реальная рассылка, не черновик). 7 новых тестов (агрегация+SENT, несовпадения-репортятся, regenerate-сохраняет-прогресс, конфликт-статуса, 403, аудит, список). `make gate` — 3569 passed (было 3542, +27), 0 regressions, no drift.

### File List

- `Backend/VAPS/apps/operations/events/services.py` (modified — `generate_force_requests()`)
- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `GroupForceRequestSerializer`/`GenerateForceRequestsResponseSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `force_requests_generate`/`force_requests`-actions)
- `Backend/VAPS/apps/operations/events/tests/test_force_requests_generate.py` (new)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — `_Audited()`-запись)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 2 `_Gate`-записи)
- `docs/registries/audit-events.yaml` (modified — `SECURITY_EVENT_FORCE_REQUESTS_GENERATED`-запись)
- `Backend/VAPS/schema.yaml` (regenerated)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Генерация+рассылка объединены в одно действие (нет спеки, различающей их). Текст↔справочник матчинг — строгий, несовпадения не молча теряются. Regenerate сохраняет allocated-прогресс. |
| 2026-07-31 | Dev-story: `generate_force_requests()` + 2 API-эндпоинта. 7 новых тестов, оба живых реестра обновлены, схема регенерирована. `make gate` — 3569 passed. Status → review. |
