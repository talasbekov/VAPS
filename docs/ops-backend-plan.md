# Бэк раздела «Охранные мероприятия»: план новой разработки `/api/ops/*`

Это НЕ переезд. Ни один путь с префиксом `/api/ops/` не существует ни в целевом
бэке (`Backend/PersonnelStatus/Personnel-Records`, резолвер Django), ни в доноре
(`Backend/VAPS/schema.yaml`) — см. `docs/api-gaps.md`. Фронт
(`Backend/PersonnelStatus/PersonalRecordFront`) живёт на браузерном мок-слое MSW
(`mocks/ops/*`), поэтому экраны выглядят рабочими.

Ветка: `claude/smart-josparlau-e55`. Источники истины для контракта:

* `PersonalRecordFront/josparlau/src/features/*/api/pending-contracts.ts` —
  объявленные пути и TypeScript-формы запросов/ответов;
* `PersonalRecordFront/josparlau/src/features/*/model/types.ts` и `lib/*.ts` —
  доменные типы и ВЫЧИСЛИМЫЕ правила (там, где фронт их знает);
* `PersonalRecordFront/mocks/ops/*handlers.ts` — поведение «сервера» в моке.

---

## 0. Сверка счёта путей

Заявленное в задаче «41 объявленная константа, 37 уникальных путей» сверено —
**первое число верно, второе занижено**.

| Мера | Значение | Как получено |
| --- | --- | --- |
| Констант `*_PATH` в `features/*/api/pending-contracts.ts` | **41** | `grep "export const .*PATH" --include=pending-contracts.ts` |
| Различных строк-путей среди этих 41 | **41** (дублей нет; одна константа-паттерн `:exportJobId` и её шаблонный близнец описывают ОДИН адрес) | ручная дедупликация значений |
| Различных адресов `/api/ops/*`, которые фронт реально дёргает | **~64** | `grep -rhoE "/api/ops/[...]" josparlau/src mocks` с нормализацией плейсхолдеров |

Разрыв 41 → 64 объясняется тем, что **бо́льшая часть адресов не объявлена
отдельной константой**, а собирается функцией-хелпером от базового пути:
`objectDetailPath(id)`, `securityEventBulletinPath(id)`,
`combatDutyShiftHandoverPath(id)`, `dutyShiftClockInPath(id)`,
`dictionaryEntriesPath(code)` и т.д. Только у «Охранных мероприятий»
(`security-events`) таких под-адресов около двадцати — это весь жизненный цикл
мероприятия по стадиям.

**Планировать надо от 64, а не от 41.** Счёт «37 путей» описывает ширину
поверхности примерно вдвое у́же реальной, и смета, снятая с него, промахнётся.

---

## 1. Полная карта: путь → экран → метод → форма ответа

Ниже — по группам. Экраны указаны так, как они называются в
`PersonalRecordFront` (страница-компонент и маршрут хоста).

### A. Объекты и паспорта

Экраны: `/security-ops/objects/`, `/security-ops/objects/[id]/`,
`…/passports/[versionId]/` (`ObjectsListPage`, `ObjectPassportPage`,
`ObjectPassportVersionPage`).

| Путь | Метод | Форма ответа |
| --- | --- | --- |
| `/api/ops/objects/` | GET | `{ results: SecurityObject[], freshness: PassportFreshness[], kpi: ObjectsRegistryKpi, freshnessPolicy: PassportFreshnessPolicy, unavailableKpi: UnavailableMetric[] }` |
| `/api/ops/objects/{id}/` | GET | `SecurityObject` |
| `/api/ops/objects/{id}/passport/` | PATCH | тело `{ sectors: ObjectSector[] }` → `SecurityObject` |
| `/api/ops/objects/{id}/passport/versions/` | POST | тело `{ effectiveFrom, note }` → `SecurityObject` |

`SecurityObject` = `{ id, name, code, type, region, address, objectState:
'ACTIVE'|'ARCHIVED', passportState: 'RED'|'YELLOW'|'GREEN', sectors:
ObjectSector[], passportVersions: PassportVersion[], createdAt, updatedAt }`.
`ObjectSector` = `{ id, name, posts: SecurityPost[] }`, `SecurityPost` =
`{ id, name, task, requirements }`. `PassportVersion` = `{ id, versionNumber,
effectiveFrom, publishedAt, publishedBy, note, sectors }` — **снимок**, после
публикации неизменяем.

`PassportFreshness` = `{ objectId, state: 'FRESH'|'DUE_SOON'|'OVERDUE'|
'NO_PUBLISHED_VERSION', verificationDueAt: string|null, freshnessPolicyVersion }`.
`ObjectsRegistryKpi` = `{ total, passportGreen, passportYellow, passportRed,
verificationOverdue, neverPublished }`.

Правило свежести известно ПОЛНОСТЬЮ (фронт несёт его в
`features/objects/lib/passportFreshness.ts` как эталон):
`verificationDueAt = effectiveFrom(последней версии) + verificationIntervalDays`;
`OVERDUE` если срок прошёл, `DUE_SOON` если осталось ≤
`ceil(интервал × dueSoonPercent / 100)`, иначе `FRESH`; без публикаций —
`NO_PUBLISHED_VERSION`. Отсчёт идёт от `effectiveFrom` последней ПУБЛИКАЦИИ, а
не от правки черновика.

### B. Справочники раздела

Экраны: `/security-ops/dictionaries/`, `/security-ops/dictionaries/[code]/`.

| Путь | Метод | Форма |
| --- | --- | --- |
| `/api/ops/dictionaries/` | GET | `{ results: { code, label, description, totalCount, activeCount }[] }` |
| `/api/ops/dictionaries/{code}/entries/` | GET | `{ results: DictionaryEntryView[] }` |
| `/api/ops/dictionaries/{code}/entries/` | POST | `{ code, label, description, groupCode? }` → `DictionaryEntryView` |
| `/api/ops/dictionaries/entries/{id}/set-active/` | POST | `{ isActive }` → `DictionaryEntryView` |
| `/api/ops/dictionaries/entries/{id}/` | DELETE | 204 |

Коды справочников: `JOURNAL_ENTRY_TYPES`, `RETURN_REASONS`,
`POST_REQUIREMENTS`, `POST_REQUIREMENT_GROUPS`, `SEASONAL_CORRECTIONS`.
`DictionaryEntryView.usage` = `{ status: 'TRACKED'|'NOT_TRACKED'|'UNKNOWN',
reason, references[], totalCount }`; удаление разрешено только при
`TRACKED && totalCount === 0`, иначе 409 `DICTIONARY_ENTRY_IN_USE` / 422
`DICTIONARY_USAGE_UNKNOWN`.

### C. Настройки раздела (политики)

Экран: `/security-ops/settings/`.

| Путь | Метод | Форма |
| --- | --- | --- |
| `/api/ops/settings/` | GET | `{ results: PolicySetting[], sectionVersions: Record<SectionCode, string> }` |
| `/api/ops/settings/{settingCode}/` | PATCH | `{ value, reason }` → `{ setting, sectionVersions, event }` |
| `/api/ops/setting-changes/` | GET | `{ results: SettingChangeEvent[] }` |
| `/api/ops/settings/change-log/` | GET | тот же журнал (второй адрес того же ресурса) |

Секции: `CONFLICT_RULES`, `PASSPORT_FRESHNESS`, `ANALYTICS_LIMITS`,
`LOAD_POLICY`, `ATTENTION_POLICY`, `REPORT_LIMITS`, `RATING_POLICY`.
`PolicySetting` = `{ settingCode, sectionCode, kind: 'CHOICE'|'NUMBER',
valueType, safeLabel, description, value, minValue?, maxValue?, options?,
updatedAt, updatedBy, editable, lockedReason, action: { canEdit,
disabledReason } }`.

**Эта группа — поставщик политик для A (`PASSPORT_FRESHNESS`), D
(`CONFLICT_RULES`), H (`ANALYTICS_LIMITS`, `LOAD_POLICY`, `ATTENTION_POLICY`),
I (`REPORT_LIMITS`), G (`RATING_POLICY`).**

### D. Дежурства (индивидуальные)

Экраны: `/security-ops/duties/`, `/security-ops/duties/[id]/`,
`/security-ops/calendar/`.

| Путь | Метод | Роль |
| --- | --- | --- |
| `/api/ops/duty-types/` | GET | реестр типов + `conflictPolicy` |
| `/api/ops/duty-shifts/` | GET / POST | список смен + создание |
| `/api/ops/duty-shifts/{id}/` | GET | карточка + конфликты дня |
| `/api/ops/duty-shifts/{id}/update/` | POST | правка (дата и тип неизменяемы) |
| `/api/ops/duty-shifts/{id}/cancel/` | POST | `{ reason }` |
| `/api/ops/duty-shifts/{id}/acknowledge/` | POST | PLANNED→ACKNOWLEDGED |
| `/api/ops/duty-shifts/{id}/clock-in/` | POST | ACKNOWLEDGED→ACTIVE |
| `/api/ops/duty-shifts/{id}/clock-out/` | POST | ACTIVE→COMPLETED |
| `/api/ops/duty-monthly-plan/` | GET | план месяца + KPI + конфликты |
| `/api/ops/duty-monthly-plan/draft/` | POST | создать черновик месяца |
| `/api/ops/duty-monthly-plan/check/` | POST | проверка конфликтов |
| `/api/ops/duty-monthly-plan/approve/` | POST | утвердить (запирает месяц) |
| `/api/ops/duty-monthly-plan/reopen/` | POST | распечатать обратно в DRAFT |
| `/api/ops/duty-plan-objects/` | GET | объекты+секторы+посты на дату |
| `/api/ops/duty-candidates/` | GET | кандидаты + занятость на дату |
| `/api/ops/duty-shift-list/` | GET | плоский список для таблицы |

Состояния смены: `PLANNED → ACKNOWLEDGED → ACTIVE → COMPLETED`, `CANCELLED` —
терминальное. Состояния плана: `DRAFT`/`APPROVED`.
Жёсткий конфликт `DUTY_OVERLAP` (две смены сотруднику в один день) и
`PASSPORT_REQUIRED`; мягкий `REST_AFTER_DUTY` перебивается `override=true` +
`override_reason` (тот же протокол 409-обхода, что уже живёт во фронте).

`/api/ops/duty-plan-objects/` читает **опубликованные версии паспортов группы
A** — прямая зависимость.

### E. Боевые группы

Экран: `/security-ops/duties/combat/`.

| Путь | Метод |
| --- | --- |
| `/api/ops/combat-duty-types/` | GET |
| `/api/ops/duty-routes/` | GET |
| `/api/ops/combat-roster-candidates/` | GET |
| `/api/ops/combat-duty-shifts/` | GET / POST |
| `/api/ops/combat-duty-shifts/{id}/submit/` | POST |
| `/api/ops/combat-duty-shifts/{id}/review/` | POST (`ACCEPT`/`RETURN`) |
| `/api/ops/combat-duty-shifts/{id}/acknowledge/` | POST |
| `/api/ops/combat-duty-shifts/{id}/check-in/` | POST |
| `/api/ops/combat-duty-shifts/{id}/handover/` | POST |
| `/api/ops/combat-duty-shifts/{id}/complete/` | POST |
| `/api/ops/combat-duty-shifts/{id}/replace/` | POST |

Цикл: нет подачи → `SUBMITTED` → `ACCEPTED`/`RETURNED`; после ACCEPT
открывается исполнение `PENDING_ACKNOWLEDGEMENT → READY → ACTIVE →
COMPLETED`. Пересдача обязательна перед завершением (`MISSING_HANDOVER`).
Замена — только до check-in.

### F. Охранные мероприятия (реестр ОМ) — САМАЯ БОЛЬШАЯ ГРУППА

Экраны: `/security-ops/events/`, `/security-ops/events/[id]/`,
`/security-ops/command-center/`.

Базовые: `/api/ops/security-events/` (GET постранично + POST),
`/api/ops/security-events/{id}/` (GET),
`/api/ops/security-events/bindable-objects/` (GET),
`/api/ops/security-events/{id}/passport/` (GET),
`/api/ops/security-events/{id}/placement/ratings/` (GET).

Стадийные (≈17 адресов): `bulletin/` PATCH, `bulletin/complete/`, `recon/`
PATCH, `recon/import-from-passport/`, `recon/complete/`, `demand/approve/`,
`forces/{requestId}/` PATCH, `forces/complete/`, `placement/assign/`,
`placement/{assignmentId}/` DELETE, `placement/complete/`,
`approval/approve/`, `approval/return/`, `acknowledge/{assignmentId}/`,
`acknowledgement/complete/`, `journal/`, `conduct/replace/`, `close/`.

Стадии: `BULLETIN → RECON → DEMAND → FORCES → PLACEMENT → APPROVAL →
ACKNOWLEDGEMENT → CONDUCT → CLOSED` с фиксированной готовностью
15/30/45/60/75/85/95/100 %.

Зависит от A (объекты + привязка версии паспорта по `businessDate`) и от K
(состав личного состава для расстановки).

### G. Оперативный рейтинг

Экраны: `/security-ops/ratings/` и пять вложенных.

15 адресов: `operational-ratings/`, `operational-rating-dynamics/`,
`operational-rating-employee/`, `rating-analytics/`, `evaluation-workspace/`,
`evaluation-work-items/{id}/submit|detail|correct/`, `evaluation-registry/`,
`rating-audit/`, `rating-notifications/`, `rating-exports/` (GET+POST),
`rating-exports/{id}/cancel/`, `rating-export-artifacts/{id}/download/`.

Зависит от F (мероприятия, прогоны, назначения) и C (`RATING_POLICY`).

### H. Аналитика службы и мероприятий

Экраны: `/security-ops/analytics/`, `/security-ops/analytics/operations/`.

`service-analytics/`, `service-analytics-presets/`,
`service-analytics-drilldown/`, `service-analytics-attention/`,
`load-analytics/`, `operations-analytics/` — все GET, все читают производные
агрегаты над D/E/F. Ответ несёт конверт снимка: `snapshotId`, `businessDate`,
`timezone`, `period`, `scope`, `generatedAt`, `freshnessState`,
`completenessState`, `calculationVersion`, `policyVersion`.
Детализация требует совпадения `snapshot_id`, иначе `SNAPSHOT_OUTDATED`.

### I. Служебные отчёты

Экраны: `/security-ops/service-reports/`, `…/history/`, `…/[reportJobId]/`.

`service-report-types/`, `service-report-jobs/` (GET+POST),
`service-report-jobs/history/`, `service-report-jobs/{id}/`,
`…/{id}/retry/`, `…/{id}/new-revision/`,
`service-report-artifacts/{id}/download/`.
Задача: `PENDING → PROCESSING → COMPLETED|FAILED`. Артефакт хранит ревизию в
серии и `expiresAt` по политике удержания.

### J. Обратная связь

Экран: `/feedback/` (хостовый) + карточка.

`feedback-requests/` (GET+POST), `{id}/`, `{id}/submit/`, `{id}/comments/`,
`{id}/triage/`, `{id}/close/`.
Статусы: `DRAFT, NEW, IN_REVIEW, NEED_INFO, ACCEPTED, PLANNED, FIXED,
RELEASED, REJECTED, CLOSED, DUPLICATE`; последние три терминальны и
закрываются только через `close/` с обязательным публичным ответом.

**Группа НЕ зависит ни от одной другой группы `/api/ops/*`.**

### K. Кадровая витрина раздела

`/api/ops/personnel-directory/` (GET), `{id}/` (GET),
`{id}/identity-disclosure/` (POST), `{id}/identity-disclosures/` (GET),
`/api/ops/personnel/` (GET, состав-кандидаты для расстановки ОМ).

`PersonnelDirectoryEntry` = `{ id, fullName, rankCode, positionCode,
divisionId, personnelNumber, hireDate, dismissalDate, employmentStatus:
'WORKING'|'FIRED'|'ARCHIVED', iinMasked, canRevealIin }`.

**Садится поверх уже живых `employees.Employee`, `dictionaries.Rank/Position`,
`staff_unit.StaffUnit`, `divisions.Division` — новых бизнес-моделей почти не
требует** (только журнал раскрытий ИИН).

### L. Расход дня раздела

`/api/ops/daily/divisions/`, `…/employees/`, `…/statuses-bulk/`,
`…/daily-submissions/`, `…/daily-submissions/{id}/amend/`.

**Это дубликат уже ЖИВОГО функционала** `/api/operations/` (bulk-статусы,
подача дня, поправка). Строить второй раз нельзя: две пишущие поверхности над
одной таблицей разойдутся в инвариантах — ровно тот довод, которым срезы
153–159 отказались от вторых пишущих ручек.

### M. Журнал действий раздела

`/api/ops/audit-logs/` (GET) поверх уже существующей
`operations.models_audit.OpsAuditLog`.

### N. Печатные формы

`/api/ops/reports/` — используется `features/print-forms/placementPrint.ts`.
Форма ответа в контракте не типизирована; **назначение уточнить у владельца**.

---

## 2. Модели и связи с существующими

| Группа | Новые модели | Связи с живым бэком |
| --- | --- | --- |
| A | `OpsSecurityObject`, `OpsObjectSector`, `OpsObjectPost`, `OpsPassportVersion` (+снимок секторов/постов версии) | опционально `divisions.Division` как владелец объекта — **не подтверждено** |
| B | `OpsDictionary` (или enum-код) + `OpsDictionaryEntry` | нет |
| C | `OpsPolicySetting`, `OpsSettingChange` | нет |
| D | `OpsDutyType`, `OpsDutyShift`, `OpsMonthlyDutyPlan` (+история ревизий) | `employees.Employee`; версии паспортов из A |
| E | `OpsCombatDutyType`, `OpsDutyRoute`, `OpsCombatDutyShift`, `OpsCombatSubmission`, `OpsCombatExecution`, `OpsDutyReplacement` | `employees.Employee` |
| F | `OpsSecurityEvent`, `OpsReconChecklistItem`, `OpsSectorPost`, `OpsStaffingDemandRow`, `OpsForceRequest`, `OpsPlacementAssignment`, `OpsJournalEntry`, `OpsClosureSummary` | объекты из A, `employees.Employee`, `divisions.Division` |
| G | `OpsEvaluationWorkItem`, `OpsEvaluation`, `OpsEvaluationCorrection`, `OpsRatingPoint`, `OpsRatingNotification`, `OpsRatingExportJob`, `OpsRatingExportArtifact` | мероприятия из F, `employees.Employee` |
| H | моделей нет (производные агрегаты) | читает D/E/F + политики C |
| I | `OpsReportJob`, `OpsReportArtifact` | политики C |
| J | `OpsFeedbackRequest`, `OpsFeedbackComment`, `OpsFeedbackEvent`, `OpsFeedbackAttachment` | `auth.User` как автор |
| K | `OpsIdentityDisclosure` | `employees.Employee`, `dictionaries.Rank/Position`, `divisions.Division` |
| M | нет — уже есть `OpsAuditLog` | — |

Конвенция размещения (по прецеденту срезов 153–159): **бизнес-модели кладутся в
уже установленное приложение `apps/operations` отдельными `models_*.py`**
(`models_audit.py`, `models_document.py`, `models_status.py`, … — так уже
устроено), а контракт `/api/ops/` живёт отдельным приложением-оболочкой
`apps/ops/api/` без своих моделей — по образцу `apps/core/` и `apps/documents/`.
Это снимает риск коллизии namespace-пакетов и не трогает `INSTALLED_APPS`.

---

## 3. Приоритет и карта зависимостей

```
C (Настройки) ──политики──┬─→ A (Объекты)
                          ├─→ D (Дежурства)
                          ├─→ H (Аналитика)
                          ├─→ I (Отчёты)
                          └─→ G (Рейтинг)

A (Объекты) ──┬─→ D (Дежурства: duty-plan-objects, привязка паспорта)
              └─→ F (ОМ: bindable-objects, импорт постов из паспорта)

K (Кадровая витрина) ─→ F (расстановка), D/E (кандидаты)

F (ОМ) ─→ G (Рейтинг: work items привязаны к прогонам мероприятий)

D + E + F ─→ H (Аналитика — производная над всеми тремя)

J (Обратная связь) — НЕЗАВИСИМА
M (Журнал) — НЕЗАВИСИМ (модель уже есть)
L (Расход дня) — НЕ СТРОИТЬ, дубликат живого /api/operations/
```

Рекомендованный порядок:

1. **A — Объекты и паспорта.** Наибольший фан-аут (разблокирует D и F), верхних
   зависимостей нет, бизнес-логика свежести известна ПОЛНОСТЬЮ. **← начинаем
   отсюда.**
2. **M — Журнал действий.** Модель уже живёт, это одна читающая ручка.
3. **K — Кадровая витрина.** Садится поверх существующих кадровых моделей,
   почти без новых таблиц; закрывает половину командного центра.
4. **C — Настройки.** Без него A/D/H/I/G держат политики в коде, а §21.7 это
   прямо запрещает.
5. **B — Справочники раздела.**
6. **J — Обратная связь.** Независима, закрывает целый экран разом.
7. **F — Реестр ОМ.** Наибольшая ценность, но самая большая и требует A и K.
8. **D — Дежурства**, затем **E — Боевые группы**.
9. **I — Служебные отчёты**, затем **H — Аналитика**.
10. **G — Оперативный рейтинг.** Последним: больше всего неизвестной бизнес-логики.

---

## 4. Оценка в стори (правила декомпозиции `CLAUDE.md`)

Считано по слоям: модель → миграция → сериализатор → вьюха → права → тесты; один
эндпоинт с бизнес-логикой = отдельная стори.

| Группа | Адресов | Стори (оценка) |
| --- | --- | --- |
| A. Объекты и паспорта | 4 | 8 |
| B. Справочники | 5 | 6 |
| C. Настройки | 4 | 6 |
| D. Дежурства | 16 | 20 |
| E. Боевые группы | 11 | 13 |
| F. Реестр ОМ | 22 | 24 |
| G. Оперативный рейтинг | 15 | 20 |
| H. Аналитика | 6 | 10 |
| I. Служебные отчёты | 7 | 9 |
| J. Обратная связь | 6 | 8 |
| K. Кадровая витрина | 5 | 6 |
| L. Расход дня | 5 | 0 (не строить) |
| M. Журнал действий | 1 | 2 |
| N. Печатные формы | 1 | ? (назначение неизвестно) |
| **Итого** | **~64** | **~132** |

Оценка НЕ включает: врезку живого бэка вместо MSW во фронте (отдельная работа,
`lib/api-gaps.ts` + `mount.tsx`), сиды демо-данных, WS-доставку.

---

## 5. ЧТО НЕИЗВЕСТНО — нужен владелец продукта

Перечислено только то, чего в коде фронта НЕТ и что выдумать нельзя.

### Критично (блокирует проектирование модели)

1. **Как считается агрегат оперативного рейтинга** (`aggregateRating`, 1–10):
   веса оценщиков, отсечение выбросов, округление, какие оценки входят в период.
   Фронт получает готовое число. Группа G без этого не проектируется.
2. **Что такое «закрытый период» рейтинга** и когда точка динамики становится
   записанной. Пересчёт закрытого периода запрещён — но момент закрытия
   неизвестен.
3. **Как выводится `passportState` (RED/YELLOW/GREEN) объекта.** Во фронте это
   ХРАНИМОЕ поле фикстуры, правило вывода отсутствует. Оно демонстративно
   отличается от вычислимой `PassportFreshness` («разные поля, не один бейдж»),
   значит у него своя логика — и её нет нигде.
4. **Владелец объекта в оргструктуре.** У `SecurityObject` есть `region` и
   `type` строками, но нет ссылки на подразделение. Нужна ли связь с
   `divisions.Division` (и по какому правилу область видимости объектов) —
   не определено.
5. **Правило отдыха после дежурства** (`REST_AFTER_DUTY`): `restAfterMinutes`
   приходит из реестра типов, но как именно проверяется пересечение окна отдыха
   (по бизнес-дате? по фактическому времени? по плановой длительности) — нет.
6. **Как считаются метрики аналитики службы** (`displayValue`, `state`
   NORMAL/WARNING/CRITICAL), пороги детекторов внимания
   (`ACKNOWLEDGEMENT_MISSING`, `CONFLICT_SHARE`, …), состав `LoadAnalyticsView`
   и воронки мероприятий. Фронт только рисует готовое.
7. **`calculationVersion` / `snapshotId` аналитики**: от чего считается
   отпечаток снимка, чтобы детализация могла отвергнуть устаревший.

### Важно (блокирует поведение, но не форму)

8. **Права раздела.** Во фронте фигурируют коды вида `ops.rating.view_aggregate`,
   `ops.rating.view_correction_chain`, `ops.rating.view_audit`. В целевом бэке
   RBAC другой (`seed_operations.PERMISSIONS`: `object.manage`, `duty.manage`,
   `event.manage`, …). Раскладка «экран → право» для раздела не утверждена;
   существующая раскладка core/documents помечена PROVISIONAL.
9. **Кто утверждает и распечатывает месячный план дежурств** (`approve`/`reopen`).
10. **Кто может рецензировать подачу боевой группы** (`review` ACCEPT/RETURN).
11. **Как вычисляется `usage` записи справочника** для типов `NOT_TRACKED` — по
    каким таблицам искать ссылки.
12. **Кому уходит уведомление `EVALUATION_CORRECTED`**: автору исходной оценки,
    автору поправки, обоим?
13. **Политика удержания артефактов отчётов и выгрузок** (`retentionDays`) и
    правило нумерации ревизий в серии.
14. **Алгоритм `safeLabel`** — как из ФИО получается «безопасная» подпись.
15. **Назначение `/api/ops/reports/`** (печатные формы расстановки).
16. **Групповая оценка** (`targetGroupId`) — во фронте отклоняется как
    неподдерживаемая; нужна ли она вообще.

### Решения, которые надо принять до врезки фронта

17. **Тип идентификатора.** Контракт фронта объявляет `id: string` у всех
    сущностей раздела; конвенция целевого бэка — целочисленные ключи (см.
    докстринг `models_document.py`). Первый срез идёт по конвенции бэка (int).
    Расхождение придётся закрывать либо приведением на клиенте, либо UUID-ключами
    — **выбор за владельцем, тянуть до врезки нельзя**.
18. **Судьба группы L (расход дня раздела).** Предложение: не строить, а
    переписать SPA на живые `/api/operations/*`.

---

## 6. Сделано в этом заходе

**Срез A1 — `GET /api/ops/objects/`, модель охраняемого объекта.**
См. коммит с префиксом `feat(ops)`. Границы среза:

* заведена модель `OpsSecurityObject` (`apps/operations/models_object.py`) и её
  миграция;
* заведено приложение-оболочка контракта `apps/ops/api/` и префикс
  `path("api/ops/", …)` в корневом urlconf;
* отдан списочный GET со строкой объекта; **секторы, посты, версии паспорта,
  `freshness`, `kpi` и `freshnessPolicy` в этот срез НЕ входят** — под ними свои
  таблицы и своя политика (стори A2–A5). Отдавать их пустыми значило бы выдать
  «данных нет» за «объект без паспорта»;
* фронт с моков НЕ переключён — это отдельная работа.
