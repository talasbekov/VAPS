# FRONTEND_TEST_MATRIX

Бизнес-правило → уровень теста → файл → результат.

## Baseline (Этап 0, снято 2026-07-23)

| Проверка | Команда | Результат |
|---|---|---|
| deps-gate | `node scripts/deps-gate.mjs` | чисто |
| schema-check | `node scripts/schema-check.mjs` | чисто |
| typecheck | `tsc -b` | чисто |
| lint (+ boundaries + print-canon) | `eslint .` | чисто |
| lint-canon fixtures | `node scripts/lint-canon.test.mjs` | 24 красных фикстуры + 9 негативных — доказан |
| schema-check.test | `node scripts/schema-check.test.mjs` | зелёный + 5 красных — доказан |
| build-constants.test | `node scripts/build-constants.test.mjs` | доказан |
| unit/integration | `vitest run` | 53 test files, 790 tests — все зелёные |
| production build | `vite build` | успешна, Firefox100 target |
| size-gate | `node scripts/size-gate.mjs` | 178.5 KB gzip / бюджет 300 KB |

Baseline полностью зелёный — все ошибки ниже этой точки принадлежат моей работе, не наследию.

## Smart Josparlau — правила, которые потребуют тестов (план, заполняется по мере Этапа 2+)

| Бизнес-правило | Уровень | Файл (план) | Статус |
|---|---|---|---|
| Hard-block конфликт (422, без override) для отпуск/больничный/командировка/рапорт | unit (repository) | features/placement/mocks/invariants.test.ts | Not started |
| Soft-конфликт (409 + override_reason) для прочих | unit (repository) | features/placement/mocks/invariants.test.ts | Not started |
| BEFORE_DUTY авто-проекция идемпотентна по source_ref | unit | features/duties/*.test.ts | Not started |
| Оценка по умолчанию = 8, не 7 | unit | features/ratings/*.test.ts | Not started |
| Оценки/оценщики скрыты от участников | integration | features/ratings/*.test.tsx | Not started |
| Persona switch очищает `['me']` и persona-зависимые кэши | integration | app/mocks/demo-runtime.test.ts | Implemented (Этап 1) |
| Reset demo data требует подтверждения и восстанавливает детерминированный seed | integration | app/mocks/demo-runtime.test.ts | Implemented (Этап 1) |
| Persistence: несовместимая schema_version мигрирует либо безопасно сбрасывается | unit | shared/testing/mock-runtime/*.test.ts | Implemented (Этап 1) |
| Concurrent write не затирает более новую revision молча | unit | shared/testing/mock-runtime/transaction.test.ts | Implemented (Этап 1) |

## Smart Josparlau — реализованные проверки (Этап 2, первая волна)

| Проверка | Файл | Статус |
|---|---|---|
| list() без прав/с null credential кидает RepositoryPermissionError | features/security-events/mocks/repository.test.ts | Verified |
| list() фильтрует по search/stage, сортирует устойчиво (businessDate, затем id) | features/security-events/mocks/repository.test.ts | Verified |
| get() несуществующего id → RepositoryNotFoundError | features/security-events/mocks/repository.test.ts | Verified |
| create() требует ops.security_event.create отдельно от ops.security_event.view | features/security-events/mocks/repository.test.ts | Verified |
| create()/updateBulletin() с пустыми полями → RepositoryValidationError, revision НЕ растёт (нет частичной записи) | features/security-events/mocks/repository.test.ts | Verified |
| create()/updateBulletin() успешно — виден в следующем list()/get() (не из памяти вызова, из БД) | features/security-events/mocks/repository.test.ts | Verified |
| Ручная браузерная проверка (dev:mock, 2026-07-23): 403 на create без прав рендерится как форма-ошибка, не крашит; успешный create → редирект на бюллетень; правка бюллетеня переживает `location.reload()` | — (нет Playwright-теста, только ручная) | Verified вручную, Not started как автотест |

## Smart Josparlau — Этапы 3-7 (route audit + расширенный lifecycle)

| Проверка | Файл | Статус |
|---|---|---|
| approvePlacement()/acknowledgePlacement()/completeAcknowledgement()/addJournalEntry()/closeSecurityEvent() — permission+validation+business-rule+persistence | features/security-events/mocks/repository.test.ts | Verified (34/34 тестов файла) |
| Route guard: 7 Smart Josparlau-маршрутов, без нужного permission-кода → «Доступ запрещён», с ним — доступ открыт | app/smart-josparlau-routing.qa.test.tsx | Verified (14 тестов, Этап 7) |
| E2E (реальный chromium, mock-сборка, IndexedDB не in-memory): создать ОМ → сохранить бюллетень → reload → данные на месте | e2e-mock/security-event-lifecycle.spec.ts (`npm run test:e2e:mock`) | Verified |
| E2E: Согласование → авто-переход Ознакомление → Проведение (журнал штаба) → Закрыто (итоги по направлениям, обязательны все) → persist-through-reload → реестр отражает «Закрыто» | e2e-mock/security-event-approval-to-closure.spec.ts | Verified |
| Ручная браузерная проверка: personnel (поиск/фильтр/карточка), objects (паспорт, persist-through-reload), audit (поиск), analytics (агрегаты) | — (нет Playwright-теста) | Verified вручную, Not started как автотест |

## Smart Josparlau — Этап 8 (справочники, §30)

| Проверка | Файл | Статус |
|---|---|---|
| listDefinitions()/listEntries() без прав/с null credential кидает RepositoryPermissionError; createEntry()/setEntryActive() требуют manage отдельно от view | features/dictionaries/mocks/repository.test.ts | Verified |
| listDefinitions() возвращает корректные totalCount/activeCount по справочнику | features/dictionaries/mocks/repository.test.ts | Verified |
| listEntries() фильтрует по dictionaryCode, сортирует по code; неизвестный dictionaryCode → RepositoryNotFoundError | features/dictionaries/mocks/repository.test.ts | Verified |
| createEntry(): пустой code/label → RepositoryValidationError по нужному полю; дубликат code (без учёта регистра) внутри справочника → RepositoryValidationError; неизвестный dictionaryCode → RepositoryNotFoundError | features/dictionaries/mocks/repository.test.ts | Verified |
| createEntry() успешный — персистентен (перечитан из адаптера, не из памяти вызова) | features/dictionaries/mocks/repository.test.ts | Verified |
| setEntryActive(false) на значении с referencedCount>0 → RepositoryConflictError (§30 «понятная зависимость»); referencedCount=0 — деактивация проходит и персистентна; реактивация (isActive=true) НЕ блокируется referencedCount; неизвестный id → RepositoryNotFoundError | features/dictionaries/mocks/repository.test.ts | Verified |
| Route guard: `/dictionaries` и `/dictionaries/:code` добавлены в ROUTE_MATRIX/OPS_CODES | app/smart-josparlau-routing.qa.test.tsx | Verified (16 тестов, было 14) |
| Ручная браузерная проверка (dev:mock, 2026-07-24, persona admin): реестр справочников со счётчиками → детальная страница → 409 на деактивации используемого значения (текст причины показан дословно) → успешная деактивация неиспользуемого → блокировка дубликата code при создании → успешное создание, персистентное через `location.reload()` | — (нет Playwright-теста) | Verified вручную, Not started как автотест |

## Smart Josparlau — Этап 10 (справочники «типы статусов»/«группы», §30 остаток)

| Проверка | Файл | Статус |
|---|---|---|
| createEntry() с groupCode на несуществующую/неактивную запись POST_REQUIREMENT_GROUPS → RepositoryValidationError по полю groupCode | features/dictionaries/mocks/repository.test.ts | Verified |
| createEntry() с groupCode на действующую группу — сохраняется на созданной записи | features/dictionaries/mocks/repository.test.ts | Verified |
| createEntry() с groupCode в справочнике, отличном от POST_REQUIREMENTS — groupCode игнорируется (persist null) | features/dictionaries/mocks/repository.test.ts | Verified |
| Ручная браузерная проверка (dev:mock, 2026-07-24, persona admin): реестр из 5 справочников со счётчиками → JOURNAL_ENTRY_TYPES (4 значения, без колонки «Группа») → POST_REQUIREMENTS (колонка «Группа» показывает label по groupCode, select «Группа» в форме создания заполнен активными записями POST_REQUIREMENT_GROUPS) → создание нового требования с group=DOCUMENTS, персистентно, форма сброшена | — (нет Playwright-теста) | Verified вручную, Not started как автотест |

## Найдено при написании E2E (не гипотетически — реальные баги/пробелы)
- 8 полей форм в `SecurityEventDetailPage.tsx` (бюллетень/возврат на доработку/журнал штаба/итоги закрытия) использовали `<label>` БЕЗ `htmlFor`/`id` — визуально выглядели связанными, но `getByLabel`/screen reader не находили поле. Исправлено (`htmlFor`+`id` на всех восьми). Реальный accessibility-дефект, не тестовая условность — не был бы пойман без попытки написать E2E через семантические локаторы (préview-инструмент в ручной QA использовал `querySelector`, который не проверяет ассоциацию).
- `DemoToolbar` (fixed bottom-4 right-4, dev-only) физически перекрывает кнопки действий на страницах с длинным контентом снизу (журнал штаба, итоги закрытия) — не влияет на продакшн (Rollup исключает chunk), но потребовал `hideDemoToolbar()` хелпера в `e2e-mock/testUtils.ts` для устойчивых E2E-кликов.

## Smart Josparlau — Этап 11 (расширение e2e-mock: personnel/objects/dictionaries/calendar/placement, по запросу «Playwright E2E»)

5 новых спек, ноль изменений в существующих 2 — `e2e-mock/` вырос с 2 до 7 файлов. Демо-сценарий детерминирован (`DemoClock` всегда стартует с `DEFAULT_SCENARIO_START_ISO = 2026-07-20T08:00+05:00`), поэтому даты в спеках (`2026-07-20`/`2026-07-22`) — константы, не вычисляются в рантайме.

| Проверка | Файл | Статус |
|---|---|---|
| Реестр сотрудников: поиск (URL-параметр) сужает список до 1, фильтр по подразделению — до подмножества; карточка сотрудника показывает кадровые поля и честную секцию «Not started» для оперативных данных | e2e-mock/personnel-registry.spec.ts | Verified |
| Реестр объектов: поиск до 1 результата → паспорт → добавление сектора+поста → сохранение → `location.reload()` — данные на месте | e2e-mock/objects-passport.spec.ts | Verified |
| Справочники: деактивация значения с `referencedCount>0` → 409, текст причины показан ДОСЛОВНО из `mutation.error.message`; деактивация неиспользуемого — успешна; создание нового значения персистентно через reload | e2e-mock/dictionaries.spec.ts | Verified |
| Календарь смен: дефолтный день (2026-07-20) показывает дежурства; навигация на `+2` дня (2026-07-22, через `input[type=date]`) показывает расстановку ОМ «Международный экономический форум» со ссылкой «Открыть источник» на карточку мероприятия | e2e-mock/calendar.spec.ts | Verified |
| ОМ, стадия «Расстановка» (PLACEMENT): назначение сотрудника на свободный пост, hard-rule двойного назначения отключает уже занятого сотрудника в select даже на ДРУГОМ посту, снятие назначения | e2e-mock/security-event-placement.spec.ts | Verified |

Прогнано дважды подряд (детерминизм) — `npm run test:e2e:mock`, 7/7 оба раза. Полный `npm run gate` (892/892, 213.2 KB gzip) и полный `npm run test:e2e` (62/62, продакшн-сборка) не задеты.

**Не найдено новых дефектов при написании этих 5 спек** (в отличие от Этапов 7/9) — 3 итерации по мелочам самих тестов (не продукта): `DemoToolbar` перекрывал «Сохранить паспорт» (нужен `hideDemoToolbar()`, тот же паттерн, что Этап 7), `getByText('Ахметов Б.')` без `exact: true` матчил и `<span>`, и `<option>` (строгий режим Playwright), `selectOption({ label: RegExp })` не поддерживается для `<select>` (заменено на `{ value: 'emp-2' }`).

## Smart Josparlau — Этап 12 (e2e-mock: RECON→DEMAND→FORCES→PLACEMENT, продолжение Этапа 11)

Последний непокрытый участок жизненного цикла ОМ между bulletin (Этап 7) и approval→closed (Этап 3): `security-event-lifecycle.spec.ts` идёт только BULLETIN, `security-event-approval-to-closure.spec.ts` — только APPROVAL→CLOSED, `security-event-placement.spec.ts` (Этап 11) — только внутри уже готовой PLACEMENT. Ни одна спека не проходила через RECON/DEMAND/FORCES.

| Проверка | Файл | Статус |
|---|---|---|
| Рекогносцировка: довести чек-лист до 6/6 → «Сохранить расчёт» → «Завершить этап» становится доступен → переход RECON→DEMAND | e2e-mock/security-event-recon-to-placement.spec.ts | Verified |
| Потребность: добавление строки (сектор/задача) → «Сохранить и утвердить» переводит стадию СРАЗУ в FORCES (без промежуточного «заблокированного» вида DEMAND — см. `approveDemand` в repository.ts) | e2e-mock/security-event-recon-to-placement.spec.ts | Verified |
| Запрос сил: авто-агрегированный запрос группе (need из строки потребности) → ручное выделение (allocatedCount=requestedCount) → «Завершить этап» доступен только когда ВСЕ запросы полностью выделены → переход FORCES→PLACEMENT | e2e-mock/security-event-recon-to-placement.spec.ts | Verified |

Найдено при написании (тестовая, не продуктовая неточность): изначальное предположение, что DEMAND-стадия после `approveDemand` покажет заблокированный вид со значком «Потребность утверждена» перед переходом на FORCES, оказалось неверным — `approveDemand` меняет `stage` на `'FORCES'` в ОДНОЙ атомарной мутации (см. `repository.ts:approveDemand`), промежуточного состояния нет. Заголовок стадии у DEMAND и FORCES дословно совпадает («Потребность и выделение сил») — различает их только содержимое панели.

Прогнано дважды подряд (детерминизм) — `npm run test:e2e:mock`, 8/8 оба раза. `npm run gate` (892/892, 213.2 KB gzip) и `npm run test:e2e` (62/62) не задеты.

## Smart Josparlau — Этап 13 (e2e-mock: audit/analytics/duties, по запросу «ок продолжай»)

Последние 3 экрана без E2E-покрытия (были только ручная QA + unit-тесты репозитория для duties).

| Проверка | Файл | Статус |
|---|---|---|
| Аудит: поиск по действию сужает журнал до 1 записи; поиск по `actor_user_id` — независимая фильтрация до другого подмножества | e2e-mock/audit.spec.ts | Verified |
| Аналитика службы: агрегаты «ОМ по этапам (5 из 5)» и «Объекты по состоянию паспорта (3)» — по 1 записи на каждую из 5 представленных стадий/3 состояний паспорта в demo-seed, 0 для непредставленных стадий | e2e-mock/analytics.spec.ts | Verified |
| План дежурств: переключатель «По объектам»/«По сотрудникам» перегруппировывает ОДИН и тот же список (§21.4); полный жизненный цикл дежурства PLANNED→ACKNOWLEDGED→ACTIVE→COMPLETED («Ознакомиться»→«Заступить»→«Завершить», кнопка исчезает в терминале) | e2e-mock/duties.spec.ts | Verified |

Не найдено дефектов продукта — 1 итерация по тестовой инфраструктуре: групповой заголовок в `DutyPlanPage.tsx` — обычный `<div>`, не `<h*>` (не heading role), потребовало `getByText` вместо `getByRole('heading', …)`.

Прогнано дважды подряд (детерминизм) — `npm run test:e2e:mock`, 11/11 оба раза (было 8/8 на Этапе 12). `npm run gate` (892/892, 213.2 KB gzip) и `npm run test:e2e` (62/62) не задеты.

## Smart Josparlau — Этап 15 (боевые группы на Трассе, §24.5-24.10, по запросу «боевые группы на Трассе»)

Новая вкладка «Боевые группы и Трассы» — репозиторный уровень (`mocks/repository.test.ts`, 15 тестов: permission×4, submitCombatGroup×5 [EMPTY_GROUP/NotFound/успех/ALREADY_SUBMITTED/повторная подача возвращённого/DOUBLE_ASSIGNMENT], reviewCombatGroup×5 [ACCEPT/REASON_REQUIRED/RETURN дословно/INVALID_STATE_TRANSITION/персистентность из БД]) + e2e-mock.

| Проверка | Файл | Статус |
|---|---|---|
| Полный цикл: подать состав (старший+участник) → «Подано, ожидает рассмотрения» → вернуть с причиной (показана ДОСЛОВНО) → повторная подача возвращённого состава → принять → «Принято» | e2e-mock/combat-duty-groups.spec.ts | Verified |
| §24.17 hard-rule: сотрудник, ПРИНЯТЫЙ в одну группу на дату, не может быть подан в другую группу на ту же дату — второй фикстурный shift виден в состоянии «Подано» (сид, не эта спека мутирует его) | e2e-mock/combat-duty-groups.spec.ts | Verified (демонстрация на seed-состоянии, полноценный конфликт-ассерт — в repository.test.ts) |
| Персистентность через reload: принятый состав остаётся «Принято» после `page.reload()` | e2e-mock/combat-duty-groups.spec.ts | Verified |

Не найдено дефектов продукта — реализация новая (нет прежнего поведения для регрессии). `npm run test:e2e:mock` прогнан дважды подряд — 13/13 оба раза (было 11/11 на Этапе 13). `npm run gate` (907/907, 216.5 KB gzip) и `npm run test:e2e` (62/62) не задеты.

## Smart Josparlau — Этап 16 (боевые группы: ознакомление → заступление → факт, §24.19-24.23, по запросу «Полный §24 боевых групп»)

Пост-акцептный `CombatDutyExecution` — репозиторный уровень (`mocks/repository.test.ts`, +16 тестов: инициализация execution при ACCEPT, permission×3 [acknowledge/checkin/complete], acknowledgeCombatDuty×4 [NOT_IN_ROSTER/ALREADY_ACKNOWLEDGED/частичное ознакомление остаётся PENDING/последнее ознакомление → READY], checkInCombatDuty×3 [permission/только из READY/успех проставляет actualStart], completeCombatDuty×4 [permission/только из ACTIVE/факт≠план/персистентность из БД]) + e2e-mock.

| Проверка | Файл | Статус |
|---|---|---|
| Полный execution-цикл: «Заступить» недоступен при частичном ознакомлении → 2/2 ознакомлений → READY → заступить → ACTIVE → снять галочку с одного участника → «Завершить дежурство» → честный фактический состав (МЕНЬШЕ планового) | e2e-mock/combat-duty-execution.spec.ts | Verified |
| Персистентность через reload: `COMPLETED` + фактический состав остаются после `page.reload()` | e2e-mock/combat-duty-execution.spec.ts | Verified |

Не найдено дефектов продукта. Найдена коллизия ДО коммита (не продуктовый баг, тестовые данные): первая версия demo-фикстуры для ACCEPTED-группы использовала тот же состав (Байжанов С./Дюсенов М.), что и e2e-спека `combat-duty-groups.spec.ts` подаёт руками на «Трасса №1» — §24.17 DOUBLE_ASSIGNMENT корректно заблокировал эту подачу, спека № 4 упала; исправлено сменой demo-состава на непересекающихся кандидатов (Кенжебаев А./Тастанова Г.). `npm run test:e2e:mock` прогнан дважды подряд — 14/14 оба раза (было 13/13 на Этапе 15). `npm run gate` (920/920, 217.4 KB gzip) и `npm run test:e2e` (62/62) не задеты. Ручная browser-QA (dev:mock, persona admin, свежий IndexedDB) прошла тот же цикл, что e2e — подтверждено snapshot'ами accessibility-дерева на каждом переходе.

## NEXT ACTION
E2E теперь покрывает ВЕСЬ жизненный цикл ОМ (все 9 стадий, 4 спеки), personnel, objects, dictionaries, calendar, audit, analytics, duties (индивидуальные + боевые группы) — 13 спек, ноль экранов без хотя бы одного e2e-прохода. Оставшиеся Not started пункты (полный §24 боевых групп — потребность на период/Conflict Repository/revision, месячное планирование дежурств, уведомления, оперативный профиль данные, tablet/Firefox) — не экраны с существующей реализацией, а нереализованный функционал; решение о следующем направлении — за пользователем.
