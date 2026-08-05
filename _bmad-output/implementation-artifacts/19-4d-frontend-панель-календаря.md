---
baseline_commit: 945f3d0
---

# Story 19.4d: Фронтенд — панель месячного календаря в карточке сотрудника

Status: done

## Story

As a **держатель права `status.view`**,
I want **видеть месячный календарь статусов сотрудника прямо в его карточке**,
so that **FR-37's «Календарь Сотрудник × месяц» становится реально видимым на экране, не только API**.

## Scope Decision

- **Встроенная панель в УЖЕ существующую `EmployeeDetailPage`, НЕ отдельный роут/страница** — карточка сотрудника (`frontend/src/features/personnel/pages/EmployeeDetailPage.tsx`) уже читает `employee.division`/`employee.id` — естественное место для нового раздела, без роутинга/permission-guard (страница уже под `RequirePermission permission="status.view"`, `ROUTES.employeeDetail`, App.tsx:130-137) — переиспользуется существующий гейт, новый не создаётся.
- **Новый компонент `StatusCalendarPanel`** в `frontend/src/features/status-calendar/pages/` — использует `useEmployeeStatusCalendar` (19.4c), локальный `useState` для текущего год/месяц (по умолчанию — текущий месяц), кнопки «‹»/«›» для навигации.
- **БЕЗ цветовой раскраски по `StatusType.color`** — 19.4b's Scope Decision явно откладывает это («фронт мапит `status_type_code` → `StatusType.color` сам, через уже существующий `/statuses/types/`, НЕ дублируется здесь») — для ЭТОЙ стори нет фронтенд-хука над `/statuses/types/` (не построен ни одной предыдущей стори этого проекта), строить его сейчас — расширение объёма за пределы «показать календарь». День отображается как компактная ячейка с датой + текстовым кодом статуса (`status_type_code`, plain text, БЕЗ цвета) — честно, не выдумывая палитру.
- **Не заменяет существующую секцию "Оперативные данные Smart Josparlau"** (EmployeeDetailPage.tsx:90-96, честный placeholder «не подключено» для дежурств/участия в ОМ/ознакомления/рейтинга) — календарь статусов НЕ покрывает эти поля, это НОВЫЙ, отдельный раздел.
- **Out of scope**: цветовая палитра статусов (будущая стори, после хука над `/statuses/types/`); календарь по Подразделению (19.5); собственный роут/страница календаря вне карточки сотрудника; MSW dev-фикстуры для `npm run dev:mock` (нужны, если демо-режим должен показывать данные без бэкенда — не требуется для этой стори, `apiClient` уже работает против реального бэка в dev).

## Acceptance Criteria

1. **AC-1.** `EmployeeDetailPage` для существующего сотрудника отображает новую секцию «Календарь статусов» с текущим месяцем по умолчанию.
2. **AC-2.** Каждый день месяца отображается как ячейка с числом даты + `status_type_code` (текст).
3. **AC-3.** Кнопки «‹ Пред. месяц» / «След. месяц ›» меняют отображаемый месяц (state), хук перезапрашивает данные (переиспользует 19.4c's query-key на `year`/`month`).
4. **AC-4.** Пока запрос загружается — плейсхолдер `«Загрузка календаря…»` (тот же паттерн, что `employeeQuery.isLoading` выше на странице).
5. **AC-5.** Ошибка запроса (403/404) — компактное сообщение об ошибке, НЕ ломает остальную страницу (карточка сотрудника продолжает рендериться).
6. **AC-6.** `npm run gate` (frontend) зелёный.

## Out of Scope

- Цветовая палитра статусов (`StatusType.color`).
- Календарь по Подразделению (19.5).
- Отдельный роут/страница вне карточки сотрудника.
- MSW dev-фикстуры.

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/features/status-calendar/pages/StatusCalendarPanel.tsx`: компонент — локальный state год/месяц, `useEmployeeStatusCalendar`, рендер сетки 7×N (дни недели), loading/error-состояния.
- [x] Task 2 — `frontend/src/features/personnel/pages/EmployeeDetailPage.tsx`: подключить панель новой секцией — через render-prop `renderExtra` (ARCH-FE-013 запрещает прямой cross-feature импорт `personnel → status-calendar`; композиция вынесена в `app/App.tsx`, единственный слой, которому разрешено импортировать из любой фичи).
- [x] Task 3 — Тесты (AC 1-5): `StatusCalendarPanel.test.tsx` (изолированный тест компонента, MSW) — `EmployeeDetailPage.test.tsx` не существовал заранее, не создавался (страница уже покрыта e2e/routing-тестами приложения; изолированного unit-теста у неё не было и до этой стори).
- [x] Task 4 — `npm run gate` (frontend). Доп. находка при живой проверке в браузере (`preview_start`): без MSW dev-фикстуры запрос к новому эндпоинту падал не через мой error-UI, а через MSW-внутреннюю ошибку `onUnhandledRequest: "error"` (проект не допускает passthrough) — добавлен `frontend/src/features/status-calendar/mocks/handlers.ts` (детерминированный синтетический месяц, VACATION на днях 10-14) + регистрация в `app/mocks/compose-handlers.ts`, НЕ входил в исходный Scope Decision, но необходим для реальной работы demo-режима.

## Dev Notes

- `frontend/src/features/personnel/pages/EmployeeDetailPage.tsx` — `employee.division` (UUID подразделения), `employee.id` — оба уже доступны в компоненте, передаются в панель как props.
- `frontend/src/features/status-calendar/api/queries.ts` (19.4c) — `useEmployeeStatusCalendar(divisionId, employeeId, year, month)`, `EmployeeStatusCalendarResponse` = `Record<string, string>` (плоский, ISO-дата → код).
- `frontend/src/app/App.tsx:130-137` — `ROUTES.employeeDetail` уже под `RequirePermission permission="status.view"` — панель наследует гейт страницы, свой не нужен.
- Сетка недели: `new Date(year, month - 1, 1).getDay()` (JS `Date`, месяц 0-индексирован в отличие от бэка) даёт смещение первого дня — компонент сам считает пустые ячейки-заглушки перед 1-м числом, НЕ полагается на бэк.
- Тесты компонента — образец `EmployeeDetailPage.test.tsx` (уже существует, MSW handlers, `renderWithProviders`-подобный wrapper, если есть общий тест-хелпер в `shared/testing/`).

### References

- [Source: _bmad-output/implementation-artifacts/19-4c-frontend-api-client.md] — `useEmployeeStatusCalendar` хук.
- [Source: frontend/src/features/personnel/pages/EmployeeDetailPage.tsx] — карточка сотрудника, точка встраивания.
- [Source: frontend/src/app/App.tsx] — `RequirePermission`/роутинг (переиспользуется, не создаётся заново).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `StatusCalendarPanel` — локальный `useState<{year, month}>` (дефолт — текущий месяц), `useEmployeeStatusCalendar` (19.4c), 7-колоночная сетка с ведущими пустыми ячейками (`getDay()`-сдвиг). Loading/error/success — три взаимоисключающих ветки рендера. НЕ встраивается в `EmployeeDetailPage` напрямую (обнаружено гейтом: `eslint-plugin-boundaries` ARCH-FE-013 запрещает cross-feature импорт `personnel → status-calendar`) — рефакторинг на render-prop `renderExtra?: (employee) => ReactNode`, композиция в `app/App.tsx` (единственный слой матрицы, которому разрешён импорт из ЛЮБОЙ фичи). Живая проверка в браузере (`preview_start`, demo-режим) выявила: без MSW-фикстуры новый эндпоинт падает через MSW's `onUnhandledRequest: "error"` (проект не допускает тихий passthrough) — компонент застревал БЕЗ error-UI (query, похоже, никогда не переходила в `isError` из-за характера MSW-internal-исключения, не HTTP-ответа) — добавлена MSW dev-фикстура (`features/status-calendar/mocks/handlers.ts`, синтетический месяц). После фикстуры — визуально подтверждено: сетка на 31 день, VACATION-неделя (10-14), навигация «‹»/«›» меняет месяц и год (переход Август→Июль), рефетч работает. 4 теста (loading/success/error/navigation). `npm run gate` (frontend) — 1137 passed, 0 regressions.

**Ревью (Blind Hunter + Edge Case Hunter + Acceptance Auditor)** — все 6 AC подтверждены; ARCH-FE-013-разделение (personnel НЕ импортирует status-calendar, композиция только в `app/App.tsx`) независимо перепроверено grep'ом. 2 действия применены: (1) MSW dev-фикстура тихо превращала `Number(null)===0`/`Number('abc')===NaN` в невалидные ISO-ключи (`"2026-00-15"`) при отсутствующих/некорректных `year`/`month` — добавлены `parseYearOrDefault`/`parseMonthOrDefault` с откатом на реальный текущий месяц; (2) добавлены `initialYear`/`initialMonth` test-only пропы на `StatusCalendarPanel` (попытка через `vi.useFakeTimers()` ломала внутренние таймеры TanStack Query — тесты зависали) + 4 новых теста на найденные пробелы (переход год-границы Янв→Дек и Дек→Янв, високосный/невисокосный февраль) + 4 теста на сам MSW-хендлер (`handlers.test.ts`, включая явный тест отката при `year=abc&month=xyz`). `npm run gate` (frontend) — 1145 passed после фикса.

### File List

- `frontend/src/features/status-calendar/pages/StatusCalendarPanel.tsx` (new)
- `frontend/src/features/status-calendar/pages/StatusCalendarPanel.test.tsx` (new)
- `frontend/src/features/status-calendar/mocks/handlers.ts` (new — MSW dev-фикстура, вне исходного Scope Decision)
- `frontend/src/features/personnel/pages/EmployeeDetailPage.tsx` (modified — `renderExtra` render-prop slot)
- `frontend/src/app/App.tsx` (modified — композиция `StatusCalendarPanel` через `renderExtra`)
- `frontend/src/app/mocks/compose-handlers.ts` (modified — регистрация `statusCalendarHandlers`)
- `frontend/src/features/status-calendar/mocks/handlers.test.ts` (new — review fix, откат на текущий месяц при невалидных параметрах)

## Change Log

| Date | Change |
|---|---|
| 2026-08-05 | Story created (create-story workflow, 19.4d — панель календаря в карточке сотрудника), baseline `945f3d0` |
| 2026-08-05 | Implemented (dev-story), status → review |
| 2026-08-05 | Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): fixed MSW mock's NaN/null year-month fallback bug, added year-boundary + leap-year tests via test-only props; status → done |
