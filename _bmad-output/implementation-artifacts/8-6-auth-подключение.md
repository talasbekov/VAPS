---
baseline_commit: 1ef7009d538ea2ce61c691981a47716bcedbe23c
---

# Story 8.6: Auth-подключение

Status: done

> **Контекст запуска:** шестая стори E8; baseline диффа: `1ef7009` (8.5 закоммичена целиком).
> Портал узнаёт «кто я и что мне можно»: credential (JWT / dev-заголовок X-User-Id) → apiClient,
> AuthContext + `usePermissions()` из `useQuery(['me'])`, route guards, 401 → редирект на вход.
> Приезжают react-router (минимально), RHF+zod (первая форма — вход). Layout/сайдбар/shadcn — 8.7.
> **Решения (создано в #YOLO-прогоне 2026-07-07):** Q1–Q4 = дефолты Д1–Д10, активны;
> подтвердить у Bratan при запуске dev-story.

## Story

As a оператор,
I want вход в портал (в dev/пилот-fallback — идентификатор X-User-Id, в контуре — JWT внешнего Auth), после которого apiClient несёт мой credential на каждом запросе, AuthContext знает «кто я», `usePermissions()` отдаёт мои права из `useQuery(['me'])` (GET `/api/operations/my-permissions/`), route guards скрывают недоступное, а протухший токен (401) молча возвращает меня на вход,
so that портал знает кто я и что мне можно (AR-2, NFR-2, UX-спайн EXPERIENCE L52), права живут ТОЛЬКО в Query-кэше без дублирования в state (ARCH-FE-010), и все экраны E9/E10 стартуют за готовыми guards.

## Acceptance Criteria

1. **Given** маршрут `/login` (константа из `shared/routes.ts`), **When** оператор вводит идентификатор пользователя (dev-путь X-User-Id) и подтверждает — мышью И клавиатурой (Enter, RTL keyboard path L262), **Then** credential сохранён (sessionStorage, переживает F5), каждый последующий запрос несёт заголовок `X-User-Id: <id>` (MSW-ассерт захваченных заголовков), выполняется редирект на исходно запрошенный маршрут (`state.from`) или `/`.
2. **Given** на `/login` вместо идентификатора вставлен JWT-токен, **Then** запросы несут `Authorization: Bearer <jwt>` и НЕ несут `X-User-Id` (ровно один заголовок — зеркало `build_auth_classes` бэка: JWT приоритетен, X-User-Id только dev); **Given** оба поля пусты или заполнены оба, **Then** submit заблокирован zod-схемой (refine «ровно одно») и запрос не уходит.
3. **Given** авторизованный пользователь, **Then** права приходят ЕДИНСТВЕННЫМ путём `useQuery({ queryKey: ['me'] })` → `GET /api/operations/my-permissions/` с типизированным из schema.d.ts ответом `{ permissions: string[] }`; `usePermissions().hasPermission(code)` учитывает wildcard `*` (ADMIN); права НИГДЕ не копируются в useState/Context-стейт (кэш Query — единственный источник, ARCH-FE-010); **Given** credential отсутствует, **Then** запрос `['me']` НЕ уходит вовсе (enabled-гейт; на проводе отсутствие credential даёт 403, а не 401 — см. Ловушку 1).
4. **Given** нет credential, **When** открывается защищённый маршрут, **Then** `RequireAuth` рендерит `<Navigate>` на `/login` БЕЗ единого сетевого запроса (MSW-ассерт: 0 запросов), исходный маршрут передан в `state.from`; **When** вход выполнен, **Then** возврат на исходный маршрут.
5. **Given** `['me']` загружен и нужного права нет (и нет `*`), **Then** `RequirePermission` НЕ рендерит контент маршрута — headless-заглушка «Доступ запрещён» (UX L203); **Given** право (или `*`) есть, **Then** рендерятся children; **Given** `['me']` ещё грузится, **Then** контент не рендерится (индикация — только состояние Query, свои isLoading-флаги запрещены L472/L487).
6. **Given** ЛЮБОЙ запрос (query И mutation) ответил 401 `AUTH_REQUIRED` (протухший/битый токен, MSW), **Then** credential очищен, кэш `['me']` сброшен, `RequireAuth` реактивно уводит на `/login` (без `window.location`); **Given** ответ 403 `PERMISSION_DENIED`, **Then** НЕТ ни редиректа, ни очистки credential (401 ≠ 403, UX L202-203); ветвление — по типизированному `ApiError.status`, парсинг Response вне apiClient не появился.
7. **Given** `@extend_schema` на `MyPermissionsViewSet` + `make schema` + `npm run generate:api`, **Then** schema.yaml и schema.d.ts содержат типизированный ответ `{ permissions: string[] }` вместо «No response body»; оба дрифт-гейта зелёные (`test_schema_drift` бэка, `schema-check.mjs` фронта); `make gate` бэка зелёный целиком, поведение эндпоинта не изменилось.
8. **Given** чистый клон (`npm ci && npm run gate`), **Then** зелёный целиком: eslint (boundaries чисты для `shared/auth/` и `features/auth/`), lint-canon с обновлённым счётчиком и новым негативным контролем, vitest (старые 60 + новые), vite build + size-gate ≤300КБ с react-router+RHF+zod в бандле; строковые literal-пути в navigate/Route — только константы `routes.ts` (ревью-правило ARCH-FE-012, линт-ужесточение — 8.7).

## Tasks / Subtasks

- [x] Task 1: Зависимости (AC: 8)
  - [x] `npm i react-router@^7.18.1` — буква канона L225 (v7, library-режим, ЕДИНЫЙ пакет; `react-router-dom` — легаси-шим, не ставить; `@tanstack/react-router` забанен); `npm i react-hook-form@^7.81.0 zod@^4.4.3 @hookform/resolvers@^5.4.0` (registry 2026-07-07; RHF peer react ^19 ok)
  - [x] Убедиться: deps-gate/banned-packages не задеты (react-router не в бан-листе — проверено на baseline)
- [x] Task 2: Бэк-минимум — типизировать my-permissions (AC: 7) — ДО Task 7, иначе tsc не даст типа
  - [x] `apps/operations/api/views.py` (L122-133): `@extend_schema(responses=inline_serializer(name="MyPermissionsResponse", fields={"permissions": serializers.ListField(child=serializers.CharField())}))` на list-метод `MyPermissionsViewSet` (это `viewsets.ViewSet`); поведение НЕ менять; нужны НОВЫЕ импорты — `from drf_spectacular.utils import extend_schema, inline_serializer` и `from rest_framework import serializers` (в файле их нет, только `status, viewsets`)
  - [x] `make schema` (Backend/VAPS) → `npm run generate:api` (frontend) — schema.yaml + schema.d.ts перегенерены; `make gate` бэка зелёный (baseline 1841 passed)
- [x] Task 3: `src/shared/routes.ts` — зачаток канон-слота (AC: 1, 4)
  - [x] `export const ROUTES = { login: '/login', home: '/' } as const` — слот назван каноном поимённо (L555); 8.7 расширит картой UX L59-68; в 8.6 ни одного literal-пути вне констант
- [x] Task 4: `src/shared/auth/credential.ts` — credential store (AC: 1, 2, 6)
  - [x] Тип `Credential = { kind: 'dev'; userId: string } | { kind: 'jwt'; token: string }`; хранение sessionStorage (JSON, один ключ); API: `getCredential/setCredential/clearCredential/subscribe/getSnapshot` (совместимо с `useSyncExternalStore`); значение живёт В ПАМЯТИ модуля (стабильная ссылка), sessionStorage — только персистенция (гидратация на init + запись в set/clear); отсутствие sessionStorage (node-импорт) переживать грациозно (`typeof sessionStorage !== 'undefined'`)
  - [x] Экспорт мутируемого `authHeaders: Record<string, string>` (`X-User-Id: …` ЛИБО `Authorization: Bearer …` — ровно один); set/clear синхронно обновляют и storage, и authHeaders; подключение к клиенту БЕЗ правки транспорта — спред `{ ...defaultHeaders }` в client.ts L35 читает объект В МОМЕНТ запроса (обещание Д6-8.4: «8.6 подключит через defaultHeaders»)
- [x] Task 5: `client.ts` — одна строка (AC: 1, 2)
  - [x] L68: `export const apiClient = createApiClient({ defaultHeaders: authHeaders })`; транспорт/парсинг НЕ трогать; `client.test.ts` (8.4) НЕ трогать — он на локальных `createApiClient(...)`
- [x] Task 6: `src/shared/auth/AuthContext.tsx` (AC: 1, 4)
  - [x] `AuthProvider` + `useAuth(): { userId: string | null; login(c: Credential): void; logout(): void }`; состояние — `useSyncExternalStore` над credential store (клиентский auth-state, НЕ серверные данные — дублирования Query-кэша нет); `logout()` = `clearCredential()` + `queryClient.removeQueries({ queryKey: ['me'] })` (не invalidate — рефетч без credential словил бы 403)
  - [x] Контекст живёт в shared, app монтирует (комментарий providers.tsx L1-2 — уже канон)
- [x] Task 7: `src/shared/auth/usePermissions.ts` (AC: 3)
  - [x] `useMe()`: `useQuery({ queryKey: ['me'], queryFn: () => apiClient.get<…>('/api/operations/my-permissions/'), enabled: Boolean(credential) })` — ключ `['me']` дословно из канона (ARCH-FE-010 L237); тип ответа — ИЗ schema.d.ts (`paths['/api/operations/my-permissions/']['get']`…), рукописный тип запрещён (ARCH-FE-011)
  - [x] enabled-гейт РЕАКТИВЕН: credential читается через useAuth/useSyncExternalStore (не однократный снапшот) — после login() запрос стартует сам, после 401-очистки гаснет
  - [x] `usePermissions(): { permissions: ReadonlySet<string> | undefined; hasPermission(code: string): boolean; isLoading; error }`; `hasPermission` = `has('*') || has(code)` (wildcard ADMIN из seed); иерархий/префиксов НЕ вводить (плоский список 21 кода)
- [x] Task 8: `src/shared/auth/guards.tsx` (AC: 4, 5)
  - [x] `RequireAuth({ children })`: нет credential → `<Navigate to={ROUTES.login} state={{ from: location }} replace />` — ДО любых запросов; `RequirePermission({ permission, children })`: на данных `['me']` — загрузка → Query-заглушка; нет права → headless «Доступ запрещён» (копирайт UX L203); есть право/`*` → children
  - [x] Headless без стилей (Tailwind/shadcn — 8.7); импорт `Navigate/useLocation` из `react-router` легален в shared (пакет, не слой)
- [x] Task 9: `src/features/auth/LoginPage.tsx` (AC: 1, 2)
  - [x] Первая форма проекта: RHF (uncontrolled) + zod (канон L246; resolver — Ловушка 5): поля «Идентификатор (X-User-Id)» и «JWT-токен», zod-refine «ровно одно заполнено»; submit → `login(credential)` → `navigate(state.from ?? ROUTES.home)`; Enter-submit обязателен (keyboard path L262); headless без стилей
- [x] Task 10: app — providers.tsx + App.tsx (AC: 1, 4, 6)
  - [x] `createQueryClient()`: + `queryCache: new QueryCache({ onError })` И `mutationCache: new MutationCache({ onError })` — общий `handle401(error)`: `error instanceof ApiError && error.status === 401` → `clearCredential()` + сброс `['me']`; 403 НЕ трогает credential; существующий `mutations: { retry: false }` сохранить; chicken-egg «onError нужен client до его создания» — let-биндинг/замыкание на переменную, присваиваемую после `new QueryClient(...)`
  - [x] `Providers`: `<QueryClientProvider><AuthProvider><ToastProvider>…` (AuthProvider внутри Query — ему нужен queryClient); `App.tsx`: `App = <BrowserRouter><AppRoutes /></BrowserRouter>`, где `AppRoutes` — экспортируемый `<Routes>`: `ROUTES.login` → LoginPage; `ROUTES.home` → `<RequireAuth>` (текущая заглушка «Каркас портала» как Home); экспорт `AppRoutes` — чтобы E2E-тесты оборачивали его в MemoryRouter с initialEntries (BrowserRouter в тесте не даёт задать стартовый маршрут); живой разводки по правам НЕТ до 8.7 — RequirePermission покрывается тестами
- [x] Task 11: MSW-фикстуры (AC: 1, 2, 3, 6)
  - [x] `testing/handlers.ts`: `GET */api/operations/my-permissions/` → 200 `{ permissions: [...] }` (+ вариант `['*']`); `authRequiredEnvelope` (401, error_code `AUTH_REQUIRED`) — конверт §36 как существующие; захват заголовков запросов — массивом (урок 8.4/8.5)
- [x] Task 12: Тесты (AC: 1–6)
  - [x] `credential.test.ts` (jsdom — в node-окружении vitest НЕТ sessionStorage): set/clear ↔ sessionStorage ↔ authHeaders (ровно один заголовок), subscribe-уведомления; гидратация из storage на init
  - [x] `usePermissions.test.tsx` (jsdom): wildcard `*`; enabled-гейт — без credential 0 запросов (MSW-капчер пуст); типизированный ответ
  - [x] `guards.test.tsx` (jsdom, MemoryRouter): redirect на login + `state.from` + возврат; «Доступ запрещён» без права; children при праве/`*`; 0 сетевых запросов без credential
  - [x] `LoginPage.test.tsx` (jsdom, RTL+user-event): zod-валидация (пусто/оба), Enter-submit, header-ассерты X-User-Id vs Bearer через MSW-капчер
  - [x] E2E-флоу через РЕАЛЬНУЮ Providers-композицию (прецедент QA 8.5): login → запрос с заголовком → 401 → credential очищен → на `/login`; 403 → остаёмся, credential цел
- [x] Task 13: lint-canon (AC: 8)
  - [x] Негативный контроль: фикстура features → импорт `usePermissions` из `shared/auth/usePermissions` прямым путём → `expectClean`; обновить счётчик финального лога (L302: было «13 красных + 5 негативных»); barrel-index в `shared/auth/` НЕ создавать (скан забанит)
- [x] Task 14: Красные пробы и верификация (AC: 3, 6, 7, 8)
  - [x] Красные пробы вживую (Debug Log): (а) сломать wildcard (игнор `*`) → тест красный; (б) убрать enabled-гейт → тест «0 запросов без credential» красный; (в) заставить 403 чистить credential → тест разделения 401/403 красный; (г) откатить `@extend_schema` → `schema-check` красный (дрифт)
  - [x] Чистые прогоны: `npm ci && npm run gate` зелёный; `make gate` (Backend/VAPS) зелёный; зафиксировать новый размер бандла (react-router+RHF+zod; бюджет ≤300КБ — запас от 66.7 KB gzip большой)

## Dev Notes

### Архитектурные гварды (обязательны, источник — architecture.md)

- **ARCH-FE-010** (L237/L759) — ядро стори: «2 Context (Auth/Theme); currentUser/права = `useQuery(['me'])`». MUST NOT: дублирование Query-кэша в useState; серверные данные вне queryClient. Права — ТОЛЬКО в Query; AuthContext хранит лишь клиентский credential-state (кто вошёл), не права.
- **ARCH-FE-012** (L239/L761): «React Router (plain Routes) + `src/shared/routes.ts` (все пути — константы/фабрики)». MUST NOT: TanStack Router (забанен в banned-packages.mjs L29); строковые literal-пути вне routes.ts (пока ревью-правило; линт — 8.7). Версия: L225 «актуальный мажор v7 (library-режим)» → v7 (Q1: v8 уже вышел).
- **ARCH-SEC-030** (L317/L756): идентичность = `request.user_context`/`actor_id`, наполняется X-User-Id middleware, при JWT меняется ТОЛЬКО middleware. Для фронта: оба пути дают одинаковый user_context (5.1 AC L660-661) — SPA шлёт РОВНО ОДИН заголовок и не различает режимы после входа.
- **ARCH-SEC-031** (L318/L757): авторизация — только PermissionService, права на КАЖДЫЙ запрос, без кэша в сессии; отзыв права действует со следующего запроса — это СЕРВЕРНАЯ гарантия. Клиентские guards — UX-слой (скрыть маршрут), НЕ замена серверной проверки: обход UI упрётся в 403.
- **ARCH-FE-011** (L238/L760): типы — только из schema.d.ts; MUST NOT «ручные типы при наличии схемы» → тело `my-permissions` чинится на бэке аннотацией (Task 2), НЕ рукописным типом.
- **ARCH-FE-013** (L240/L762): boundaries — shared→только shared; features→shared+своя фича; app→всё. `shared/auth/` и `features/auth/` вписываются в матрицу eslint-boundaries без правок конфига. БЕЗ barrel-index.
- **ARCH-FE-014** (L241/L763): Tailwind/shadcn НЕТ до 8.7 → LoginPage и «Доступ запрещён» — headless без стилей; CSS-in-JS запрещён; hex-цвета не вводить.
- **ARCH-FE-015** (L242/L764): парсинг статусов — только apiClient (закрыто 8.4); 401-ветвление в 8.6 — по типизированному `ApiError.status` в QueryCache/MutationCache onError, НЕ парсинг Response. Мутации в features — только `useApiMutation` (8.5).
- **Канон форм L246/L472**: RHF (uncontrolled) + zod (мгновенно) + DRF (истина); вход — первая форма проекта (обещание Д3-8.5: «RHF придёт с первой формой — 8.6»).
- **L262**: RTL keyboard path — в DoD каждой формо-стори → Enter-submit LoginPage обязателен в тесте.
- **СТОП-канон L33**: token storage, механика логина, 401-редирект architecture.md НЕ определяет (молчание) → зафиксированы дефолтами Д1-Д10 с Q-листом для Bratan (#YOLO-прецедент 8.4/8.5).

### Ground truth бэка (baseline 1ef7009) — на чём стоит «вход»

- **Login-эндпоинта НЕТ и не будет**: VAPS не хранит паролей (PRD L179), токен выпускает внешний Auth (INT-2, контракт не определён). Стори 5.1 (done) — это ДВА способа извлечь идентичность из запроса: `JWTAuthentication` (`apps/core/auth/authentication.py` L40-116: `Authorization: Bearer` → PyJWT-верификация → `request.actor_id` из `sub`; битый токен → 401) и `XUserIdAuthentication` (L7-27: заголовок → actor_id, никогда не 401).
- **Цепь auth** (`config/settings.py` L163-172, `build_auth_classes`): JWT → X-User-Id (ТОЛЬКО когда `VAPS_JWT is None`, т.е. dev) → `EffectivePermissionsResolver`. В проде X-User-Id игнорируется; прод без `VAPS_JWT_KEY` — `ImproperlyConfigured` (fail-closed). SPA-зеркало: JWT приоритетен, слать ровно один заголовок.
- **«Кто я» = только права**: `GET /api/operations/my-permissions/` (`apps/operations/api/views.py` L122-133, urls.py L17) → `{"permissions": sorted(perms)}`; НЕТ username/роли/display-name ни в одном API. Профиль для шапки — будущая бэк-стори, в 8.6 НЕ строить (Д4).
- **Права**: `PermissionService.effective_permissions(user_id)` (`apps/operations/services.py` L47-60) — объединение прав активных ролей + дежурств; wildcard `*` = ADMIN (`has_permission` L62-67). Seed (`seed_operations.py` L5-40): 21 право (`status.view`, `daily_report.mark_update`, `audit.view`, `admin.roles`, `*`…), 8 ролей.
- **401/403 на проводе** (`apps/core/api/exception_handler.py`, маппинг L43-48): 400→VALIDATION_ERROR, **401→AUTH_REQUIRED (всегда — TOKEN_INVALID из реестра НЕ эмитится)**, 403→PERMISSION_DENIED, 404→ENTITY_NOT_FOUND; конверт §36 `{error_code, message, details, request_id, timestamp}`. Реестр: `docs/registries/error-codes.yaml` L52-77 (AUTH_REQUIRED, TOKEN_INVALID, PERMISSION_DENIED, USER_INACTIVE).
- **⚠️ Отсутствие credential ≠ 401**: `DEFAULT_PERMISSION_CLASSES = []`, `UNAUTHENTICATED_USER = None`; без actor_id `my-permissions` (и гейты 2.13/2.14) дают **403 PERMISSION_DENIED**, а не 401. 401 возникает ТОЛЬКО при предъявленном-но-невалидном JWT. Отсюда двухуровневая механика: «не залогинен» ловится guard'ом по credential-state ДО запроса (enabled-гейт), 401 = «токен протух» → глобальный logout.
- **schema-разрыв**: в schema.d.ts (L2288-2305) и schema.yaml (L1272-1279) ответ `my_permissions_retrieve` = «No response body» (plain ViewSet без сериализатора) → Task 2 чинит аннотацией `@extend_schema` + regen. Поведение эндпоинта не меняется, RBAC-матрица 2.9 не расширяется (эндпоинт уже существует).

### Фактура фронта (ground truth на baseline)

- **client.ts**: `createApiClient({ baseUrl, defaultHeaders })`; спред `{ ...defaultHeaders }` per-request (L35) — объект читается В МОМЕНТ запроса → мутируемый `authHeaders` подключается ОДНОЙ строкой в L68 без правки транспорта (это обещание Д6-8.4, комментарии L6/L15 прямо называют 8.6). `apiClient` — синглтон, импортируется хуками.
- **errors.ts**: 401/403 приходят БАЗОВЫМ `ApiError` (`kind='api'`, поля `status/errorCode/details/requestId`) — switch L167-176 спец-обрабатывает только 400/422/409. Отдельного Unauthorized-класса НЕТ → ветвление по `error.status === 401`. `ApiFailure = ApiError | NetworkError` (8.5).
- **useApiMutation (8.5)**: 401/403/404 уходят в `mutation.error` — «401-редирект — 8.6» зафиксирован в 8.5 как forward-ref; в 8.6 401 ловится ГЛОБАЛЬНО в MutationCache/QueryCache onError (providers), сам хук НЕ правится.
- **providers.tsx**: `createQueryClient()` (mutations retry:false) + ToastProvider; комментарий L1-2 «контексты живут в shared, app монтирует» — паттерн для AuthProvider. **main.tsx**: StrictMode > Providers > App; BrowserRouter отсутствует. **App.tsx**: заглушка «Экраны появятся в сториях 8.6–8.7» — становится Home за RequireAuth.
- **eslint.config.js**: `@tanstack/react-router` забанен (banned-packages.mjs L29), `react-router` НЕ забанен (комментарий L28: «канон = React Router plain»); boundaries: app(src/app/**), features(src/features/*), shared(src/shared/**) — новые папки вписываются; fetch/XHR вне shared/api забанены; `useMutation` в features забанен (активно).
- **lint-canon.test.mjs**: 13 красных + 5 негативных контролей (счётчик L302); фикстуры `__canon_*_<PID>__`; в src/ запрещены barrel index.ts и не-TS файлы. handlers.ts: конверт-фикстуры 400/409/422/500/502/network; auth-фикстур нет.
- **gate-цепочка**: `deps-gate → schema-check → tsc -b → eslint → lint-canon → schema-check.test → vitest run → vite build → size-gate`; vitest 60/60 на baseline; бандл 66.7 KB gzip / бюджет 300 КБ.
- **Версии registry 2026-07-07**: react-router 7.18.1 (v7-ветка; v8.1.0 вышел — Q1), react-hook-form 7.81.0, zod 4.4.3, @hookform/resolvers 5.4.0.

### Ловушки

1. **Отсутствие credential ≠ 401** (главная): бэк отдаёт 403 PERMISSION_DENIED на запрос без заголовков. НЕ строить «не залогинен» на 401: RequireAuth гейтит по credential-state ДО запроса, `['me']` — `enabled: Boolean(credential)`. Тест «0 запросов без credential» обязателен.
2. **401 всегда AUTH_REQUIRED**: exception_handler не эмитит TOKEN_INVALID/USER_INACTIVE (маппинг по статусу L43-48) — не ветвиться по этим кодам, только `status === 401`.
3. **QueryCache ≠ MutationCache**: глобальный onError вешается на ОБА кэша (`new QueryClient({ queryCache: new QueryCache({onError}), mutationCache: new MutationCache({onError}), defaultOptions: … })`) — существующий `mutations: { retry: false }` сохранить.
4. **logout/401 → `removeQueries(['me'])`, НЕ invalidate**: invalidate рефетчнёт без credential и получит 403 (лишний запрос + шум в error-стейтах).
5. **resolvers × zod 4**: `zodResolver` из `@hookform/resolvers/zod` — проверить поддержку zod v4 в resolvers 5.4 (zod 4 реализует Standard Schema; fallback — `standardSchemaResolver`). Верифицировать при установке, не верить на слово.
6. **react-router v7 = единый пакет** `react-router` (BrowserRouter/MemoryRouter/Navigate/useLocation — всё из него); `react-router-dom` — легаси-шим, не ставить. В тестах — MemoryRouter (jsdom без history-заморочек).
7. **useSyncExternalStore для credential** (StrictMode double-render safe), НЕ useState+useEffect-синхронизация; подписка идемпотентна; **getSnapshot возвращает СТАБИЛЬНУЮ ссылку** (кэшированное in-memory значение) — новый объект/JSON.parse на каждый вызов = «The result of getSnapshot should be cached» и бесконечный ре-рендер.
8. **sessionStorage в тестах**: есть ТОЛЬКО в jsdom (`// @vitest-environment jsdom` докблок первой строкой — vitest 4 удалил environmentMatchGlobs, урок 8.5); в node-окружении `sessionStorage` undefined. Чистить в afterEach вместе с authHeaders (иначе протекание между тестами); MSW-капчеры заголовков — массивом, не `let` (урок 8.4).
8а. **Механика компонентных тестов = уроки 8.5 дословно**: jest-dom подключать per-file (`import '@testing-library/jest-dom/vitest'` в `.test.tsx`), НЕ в общий vitest.setup.ts (он гоняется и в node-тестах); vitest globals выключены → авто-cleanup RTL не регистрируется — явный `afterEach(cleanup)` в каждом `.test.tsx`.
9. **AuthProvider внутри QueryClientProvider**: logout() зовёт useQueryClient — порядок композиции обязателен.
10. **Порядок задач**: Task 2 (regen схемы) ДО Task 7 — иначе тип ответа `content?: never` и tsc красный.
11. **Кириллица в пути репо**: правки node-скриптов (lint-canon) — `fileURLToPath(new URL(...))`, не `.pathname` (закреплённый урок 8.1-8.5).
12. **`location.state` в react-router фактически нетипизирован** (`any`) — ОБРАЩАТЬСЯ с ним как с unknown и наррowить перед navigate (tsc ошибку может и не дать — дисциплина, не компилятор).

### Дефолты (Д) и вопросы Bratan (Q)

- **Д1 (ГЛАВНЫЙ)**: «вход» = страница `/login` внутри SPA с двумя взаимоисключающими способами: идентификатор (X-User-Id, dev + пилот-fallback A6) и вставка готового JWT (внешний Auth INT-2 без redirect-flow — контракта нет). Отвергнуто: OIDC-редирект (нет контракта), форма пароля (VAPS не хранит паролей, PRD L179), env-only идентичность (не даёт AC «вход»).
- **Д2**: хранение credential — sessionStorage (переживает F5, гаснет с вкладкой; закрытый LAN — XSS-риск принят; httpOnly-cookie невозможен: токен выдаёт внешний сервис, бэк stateless). architecture.md молчит → СТОП-кандидат, зафиксирован как Q2.
- **Д3**: минимальный роутер приезжает в 8.6 (guards без роутера не живут: AC эпика требует «401 → редирект», «guard скрывает маршрут»); живые маршруты только `/login` и `/`; routes.ts — зачаток; полная карта (UX L59-68), layout, сайдбар — 8.7. Версия v7 по букве L225.
- **Д4**: `['me']` наполняется my-permissions (единственный источник); профиль (имя/роль в шапке) НЕ строим — бэк-источника нет, будущая бэк-стори; ключ `['me']` дословно из канона.
- **Д5**: бэк-правка = ТОЛЬКО схемная аннотация `@extend_schema` (поведение не меняется); альтернатива «рукописный тип на фронте» отвергнута — прямой MUST NOT ARCH-FE-011.
- **Д6**: RHF+zod ставятся сейчас (первая форма, канон L246, обещание Д3-8.5). Отвергнуто: голая форма (вторая форма E9 переписывала бы вход).
- **Д7**: 401-механика двухуровневая: QueryCache/MutationCache onError чистит credential + сбрасывает `['me']`; НАВИГАЦИЮ делает RequireAuth реактивно (useSyncExternalStore) — без `window.location` и без роутер-зависимости в QueryClient. 403 credential не трогает.
- **Д8**: подключение заголовков — мутируемый `authHeaders` из credential.ts + одна строка в client.ts L68 (спред per-request); транспорт не правится (обещание Д6-8.4). Отвергнуто: функция-defaultHeaders (правка типа транспорта), пересоздание синглтона (импорты по всему коду).
- **Д9**: `hasPermission` = wildcard `*` ∨ точное совпадение; иерархий/префиксов не вводить (плоский seed из 21 кода).
- **Д10**: политики Query для `['me']` — дефолтные (staleTime 0, штатный refetch): ARCH-SEC-031 (отзыв со следующего запроса) — серверная гарантия, клиентский кэш — UX-слой; спец-инвалидация прав (WS) — E11.
- **Q1 = Д3**: минимальный роутер в 8.6 + react-router v7 (буква канона L225) — ок? (v8.1.0 уже вышел — «актуальный мажор» теперь v8; апгрейд позже дешёвый)
- **Q2 = Д1+Д2**: механика входа (страница с X-User-Id/JWT-вставкой, sessionStorage) — ок для dev и пилот-fallback A6?
- **Q3 = Д5**: минимальная бэк-правка `@extend_schema` в этой стори (двухстековость осознанна) — ок, или отдельная бэк-стори?
- **Q4 = Д6**: RHF+zod сейчас (первая форма) — ок?

### Границы стори (не расползаться)

- **НЕТ**: layout/сайдбар/шапка/shadcn/Tailwind и роль-фильтрация навигации (8.7); полная карта маршрутов и гейтов UX L59-68 + линт literal-путей (8.7); OIDC/redirect-flow внешнего Auth (INT-2 без контракта); профиль/display-name (нет бэк-источника — будущая стори); logout-кнопка в UI (механика `logout()` — здесь, кнопка — 8.7); is_active-enforcement и эмиссия TOKEN_INVALID/USER_INACTIVE (бэк, дефер 1.2/5.1); scope-гейтинг «своё поддерево» (серверный, экраны E9/E10); view-only по «Откомандирован» (E9/E10); live-инвалидация прав по WS (E11); тост на 401 (молчаливый редирект по UX L202).
- **НЕ трогать**: `Backend/**` КРОМЕ схемной аннотации Task 2 (authentication.py, PermissionService, rbac, exception_handler — не трогать); `errors.ts`/`useApiMutation.ts`/`ConflictDialog`/`toast` (8.4/8.5 — как есть); транспорт `client.ts` кроме L68; тесты 8.4/8.5; gate-цепочку package.json (состав шагов); `scripts/{deps-gate,size-gate,schema-check}*.mjs`; `docs/registries/*.yaml`.

### Project Structure Notes

- Файлы create: `frontend/src/shared/routes.ts`, `frontend/src/shared/auth/credential.ts`, `frontend/src/shared/auth/AuthContext.tsx`, `frontend/src/shared/auth/usePermissions.ts`, `frontend/src/shared/auth/guards.tsx`, `frontend/src/features/auth/LoginPage.tsx` (+ тесты: credential.test.ts, usePermissions.test.tsx, guards.test.tsx, LoginPage.test.tsx — вне лимита).
- Файлы modify: `frontend/src/shared/api/client.ts` (одна строка L68), `frontend/src/app/providers.tsx`, `frontend/src/app/App.tsx`, `frontend/package.json` (+4 deps) + `package-lock.json` (генерируемый), `frontend/src/shared/api/testing/handlers.ts`, `frontend/scripts/lint-canon.test.mjs`, `Backend/VAPS/apps/operations/api/views.py` (аннотация) + `Backend/VAPS/schema.yaml` и `frontend/src/shared/api/schema.d.ts` (генерируемые).
- **Новые слоты — вариации зафиксированы**: `shared/auth/` не назван в каноне L554-555 (api/ui/lib/routes.ts) — добавляется как слот-зеркало бэкового `core/auth`; `features/auth/` отсутствует в списке фич L551-553 — технический вход (не бизнес-фича). Обе папки вписываются в boundaries-матрицу без правки конфига.
- **BMAD-размер**: 6 create + 7 modify (без генерируемых) — вариация против «≤5 файлов» осознанна: эпик определил 8.6 одной сквозной сторей (credential→клиент→контекст→права→guards→вход неделимы: AC связывает их в один флоу), прецеденты 8.4/8.5. Двухстековость (фронт + схемная аннотация бэка) — осознанная вариация в духе п.3 правил декомпозиции (п.3 буквально про две Django-app; здесь — та же логика cross-зависимости контракта): аннотация = декоратор + 2 импорта + regen, поведение бэка не меняется.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.6 (L1042-1048)] — текст стори и AC; L1050-1056 (8.7 — граница), L1026-1040 (8.4/8.5 — фундамент)
- [Source: _bmad-output/planning-artifacts/epics.md L77-78 (FR-33/34), L90 (NFR-2), L104 (AR-2), L122 (UX-4), L195 (coverage E8), L248-254 (правила декомпозиции), L265 (риск A6), L654-662 (5.1 вход), L287-295 (1.2 identity), L464-470 (2.9 RBAC-матрица)]
- [Source: _bmad-output/planning-artifacts/architecture.md L237/L759 (ARCH-FE-010), L238/L760 (FE-011), L239/L761 (FE-012), L240/L762 (FE-013), L241/L763 (FE-014), L242/L764 (FE-015), L225 (React Router v7), L246 (RHF+zod), L262 (keyboard path), L317/L756 (ARCH-SEC-030), L318/L757 (ARCH-SEC-031), L33 (СТОП-канон), L434 (401/403 семантика), L472/L487 (Query-канон), L509 (core/auth), L550-555 (структура фронта)]
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md L152-155 (RBAC/scope), L179 (нет паролей), L245 (сессии/безопасность), L254 (INT-2 JWT)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md L52 (спайн 8.6 дословно), L54 (вход → Дашборд), L59-68 (карта маршрут→право — для 8.7), L76 (view-only), L202-203 (401 redirect / 403 «доступ запрещён»), L212 (view-only состояние)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/.decision-log.md L32-33 (8 ролей, права из useQuery(['me']))] — login-мокапа в mockups/ НЕТ (вход внешний)
- [Source: Backend/VAPS/apps/core/auth/authentication.py L7-27 (XUserId), L40-116 (JWT)] — двойной путь идентичности
- [Source: Backend/VAPS/config/settings.py L112-172 (jwt_config_from_env, build_auth_classes)] — приоритет JWT, dev-условие X-User-Id
- [Source: Backend/VAPS/apps/operations/api/views.py L122-133 (MyPermissionsViewSet), apps/operations/api/urls.py L17, apps/operations/services.py L47-67 (PermissionService, wildcard), apps/operations/management/commands/seed_operations.py L5-40 (21 право, 8 ролей)]
- [Source: Backend/VAPS/apps/core/api/exception_handler.py L43-48 (маппинг статус→код), docs/registries/error-codes.yaml L52-77 (AUTH_REQUIRED/TOKEN_INVALID/PERMISSION_DENIED/USER_INACTIVE)]
- [Source: frontend/src/shared/api/client.ts L15 (точка расширения 8.6), L35 (спред per-request), L68 (синглтон); errors.ts L167-176 (401 → базовый ApiError); schema.d.ts L2288-2305 (my-permissions «No response body»)]
- [Source: frontend/eslint.config.js + scripts/banned-packages.mjs L29 (@tanstack/react-router бан, react-router легален); scripts/lint-canon.test.mjs L302 (счётчик 13+5)]
- [Source: _bmad-output/implementation-artifacts/5-1-вход-оператора.md (что реально построила 5.1: НЕТ login-UI/паролей/is_active), 8-5-useapimutation-и-conflictdialog.md (401 — forward-ref в 8.6; уроки капчеров/jsdom)]
- Версии registry 2026-07-07: react-router 7.18.1 (v8.1.0 вышел — Q1), react-hook-form 7.81.0, zod 4.4.3, @hookform/resolvers 5.4.0

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Fable 5) — bmad-dev-story, 2026-07-07

### Debug Log References

Красные пробы Task 14 — все четыре доказаны вживую и откачены:

- (а) hasPermission без wildcard (`permissions.has(code)` вместо `has('*') || has(code)`) → 2 красных: `usePermissions.test` «wildcard \`*\` даёт ЛЮБОЕ право», `guards.test` «wildcard открывает любой маршрут».
- (б) `enabled: true` вместо `enabled: credential !== null` → 2 красных: «без credential запрос НЕ уходит вовсе», «enabled-гейт РЕАКТИВЕН».
- (в) handle401 расширен на 403 → 2 красных: «mutation → 403: НЕТ ни редиректа, ни очистки», «QueryCache onError: 403 НЕ трогает…».
- (г) `git stash` аннотации views.py (под VAPS_DB=postgres, как в gate) → `test_schema_yaml_matches_fresh_generation` красный; после отката — 3 passed.

Инцидент по пути: первый прогон eslint поймал `guards.test.tsx` (shared) → импорт LoginPage (features) — нарушение матрицы ARCH-FE-013 самим тест-файлом; тест «возврат на state.from» переехал в `LoginPage.test.tsx` (features → shared легален). Матрица работает и на тестах.

### Completion Notes List

- Решения Q1–Q4 = дефолты Д1–Д10 (#YOLO-прогон 2026-07-07) — реализованы как активные; подтверждение Bratan на ревью: v7 react-router (Q1), /login с X-User-Id/JWT-вставкой + sessionStorage (Q2), схемная бэк-аннотация в этой стори (Q3), RHF+zod сейчас (Q4).
- Task 2 (нюанс сверх спеки): голый `@extend_schema(responses=inline_serializer(...))` на `list`-методе даёт ОБЁРТКУ-МАССИВ (эвристика плюральности drf-spectacular по action == "list") — реальный ответ одиночный объект. Задокументированное лекарство: `extend_schema_serializer(many=False)(inline_serializer(...))`. Побочно operationId сменился `operations_my_permissions_retrieve` → `operations_my_permissions_list` (конвенция spectacular при появлении response-схемы; фронт типизируется по paths, не по operationId — риппла нет).
- Ловушка 5 проверена: `@hookform/resolvers` 5.4.0 поддерживает zod v4 нативно (в типах `zod/v4/core`) — `zodResolver` работает, fallback standardSchemaResolver не понадобился.
- Синглтон `apiClient` (baseUrl '') под MSW в jsdom работает с относительными URL (интерсептор резолвит против location) — «Ловушка 1» 8.4 актуальна только для node-окружения.
- `useAuth().userId`: для JWT — null (SPA токен не разбирает, sub извлекает бэк ARCH-SEC-030; профиль-API нет, Д4); «залогинен ли» гейты читают по credential-state, не по userId.
- 401 на query ретраится дефолтной политикой Query (3 попытки, ~7 c) до глобального logout — осознанное следствие Д10 («политики дефолтные»); mutation (retry: false) разлогинивает мгновенно. Кандидат на донастройку в 8.7+, если UX-заметно.
- `clearCredential()` идемпотентен (повторный clear не будит подписчиков) — двойной вызов handle401 (QueryCache + MutationCache) не даёт лишних ре-рендеров.
- Гейты: фронт `npm ci && npm run gate` зелёный целиком; бандл 108.0 KB gzip (было 66.7; бюджет 300) — react-router+RHF+zod обошлись в ~41 KB. Бэк `make gate` зелёный, 1841 passed (ровно baseline). Vitest: 90 (60 baseline + 30 новых).

### File List

Создано:
- frontend/src/shared/routes.ts
- frontend/src/shared/auth/credential.ts
- frontend/src/shared/auth/AuthContext.tsx
- frontend/src/shared/auth/usePermissions.ts
- frontend/src/shared/auth/guards.tsx
- frontend/src/features/auth/LoginPage.tsx
- frontend/src/shared/auth/credential.test.ts
- frontend/src/shared/auth/usePermissions.test.tsx
- frontend/src/shared/auth/guards.test.tsx
- frontend/src/features/auth/LoginPage.test.tsx
- frontend/src/app/auth-flow.test.tsx
- frontend/src/app/auth-flow.qa.test.tsx (QA-проход, bmad-qa-generate-e2e-tests: +5 E2E)

Изменено:
- frontend/src/shared/api/client.ts (импорт authHeaders + одна строка L68)
- frontend/src/app/providers.tsx (QueryCache/MutationCache onError → handle401; AuthProvider в композиции)
- frontend/src/app/App.tsx (BrowserRouter + экспортируемый AppRoutes)
- frontend/src/shared/api/testing/handlers.ts (my-permissions фикстуры + 401/403 конверты)
- frontend/scripts/lint-canon.test.mjs (негативный контроль usePermissions; счётчик 13+6)
- frontend/package.json (+react-router, react-hook-form, zod, @hookform/resolvers)
- frontend/package-lock.json (генерируемый)
- Backend/VAPS/apps/operations/api/views.py (схемная аннотация MyPermissionsViewSet.list)
- Backend/VAPS/schema.yaml (генерируемый, make schema)
- frontend/src/shared/api/schema.d.ts (генерируемый, npm run generate:api)
- _bmad-output/implementation-artifacts/sprint-status.yaml (статус стори)
- _bmad-output/implementation-artifacts/tests/test-summary.md (QA-сводка 8.6)

## Senior Developer Review (AI)

Ревьюер: Bratan (bmad-story-automator-review, Claude Fable 5) · Дата: 2026-07-07 · Вердикт: **Approve** (после авто-фиксов)

Верификация чужих заявлений (не на слово): фронт `npm run gate` — все 9 шагов зелёные (vitest 95/95 до фиксов, lint-canon 13+6, бандл 108.0 KB gzip / бюджет 300); бэк `make gate` — **1841 passed, ruff чист, makemigrations --check чист** (перепрогнан на ревью). Схемный дифф проверен: `MyPermissionsResponse` одиночный объект (не массив — `many=False` сработал), смена operationId `retrieve→list` риппла не даёт (фронт типизируется по paths). Все 14 задач и 8 AC сверены с кодом — расхождений «[x], но не сделано» НЕТ; CRITICAL/HIGH находок НЕТ.

Находки и что сделано:

1. **[MEDIUM][fixed] login() не сбрасывал `['me']`** (`AuthContext.tsx`): повторный вход ДРУГИМ пользователем без logout оставлял в Query-кэше права прежнего (queryKey `['me']` не меняется → рефетч сам не стартует), `RequirePermission` до фонового рефетча решал по чужим правам. Фикс: `login()` = `setCredential` + `removeQueries(['me'])` (зеркало logout/handle401). Тест: auth-flow.test.tsx «login() сбрасывает [me]» — красная проба вживую (без фикса ровно он красный, 1 failed | 6 passed), откачено-доказано.
2. **[MEDIUM][fixed] deny ≠ fail в RequirePermission** (`guards.tsx`): сбой загрузки `['me']` (5xx/сеть) рендерил «Доступ запрещён» — ложное сообщение при упавшем бэке. Фикс: ветка ошибки → headless `role="alert"` «Не удалось проверить права» (`PERMISSIONS_ERROR_TEXT`); 403 с провода осознанно ОСТАЁТСЯ отказом (defence-in-depth, семантика UX L203); 401 и так уводит на вход глобальной механикой. Тесты: guards.test.tsx 500→alert и 403→отказ — красная проба вживую (1 failed | 7 passed), откачено-доказано.
3. **[LOW][fixed] protocol-relative `state.from`** (`LoginPage.tsx`): `fromLocationState` пропускал `//host` (только `startsWith('/')`) — `pushState` на кросс-origin URL кидает SecurityError в браузере. Фикс: отсекать `//`; тест LoginPage.test.tsx «вредоносный state.from … → домой».
4. **[MEDIUM][fixed] File List неполон**: `auth-flow.qa.test.tsx` (QA-проход) и `test-summary.md` не были задокументированы — добавлены в File List этой правкой.
5. **[LOW][noted, не фикс] JWT-поле — `type="text"`**: токен виден на экране при вводе; `type="password"` — кандидат на 8.7 вместе со стилизацией (dev-форма, headless до 8.7 — осознанно).
6. **[LOW][noted] цена Д10 задокументирована** (401 на query разлогинивает после ~7 с дефолтных ретраев) — уже зафиксировано QA-тестом и Completion Notes, донастройка retry `['me']` — кандидат 8.7+.

Итог тестов после фиксов: **99 (95 + 4 новых)**, оба гейта зелёные (см. Change Log).

## Change Log

- 2026-07-07: Story 8.6 реализована целиком (Tasks 1–14): credential store (sessionStorage + мутируемый authHeaders) → apiClient defaultHeaders; AuthContext (useSyncExternalStore); usePermissions из useQuery(['me']) с типом из schema.d.ts (бэк-аннотация @extend_schema + regen); guards RequireAuth/RequirePermission; LoginPage (RHF+zod, «ровно одно» X-User-Id/JWT); глобальный handle401 в QueryCache+MutationCache (401 → logout, 403 — нет); минимальный роутер v7 (/login, /). 30 новых тестов, 4 красные пробы, оба гейта зелёные. Status → review.
- 2026-07-07: QA-проход (bmad-qa-generate-e2e-tests): +5 E2E (auth-flow.qa.test.tsx) — logout(), JWT-вход на проводе, 401 на query с протухшим токеном (цена Д10 = 4 запроса/~7 c), remount-«F5», deny по полному флоу; 2 мутационные пробы; vitest 95/95, gate зелёный.
- 2026-07-07: Code review (bmad-story-automator-review): Approve. 0 CRITICAL/HIGH; 3 MEDIUM + 1 LOW исправлены авто-фиксом: login() сбрасывает ['me'] (стейл-права при смене пользователя без logout, AuthContext.tsx), RequirePermission различает сбой загрузки прав и отказ (PERMISSIONS_ERROR_TEXT, guards.tsx), fromLocationState отсекает protocol-relative `//host` (LoginPage.tsx), File List дополнен QA-файлами. +4 теста (2 красные пробы вживую, откачены); vitest 99/99; фронт `npm run gate` зелёный целиком (бандл 108.0 KB gzip / 300); бэк `make gate` перепрогнан — 1841 passed. Status → done.
