# FRONTEND_SOURCE_INDEX

Источники, изученные для frontend-only реализации Smart Josparlau (Этап 0, 2026-07-23).

| Источник | Назначение | Приоритет |
|---|---|---|
| `Smart_Josparlau_frontend_master_prompt.md` (корень репо) | Рабочее задание: роль, стек, границы, этапы, DoD, запреты | 1 (инструкция агенту) |
| `docs/RECONCILIATION.md` | Разрешённые противоречия прототип/канон (conflict model, BEFORE_DUTY, ratings, post-limits, HR read-only) | 1 (перекрывает прототип) |
| `docs/TECHNICAL_AUDIT.md` | Состояние текущего backend (Report/EmployeeStatus/Division/StaffUnit/Employee) — что нельзя дублировать в mock | 1 |
| `_bmad-output/planning-artifacts/epics.md` (Epics 14–20) | Story-скелет предметной области (объекты/дежурства, ОМ 4 стадии, нагрузка, дашборды) | 2 |
| `_bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/` | Бизнес-правила, FR-номера | 2 |
| `Smart Josparlau (Прототип HTML)/Smart Josparlau.dc.html`, `Дежурства.dc.html`, `КалендарьСмен.dc.html`, `Объекты.dc.html`, `uploads/step2..step11_*.html` | Инвентарь экранов/полей/переходов/demo-данных | 3 (не кодовая база) |
| `Smart Josparlau (Прототип HTML)/_ds/**` | VAPS Design System (23 компонента, токены Tailwind) | 3 (справочно; frontend/ уже потребляет токены) |
| `frontend/src/**` (существующий код: routes.ts, App.tsx, AuthContext, usePermissions, guards.tsx, client.ts, errors.ts, eslint.config.js) | Обязательная архитектурная база — расширяем, не дублируем | 0 (живой код > всех документов) |
| `docs/PersonnelStatus/*.md`, `docs/registries/*.yaml` | Термины предметной области, коды ошибок/аудита/WS | 2 |

## Иерархия приоритетов при конфликте
1. Живой код и тесты `frontend/src/`.
2. `docs/RECONCILIATION.md` (явно фиксирует, что в прототипе устарело).
3. BMAD epics/PRD.
4. HTML-прототип (инвентарь, но не источник архитектурных решений).

## `features/feedback` (§28, Этап 47)

`model/types.ts` — коды §28 в типах, подписи в данных; `lib/feedback.ts` — область поиска,
превью, порядок, страницы, сводка, блок §35; `mocks/fixtures.ts` — справочник и девять сеяных
обращений; `mocks/repository.ts` — видимость, вырезание, создание, отправка черновика;
`api/pending-contracts.ts` — `/api/ops/feedback-requests/`; `pages/FeedbackPage.tsx` — экран.

## Известные конфликты, уже разрешённые RECONCILIATION.md
См. `FRONTEND_DECISIONS.md`.
