---
title: Архитектура фронтенда
module: frontend
updated: 2026-08-20
tags: [frontend, architecture]
---

> 🗄️ **Архивировано 2026-08-21.** Конспект архитектуры демонтированной 10.08.2026 vite-SPA (`frontend/`). Актуальная архитектура живого фронта — [[../../Frontend/Архитектура]].

# Архитектура фронтенда

Конспект `docs/frontend/FRONTEND_SOURCE_INDEX.md`, `FRONTEND_ROUTE_MAP.md`, `FRONTEND_TRACEABILITY_MATRIX.md` (слито 2026-08-20). Документы описывают **демонтированную 10.08.2026 SPA** (`frontend/`, Vite + React + MSW, «Smart Josparlau») — живой фронт сейчас PersonalRecordFront (Next.js :3106), куда прототип переносился срезами (`/security-ops/**`). Конспект сохраняет архитектурные принципы SPA — они переносимы; конкретные пути кода — история. См. также [[../../Frontend/Дизайн-и-скин|Дизайн-и-скин]], [[Тестирование-SPA|Тестирование (SPA)]], [[../../Продукт/Карта-модулей|Карту модулей]].

## Иерархия источников истины (Этап 0)

При конфликте документов SPA действовал порядок:
1. живой код и тесты `frontend/src/`;
2. `docs/RECONCILIATION.md` (разрешённые противоречия прототип/канон);
3. BMAD epics/PRD (`_bmad-output/planning-artifacts/`, Epics 14–20);
4. HTML-прототип (`Smart Josparlau (Прототип HTML)/`) — инвентарь экранов, не источник архитектурных решений.

## Структура каталогов

- `app/` — композиция: маршрутизация, layout, demo-runtime (persona/seed/DemoClock), страницы, композирующие несколько фич (`ServiceAnalyticsPage`, `CalendarPage`), контрактные тесты снапшота.
- `features/<name>/` — вертикальные срезы: `model/types.ts`, `mocks/` (fixtures + repository + MSW handlers), `api/pending-contracts.ts`, `lib/` (доменные расчёты), `pages/`. Фичи: security-events, personnel, objects, duties, dictionaries, audit, service-analytics, service-reports, feedback, settings, ratings, print-forms, calendar…
- `shared/` — `routes.ts` (ROUTES/NAV_SECTIONS — единый источник маршрутов), `api/client.ts` (один apiClient для старых `/api/core|operations/…` и новых `/api/ops/…`), `ui/` (в т.ч. общий `ConflictDialog`).
- Границы держал eslint-plugin-boundaries: **features→features запрещён** (ARCH-FE-013); чтение чужого слайса — только «серверным» join'ом через рукописную узкую проекцию (`mocks/*Slice.ts`); литеральные пути вне `shared/routes.ts` красные (ARCH-FE-012); рукописные типы при наличии схемы красные (ARCH-FE-011).

## Карта маршрутов (итоговая, по FRONTEND_ROUTE_MAP)

Донорские (до Smart Josparlau): `/login`, `/` (home), `/employees`, `/daily-expense`, `/organization`, `/reports`, `/audit`, `/print/test|expense|placement`, `/changelog`.

Smart Josparlau:

| URL | право | статус |
|---|---|---|
| /command-center | ops.dashboard.view | Implemented (только «Готовность ОМ», A12) |
| /security-events, /security-events/:id | ops.security_event.view | Verified (полный цикл 6→9 стадий) |
| /security-events/:id/archive | ops.security_event.view | Verified (read-only архив дела) |
| /security-events/:id/placement, /protected-persons | ops.placement.view / ops.protected_person.view | Not started |
| /objects, /objects/:id, /objects/:id/passports/:versionId | ops.object.view | Verified |
| /duties, /duties/:id | ops.duty.view (действия — ops.duty.manage) | Verified |
| /calendar | ops.calendar.view | Verified (только «Календарь по дням», A44-A46) |
| /analytics | ops.analytics.view | Verified (переписан в features/service-analytics) |
| /service-reports, …/history, …/:reportJobId | ops.report.generate (перепроверяется на каждом маршруте) | Verified |
| /feedback, /feedback/:feedbackId | ops.feedback.view | Verified |
| /settings | ops.settings.view (manage решает сервер) | Verified |
| /dictionaries, /dictionaries/:code | ops.dictionary.view | Verified |
| /ratings, /ratings/workspace, /ratings/evaluations, /ratings/employees/:id, /ratings/analytics, /ratings/audit, /ratings/export | отдельные права ops.rating.* на каждый вход | Verified |

Правила карты: маршрут не заводится раньше реальной страницы (запрет §35 «нет пустых routes»); право маршрута перепроверяется заново на каждом deep link (переход со «своего» экрана доступ не подтверждает); невидимая сущность отвечает 404, а не 403; детальные страницы (`/duties/:id`, `/service-reports/:id`, архив) в NAV не живут — вход только ссылкой из реестра.

## Прослеживаемость (FRONTEND_TRACEABILITY_MATRIX)

Принцип: каждая строка = **требование/экран прототипа → route → feature → mock-операция → тест → статус** (`Not started | In progress | Implemented | Verified | Blocked`). Ложный «Done» запрещён (§35); всё нереализованное названо на самом экране блоком с причиной, а не спрятано. Матрица лежала в `docs/frontend/FRONTEND_TRACEABILITY_MATRIX.md`, обновлялась на каждом этапе и дважды сверялась с кодом заново (ловила собственный дрейф — журнал штаба/закрытие ошибочно значились Not started).

Итог на момент заморозки: **51 из ~70 экранов Verified** (весь жизненный цикл ОМ, объекты/паспорта/версии, дежурства с месячным планом §21, боевые группы §24 конвейером, отчёты §22, обратная связь §28, настройки §29, справочники §30, рейтинг §19). Not started: уведомления, «Мой профиль», полный §24 (принимающий экипаж, Conflict Repository), схемы/документы объектов, blob-зависимые материалы.
