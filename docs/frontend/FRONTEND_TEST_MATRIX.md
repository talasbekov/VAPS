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

## Smart Josparlau — Этап 17 (замены §24.21, продолжение §24, по запросу «Продолжение §24»)

`requestReplacement` — репозиторный уровень (`mocks/repository.test.ts`, +11 тестов: permission, REASON_REQUIRED, INVALID_STATE_TRANSITION на ACTIVE, NOT_IN_ROSTER, ALREADY_IN_ROSTER, DOUBLE_ASSIGNMENT против ДРУГОЙ ACCEPTED-группы на ту же дату, успешная замена участника, успешная замена старшего группы обновляет `groupLeaderEmployeeName`, замена уже ознакомленного откатывает READY→PENDING_ACKNOWLEDGEMENT, персистентность из БД, RepositoryNotFoundError) + e2e-mock.

| Проверка | Файл | Статус |
|---|---|---|
| Заменить участника (Тастанова Г. → Байжанов С.) с причиной, дословно попадающей в историю замен, «Отметить ознакомление» снова 2/2 для нового состава | e2e-mock/combat-duty-replacement.spec.ts | Verified |
| Персистентность через reload: обновлённый состав + история замены остаются после `page.reload()` | e2e-mock/combat-duty-replacement.spec.ts | Verified |

Не найдено дефектов продукта. `npm run test:e2e:mock` прогнан дважды подряд — 15/15 оба раза (было 14/14 на Этапе 16). `npm run gate` (931/931, 218.0 KB gzip) и `npm run test:e2e` (62/62) не задеты. Ручная browser-QA (dev:mock, persona admin, свежий IndexedDB v9) прошла цикл: заменить → состав/история обновились → оба участника требуют ознакомления заново → персистентно через reload.

## Smart Josparlau — Этап 18 (формирование потребности на смену §24.1, продолжение §24, по запросу «Продолжение §24»)

`createCombatDutyShift` — репозиторный уровень (`mocks/repository.test.ts`, +10 тестов: permission, INVALID_BUSINESS_DATE, EMPTY_ROUTE_SET, INVALID_REQUIREMENT, UNKNOWN_DUTY_TYPE, UNKNOWN_ROUTE, TOO_MANY_ROUTES, успешное создание с submission:null, персистентность из БД, созданная смена не затирает фикстурные) + e2e-mock.

| Проверка | Файл | Статус |
|---|---|---|
| Создать смену на будущую дату (2026-07-27) → появляется «Требует подачи» с честной requiredEmployees → состав подаётся на неё как на любую другую смену | e2e-mock/combat-duty-requirement.spec.ts | Verified |
| Персистентность через reload: созданная смена + поданный на неё состав остаются после `page.reload()` | e2e-mock/combat-duty-requirement.spec.ts | Verified |

Не найдено дефектов продукта. `npm run test:e2e:mock` прогнан дважды подряд — 16/16 оба раза (было 15/15 на Этапе 17). `npm run gate` (941/941, 218.8 KB gzip) и `npm run test:e2e` (62/62) не задеты. Ручная browser-QA (dev:mock, persona с `ops.duty.manage`, свежий IndexedDB) подтвердила создание смены на 2026-08-05 с 2 Трассами (COMBAT_GROUP_MULTI_ROUTE).

## Smart Josparlau — Этап 23 (accessibility второй проход — клавиатурная навигация вкладок, по запросу «продолжай разрабатывать фронтенд часть»)

Единственный `role="tab"`-паттерн проекта (`EmployeeDetailPage.tsx`, оперативный профиль §20.15) получил WAI-ARIA Tabs Pattern клавиатуру: roving tabindex, `ArrowLeft`/`ArrowRight`/`Home`/`End`, `aria-controls`↔`id` связь tab/tabpanel.

| Проверка | Файл | Статус |
|---|---|---|
| Только активная вкладка имеет `tabindex=0`, остальные `-1` | e2e-mock/personnel-registry.spec.ts | Verified |
| `ArrowRight`/`ArrowLeft` перемещают фокус и `aria-selected` между соседними вкладками, содержимое `tabpanel` меняется | e2e-mock/personnel-registry.spec.ts | Verified |
| `Home`/`End` перемещают фокус на первую/последнюю вкладку | e2e-mock/personnel-registry.spec.ts | Verified |

Не найдено дефектов продукта в остальных экранах: `DutyPlanPage` toggle «По объектам»/«По сотрудникам» — обычные кнопки, не `role="tab"`, паттерн не применим; `CreateSecurityEventDialog` — нативный `<dialog>`+`showModal()`, focus-trap и Escape уже корректны из коробки браузера, второй модалки в проекте нет. `npm run test:e2e:mock` прогнан дважды подряд — 17/17 оба раза (было 16/16 на Этапе 18). `tsc -b`/`eslint`/`vitest run --exclude DailyUpdatePage.test.tsx` (923/923)/`vite build`/`size-gate` (220.3 KB gzip) — все зелёные; `npm run test:e2e` (62/62) не задет.

## Smart Josparlau — Этап 24 (accessibility третий проход — axe-core количественный аудит, по запросу «продолжай, следующий — второй слой accessibility»)

`@axe-core/playwright` (новая devDependency) + новая спека `e2e-mock/accessibility-axe.spec.ts` — прогоняет axe по 9 верхнеуровневым + 6 детальным/composed экранам, гейтит только `critical`/`serious`.

| Проверка | Файл | Статус |
|---|---|---|
| Ни одного `critical`/`serious` нарушения на 9 верхнеуровневых экранах (Командный центр, Реестр ОМ, Сотрудники, Объекты, Дежурства, Справочники, Календарь, Аналитика, Аудит) | e2e-mock/accessibility-axe.spec.ts | Verified |
| Ни одного `critical`/`serious` нарушения на 6 детальных/composed видах (карточка сотрудника ×2 вкладки, ОМ-Расстановка, паспорт объекта, справочник-значения, боевые группы) | e2e-mock/accessibility-axe.spec.ts | Verified |

Найдено и исправлено 5 РЕАЛЬНЫХ дефектов (см. FRONTEND_PROGRESS Этап 24 для полного разбора): 2× critical `select-name`/`label` (форма расстановки ОМ, дата календаря — Этап 20 их не поймал, ручной аудит не долистал/не догадался), 8× serious `color-contrast` в бейджах `bg-muted`+`text-muted-foreground` по 4 фичам (personnel/security-events/duties/dictionaries), 1× serious `color-contrast` в выбранном посте расстановки. Разобраны 2 ложных срабатывания теста (mid-`transition-colors` сэмплинг, залипший `:hover` от Playwright `.click()`) — исправлен МЕТОД теста (`waitForTimeout(200)` + `mouse.move(0,0)`), не код продукта. 1 реальный кросс-cutting дефект (общий `Button` default-hover, 4.13:1) на тот момент НЕ исправлен — вынесен `task_0af937e6` (вне Smart Josparlau scope, задет весь app); задача выполнена независимо тем же днём (`fe088a3`, `/90`→`/95`, ~4.52:1), перепроверена здесь без регрессий.

**Второй проход по moderate/minor находкам той же спеки** (по запросу «продолжай, следующий — второй слой accessibility»): при повторных прогонах вскрылся ещё один `serious` `color-contrast` (`CommandCenterPage.tsx`, тот же `bg-primary/10`+`text-primary` паттерн, что уже чинили в форме расстановки, 4.48:1) — исправлен тем же способом (`text-blue-800`). Плюс закрыты ВСЕ moderate/minor:

| Проверка | Файл | Статус |
|---|---|---|
| Ни одной `empty-table-header` находки (7 таблиц с колонкой-действием получили `sr-only`-подпись) | e2e-mock/accessibility-axe.spec.ts | Verified |
| Ни одной `landmark-unique` находки (панель «Посты» получила `aria-label`) | e2e-mock/accessibility-axe.spec.ts | Verified |
| Ни одной `heading-order` находки (`CombatDutyGroupsSection` h3→h2) | e2e-mock/accessibility-axe.spec.ts | Verified |
| Ни одной `page-has-heading-one` находки (тест ждёт `h1`, не каркас `main` — фикс метода теста, лениво-загружаемый chunk у Suspense-фолбэка без `h1`) | e2e-mock/accessibility-axe.spec.ts | Verified |

`npm run test:e2e:mock` прогнан **трижды подряд** — 19/19 каждый раз, **ноль** moderate/minor находок в логе (было по 1 находке на 5-7 экранах). `tsc -b`/`eslint`/`vitest run --exclude DailyUpdatePage.test.tsx` (923/923)/`vite build`/`size-gate` (220.4 KB gzip) — все зелёные; `npm run test:e2e` (62/62) не задет.

## Smart Josparlau — Этап 25 (accessibility четвёртый проход — skip-to-content, по запросу «continue with the next accessibility item»)

`shared/ui/AppLayout.tsx` (общий каркас, весь app) получил ссылку «Перейти к содержимому» (WCAG 2.4.1 Bypass Blocks) — новая прод-спека `e2e/app-layout.spec.ts` (не `e2e-mock/`, компонент не Smart-Josparlau-специфичный).

| Проверка | Файл | Статус |
|---|---|---|
| Первый `Tab` со старта страницы фокусирует skip-ссылку (не сайдбар) | e2e/app-layout.spec.ts | Verified |
| Ссылка `sr-only`, становится видимой при фокусе | e2e/app-layout.spec.ts | Verified |
| `Enter` на ссылке переводит фокус на `#main-content` | e2e/app-layout.spec.ts | Verified |

Риск-анализ перед правкой общего компонента: 2 существующих e2e-теста используют постраничный `Tab` от старта (`day-amendment`/`day-submission`) — оба через `tabUntilFocused`-цикл (лимит 20, устойчив к новому первому tab-стопу); остальные Tab-тесты идут через изолированный `e2e-harness/*.html`, минующий `AppLayout`. `npm run test:e2e` (63/63, было 62/62, +1 спека — весь E10-донор-суит не задет). `npm run test:e2e:mock` — 19/19 трижды подряд, без новых axe-находок. `tsc -b`/`eslint`/`vitest` (923/923)/`vite build`/`size-gate` (220.5 KB gzip) — все зелёные.

## Печатная форма расстановки (§9.15, Этап 26)

| Что проверяется | Где | Статус |
| --- | --- | --- |
| Разбор ответа: шапка/посты/назначения, битые тела → null, нечисловая потребность → 0 | src/features/print-forms/placementPrint.test.ts | Verified |
| Оценочные поля постов (`result`/`comment`) НЕ разбираются вовсе (§19.24) — красная проба на ключах | placementPrint.test.ts | Verified |
| Строки: дырка «не назначен», N назначений → N строк (потребность в первой), осиротевшее назначение в хвосте | placementPrint.test.ts, PlacementPrintPage.test.tsx | Verified (красная проба ×2) |
| Итоги: потребность и назначено — независимы | placementPrint.test.ts, PlacementPrintPage.test.tsx | Verified |
| `sentence()` не удваивает точку у ФИО «Ерланов Д.» | placementPrint.test.ts, PlacementPrintPage.test.tsx | Verified (красная проба) |
| Карта отказов: 401 silent, 403/404 фикс-тексты, 5xx и сеть получают ТЕКСТ | placementPrint.test.ts | Verified |
| Состояния без документа: нет параметра / не-карточка / нет постов — разные тексты, шапка только где уместна | PlacementPrintPage.test.tsx | Verified |
| В документе только `print-*`-классы (UI-слой не протекает) | PlacementPrintPage.test.tsx, e2e-mock/placement-print.spec.ts | Verified (красная проба) |
| Маркер demo печатается на бумаге, экранная подсказка — нет (`emulateMedia print`) | e2e-mock/placement-print.spec.ts | Verified |
| PT Serif применён (Tailwind preflight не подменяет шрифт документа) | e2e-mock/placement-print.spec.ts | Verified |
| Разводка: гейт `ops.security_event.view`, вне AppLayout, редирект на /login без credential, не в NAV_SECTIONS | src/app/print-placement-routing.test.tsx | Verified |
| Ссылка с карточки открывает документ В ТОЙ ЖЕ вкладке (иначе теряется sessionStorage-credential) | e2e-mock/placement-print.spec.ts | Verified |


## Архив дела закрытого ОМ (Этап 27)

| Что проверяется | Где | Статус |
| --- | --- | --- |
| Дело открыто ТОЛЬКО у стадии CLOSED; иначе — названная причина, без содержимого | lib/archiveCase.test.ts, pages/SecurityEventArchivePage.test.tsx, e2e-mock/security-event-approval-to-closure.spec.ts | Verified (красная проба: `isArchiveOpen → true` краснит) |
| Read-only: ни кнопки, ни поля, ни селекта в теле дела (ссылки — можно) | SecurityEventArchivePage.test.tsx, e2e-mock (локатор сужен до `<main>`) | Verified (красная проба: `<button>` в Panel краснит) |
| Осиротевшее назначение (пост удалён из расчёта) показано, потребность не выдумана (`need: null`) | archiveCase.test.ts, SecurityEventArchivePage.test.tsx | Verified (красная проба: отключение ветки краснит оба уровня) |
| Замены §9.11 и журнал штаба — разные разделы, каждая запись ровно в одном | archiveCase.test.ts, e2e-mock | Verified |
| Направление расчёта без итога закрытия названо явно; пустой сектор не считается направлением | archiveCase.test.ts | Verified |
| Оценки участников не получают числа вовсе (`count: null`, не `0`) | archiveCase.test.ts | Verified |
| Пустые разделы объясняют причину, а не показывают голый ноль | archiveCase.test.ts | Verified |
| Потребность и назначено — два независимых числа (не «X из Y») | archiveCase.test.ts | Verified |
| Вход в архив есть в шапке ТОЛЬКО у закрытого ОМ | e2e-mock/security-event-approval-to-closure.spec.ts | Verified |
| Гейт `ops.security_event.view` на маршруте | src/app/smart-josparlau-routing.qa.test.tsx (ROUTE_MATRIX) | Verified |
| Мероприятие не найдено (404) — отказ с возвратом в реестр | SecurityEventArchivePage.test.tsx | Verified |


## Версии паспорта объекта (Этап 28)

| Что проверяется | Где | Статус |
| --- | --- | --- |
| Публикация делает снимок действующей редакции с номером/датой/автором/примечанием (trim) | features/objects/mocks/repository.test.ts | Verified |
| §8.10 версия неизменяема: правка паспорта после публикации снимок не трогает | repository.test.ts, e2e-mock/objects-passport.spec.ts | Verified (ручная browser-QA на живых данных тоже) |
| §8.10 не более одной версии на дату; вторая дата → следующий номер и другой id | repository.test.ts, e2e-mock (ассерт `alert` предварён проверкой «до повтора alert'ов нет») | Verified (красная проба) |
| Дата строго `YYYY-MM-DD` (`''`/`01.08.2026`/`2026-8-1` отклоняются) | repository.test.ts | Verified |
| Паспорт без единого поста публиковать нечего | repository.test.ts | Verified |
| Без `ops.object.manage` — отказ, история не тронута; несуществующий объект → 404 | repository.test.ts | Verified |
| Страница версии показывает СНИМОК, а не действующую редакцию | ObjectPassportVersionPage.test.tsx, e2e-mock | Verified (красная проба) |
| Страница версии read-only: ни кнопки, ни поля | ObjectPassportVersionPage.test.tsx, e2e-mock (локатор сужен до `<main>`) | Verified |
| Чужой `versionId` — названная причина, а не пустая страница | ObjectPassportVersionPage.test.tsx | Verified |
| Deep link переживает перезагрузку | e2e-mock/objects-passport.spec.ts | Verified |
| Гейт `ops.object.view` на маршруте версии | src/app/smart-josparlau-routing.qa.test.tsx | Verified |

**Известное ограничение метода** (задокументировано и в коде): глубокая копия снимка в `publishPassportVersion` тестом НЕ доказывается — сегодня `updatePassport` заменяет `sectors` целиком, поэтому проба «снимок по ссылке» остаётся зелёной. Копия — второй гард на будущее, не проверяемый инвариант.


## NEXT ACTION
E2E теперь покрывает ВЕСЬ жизненный цикл ОМ (все 9 стадий, 4 спеки), personnel (включая клавиатурную навигацию вкладок), objects, dictionaries, calendar, audit, analytics, duties (индивидуальные + боевые группы: потребность→подача→рассмотрение→ознакомление→заступление→факт→замена), плюс сквозной axe-core аудит всех экранов и skip-to-content каркаса — 19 e2e-mock спек + 63 прод e2e, ноль экранов без хотя бы одного e2e-прохода. Весь §24-конвейер боевых групп достижим целиком из UI. Accessibility: ручной аудит + клавиатурная навигация + количественный contrast/ARIA-аудит + skip-to-content (четыре слоя, все закрыты, стабильно на 3 прогонах подряд). Оставшиеся Not started пункты (передача смены §24.22 — частично реализована как checkpoint, Conflict Repository, формальный revision, месячное планирование дежурств, уведомления, оперативный профиль данные, tablet/Firefox) — не экраны с существующей реализацией, а нереализованный функционал; решение о следующем направлении — за пользователем.

## Этап 29 — §9.6 привязка к версии паспорта

| Что проверяем | Уровень | Файл |
|---|---|---|
| Выбор версии, действующей на бизнес-дату (в т.ч. публикация задним числом — выигрывает больший номер, а не последняя в массиве) | unit (env node) | `features/security-events/lib/passportBinding.test.ts` |
| Снимок привязки не следует за переименованием объекта | unit | там же |
| `create()` на несуществующий объект → полевая ошибка, а не битая ссылка | unit | `features/security-events/mocks/repository.test.ts` |
| Объект без опубликованного паспорта / дата раньше `effectiveFrom` → ОМ создаётся, привязка `null` | unit | там же |
| Публикация новой версии помечает привязку устаревшей, НЕ трогая ОМ | unit | там же |
| Импорт: право, стадия, отсутствие привязки, дедупликация, `need: 1`, ручные строки не затираются | unit | там же |
| Импорт НЕ пишет в чужой слайс `objects` (снимок слайса до/после побайтно) | unit | там же |
| Правка импортированной строки не рвёт `sourcePostId` (проверка ИЗ БД, не из ответа) | unit | там же |
| Порядок builder'ов сида значим; все три исхода привязки присутствуют в demo-сиде; детерминизм | unit | `app/mocks/compose-seed.test.ts` |
| Все три состояния привязки на экране словами; импорт → правка → reload → расстановка с меткой «из паспорта» | e2e | `e2e-mock/security-event-passport-binding.spec.ts` |

**Красные пробы (6)**: замена расчёта вместо добавления ✓, снятая дедупликация ✓,
`stale` захардкожен в false ✓, запись в чужой слайс ✓, потеря `source*` в
MSW-нормализаторе (e2e) ✓, перестановка builder'ов ✓. Седьмая — «взять последнюю
подходящую версию вместо максимальной по номеру» — осталась ЗЕЛЁНОЙ и вскрыла
вакуумный тест; исправлен тест (кейс публикации задним числом), не код.

## Этап 30 — §9.6 привязка дежурства к версии паспорта

| Что проверяем | Уровень | Файл |
|---|---|---|
| Выбор версии на дату дежурства: максимум по номеру, граница `effectiveFrom` включительно, `null` до первой публикации | unit (env node) | `features/duties/lib/passportBinding.test.ts` |
| `bindDutyPost` снимает sectorId/postId и возвращает `null`, если пост/сектор в ЭТОЙ версии отсутствует | unit | там же |
| `firstPostOfVersion` пропускает пустой сектор; `null`, когда постов нет | unit | там же |
| `passportStatuses` — по одной записи на строку, порядок совпадает с `results` | unit | `features/duties/mocks/repository.test.ts` |
| Публикация более новой версии → `stale: true`, снимок дежурства НЕ переписан | unit | там же |
| Версия, вступающая в силу позже даты дежурства, не считается действующей | unit | там же |
| Объект вне реестра / объект без версий — разные статусы, устаревания нет | unit | там же |
| Переходы дежурства НЕ пишут в чужой слайс `objects` (снимок до/после побайтно) | unit | там же |
| Сид: привязка ссылается на реальные объект/версию/сектор/пост; все три исхода присутствуют | unit | `app/mocks/compose-seed.test.ts` |
| Колонка «Пост по паспорту»: снимок, предупреждение об устаревшей версии, три причины отсутствия, отсутствующий статус | jsdom | `features/duties/pages/DutyPlanPage.test.tsx` |
| Три исхода на живом экране; публикация версии 2 через UI объектов → предупреждение, пост прежний | e2e | `e2e-mock/duty-passport-binding.spec.ts` |

**Красные пробы (3)**: `stale` захардкожен в `false` ✓ (упал тест устаревания),
сид никогда не привязывает ✓ (упали оба сид-теста), ячейка привязки убрана из строки
✓ (упали все 6 jsdom-тестов).

## Этап 31 — месячный план дежурств (§21.27-21.30, §21.34-21.35)

| Проверка | Уровень | Файл |
|---|---|---|
| Дни месяца: 31/28/29 (високосный), границы месяца | unit (env node) | `features/duties/lib/monthlyPlan.test.ts` |
| Сдвиг дня через границу месяца и года, расстояние в сутках | unit | там же |
| Валидация месяца `YYYY-MM` (13-й месяц, однозначный, пустой) | unit | там же |
| Два дежурства сотрудника в один день → HARD независимо от вида дежурства | unit | там же |
| Severity отдыха берётся из `restPolicy` вида: HARD_BLOCK→HARD, SOFT_OVERRIDE→SOFT | unit | там же |
| Сутки паузы закрывают требование `restAfterMinutes=1440` | unit | там же |
| Вид дежурства вне реестра отдыха не навязывает (24 часа не выдумываются) | unit | там же |
| KPI считаются по всему месяцу; смены соседних месяцев в сетку не попадают | unit | там же |
| Конфликт на стыке месяцев виден в месяце ВТОРОГО дежурства и не дублируется в первом | unit | там же |
| Пустой месяц: пустые строки, нулевые KPI, дни всё равно перечислены | unit | там же |
| `unavailableMetrics` названы с причиной, а не нулём | unit | там же |
| `getMonthlyPlan()` требует `ops.duty.view` | unit | `features/duties/mocks/repository.test.ts` |
| Месяц вне формата → бизнес-ошибка `INVALID_MONTH`, а не пустой план | unit | там же |
| Severity приходит из СОХРАНЁННОЙ политики вида дежурства (HARD_BLOCK vs SOFT_OVERRIDE на одних и тех же сменах) | unit | там же |
| Чтение плана не меняет ревизию состояния | unit | там же |
| KPI печатаются ИЗ ОТВЕТА (сервер сообщает 42 при сетке из одной смены) | jsdom | `features/duties/pages/MonthlyDutyPlanSection.test.tsx` |
| Тот же код конфликта с `severity: SOFT` подписан как soft | jsdom | там же |
| Переключение месяца запрашивает соседний месяц и показывает его данные | jsdom | там же |
| Пустой месяц назван словами; невыводимый показатель показан с причиной | jsdom | там же |
| Живой экран: серверные KPI (10 смен/3 объекта/2 hard/1 soft), обе severity, пустой август, возврат в июль | e2e | `e2e-mock/duty-monthly-plan.spec.ts` |

**Красные пробы (3)**: KPI пересчитан по сетке ✓ (упали jsdom-тест KPI и тест
переключения месяца), severity отдыха захардкожена в `HARD` ✓ (упали unit- и
repository-тесты политики), фильтр месяца снят с `monthShifts` ✓ (упали тесты
границ месяца и пустого месяца).

## Этап 32 — создание индивидуального дежурства (§21.31/§21.33/§21.34)

| Что проверяется | Уровень | Где |
| --- | --- | --- |
| Создание без `ops.duty.manage` — 403 | unit | `features/duties/mocks/repository.test.ts` |
| Смена PLANNED со снимком сектора/поста версии; примечание обрезано; читается ИЗ хранилища | unit | там же |
| Пустое примечание → `null`, не пустая строка | unit | там же |
| `targetType` берётся у вида дежурства, а не из запроса | unit | там же |
| §21.31: красный паспорт + `requiresCurrentPassport` → 422; тот же объект под другим видом создаётся | unit | там же |
| Нет версии на дату / пост не из версии / объект вне реестра / неизвестный вид — ЧЕТЫРЕ разных кода | unit | там же |
| §21.34 HARD: второе дежурство в тот же день — 422 даже с правом обхода и обоснованием | unit | там же |
| §21.34 SOFT: 409 `DUTY_CONFLICT_DETECTED` с `details.conflicts[]`, смена НЕ создана | unit | там же |
| §21.34 SOFT: повтор с override сохраняет смену И обоснование (проверено из хранилища) | unit | там же |
| Обход без `ops.duty.override_rest` — 403; обоснование без конфликта НЕ записывается | unit | там же |
| Уже существовавший конфликт ЧУЖОЙ пары смен не блокирует создание | unit | там же |
| Список объектов формы: три объекта, причина блокировки у каждого своя, посты несут задачу/требования | unit | там же |
| Список объектов требует и корректную дату, и известный вид дежурства | unit | там же |
| §21.33: занятость по РЕАЛЬНЫМ сменам; прошедшее дежурство не «ближайшее»; `unavailableAttributes` непусты | unit | там же |
| Форма не рендерится без `ops.duty.manage` | jsdom | `features/duties/pages/CreateDutyShiftForm.test.tsx` |
| Продолжительность и отдых — ИЗ ВИДА дежурства (720 мин ≠ захардкоженные 24 ч) | jsdom | там же |
| Заблокированный объект остаётся в списке, причина сервера дословно, пост не предлагается, кнопка disabled | jsdom | там же |
| §21.33: занятость кандидата и раскрывающееся «Что подбор не учитывает» | jsdom | там же |
| Тело запроса = снимок сектора/поста выбранной версии (сверка объекта целиком) | jsdom | там же |
| §21.34: 409 открывает ОБЩИЙ ConflictDialog; повтор уходит с `override_reason` И исходным телом | jsdom | там же |
| 422 — текстом формы, диалога обхода НЕ открывает | jsdom | там же |
| Живой экран: причина недоступности зависит от вида дежурства; создание со снимком+примечанием+persist через reload; HARD-отказ; SOFT-обход через диалог | e2e | `e2e-mock/duty-shift-create.spec.ts` |
| axe по РАСКРЫТОЙ форме с выбранным объектом (свёрнутую сканирование `/duties` не видит) | e2e | `e2e-mock/accessibility-axe.spec.ts` |

**Красные пробы (7)**: конфликты без разницы «после−до» ✓, снят гард красного паспорта ✓,
обоснование пишется всегда ✓, `nearestDutyDate` без фильтра по дате ✓, форма сама выводит
доступность объекта вместо серверной причины ✓, отдых захардкожен 24 ч ✓, переменные
мутации обёрнуты в `{ body }` (override уехал бы мимо тела) ✓. Каждая покраснела РОВНО на
одном ожидаемом тесте — ни одна не задела соседей.

## Этап 33 — карточка дежурства (§21.32)

| Что проверяется | Уровень | Где |
| --- | --- | --- |
| `getShiftDetail()` без `ops.duty.view` — 403; несуществующая смена — 404, а не пустая карточка | unit | `features/duties/mocks/repository.test.ts` |
| Согласованный срез: смена, вид дежурства целиком, статус паспорта, непустые `unavailableBlocks` с причинами | unit | там же |
| Вид дежурства вне реестра приходит `null` — сервер не подставляет дефолт | unit | там же |
| Объект вне реестра: `objectKnown: false`, карточка не падает | unit | там же |
| Устаревшая привязка: `stale: true`, снимок поста НЕ переписан | unit | там же |
| §21.34: конфликт с серверной severity (пересечение → HARD) | unit | там же |
| Конфликт отдыха виден смене, В ДЕНЬ которой проявляется, и НЕ виден первой из пары | unit | там же |
| Конфликт ДРУГОГО сотрудника в тот же день в карточку не попадает | unit | там же |
| Карточка — чтение: вызов не поднимает ревизию состояния | unit | там же |
| Шапка: код, вид, дата, состояние; продолжительность ИЗ вида (720 мин ≠ «сутки») | jsdom | `features/duties/pages/DutyShiftDetailPage.test.tsx` |
| §35: недоступные блоки названы с причиной, а не опущены | jsdom | там же |
| §21.34: severity берётся из ответа (пересечение, названное SOFT, печатается «Мягкий») | jsdom | там же |
| Устаревшая версия: предупреждение названо, снимок поста не подменён | jsdom | там же |
| Вид вне реестра назван явно; отдых — «неизвестен», а не 24 ч | jsdom | там же |
| Фактическое участие до заступления — словами, а не нулями | jsdom | там же |
| Без `ops.duty.manage` действий нет; с ним — ровно одно, по состоянию смены | jsdom | там же |
| Завершённая смена действий не предлагает вовсе | jsdom | там же |
| 404 показывает ошибку и выход к плану | jsdom | там же |
| Обход конфликта, сделанный при планировании, виден в карточке | jsdom | там же |
| Действие со страницы вызывает переход и карточка перечитывается | jsdom | там же |
| Живой экран: вход со строки плана, шапка, пост из паспорта, блоки с причиной, возврат к плану | e2e | `e2e-mock/duty-shift-card.spec.ts` |
| Живой экран: жёсткий (пересечение), мягкий (отдых, охраняемый объект) и жёсткий (отдых, собственный объект) | e2e | там же |
| Живой экран: PLANNED→ACKNOWLEDGED→ACTIVE→COMPLETED из карточки + persist через reload | e2e | там же |
| axe по карточке СО СМЕНОЙ, ИМЕЮЩЕЙ КОНФЛИКТ (цветные бейджи severity) | e2e | `e2e-mock/accessibility-axe.spec.ts` |

**Красные пробы (8)**: конфликты без фильтра по сотруднику ✓, без фильтра по дню ✓,
вид дежурства вне реестра подменяется первым из реестра ✓, `stale` захардкожен в false ✓,
карточка сама выводит severity по коду конфликта ✓, продолжительность захардкожена
сутками ✓, недоступные блоки не рендерятся ✓, действия показываются без
`ops.duty.manage` ✓. Каждая покраснела ровно на одном ожидаемом тесте.

## Этап 34 — правка и отмена смены (§21.31)

| Что проверяется | Уровень | Где |
| --- | --- | --- |
| `updateDutyShift()` без `ops.duty.manage` — 403 | unit | `features/duties/mocks/repository.test.ts` |
| Переназначение поста в ТОЙ ЖЕ версии паспорта; дата и вид неизменны; читается из хранилища | unit | там же |
| Смена сотрудника снимает ознакомление и откатывает в PLANNED | unit | там же |
| Правка БЕЗ смены сотрудника ознакомление сохраняет | unit | там же |
| Править начатую и завершённую смену нельзя | unit | там же |
| Пост не из действующей версии — отказ, привязка не подменяется | unit | там же |
| §21.34: правка, создающая пересечение → 422; мягкий конфликт → 409 + override | unit | там же |
| Правка НЕ конфликтует смены самой с собой | unit | там же |
| Правка без конфликта снимает прежнюю пометку обхода | unit | там же |
| Отмена: права, обязательная причина, смена ОСТАЁТСЯ в данных | unit | там же |
| Повторная отмена и отмена начатой смены отклоняются | unit | там же |
| Отменённая смена ОСВОБОЖДАЕТ сотрудника (создание на тот же день проходит) | unit | там же |
| Отменённая выбывает из KPI (`shifts`/`cancelled`, `cancelledCount`), строка объекта остаётся | unit | там же |
| Карточка отменённой смены несёт причину, конфликтов нет | unit | там же |
| Правка и отмена доступны только до заступления | jsdom | `features/duties/pages/DutyShiftDetailPage.test.tsx` |
| Тело правки: сотрудник/сектор/пост/примечание — дата и вид НЕ попадают | jsdom | там же |
| Смена сотрудника у ознакомленной смены предупреждает о снятии ознакомления | jsdom | там же |
| Отмена: кнопка заблокирована без причины, тело несёт причину | jsdom | там же |
| Отменённая смена показывает причину, не предлагает ни действий, ни правки | jsdom | там же |
| Живой экран: отмена → смена в плане с причиной, KPI «Дежурств» −1 и «Отменено» 1, persist через reload | e2e | `e2e-mock/duty-shift-edit.spec.ts` |
| Живой экран: отменённая смена освобождает сотрудника в подборе кандидатов | e2e | там же |
| Живой экран: правка поста + сотрудника, предупреждение и откат состояния | e2e | там же |
| Живой экран: правка с пересечением отклоняется без предложения обхода | e2e | там же |

**Красные пробы (5)**: смена сотрудника не снимает ознакомление ✓, гейт конфликтов не
исключает саму смену ✓ (покраснели ЧЕТЫРЕ теста разом — правка не сохранялась бы вовсе),
отменённая смена продолжает занимать сотрудника ✓, снят state-гейт правки ✓, отменённые
считаются в KPI месяца ✓.

## Этап 35 — матрица доступности по сотрудникам (§21.30)

| Что проверяется | Уровень | Где |
| --- | --- | --- |
| День дежурства — слой DUTY, следующий — хвост обязательного отдыха | unit (node) | `features/duties/lib/monthlyPlan.test.ts` |
| Длина отдыха читается у ВИДА дежурства (3 суток ≠ 1), вид вне реестра отдыха не навязывает | unit | там же |
| Хвост отдыха из предыдущего месяца попадает в первые дни текущего | unit | там же |
| DUTY доминирует над REST в день второй смены подряд | unit | там же |
| Конфликты приходят ГОТОВЫМИ (внешний конфликт, невыводимый из одной смены, попадает в клетку) | unit | там же |
| «Неполные данные» — смена без привязки к версии паспорта | unit | там же |
| Отменённая смена не занимает сотрудника и не тянет хвост отдыха | unit | там же |
| Сотрудник без занятости в месяце строки не получает | unit | там же |
| §35: два невыводимых слоя названы с причиной | unit | там же |
| Матрица рисует СЕРВЕРНЫЕ слои (ответ заведомо расходится с тем, что можно вывести) | jsdom | `features/duties/pages/MonthlyDutyPlanSection.test.tsx` |
| Переключение представлений НЕ делает второго запроса за месяцем | jsdom | там же |
| Живой экран: четыре слоя видны и СКЛАДЫВАЮТСЯ в подписи; два невыводимых названы | e2e | `e2e-mock/duty-employee-matrix.spec.ts` |
| Живой экран: отменённая смена исчезает из матрицы вместе с хвостом отдыха | e2e | там же |
| axe по матрице (клетки несут значение цветом — контраст и текстовая альтернатива) | e2e | `e2e-mock/accessibility-axe.spec.ts` |

**Красные пробы (5)**: длина отдыха захардкожена сутками ✓, отдых считается только по
сменам месяца ✓, REST доминирует над DUTY ✓, `incompleteData` захардкожен в false ✓,
отменённые попадают в матрицу ✓.

**Найдено прогонами, не рассуждением**: коллизия имён кнопок (переключатель матрицы
дублировал подписи вкладок страницы) и `scrollable-region-focusable` — прокручиваемую
таблицу нельзя было пролистать с клавиатуры (WCAG 2.1.1), починено в обеих матрицах.

## Этап 36 — список дежурств и история (§21.30)

| Что проверяется | Уровень | Где |
| --- | --- | --- |
| `listShiftList()` без `ops.duty.view` — 403 | unit | `features/duties/mocks/repository.test.ts` |
| ALL: порядок по возрастанию даты, подпись вида из реестра, СЕРВЕРНЫЕ счётчики конфликтов | unit | там же |
| Бизнес-дата приходит В ОТВЕТЕ (экран не берёт её из часов машины) | unit | там же |
| HISTORY: только COMPLETED И прошедшая дата; свежие первыми; сегодняшняя завершённая НЕ попадает | unit | там же |
| Отменённая смена видна в списке с причиной, но в историю не попадает | unit | там же |
| Отсутствие привязки к паспорту — `null`, а не пустая строка | unit | там же |
| Список — чтение: вызов не поднимает ревизию | unit | там же |
| Живой экран: выводимые колонки, «Пост вне паспорта», серверный счётчик конфликтов, переход в карточку | e2e | `e2e-mock/duty-shift-list.spec.ts` |
| Живой экран: завершённая СЕГОДНЯ смена в историю не попадает; пустая история объяснена словами | e2e | там же |
| axe по списку | e2e | `e2e-mock/accessibility-axe.spec.ts` |

**Красные пробы (4)**: история не требует завершённого факта ✓ (покраснели ДВА теста),
не требует прошедшей даты ✓, идёт по возрастанию вместо «свежие первыми» ✓, счётчики
конфликтов захардкожены нулём ✓.

## Этап 37 — KPI реестра объектов (§21.7)

| Что проверяется | Уровень | Где |
| --- | --- | --- |
| Срок = дата публикации + интервал ПОЛИТИКИ; ответ несёт её версию | unit (node) | `features/objects/lib/passportFreshness.test.ts` |
| Смена политики меняет и срок, и состояние — период не захардкожен | unit | там же |
| **90 дней НЕ порог**: при интервале 120 паспорт 100-дневной давности не просрочен | unit | там же |
| DUE_SOON — доля интервала; день срока ещё не просрочка, следующий уже | unit | там же |
| Без публикаций — отдельное состояние, а не «просрочен» | unit | там же |
| Срок отсчитывается от ПОСЛЕДНЕЙ публикации | unit | там же |
| KPI считаются по всему реестру; просрочка и «не публиковался» различаются | unit | там же |
| Экран печатает СЕРВЕРНЫЕ агрегаты (ответ заведомо расходится с числом строк) | jsdom | `features/objects/pages/ObjectsListPage.test.tsx` |
| Срок и версия политики — из ответа, а не из «90 дней» | jsdom | там же |
| Клик по KPI фильтрует, повторный снимает; KPI при фильтре не пересчитываются | jsdom | там же |
| §35: невыводимые KPI названы с причиной | jsdom | там же |
| Живой экран: 5 объектов, четыре состояния актуальности, политика названа | e2e | `e2e-mock/objects-kpi.spec.ts` |
| Живой экран: фильтр в URL переживает reload; сброс фильтра | e2e | там же |
| Живой экран: публикация новой версии переводит просроченный в «срок соблюдён» | e2e | там же |

**Красные пробы (4)**: период захардкожен 90 днями ✓ (свалила ПЯТЬ тестов), срок от
первой публикации вместо последней ✓, «не публиковался» схлопнут в «просрочен» ✓, KPI
считает только объекты с публикациями ✓.

**Найдено e2e, не рассуждением**: состояние паспорта и его актуальность назывались
ОДНИМ словом «Актуален» в соседних колонках (§21.5 это прямо запрещает) — актуальность
переименована в «Срок соблюдён».

## Этап 38 — lifecycle месячного плана (§21.27) и шапка плана (§21.28)

| Что проверяется | Уровень | Где |
|---|---|---|
| Отпечаток плана не зависит от порядка смен, меняется от ПРАВКИ и от отмены | node | `features/duties/lib/planLifecycle.test.ts` |
| Смены соседнего месяца в отпечаток не входят | node | там же |
| Жёсткий конфликт валит проверку, мягкий — нет | node | там же |
| Все шесть действий возвращаются всегда, у каждого недоступного есть причина | node | там же |
| Причина «нет права» не подменяется причиной «нет плана» | node | там же |
| Экспорт недоступен по нереализованности, а не по правам (совпадает при любых правах) | node | там же |
| Утверждение требует ops.duty.approve_plan, а не ops.duty.manage | unit | `mocks/repository.test.ts` |
| Новую редакцию открывает утверждающий, не планировщик | unit | там же |
| Проверка НЕ меняет `stateCode`: состояния только DRAFT/APPROVED | unit | там же |
| Утверждение без проверки / по протухшей проверке / с жёсткими конфликтами — отказ | unit | там же |
| Смена соседнего месяца проверку НЕ обесценивает | unit | там же |
| Утверждённый месяц: create/update/cancel закрыты `PLAN_APPROVED_LOCKED` | unit | там же |
| Ознакомление и заступление в утверждённом месяце ОСТАЮТСЯ доступны | unit | там же |
| Соседний месяц утверждением не закрывается | unit | там же |
| Новая редакция: revision+1, утверждение снято, проверка сброшена, месяц снова открыт | unit | там же |
| История только дополняется, событие помнит СВОЮ редакцию | unit | там же |
| Действия над несформированным планом → 404, план молча не создаётся | unit | там же |
| `INVALID_MONTH` у всех четырёх действий | unit | там же |
| Шапка: доступность действий зависит от прав актора | unit | там же |
| Шапка: источник объектов различает объекты реестра и вне его | unit | там же |
| Экран печатает доступность ИЗ ОТВЕТА (ответ противоречит состоянию — экран слушает ответ) | jsdom | `pages/MonthlyDutyPlanSection.test.tsx` |
| Причина недоступности видна ТЕКСТОМ у каждого закрытого действия | jsdom | там же |
| Месяц без плана: «черновик не сформирован», редакция «—» | jsdom | там же |
| Черновик шлёт месяц ЭКРАНА, а не месяц машины | jsdom | там же |
| «Добавить дежурство» уводит к форме, а не шлёт мутацию | jsdom | там же |
| Живой экран: закрытые действия с причинами, «Сформировать план» на экране нет | e2e | `e2e-mock/duty-plan-lifecycle.spec.ts` |
| Живой экран: июль — проверка не пройдена (2 жёстких), утверждение закрыто, переживает reload | e2e | там же |
| Живой экран: август — черновик→проверка→утверждение→замок формы→новая редакция→история | e2e | там же |

**Красные пробы (7)**: отпечаток без `updatedAt` ✓, замок снят с отмены смены ✓, замок
распространён на ознакомление/заступление ✓, экран сам выводит доступность кнопки ✓,
новая редакция переносит прежнюю проверку ✓, утверждение не проверяет свежесть проверки ✓,
утверждение за `ops.duty.manage` вместо своего права ✓ (свалила 10 тестов).

**Найдено прогоном, не рассуждением**: (1) подпись поля «Редакция» встречается и в
причинах недоступности — значение пришлось сделать адресуемым по имени (`role="group"`,
паттерн карточек KPI), иначе локатор ловил три элемента; (2) причина «нет Employee Status
Repository» теперь звучит в ДВУХ местах экрана (слои матрицы §21.30 и поле шапки §21.28) —
ассерт чужой спеки пришлось сузить до своего блока; (3) `getByText('Утверждён')` в
Playwright — подстрока, ловит и «План утверждён» в истории, и «Утвердить план» на кнопке:
статусные подписи только `exact`.

## Этап 39 — sensitive identity личного состава (§20.27/§20.28/§20.33)

| Что проверяется | Уровень | Где |
|---|---|---|
| Маска оставляет ровно четыре цифры и НЕ выдаёт длину значения | node | `features/personnel/lib/identity.test.ts` |
| Значение короче хвоста не показывается вовсе | node | там же |
| Пустая цель, пробелы и «-» целью не являются | node | там же |
| Срок полномочия конечен и истекает ровно на границе | node | там же |
| Ответ реестра НЕ содержит полного ИИН — проверяется сам payload | unit | `mocks/repository.test.ts` |
| Карточка тоже отдаёт только маску | unit | там же |
| `canRevealIin` приходит в ответе и зависит от актора | unit | там же |
| Право видеть карточку НЕ даёт права раскрыть | unit | там же |
| Раскрытие без содержательной цели отклоняется | unit | там же |
| Запись журнала не содержит значения ни целиком, ни хвостом | unit | там же |
| Отказ не оставляет записи (success audit не пишется до успеха) | unit | там же |
| Журнал читается по своему праву: раскрывающий не видит, контролёр не раскрывает | unit | там же |
| Журнал одного сотрудника не показывает обращения к другому | unit | там же |
| Журнал переживает чтение (лежит в хранилище), чтение не поднимает ревизию | unit | там же |
| По умолчанию на экране только маска | jsdom | `pages/IdentitySection.test.tsx` |
| Без права — кнопка выключена, причина видимым текстом | jsdom | там же |
| Отказ по цели показан, значение не появилось | jsdom | там же |
| Раскрытое значение НЕ продублировано в `title`/`aria-label`/URL/storage | jsdom | там же |
| «Скрыть» убирает значение из DOM целиком | jsdom | там же |
| Истёкшее полномочие стирает значение само, без действий пользователя | jsdom | там же |
| 403 журнала объяснён своим правом, а не выдан за «обращений не было» | jsdom | там же |
| Живой экран: полного ИИН нет в сетевом ОТВЕТЕ реестра | e2e | `e2e-mock/personnel-identity.spec.ts` |
| Живой экран: цель → значение со сроком → «Скрыть» → нет нигде; журнал переживает reload | e2e | там же |
| Живой экран: persona-контролёр видит маску и причину, раскрыть не может | e2e | там же |

**Красные пробы (9)**: проекция несёт полный ИИН ✓, журнал пишет значение в payload ✓,
аудит пишется до проверки цели ✓, гард истечения снят ✓, значение продублировано в
`title` ✓, право журнала схлопнуто с правом раскрытия ✓ (свалила 6 тестов), маска выдаёт
длину значения ✓, истечение считается по часам клиента ✓ (e2e), журнал не инвалидируется
после раскрытия ✓ (e2e).

**Найдено прогонами, не рассуждением**: (1) путь `/api/ops/personnel/` УЖЕ занят ростером
кандидатов в `features/security-events` — MSW отдаёт первый совпавший handler, и экраны
личного состава молча получали чужой ответ; (2) срок полномочия считает DemoClock, а
истечение проверялось часами машины — расхождение шкал объявляло только что выданное
полномочие истёкшим; лечится отсчётом от момента получения ответа; (3) журнал не
обновлялся после раскрытия — не было инвалидации.

## Этап 40 — отчётный реестр службы (§22.18-22.25, §20.32)

| Что проверяется | Уровень | Где |
|---|---|---|
| Обычный экспорт не содержит исключённых полей — ни значений, ни КОЛОНОК | node | `features/service-reports/lib/reporting.test.ts` |
| Sensitive export включает их вместе с колонками | node | там же |
| Примечание с `;` не разваливает строку CSV | node | там же |
| Границы периода включительные с обеих сторон; один день — один день | node | там же |
| Размер в БАЙТАХ, а не в символах; контрольная сумма детерминирована | node | там же |
| Доступность считается по `expiresAt` артефакта | node | там же |
| Право запускать отчёт НЕ даёт права на sensitive export | unit | `mocks/repository.test.ts` |
| Отсутствие sensitive-права не подменяется ошибкой периода | unit | там же |
| Глубина периода ограничена политикой отчёта (предел и предел+1) | unit | там же |
| Работа создаётся PENDING: ни артефакта, ни прогресса | unit | там же |
| PENDING → PROCESSING → COMPLETED, артефакт приходит с COMPLETED | unit | там же |
| Идемпотентность: тот же ключ не создаёт вторую работу; другой — создаёт | unit | там же |
| Завершённая работа не пересчитывается опросом (артефакт immutable) | unit | там же |
| В реестре НЕТ содержимого артефакта и ссылки на файл | unit | там же |
| Отчёт берёт только строки периода; генерация не меняет чужой слайс `duties` | unit | там же |
| Скачивание повторно проверяет право, в том числе sensitive | unit | там же |
| Истёкший артефакт не отдаётся и помечен `unavailableReason: EXPIRED` | unit | там же |
| До COMPLETED экран не показывает ни метаданных, ни кнопки скачивания | jsdom | `pages/ServiceReportsPage.test.tsx` |
| Метаданные и версии политик печатаются из ответа | jsdom | там же |
| Срок хранения из ответа, «30 дней» на экране нет | jsdom | там же |
| Недоступный артефакт: причина названа, кнопка выключена | jsdom | там же |
| Без права sensitive флажок выключен, причина видима | jsdom | там же |
| Ключ идемпотентности зависит от параметров запроса | jsdom | там же |
| Живой экран: работа доходит до готовности; в ответах реестра нет ни файла, ни ссылки | e2e | `e2e-mock/service-reports.spec.ts` |
| Живой экран: обычная выгрузка без примечания, sensitive — с ним | e2e | там же |
| Живой экран: persona без права не может включить sensitive export | e2e | там же |

**Красные пробы (8)**: маскирование выключено ✓, содержимое едет в проекции списка ✓,
идемпотентность выключена ✓, работа создаётся сразу COMPLETED ✓ (свалила 5 тестов),
скачивание не перепроверяет sensitive-право ✓, срок хранения захардкожен 30 днями ✓,
артефакт пересчитывается на каждом опросе ✓, маскирование выключено на живом прогоне ✓ (e2e).

**Вакуумность, пойманная до написания ассерта**: в demo-сиде дежурств у ВСЕХ смен
`note: null` — проверка «в выгрузке нет примечания» была бы пустой. Спека сама заводит
смену с примечанием через UI и только потом формирует отчёт; в выгрузке проверяется, что
СТРОКА есть, а примечания нет.


## Этап 41 — история отчётов (§22.25)

| Слой | Файл | Что закреплено |
| --- | --- | --- |
| Модель (node) | `features/service-reports/lib/reporting.test.ts` | номер редакции по МАКСИМУМУ серии, режим выгрузки как часть ключа серии, пригодность артефакта для повтора (последняя редакция, не истёкшая, своя серия), матрица действий строки с причиной на каждый отказ |
| Repository | `features/service-reports/mocks/repository.test.ts` | невидимость sensitive-работ и их артефактов; 404 (не 403) на повтор невидимой работы; фильтры state/mine считает сервер; продвижение идёт и для скрытых фильтром работ; повтор при пригодном артефакте не создаёт работу; новая редакция создаёт всегда и получает следующий номер; автор повтора — повторивший; сбой сборки = FAILED с безопасным сообщением, реестр остаётся читаемым |
| Экран (jsdom) | `features/service-reports/pages/ReportHistoryPage.test.tsx` | доступность действий берётся ИЗ ОТВЕТА (подсунут ответ, противоречащий состоянию работы), причина отказа на кнопке, редакция из артефакта либо прочерк, раскрытие параметров и безопасного текста ошибки, фильтр уезжает в запрос и восстанавливается из URL, разные сообщения для «нет по фильтру» и «ещё не запускали» |
| E2E (mock) | `e2e-mock/service-reports-history.spec.ts` | повтор не создаёт вторую работу, новая редакция создаёт и доходит до номера 2; фильтр живёт в URL и переживает перезагрузку; sensitive-работа невидима persona без права — ни на экране, ни в ответе сервера |
| A11y | `e2e-mock/accessibility-axe.spec.ts` | экран запуска отчёта и история СО СТРОКОЙ и раскрытыми параметрами (пустая история не содержит ни таблицы, ни кнопок — покрытие было бы мнимым) |

**Красные пробы (10, все покраснели)**: жёсткая единица вместо номера серии ✓,
sensitive-работы видны всем ✓, номер редакции по количеству вместо максимума ✓,
ступень выполняется только для показанных строк ✓, сбой сборки летит исключением и
роняет чтение реестра ✓, повтор игнорирует пригодный артефакт ✓, новая редакция
переиспользует готовый артефакт ✓, экран выводит доступность действий из состояния
работы ✓, фильтр «только мои» не применяется сервером ✓, одно сообщение на «нет работ»
и «нет по фильтру» ✓.

**Найдено прогонами, не рассуждением**: (1) `getByText('Ошибка')` неоднозначен — то же
слово подписывает вариант фильтра состояний, статусные подписи адресуются внутри строки
(тот же класс, что дубли подписей Этапов 35-38); (2) `seedCredential` — init-скрипт и
переустанавливает demo-admin на КАЖДОЙ навигации, поэтому смена persona в середине спеки
делается вторым `addInitScript`, а не `evaluate` + reload (иначе права молча возвращаются).

## Этап 42 — карточка работы отчёта (§22.27) и параметры чужого запуска (§22.26)

| Слой | Файл | Что закреплено |
| --- | --- | --- |
| Модель (node) | `features/service-reports/lib/reporting.test.ts` | чужой запуск закрывает И параметры, И файл, но РАЗНЫМИ причинами (файл — не «сроком хранения», а тем, что период написан в первой строке); повтор при этом остаётся доступен |
| Repository | `features/service-reports/mocks/repository.test.ts` | карточка перепроверяет право сама; невидимая и несуществующая работа отвечают ОДИНАКОВО; карточка доводит работу до готовности своим чтением, не дожидаясь реестра; параметров чужого запуска нет НИ В ОДНОМ поле ответа (ассерт по `JSON.stringify` всего ответа, а не по знакомым полям); право на чужие параметры НЕ заменяет право на скрытые поля; скачивание чужого артефакта закрыто на СЕРВЕРЕ, и тут же проверено, что период в файле действительно есть — иначе запрет был бы декоративным |
| Экран (jsdom) | `features/service-reports/pages/ReportJobPage.test.tsx` | закрытых данных нет В DOM (ассерт по `document.body.innerHTML`); ответ в тесте НАМЕРЕННО несёт «забытый» `idempotencyKey` с периодом внутри — проверяется структурное свойство разметки, а не аккуратность ответа; отказ — весь экран, состояния и автора на нём нет; доступность действий из ответа; статический `/service-reports/history` не читается как работа с таким id |
| E2E (mock) | `e2e-mock/service-report-job-card.spec.ts` | прямая ссылка без единого перехода по реестру (идентификатор берётся из ответа на создание); смена persona вторым `addInitScript`; отсутствие периода проверяется И в DOM, И в ПРИНЯТЫХ телах ответов |
| A11y | `e2e-mock/accessibility-axe.spec.ts` | карточка сканируется у ГОТОВОЙ работы — у незавершённой нет ни метаданных артефакта, ни включённых кнопок |

**Красные пробы (9, все покраснели)**: параметры не вырезаются ✓, ключ идемпотентности не
вырезается ✓, снимок параметров артефакта не вырезается ✓, скачивание чужого не
перепроверяется на сервере ✓, карточка не 404-ит невидимую работу ✓, карточка не продвигает
работу ✓, чужой запуск не закрывает скачивание ✓, ключ печатается вне ветки «параметры
видны» ✓, и та же первая проба на живом e2e ✓.

## Этап 43 — серверный снимок аналитики службы (§22.3-22.7) и drill-down (§22.12)

| Слой | Файл | Что закреплено |
| --- | --- | --- |
| Модель (node) | `features/service-analytics/lib/analytics.test.ts` | пороги включают границу, показатель без порогов всегда NORMAL, `UNKNOWN` не подменяется зелёным и не даёт раскрытия; конфликт принадлежит ВТОРОЙ смене пары, severity берётся у вида дежурства, смена в обоих наборах остаётся ЖЁСТКОЙ; отдых округляется вверх и идёт после смены; просрочка считается СТРОГО до бизнес-даты; `snapshotId` детерминирован входом и меняется от периода И от версии данных |
| Repository | `features/service-analytics/mocks/repository.test.ts` | право на дашборд НЕ даёт раскрытия (проверка на сервере, а не в подсказке кнопки); строки не едут с KPI (ассерт по всему телу ответа); отсутствие источника → `null`+`UNKNOWN`, и раскрыть такой показатель нельзя даже с правом; период режет выборку; произвольный период проверяет сервер (формат, порядок дат, глубина); курсорные страницы не пересекаются; чужой и «другопериодный» `snapshotId` отвергаются; ФИО вырезано из ВСЕГО ответа, и тут же проверено, что с правом оно приходит — иначе проверка была бы пустой; аналитика не меняет чужой слайс дежурств |
| Экран (jsdom) | `features/service-analytics/pages/ServiceAnalyticsPage.test.tsx` | ответ НАМЕРЕННО противоречит числу (`value: 0`, `state: CRITICAL`) — экран обязан послушаться ответа; печатается `displayValue` строкой, а не отформатированное экраном число; строк нет до нажатия и запроса не было; `snapshot_id` и `metric_code` едут в запросе выборки; период из URL не подменяется дефолтом |
| E2E (mock) | `e2e-mock/analytics.spec.ts` (переписан) | тела ответов KPI не содержат ни ФИО, ни `rowId`; выборка запрашивается только по нажатию; persona `demo-analyst` получает строки БЕЗ сотрудника, и это проверено принятыми телами ответов, а не только экраном; период переживает перезагрузку, «Сбросить» возвращает серверный дефолт |

**Красные пробы (8, все покраснели)**: отсутствие источника даёт ноль вместо UNKNOWN ✓,
строки едут вместе с KPI ✓, `snapshotId` не сверяется ✓, ФИО не вырезается без права ✓,
drill-down не требует своего права ✓, глубина произвольного периода не проверяется ✓,
severity конфликта занижается ✓, пороги игнорируются ✓.

## §28 «Обратная связь» (Этап 47)

| Слой | Файл | Что закреплено |
|---|---|---|
| Repository | `features/feedback/mocks/repository.test.ts` (33) | чужой черновик не открывается правом `view_all`; содержание конфиденциального вырезано вместе с превью и проверено по ВСЕМУ JSON ответа, а не по знакомым ключам; поиск не находит по вырезанному описанию, но находит его же у того, кому оно видно; сводка считается по видимому набору, а не по фильтру и не по странице; порядок при равном времени задаёт id (три записи, уложенные в обратном порядке); техинформация без согласия не сохраняется даже присланная в теле; вложение сохраняется тремя полями; чужое обращение — 404, а не «уже отправлено» |
| Компонент | `features/feedback/pages/FeedbackPage.test.tsx` (16) | сводка берётся из ответа (42 при одной строке); подписи печатаются серверные, привычной нет НИГДЕ; закрытое содержание не попадает в DOM, печатается причина; страницы следуют серверным `page`/`pageCount`; фильтр возвращает на первую страницу; отметка времени техинформации — серверная |
| E2E (mock) | `e2e-mock/feedback.spec.ts` (5) | обращение заводится формой; черновик отправляется отдельным действием и теряет кнопку; содержание чужого конфиденциального не приезжает в браузер — проверено ПО ТЕЛАМ ответов; поиск по вырезанному слову ничего не находит; чужой черновик невидим wildcard-персоне |

**Красные пробы (11, все покраснели, одна — на живом e2e)**: содержание видно всем ✓,
превью не вырезается вместе с описанием ✓, поиск идёт по вырезанному ✓, чужой черновик
открывается `view_all` ✓, техинформация сохраняется без согласия ✓, вложение копируется
целиком ✓, сводка считается по фильтру ✓, отправить можно чужое ✓ (**сначала осталась
ЗЕЛЁНОЙ — дублирующий гард: проверка статуса отказывала и сама, но её отказ назвал бы
состояние чужой записи; добавлен тест, закрепляющий 404 как единственного владельца отказа**),
порядок без tie-breaker ✓, время с часов машины ✓, описание едет в ответе всегда (живой e2e) ✓.

## §28 detail — карточка обращения (Этап 48)

| Слой | Файл | Что закреплено |
|---|---|---|
| Repository | `features/feedback/mocks/repository.test.ts` (+21, всего 54) | внутренняя заметка не приезжает ни автору, ни разбирающему без права — ни комментарием, ни событием ленты, ни где-либо в JSON; у закрытого обращения недоступны ВСЕ действия и причина у всех ОДНА; допустимые статусы приходят из карты справочника; лента пишется диффом (три изменённых поля — три события с old/new), неизменённое поле события не порождает; закрыть разбором нельзя; дубликат требует видимого закрывающему оригинала и не может указывать на себя; ссылка на оригинал скрывается от смотрящего, которому он не виден |
| Компонент | `features/feedback/pages/FeedbackDetailPage.test.tsx` (12) | доступность действий берётся из ответа (карточка ЗАКРЫТА, но сервер разрешает разбор — экран слушает); поле заметки не рисуется без права; список переходов — серверный (один вариант вместо одиннадцати); терминальные статусы уходят в закрытие, а не в разбор; закрытие не отправляется без ответа; разбор шлёт РОВНО изменённое поле; рабочий приоритет не подменяется заявленным |
| E2E (mock) | `e2e-mock/feedback-card.spec.ts` (4) | разбор дописывает ленту сам (`workingPriorityCode: NORMAL → LOW`); заметка не приезжает автору и разбирающему без права — проверено по телам ответов; закрытие требует ответа, публикует его автору и запирает обращение |

**Красные пробы (11, все покраснели, одна — на живом e2e)**: заметка видна всем ✓, событие
заметки видно всем ✓, замок закрытого не влияет на действия ✓, событие пишется при
неизменённом поле ✓, закрыть можно разбором ✓, карта переходов не учитывает текущий статус ✓,
дубликат без оригинала ✓, тема оригинала без проверки видимости ✓, рабочий приоритет
подменяется заявленным ✓, экран сам выводит статусы из справочника ✓, заметка видна каждому
читателю (живой e2e) ✓.

