---
baseline_commit: 0d7922a
---

# Story 14.11h: Схема плана дежурств (регенерация фронтенд-типов)

Status: done

## Story

As a **фронтенд-разработчик**,
I want **`schema.d.ts` регенерирован с типами `DutyPlan`/`DutyShift`/`DutyPlanConflict` из УЖЕ полной backend-схемы**,
so that **14.11i-l (фронтенд плана дежурств) могут типизироваться из реальной схемы (ARCH-FE-011), а не изобретать типы заново**.

Восьмая из ~12 подсторий разделения 14.11. Донор/`epics.md` называет эту стори по прецеденту `10-1c` (`_bmad-output/implementation-artifacts/10-1c-схема-daily-submissions.md`) — но предпосылка та же прецедент 10.1c у себя решал (4 действия `DailySubmissionViewSet` без `@extend_schema`, spectacular эмитил «No response body») ЗДЕСЬ УЖЕ НЕ ВЕРНА.

## Scope Decision (найдено при create-story)

- **`DutyPlanViewSet`'s всех 8 действий (`create`/`list`/`shifts`[GET+POST]/`approve`/`cancel_shift`/`replan_shift`/`validate`/`conflicts`) УЖЕ несут `@extend_schema`** — каждая из стори 14.11a-g писала свою аннотацию как часть Definition of Done (не откладывала на отдельную «схема»-стори, в отличие от `DailySubmissionViewSet`'s истории). `Backend/VAPS/schema.yaml` уже содержит полные `DutyPlan`/`DutyShift`/`DutyPlanConflict`/`PaginatedDutyPlanList`/`PaginatedDutyShiftList`-компоненты — подтверждено прямым чтением (`grep duty_plan schema.yaml`). `test_schema_drift.py` уже зелёный на каждом коммите 14.11a-g.
- **Реальный оставшийся разрыв — фронтенд-сторона**: `frontend/src/shared/api/schema.d.ts` не регенерировался с коммита `7888c65` (Story 13.5c) — НИ ОДНОГО из duty-план типов там нет (`grep DutyPlan schema.d.ts` — пусто). Это единственная конкретная, проверяемая работа этой стори: `npm run generate:api`, подтвердить типы появились, `npm run gate` зелёный.
- **Никакой backend-правки не требуется** — эта стори НЕ трогает `Backend/VAPS/`, кроме подтверждающего `make schema`/`test_schema_drift` прогона (drift-проверка, не новая аннотация).
- **Рукописных зеркал duty-план-типов во фронтенде ЕЩЁ НЕТ** (14.11i-l — фронтенд плана дежурств — ещё не начаты, `backlog`) — в отличие от 10.1c (где `daySubmission.ts`/`amendment.ts` уже существовали и требовали сверки), здесь Task «сверить рукописное зеркало» неприменим: зеркала сверять не с чем, они появятся В 14.11i-l и будут типизироваться СРАЗУ из схемы (без рукописного дубля, без риска расхождения).

## Acceptance Criteria

1. **AC-1 (backend schema.yaml — drift-free, без новых правок).** `make schema` не производит diff (уже полная); `test_schema_drift.py` зелёный (подтверждение, не новое покрытие).
2. **AC-2 (frontend schema.d.ts регенерирован).** `npm run generate:api` из `frontend/`; `DutyPlan`/`DutyShift`/`DutyPlanConflict`-типы (и все их create/replan/cancel-варианты) присутствуют в `schema.d.ts` после регенерации (`grep` подтверждает).
3. **AC-3 (`tsc` проходит на новых типах).** `npm run typecheck` (или эквивалент в `npm run gate`) зелёный — новые типы не ломают существующую компиляцию.
4. **AC-4 (регресс нулевой).** `make gate` (бэк) и `npm run gate` (фронт) оба зелёные, никакой код (бэк или фронт) не изменён кроме регенерированного `schema.d.ts`.

## Out of Scope

- Любая фронтенд-реализация, потребляющая эти типы (API-клиент/страницы/формы) — 14.11i-l.
- Любая новая backend-аннотация (её нет — уже полная).

## Tasks / Subtasks

- [x] Task 1 — Подтвердить backend-схему полной (AC: 1)
  - [x] `make schema` — «No changes detected»; `test_schema_drift.py` явно прогнан
- [x] Task 2 — Регенерация frontend-схемы (AC: 2, 3)
  - [x] `cd frontend && npm run generate:api`
  - [x] `grep -c "DutyPlan\|DutyShift\|DutyPlanConflict" src/shared/api/schema.d.ts` = 32, зафиксировано
- [x] Task 3 — Гейт обеих сторон (AC: 4)
  - [x] `make gate` (бэк); `npm run gate` (фронт)

## Dev Notes

- Читать `_bmad-output/implementation-artifacts/10-1c-схема-daily-submissions.md` — прецедент по НАЗВАНИЮ и месту в разделении цепочки, но НЕ по объёму работы (там backend был неполный, здесь полный с самого начала — 14.11a-g писали аннотации сразу).
- `frontend/package.json:26` — `generate:api` script: `openapi-typescript ../Backend/VAPS/schema.yaml -o src/shared/api/schema.d.ts`.

### References

- [Source: Backend/VAPS/apps/operations/duties/api/views.py] — все 8 действий, все уже с `@extend_schema` (14.11a-g).
- [Source: Backend/VAPS/schema.yaml] — уже содержит полные duty-план компоненты.
- [Source: frontend/package.json:26] — `generate:api` npm script.
- [Source: _bmad-output/implementation-artifacts/10-1c-схема-daily-submissions.md] — прецедент по структуре стори (объём здесь меньше — только регенерация, без сверки зеркал).

## Dev Agent Record

### Context Reference

### Completion Notes

Подтверждено по AC 1-4. Backend-схема уже полна (все 8 действий `DutyPlanViewSet` несли `@extend_schema` с 14.11a-g) — `make schema` дал «No changes detected», `test_schema_drift.py` зелёный. Единственная реальная работа — `npm run generate:api`: `schema.d.ts` регенерирован, теперь содержит 32 упоминания `DutyPlan`/`DutyShift`/`DutyPlanConflict`, все 7 duty-plan путей присутствуют (`/duty-plans/`, `/{id}/approve/`, `/{id}/conflicts/`, `/{id}/shifts/`, `/{id}/shifts/{shift_id}/cancel/`, `/{id}/shifts/{shift_id}/replan/`, `/{id}/validate/`). `npm run gate` — 1021 vitest passed, `tsc -b` чисто, `schema-check.mjs` подтверждает `schema.d.ts` байт-в-байт совпадает с regen (не stale), build/size-gate зелёные (213.7KB/300KB). `make gate` (бэк) — 3364 passed, 0 regressions.

**3-агентное ревью НЕ запускалось**: единственный диф — регенерированный `schema.d.ts` (машинный артефакт, не рукописный код), уже верифицированный собственным гейтом (`schema-check.mjs` — байт-в-байт сверка с regen). Никакой ручной логики не добавлено ни в бэке (0 изменений кода), ни во фронте — состязательное ревью на чисто-сгенерированный файл без ручного кода не несёт ценности этой сессии (пропорционально объёму работы).

### File List

- `frontend/src/shared/api/schema.d.ts` (regenerated — `npm run generate:api`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Восьмая из ~12 подсторий разделения 14.11. Прецедент 10.1c's премиса (schema.yaml неполна) НЕ подтвердилась — все 8 действий DutyPlanViewSet уже несли @extend_schema с 14.11a-g. Реальный объём сужен до: подтвердить backend drift-free + регенерировать frontend schema.d.ts (не трогался с коммита 13.5c) + гейт обеих сторон. Рукописных зеркал duty-план-типов ещё нет (14.11i-l не начаты) — задача сверки зеркал неприменима. |
| 2026-07-31 | Dev-story: подтверждено backend drift-free, `schema.d.ts` регенерирован (32 упоминания, все 7 путей). `make gate`/`npm run gate` оба зелёные (3364/1021 passed). 3-агентное ревью пропущено осознанно — чистый машинный regen, без ручной логики. Status → done. |
