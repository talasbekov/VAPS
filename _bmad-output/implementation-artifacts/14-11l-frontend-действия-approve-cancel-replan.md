---
baseline_commit: 43e9f2f
---

# Story 14.11l: Frontend — действия approve/cancel/replan

Status: done

## Story

As an **оператор с правом `duty.manage`**,
I want **кнопки «Утвердить план», «Отменить смену» (с причиной), «Перепланировать смену» на деталь-странице**,
so that **весь жизненный цикл плана/смены доступен через UI, не только чтение и создание**.

Двенадцатая (четвёртая, последняя frontend) из ~12 подсторий разделения 14.11. Название стори в `sprint-status.yaml` — буквально «approve-cancel-replan», БЕЗ validate/conflicts.

## Scope Decision (найдено при create-story, research-агент)

- **Только 3 действия — approve/cancel/replan.** `validate`/`conflicts` (14.11f/g backend) НЕ входят: title стори в `sprint-status.yaml` буквально их не называет, и это последний backend-эндпоинт donor-аддендума ("High Fix"), не часть основного MVP-потока. UI для validate/conflicts — НЕ заводится этой стори; если понадобится — отдельная будущая стори (не изобретать её здесь).
- **Паттерн — буквально `ApprovalPanel`** (`SecurityEventDetailPage.tsx`): approve — прямой `mutate({})` без confirm/диалога (backend идемпотентен, 14.11c); cancel-с-причиной — inline toggle-форма (`showReturnForm`-паттерн: кнопка → `<label>+<input>` на месте, НЕ модальный `<dialog>`, НЕ `window.confirm` — в кодовой базе НЕТ ни одного `window.confirm`, инлайн-toggle — единственный прецедент для «действие+причина»).
- **Approve — кнопка в заголовке страницы.** `disabled={plan.status_code !== 'DRAFT' || mutation.isPending}` — идемпотентно на бэке (14.11c), но повторный клик на уже-APPROVED ничего не даёт пользователю → задизейблена/перелейблена, а не скрыта (честно задизейблено, не мёртвая кнопка, канон §35).
- **Cancel — per-row в `ShiftsTable`, только для НЕ отменённых смен** (`cancelled_at === null`). Inline-toggle (кнопка «Отменить» → поле причины + «Подтвердить»/«Отмена»), submit задизейблен пока `reason.trim() === ''` (зеркалит `DutyShiftCancelSerializer`'s единственное required-поле).
- **Replan — модальный `<dialog>`, буквальный образец `CreateDutyShiftDialog.tsx`.** Не reason-only (бесполезно без хотя бы одного изменяемого поля) — ПРЕДЗАПОЛНЕННАЯ форма всеми 7 replannable-полями (`employee_id`/`post`/`duty_type`/`duty_role_code`/`notes`/`starts_at`/`ends_at`) текущими значениями строки + `reason` (обязательное, остальные — как в create, `post`/`duty_type` — nullable-clear через explicit-null, тот же `.optional().or(z.literal(''))`-паттерн, что 14.11k). ValidationError-only setError, `zonedDateTimeToIso()` (14.11k, переиспользуется буквально) для datetime-полей.
- **Ошибки — `ApiError.kind`-ветвление**, тот же паттерн (5xx/network → generic; остальное → `mutation.error.message`), НЕ хардкод «Не удалось выполнить действие» без разбора (тот паттерн — старый прецедент SecurityEvents, здесь применяем УЖЕ улучшенную версию 14.11j/k).

## Acceptance Criteria

1. **AC-1 (approve — кнопка в заголовке).** `plan.status_code === 'DRAFT'` → активная кнопка «Утвердить план»; `APPROVED` → задизейблена, текст «Утверждён».
2. **AC-2 (approve — успех обновляет статус+смены).** Клик → статус в заголовке становится «Утверждён» без reload (инвалидация plan-list + shifts, уже готова в `useApproveDutyPlan`, 14.11i).
3. **AC-3 (approve — ошибка не роняет страницу).** Non-5xx ошибка → inline `role="alert"` под кнопкой, статус не меняется.
4. **AC-4 (cancel — per-row toggle, только активные смены).** Отменённые строки (`cancelled_at !== null`) НЕ показывают кнопку «Отменить».
5. **AC-5 (cancel — причина обязательна).** Toggle открывает поле причины; «Подтвердить» задизейблен при пустой причине.
6. **AC-6 (cancel — успех обновляет строку).** Смена помечается «Отменена» без reload (инвалидация shifts, 14.11i).
7. **AC-7 (cancel — 400 пустая причина → inline, ValidationError-only).**
8. **AC-8 (replan — модалка предзаполнена текущими значениями).** Клик «Перепланировать» на строке → `<dialog>` с полями, предзаполненными ИЗ ЭТОЙ строки (кроме `reason` — пусто).
9. **AC-9 (replan — explicit null снимает пост/вид, отсутствие — наследует).** Очистка поля `post`/`duty_type` (не трогать — оставить дефолт формы, который и есть текущее значение) — если предзаполнено значением, явная очистка поля в форме шлёт `null`.
10. **AC-10 (replan — успех: старая строка исчезает/помечена отменённой, новая появляется).** Инвалидация shifts (14.11i) — грид отражает новую смену.
11. **AC-11 (replan — 400 → inline, ValidationError-only, та же архитектура, что create-shift).**
12. **AC-12 (регресс нулевой).** `npm run gate` зелёный; `features/duties/` не тронута; validate/conflicts-UI НЕ добавлены (вне объёма).

## Out of Scope

- `validate`/`conflicts`-UI — не эта стори (см. Scope Decision).
- Object/post/duty_type-пикеры (выпадающие списки) — тот же stopgap, что 14.11j/k, без изменений.

## Tasks / Subtasks

- [x] Task 1 — Approve-кнопка в `DutyPlanDetailPage.tsx` (AC: 1-3)
  - [x] `useApproveDutyPlan(planId)`, disabled-условие, inline error
- [x] Task 2 — Cancel per-row в `ShiftsTable` (AC: 4-7)
  - [x] `useCancelDutyShift(planId, shiftId)`, inline-toggle-паттерн (`ApprovalPanel`-образец)
- [x] Task 3 — `ReplanDutyShiftDialog.tsx` (AC: 8-11)
  - [x] `frontend/src/features/duty-plans/pages/ReplanDutyShiftDialog.tsx` — предзаполненная форма, буквальный образец `CreateDutyShiftDialog.tsx` + `zonedDateTimeToIso()`/`isoToZonedDateTimeLocal()` (14.11k, импорт, не копия)
- [x] Task 4 — Тесты (AC: 1-12)
  - [x] Расширить `duty-plan-detail.qa.test.tsx`: approve-успех/idempotent-disabled, cancel-toggle/причина/успех/422, replan-предзаполнение/null-vs-absent/успех/400
  - [x] `npm run gate` зелёный, явно прогнан

## Dev Notes

- Читать `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx::ApprovalPanel` (буквальный образец approve+reason-toggle), `frontend/src/features/duty-plans/pages/CreateDutyShiftDialog.tsx` (14.11k, образец модалки+ValidationError-паттерн+`zonedDateTimeToIso`) ПЕРЕД имплементацией.
- `useApproveDutyPlan`/`useCancelDutyShift`/`useReplanDutyShift` уже готовы (14.11i), инвалидация уже внутри них.
- `DutyShiftReplanSerializer` (backend, 14.11e) — `reason` required, все остальные `required=False`; `post`/`duty_type` дополнительно `allow_null=True` (explicit null снимает).

### References

- [Source: frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx::ApprovalPanel] — approve+reason-toggle образец.
- [Source: frontend/src/features/duty-plans/pages/CreateDutyShiftDialog.tsx] — модалка+ValidationError-паттерн (14.11k, после review-фикса).
- [Source: frontend/src/features/duty-plans/lib/localDateTime.ts] — `zonedDateTimeToIso()` (14.11k, переиспользовать).
- [Source: Backend/VAPS/apps/operations/duties/api/serializers.py::DutyShiftReplanSerializer] — контракт полей.

## Dev Agent Record

### Context Reference

- Research-агент при create-story: `ApprovalPanel`'s inline-toggle — единственный кодобазный прецедент «действие+причина» (нет `window.confirm` нигде в features/). Replan — полная предзаполненная форма (не reason-only — бесполезно). validate/conflicts явно вне объёма (title стори их не называет).

### Completion Notes

Реализовано по AC 1-12. `ApproveButton` — прямой `mutate({})` (буквальный образец `ApprovalPanel`'s approve-кнопка), `disabled={statusCode !== 'DRAFT'}` — перелейбл «Утверждён», не скрыта (честно задизейблена, канон §35). `CancelShiftAction` — inline reason-toggle, ЕДИНСТВЕННЫЙ кодобазный прецедент «действие+причина» (`ApprovalPanel`'s return-form), только для активных смен. `ReplanDutyShiftDialog.tsx` — модалка, буквальный образец `CreateDutyShiftDialog.tsx`, `defaultValues` из текущей строки, `post_clear`/`duty_type_clear`-чекбоксы для explicit-null (единственный способ отличить «не менять» от «явно снять» — backend различает absent vs null, 14.11e). Добавлен `isoToZonedDateTimeLocal()` (`duty-plans/lib/localDateTime.ts`) — точный инверс `zonedDateTimeToIso()` (14.11k) для предзаполнения формы; +2 юнит-теста (round-trip, конкретное значение). MSW-хендлеры approve/cancel/replan добавлены (стейтфулные — реально мутируют фикстуры). Все действия используют `ApiError.kind`-ветвление (5xx/network → generic, остальное → `mutation.error.message`) — та же архитектура, что 14.11j/k, не старый хардкод-текст `ApprovalPanel`. validate/conflicts-UI НЕ добавлены (вне объёма, title стори их не называет). 8 новых page-тестов, все зелёные с первой попытки (после мелкой правки — стейтфулный approve-мок, дубль-текст-ассерт). `npm run gate` — 1046 passed (было 1038, +8), 0 regressions, build/size-gate зелёные (219.6KB/300KB).

**Ревью (Blind Hunter/Edge Case Hunter/Acceptance Auditor, параллельно):** Acceptance Auditor подтвердил все 12 AC PASS (полный gate — 1046 passed на момент ревью). Ни один агент не нашёл High/Medium багов. Blind Hunter's единственная реальная (хоть и низкоприоритетная) находка — причина отмены не сбрасывалась при закрытии inline-тоггла («Отмена» → повторное открытие показывало залипший текст); не влияет на корректность (та же строка/смена), но вводит в заблуждение UX. Edge Case Hunter И Acceptance Auditor НЕЗАВИСИМО сошлись на одном реальном пробеле покрытия: AC-9's тест проверял только explicit-null-путь («Снять пост»), но НЕ проверял «поле не тронуто → значение сохраняется» — при регрессии, случайно превратившей `undefined` в `null`/`''`, тест не покраснел бы. Исправлено: (1) `setReason('')` при закрытии cancel-тоггла; (2) новый тест, явно ассертирующий `'post' in body && body.post === 3` для нетронутого поля. `npm run gate` после фиксов — 1047 passed, 0 regressions.

### File List

- `frontend/src/features/duty-plans/pages/ReplanDutyShiftDialog.tsx` (new)
- `frontend/src/features/duty-plans/pages/DutyPlanDetailPage.tsx` (modified — `ApproveButton`, `CancelShiftAction`, Actions-колонка; review fix: сброс `reason` при закрытии тоггла)
- `frontend/src/features/duty-plans/lib/localDateTime.ts` (modified — `isoToZonedDateTimeLocal()`)
- `frontend/src/features/duty-plans/lib/localDateTime.test.ts` (modified — +2 теста)
- `frontend/src/features/duty-plans/mocks/handlers.ts` (modified — approve/cancel/replan)
- `frontend/src/app/duty-plan-detail.qa.test.tsx` (modified — +9 тестов, включая +1 review-тест на «значение сохраняется»)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Двенадцатая (четвёртая, последняя frontend) из ~12 подсторий разделения 14.11. Только approve/cancel/replan (title стори в sprint-status.yaml не называет validate/conflicts — вне объёма, future work если понадобится). Approve/cancel — буквальный образец SecurityEventDetailPage's ApprovalPanel (inline reason-toggle, единственный прецедент). Replan — модалка, буквальный образец CreateDutyShiftDialog (14.11k), предзаполненная текущими значениями строки. |
| 2026-07-31 | Dev-story: `ApproveButton`/`CancelShiftAction`/`ReplanDutyShiftDialog`, `isoToZonedDateTimeLocal()`, MSW-хендлеры, 8 новых page-тестов + 2 юнит. `npm run gate` — 1046 passed. Status → review. |
| 2026-07-31 | Ревью (3 агента параллельно): Acceptance Auditor — все 12 AC PASS, багов нет. Edge Case Hunter+Acceptance Auditor независимо сошлись на пробеле покрытия AC-9 (только null-путь тестирован, не «сохранение» путь). Blind Hunter — залипшая причина отмены при переоткрытии тоггла. Исправлено: reset причины, +1 тест на сохранение значения. `npm run gate` — 1047 passed, 0 regressions. Status → done. |
