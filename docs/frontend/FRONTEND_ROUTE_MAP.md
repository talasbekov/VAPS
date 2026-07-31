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

## `/service-reports/:reportJobId` — Карточка работы отчёта (§22.27, Этап 42)

Deep link на одну работу; промпт называет его `/reports/:reportJobId`, здесь он живёт под
`/service-reports` по той же причине, что и весь раздел (донорский `/reports` — «Расход
дня», E10). Право то же (`ops.report.generate`) и проверяется ЗАНОВО — и маршрутом, и
repository: §22.27 запрещает считать доступ разрешённым потому, что человек пришёл из
реестра. Работа, которой смотрящий видеть не должен, отвечает 404, а не 403.

⚠️ Динамический сегмент соседствует со СТАТИЧЕСКИМ `/service-reports/history`. React Router
ранжирует статику выше, поэтому история не читается как «работа с идентификатором
history» — но это свойство роутера, а не наше решение, и оно закреплено отдельным тестом.

`/reports/artifacts/:artifactId` из §22.27 СОЗНАТЕЛЬНО не заведён: у работы ровно один
артефакт, все его метаданные показаны в карточке, а постоянной ссылки на сам файл не
существует вовсе (§22.23). Причина названа на экране блоком §35, а не умолчана.
Фабрика пути — `ROUTES.serviceReportJobTo(id)`.

## `/analytics` — Аналитика службы (§22.3-22.12, переписан в Этапе 43)

Экран переехал из `app/ServiceAnalyticsPage.tsx` в `features/service-analytics`. Прежняя
редакция жила в `app/` законно — она композировала данные ТРЁХ фич (ARCH-FE-013 не даёт
features→features) и считала распределения в браузере, честно подписывая их «по видимым
записям». Подпись была правдой, но §22.3 запрещает сам приём: «итог по видимой части
таблицы» стоит там в одном списке с численностью и просрочкой. Теперь экран читает ОДИН
серверный снимок, композировать нечего — и место ему в feature.

Фильтр периода живёт в URL (`?period=` либо `?period=CUSTOM&from=&to=`). Scope в фильтрах
НЕ появляется вовсе — §22.26 требует, чтобы недоступный scope не показывался даже в списке,
а RBAC demo-режима плоский. Право маршрута — `ops.analytics.view`; раскрытие показателя и
персональная детализация гардятся отдельными правами в repository.

## `/feedback` — обратная связь (§28, Этап 47)

Один маршрут на весь раздел: реестр обращений и форма нового обращения живут на одном
экране. Карточка обращения (§28 detail — публичный ответ, внутренняя заметка, ответственный,
дубликат, timeline) отдельным маршрутом ЕЩЁ НЕ заведена: без разбора у неё не было бы
содержания, а пустая карточка читалась бы как «обращение никто не смотрел».

Право маршрута — `ops.feedback.view`, и repository проверяет его ЗАНОВО. Видимость чужих
обращений (`ops.feedback.view_all`) и их закрытого содержания
(`ops.feedback.view_confidential`) — отдельные права, гардятся только в repository:
фильтровать уже полученный массив на экране значило бы сначала привезти закрытое в браузер.

Фильтры, поиск и страница в URL НЕ живут — состояние отбора локальное. Это осознанно:
поисковая строка обращения может содержать формулировку из закрытого текста, и класть её в
адрес (а оттуда в историю браузера и в реферер) значило бы вынести наружу ровно то, что
раздел закрывает.

## `/feedback/:feedbackId` — карточка обращения (§28 detail, Этап 48)

Право маршрута то же, что у реестра (`ops.feedback.view`), и проверяется ЗАНОВО: переход из
реестра доступ к конкретному обращению не подтверждает. Видимость самого обращения решает
repository — невидимое отвечает «не найдено», а не «нет прав».

Вход — ссылка на теме обращения в реестре. Прямая ссылка работает и без реестра: карточка
сама грузит всё, что ей нужно, одним ответом (состояние, переписка, лента, действия,
допустимые статусы) — двумя запросами она показала бы статус из одного ответа и ленту из
другого.

## `/settings` — Настройки (§29, Этап 49)

Право входа — `ops.settings.view`; ПРАВО ИЗМЕНЕНИЯ (`ops.settings.manage`) маршрут не
проверяет: его решает сервер (`canManage` в ответе списка и повторная проверка на PATCH).
Маршрут гардит вход в раздел, а не операцию — операция гардится там, где выполняется.

Отдельный маршрут от `/audit` намеренно: §29 требует разделить read-only operational audit и
role-restricted administration. Вход — пункт «Настройки» в сайдбаре (право фильтрует пункт).

## `/ratings/workspace` — Оценивание участников (§19.7-19.14, Этап 57)

Право входа — `ops.rating.evaluate`, СВОЁ и отдельное от права сводки: держатель
`ops.rating.view_aggregate` сюда не попадает, а оценщик не попадает на `/ratings`.
Мероприятие приходит параметром `?event=`, а не сегментом: очередь принадлежит оценщику,
мероприятие лишь сужает её, и человек с заданиями в двух мероприятиях иначе не имел бы
входа «показать мои задания» вовсе.

Вкладок две или три: «Мне нужно оценить» и «Отправленные мной» — всегда, «Сводка
мероприятия» — только когда сервер прислал `eventProgress`, то есть при наличии
`ops.rating.view_aggregate` (§19.14). Скрытой вкладки нет — нет данных.

Соседство со СТАТИЧЕСКИМ `/ratings/analytics` безопасно: оба сегмента статические, и
динамического маршрута под `/ratings` нет.

## `/ratings/evaluations` и `/ratings/employees/:employeeId` (§19.15-19.17, Этап 59)

Право входа обоих — `ops.rating.view_aggregate`. Реестр хранит весь отбор в search params
(§19.15), ссылка в карточку несёт его параметром `back`, а «Вернуться к отбору» ведёт на
него же: восстановление не зависит от истории браузера и работает по прямой ссылке.

Динамический сегмент `/ratings/employees/:employeeId` соседствует со статическими
`/ratings/analytics`, `/ratings/workspace` и `/ratings/evaluations`; React Router ранжирует
статический сегмент выше, поэтому перехвата нет.

