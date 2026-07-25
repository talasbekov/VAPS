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
| Обновление паспорта объекта до ОМ | objectPassport | features/objects | publishPassportVersion | — | Not started |

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
| Печатная форма расстановки | placementWorkspace | features/placement (print-forms canon) | — | — | Not started |

## Домен: Проведение / Закрытие / Архив (Epic 17–18, Этап 3)

| Экран/действие | Route | Feature | Mock op | Тест | Статус |
|---|---|---|---|---|---|
| Журнал штаба (инструктаж/указания/инциденты/замены — append-only, тип+заголовок+описание) | securityEventDetail (stage=CONDUCT) | features/security-events (`ConductJournal`) | useAddJournalEntry | e2e-mock/security-event-approval-to-closure.spec.ts | Verified (была ошибочно помечена Not started — матрица сверена с кодом заново) |
| Инциденты с фото | securityEventDetail | features/security-events | — | — | Not started (требует blob-хранилища, тот же вывод, что «Рекогносцировка: материалы» выше) |
| Каскадная замена выбывшего | securityEventDetail | features/security-events | — | — | Not started |
| Закрытие (итоги направлений обязательны) | securityEventDetail (stage=CONDUCT→CLOSED) | features/security-events (`ClosureTrigger`) | useCloseSecurityEvent | e2e-mock/security-event-approval-to-closure.spec.ts | Verified (была ошибочно помечена Not started — матрица сверена с кодом заново) |
| Опрос по факту (ServiceHours) | securityEventDetail | features/security-events | — | — | Not started |
| Архив ОМ (отдельный список закрытых) | — | features/security-events | — | — | Not started (см. строку ниже, дубль) |

## Домен: Личный состав (Этап 4)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Список сотрудников (поиск+фильтр) | employees | features/personnel | Verified (ручная браузерная проверка + e2e-mock/personnel-registry.spec.ts) |
| Карточка сотрудника (кадровая принадлежность) | employeeDetail | features/personnel | Verified (ручная браузерная проверка + e2e-mock/personnel-registry.spec.ts) |
| Оперативный профиль (availability/nextAssignment/rating) — структура вкладок §20.15 | employeeDetail | features/personnel | Implemented (структура; данные Not started — каждая вкладка честно объясняет причину, см. FRONTEND_DECISIONS A50), покрыто e2e-mock/personnel-registry.spec.ts |
| Мой профиль | (план) | features/personnel | Not started |
| Календарь сотрудника × месяц | (план, Epic 19.4) | features/calendar | Not started |

## Домен: Объекты и служба (§21, Этап 5)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Реестр объектов (поиск) | objects | features/objects | Verified (ручная браузерная проверка + e2e-mock/objects-passport.spec.ts) |
| Паспорт объекта (секторы+посты, редактирование) | objectDetail | features/objects | Verified (ручная браузерная проверка + e2e-mock/objects-passport.spec.ts, persist-through-reload) |
| KPI реестра объектов (§21.7) | objects | features/objects | Not started (см. FRONTEND_DECISIONS A30) |
| Схемы/документы/чек-листы объекта | objectDetail | features/objects | Not started |
| План дежурств на месяц | duties | features/duties | Not started (см. FRONTEND_DECISIONS A31) |
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
| Обратная связь | feedback | features/feedback | Not started |
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
| Архив ОМ (отдельный список закрытых) | — | — | Not started |

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
Итог: **25 из ~70 экранов Verified** (12 — жизненный цикл ОМ, 2 — сотрудники, 2 — объекты/паспорт, 1 — аудит, 1 — аналитика службы, 2 — план дежурств [индивидуальные дежурства + боевые группы на Трассе], 4 — справочники, 1 — календарь по дням). Остальные ~45 экранов (notifications/feedback/мой профиль/KPI/схемы/нагрузка/рейтинг/должности-звания как отдельный справочник/остальные режимы календаря/полный §24 боевых групп) — Not started. Ложным «Done» не помечать (запрет §35).

## NEXT ACTION
`e2e-mock/` покрывает ВСЕ реализованные экраны (Этапы 11-13, расширены Этапом 14 — оперативный профиль, Этапом 15 — боевые группы на Трассе, Этапом 16 — execution-lifecycle, Этапом 17 — замены §24.21, Этапом 18 — потребность §24.1, 16 спек) — весь жизненный цикл ОМ, personnel, objects, dictionaries, calendar, audit, analytics, duties (включая боевые группы: потребность→подача→рассмотрение→ознакомление→заступление→факт→замена, весь §24-конвейер теперь достижим целиком из UI). Дальше — только функциональный объём: уведомления/передача смены §24.22 (требует обсуждения модели ротации смен внутри дня, см. FRONTEND_PROGRESS Этап 18 NEXT ACTION)/Conflict Repository/формальный revision/accessibility-tablet-Firefox (не реализованы, а не «не покрыты тестами»), по решению пользователя.
