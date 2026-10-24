---
baseline_commit: 4d9ad410dd4204f89b73fc510ef24ed043d5fcf0
---

# Story 8.4: apiClient и DomainError-парсинг

Status: done

> **Контекст запуска:** четвёртая стори E8; baseline диффа: `4d9ad41` (8.3 закоммичена целиком).
> Первая стори эпика с РАНТАЙМ-кодом в `src/` (до сих пор — тулинг и генерённые артефакты):
> транспортная половина ARCH-FE-015 — свой fetch-клиент (~100 строк) + типизированный парсинг
> конверта §36 в одной точке. Вместе с ней приезжает тестовый фундамент фронта: vitest + MSW
> (канон L258). Стори СТРОГО frontend-only: `Backend/**`, schema.yaml, schema.d.ts не трогаются
> (API-поверхность не меняется — перегенерация не нужна). useApiMutation/ConflictDialog — 8.5;
> auth — 8.6. **Решения (создано в #YOLO-прогоне 2026-07-07):** Q1–Q4 = дефолты Д1–Д8, активны;
> подтвердить у Bratan при запуске dev-story.

## Story

As a разработчик,
I want типизированный apiClient (свой, на fetch): любой не-2xx-ответ превращается в одной точке в типизированный ApiError-union из конверта §36 (`ValidationError` 400-форма / `BusinessRuleError` 422 / `ConflictError` 409 с `overridable` / `ServerError` 5xx и не-конверт / `NetworkError` сетевой сбой),
so that парсинг статусов и конверта ошибок живёт в одной точке (ARCH-FE-015), а `fetch`/`response.status` вне `shared/api` — механически забанены.

## Acceptance Criteria

1. **Given** MSW-хендлер 200 на реальном пути схемы (например, `GET /api/core/employees/`), типизированный через `schema.d.ts` (`paths`-типы — tsc-контракт L258/L634), **When** вызов `apiClient`, **Then** возвращается типизированное тело как есть: snake_case без трансформаций (L429); **Given** ответ 204, **Then** результат `undefined` без попытки `.json()`.
2. **Given** ответ 400 с конвертом §36 (`details` = DRF-ошибки по полям), **Then** клиент бросает `ValidationError`: `instanceof ApiError`, дискриминант `kind`, доступны `status=400`, `errorCode`, `message`, `details`, `requestId`.
3. **Given** ответ 422 с конвертом (например, `BUSINESS_DATE_OUT_OF_WINDOW`), **Then** бросается `BusinessRuleError` (это НЕ ValidationError — см. Д2/Q2).
4. **Given** 409 с кодом из overridable-набора реестра (`STATUS_OVERLAP_WARNING`), **Then** `ConflictError` с `overridable=true` и сохранёнными `details.conflicts`; **Given** 409 с не-overridable кодом (`DAY_ALREADY_SUBMITTED`), **Then** `ConflictError` с `overridable=false`.
5. **Given** ответ 500 с конвертом И ответ 502 `text/html` (nginx, конверта нет), **Then** в обоих случаях `ServerError`, парсер не падает вторичным исключением на не-JSON; **Given** сетевой обрыв (`HttpResponse.error()`), **Then** `NetworkError`.
6. **Given** конвертированные 401/403/404 (и любой прочий не-2xx с конвертом либо без), **Then** бросается базовый `ApiError` с `status` и полями конверта (если конверта нет — `errorCode: null`, message из статуса); ветвление 401→редирект — 8.6, здесь только типизация.
7. **Given** `OVERRIDABLE_CODES` в `errors.ts` разошёлся с множеством `overridable: true` из `docs/registries/error-codes.yaml` (в ЛЮБУЮ сторону), **When** `npm run gate` (vitest), **Then** красный контракт-тест с подсказкой «sync c docs/registries/error-codes.yaml» (Д1).
8. **Given** `fetch(...)`, `window.fetch`/`globalThis.fetch` или `new XMLHttpRequest()` в `src/**` вне `src/shared/api/**`, **Then** eslint красный; краснота ДОКАЗАНА фикстурами lint-canon (урок 8.1/8.2: вакуумный чекер запрещён) + негативный контроль: `fetch` внутри `shared/api` — зелёный; `npm i axios` → deps-gate/eslint красные (категория HTTP-клиентов в banned-packages).
9. **Given** чистый клон (`npm ci`), **Then** `npm run gate` зелёный целиком, `vitest run` встроен в gate-цепочку и падает при 0 собранных тестов (дефолт vitest — не вакуумный шаг); `make gate` бэка не тронут и зелёный.

## Tasks / Subtasks

- [x] Task 1: Тестовый фундамент фронта (AC: 9)
  - [x] `npm i -D vitest@^4.1.10 msw@^2.14.6 yaml@^2.9.0` (registry 2026-07-07; vitest 4 peer vite `^6||^7||^8` — наш 7.3.6 ok; Node 24 ok)
  - [x] `vite.config.ts`: `/// <reference types="vitest/config" />` + блок `test: { environment: 'node', setupFiles: ['./src/shared/api/testing/vitest.setup.ts'] }` (node-env достаточно: fetch нативный; jsdom/RTL — НЕ здесь, 8.5)
  - [x] `package.json`: script `"test": "vitest run"`; gate-цепочка — вставить `vitest run` после `node scripts/schema-check.test.mjs`, перед `vite build`
- [x] Task 2: `src/shared/api/errors.ts` — протокол ошибок (AC: 2–7)
  - [x] Рукописный `ErrorEnvelope` = `{error_code, message, details, request_id, timestamp}` (точная форма — `_envelope()` в `apps/core/api/exception_handler.py`; конверта НЕТ в OpenAPI-схеме → рукописный тип легален, НЕ нарушение ARCH-FE-011 — зафиксировать комментом)
  - [x] Классы: `ApiError extends Error` (база: `kind`, `status`, `errorCode: string | null`, `details`, `requestId`) + сабклассы `ValidationError` (400), `BusinessRuleError` (422), `ConflictError` (409, + `overridable: boolean`), `ServerError` (≥500 и не-конверт), отдельный `NetworkError extends Error` (HTTP-ответа нет); дискриминант `kind` + instanceof — оба канала narrowing
  - [x] `OVERRIDABLE_CODES` (ровно 3 кода `conflict_soft` реестра: `SOFT_CONFLICT_DETECTED`, `STATUS_OVERLAP_WARNING`, `DUTY_CONFLICT_DETECTED`) — источник `overridable` для ConflictError (Д1)
  - [x] `parseErrorResponse(response): Promise<ApiError>` — единственная точка маппинга status→класс; defensive: не-JSON тело (502 HTML), конверт без `error_code`, DRF-native форма непереименованных статусов (405 и пр. — handler их НЕ переформатирует) → не падать, деградировать в базовый `ApiError`/`ServerError`
- [x] Task 3: `src/shared/api/client.ts` — транспорт (AC: 1, 5, 6)
  - [x] ~100 строк (ARCH-FE-011): `get/post/patch/del` с generics; JSON-сериализация; `baseUrl`-опция (дефолт `''` — same-origin через dev-прокси; тестам нужен абсолютный — Ловушка 1); 2xx → `.json()` (204 → `undefined`); не-2xx → `throw await parseErrorResponse(...)`; `TypeError` от fetch → `NetworkError`
  - [x] НИКАКИХ: трансформаций имён (snake_case end-to-end, L429), ретраев (канон §Process: мутации не ретраить), таймаутов через `AbortSignal.timeout` (Ловушка 6), auth-логики (8.6)
- [x] Task 4: MSW-инфраструктура (AC: 1–6)
  - [x] `src/shared/api/testing/handlers.ts`: фикстуры конвертов 400/409×2/422/500 (+ 502 HTML) — тела типизированы `ErrorEnvelope`; 200-фикстура `GET /api/core/employees/` типизирована из `schema.d.ts` (`paths['/api/core/employees/']['get']`… — «мок, противоречащий схеме, не компилируется», L258); поверхность БЕЗ статусных эндпоинтов — 409-overridable фикстура протокольная, на существующем пути (Д8)
  - [x] `src/shared/api/testing/server.ts`: `setupServer(...handlers)` из `msw/node`; `src/shared/api/testing/vitest.setup.ts`: `listen({onUnhandledRequest:'error'})/resetHandlers/close`
- [x] Task 5: Тесты клиента `src/shared/api/client.test.ts` (AC: 1–6)
  - [x] Все ветки: 200 typed, 204, 400→ValidationError, 422→BusinessRuleError, 409→ConflictError (overridable true/false), 500→ServerError, 502 HTML→ServerError без вторичного исключения, network→NetworkError, 401/403/404→базовый ApiError; ассерты на instanceof И kind И поля конверта
- [x] Task 6: Контракт-тест реестра `src/shared/api/errors.test.ts` (AC: 7)
  - [x] Читает `docs/registries/error-codes.yaml` (`yaml.parse`; путь через `fileURLToPath(new URL(...))` — Ловушка 7), строит множество `overridable: true` из `codes`, сравнивает с `OVERRIDABLE_CODES` В ОБЕ СТОРОНЫ; сообщение падения содержит diff и подсказку синхронизации; негативный контроль функции сравнения (doctored-набор детектится) — страховка от вакуумного pass
- [x] Task 7: Enforcement «HTTP только через apiClient» (AC: 8)
  - [x] `eslint.config.js`: новый блок `files: ['src/**/*.{ts,tsx}'], ignores: ['src/shared/api/**']` с `no-restricted-globals` (fetch, XMLHttpRequest) + `no-restricted-properties` (`window.fetch`, `globalThis.fetch`) — месседжи со ссылкой на ARCH-FE-015
  - [x] `scripts/banned-packages.mjs`: новая категория «сторонние HTTP-клиенты (ARCH-FE-015: только свой apiClient)» — `axios`, `ky`, `superagent` (исполнение заявленного в каноне enforcement `no-restricted-imports`, не новая норма; зафиксировать в Dev Record)
  - [x] `scripts/lint-canon.test.mjs`: красные фикстуры — `fetch(...)` в features (`no-restricted-globals`), `window.fetch` (`no-restricted-properties`), `import axios` (`@typescript-eslint/no-restricted-imports`); негативный контроль — фикстура с `fetch` в `src/shared/api/__canon_api_<PID>__/` зелёная (block-scoped `ignores` живы под `ignore:false` — Ловушка 8, доказать)
- [x] Task 8: Красная фаза и верификация (AC: 8, 9)
  - [x] Красные пробы вживую (Debug Log): (а) временный `fetch()` в `src/app/App.tsx` → eslint красный; (б) байт в `OVERRIDABLE_CODES` → vitest красный с подсказкой; (в) сломанная фикстура 200 против schema-типа → tsc красный (contract-канал L258 работает)
  - [x] Чистые прогоны: `npm ci && npm run gate` зелёный; `make gate` (Backend/VAPS) зелёный БЕЗ изменений — стори его не трогает

## Dev Notes

### Архитектурные гварды (обязательны, источник — architecture.md)

- **ARCH-FE-015** (L242/764) — ядро стори: «apiClient → типизированный ApiError… Один хук useApiMutation». Здесь — ТОЛЬКО транспорт+парсинг; useApiMutation/ConflictDialog/тосты — 8.5. MUST NOT: «парсинг response.status вне apiClient» — закрывается eslint-банами (Task 7); «сырой useMutation в features» — правило уже стоит с 8.2 (спит до react-query).
- **ARCH-FE-011** (L238/760): «свой apiClient.ts (~100 строк) + рукописные типизированные хуки». MUST NOT: orval/openapi-generator (в бан-листах) и НЕ вводить `openapi-fetch` (готовый typed-клиент = обход «своего», Д3). Рукописный `ErrorEnvelope` легален: конверт ошибок в OpenAPI-схеме ОТСУТСТВУЕТ (schema.d.ts содержит только 2xx-ответы, проверено грепом) — «ручные типы при наличии схемы» не нарушены.
- **ARCH-FE-010**: никакого стейта в этой стори; клиент — чистые функции/фабрика, без синглтон-кэшей.
- **ARCH-FE-013**: всё в `src/shared/api/**` — элемент `shared`, легален для boundaries; БЕЗ barrel-index (lint-canon скан).
- **snake_case end-to-end** (L429): никаких camelCase-трансформаций в клиенте.
- **Канон §Ошибки (L433-435)**: семантика 400=ФОРМА / 422=БИЗНЕС / 409=КОНФЛИКТ — основание маппинга Д2.
- **L258 (tsc = contract-тест) + L634 (MSW против схемы)**: в этой стори «валидация MSW против OpenAPI» = ТИПИЗАЦИЯ 2xx-фикстур типами schema.d.ts (компилятор — валидатор); runtime-валидация хендлеров — deferred (см. Границы).
- **L440**: MSW-фикстуры в `src/shared/api/testing/`; тесты `*.test.ts` рядом с модулем.
- **Канон §Process (L472)**: мутации не ретраить; loading-флаги — не здесь (Query придёт в 8.5).

### Протокол ошибок (ground truth бэка, baseline 4d9ad41)

- **Конверт §36** (`apps/core/api/exception_handler.py::_envelope`): `{error_code, message, details, request_id, timestamp}`; `details` — ВСЕГДА объект (`None`→`{}`); `request_id` может быть `null`. Форма подтверждена спекой VAPS_7.8.2 §36/§60 (пример L5078).
- **`overridable` В КОНВЕРТЕ НЕТ** — handler его не рендерит (у `DomainError` поле есть, `_envelope` не передаёт). Реестр (`meta` L14): «overridable: true ⇒ … клиент может повторить с override_reason» — знание overridable = знание реестра. Отсюда Д1: клиент выводит его из `OVERRIDABLE_CODES`, синхронизированного контракт-тестом.
- **Не все статусы переформатируются**: `_DRF_STATUS_TO_CODE` покрывает 400/401/403/404; 405/406/415/429 остаются в DRF-native форме (`{"detail": ...}`) — парсер обязан не предполагать конверт (AC 6).
- **400**: `VALIDATION_ERROR`, `details` = DRF-ошибки по полям (сырьё для setError RHF в 8.5). **422**: бизнес-коды (`details` структурные: `conflicts[]`, `employee_id`…). **409**: и overridable (`STATUS_OVERLAP_WARNING` — живой raise в `status_service.py:238` с `detail={"conflicts": ...}`), и НЕ-overridable state-конфликты (`DAY_ALREADY_SUBMITTED` — живой на `POST /api/operations/daily-submissions/`). **500**: `INTERNAL_ERROR` без деталей.
- **Реестр** `docs/registries/error-codes.yaml`: ровно 3 кода с `overridable: true` (категория `conflict_soft`): `SOFT_CONFLICT_DETECTED`, `STATUS_OVERLAP_WARNING`, `DUTY_CONFLICT_DETECTED`. Плюс `conflict_codes` (значения ВНУТРИ `details.conflicts[]`, не HTTP-коды) — клиенту в 8.4 не нужны, не типизировать.

### Фактура фронта (ground truth на baseline)

- **gate-цепочка** (`package.json` — авторитет): `deps-gate → schema-check → tsc -b → eslint . → lint-canon → schema-check.test → vite build → size-gate`. Вставка vitest — после schema-check.test (статика раньше, сборка позже).
- **Тест-раннера НЕТ**; vitest/msw/RTL не установлены. `strict: true` уже включён (8.3); тесты в `src/**` попадают в `tsc -b` (include `["src"]`) — типы тестов проверяются строго, это фича.
- **eslint.config.js**: блок features уже банит `useMutation` (спит); global ignores `['dist', 'src/**/__canon_*/**']`; node-блок матчит только `**/*.{js,mjs}` — тесты `.ts` живут в browser-globals скоупе (в node-env vitest `fetch`/`console` глобальны и так, `process` в тестах не использовать).
- **lint-canon.test.mjs**: паттерн фикстур `__canon_<x>_<PID>__` + `expectRule/expectClean` + precleanOrphans;негативные контроли обязательны по каждому разрешённому направлению (ревью 8.2). Новые фикстуры делать ТЕМ ЖЕ паттерном.
- **banned-packages.mjs**: `BANNED_PACKAGES` + `BANNED_SCOPES` → `BANNED_IMPORT_PATTERNS` (единый источник eslint + deps-gate) — добавление категории подхватывается обоими автоматически.
- **API-поверхность schema.d.ts**: core (divisions/employees/positions/ranks/staffing-slots/vacancies), operations (daily-submissions+amend, my-permissions, permissions, roles, temporary-duty+expire, user-roles), audit/logs, notifications. **Статусных эндпоинтов НЕТ** — bulk API 3.8 не в роутинге; 409-overridable фикстура потому протокольная (Д8).
- **vite.config.ts**: функция-конфиг с прокси `/api`,`/ws` — test-блок добавляется в возвращаемый объект; `tsconfig.node.json` (include только vite.config.ts) отресолвит `vitest/config` после установки.
- **Версии registry 2026-07-07**: vitest 4.1.10, msw 2.14.6, yaml 2.9.0.

### Ловушки

1. **Относительный URL в Node**: `fetch('/api/…')` в vitest-node падает («Failed to parse URL») — у клиента `baseUrl`-опция; тесты создают клиент с `baseUrl: 'http://localhost'`, MSW path-паттерны (`/api/…`) матчат любой origin.
2. **MSW 2.x API**: `http.get/post` + `HttpResponse.json/error()`, `setupServer` из `msw/node`. НЕ `rest.*` из туториалов msw 1.x. `onUnhandledRequest: 'error'` — обязателен (молчаливый passthrough = вакуумный тест).
3. **Конверт ≠ гарантия**: 502 от nginx — HTML; непереформатированные статусы — DRF-native. Парсер сначала пробует JSON, при провале/отсутствии `error_code` деградирует без исключений (AC 5, 6).
4. **`AbortSignal.timeout`** — граница FF100 (появился ровно в FF100) и не нужен: таймауты не вводить, compat-плагин не дразнить.
5. **eslint block-scoped `ignores` под `ignore:false`**: самотест lint-canon гоняет ESLint с `ignore:false` — это отключает ТОЛЬКО глобальные ignores; `ignores` внутри блока с `files` остаются активны → негативный контроль `shared/api`-фикстуры работает. Доказать фикстурой, не верить на слово.
6. **`no-restricted-globals` не ловит `window.fetch`** — парный `no-restricted-properties` для `window`/`globalThis` обязателен (иначе бан обходится тривиально).
7. **Кириллица в пути репо**: во всех новых путях от `import.meta.url` — `fileURLToPath(new URL(...))`, НЕ `.pathname` (закреплённый урок 8.1–8.3). Контракт-тест реестра: `../../../../docs/registries/error-codes.yaml` от `src/shared/api/errors.test.ts`.
8. **Тесты не должны попасть в бандл**: vite build бандлит только import-граф от entry — `*.test.ts`/`testing/` в него не входят; size-gate не изменится. Если размер вдруг вырос — в бандл утёк msw (искать импорт testing/ из продакшен-кода).
9. **vitest в gate**: `vitest run` (без watch); при 0 тестов падает по умолчанию (`passWithNoTests` false) — шаг не вакуумный.
10. **Классы ошибок и минификация**: narrowing строить на `instanceof` И `kind`-дискриминанте (оба тестировать); НЕ на `error.constructor.name` (ломается минификацией).

### Дефолты (Д) и вопросы Bratan (Q)

- **Д1 (ГЛАВНЫЙ)**: `overridable` НЕ добавляется в конверт §36 (бэк не трогается, стек-локальность 8.2/8.3); клиент выводит его из `OVERRIDABLE_CODES` + контракт-тест синхронизации с реестром (единственный источник — `docs/registries/error-codes.yaml`, дрейф = красный gate). Отвергнуто: рукописный набор без синк-теста (второй источник истины); кодоген из реестра (инфраструктура ради 3 констант).
- **Д2**: маппинг по ФАКТИЧЕСКОМУ протоколу: `ValidationError`=400 (форма, details по полям), `BusinessRuleError`=422 (бизнес). Буква ARCH-FE-015 («422 ValidationError → setError RHF») написана ДО уточнения семантики в стори 3.1 (400 форма/422 бизнес — реестр и exception handler); setError-адресат в 8.5 = details 400-й. architecture.md в стори НЕ правится.
- **Д3**: свой fetch-клиент; `openapi-fetch`/`ky`/`axios` не вводятся (канон: «СВОЙ apiClient.ts»); типизация путей — generics + `paths`-типы schema.d.ts в местах вызова.
- **Д4**: vitest+msw+yaml входят сюда (первый потребитель); jsdom/RTL — НЕ здесь (первый компонент — 8.5); environment `node`.
- **Д5**: enforcement — eslint-баны глобалов (fetch/XHR/window.fetch) вне `shared/api` + категория HTTP-клиентов в banned-packages (axios/ky/superagent); это исполнение заявленного в ARCH-FE-015 enforcement, канон не расширяется.
- **Д6**: auth-заголовков нет; у клиента есть точка расширения (init-опции/defaultHeaders) — 8.6 подключит X-User-Id/JWT без правки парсинга.
- **Д7**: `NetworkError` — отдельный класс вне ApiError-иерархии (HTTP-ответа не было); union эпика расширен честно (400 и не-конверт существуют в реальном протоколе).
- **Д8**: 409-overridable MSW-фикстура — протокольная (на существующем пути схемы): статусных эндпоинтов в API ещё нет, а форма конверта эндпоинт-агностична; 2xx-фикстуры — строго типами схемы.
- **Q1 = Д1 (ГЛАВНЫЙ)**: overridable из реестра на клиенте (синк-тест) vs добавить поле в конверт §36 на бэке (авторитетный сервер, но кросс-стек + дозафиксация спеки §36) — подтвердить дефолт или заказать бэк-стори.
- **Q2 = Д2**: согласен ли с маппингом 400=ValidationError/422=BusinessRuleError и правкой буквы ARCH-FE-015 в architecture.md отдельным chore после ревью?
- **Q3 = Д4**: vitest+msw в этой стори (тестовый фундамент фронта) — ok?
- **Q4**: `@tanstack/react-query` НЕ ставится здесь (вопреки комменту-прогнозу в eslint.config.js «(8.4)») — первый потребитель useApiMutation в 8.5. Ok?

### Границы стори (не расползаться)

- **НЕТ**: useApiMutation, ConflictDialog, тосты, интеграция с формами/RHF (8.5); react-query (8.5, Q4); auth/X-User-Id/JWT/401-редирект (8.6); runtime-валидация MSW-хендлеров против schema.yaml (deferred — при первом рассинхроне или E10); типизация `ErrorCode`-union всего реестра (только OVERRIDABLE_CODES; полный union — со сторей «CI-сверка кодов с реестром», enforcement_pending реестра); ретраи/таймауты/отмена запросов; WebSocket (E11).
- **НЕ трогать**: `Backend/**` (ни exception_handler, ни schema.yaml — API не меняется), `frontend/src/shared/api/schema.d.ts` (не перегенерять), `scripts/schema-check.mjs`, `scripts/schema-check.test.mjs`, `scripts/deps-gate.mjs`, `scripts/size-gate.mjs`, `.prettierignore`, `tsconfig.*.json`, `.github/workflows/ci.yml`, `docs/registries/*.yaml` (реестр — источник, читается, не правится).

### Project Structure Notes

- Файлы create: `frontend/src/shared/api/errors.ts`, `frontend/src/shared/api/client.ts`, `frontend/src/shared/api/testing/handlers.ts`, `frontend/src/shared/api/testing/server.ts`, `frontend/src/shared/api/testing/vitest.setup.ts`, `frontend/src/shared/api/client.test.ts`, `frontend/src/shared/api/errors.test.ts`.
- Файлы modify: `frontend/package.json` (+3 devDeps, +test, gate-цепочка) + `package-lock.json` (генерируемый), `frontend/vite.config.ts` (test-блок), `frontend/eslint.config.js` (баны глобалов), `frontend/scripts/banned-packages.mjs` (категория HTTP-клиентов), `frontend/scripts/lint-canon.test.mjs` (фикстуры).
- Раскладка = канон L554-555: `shared/ — api/ (client, errors, useApiMutation, schema.d.ts gen, testing/ MSW)`; useApiMutation-слот остаётся пустым до 8.5.
- BMAD-размер: 7 create + 6 modify, одна ответственность (транспорт+протокол ошибок shared/api); client+errors+MSW+enforcement неделимы (тесты клиента требуют MSW; недоказанный бан = вакуум). Стек-локальна (только frontend) — прецедент-вопрос Q4-8.3 не воспроизводится.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.4 (L1026-1032)] — текст стори и AC
- [Source: _bmad-output/planning-artifacts/architecture.md#ARCH-FE-015 (L242, L764)] — протокол ошибок, enforcement
- [Source: _bmad-output/planning-artifacts/architecture.md#L238/760 (ARCH-FE-011), L258, L429, L433-435, L440, L472, L554-555, L634] — свой клиент; tsc-контракт; snake_case; семантика 400/422/409; расположение тестов/фикстур; не ретраить; структура shared/api; MSW против схемы
- [Source: Backend/VAPS/apps/core/api/exception_handler.py] — точная форма конверта §36, `_DRF_STATUS_TO_CODE`, непереформатированные статусы, CONSTRAINT_ERROR_MAP
- [Source: Backend/VAPS/apps/core/exceptions.py] — DomainError: `overridable` живёт в исключении, НЕ в конверте (основание Q1)
- [Source: docs/registries/error-codes.yaml] — закрытый мир кодов; 3 overridable-кода (conflict_soft); meta-правило «клиент может повторить с override_reason»
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §36/§60 (пример L5078)] — конверт в спеке (прецедентность контрактов)
- [Source: _bmad-output/implementation-artifacts/8-2-канон-линтеры.md, 8-3-кодоген-типов-из-схемы.md] — уроки: вакуумный pass, fileURLToPath, паттерн __canon_-фикстур, стек-локальность гейтов, gate-цепочка
- Версии registry 2026-07-07: vitest 4.1.10 (peer vite ^6||^7||^8), msw 2.14.6, yaml 2.9.0

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), bmad-dev-story, 2026-07-07.

### Debug Log References

- **Красная проба (а)** — временный `fetch()` в `src/app/App.tsx`: eslint красный — `12:28 error Unexpected use of 'fetch'. HTTP только через apiClient из shared/api (ARCH-FE-015…) no-restricted-globals`; после отката — зелёный.
- **Красная проба (б)** — байт в `OVERRIDABLE_CODES` (`DUTY_CONFLICT_DETECTED` → `…X`): vitest красный с diff в обе стороны и подсказкой — `OVERRIDABLE_CODES разошёлся с реестром — sync c docs/registries/error-codes.yaml. Нет на клиенте: [DUTY_CONFLICT_DETECTED]; лишние на клиенте: [DUTY_CONFLICT_DETECTEDX]`; после отката — 4/4 зелёные.
- **Красная проба (в)** — `rank_index: '10'` в 200-фикстуре против schema-типа: `tsc -b` красный — `handlers.ts(31,7): error TS2322: Type 'string' is not assignable to type 'number'` (contract-канал L258 работает); после отката — зелёный.
- **Красная проба (г)** — `npm i axios`: deps-gate красный — `запрещённые каноном ARCH-FE пакеты в package-lock.json: axios (node_modules/axios)`, exit 1; после `npm rm axios` лок восстановлен, deps-gate чист. eslint-канал `import axios` доказан фикстурой lint-canon.
- **Отладка MSW** — первый прогон: все запросы «unhandled» (`[MSW] Cannot bypass a request when using the "error" strategy`). Причина — **уточнение Ловушки 1**: в node-окружении (нет `location`) относительные предикаты `/api/…` НЕ матчатся против абсолютного URL запроса. Лечение: wildcard-предикаты `*/api/…` (истинная origin-агностичность).
- **Отладка vitest include** — дефолтный include подхватил `scripts/*.test.mjs` (самостоятельные node-скрипты gate-цепочки, не vitest-тесты) — include сужен до `src/**/*.test.ts`.
- **Отладка tsc** — `node:fs`/`node:url` в `errors.test.ts` не резолвились: app-tsconfig ограничен `types: ["vite/client"]`, а `tsconfig.*.json` трогать нельзя (граница стори). Лечение: per-file `/// <reference types="node" />` в errors.test.ts.
- **Отладка eslint-boundaries** — `import type { paths } from './schema'` давал `boundaries/no-unknown-dependencies`: node-резолвер не знал расширение `.d.ts`; добавлено в `import/resolver` (eslint.config.js — в списке modify).

### Completion Notes List

- ✅ Все дефолты Д1–Д8 активны (#YOLO-прогон); Q1–Q4 ждут подтверждения Bratan на ревью. Ключевое: Д1 — `overridable` выводится на клиенте из `OVERRIDABLE_CODES` (3 кода conflict_soft), синхронизация с реестром — контракт-тест в обе стороны + негативные контроли функции сравнения (doctored-наборы детектятся в обоих направлениях).
- ✅ `errors.ts`: `ErrorEnvelope` (рукописный — конверта нет в OpenAPI-схеме, коммент-легализация на месте), иерархия `ApiError` → `ValidationError`(400)/`BusinessRuleError`(422)/`ConflictError`(409+overridable)/`ServerError`(≥500 вкл. не-конверт), `NetworkError` вне иерархии (Д7); narrowing — instanceof И `kind`; `parseErrorResponse` defensive: не-JSON (502 HTML), JSON без `error_code` (DRF-native 405) → деградация без вторичных исключений.
- ✅ `client.ts` (~70 строк): `get/post/patch/del` с generics, `baseUrl`/`defaultHeaders` (точка расширения 8.6, Д6), 204 → `undefined`, `TypeError` fetch → `NetworkError`; без трансформаций/ретраев/таймаутов/auth. Плюс дефолтный `apiClient = createApiClient()` (same-origin).
- ✅ MSW: 9 хендлеров на реальных путях схемы (200 employees typed через `paths`-тип, 204 — реальный 204 схемы `operations_user_roles_destroy`, 400/422/409×2/500 конверты, 502 HTML, network error); 401/403/404/405 — `server.use` в тестах. 30 тестов зелёные (20 client + 10 errors; цифра «17 (13+4)» была застарелой — исправлена на ревью).
- ✅ Enforcement: eslint-блок (no-restricted-globals `fetch`/`XMLHttpRequest` + no-restricted-properties `window`/`globalThis`.`fetch` И `.XMLHttpRequest` — property-каналы XHR добавлены на ревью) + banned-packages категория HTTP-клиентов (axios/ky/superagent → 26 имён) + 5 красных lint-canon фикстур (fetch/xhr/winfetch/winxhr/axios — каждый канал отдельной фикстурой) + негативный контроль `__canon_api_<PID>__` (block-scoped ignores живы под ignore:false — Ловушка 8 доказана). Итог самотеста: 13 красных + 4 негативных контроля.
- ✅ Гейты: `npm ci && npm run gate` зелёный целиком (vitest 30/30 в цепочке после schema-check.test, перед vite build); бандл 59.4 KB gzip — НЕ вырос (msw в бандл не утёк, Ловушка 8-бандл); `make gate` бэка зелёный без изменений (1841 passed).
- ✅ ~~Остаточная дыра enforcement (за буквой спеки Task 7): property-каналы `window.XMLHttpRequest`/`globalThis.XMLHttpRequest` не забанены~~ — ЗАКРЫТО на ревью 2026-07-07: оба property-канала добавлены в no-restricted-properties + доказаны фикстурой `winxhr.ts`.
- ⚠️ Процессный инцидент: стори-файл был повреждён скриптом простановки чекбоксов (обрезан хвост после «## Tasks / Subtasks») и восстановлен целиком из прочитанной копии в контексте сессии; Story/AC/Dev Notes воспроизведены дословно.

### File List

Создано:
- `frontend/src/shared/api/errors.ts`
- `frontend/src/shared/api/client.ts`
- `frontend/src/shared/api/testing/handlers.ts`
- `frontend/src/shared/api/testing/server.ts`
- `frontend/src/shared/api/testing/vitest.setup.ts`
- `frontend/src/shared/api/client.test.ts`
- `frontend/src/shared/api/errors.test.ts`

Изменено:
- `frontend/package.json` (+3 devDeps, script `test`, `vitest run` в gate-цепочке)
- `frontend/package-lock.json` (генерируемый)
- `frontend/vite.config.ts` (reference vitest/config + test-блок с include `src/**/*.test.ts`)
- `frontend/eslint.config.js` (блок банов HTTP-глобалов; `.d.ts` в import/resolver)
- `frontend/scripts/banned-packages.mjs` (категория HTTP-клиентов)
- `frontend/scripts/lint-canon.test.mjs` (3 красные фикстуры + негативный контроль shared/api)

## Senior Developer Review (AI)

**Reviewer:** Bratan (автономный прогон, Claude Fable 5, bmad-story-automator-review) — 2026-07-07.
**Итог:** Approve после авто-фиксов. 0 Critical / 0 High / 3 Medium (исправлены) / 3 Low (зафиксированы, код не тронут — границы стори).

**Верифицировано вживую (не по словам Dev Record):** `npm run gate` зелёный целиком до и после фиксов (vitest 30/30, бандл 59.4 KB gzip не вырос); все 10 путей/методов MSW-фикстур существуют в `schema.d.ts` (проверено скриптом по paths-блоку); `OVERRIDABLE_CODES` = ровно 3 кода `conflict_soft` реестра (строки 96/102/108 error-codes.yaml); форма конверта совпадает с `_envelope()` (`exception_handler.py:75-84`); git-статус совпадает с File List байт-в-байт (7 create + 6 modify, `Backend/**` не тронут). `make gate` бэка не перегонялся: ни один backend-файл не изменён (git), клейм 1841 passed принят по baseline.

**Находки и что сделано:**
- **[M1, AC 8 partial → FIXED]** Канал `new XMLHttpRequest()` был забанен конфигом, но НЕ доказан фикстурой lint-canon (AC 8 требует доказанной красноты; недоказанный бан = вакуум, урок 8.1/8.2). Добавлена фикстура `xhr.ts` + expectRule `no-restricted-globals` (каждый канал — отдельной фикстурой, иначе expectRule доказывает соседний канал в том же файле).
- **[M2, дыра enforcement → FIXED]** `window.XMLHttpRequest`/`globalThis.XMLHttpRequest` не банились — бан глобала обходился тривиально (`new window.XMLHttpRequest()`); dev сам флагнул в Completion Notes. Добавлены 2 записи `no-restricted-properties` в `eslint.config.js` + фикстура `winxhr.ts`. Итог самотеста: 13 красных + 4 негативных контроля.
- **[M3, ложные цифры Dev Record → FIXED]** Заявлено «17 тестов (13 client + 4 errors)» и «17/17 в цепочке»; фактически 30 (20 client + 10 errors) — цифра застряла от промежуточного состояния. Исправлено в Completion Notes и Change Log.
- **[L1, note]** 2xx (кроме 204) с пустым телом даст сырой `SyntaxError` из `.json()`, не типизированную ошибку; для текущей схемы недостижимо (все 2xx — JSON). Пересмотреть при первом не-JSON 2xx-эндпоинте.
- **[L2, note]** Narrowing по `kind` на уровне ТИПОВ заработает только с экспортированным union-типом (`ApiError` — один класс, TS не сузит его по литералу); runtime-канал (switch по kind) и instanceof работают. Решить в 8.5 по фактическому потребителю useApiMutation.
- **[L3, note]** `${baseUrl}${path}` без нормализации слэшей — осознанное документированное поведение (baseUrl='' | абсолютный origin), ок.

## Change Log

- 2026-07-07 — Story 8.4 реализована (Claude Fable 5, bmad-dev-story): apiClient + DomainError-парсинг конверта §36 в одной точке, тестовый фундамент фронта (vitest 4 + MSW 2, environment node), enforcement «HTTP только через apiClient» (eslint-баны + banned-packages + lint-canon), контракт-тест OVERRIDABLE_CODES ⇔ error-codes.yaml. Все гейты зелёные (фронт: npm ci + npm run gate, 30/30 тестов — в оригинале записи ошибочно значилось 17/17, исправлено ревью; бэк: make gate, 1841 passed). Status → review.
- 2026-07-07 — Code review проход 1 (Claude Fable 5, bmad-story-automator-review): 3 Medium исправлены (фикстура xhr-канала; property-баны window/globalThis.XMLHttpRequest + фикстура winxhr; застарелые цифры тестов в Dev Record), 3 Low зафиксированы нотами. lint-canon: 13 красных + 4 негативных. Гейт перегнан — зелёный. Status → done.
