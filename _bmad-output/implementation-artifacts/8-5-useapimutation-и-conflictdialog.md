---
baseline_commit: 6d747804f93a690dcdb171b3538967896ddfeeec
---

# Story 8.5: useApiMutation и ConflictDialog

Status: done

> **Контекст запуска:** пятая стори E8; baseline диффа: `6d74780` (8.4 закоммичена целиком).
> UI-половина протокола ошибок ARCH-FE-015 (транспортная половина — 8.4): один хук
> `useApiMutation` разветвляет типизированные ошибки по каналам (форма / ConflictDialog /
> тост / state), плюс первые компоненты фронта → приезжают react-query, jsdom и RTL.
> Auth/401-редирект — 8.6; shadcn/Tailwind/визуальный канон — 8.7 (здесь UI headless-минимум).
> **Решения (создано в #YOLO-прогоне 2026-07-07):** Q1–Q4 = дефолты Д1–Д8, активны;
> подтвердить у Bratan при запуске dev-story.

## Story

As a разработчик,
I want общий хук мутаций `useApiMutation` поверх react-query, который разветвляет ApiError-union из 8.4 по каналам протокола (400 ValidationError → колбэк формы с details по полям; 409 ConflictError overridable → общий ConflictDialog с onOverride и повтором с `override=true` + `override_reason`; 5xx ServerError и NetworkError → глобальный тост; 422 BusinessRuleError и non-overridable 409 → error-state фичи) + MSW-фикстуру override-флоу,
so that протокол ошибок реализован ОДИН раз в shared, а сырой `useMutation` и собственные override-диалоги в features механически забанены (ARCH-FE-015).

## Acceptance Criteria

1. **Given** мутация через `useApiMutation`, ответ 409 с overridable-кодом (`STATUS_OVERLAP_WARNING`, MSW), **When** пользователь подтверждает в ConflictDialog причину 10–500 символов, **Then** мутация повторяется ОДИН раз с исходным телом + `override: true` + `override_reason: <причина>` (snake_case, тело второго запроса захвачено и проверено в тесте), успех повтора → `onSuccess`, диалог закрыт, conflict-state сброшен.
2. **Given** открытый ConflictDialog, **When** «Отмена» (или Escape), **Then** повторного запроса НЕТ, conflict-state сброшен, ошибка мутации доступна фиче; **Given** причина короче 10 или длиннее 500 символов, **Then** «Подтвердить оверрайд» заблокирована и запрос не уходит (фронт несёт правило 10–500 — бэк проверяет только непустоту, расхождение зафиксировано).
3. **Given** ответ 400 `VALIDATION_ERROR` (details = DRF-ошибки по полям), **Then** вызывается `onFormError` с details по полям (сигнатура совместима с будущим RHF `setError`, Д3); ни тоста, ни диалога.
4. **Given** ответ 422 `BUSINESS_DATE_OUT_OF_WINDOW` И ответ 409 non-overridable (`DAY_ALREADY_SUBMITTED`), **Then** ошибка остаётся в `mutation.error` для рендера фичей (красная заливка/сообщение — E9); ни диалога, ни тоста, ни повтора.
5. **Given** ответ 500 (конверт) И 502 text/html И сетевой обрыв, **Then** глобальный тост (aria-live) с generic-сообщением БЕЗ деталей наружу (UX L208); мутация не ретраится автоматически (канон L472: `retry: false`).
6. **Given** `import { useMutation } from '@tanstack/react-query'` в `src/features/**` (фикстура lint-canon `mutation.ts` — уже стоит с 8.2), **Then** eslint красный — спящее правило проснулось с установкой пакета; **Given** импорт `useApiMutation` из `shared/api/useApiMutation` в features-фикстуре, **Then** зелёный (новый негативный контроль lint-canon).
7. **Given** `npm run gate`, **Then** контрактный тест маппинга в shared зелёный: КАЖДЫЙ класс (`ValidationError`/`BusinessRuleError`/`ConflictError`×overridable-true/false/`ServerError`/`NetworkError`/базовый `ApiError`) доведён до своего канала (форма/диалог/state/тост) через renderHook+MSW; компонентные тесты ConflictDialog (RTL, jsdom): валидация 10–500 со счётчиком, кнопки «Отмена»/«Подтвердить оверрайд», onOverride с введённой причиной.
8. **Given** чистый клон (`npm ci && npm run gate`), **Then** зелёный целиком: vitest подхватывает и старые `.test.ts` (node-env, 30 шт.), и новые `.test.tsx` (jsdom); size-gate держит бюджет ≤300КБ с react-query в бандле; `make gate` бэка не тронут и зелёный.

## Tasks / Subtasks

- [x] Task 1: Зависимости и тест-инфраструктура (AC: 7, 8)
  - [x] `npm i @tanstack/react-query@^5.101.2` (runtime dep; peer react ^19 ok); `npm i -D jsdom@^29.1.1 @testing-library/react@^16.3.2 @testing-library/dom@^10.4.1 @testing-library/jest-dom@^6.9.1 @testing-library/user-event@^14.6.1` (registry 2026-07-07; RTL 16 требует ЯВНЫЙ peer @testing-library/dom)
  - [x] `vite.config.ts`: `test.include` → `['src/**/*.test.{ts,tsx}']`; environment остаётся `node` — компонентные тесты берут jsdom per-file docblock `// @vitest-environment jsdom` (Д7: тесты 8.4 не трогаются, `environmentMatchGlobs` в vitest 4 удалён)
  - [x] jest-dom матчеры: импорт `@testing-library/jest-dom/vitest` в самих `.test.tsx` (per-file, НЕ в общий vitest.setup.ts — он гоняется и для node-тестов 8.4)
- [x] Task 2: `errors.ts` — закрыть ноту L2 ревью 8.4 (AC: 7)
  - [x] `export type ApiFailure = ApiError | NetworkError` — тип ошибки хука; ветвление в хуке — `instanceof` + `kind`-runtime (минификация-safe); полноценный discriminated-union по `kind` НЕ вводить (широкий `kind` базы поглощает narrowing — зафиксировано L2)
- [x] Task 3: `src/shared/ui/toast.tsx` — минимальный глобальный тост (AC: 5)
  - [x] `ToastProvider` + `useToast(): { toast(message: string): void }` на Context; рендер — `role="status"` aria-live=polite, авто-dismiss (таймер), без порталов-зависимостей; НИКАКОГО sonner/notistack (не донорские; рескин на донорский примитив — 8.7)
  - [x] shared→shared легально (boundaries); монтируется из app (Task 4)
- [x] Task 4: `src/app/providers.tsx` + подключение (AC: 1–5)
  - [x] `QueryClientProvider` с `defaultOptions: { mutations: { retry: false } }` (канон L472 «мутации не ретраить»; queries не конфигурируем — не наша стори) + `ToastProvider`; `main.tsx`: обернуть `<App />` в `<Providers>`
- [x] Task 5: `src/shared/api/useApiMutation.ts` — ядро (AC: 1–5)
  - [x] Сигнатура: `useApiMutation<TData, TVariables extends Record<string, unknown>>(options: { mutationFn: (vars: TVariables) => Promise<TData>; onSuccess?; onFormError?: (details: Record<string, unknown>) => void })` → `{ mutate, isPending, error: ApiFailure | null, conflict: ConflictError | null, confirmOverride(reason: string): void, dismissConflict(): void }`; variables = тело запроса (объект) — констрейнт нужен для спреда override
  - [x] Ветвление onError: `ValidationError` → `onFormError(err.details)`; `ConflictError && overridable` → `conflict`-state (диалог); `ServerError | NetworkError` → `toast(...)` generic без деталей; остальное (422, non-overridable 409, 401/403/404 базовый ApiError) → только `mutation.error` (401-редирект — 8.6)
  - [x] `confirmOverride(reason)`: повтор `mutate({ ...lastVariables, override: true, override_reason: reason })` — lastVariables из ref; сброс conflict-state; это осознанный пользовательский повтор, НЕ авто-ретрай (не противоречит L465/L472)
  - [x] Внутри хука `useMutation` из react-query легален (бан — только `src/features/**`); optimistic updates НЕ делать (L472)
- [x] Task 6: `src/shared/ui/ConflictDialog.tsx` (AC: 1, 2)
  - [x] Props: `{ conflict: ConflictError | null; onOverride(reason: string): void; onCancel(): void }` (onOverride — буква эпика); нативный `<dialog>` + `showModal()` (FF98+ → FF100 ok; focus-trap/Escape/возврат фокуса — нативно, UX L177/L219), стек модалок один уровень (UX L76)
  - [x] Содержимое по мокапу key-daily-grid.html L426-450: заголовок «Конфликт: …» из `conflict.message`, список `details.conflicts[]`, пояснение «…Причина попадёт в аудит.», textarea «Причина (10–500 символов)» со счётчиком `N / 500`, кнопки «Отмена» / «Подтвердить оверрайд» (disabled вне 10–500 после trim)
  - [x] Headless-минимум БЕЗ стилей (Tailwind/shadcn НЕТ до 8.7 — Д4); никакого CSS-in-JS (ARCH-FE-014), inline style не вводить
- [x] Task 7: MSW override-флоу (AC: 1)
  - [x] `testing/handlers.ts`: override-aware хендлер `POST */api/operations/temporary-duty/` — читает тело: `override === true && override_reason` → 201 c echo-телом; иначе 409 `conflictOverridableEnvelope` (существующая фикстура; путь — Д8-прецедент 8.4: живого override-эндпоинта в API нет, контракт протокольный)
  - [x] Захват тел запросов — массивом, не `let` (урок client.test.ts)
- [x] Task 8: Тесты (AC: 1–5, 7)
  - [x] `src/shared/api/useApiMutation.test.tsx` (`// @vitest-environment jsdom`): renderHook с обёрткой QueryClientProvider(retry:false)+ToastProvider; ветки: 409-overridable → conflict; confirmOverride → второй запрос с `{...body, override: true, override_reason}` (ассерт тела!) → onSuccess+сброс; dismiss → нет повтора; 400 → onFormError(details), тост НЕ показан; 422 и 409-non-overridable → error-state, диалог НЕ открыт; 500/502/network → тост показан (screen.getByRole('status')), onFormError НЕ вызван; 401 → только error
  - [x] `src/shared/ui/ConflictDialog.test.tsx` (jsdom, RTL+user-event): рендер с ConflictError-фикстурой; счётчик и disabled при 0/9/501 символах, enabled при 10–500; клик «Подтвердить оверрайд» → onOverride(reason); «Отмена»/Escape → onCancel; conflict=null → диалог закрыт
- [x] Task 9: lint-canon — негативный контроль (AC: 6)
  - [x] Фикстура `__canon_a_<PID>__/uses-api-mutation.ts`: импорт `useApiMutation` по прямому пути из shared/api (без barrel) → `expectClean`; счётчик финального лога обновить (13 красных + 5 негативных); красная фикстура `mutation.ts` уже существует — НЕ дублировать
- [x] Task 10: Красная фаза и верификация (AC: 6, 7, 8)
  - [x] Красные пробы вживую (Debug Log): (а) сломать маппинг (409-overridable → тост вместо диалога) → контракт-тест красный; (б) убрать `override_reason` из повторного тела → тест захвата тела красный; (в) `import { useMutation }` в фикстуре features — eslint красный (спящее правило проснулось, показать live-прогон)
  - [x] Чистые прогоны: `npm ci && npm run gate` зелёный; зафиксировать новый размер бандла (react-query ≈ +12–15 KB gzip, бюджет ≤300КБ держится); `make gate` (Backend/VAPS) зелёный БЕЗ изменений

### Review Follow-ups (AI)

- [ ] [AI-Review][Low] Полифилл `<dialog>` (show/showModal/close для jsdom 29) продублирован в двух тест-файлах — вынести в общий тест-хелпер при появлении третьего потребителя [frontend/src/shared/ui/ConflictDialog.test.tsx:19, frontend/src/app/providers.test.tsx:32]
- [ ] [AI-Review][Low] Капчер-хелпер `captureTemporaryDuty` (override-aware хендлер с захватом тел) продублирован в двух тест-файлах — кандидат в `shared/api/testing/` при третьем потребителе [frontend/src/shared/api/useApiMutation.test.tsx:74, frontend/src/app/providers.test.tsx:90]

## Dev Notes

### Архитектурные гварды (обязательны, источник — architecture.md)

- **ARCH-FE-015** (L242/764) — ядро стори: «422→setError RHF; 409→ConflictDialog+retry override:true; 5xx→тост; ОДИН хук useApiMutation». MUST NOT: сырой `useMutation` в features (спящее правило eslint.config.js ПРОСЫПАЕТСЯ с установкой пакета — уже стоит с 8.2, фикстура `mutation.ts` красная); try/catch вокруг mutate; парсинг `response.status` вне apiClient (закрыто 8.4); собственные override-диалоги (диалог ОДИН, в shared/ui).
- **Д2-8.4 (активен, Q2 pending)**: буква «422→setError» написана до уточнения семантики; фактический протокол: **400 = форма (details по полям) → onFormError; 422 = бизнес → error-state**. Реестр (шапка error-codes.yaml L9-14) и exception_handler — источники. architecture.md в стори НЕ правится.
- **ARCH-FE-010** (L237): серверный стейт — ТОЛЬКО TanStack Query; loading — только состояния Query (свои isLoading-флаги запрещены, L472/L487); дублирование Query-кэша в useState запрещено — conflict-state хука это UI-state диалога, не серверные данные (легально).
- **Канон §Process L472**: «мутации не ретраить» = авто-ретраи (`retry: false` в QueryClient); повтор с override — осознанное действие пользователя с НОВЫМ телом, канону не противоречит (L242 прямо требует retry с override:true). Optimistic updates запрещены.
- **ARCH-FE-013**: `useApiMutation` → `shared/api/` (канон-слот L554 прямо называет файл), ConflictDialog/toast → `shared/ui/`; shared→shared легально, app→всё; БЕЗ barrel-index (скан lint-canon); импорты из features — прямым путём к файлу.
- **ARCH-FE-014** (L241/L333): Tailwind/shadcn ещё НЕ установлены (приходят в 8.7) → в 8.5 UI headless-минимум без стилей; CSS-in-JS запрещён; hex-цвета не вводить. Визуальный канон диалога (токены conflict-soft/hard, DESIGN.md L240-247) — рескин в 8.7, поведение — здесь.
- **snake_case end-to-end (L429)**: поля повтора — `override`, `override_reason`; никаких camelCase.
- **L440**: компонентные тесты `*.test.tsx` рядом с компонентом; MSW-фикстуры в `shared/api/testing/`.
- **L262**: RTL-тест keyboard path в DoD формо-сторий — для ConflictDialog: Escape (отмена) обязателен в тесте.

### Протокол override (ground truth бэка, baseline 6d74780)

- **Контракт = ДВА поля**: `override: true` (bool) + `override_reason: string` — зеркало kwargs сервиса (`status_service.py` L258-259: `create_status(..., override=False, override_reason="")`); не query-param, не единое поле.
- **Валидация бэка — только непустота** (`if override and not (override_reason or "").strip()` → 400 `VALIDATION_ERROR`, `details.field="override_reason"`); правило **10–500 символов живёт в спеке (BR-003, VAPS_7.8.2 L1048) и UX (EXPERIENCE L175) — несёт ФРОНТ** (ConflictDialog disabled вне диапазона). Расхождение зафиксировано — бэк-валидацию НЕ добавлять (Backend не трогаем).
- **Живого HTTP-эндпоинта с override НЕТ**: statuses — сервисный слой без REST (views/serializers/urls отсутствуют); `daily-submissions/{id}/amend/` принимает только `reason`+`sanction` (amendment-flow ≠ override); в schema.d.ts слово override — 0 раз. Отсюда Д1: контракт хука протокольный, MSW-фикстура на существующем пути (Д8-прецедент 8.4).
- **Подавление**: `override=True` → soft-конфликты не бросают 409, пишется сущность `Override` (reason, conflicts-снапшот) + аудит `OVERRIDE_APPLIED` — сервер авторитетен, клиенту достаточно повторить с двумя полями.
- **overridable** уже вычислен на клиенте (8.4): `ConflictError.overridable` из `OVERRIDABLE_CODES` (3 кода conflict_soft, контракт-тест синхронизации стоит). Хук читает ГОТОВОЕ поле — реестр повторно не читать. Деление hard/soft конфигурируется на бэке (UX L177) — UI не зашивает коды, только флаг.

### Фактура фронта (ground truth на baseline)

- **errors.ts**: `ApiError` (kind-union на базе) → `ValidationError`(400)/`BusinessRuleError`(422)/`ConflictError`(409, `overridable: boolean`)/`ServerError`(5xx+не-конверт); `NetworkError` ВНЕ иерархии (Д7-8.4). **Экспортированного union нет** — Task 2 добавляет `ApiFailure` (нота L2 ревью 8.4: TS не сузит базовый ApiError по kind-литералу — ветвление instanceof).
- **client.ts**: `apiClient.post<T>(path, body?)` — body `unknown`, JSON; операционные POST-пути схемы имеют `requestBody?: never` (тонкая DRF-схема) — тело override-повтора нетипизировано схемой, это нормально.
- **handlers.ts** (реюз!): `conflictOverridableEnvelope` (STATUS_OVERLAP_WARNING + details.conflicts), `validationEnvelope` (details по полям iin/rank_code — сырьё для onFormError-теста), `businessRuleEnvelope`, `conflictStateEnvelope` (DAY_ALREADY_SUBMITTED), `serverEnvelope`, `badGatewayHtml`, network-обрыв на `GET divisions/`. Для 8.5 меняется ТОЛЬКО хендлер temporary-duty (override-aware); остальное реюзается через `server.use(...)` в тестах.
- **gate-цепочка** (`package.json`): `deps-gate → schema-check → tsc -b → eslint . → lint-canon → schema-check.test → vitest run → vite build → size-gate` — НЕ меняется, vitest уже встроен (8.4).
- **eslint.config.js**: спящее правило — блок `src/features/**`: `paths: [{ name: '@tanstack/react-query', importNames: ['useMutation'], message: 'В features — только useApiMutation из shared/api (ARCH-FE-015)' }]`; бан-глобалы fetch/XHR вне shared/api (8.4). `@tanstack/react-query` НЕ в banned-packages (банится только `@tanstack/react-router`); `react-hook-form`, RTL, jsdom — не в бане.
- **Бандл**: 59.4 KB gzip (8.4); react-query ≈ +12–15 KB gzip; бюджет ≤300КБ — запас большой, но зафиксировать факт в Dev Record.
- **features/ пуст** (.gitkeep) — первые потребители хука придут в 8.6/E9; в 8.5 потребитель = тесты.
- **Версии registry 2026-07-07**: @tanstack/react-query 5.101.2 (peer react ^18||^19), jsdom 29.1.1 (Node ≥24 ok), @testing-library/react 16.3.2 (+ явный peer @testing-library/dom 10.4.1), jest-dom 6.9.1, user-event 14.6.1.

### Ловушки

1. **vitest 4: `environmentMatchGlobs` УДАЛЁН** — jsdom для компонентных тестов через per-file docblock `// @vitest-environment jsdom` (первая строка файла) либо projects-конфиг; docblock проще (Д7). Node-тесты 8.4 не трогать.
2. **jest-dom в setup нельзя**: общий `vitest.setup.ts` гоняется и в node-тестах 8.4 — матчеры подключать per-file (`import '@testing-library/jest-dom/vitest'` в `.test.tsx`).
3. **`<dialog>` в jsdom**: `showModal()` поддержан в свежих jsdom, но ::backdrop/top-layer — нет; ассертить `dialog.open`/видимость контента, не CSS-слои. Возврат фокуса после `close()` в jsdom может отличаться от браузера — смок, не пиксель-перфект.
4. **MSW capture — массивом**, не `let` (tsc сужает let к initializer в замыкании хендлера) — прецедент client.test.ts.
5. **renderHook — из `@testing-library/react`** (не отдельный устаревший пакет `@testing-library/react-hooks`).
6. **QueryClient в тестах — свежий на каждый тест** (кэш мутаций/ретраев не протекает между тестами); wrapper = Providers-композиция или локальная обёртка.
7. **StrictMode double-invoke** (main.tsx: StrictMode стоит): эффекты хука должны быть идемпотентны; conflict-state — из onError, не из эффекта.
8. **Кириллица в пути репо**: новые node-скрипты/фикстуры — `fileURLToPath(new URL(...))`, не `.pathname` (закреплённый урок 8.1–8.4; в 8.5 актуально для правок lint-canon).
9. **exhaustive-deps: error** — колбэки confirmOverride/dismissConflict оборачивать useCallback с честными deps, не гасить правило.
10. **Спящее правило просыпается молча**: после `npm i @tanstack/react-query` импорт `useMutation` в features станет красным автоматически — красную пробу (в) сделать live-прогоном, не верить на слово.

### Дефолты (Д) и вопросы Bratan (Q)

- **Д1 (ГЛАВНЫЙ)**: контракт повтора — `{ ...исходное_тело, override: true, override_reason }` (spread исходных variables + два snake_case поля, зеркало kwargs сервиса). Живого эндпоинта нет → фикстура протокольная на `POST temporary-duty` (Д8-прецедент 8.4). Отвергнуто: ждать REST-слоя статусов (блокирует E9); query-param (не зеркалит сервис).
- **Д2**: каналы по ФАКТИЧЕСКОМУ протоколу (продолжение Д2-8.4): 400→форма, 422+non-overridable-409→error-state фичи, overridable-409→диалог, 5xx+network→тост, 401/403/404→error-state (ветвление 401 — 8.6).
- **Д3**: react-hook-form НЕ ставится — `onFormError(details)` отдаёт сырьё, совместимое с RHF `setError` по форме вызова; RHF придёт с первой формой (8.6, вход). Прецедент: Q4-8.4 (react-query не ставился до потребителя).
- **Д4**: ConflictDialog/toast — headless на нативном `<dialog>` и aria-live div, БЕЗ Tailwind/shadcn (их нет до 8.7) и БЕЗ sonner (не донорский, инжектит свои стили — конфликт с ARCH-FE-014 по духу). Поведение+копирайт из мокапа — здесь; визуальный канон — рескин 8.7.
- **Д5**: тост-инфраструктура в `shared/ui/toast.tsx`, монтаж в `app/providers.tsx` (ARCH L550: providers в app/; shared не может импортировать app → контекст живёт в shared, app только монтирует).
- **Д6**: `retry: false` только для mutations в QueryClient-дефолтах (канон L472); query-политики не трогаем (не наша стори).
- **Д7**: environment `node` остаётся дефолтом; jsdom — per-file docblock в `.test.tsx` (vitest 4: environmentMatchGlobs удалён, projects — оверкилл для двух файлов).
- **Д8**: нота L2 ревью 8.4 закрывается минимально: `export type ApiFailure = ApiError | NetworkError` + instanceof-ветвление; полный discriminated-union по kind не вводится (widening базового kind).
- **Q1 = Д1 (ГЛАВНЫЙ)**: протокольный контракт override-повтора без живого эндпоинта (фикстура на temporary-duty) — ок, или отложить AC-1 до REST-слоя статусов?
- **Q2 = Д4**: headless-UI до 8.7 (нативный dialog, свой мини-тост) vs затянуть Tailwind+shadcn уже в 8.5?
- **Q3 = Д3**: RHF не ставим (onFormError-сырьё, RHF в 8.6)?
- **Q4 = Д7**: jsdom per-file docblock vs полный переход default-environment на jsdom?

### Границы стори (не расползаться)

- **НЕТ**: auth/401-редирект/AuthContext (8.6); роутер/layout/shadcn/Tailwind (8.7); реальные формы и RHF (8.6/E9); тост успеха (не протокол ошибок); optimistic updates (запрещены каноном); query-хуки/useQuery-обвязка (потребители — 8.6+); REST-слой статусов на бэке (отдельная бэк-стори до E9); визуальные токены conflict-soft/hard (8.7); toast-очереди/стек (минимум); i18n.
- **НЕ трогать**: `Backend/**` (валидацию 10–500 НЕ добавлять; API не меняется — schema.d.ts не перегенерять), `scripts/schema-check*.mjs`, `scripts/deps-gate.mjs`, `scripts/size-gate.mjs`, `docs/registries/*.yaml`, `errors.test.ts`/`client.test.ts` (тесты 8.4 остаются как есть), gate-цепочку в package.json (состав шагов не меняется).

### Project Structure Notes

- Файлы create: `frontend/src/shared/api/useApiMutation.ts`, `frontend/src/shared/api/useApiMutation.test.tsx`, `frontend/src/shared/ui/ConflictDialog.tsx`, `frontend/src/shared/ui/ConflictDialog.test.tsx`, `frontend/src/shared/ui/toast.tsx`, `frontend/src/app/providers.tsx`.
- Файлы modify: `frontend/package.json` (+1 dep, +5 devDeps) + `package-lock.json` (генерируемый), `frontend/vite.config.ts` (include .tsx), `frontend/src/app/main.tsx` (Providers), `frontend/src/shared/api/errors.ts` (export ApiFailure), `frontend/src/shared/api/testing/handlers.ts` (override-aware хендлер), `frontend/scripts/lint-canon.test.mjs` (негативный контроль).
- Раскладка = канон L554-555: `shared/api/` (client, errors, **useApiMutation**, testing/) + `shared/ui/` (первые компоненты) — слот, названный каноном поимённо, заполняется.
- BMAD-размер: 6 create + 7 modify, одна ответственность (UI-половина протокола ошибок ARCH-FE-015; транспорт был 8.4). Хук+диалог+тост неделимы: AC эпика связывает их в один флоу (409→диалог→повтор), тост — третья ветка того же ветвления; первые компоненты тянут jsdom/RTL сюда же (первый потребитель — прецедент Д4-8.4). Стек-локальна (только frontend).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.5 (L1034-1040)] — текст стори и AC
- [Source: _bmad-output/planning-artifacts/architecture.md#ARCH-FE-015 (L242, L764)] — протокол каналов, один хук, баны
- [Source: _bmad-output/planning-artifacts/architecture.md#L237 (FE-010), L246, L433-435, L465, L472, L487, L550, L554-555, L594, L634] — Query-канон; RHF+zod; семантика 400/422/409; идемпотентность/не ретраить; providers в app/; структура shared; boundaries; MSW против схемы
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md L173-177, L204-208, L219-221, L251, L256] — ConflictDialog: причина 10–500, аудит-копирайт, фокус-возврат, стек модалок; 500→toast без деталей
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/mockups/key-daily-grid.html L426-450] — эталонная разметка/копирайт диалога
- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py L247-260, L274-280, L236-244, L312-323] — kwargs override/override_reason, валидация непустоты, подавление soft, сущность Override
- [Source: Backend/VAPS/apps/core/exceptions.py L32-38] — DomainError.overridable
- [Source: docs/registries/error-codes.yaml L9-14, L93-111, L126-131] — «клиент может повторить с override_reason»; 3 conflict_soft кода; DAY_ALREADY_SUBMITTED non-overridable
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §36 (L5045-5092), BR-003 (L1033-1048)] — конверт; правило 10–500
- [Source: _bmad-output/implementation-artifacts/8-4-apiclient-и-domainerror-парсинг.md] — уроки: Д2 (400=форма), Д8 (протокольная фикстура), нота L2 (union), Ловушки 1/7, capture-массивом, спящее правило
- Версии registry 2026-07-07: @tanstack/react-query 5.101.2, jsdom 29.1.1, @testing-library/react 16.3.2, @testing-library/dom 10.4.1, jest-dom 6.9.1, user-event 14.6.1

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), bmad-dev-story, 2026-07-07.

### Debug Log References

- **Красная проба (а)** — ветка `ConflictError && overridable` временно переведена на `toast(...)` вместо `setConflict`: контракт-тест красный — 4 теста конфликт-канала упали (conflict-state не наступает, тост показан); после отката — зелёные.
- **Красная проба (б)** — `override_reason` временно выброшен из тела повтора в `confirmOverride`: красные И тест захвата тела (`expected [ …override_reason… ] … `), И тест дефолтной MSW-фикстуры (хендлер не отдаёт 201 без reason → onSuccess не вызван, «0 times») — фикстура сама валидирует протокол; после отката — зелёные.
- **Красная проба (в)** — живой прогон: `src/features/probe85/mutation.ts` с `import { useMutation } from "@tanstack/react-query"` → `eslint` красный: `1:10 error 'useMutation' import from '@tanstack/react-query' is restricted. В features — только useApiMutation из shared/api (ARCH-FE-015) @typescript-eslint/no-restricted-imports`, exit 1 — спящее правило 8.2 проснулось с установкой пакета; файл удалён.
- **Уточнение Ловушки 3 по факту** — jsdom 29.1.1 НЕ реализует методы `<dialog>` вовсе (`show`/`showModal`/`close` — undefined, а не «поддержаны в свежих jsdom»); лечение: минимальный полифилл open-семантики в `ConflictDialog.test.tsx` (per-file, прод-код остаётся на нативном API; ассерты — по `dialog.open`/контенту, как и предписывала ловушка).
- **Escape в jsdom** — нативный cancel-путь `<dialog>` не эмулируется jsdom: в компоненте Escape перехвачен `onKeyDown` (работает и в браузере, и в jsdom) + `onCancel` с `preventDefault` как страховка UA-закрытия; открытость управляется ТОЛЬКО пропом `conflict`.
- **RTL cleanup** — vitest globals выключены (проектный канон) → авто-cleanup RTL не регистрируется: явный `afterEach(cleanup)` в обоих `.test.tsx`.

### Completion Notes List

- ✅ Все дефолты Д1–Д8 активны (#YOLO-прогон, отмечено в шапке стори); Q1–Q4 ждут подтверждения Bratan на ревью. Ключевое: Д1 — контракт повтора `{ ...исходное_тело, override: true, override_reason }` (snake_case, зеркало kwargs `status_service.create_status`), доказан ассертом тела второго запроса; живого override-эндпоинта нет — фикстура протокольная на `POST temporary-duty` (Д8-прецедент 8.4).
- ✅ `useApiMutation` (shared/api, канон-слот L554): ЕДИНСТВЕННАЯ точка ветвления каналов — 400 `ValidationError` → `onFormError(details)` (сырьё RHF setError, Д3); 409 overridable → `conflict`-state (диалог); `ServerError|NetworkError` → глобальный тост generic БЕЗ деталей (UX L208); 422 / non-overridable 409 / 401-403-404 → только `mutation.error` (401-редирект — 8.6). `confirmOverride` — повтор РОВНО один раз из ref (`lastVariables`), осознанное действие пользователя (не авто-ретрай, L472/L242); `dismissConflict` — сброс без повтора, ошибка остаётся фиче. Внутри — `useMutation` react-query (легален в shared/api); optimistic updates нет; колбэки в `useCallback` с честными deps (exhaustive-deps: error — чисто).
- ✅ Нота L2 ревью 8.4 закрыта минимально (Д8): `export type ApiFailure = ApiError | NetworkError` в errors.ts; ветвление — instanceof (минификация-safe), полный discriminated-union по kind осознанно НЕ введён.
- ✅ `ConflictDialog` (shared/ui, диалог ОДИН): нативный `<dialog>`+`showModal()` (FF98+ → цель FF100), headless без стилей (Tailwind/shadcn — 8.7, Д4; CSS-in-JS/inline-style не введены); копирайт мокапа key-daily-grid.html L426-450 (заголовок «Конфликт: …» из message, список `details.conflicts[]` defensive, «…Причина попадёт в аудит.», textarea со счётчиком `N / 500`, «Отмена»/«Подтвердить оверрайд»); правило 10–500 ПОСЛЕ trim несёт фронт (бэк — только непустота, расхождение зафиксировано, Backend не тронут).
- ✅ `toast.tsx` (shared/ui) — Context + постоянный `role="status"` aria-live=polite регион, авто-dismiss 6с, без sonner/notistack/порталов; `providers.tsx` (app) — `QueryClientProvider` с `mutations: { retry: false }` (Д6, query-политики не тронуты) + `ToastProvider`; main.tsx обёрнут.
- ✅ MSW: хендлер `POST */api/operations/temporary-duty/` стал override-aware (оба поля протокола → 201 echo; иначе 409 `conflictOverridableEnvelope`); тесты 8.4 (`client.test.ts` postил `{}`) не тронуты и зелёные; капчеры — массивами.
- ✅ Тесты: +21 (12 хук renderHook+MSW: все 7 классов union доведены до каналов, повтор с ассертом тела, no-auto-retry 5xx; 9 компонентных RTL+user-event: границы 0/9/10/500/501 + trim, onOverride/onCancel/Escape keyboard-path L262). Итого vitest 51/51 (30 старых node + 21 новых jsdom per-file docblock, Д7 — node-тесты 8.4 не тронуты; jest-dom per-file, НЕ в общий setup).
- ✅ lint-canon: +1 негативный контроль (`uses-api-mutation.ts` — импорт хука прямым путём из features зелёный); итог самотеста «13 красных + 5 негативных контролей»; красная фикстура `mutation.ts` (8.2) не дублирована — проснулась сама (проба (в) живьём).
- ✅ Гейты: `npm ci && npm run gate` зелёный целиком (deps-gate 413 пакетов чисто / schema-check / tsc / eslint / lint-canon / schema-check.test / vitest 51/51 / build / size-gate); бандл 66.7 KB gzip (было 59.4 → react-query дал +7.3 KB gzip — МЕНЬШЕ прогнозных 12–15 за счёт tree-shaking, бюджет ≤300 KB держится); `make gate` бэка зелёный БЕЗ изменений (1841 passed), `Backend/**` не тронут (git).
- ✅ QA-проход (bmad-qa-generate-e2e-tests, 2026-07-07, после dev-стори): +9 тестов → vitest **60/60** (30 node 8.4 + 30 jsdom): 3 E2E user-флоу через РЕАЛЬНУЮ `Providers`-композицию (`providers.test.tsx` — регресс createQueryClient/монтажа локальная тест-обёртка не поймала бы), 3 компонентных тоста с fake timers (`toast.test.tsx` — было 0 покрытия), +3 граничных перехода conflict-state в `useApiMutation.test.tsx`; 3 мутационные пробы (setConflict в mutate / clearTimeout в toast / retry: false в createQueryClient) — каждая валит ровно свои тесты; прод-код не тронут (откат байт-в-байт), бандл не вырос. Детали: tests/test-summary.md.

### File List

Создано:
- `frontend/src/shared/api/useApiMutation.ts`
- `frontend/src/shared/api/useApiMutation.test.tsx` (dev-стори 12 тестов; +3 QA-прохода — граничные переходы conflict-state)
- `frontend/src/shared/ui/ConflictDialog.tsx`
- `frontend/src/shared/ui/ConflictDialog.test.tsx`
- `frontend/src/shared/ui/toast.tsx`
- `frontend/src/app/providers.tsx`

Создано QA-проходом (bmad-qa-generate-e2e-tests, детали — tests/test-summary.md):
- `frontend/src/app/providers.test.tsx` (3 E2E-теста через реальную Providers-композицию)
- `frontend/src/shared/ui/toast.test.tsx` (3 компонентных теста тоста, fake timers)

Изменено:
- `frontend/package.json` (+1 dep `@tanstack/react-query`, +5 devDeps: jsdom, RTL, @testing-library/dom, jest-dom, user-event)
- `frontend/package-lock.json` (генерируемый)
- `frontend/vite.config.ts` (test.include → `src/**/*.test.{ts,tsx}`)
- `frontend/src/app/main.tsx` (обёртка `<Providers>`)
- `frontend/src/shared/api/errors.ts` (`export type ApiFailure`)
- `frontend/src/shared/api/testing/handlers.ts` (override-aware хендлер temporary-duty)
- `frontend/scripts/lint-canon.test.mjs` (негативный контроль uses-api-mutation + счётчик лога)

## Senior Developer Review (AI)

**Reviewer:** Bratan (bmad-story-automator-review, Claude Fable 5) · **Дата:** 2026-07-07 · **Outcome: Approve** (0 CRITICAL / 0 HIGH; 2 MEDIUM исправлены на месте; 2 LOW → Review Follow-ups)

**Верифицировано вживую (не по записям):**
- `npm run gate` — все 9 шагов зелёные: deps-gate 413 пакетов / schema-check / tsc -b / eslint / lint-canon **13 красных + 5 негативных** / schema-check.test / **vitest 60/60** (30 node + 30 jsdom) / vite build / size-gate **66.7 KB gzip ≤ 300 KB**.
- `make gate` (Backend/VAPS) — зелёный, **1841 passed**, ровно как заявлено; `Backend/**` не тронут (git status чист по бэку).
- AC 1–8: все реализованы, каждый доведён до исполняемого теста (пруфы: useApiMutation.test.tsx — 7 классов union по каналам + ассерт тела повтора `{...body, override: true, override_reason}`; ConflictDialog.test.tsx — границы 0/9/10/500/501 + trim + Escape L262; providers.test.tsx — E2E через реальную Providers; lint-canon — спящее правило + негативный контроль).
- Tasks 1–10: все [x] подтверждены кодом/диффами (package.json +1 dep +5 devDeps; vite include .tsx; ApiFailure в errors.ts; override-aware хендлер temporary-duty; счётчик лога 13+5).

**Найдено и исправлено (MEDIUM, документация):**
1. File List не отражал QA-проход: `providers.test.tsx` и `toast.test.tsx` существовали в git, но отсутствовали в стори → добавлены отдельной секцией с атрибуцией.
2. Итоги тестов устарели против реальности (в стори «+21, vitest 51/51», фактически после QA — 60/60) → добавлен QA-пункт в Completion Notes и запись в Change Log; исторические записи dev-стори не переписаны.

**Код-замечания:** сам прод-код чист — ветвление instanceof минификация-safe, StrictMode-идемпотентность соблюдена (conflict из onError, showModal с guard по .open), повтор ровно один раз из ref, каналы не текут (тесты ассертят отсутствие тоста/диалога в чужих ветках). LOW-дубли тест-хелперов — в Review Follow-ups, не блокируют.

## Change Log

- 2026-07-07 — Стори 8.5 реализована (bmad-dev-story): `useApiMutation` разветвляет ApiError-union по каналам протокола ARCH-FE-015 (форма/диалог/тост/state), общий `ConflictDialog` с валидацией причины 10–500 и override-повтором (`override`+`override_reason`), минимальный aria-live тост, `Providers` (react-query `retry: false`), override-aware MSW-фикстура, +21 тест (vitest 51/51), lint-canon 13+5. Гейты фронта и бэка зелёные; бандл 66.7 KB gzip (≤300 KB). Status → review.
- 2026-07-07 — QA-проход (bmad-qa-generate-e2e-tests): +9 тестов (3 E2E providers.test.tsx через реальную Providers-композицию, 3 toast.test.tsx с fake timers, +3 граничных перехода conflict-state) → vitest 60/60; 3 мутационные пробы подтвердили не-вакуумность; прод-код не тронут. Детали: tests/test-summary.md.
- 2026-07-07 — Ревью (bmad-story-automator-review): Approve. Гейты перепроверены вживую (фронт 60/60 + бандл 66.7 KB, бэк 1841 passed); 2 MEDIUM-находки (File List/итоги без QA-прохода) исправлены в стори; 2 LOW (дубли тест-хелперов) → Review Follow-ups. Status → done.
