# FRONTEND_MOCK_API_CONTRACT

Реестр всех frontend-операций (§7.2). Колонки: `operation_id | owner_feature | contract_status | source_reference | method | path | success_status | pagination | error_codes | permission | scope | side_effects | query_key | cache_invalidation | mock_handler | contract_test`.

## Существующие операции (переиспользуются, НЕ трогать контракт)

| operation_id | owner_feature | contract_status | method/path | permission |
|---|---|---|---|---|
| getMyPermissions | shared/auth | existing | GET /api/operations/my-permissions/ | (RequireAuth) — mock: `app/mocks/identity-handlers.ts`, читает `X-User-Id` → `app/mocks/demo-personas.ts` |
| listDailySubmissions | features/daily-grid | existing | GET/POST /api/operations/daily-submissions/ | daily_report.mark_update |
| trafficLightTree | features/traffic-light | existing | GET /api/operations/traffic-light/tree/ | status.view |
| expenseReports | features/expense | existing | GET /api/operations/expense-reports/ | daily_report.generate |
| temporaryDuty (override protocol) | shared/api/testing | existing (тестовая протокольная фикстура) | POST /api/operations/temporary-duty/ | — |

(`listEmployees`/`auditLogs` — см. секции «Personnel»/«Audit» ниже, подробнее с mock_handler/contract_test.)

## Smart Josparlau — новые операции (namespace `/api/ops/…`)

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listSecurityEvents | features/security-events | backend-contract-pending | GET /api/ops/security-events/ | ops.security_event.view | mocks/handlers.ts | mocks/repository.test.ts |
| getSecurityEvent | features/security-events | backend-contract-pending | GET /api/ops/security-events/:id/ | ops.security_event.view | mocks/handlers.ts | mocks/repository.test.ts |
| createSecurityEvent | features/security-events | backend-contract-pending | POST /api/ops/security-events/ | ops.security_event.create | mocks/handlers.ts | mocks/repository.test.ts |
| updateBulletin | features/security-events | backend-contract-pending | PATCH /api/ops/security-events/:id/bulletin/ | ops.bulletin.manage | mocks/handlers.ts | mocks/repository.test.ts |
| updateRecon | features/security-events | backend-contract-pending | PATCH /api/ops/security-events/:id/recon/ | ops.recon.manage | mocks/handlers.ts | mocks/repository.test.ts |
| completeRecon | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/recon/complete/ | ops.recon.manage | mocks/handlers.ts | mocks/repository.test.ts |
| approveDemand (сохраняет строки И утверждает — одна операция) | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/demand/approve/ | ops.demand.manage | mocks/handlers.ts | mocks/repository.test.ts |
| updateForceAllocation | features/security-events | backend-contract-pending | PATCH /api/ops/security-events/:id/forces/:requestId/ | ops.force_allocation.manage | mocks/handlers.ts | mocks/repository.test.ts |
| completeForces | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/forces/complete/ | ops.force_allocation.manage | mocks/handlers.ts | mocks/repository.test.ts |
| assignPlacement | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/placement/assign/ | ops.placement.manage | mocks/handlers.ts | mocks/repository.test.ts |
| unassignPlacement | features/security-events | backend-contract-pending | DELETE /api/ops/security-events/:id/placement/:assignmentId/ | ops.placement.manage | mocks/handlers.ts | mocks/repository.test.ts |
| completePlacement | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/placement/complete/ | ops.placement.manage | mocks/handlers.ts | mocks/repository.test.ts |
| approvePlacement | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/approval/approve/ | ops.placement.approve | mocks/handlers.ts | mocks/repository.test.ts |
| returnPlacement | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/approval/return/ | ops.placement.approve | mocks/handlers.ts | mocks/repository.test.ts |
| listPersonnelRoster | features/security-events | external-personnel-contract-pending | GET /api/ops/personnel/ | ops.placement.manage | mocks/handlers.ts | ручная проверка (8 синтетических записей, personnelRoster.ts) |
| acknowledgePlacement | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/acknowledge/:assignmentId/ | ops.acknowledgement.manage | mocks/handlers.ts | mocks/repository.test.ts |
| completeAcknowledgement | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/acknowledgement/complete/ | ops.acknowledgement.manage | mocks/handlers.ts | mocks/repository.test.ts |
| addJournalEntry | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/journal/ | ops.conduct.manage | mocks/handlers.ts | mocks/repository.test.ts |
| closeSecurityEvent | features/security-events | backend-contract-pending | POST /api/ops/security-events/:id/close/ | ops.closure.manage | mocks/handlers.ts | mocks/repository.test.ts |

Правила заполнения при добавлении:
1. Одна строка = одна операция, статус по умолчанию `backend-contract-pending` (Smart Josparlau backend не существует) либо `external-personnel-contract-pending` (кадровые read-only snapshot'ы) либо `mock-only-demo` (persona/scenario/reset).
2. `mock_handler` — точный путь файла в `features/<feature>/mocks/handlers.ts`.
3. `contract_test` — путь к тесту, подтверждающему, что hook/handler/fixture используют один и тот же тип (§7.5 «не создавай отдельные несовместимые типы»).
4. Никогда не переводить в `existing` без реального committed `schema.yaml` — см. §7.6.

## Personnel (namespace `/api/core/…`, existing donor-схема — НЕ pending-contract)

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listEmployees | features/personnel | existing | GET /api/core/employees/ | status.view | mocks/handlers.ts | ручная проверка (5 синтетических записей, fixtures.ts) |
| getEmployee | features/personnel | existing | GET /api/core/employees/:id/ | status.view | mocks/handlers.ts | ручная проверка |
| listDivisions | features/personnel | existing | GET /api/core/divisions/ | status.view | mocks/handlers.ts | ручная проверка |
| listPositions | features/personnel | existing | GET /api/core/positions/ | status.view | mocks/handlers.ts | ручная проверка |
| listRanks | features/personnel | existing | GET /api/core/ranks/ | status.view | mocks/handlers.ts | ручная проверка |

## Objects (namespace `/api/ops/objects/`, mock-only-demo — backend-contract-pending)

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listObjects | features/objects | backend-contract-pending | GET /api/ops/objects/ | ops.object.view | mocks/handlers.ts | ручная проверка (3 синтетических объекта, fixtures.ts) |
| getObject | features/objects | backend-contract-pending | GET /api/ops/objects/:id/ | ops.object.view | mocks/handlers.ts | ручная проверка |
| updatePassport | features/objects | backend-contract-pending | PATCH /api/ops/objects/:id/passport/ | ops.object.manage | mocks/handlers.ts | ручная проверка |
| publishPassportVersion | features/objects | backend-contract-pending | POST /api/ops/objects/:id/passport/versions/ | ops.object.manage | mocks/handlers.ts | mocks/repository.test.ts (10 тестов), e2e-mock/objects-passport.spec.ts |

## Audit (namespace `/api/audit/…`, existing donor-схема)

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listAuditLogs | features/audit | existing | GET /api/audit/logs/ | audit.view | mocks/handlers.ts | ручная проверка (3 синтетические записи, fixtures.ts) |

## Duties (namespace `/api/ops/duty-types|duty-shifts/`, mock-only-demo — backend-contract-pending)

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listDutyTypes | features/duties | backend-contract-pending | GET /api/ops/duty-types/ | ops.duty.view | mocks/handlers.ts | ручная проверка (2 типа, fixtures.ts) |
| listDutyShifts | features/duties | backend-contract-pending | GET /api/ops/duty-shifts/ | ops.duty.view | mocks/handlers.ts | ручная проверка (4 синтетические смены) |
| acknowledgeDutyShift | features/duties | backend-contract-pending | POST /api/ops/duty-shifts/:id/acknowledge/ | ops.duty.manage | mocks/handlers.ts | ручная проверка |
| clockInDutyShift | features/duties | backend-contract-pending | POST /api/ops/duty-shifts/:id/clock-in/ | ops.duty.manage | mocks/handlers.ts | ручная проверка |
| clockOutDutyShift | features/duties | backend-contract-pending | POST /api/ops/duty-shifts/:id/clock-out/ | ops.duty.manage | mocks/handlers.ts | ручная проверка |
| updateDutyShift | features/duties | backend-contract-pending | POST /api/ops/duty-shifts/:id/update/ | ops.duty.manage (+ ops.duty.override_rest для обхода) | mocks/handlers.ts | mocks/repository.test.ts (state-гейт, снятие ознакомления, UNKNOWN_POST, DUTY_CONFLICT_HARD/DETECTED) |
| cancelDutyShift | features/duties | backend-contract-pending | POST /api/ops/duty-shifts/:id/cancel/ | ops.duty.manage | mocks/handlers.ts | mocks/repository.test.ts (REASON_REQUIRED, INVALID_STATE_TRANSITION, освобождение сотрудника) |
| listDutyShiftList | features/duties | backend-contract-pending | GET /api/ops/duty-shift-list/?scope=history | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts (два признака истории, порядок, серверные конфликты) |
| getDutyShiftDetail | features/duties | backend-contract-pending | GET /api/ops/duty-shifts/:id/ | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts (403/404, конфликты по сотруднику и дню, stale, dutyType=null) |
| listDutyPlanObjects | features/duties | backend-contract-pending | GET /api/ops/duty-plan-objects/?business_date=&duty_type_code= | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts (три причины блокировки, INVALID_BUSINESS_DATE/UNKNOWN_DUTY_TYPE) |
| listDutyCandidates | features/duties | backend-contract-pending | GET /api/ops/duty-candidates/?business_date= | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts (занятость по реальным сменам, unavailableAttributes) |
| createDutyShift | features/duties | backend-contract-pending | POST /api/ops/duty-shifts/ | ops.duty.manage (+ ops.duty.override_rest для обхода) | mocks/handlers.ts | mocks/repository.test.ts (PASSPORT_NOT_READY/PASSPORT_VERSION_MISSING/UNKNOWN_POST/UNKNOWN_OBJECT/UNKNOWN_DUTY_TYPE/DUTY_CONFLICT_HARD 422, DUTY_CONFLICT_DETECTED 409) |
| listCombatDutyTypes | features/duties | backend-contract-pending | GET /api/ops/combat-duty-types/ | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts |
| listDutyRoutes | features/duties | backend-contract-pending | GET /api/ops/duty-routes/ | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts |
| listCombatRosterCandidates | features/duties | backend-contract-pending | GET /api/ops/combat-roster-candidates/ | ops.combat_group.submit | mocks/handlers.ts | mocks/repository.test.ts |
| listCombatDutyShifts | features/duties | backend-contract-pending | GET /api/ops/combat-duty-shifts/ | ops.duty.view | mocks/handlers.ts | mocks/repository.test.ts |
| submitCombatGroup | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/:id/submit/ | ops.combat_group.submit | mocks/handlers.ts | mocks/repository.test.ts (EMPTY_GROUP/ALREADY_SUBMITTED/DOUBLE_ASSIGNMENT) |
| reviewCombatGroup | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/:id/review/ | ops.combat_group.review | mocks/handlers.ts | mocks/repository.test.ts (REASON_REQUIRED/INVALID_STATE_TRANSITION) |
| acknowledgeCombatDuty | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/:id/acknowledge/ | ops.combat_group.acknowledge | mocks/handlers.ts | mocks/repository.test.ts (NOT_IN_ROSTER/ALREADY_ACKNOWLEDGED/READY-переход) |
| checkInCombatDuty | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/:id/check-in/ | ops.combat_group.checkin | mocks/handlers.ts | mocks/repository.test.ts (INVALID_STATE_TRANSITION вне READY) |
| completeCombatDuty | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/:id/complete/ | ops.combat_group.complete | mocks/handlers.ts | mocks/repository.test.ts (INVALID_STATE_TRANSITION вне ACTIVE, факт≠план) |
| requestCombatDutyReplacement | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/:id/replace/ | ops.combat_group.replace | mocks/handlers.ts | mocks/repository.test.ts (NOT_IN_ROSTER/ALREADY_IN_ROSTER/DOUBLE_ASSIGNMENT/REASON_REQUIRED/INVALID_STATE_TRANSITION вне PENDING_ACKNOWLEDGEMENT-READY) |
| createCombatDutyShift | features/duties | backend-contract-pending | POST /api/ops/combat-duty-shifts/ | ops.duty.manage | mocks/handlers.ts | mocks/repository.test.ts (INVALID_BUSINESS_DATE/EMPTY_ROUTE_SET/INVALID_REQUIREMENT/UNKNOWN_DUTY_TYPE/UNKNOWN_ROUTE/TOO_MANY_ROUTES) |

«Боевые группы на Трассе» (§24.5-24.10, по запросу «боевые группы на Трассе») — подача состава (leader+members+reserve) → рассмотрение (принять/вернуть с причиной). `submittedByUnitName` присваивается СЕРВЕРНО (repository), не берётся из тела запроса — тот же принцип атрибуции по актору, что и остальные mutation'ы проекта.

ПОСЛЕ принятия (§24.19-24.23, по запросу «Полный §24 боевых групп», FRONTEND_DECISIONS A52): `CombatDutyRosterSubmission.execution` (`PENDING_ACKNOWLEDGEMENT→READY→ACTIVE→COMPLETED`) — `acknowledgeCombatDuty` требует `employeeName` в теле (индивидуальное подтверждение КАЖДОГО leader+members, БЕЗ резерва), `checkInCombatDuty` без тела (только из READY), `completeCombatDuty` требует `actualMemberNames: string[]` (фактический состав, может отличаться от планового `memberEmployeeNames`).

Замена участника (§24.21, по запросу «Продолжение §24», FRONTEND_DECISIONS A53): `requestCombatDutyReplacement` требует `{ outgoingEmployeeName, incomingEmployeeName, reasonCode, safeComment }` — доступна только пока `execution.stateCode` ∈ {PENDING_ACKNOWLEDGEMENT, READY} (не после заступления). Пишет запись в `CombatDutyRosterSubmission.replacements[]` (плоская история, без формального revision-номера), снимает заменённого из `acknowledgedMemberNames`.

Формирование потребности на смену (§24.1, по запросу «Продолжение §24», FRONTEND_DECISIONS A54): `createCombatDutyShift` требует `{ businessDate, dutyTypeCode, routeIds, coverageMode, requiredEmployees }` — заводит новую смену с `submission: null` (сразу «Требует подачи»). Выбирает Трассы из СУЩЕСТВУЮЩЕГО реестра `routes` (создание новых Трасс — Not started). Полный список того, что НЕ реализовано во всём §24 — см. `features/duties/model/types.ts` шапку и FRONTEND_DECISIONS A51/A52/A53/A54.

## Dictionaries (namespace `/api/ops/dictionaries/…`, mock-only-demo — backend-contract-pending, §30)

> Этап 52: каждое значение в ответе несёт `usage` — посчитанные СЕРВЕРОМ связи (`status`: `TRACKED`/`NOT_TRACKED`/`UNKNOWN`, `references[]` с подписью источника и носителями, `totalCount`). Поля `referencedCount` больше нет. Конверт 409 несёт те же связи в `details.usage` (§30 «понятная зависимость»).

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listDictionaryDefinitions | features/dictionaries | backend-contract-pending | GET /api/ops/dictionaries/ | ops.dictionary.view | mocks/handlers.ts | mocks/repository.test.ts |
| listDictionaryEntries | features/dictionaries | backend-contract-pending | GET /api/ops/dictionaries/:code/entries/ | ops.dictionary.view | mocks/handlers.ts | mocks/repository.test.ts |
| createDictionaryEntry | features/dictionaries | backend-contract-pending | POST /api/ops/dictionaries/:code/entries/ | ops.dictionary.manage | mocks/handlers.ts | mocks/repository.test.ts |
| setDictionaryEntryActive | features/dictionaries | backend-contract-pending | POST /api/ops/dictionaries/entries/:id/set-active/ | ops.dictionary.manage | mocks/handlers.ts | mocks/repository.test.ts + mocks/handlers.test.ts (409 `DICTIONARY_ENTRY_REFERENCED` при ЖИВЫХ связях) |
| deleteDictionaryEntry | features/dictionaries | backend-contract-pending | DELETE /api/ops/dictionaries/entries/:id/ | ops.dictionary.manage | mocks/handlers.ts | mocks/repository.test.ts + mocks/handlers.test.ts (409 `DICTIONARY_ENTRY_REFERENCED` / `DICTIONARY_USAGE_NOT_TRACKED` / `DICTIONARY_USAGE_UNKNOWN`; 204 при доказанном отсутствии связей) |

5 справочников (definitions) на момент Этапа 10: `RETURN_REASONS`, `POST_REQUIREMENTS`, `SEASONAL_CORRECTIONS`, `JOURNAL_ENTRY_TYPES`, `POST_REQUIREMENT_GROUPS` (§30 «типы статусов»/«группы», см. FRONTEND_DECISIONS A48). `createDictionaryEntry` принимает необязательный `groupCode` — валидируется ТОЛЬКО когда `code==='POST_REQUIREMENTS'` (должен ссылаться на активную запись `POST_REQUIREMENT_GROUPS`, иначе 400 VALIDATION_ERROR по полю `groupCode`); для остальных справочников поле игнорируется (persist `null`), нет отдельной mock-операции.

## Calendar (§25, `app/CalendarPage.tsx` — композиция, НЕ отдельная фича/mock-операция)

`ops.calendar.view` гейтит только route (`RequirePermission` в `App.tsx`) — новых mock-эндпоинтов/операций НЕТ, страница composитит уже зарегистрированные `listDutyShifts`/`listSecurityEvents` (см. таблицы выше), каждый со своей проверкой прав внутри repository (`ops.duty.view`/`ops.security_event.view`, независимо от `ops.calendar.view`) — см. FRONTEND_DECISIONS A47.

## Привязка ОМ к версии паспорта (§9.6, Этап 29)

| Метод | Путь | Операция | Право | Примечание |
|---|---|---|---|---|
| GET | `/api/ops/security-events/bindable-objects/` | `listBindableObjects` | `ops.security_event.view` | Узкий read model реестра объектов для формы создания ОМ. Регистрируется ДО `:id/` — иначе MSW разберёт сегмент как id. |
| GET | `/api/ops/security-events/:id/passport/` | `getPassportView` | `ops.security_event.view` | ПРОИЗВОДНЫЙ взгляд: хранимый снимок + пересчитанные `applicableVersion*`/`stale`/`importablePostCount`. |
| POST | `/api/ops/security-events/:id/recon/import-from-passport/` | `importReconPostsFromPassport` | `ops.recon.manage` | 422 `RECON_STAGE_REQUIRED` / `NO_PASSPORT_VERSION` / `PASSPORT_VERSION_NOT_FOUND` / `NOTHING_TO_IMPORT`. |

`POST /api/ops/security-events/` изменён: `objectName` (свободный текст) → `objectId`
(идентификатор объекта реестра); имя объекта снимает сервер.

Все три читают чужой слайс `objects` из общего снапшота через рукописную узкую
проекцию (`features/security-events/mocks/objectsSlice.ts`) — серверный join, а не
кросс-фичевый импорт (ARCH-FE-013). Запись в чужой слайс запрещена, покрыта тестом.

## Привязка дежурства к версии паспорта (§9.6, Этап 30)

`GET /api/ops/duty-shifts/` (`listShifts`, право `ops.duty.view`) — БЕЗ нового
эндпоинта: ответ расширен блоком `passportStatuses` рядом с `results`, по одной
записи на строку и в том же порядке.

| Поле `DutyPassportStatus` | Смысл |
|---|---|
| `shiftId` | ключ соединения со строкой `results` |
| `objectKnown` | объект дежурства найден в реестре объектов |
| `applicableVersionId` / `applicableVersionNumber` | версия, действующая на `businessDate` дежурства (`null` — нет такой) |
| `stale` | действует версия НОВЕЕ привязанной (предупреждение, не ошибка) |

Сам снимок `passportBinding` (objectId/versionId/versionNumber/effectiveFrom/
sectorId/sectorName/postId/postName/boundAt) — ХРАНИМОЕ поле `DutyShift`, приходит
внутри `results`. Статус читает чужой слайс `objects` из общего снапшота через
рукописную узкую проекцию (`features/duties/mocks/objectsSlice.ts`) — серверный
join, а не кросс-фичевый импорт (ARCH-FE-013). Запись в чужой слайс запрещена и
покрыта тестом (снимок слайса до/после переходов дежурства).


## Этап 31 — месячный план дежурств (§21.27-21.30)

`GET /api/ops/duty-monthly-plan/?month=YYYY-MM` (`getMonthlyPlan`, право
`ops.duty.view`). `month` обязателен: молчаливый дефолт «текущий месяц» разошёлся
бы с месяцем, выбранным пользователем, — вместо этого 422 `INVALID_MONTH`.

| Блок ответа | Смысл |
|---|---|
| `month` / `days[]` | месяц и ВСЕ его календарные дни (сетка не зависит от наличия смен) |
| `rows[]` | строка на объект: `objectId`, `objectLabel`, `cells[]` по дню |
| `cells[].shiftCount` / `notAcknowledgedCount` / `completedCount` | счётчики дня по объекту |
| `cells[].hardConflictCount` / `softConflictCount` | конфликты, попавшие в эту клетку |
| `kpi` | §21.29 — серверные значения по ВСЕМУ месяцу, не по отрисованной части |
| `conflicts[]` | `severity` (HARD/SOFT) назначает сервер (§21.34), сообщение готово к показу |
| `unavailableMetrics[]` | §35 — показатели прототипа, которых нет в модели, с причиной |

## Этап 38 — lifecycle месячного плана (§21.27) и шапка плана (§21.28)

У ресурса появилась собственная сущность плана и четыре мутации. Ответ
`GET /api/ops/duty-monthly-plan/?month=` дополнен блоком `header`:

| Поле `header` | Смысл |
|---|---|
| `record` | `MonthlyPlanRecord` или **`null`** — «плана нет» и «план в черновике» разные факты |
| `record.stateCode` | ТОЛЬКО `DRAFT`/`APPROVED`; `VALIDATED` — не состояние (§21.27) |
| `record.revision` | редакция; растёт только при открытии новой (§21.27) |
| `record.lastValidation` | результат проверки: когда, сколько жёстких/мягких, пройдена ли, отпечаток состава |
| `record.history[]` | §21.27 «история не перезаписывается» — только дополнение |
| `objectSource` | §21.28 «источник объектов»: реестр + сколько объектов месяца вне его |
| `actions[]` | §21.28 action policy: шесть действий, `enabled` + `reason` у каждого недоступного |
| `unavailableFields[]` / `unavailableApprovalEffects[]` | §35 — поля шапки и эффекты утверждения, которых модель не даёт |

| Мутация | Право | Отказы |
|---|---|---|
| `POST …/duty-monthly-plan/draft/` | `ops.duty.manage` | 422 `PLAN_ALREADY_EXISTS`, `INVALID_MONTH` |
| `POST …/duty-monthly-plan/check/` | `ops.duty.manage` | 404 (плана нет), 422 `PLAN_APPROVED_LOCKED` |
| `POST …/duty-monthly-plan/approve/` | `ops.duty.approve_plan` | 404, 422 `PLAN_NOT_VALIDATED` / `PLAN_VALIDATION_STALE` / `PLAN_HAS_HARD_CONFLICTS` / `PLAN_ALREADY_APPROVED` |
| `POST …/duty-monthly-plan/reopen/` | `ops.duty.approve_plan` | 404, 422 `INVALID_STATE_TRANSITION` |

Тело всех четырёх — `{ month: "YYYY-MM" }`: плана как отдельного идентификатора нет,
ключ — сам месяц. Ответ — `MonthlyPlanRecord`.

**Побочный эффект на ЧУЖИЕ операции**: `POST /api/ops/duty-shifts/`, `…/update/` и
`…/cancel/` отвечают 422 `PLAN_APPROVED_LOCKED`, если месяц смены утверждён (§21.27
«план фиксируется»). Ознакомление, заступление и завершение НЕ затронуты — это факт
несения службы, а не изменение плана.

## NEXT ACTION
Регистрировать первые операции `features/analytics`/дальнейшее расширение duties (боевые группы, месячное планирование) — по решению пользователя.

`POST /api/ops/duty-shifts/` (`createDutyShift`, §21.31) — ЕДИНСТВЕННАЯ операция Smart
Josparlau, которая отвечает **409**, а не только 422. Это не разнобой, а канон §36
(400 = форма, 422 = бизнес-правило, 409 = конфликт): мягкий конфликт §21.34 — состояние,
которое можно пройти с обоснованием, и код ответа обязан это различать. Код ошибки
`DUTY_CONFLICT_DETECTED` взят из `docs/registries/error-codes.yaml` (`overridable: true`),
а не выдуман: именно он включает `useApiMutation.conflict` → общий `shared/ui/ConflictDialog`
→ повтор с `override: true` + `override_reason` (snake_case, канон L429) В ТЕЛЕ запроса.
Тело повтора — исходное плюс эти два ключа; жёсткий конфликт (`DUTY_CONFLICT_HARD`)
остаётся 422 и обходу не подлежит.

`GET /api/ops/duty-plan-objects/` — оба query-параметра ОБЯЗАТЕЛЬНЫ (422 иначе): без
`business_date` не выбрать действующую версию паспорта, без `duty_type_code` не применить
политику §21.31 «красный паспорт + вид, требующий актуального». Ответ несёт `blockReason`
уже сформулированной строкой — форма причину не выводит (см. FRONTEND_DECISIONS A64).

`GET /api/ops/objects/` (§21.7, Этап 37) отдаёт не только `results`, но и `freshness`
(по записи на строку, тот же порядок), `kpi` (по ВСЕМУ реестру), `freshnessPolicy`
(версия + интервал) и `unavailableKpi`. Одним ответом, а не двумя запросами: KPI,
посчитанный по другому снимку реестра, чем показанная таблица, хуже отсутствующего.
Срок актуальности НЕ вычисляется фронтом — §21.7 прямо запрещает фиксированный
frontend-период, поэтому и интервал (данные), и результат (`verificationDueAt`,
`freshnessState`) принадлежат серверу.

## Этап 39 — безопасная проекция личного состава и раскрытие ИИН (§20.27/§20.29/§20.33)

⚠️ Путь — `/api/ops/personnel-directory/`, а НЕ `/api/ops/personnel/`: последний уже занят
узким ростером кандидатов на посты в `features/security-events`. MSW отдаёт первый
совпавший handler, поэтому коллизия проявляется как молчаливо чужой ответ (поймано e2e).

| Ресурс | Право | Что отдаёт |
|---|---|---|
| `GET /api/ops/personnel-directory/` | `status.view` | безопасная проекция: `iinMasked` вместо `iin`, плюс `canRevealIin` |
| `GET …/{id}/` | `status.view` | та же проекция на одного сотрудника |
| `POST …/{id}/identity-disclosure/` | `personnel.identity.reveal` | `{ iin, disclosedAt, expiresAt }`; 422 `PURPOSE_REQUIRED` без содержательной цели |
| `GET …/{id}/identity-disclosures/` | `personnel.identity.audit` | журнал: кто, когда, зачем — БЕЗ значения |

Полного `iin` нет ни в одном ответе, кроме самого раскрытия. Донорские `/api/core/*`
остаются замоченными как есть (их контракт нам не принадлежит), но экраны портала их
больше не читают.

## Этап 40 — отчётный реестр службы (§22.18-22.25, §20.32)

| Ресурс | Право | Что отдаёт |
|---|---|---|
| `GET /api/ops/service-report-types/` | `ops.report.generate` | типы отчётов, политика хранения, список замаскированных полей и недоступных форматов с причинами, `canExportSensitive` |
| `GET /api/ops/service-report-jobs/` | `ops.report.generate` | работы + БЕЗОПАСНАЯ проекция артефактов (метаданные, без содержимого и без ссылки) + `serverTime` |
| `POST /api/ops/service-report-jobs/` | `ops.report.generate` (+ `ops.report.export_sensitive` при `sensitive: true`) | созданная работа в состоянии `PENDING`; 422 `INVALID_PERIOD` / `PERIOD_TOO_LONG` / `UNKNOWN_REPORT_TYPE` / `UNSUPPORTED_FORMAT` |
| `POST /api/ops/service-report-artifacts/{id}/download/` | те же права, ПОВТОРНО (+ `ops.report.view_foreign_parameters` для ЧУЖОГО артефакта: период написан в первой строке файла) | `{ fileName, content }` — поток, а не ссылка; 422 `ARTIFACT_EXPIRED` |

Постоянной ссылки на файл в контракте нет вовсе — §22.23 запрещает её в HTML, list
endpoint, Tooltip, `aria-label`, telemetry, localStorage и URL, а несуществующей ссылке
неоткуда утечь. Состояния работы (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`) —
серверные; ступень продвигается на чтении реестра (фонового исполнителя в demo нет).


## Этап 41 — история отчётов (§22.25)

| Ресурс | Право | Ответ |
| --- | --- | --- |
| `GET /api/ops/service-report-jobs/?state=&mine=` | `ops.report.generate` | те же работы и артефакты, но: отфильтрованные СЕРВЕРОМ, без работ со скрытыми полями у того, у кого нет `ops.report.export_sensitive`, плюс `actions[]` (доступность каждого действия с причиной отказа), `unavailableColumns[]` и `totalVisible` |
| `POST /api/ops/service-report-jobs/{id}/retry/` | `ops.report.generate` | `{ reused, reportJobId, artifactId }` — при пригодном (не истёкшем) артефакте той же серии новая работа НЕ создаётся; 404 на невидимую работу, 422 `JOB_NOT_FINISHED` |
| `POST /api/ops/service-report-jobs/{id}/new-revision/` | `ops.report.generate` | всегда новая работа (`reused: false`); 422 `NO_BASE_REVISION`, если исходная не завершилась успехом |
| `GET /api/ops/service-report-jobs/{id}/` | `ops.report.generate` (перепроверяется), + `ops.report.view_foreign_parameters` для параметров ЧУЖОЙ работы | §22.27/§22.28 карточка: `{ job, artifact, actions, reportTypeTitle, isOwn, unavailableBlocks, unavailableArtifactFields, serverTime }` — состояние работы и метаданные артефакта ОДНИМ срезом (двумя запросами карточка показала бы состояние из одного ответа и файл из другого). Продвигает работу на чтении, как и список. У чужой работы без права `parameters`, `idempotencyKey` (он производен от параметров!) и `artifact.parameterSnapshot` приходят `null` + `parametersRedactedReason`. Невидимая работа — 404, а не 403 |

Параметры повтора берёт сервер из исходной работы — в теле запроса их нет вовсе.
Невидимая работа отвечает «не найдено», а не «нет прав»: отказ по правам сам
подтверждал бы, что такая выгрузка существует.

## Аналитика службы (§22.3-22.12, Этап 43)

| Операция | Право | Ответ |
| --- | --- | --- |
| `GET /api/ops/service-analytics-presets/` | `ops.analytics.view` | §22.5: пресеты периодов, предел произвольного периода и пресет ПО УМОЛЧАНИЮ — всё из registry, ни одного «последних 7 дней» в коде экрана |
| `GET /api/ops/service-analytics/?preset=` либо `?from=&to=` | `ops.analytics.view` | §22.4 `AnalyticsSnapshot`: `snapshotId`, business date, timezone, период, scope, `generatedAt`, `sourceUpdatedAt`, `freshnessState`, `completenessState`, версии расчёта и политики + `data.metrics` (§22.3 `MetricValue` с `state`/`displayValue`) и `unavailableMetrics` (§35). Строк выборки в ответе НЕТ (§22.12). Отсутствие источника → `value: null` + `UNKNOWN`, а не ноль. 422 `INVALID_PERIOD` / `PERIOD_TOO_LONG` / `UNKNOWN_PERIOD_PRESET` |
| `GET /api/ops/operations-analytics/?level=&object_id=&event_id=&direction_id=&post_id=` | `ops.analytics.operations` (СВОЁ право, §22.26 называет аналитику службы и аналитику ОМ разными пунктами) | §22.13/§22.15: уровень иерархии (`ALL`→`OBJECT`→`EVENT`→`DIRECTION`→`POST`), `breadcrumb`, `columns` УРОВНЯ («запрошено», «выделено», «назначено» — разные колонки, никогда не складываются), `rows` со стабильными `rowId`, `lifecycleDistribution` по Lifecycle Registry + `unknownLifecycleCodes` отдельно, `eventCard` на уровне ОМ, `unavailableMeasures` (§35: воронка §22.14, просрочка, возвраты, открытые инциденты, фактическое участие). Несуществующая цель уровня → 422 `UNKNOWN_LEVEL_TARGET`; нет слайса ОМ → пустые строки + причина | Воронка §22.14 (`funnel`) — по append-only журналу переходов слайса `security-events`: шесть показателей раздельно (достигшие/находящиеся/переходы/возвраты/среднее/медиана), `transitionCount` называет число событий-источников, `funnelUnavailableReason` — когда журнала нет или уровень ниже ОМ.
| `GET /api/ops/service-analytics-attention/?preset=` либо `?from=&to=` | `ops.analytics.view` | §22.11 блок «Требует внимания»: `AnalyticsSnapshot<AttentionData>` со СВОЕЙ `policyVersion` (`attention-policy-*`, НЕ равна политике порогов показателей). Каждый `AttentionItem` несёт `attentionId`, `categoryCode`, `severity`, `safeTitle` (одна из ПЯТИ разрешённых §22.11 формулировок), `safeDescription`, `count` (`null`, когда считать нечего), `scopeLabel`, `targetRoute`/`targetPermission`, `detectedAt`, `policyVersion`. Порядок задаёт сервер. Нет источника или пустая политика → `detectionState: 'UNAVAILABLE'` + причина, а НЕ пустой список |
| `GET /api/ops/service-analytics-drilldown/?snapshot_id=&metric_code=&cursor=` | `ops.analytics.view` + `ops.analytics.drilldown`, ФИО дополнительно по `ops.analytics.personal_detail` | §22.12: страница строк со СТАБИЛЬНЫМИ `rowId`, `nextCursor`, `totalCount`. Несовпадение `snapshot_id` → 422 `SNAPSHOT_OUTDATED`; непосчитанный показатель → 422 `CALCULATION_UNAVAILABLE`; неизвестный код → 422 `UNKNOWN_METRIC`. Без права на детализацию `employeeLabel: null` + `personalDetailReason` |

## Обратная связь (§28, Этап 47)

| Операция | Право | Ответ |
| --- | --- | --- |
| `GET /api/ops/feedback-requests/?search=&type=&status=&module=&page=&mine=` | `ops.feedback.view`; чужие отправленные — `ops.feedback.view_all`; содержание чужого конфиденциального — `ops.feedback.view_confidential` | `{ results, stats, registry, page, pageSize, pageCount, totalMatched, totalVisible, unavailableCapabilities, serverTime }`. Отбор, поиск и нарезка на страницы — СЕРВЕРНЫЕ. Чужой ЧЕРНОВИК не отдаётся ни при каком праве. У закрытого обращения `description`, `descriptionPreview`, `expectedResult`, `reproductionSteps`, `contact`, `relatedRoute`, `attachments`, `technicalInfo` приходят `null` + `restrictedReason`; поиск по описанию для такого смотрящего НЕ выполняется. `stats` считается по всему ВИДИМОМУ набору — до фильтров и до страниц |
| `POST /api/ops/feedback-requests/` | `ops.feedback.create` | Создаёт обращение (`saveAsDraft: true` → статус `DRAFT` без `submittedAt`, иначе `NEW`). Вложения сохраняются ТРЕМЯ полями (`fileName`, `sizeBytes`, `mimeType`) — содержимое не сохраняется, даже если приехало в теле. `technicalInfo` записывается ТОЛЬКО при `includeTechnicalInfo: true`. Коды типа/приоритета/модуля сверяются со справочником: 422 `VALIDATION_ERROR` |
| `POST /api/ops/feedback-requests/{id}/submit/` | `ops.feedback.create` | `DRAFT` → `NEW` + `submittedAt`. Только СВОЙ черновик: чужое обращение (в том числе видимое и уже отправленное) — 404, а не 403 и не «уже отправлено», иначе отказ назвал бы состояние чужой записи. Свой уже отправленный — 422 `FEEDBACK_ALREADY_SUBMITTED` |

Справочник §28 (типы, приоритеты, одиннадцать статусов, модули) приезжает в `registry`
вместе с `registryVersion`: подписи и порядок принадлежат серверу, у экрана их нет.

### Карточка обращения (§28 detail, Этап 48)

| Операция | Право | Ответ |
| --- | --- | --- |
| `GET /api/ops/feedback-requests/{id}/` | `ops.feedback.view` (+ `view_all` для чужого, `view_confidential` для содержания, `internal_note` для заметок) | `{ request, comments, timeline, actions, allowedStatuses, assigneeCandidates, duplicateOf, registry, unavailableBlocks, serverTime }` ОДНИМ срезом. Внутренние заметки и события о них в ответ тому, кому они не видны, не попадают ВООБЩЕ. `allowedStatuses` — из карты `statusTransitions` справочника. Невидимое обращение — 404 |
| `POST /api/ops/feedback-requests/{id}/comments/` | публичный ответ — `ops.feedback.triage` ИЛИ авторство; внутренняя заметка — `ops.feedback.internal_note` | Добавляет комментарий и событие ленты. Закрытое обращение — 422 `FEEDBACK_CLOSED`; черновик — 422 `FEEDBACK_NOT_SUBMITTED` |
| `POST /api/ops/feedback-requests/{id}/triage/` | `ops.feedback.triage` | Ответственный, рабочий приоритет и статус ОДНОЙ операцией (`undefined` — «не трогать», `null` — «снять»). События пишет диффер. Переход вне карты — 422 `FEEDBACK_TRANSITION_NOT_ALLOWED`; терминальный статус — 422 `FEEDBACK_USE_CLOSE` (закрытие оформляется отдельно, с ответом автору) |
| `POST /api/ops/feedback-requests/{id}/close/` | `ops.feedback.triage` | Терминальный статус + ОБЯЗАТЕЛЬНЫЙ публичный ответ автору. Для `DUPLICATE` требуется `duplicateOfId`; оригинал обязан быть видим закрывающему (иначе 404) и не может быть самим обращением |

## Settings (namespace `/api/ops/settings|setting-changes/`, mock-only-demo — backend-contract-pending)

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listSettings | features/settings | backend-contract-pending | GET /api/ops/settings/ | ops.settings.view | mocks/handlers.ts | mocks/repository.test.ts + mocks/handlers.test.ts |
| listSettingChanges | features/settings | backend-contract-pending | GET /api/ops/setting-changes/ | ops.settings.view | mocks/handlers.ts | mocks/repository.test.ts + mocks/handlers.test.ts |
| updateSetting | features/settings | backend-contract-pending | PATCH /api/ops/settings/:settingCode/ | ops.settings.manage (наблюдения) / ops.settings.manage_conflict_rules (правила конфликтов §21.34) | mocks/handlers.ts | mocks/repository.test.ts + mocks/handlers.test.ts + pages/SettingsPage.test.tsx |

Ответ списка несёт `canManage` — право на изменение решает СЕРВЕР, а не экран.

### Коды ошибок `updateSetting`

| Ситуация | HTTP | error_code | Обход |
|---|---|---|---|
| Не целое, вне диапазона записи, причина короче 10 символов | 400 | VALIDATION_ERROR (details по полям) | — |
| Значение совпадает с действующим | 422 | SETTING_VALUE_UNCHANGED | нет |
| Порог предупреждения выше критического у того же детектора | 422 | SETTING_THRESHOLD_ORDER_INVALID | нет |
| Нет права РАЗДЕЛА (`ops.settings.manage` / `ops.settings.manage_conflict_rules`) | 403 | PERMISSION_DENIED | — |
| Правило не редактируется (§21.34 пересечение — hard) | 422 | SETTING_RULE_LOCKED | Замок проверяется ПЕРВЫМ: отказ одинаков даже для wildcard, иначе причина зависела бы от прав смотрящего |
| Неизвестный код настройки | 404 | ENTITY_NOT_FOUND | — |

Мягких конфликтов у раздела нет намеренно: «значение не изменилось» и «порядок порогов»
причиной не обходятся, поэтому `ConflictDialog` здесь не участвует.

⚠️ Журнал живёт по своему префиксу `/api/ops/setting-changes/`, а НЕ
`/api/ops/settings/change-log/`: второй сматчился бы маршрутом `settings/:settingCode/`.

Ответ списка несёт ДВЕ версии — `policyVersion` (наблюдения §22.11) и `conflictPolicyVersion`
(правила §21.34): разделы версионируются порознь (A91). Право и замок приходят в КАЖДОЙ
записи полем `action: { canEdit, disabledReason }` — компонент причину отказа не выводит.
Значение записи — число (`kind: 'NUMBER'`) либо код режима (`kind: 'CHOICE'` + `options`);
журнал хранит готовые ПОДПИСИ, а не сырые значения (A94).

Действующие правила конфликтов приходят и потребителям: `ListDutyTypesResponse`,
`DutyShiftDetail` и месячный план несут `conflictPolicy` — режим §21.35 больше не атрибут
вида дежурства (A90).


### `/api/ops/operational-rating-dynamics/` (§19.20)

Собственный путь, не хвост под `/api/ops/operational-ratings/`: коллизия путей в MSW
разрешается молча в пользу первого handler'а. Выбор сотрудника едет query-параметром
`?employee=`, неизвестный — первый из безопасного списка.

Ответ: `points[]` (period, periodStartsAt/EndsAt, aggregateRating|null, evaluationsCount,
policyVersion, dataState, recordedAt), `boundaries[]` (границы смены методики — считает
СЕРВЕР), `currentPolicy`, `currentPolicyHasClosedPeriods`, `capabilities`, `employees[]`.
Закрытых величин нет ни одним полем — как и в сводке (§19.20/§19.21), закреплено ассертом
по ВСЕМУ JSON. Право то же, что у сводки (`ops.rating.view_aggregate`): динамика — это
агрегаты, а отдельное право охраняло бы ту же операцию чтения (§19.22).

### `/api/ops/rating-analytics/` (§22.16-22.17)

Право — `ops.analytics.view` (раздел аналитики), НЕ `ops.rating.view_aggregate`.
Ответ: `policy`, `periodStartsAt/EndsAt`, `suppressionMinGroupSize`, `figures` (или `null`
с `unpublishedReason`: `FEATURE_DISABLED` → `POLICY_UNDEFINED` → `SUPPRESSION_UNDEFINED`,
порядок значим), `unavailableViews`.

`figures`: `ratedParticipants`, `coveredParticipants`/`totalParticipants` (покрытие),
`withoutAggregate`, `correctedEvaluations` (количеством), `distribution[]` (полуоткрытые
полосы, восьмёрка — своя), `groups[]` (`READY` | `SUPPRESSED` | `NO_AGGREGATE`).
Подавленная группа приходит БЕЗ `aggregateRating` — значение не считается вовсе.
**Общего среднего в ответе нет и появиться не должно** (§22.17, A117).

### `/api/ops/evaluation-workspace/` и `/api/ops/evaluation-work-items/:id/submit/` (§19.7-19.14)

`backend-contract-pending`. Право обоих — `ops.rating.evaluate` (§19.22 «выставление
оценки» — отдельный пункт списка прав), НЕ право сводки.

`GET /api/ops/evaluation-workspace/?event=<securityEventId>` →
`{ events[], selectedEvent, pending[], submitted[], queue, eventProgress, bases[], policy,
loadedAt, capabilities, unavailableReason, unavailableViews[] }`.

- `pending[]` — задания (§19.7) БЕЗ поля `evaluatorUserId`: очередь уже отобрана по
  оценщику, а поле было бы лишь поводом его подменить. Проекция собирается полем за
  полем, а не «всё, кроме оценщика».
- `submitted[]` — СВОИ отправленные оценки (автор = запрашивающий). Чужая запись не
  попадает в ответ ни одной строкой; оценки, полученные смотрящим от других лиц, не
  отдаются вовсе (§19.14).
- `eventProgress` — `null` без `ops.rating.view_aggregate`: счёт работы ДРУГИХ людей
  охраняется правом сводки. Значений оценок в нём нет ни одним полем.
- `bases[]` — основания из policy (§19.10), `requiresNote: true` у «Другое».
- `unavailableReason: 'FEATURE_DISABLED' | null` — §19.3. Отсутствие МЕТОДИКИ оценивать
  не мешает: она управляет расчётом агрегата, а не правом поставить оценку.

`POST /api/ops/evaluation-work-items/:workItemId/submit/`
тело `{ score, basisCode, basisNote, comment, revision }` → `201 { workItem, submitted,
queue }`. Ни оценщика, ни target, ни мероприятия, ни направления в теле нет — это
свойства ЗАДАНИЯ (§19.18 «нельзя изменить оценщика/target/event»).

Коды отказов (422, кроме отмеченных):

| Код | Когда |
| --- | --- |
| `SCORE_OUT_OF_SCALE` / `SCORE_NOT_INTEGER` | вне шкалы 1–10 (нуля в шкале нет) / дробное |
| `BASIS_REQUIRED` / `BASIS_UNKNOWN` | основание не указано / код вне перечня policy |
| `BASIS_NOTE_REQUIRED` | основание требует пояснения (`Другое`) |
| `COMMENT_REQUIRED` | оценка ниже 8 без комментария (§19.9) |
| `EVALUATION_REVISION_MISMATCH` | редакция задания устарела — проверяется РАНЬШЕ правил формы |
| `EVALUATION_ALREADY_SUBMITTED` | по заданию уже отправлена оценка (исправление §19.18 — отдельная операция) |
| `RATING_DISABLED` | оценивание выключено сервером (§19.3) |
| `GROUP_EVALUATION_UNSUPPORTED` | групповая оценка (§19.13) — состав группы на момент мероприятия не записан |
| `ENTITY_NOT_FOUND` (404) | задания нет ИЛИ оно принадлежит другому оценщику: отказ по праву подтвердил бы его существование |

### `/api/ops/evaluation-work-items/:id/detail/` и `.../correct/` (§19.17-19.18)

`backend-contract-pending`. `detail` — ЯВНЫЙ сегмент: путь строки перехватил бы и
`/submit/`, и `/correct/` (MSW разрешает коллизию молча).

`GET .../detail/` → `{ workItem, submitted, chain, bases, canCorrect, loadedAt }`.
Отдаётся ТОЛЬКО автору записи (иначе 404). `chain` — `null` без
`ops.rating.view_correction_chain`; `canCorrect` решает сервер (право + feature flag).

`POST .../correct/` тело `{ score, basisCode, basisNote, comment, reason, revision }` →
`201 { workItem, submitted, chain }`. Право — `ops.rating.correct`. Исходная запись не
переписывается: создаётся замещающая, исходная получает `supersededById`, связь и причина
ложатся записью `EvaluationCorrection`.

Дополнительные коды отказов: `CORRECTION_REASON_REQUIRED` (причина обязательна),
`EVALUATION_NOT_SUBMITTED` (по заданию ещё нечего исправлять), плюс те же
`EVALUATION_REVISION_MISMATCH`, `RATING_DISABLED` и правила формы, что у отправки.

### `/api/ops/evaluation-registry/` и `/api/ops/operational-rating-employee/` (§19.15-19.17)

`backend-contract-pending`. Право обоих — `ops.rating.view_aggregate`.

`GET /api/ops/evaluation-registry/?from&to&event&unit&employee&direction&method&corrected&search&page`
→ `{ results[], total, page, pageCount, options, policy, capabilities, columns,
unavailableViews[] }`.

- строка (`EvaluationRegistryRow`) НЕ содержит `score`, `comment`, `basisCode` и оценщика:
  §19.16 закрывает их держателю права на агрегат, и они отсутствуют в ответе, а не скрыты
  в вёрстке. Идентификатор — `rowId`, а не идентификатор оценки;
- `options` (мероприятия, подразделения, сотрудники) даёт сервер: собранный из строк
  список раскрывал бы только видимых и выглядел бы полным (§19.15);
- `columns.sensitiveDetails` всегда `false`: право под sensitive-просмотр не заведено —
  §19.21 требует к нему scope и срок полномочия;
- границы периода включительны с обеих сторон; порядок — по дате, затем по подписи
  участника (сортировка по агрегату была бы таблицей лидеров, §22.16).

`GET /api/ops/operational-rating-employee/?employee=<id>` → `{ employeeId, safeLabel,
unitSafeLabel, summary, points[], unavailableViews[] }` — §19.17 в aggregate-only ветке:
агрегат, количество учтённых, период, версия методики, дата расчёта и записанные точки
динамики. Неизвестный сотрудник — `ENTITY_NOT_FOUND` (404), а не первая карточка.

### Идемпотентность и конфликты оценивания (§19.25-19.26)

Тела `submit` и `correct` несут `idempotencyKey` (случайная строка, БЕЗ значений записи).
Повтор с тем же ключом возвращает прежний результат: вторая оценка не создаётся, агрегат не
пересчитывается как новая операция. Сервер хранит по ключу идентификаторы результата, а не
снимок ответа.

Конфликты едут **409** и своими кодами (ни один не входит в `OVERRIDABLE_CODES` — общий
`ConflictDialog` для конфликта версии оценки запрещён §19.25):

| Код | Когда | `details` |
| --- | --- | --- |
| `EVALUATION_REVISION_MISMATCH` | редакция задания устарела | `currentRevision`, `currentScore`, `currentBasisLabel`, `currentComment`, `currentEvaluationId` |
| `EVALUATION_ALREADY_CORRECTED` | правится уже вытесненная запись | то же |

Остальные конфликты списка §19.25 (`target no longer eligible`, `assignment replaced`,
`event scope changed`, `archive locked`) НЕ заведены: ни eligibility, ни scope, ни архива в
сборке нет — код без источника не отличался бы от выдуманного.

### `/api/ops/rating-audit/` (§19.27)

`backend-contract-pending`. Право — `ops.rating.view_audit` (§19.22 отдельный пункт), НЕ
право сводки и не право оценивания.

`GET /api/ops/rating-audit/?page` → `{ results[], total, page, pageCount, unavailableViews[] }`.

Запись несёт ТОЛЬКО ссылки и код события: `occurredAt`, `actorUserId`, `eventCode`,
`outcome` (`SUCCESS`/`REJECTED`), `reasonCode`, `securityEventId`, `eventRunId`,
`assignmentId`, `evaluationId`, `correctionId`, `requestId` (= ключ идемпотентности §19.26),
`revision`. Значений оценок, комментариев и связи «оценка ↔ оценщик» в ней нет: §19.27
отдаёт их отдельной audit privacy permission, а §19.21 требует к ней scope и срок
полномочия, которых в сборке нет.

Коды событий: `EVALUATION_SUBMITTED`, `EVALUATION_SCORE_CHANGED_FROM_INITIAL`,
`EVALUATION_LOW_SCORE_WITHOUT_COMMENT`, `EVALUATION_CORRECTED`,
`EVALUATION_CORRECTION_REJECTED`, `EVALUATION_ACCESS_DENIED`.

