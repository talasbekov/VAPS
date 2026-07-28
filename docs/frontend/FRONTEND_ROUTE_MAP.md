# FRONTEND_ROUTE_MAP

Единый источник маршрутов — код: `frontend/src/shared/routes.ts` (`ROUTES`, `NAV_SECTIONS`). Этот файл — читаемая проекция для traceability, не дублирует код руками длиннее одной итерации.

## Существующие маршруты (до Smart Josparlau, не трогаем)

| route id | URL | permission | В NAV | Feature |
|---|---|---|---|---|
| login | /login | — | нет | features/auth |
| home | / | status.view | да | app/section-stubs (DashboardStub) |
| employees | /employees | status.view | да | app/section-stubs (EmployeesStub) |
| dailyExpense | /daily-expense | daily_report.mark_update | да | features/daily-grid |
| organization | /organization | status.view | да | features/traffic-light |
| reports | /reports | daily_report.generate | да | features/expense |
| audit | /audit | audit.view | да | app/section-stubs (AuditStub) |
| printTest | /print/test | (RequireAuth only) | нет | features/print-forms |
| printExpense | /print/expense | daily_report.generate | нет | features/print-forms |
| printPlacement | /print/placement | ops.security_event.view | нет | features/print-forms |
| changelog | /changelog | (RequireAuth only, без RequirePermission) | нет | features/changelog |

## Smart Josparlau — планируемые разделы (Этап 2+, статус Not started если не отмечено)

| route id (план) | URL (план) | permission (план) | Этап | Статус |
|---|---|---|---|---|
| commandCenter | /command-center | ops.dashboard.view | 2 | Implemented (только «Готовность ОМ», см. FRONTEND_DECISIONS A12) |
| securityEvents | /security-events | ops.security_event.view | 2 | Verified |
| securityEventDetail | /security-events/:id | ops.security_event.view | 2 | Verified (только этап BULLETIN; остальные 5 стадий — визуальный tracker без функционала) |
| securityEventArchive | /security-events/:id/archive | ops.security_event.view | 27 | Verified (read-only «Архив дела» закрытого ОМ; в NAV_SECTIONS не живёт — вход ссылкой из шапки закрытой карточки) |
| protectedPersons | /protected-persons | ops.protected_person.view | 2 | Not started |
| placementWorkspace | /security-events/:id/placement | ops.placement.view | 2 | Not started |
| objects | /objects | ops.object.view | 5 | Verified |
| objectPassport (объектDetail в коде) | /objects/:id | ops.object.view | 5 | Verified |
| objectPassportVersion | /objects/:id/passports/:versionId | ops.object.view | 28 | Verified (read-only снимок опубликованной версии, deep link по мастер-промпту L5562) |
| duties | /duties | ops.duty.view | 7 | Verified |
| shiftCalendar | /calendar | ops.calendar.view | 9 | Verified (в объёме «Календарь по дням», см. FRONTEND_DECISIONS A44-A46) |
| serviceAnalytics | /analytics | ops.analytics.view | 6/7 | Verified |
| feedback | /feedback | (RequireAuth only, по образцу changelog) | 6 | Not started |
| dictionaries | /dictionaries | ops.dictionary.view | 8 | Verified |
| dictionaryDetail | /dictionaries/:code | ops.dictionary.view | 8 | Verified |

Правило: ни один route выше не добавляется в `ROUTES`/`NAV_SECTIONS` раньше, чем появится реальная страница за ним (запрет §35 «нет пустых routes»).

## NEXT ACTION
Следующие маршруты Этапа 2: recon/demand/forces/placement/approval — как вложенные представления `securityEventDetail` (stage tracker уже готов принять контент следующей стадии) либо отдельные под-роуты, решить при реализации.

`/duties/:id` (§21.32, Этап 33) — карточка дежурства, ВНУТРИ AppLayout, за
`ops.duty.view` (то же право, что план: карточка разворачивает строку плана, а не
открывает что-то сверх неё). В `NAV_SECTIONS` не живёт — это детальная страница, вход
только ссылкой с даты в строке плана дежурств. Действия смены внутри карточки гардятся
`ops.duty.manage` отдельно от чтения. Фабрика пути — `ROUTES.dutyShiftDetailTo(id)`
(литеральный путь вне `shared/routes.ts` красный по ARCH-FE-012).

## `/service-reports/history` — История отчётов (§22.25, Этап 41)

Сиблинг `/service-reports` за тем же правом `ops.report.generate`, но маршрут
проверяет его ЗАНОВО: §22.27 прямо запрещает считать доступ разрешённым
потому, что человек пришёл по ссылке с разрешённого экрана. В `NAV_SECTIONS`
не живёт — вход ссылкой «История отчётов →» с экрана запуска (раздел один,
второй пункт навигации дробил бы его). Фильтры состояния и «только мои»
живут в query-строке (`?state=&mine=`) и переживают перезагрузку.
