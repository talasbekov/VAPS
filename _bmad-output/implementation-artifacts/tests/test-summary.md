# Test Automation Summary — Story 8.3 (кодоген типов из схемы)

Дата: 2026-07-07 · Скилл: bmad-qa-generate-e2e-tests · Модель: Claude Fable 5

## Контекст

Стори 8.3 — тулинг-слой (пайплайн drf-spectacular → schema.yaml →
openapi-typescript → schema.d.ts + двухслойный drift-гейт). UI нет, runtime-эндпоинтов
нет (Д5: CLI-only) → «API-тесты» = контракт схемы-артефакта, «E2E-аналог» =
сквозной самотест чекера + tsc-контракт-проба. Фреймворки проекта: pytest (бэк),
самотест-скрипты node в gate-цепочке (фронт, паттерн `lint-canon.test.mjs`).

## Найденные пробелы покрытия (auto-applied)

1. **Red-пути schema-check.mjs (AC 3/4/5/7) были проверены только руками** (Debug Log
   dev-стори) — регресс чекера давал бы вакуумно-зелёный гейт. Закрыто самотестом.
2. **Контракт-ценность tsc (канон L258, AC6) не была доказана**: «мок, противоречащий
   схеме, не компилируется» нигде не исполнялось. Закрыто tsc-пробами good/bad.
3. **Контент схемы и детерминизм генерации** (Д4 статичная VERSION,
   COMPONENT_SPLIT_REQUEST, покрытие 4 API-контекстов, Ловушка 8) — были
   одноразовой ручной верификацией. Закрыто контент-тестами + determinism-тестом.
4. **Ловушка 2 (.prettierignore)** не имела гварда — потеря записи стреляла бы
   отложенно, при первом `npm run format`. Закрыто ассертом в самотесте.

## Сгенерированные тесты

### API/контракт (бэк, pytest — бегут в `make gate`)

- [x] `Backend/VAPS/apps/core/tests/test_schema_contract.py` — 5 тестов:
  - `test_schema_is_openapi3_with_pinned_identity` — OpenAPI 3.x, title «VAPS API»,
    VERSION статичная «0.1.0» (гвард Д4: динамическая версия = drift на каждый бамп)
  - `test_schema_covers_every_api_context` — по одному пути на каждый из 4 контекстов
    (audit/core/operations/notifications) + happy path: типизированный 200 у
    `GET /api/core/employees/`
  - `test_component_split_request_active` — Employee И EmployeeRequest в components
    (выключение COMPONENT_SPLIT_REQUEST = осознанный mass-drift, не случайность)
  - `test_employee_id_is_uuid_string` — бэк-половина пары к tsc-пробе фронта
  - `test_schema_generation_is_deterministic` — две генерации байт-идентичны
    (Ловушка 8; skipif не-Postgres — зеркало drift-теста)

### E2E-аналог (фронт, node — бежит в `npm run gate`)

- [x] `frontend/scripts/schema-check.test.mjs` — самотест гейт-чекера во временном
  зеркале репо-структуры (реальное дерево не мутируется; symlink node_modules;
  fileURLToPath — кириллица в пути):
  - контроль зелёного: нетронутые артефакты проходят (иначе харнесс сломан)
  - AC3: schema.yaml обновлён (operationId) без regen типов → красный «расходится с fresh-regen»
  - AC4: ручная правка schema.d.ts → красный «расходится с fresh-regen»
  - AC5: headerless schema.d.ts → красный «AUTO-GENERATED-заголовка» (ассерт до regen)
  - AC7 ×2: отсутствие schema.d.ts / пустой schema.yaml → внятные подсказки
    «run: npm run generate:api» / «run: make schema»
  - L258/AC6: tsc-пробы — good (реальный путь `/api/core/employees/` +
    `Employee['id']: string`) компилируется; bad (`id = 12345`) падает ровно TS2322
  - Ловушка 2: `.prettierignore` содержит `src/shared/api/schema.d.ts`
  - Каждый красный сценарий ассертит КОНКРЕТНУЮ подсказку (урок 8.1: «хоть какая-то
    ошибка» — не доказательство)

### Вайринг

- [x] `frontend/package.json` — `schema-check.test.mjs` вставлен в gate-цепочку после
  `lint-canon.test.mjs` (самотесты рядом, дорогой build — последним). Бэк-тесты
  вайринга не требуют (pytest без маркеров = автоматически в `make gate`).

## Прогоны (верификация)

- `node scripts/schema-check.test.mjs` — зелёный, ~2s
- Таргетный pytest (schema_contract + schema_drift, Postgres) — 8 passed
- `make gate` — **1841 passed** (+5 к базе 1836), 33s (бюджет 300s)
- `npm run gate` — все 8 шагов зелёные, бандл 59.4 KB gzip (бюджет 300 KB)

## Покрытие

- AC стори: 7/7 имеют автоматическое исполнение
  (AC1 — drift+контент-тесты обеих половин; AC2 — test_schema_drift + doctored;
  AC3/4/5 — красные сценарии самотеста; AC6 — гейты + tsc-пробы L258; AC7 — гварды
  непустоты бэка/фронта + негативные контроли)
- Красные пути чекера: 5/5 автоматизированы (были 0/5 — только ручной Debug Log)
- Ловушки спеки с постоянным гвардом: 2 (Ловушка 2 prettierignore, Ловушка 8 детерминизм)

## Next Steps

- Обогащение схемы (5 голых ViewSet) — deferred до сторей-потребителей (Д3, 8.4+/E10);
  контент-тесты тогда расширить на честные типы этих операций
- MSW-валидация моков против схемы — 8.4/8.5 (канон L634), не здесь
- CI-wiring обоих гейтов — deferred 8.1 (ci.yml таргетит легаси)
