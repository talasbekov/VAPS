# FRONTEND_TRACEABILITY_MATRIX

Требование/экран/действие → route → feature → mock operation → тест → статус. Статусы: `Not started | In progress | Implemented | Verified | Blocked`.

Источник инвентаря экранов: прототип (`Smart Josparlau.dc.html`, `Дежурства.dc.html`, `КалендарьСмен.dc.html`, `Объекты.dc.html`, `uploads/step2..step11_*.html`) + Epics 14–20 (`_bmad-output/planning-artifacts/epics.md`).

## Домен: Командный центр / реестр ОМ (Epic 15, Этап 2)

| Экран/действие (прототип) | Route (план) | Feature | Mock op | Тест | Статус |
|---|---|---|---|---|---|
| Дашборд командного центра (ТОЛЬКО блок «Готовность ОМ» — карточки численности/подразделений/нагрузки НЕ рисуются, нет read model, см. FRONTEND_DECISIONS A12) | commandCenter | features/security-events (CommandCenterPage) | listSecurityEvents | — | Implemented |
| Реестр ОМ (список, поиск, фильтр по этапу, пагинация) | securityEvents | features/security-events (SecurityEventsListPage) | listSecurityEvents | mocks/repository.test.ts | Verified |
| Создание ОМ (форма: название/объект/дата) → редирект на бюллетень | securityEvents (модал CreateSecurityEventDialog) | features/security-events | createSecurityEvent | mocks/repository.test.ts + ручная браузерная проверка | Verified |
| Бюллетень: краткое описание + первичные задачи (реальная форма, сохранение, персистентность) | securityEventDetail | features/security-events (SecurityEventDetailPage) | updateBulletin | mocks/repository.test.ts + ручная проверка (survives reload) | Verified |
| Stage-tracker (6 стадий) на карточке ОМ — визуальный, будущие стадии задизейблены (не dead-кнопки) | securityEventDetail | features/security-events | — | — | Implemented (только визуал, переходы между стадиями не реализованы) |
| Рекогносцировка: чек-лист (6 пунктов, комментарий обязателен при «Требует изменений») | securityEventDetail (stage=RECON) | features/security-events | updateRecon | mocks/repository.test.ts + e2e-mock/security-event-recon-to-placement.spec.ts | Verified |
| Рекогносцировка: посты и секторы (add/edit/delete строк, сохранение расчёта) | securityEventDetail (stage=RECON) | features/security-events | updateRecon | mocks/repository.test.ts + ручная проверка | Verified |
| Рекогносцировка: завершение этапа (валидация чек-лист+посты, переход RECON→DEMAND) | securityEventDetail (stage=RECON) | features/security-events | completeRecon | mocks/repository.test.ts + e2e-mock/security-event-recon-to-placement.spec.ts | Verified |
| Рекогносцировка: материалы (фото/файлы) | securityEventDetail (stage=RECON) | features/security-events | — | — | Not started (требует blob-хранилища, см. FRONTEND_DECISIONS) |
| Потребность: строки расчёта (сектор/пост/смена/группа), сохранение+утверждение одной операцией | securityEventDetail (stage=DEMAND) | features/security-events | approveDemand | mocks/repository.test.ts + e2e-mock/security-event-recon-to-placement.spec.ts | Verified |
| Выделение сил: авто-агрегация запросов по группам, ручное выделение (allocatedCount), статус NOT_SENT→PARTIALLY→ALLOCATED | securityEventDetail (stage=FORCES) | features/security-events | updateForceAllocation, completeForces | mocks/repository.test.ts + e2e-mock/security-event-recon-to-placement.spec.ts | Verified |
| Расстановка: назначение/снятие сотрудников на посты, hard-правило двойного назначения внутри ОМ, укомплектованность постов | securityEventDetail (stage=PLACEMENT) | features/security-events | assignPlacement, unassignPlacement, completePlacement | mocks/repository.test.ts + e2e-mock/security-event-placement.spec.ts | Verified (упрощённое правило «≥1 назначение», не точный need — FRONTEND_DECISIONS) |
| Согласование: утверждение / возврат на доработку с причиной (откат на PLACEMENT) | securityEventDetail (stage=APPROVAL) | features/security-events | approvePlacement, returnPlacement | mocks/repository.test.ts + ручная проверка | Verified |
| Полный цикл ОМ (все 6 стадий: Бюллетень→Рекогносцировка→Потребность→Запрос сил→Расстановка→Согласование) кликабелен от создания до утверждения | securityEvents → securityEventDetail | features/security-events | (весь набор выше) | ручная браузерная проверка полного цикла, 2026-07-24 | Verified end-to-end |
| Публикация версии паспорта объекта (неизменяемый снимок + deep link) | objectPassport, objectPassportVersion | features/objects | publishPassportVersion | mocks/repository.test.ts, pages/ObjectPassportVersionPage.test.tsx, e2e-mock/objects-passport.spec.ts | Verified |
| Привязка ОМ к объекту и опубликованной версии паспорта (§9.6): выбор объекта при создании, снимок версии на бизнес-дату, явные «нет версии»/«нет объекта», предупреждение об устаревшей версии | securityEvents (диалог), securityEventDetail | features/security-events | createSecurityEvent (objectId), getPassportView | lib/passportBinding.test.ts, mocks/repository.test.ts, app/mocks/compose-seed.test.ts, e2e-mock/security-event-passport-binding.spec.ts | Verified |
| Привязка ДЕЖУРСТВА к опубликованной версии паспорта (§9.6): снимок objectId/passportVersionId/sectorId/postId, три явные причины отсутствия привязки, предупреждение об устаревшей версии | duties (План дежурств) | features/duties | listShifts (`passportStatuses`) | lib/passportBinding.test.ts, mocks/repository.test.ts, pages/DutyPlanPage.test.tsx, app/mocks/compose-seed.test.ts, e2e-mock/duty-passport-binding.spec.ts | Verified |
| Импорт постов из привязанной версии паспорта в расчёт рекогносцировки (`sourceSectorId`/`sourcePostId` → цепочка §9.6 до расстановки) | securityEventDetail (stage=RECON) | features/security-events | importReconPostsFromPassport | mocks/repository.test.ts, e2e-mock/security-event-passport-binding.spec.ts | Verified |

## Домен: Потребность и брокеридж (Epic 15)

| Экран/действие | Route | Feature | Mock op | Тест | Статус |
|---|---|---|---|---|---|
| Расчёт и утверждение потребности (StaffingDemand) | securityEventDetail | features/security-events | approveStaffingDemand | — | Not started |
| Запросы группам (справочник + рассылка) | securityEventDetail | features/force-requests | createForceRequest | — | Not started |
| Выделение людей брокером | securityEventDetail | features/force-requests | allocatePersonnel | — | Not started |
| Физнаряд (прямое назначение ОМД) | securityEventDetail | features/force-requests | assignDirectly | — | Not started |
| Эскалация неотработанного запроса | securityEventDetail | features/force-requests | escalateRequest | — | Not started |

## Домен: Расстановка (Epic 16)

| Экран/действие | Route | Feature | Mock op | Тест | Статус |
|---|---|---|---|---|---|
| Черновик расстановки (авто) | placementWorkspace | features/placement | draftPlacement | — | Not started |
| Конфликт-детектор (двойное назначение/отдых/перегрузка/пост) | placementWorkspace | features/placement | validatePlacement | — | Not started |
| Согласование/утверждение (return / approve) | placementWorkspace | features/placement | submitForApproval / approvePlacement / returnPlacement | — | Not started |
| Ознакомление + уведомление | placementWorkspace | features/placement | acknowledgePlacement | — | Not started |
| Печатная форма расстановки | /print/placement | features/print-forms | GET /api/ops/security-events/:id/ | placementPrint.test.ts, PlacementPrintPage.test.tsx, print-placement-routing.test.tsx, e2e-mock/placement-print.spec.ts | Verified (demo-предпросмотр §9.15 с печатаемым маркером demo; официальный .docx — за бэком, см. FRONTEND_DECISIONS A57) |

## Домен: Проведение / Закрытие / Архив (Epic 17–18, Этап 3)

| Экран/действие | Route | Feature | Mock op | Тест | Статус |
|---|---|---|---|---|---|
| Журнал штаба (инструктаж/указания/инциденты/замены — append-only, тип+заголовок+описание) | securityEventDetail (stage=CONDUCT) | features/security-events (`ConductJournal`) | useAddJournalEntry | e2e-mock/security-event-approval-to-closure.spec.ts | Verified (была ошибочно помечена Not started — матрица сверена с кодом заново) |
| Инциденты с фото | securityEventDetail | features/security-events | — | — | Not started (требует blob-хранилища, тот же вывод, что «Рекогносцировка: материалы» выше) |
| Каскадная замена выбывшего (§9.11, ручная) | securityEventDetail (stage=CONDUCT) | features/security-events | replaceAssignment | e2e-mock/security-event-approval-to-closure.spec.ts | Verified (автоподбор кандидата — business-policy-pending, см. A56) |
| Закрытие (итоги направлений обязательны) | securityEventDetail (stage=CONDUCT→CLOSED) | features/security-events (`ClosureTrigger`) | useCloseSecurityEvent | e2e-mock/security-event-approval-to-closure.spec.ts | Verified (была ошибочно помечена Not started — матрица сверена с кодом заново) |
| Опрос по факту (ServiceHours) | securityEventDetail | features/security-events | — | — | Not started |
| Архив дела закрытого ОМ (read-only) | securityEventArchive | features/security-events (`SecurityEventArchivePage` + `lib/archiveCase.ts`) | — (read model поверх `useSecurityEvent`) | lib/archiveCase.test.ts, pages/SecurityEventArchivePage.test.tsx, e2e-mock/security-event-approval-to-closure.spec.ts | Verified |

## Домен: Личный состав (Этап 4)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Список сотрудников (поиск+фильтр) | employees | features/personnel | Verified (ручная браузерная проверка + e2e-mock/personnel-registry.spec.ts) |
| Карточка сотрудника (кадровая принадлежность) | employeeDetail | features/personnel | Verified (ручная браузерная проверка + e2e-mock/personnel-registry.spec.ts) |
| Идентификационные данные: маска по умолчанию, раскрытие с целью/сроком/аудитом, журнал обращений (§20.27/§20.28/§20.33) | employeeDetail | features/personnel | discloseIdentity / listDisclosures | lib/identity.test.ts, mocks/repository.test.ts, pages/IdentitySection.test.tsx, e2e-mock/personnel-identity.spec.ts | Verified (A71; organization scope — не реализован и назван на экране) |
| Оперативный профиль (availability/nextAssignment/rating) — структура вкладок §20.15 | employeeDetail | features/personnel | Implemented (структура; данные Not started — каждая вкладка честно объясняет причину, см. FRONTEND_DECISIONS A50), покрыто e2e-mock/personnel-registry.spec.ts |
| Мой профиль | (план) | features/personnel | Not started |
| Отчётный реестр службы: запуск отчёта, состояния работы, метаданные артефакта, выгрузка с маскированием (§22.18-22.25, §20.32) | serviceReports | features/service-reports | createReportJob / listReportJobs / downloadArtifact | lib/reporting.test.ts, mocks/repository.test.ts, pages/ServiceReportsPage.test.tsx, e2e-mock/service-reports.spec.ts | Verified (A72; XLSX/PDF/DOCX — названы недоступными с причиной, §22.23) |
| История отчётов: фильтры, редакции серии, повтор с теми же параметрами и новая revision, видимость только разрешённых работ (§22.25, §22.27) | serviceReports | features/service-reports | listReportJobs(filters) / rerunReportJob | lib/reporting.test.ts, mocks/repository.test.ts, pages/ReportHistoryPage.test.tsx, e2e-mock/service-reports-history.spec.ts | Verified (A73; колонка scope названа недоступной с причиной, §35) |
| Карточка работы отчёта: состояние и метаданные артефакта одним срезом, действия из ответа, параметры чужого запуска вырезаны сервером (§22.26/§22.27/§22.28) | serviceReportJob | features/service-reports | getReportJob / downloadArtifact / rerunReportJob | lib/reporting.test.ts, mocks/repository.test.ts, pages/ReportJobPage.test.tsx, e2e-mock/service-report-job-card.spec.ts | Verified |
| Аналитика службы: серверный снимок §22.4, показатели §22.3/§22.7 с состоянием и версией расчёта, периоды из registry §22.5, шапка §22.6, drill-down по стабильным ID с курсором §22.12 | serviceAnalytics | features/service-analytics | getServiceAnalytics / listPresets / getDrilldown | lib/analytics.test.ts, mocks/repository.test.ts, pages/ServiceAnalyticsPage.test.tsx, e2e-mock/analytics.spec.ts | Verified |
| Блок «Требует внимания» §22.11: собственные серверные детекторы со своей политикой, словарь разрешённых формулировок, переход по `targetPermission` §22.27 | serviceAnalytics | features/service-analytics | getAttention | lib/attention.test.ts, mocks/repository.test.ts, pages/ServiceAnalyticsPage.test.tsx, e2e-mock/analytics.spec.ts | Verified |
| Аналитика ОМ §22.13/§22.15: распределение по Lifecycle Registry, иерархия «Все ОМ → объект → ОМ → направление → пост → участие» по стабильным ID, breadcrumb, карточка ОМ; воронка §22.14 названа недоступной с причиной | serviceAnalytics + security-events (чтение) | features/service-analytics | getOperationsAnalytics | lib/operations.test.ts, mocks/repository.test.ts, pages/OperationsAnalyticsPage.test.tsx, e2e-mock/operations-analytics.spec.ts | Verified |
| Журнал переходов ОМ (append-only, пишется диффом на записи слайса) + воронка §22.14: шесть показателей раздельно, один за раз через явный переключатель | security-events (`transitions`) | features/security-events + features/service-analytics | commitEvents / buildFunnel | security-events/mocks/repository.test.ts, service-analytics/lib/operations.test.ts, service-analytics/mocks/repository.test.ts, e2e-mock/operations-analytics.spec.ts | Verified |
| Календарь сотрудника × месяц | (план, Epic 19.4) | features/calendar | Not started |

## Домен: Объекты и служба (§21, Этап 5)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Реестр объектов (поиск) | objects | features/objects | Verified (ручная браузерная проверка + e2e-mock/objects-passport.spec.ts) |
| Паспорт объекта (секторы+посты, редактирование) | objectDetail | features/objects | Verified (ручная браузерная проверка + e2e-mock/objects-passport.spec.ts, persist-through-reload) |
| KPI реестра объектов (§21.7): серверные агрегаты, срок актуальности от policy, клик по KPI → фильтр в URL | objects | features/objects | list (`kpi`/`freshness`/`freshnessPolicy`) | lib/passportFreshness.test.ts, pages/ObjectsListPage.test.tsx, e2e-mock/objects-kpi.spec.ts | Verified (2 KPI прототипа модель не даёт — приходят с причиной; A30 отменено решением A69) |
| Схемы/документы/чек-листы объекта | objectDetail | features/objects | Not started |
| План дежурств на месяц (сетка «объект × день», серверные KPI §21.29, конфликты §21.34) | duties (вкладка «Месяц») | features/duties | getMonthlyPlan | e2e-mock/duty-monthly-plan.spec.ts | Verified |
| Lifecycle месячного плана и шапка с action policy (§21.27-21.28): черновик → проверка → утверждение → новая редакция, замок утверждённого месяца | duties (вкладка «Месяц», шапка) | features/duties | createPlanDraft / checkPlanConflicts / approvePlan / reopenPlan | e2e-mock/duty-plan-lifecycle.spec.ts | Verified (A70; «Экспортировать» — назван недоступным с причиной, не реализован) |
| Матрица доступности «сотрудник × день» (§21.30): дежурство, обязательный отдых, конфликт, неполные данные | duties (вкладка «Месяц» → «Сотрудники × дни») | features/duties | getMonthlyPlan (`employeeRows`) | lib/monthlyPlan.test.ts, pages/MonthlyDutyPlanSection.test.tsx, e2e-mock/duty-employee-matrix.spec.ts | Verified в честном подмножестве (4 слоя из 6; занятость ОМ и кадровая недоступность приходят с причиной, см. A67) |
| Список дежурств и История (§21.30): 7 выводимых колонок, 4 названы с причиной; история = завершённый факт И прошедшая дата | duties (вкладка «Список») | features/duties | listShiftList | mocks/repository.test.ts, e2e-mock/duty-shift-list.spec.ts | Verified (см. A68) |
| Создание индивидуального дежурства (§21.31): объект/действующая версия паспорта/вид/дата/пост/сотрудник/примечание, server policy по красному паспорту | duties (вкладки «По объектам»/«По сотрудникам») | features/duties | createDutyShift, listDutyPlanObjects | mocks/repository.test.ts, pages/CreateDutyShiftForm.test.tsx, e2e-mock/duty-shift-create.spec.ts | Verified (время/продолжительность/требуемая численность отдельными полями — сознательно нет, см. A64) |
| Подбор кандидатов на дежурство (§21.33) | duties (форма нового дежурства) | features/duties | listDutyCandidates | mocks/repository.test.ts, pages/CreateDutyShiftForm.test.tsx, e2e-mock/duty-shift-create.spec.ts | Verified в честном подмножестве (выводим только фактор «уже запланированные дежурства»; доступность/допуски/нагрузка/рейтинг приходят блоком `unavailableAttributes` с причиной, §35 — см. A64) |
| Конфликты при планировании (§21.34): hard → 422, soft → 409 с обходом по обоснованию и отдельному permission | duties (форма нового дежурства) | features/duties | createDutyShift (detectConflicts) | mocks/repository.test.ts, pages/CreateDutyShiftForm.test.tsx, e2e-mock/duty-shift-create.spec.ts | Verified (обход — канонический протокол `DUTY_CONFLICT_DETECTED` + общий shared/ui/ConflictDialog, см. A64) |
| Карточка дежурства (§21.32): шапка, пост из зафиксированной версии паспорта, конфликты с серверной severity, ознакомление, фактическое участие, действия смены | dutyShiftDetail (`/duties/:id`) | features/duties | getShiftDetail | mocks/repository.test.ts, pages/DutyShiftDetailPage.test.tsx, e2e-mock/duty-shift-card.spec.ts | Verified (6 из 11 блоков §21.32 модель не даёт — приходят списком с причиной, см. A65) |
| Правка заведённой смены (сотрудник/пост/примечание) и отмена с причиной; отменённая выбывает из конфликтов и KPI, оставаясь в плане | dutyShiftDetail (`/duties/:id`) | features/duties | updateDutyShift, cancelDutyShift | mocks/repository.test.ts, pages/DutyShiftDetailPage.test.tsx, e2e-mock/duty-shift-edit.spec.ts | Verified (дата и вид дежурства неизменяемы — перенос делается отменой + созданием, см. A66) |
| Единый календарь (сотрудник/подразделение) | shiftCalendar | features/calendar | Not started |

## Домен: Контроль и аналитика (§22/§27-30, Этап 6)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Журнал аудита (read-only) | audit | features/audit | Verified (ручная браузерная проверка + e2e-mock/audit.spec.ts) |
| Аналитика службы: ОМ по этапам + объекты по паспорту + дежурства по состоянию + боевые группы по состоянию (честные агрегаты по видимым записям) | serviceAnalytics | app/ServiceAnalyticsPage.tsx | Verified (ручная браузерная проверка + e2e-mock/analytics.spec.ts) |
| Дашборд нагрузки/перегрузки личного состава | serviceAnalytics | — | Not started (нет read model) |
| Экспорт с маскированием | serviceAnalytics | — | Not started |

## Домен: План дежурств (§21/§24, по запросу «Duties»)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| План дежурств: По объектам / По сотрудникам (общий datasource) | duties | features/duties | Verified (ручная браузерная проверка + e2e-mock/duties.spec.ts) |
| Ознакомление → Заступление → Завершение (переходы смены) | duties | features/duties | Verified (ручная браузерная проверка + e2e-mock/duties.spec.ts) |
| Боевые группы на Трассе: подача состава → рассмотрение (принять/вернуть с причиной) — сокращённое подмножество §24.1 | duties (вкладка «Боевые группы и Трассы») | features/duties | Verified (ручная браузерная проверка + mocks/repository.test.ts + e2e-mock/combat-duty-groups.spec.ts, см. FRONTEND_DECISIONS A51) |
| Боевые группы: ознакомление по каждому члену → заступление → факт (§24.19-24.23) | duties (вкладка «Боевые группы и Трассы») | features/duties | Verified (ручная браузерная проверка + mocks/repository.test.ts + e2e-mock/combat-duty-execution.spec.ts, см. FRONTEND_DECISIONS A52) |
| Боевые группы: замена участника до заступления (§24.21) | duties (вкладка «Боевые группы и Трассы») | features/duties | Verified (ручная браузерная проверка + mocks/repository.test.ts + e2e-mock/combat-duty-replacement.spec.ts, см. FRONTEND_DECISIONS A53) |
| Боевые группы: формирование потребности на смену (§24.1) | duties (вкладка «Боевые группы и Трассы») | features/duties | Verified (ручная браузерная проверка + mocks/repository.test.ts + e2e-mock/combat-duty-requirement.spec.ts, см. FRONTEND_DECISIONS A54) |
| Боевые группы: сдача смены — checkpoint (§24.22, сокращённо, без принимающего экипажа) | duties (вкладка «Боевые группы и Трассы») | features/duties | Verified (см. FRONTEND_DECISIONS A55) |
| Боевые группы: принимающий экипаж/ротация (§24.22 полностью), Conflict Repository (§24.17 за пределами DOUBLE_ASSIGNMENT), формальный revision, requiredGroups/requiredPosts | — | — | Not started (см. A51-A55) |
| Месячное планирование, история/revisions | — | — | Not started |
| Уведомления (полноценный экран) | notifications | features/notifications | Not started |
| Обратная связь: реестр обращений (stats/search/type/status/module/pagination) | feedback | features/feedback | listFeedback | e2e-mock/feedback.spec.ts | Verified |
| Обратная связь: создание обращения и черновик (§28 create) | feedback | features/feedback | createFeedback / submitFeedback | e2e-mock/feedback.spec.ts | Verified |
| Обратная связь: карточка обращения (§28 detail — публичный ответ, внутренняя заметка, ответственный, дубликат, timeline) | feedbackDetail | features/feedback | — | — | Not started (нет разбора: пустая карточка читалась бы как «обращение никто не смотрел»; §35-блок называет причину на экране) |
| Справочники / настройки | dictionaries | features/dictionaries | Not started |

## Домен: Полный жизненный цикл ОМ (Этап 2+3 — bulletin→recon→demand→forces→placement→approval→acknowledgement→conduct→closed)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Бюллетень | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Рекогносцировка | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Потребность (утверждение) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Запрос сил (выделение) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Расстановка (назначение/снятие) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Согласование (утвердить/вернуть) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Ознакомление (подтверждение назначения) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Проведение (журнал штаба) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Закрытие (итоги по направлениям) | securityEventDetail | features/security-events | Verified (unit + ручная проверка) |
| Опрос по факту, оценки участников | — | — | Not started (Epic 18.3, сознательный scope cut, см. FRONTEND_DECISIONS A24) |
| Архив ОМ отдельным СПИСКОМ закрытых | — | — | Not started (дело каждого закрытого ОМ реализовано, см. securityEventArchive; отдельный список закрытых как раздел — нет, фильтр «Этап: Закрыто» в реестре его заменяет) |

## Домен: Справочники (§30, по запросу «Справочники/настройки»)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Реестр справочников (карточки со счётчиком active/total) | dictionaries | features/dictionaries | Verified (ручная браузерная проверка) |
| Значения справочника (таблица, добавление, деактивация) | dictionaryDetail | features/dictionaries | Verified (ручная браузерная проверка + unit-тесты repository + e2e-mock/dictionaries.spec.ts) |
| Блокировка деактивации используемого значения (409, причина дословно) | dictionaryDetail | features/dictionaries | Verified (ручная проверка + unit-тест + e2e-mock/dictionaries.spec.ts) |
| Типы записей журнала (JOURNAL_ENTRY_TYPES, §30 «типы статусов») | dictionaryDetail | features/dictionaries | Verified (ручная браузерная проверка + unit-тесты repository) |
| Группы требований постов (POST_REQUIREMENT_GROUPS, §30 «группы») + колонка «Группа»/select в POST_REQUIREMENTS | dictionaryDetail | features/dictionaries | Verified (ручная браузерная проверка + unit-тесты repository) |
| Должности/звания (§30 остальные 2 пункта) | — | — | Not started (уже реальные donor-справочники через personnel, см. A40) |

## Домен: Календарь смен (§25 мастер-промпта, урезанный «Календарь по дням»)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Календарь по дням (список дежурств+расстановок ОМ+боевых групп за день, навигация по дате) | calendar | app/CalendarPage.tsx | Verified (ручная браузерная проверка + e2e-mock/calendar.spec.ts) |
| «Мой календарь», представление по сотруднику/подразделению, боевые группы, конфликты, отдых, нагрузка, статусы (отпуск/больничный/командировка) | — | — | Not started — требует Employee Status/Conflict/Workload repositories и общий employeeId между дежурствами/ОМ, которых в demo-срезе нет (см. FRONTEND_DECISIONS A44-A46) |

## Покрытие
Итог: **48 из ~70 экранов Verified** (12 — жизненный цикл ОМ, 2 — сотрудники, 2 — объекты/паспорт, 1 — аудит, 1 — аналитика службы, 2 — план дежурств [индивидуальные дежурства + боевые группы на Трассе], 4 — справочники, 1 — календарь по дням, 1 — печатная форма расстановки, 1 — архив дела закрытого ОМ, 1 — версия паспорта объекта, 2 — привязка ОМ к версии паспорта и импорт постов §9.6, 1 — привязка дежурства к версии паспорта §9.6, 1 — месячный план дежурств §21.27-21.30, 1 — создание индивидуального дежурства с подбором кандидатов и конфликтами §21.31/§21.33/§21.34, 1 — карточка дежурства §21.32, 1 — правка и отмена смены §21.31, 1 — матрица доступности по сотрудникам §21.30, 1 — список дежурств и история §21.30, 1 — KPI реестра объектов §21.7, 1 — lifecycle месячного плана §21.27-21.28, 1 — раскрытие sensitive identity §20.27/§20.33, 1 — отчётный реестр службы §22.18-22.25, 1 — история отчётов §22.25, 1 — карточка работы отчёта §22.26-22.28, 1 — снимок аналитики службы §22.3-22.12, 1 — блок «Требует внимания» §22.11, 1 — аналитика ОМ §22.13/§22.15, 1 — воронка §22.14 и журнал переходов, 2 — обратная связь §28: реестр и создание). Остальные ~39 экранов (notifications/feedback/мой профиль/KPI/схемы/нагрузка/рейтинг/должности-звания как отдельный справочник/остальные режимы календаря/полный §24 боевых групп) — Not started. Ложным «Done» не помечать (запрет §35).

## NEXT ACTION
`e2e-mock/` покрывает ВСЕ реализованные экраны (Этапы 11-13, расширены Этапом 14 — оперативный профиль, Этапом 15 — боевые группы на Трассе, Этапом 16 — execution-lifecycle, Этапом 17 — замены §24.21, Этапом 18 — потребность §24.1, 16 спек) — весь жизненный цикл ОМ, personnel, objects, dictionaries, calendar, audit, analytics, duties (включая боевые группы: потребность→подача→рассмотрение→ознакомление→заступление→факт→замена, весь §24-конвейер теперь достижим целиком из UI). Дальше — только функциональный объём: уведомления/передача смены §24.22 (требует обсуждения модели ротации смен внутри дня, см. FRONTEND_PROGRESS Этап 18 NEXT ACTION)/Conflict Repository/формальный revision/accessibility-tablet-Firefox (не реализованы, а не «не покрыты тестами»), по решению пользователя.
