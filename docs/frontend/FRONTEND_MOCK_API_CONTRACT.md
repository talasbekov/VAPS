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

| operation_id | owner_feature | contract_status | method/path | permission | mock_handler | contract_test |
|---|---|---|---|---|---|---|
| listDictionaryDefinitions | features/dictionaries | backend-contract-pending | GET /api/ops/dictionaries/ | ops.dictionary.view | mocks/handlers.ts | mocks/repository.test.ts |
| listDictionaryEntries | features/dictionaries | backend-contract-pending | GET /api/ops/dictionaries/:code/entries/ | ops.dictionary.view | mocks/handlers.ts | mocks/repository.test.ts |
| createDictionaryEntry | features/dictionaries | backend-contract-pending | POST /api/ops/dictionaries/:code/entries/ | ops.dictionary.manage | mocks/handlers.ts | mocks/repository.test.ts |
| setDictionaryEntryActive | features/dictionaries | backend-contract-pending | POST /api/ops/dictionaries/entries/:id/set-active/ | ops.dictionary.manage | mocks/handlers.ts | mocks/repository.test.ts (409 на referencedCount>0) |

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

Мутаций у ресурса нет: месяц — проекция уже существующих `DutyShift`, собственной
сущности плана (DRAFT→APPROVED, §21.27) в этом срезе не заведено.

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
