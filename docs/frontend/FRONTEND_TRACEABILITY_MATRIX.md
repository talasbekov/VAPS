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
| Рекогносцировка: чек-лист (6 пунктов, комментарий обязателен при «Требует изменений») | securityEventDetail (stage=RECON) | features/security-events | updateRecon | mocks/repository.test.ts + ручная проверка | Verified |
| Рекогносцировка: посты и секторы (add/edit/delete строк, сохранение расчёта) | securityEventDetail (stage=RECON) | features/security-events | updateRecon | mocks/repository.test.ts + ручная проверка | Verified |
| Рекогносцировка: завершение этапа (валидация чек-лист+посты, переход RECON→DEMAND) | securityEventDetail (stage=RECON) | features/security-events | completeRecon | mocks/repository.test.ts + ручная проверка (переход подтверждён в браузере) | Verified |
| Рекогносцировка: материалы (фото/файлы) | securityEventDetail (stage=RECON) | features/security-events | — | — | Not started (требует blob-хранилища, см. FRONTEND_DECISIONS) |
| Потребность: строки расчёта (сектор/пост/смена/группа), сохранение+утверждение одной операцией | securityEventDetail (stage=DEMAND) | features/security-events | approveDemand | mocks/repository.test.ts + ручная проверка | Verified |
| Выделение сил: авто-агрегация запросов по группам, ручное выделение (allocatedCount), статус NOT_SENT→PARTIALLY→ALLOCATED | securityEventDetail (stage=FORCES) | features/security-events | updateForceAllocation, completeForces | mocks/repository.test.ts + ручная проверка | Verified |
| Расстановка: назначение/снятие сотрудников на посты, hard-правило двойного назначения внутри ОМ, укомплектованность постов | securityEventDetail (stage=PLACEMENT) | features/security-events | assignPlacement, unassignPlacement, completePlacement | mocks/repository.test.ts + ручная проверка | Verified (упрощённое правило «≥1 назначение», не точный need — FRONTEND_DECISIONS) |
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
| Журнал штаба (инструктаж/указания) | securityEventDetail | features/conduct | recordJournalEntry | — | Not started |
| Инциденты с фото | securityEventDetail | features/conduct | recordIncident | — | Not started |
| Каскадная замена выбывшего | securityEventDetail | features/conduct | replaceAssignment | — | Not started |
| Закрытие (итоги направлений обязательны) | securityEventDetail | features/conduct | closeSecurityEvent | — | Not started |
| Опрос по факту (ServiceHours) | securityEventDetail | features/conduct | recordActuals | — | Not started |
| Архив ОМ | securityEventDetail | features/conduct | archiveSecurityEvent | — | Not started |

## Домен: Личный состав (Этап 4)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Список сотрудников (поиск+фильтр) | employees | features/personnel | Verified (ручная браузерная проверка) |
| Карточка сотрудника (кадровая принадлежность) | employeeDetail | features/personnel | Verified (ручная браузерная проверка) |
| Оперативный профиль (availability/nextAssignment/rating) | employeeDetail | features/personnel | Not started (честная секция-заглушка, см. FRONTEND_DECISIONS A28) |
| Мой профиль | (план) | features/personnel | Not started |
| Календарь сотрудника × месяц | (план, Epic 19.4) | features/calendar | Not started |

## Домен: Объекты и служба (§21, Этап 5)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Реестр объектов (поиск) | objects | features/objects | Verified (ручная браузерная проверка) |
| Паспорт объекта (секторы+посты, редактирование) | objectDetail | features/objects | Verified (ручная браузерная проверка, persist-through-reload) |
| KPI реестра объектов (§21.7) | objects | features/objects | Not started (см. FRONTEND_DECISIONS A30) |
| Схемы/документы/чек-листы объекта | objectDetail | features/objects | Not started |
| План дежурств на месяц | duties | features/duties | Not started (см. FRONTEND_DECISIONS A31) |
| Единый календарь (сотрудник/подразделение) | shiftCalendar | features/calendar | Not started |

## Домен: Контроль и аналитика (§22/§27-30, Этап 6)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| Журнал аудита (read-only) | audit | features/audit | Verified (ручная браузерная проверка) |
| Аналитика службы: ОМ по этапам + объекты по паспорту (честные агрегаты по видимым записям) | serviceAnalytics | app/ServiceAnalyticsPage.tsx | Verified (ручная браузерная проверка) |
| Дашборд нагрузки/перегрузки личного состава | serviceAnalytics | — | Not started (нет read model) |
| Экспорт с маскированием | serviceAnalytics | — | Not started |

## Домен: План дежурств (§21/§24, по запросу «Duties»)

| Экран/действие | Route | Feature | Статус |
|---|---|---|---|
| План дежурств: По объектам / По сотрудникам (общий datasource) | duties | features/duties | Verified (ручная браузерная проверка) |
| Ознакомление → Заступление → Завершение (переходы смены) | duties | features/duties | Verified (ручная браузерная проверка) |
| Боевые группы на Трассе (подача/утверждение/несколько Трасс) | — | — | Not started (§24.1, отдельный процесс) |
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
| Значения справочника (таблица, добавление, деактивация) | dictionaryDetail | features/dictionaries | Verified (ручная браузерная проверка + unit-тесты repository) |
| Блокировка деактивации используемого значения (409, причина дословно) | dictionaryDetail | features/dictionaries | Verified (ручная проверка + unit-тест) |
| Должности/звания/типы статусов/группы (§30 остальные 4 пункта) | — | — | Not started (должности/звания — уже реальные donor-справочники через personnel, см. A40) |

## Покрытие
Итог (после разрешения продолжить): **21 из ~70 экранов Verified** (12 — жизненный цикл ОМ, 2 — сотрудники, 2 — объекты/паспорт, 1 — аудит, 1 — аналитика службы, 1 — план дежурств, 2 — справочники). Остальные ~49 экранов (calendar/notifications/feedback/мой профиль/KPI/схемы/нагрузка/рейтинг/боевые группы/остальные справочники) — Not started. Ложным «Done» не помечать (запрет §35).

## NEXT ACTION
Расширить `e2e-mock/` на personnel/objects/audit/analytics/duties/dictionaries и на середину жизненного цикла ОМ (Рекогносцировка→Потребность→Запрос сил→Расстановка); либо продолжить функциональный объём (уведомления/единый календарь/боевые группы) по решению пользователя.
