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

## NEXT ACTION
Регистрировать первые операции `features/analytics`/дальнейшее расширение duties (боевые группы, месячное планирование) — по решению пользователя.
