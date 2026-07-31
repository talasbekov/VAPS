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
`api/pending-contracts.ts` — `/api/ops/feedback-requests/`; `pages/FeedbackPage.tsx` — реестр,
`pages/FeedbackDetailPage.tsx` — карточка обращения (§28 detail).

## Известные конфликты, уже разрешённые RECONCILIATION.md
См. `FRONTEND_DECISIONS.md`.

## Этап 50 — правила конфликтов §29 / §21.35

- `src/features/settings/model/types.ts` — `StoredSetting` = `NumericSetting | ChoiceSetting`,
  `SettingSectionCode`, `SettingAction` (право и замок считает сервер).
- `src/features/settings/mocks/fixtures.ts` — `CONFLICT_RULE_SETTINGS`,
  `INITIAL_CONFLICT_POLICY_VERSION`.
- `src/features/duties/mocks/settingsSlice.ts` — узкая проекция правил конфликтов из чужого
  слайса (шестой случай приёма) + строгий дефолт §21.35.
- `src/features/duties/model/types.ts` — `ConflictPolicy`; `restPolicy` из
  `DutyTypeDefinition` УДАЛЁН.
- `src/features/service-analytics/mocks/settingsSlice.ts` — `readRestAfterDutyMode`.
- `e2e-mock/settings-conflict-rules.spec.ts` — «правка правила меняет исход назначения».

## Этап 51 — свежесть паспорта §21.7 / контракт снапшота

- `src/features/settings/mocks/fixtures.ts` — `PASSPORT_FRESHNESS_SETTINGS`,
  `INITIAL_SECTION_VERSIONS` (карта версий разделов).
- `src/features/objects/mocks/settingsSlice.ts` — узкая проекция политики свежести
  (седьмой случай приёма) + fallback с говорящей версией.
- `src/features/objects/lib/passportFreshness.ts` — `DUE_SOON_FRACTION` УДАЛЁН, порог из
  политики.
- `src/app/mocks/settings-projections.contract.test.ts` — контракт demo-снапшота: все
  потребители политики против реального сида.
- `e2e-mock/settings-passport-policy.spec.ts` — «правка интервала меняет реестр объектов».
- `src/features/ratings/lib/dynamics.ts` — разрез ряда динамики §19.20: где линию вести
  можно, а где нельзя (смена методики, период без агрегата). Никаких расчётов агрегата.
- `src/features/ratings/pages/RatingDynamicsSection.tsx` — первый SVG-график проекта:
  отрезки, граница смены методики, tooltip с версией policy + таблица тех же точек.
- `src/features/ratings/lib/analytics.ts` — отчёт §22.16: полосы распределения, агрегаты
  групп и подавление малых (`SUPPRESSED`). Общего среднего не считает намеренно.
- `src/features/ratings/pages/RatingAnalyticsPage.tsx` — маршрут `/ratings/analytics`,
  право `ops.analytics.view` (не право сводки).
- `src/features/ratings/lib/workspace.ts` — ОДНО правило формы оценивания на клиента и
  сервер (§19.9-19.10) + счётчики очереди и прогресса мероприятия.
- `src/features/ratings/pages/EvaluationWorkspacePage.tsx` — маршрут `/ratings/workspace`,
  право `ops.rating.evaluate`: очередь заданий, форма, «Отправленные мной», сводка
  мероприятия (только с правом на агрегат).
- `src/features/ratings/lib/correction.ts` — правила исправления §19.18 (причина +
  повтор правила комментария) и diff «было → стало», печатающий только изменившееся.
- `src/features/ratings/pages/SubmittedEvaluationCard.tsx` — карточка §19.17: история
  записи (correction chain), diff перед подтверждением, мутация с перезагруженной
  редакцией задания.
- `src/features/ratings/pages/RatingNotificationsSection.tsx` — уведомления §19.28:
  фиксированные формулировки по коду, deep link на маршрут с перепроверкой прав.
- `src/features/ratings/pages/RatingAuditPage.tsx` — маршрут `/ratings/audit`, право
  `ops.rating.view_audit`: события и отказы оценивания БЕЗ значений оценок.
- `src/features/ratings/lib/idempotency.ts` — ключ §19.26: один на форму, без значений записи.
- `src/features/ratings/pages/EvaluationConflictNotice.tsx` — конфликт редакции и неизвестный
  исход §19.25-19.26; НЕ `ConflictDialog` (override здесь запрещён).
- `src/features/ratings/lib/registry.ts` — отбор, страницы и безопасный контекст реестра
  §19.15-19.16; строка реестра объявлена БЕЗ закрытых полей.
- `src/features/ratings/pages/EvaluationRegistryPage.tsx` — маршрут `/ratings/evaluations`:
  фильтры в URL, «Детали оценки закрыты» вместо величин.
- `src/features/ratings/pages/RatingEmployeeDetailPage.tsx` — карточка агрегата участника
  (§19.17, aggregate-only) и возврат на сохранённый отбор.
