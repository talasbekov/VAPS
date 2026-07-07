# Test Automation Summary — Story 8.6 (Auth-подключение)

Дата: 2026-07-07 · Скилл: bmad-qa-generate-e2e-tests · Модель: Claude Fable 5
(предыдущая сводка — 8.5 — в git-истории этого файла)

## Контекст

Стори 8.6 — вход в портал: credential store (sessionStorage + мутируемый
`authHeaders`) → apiClient, AuthContext (useSyncExternalStore), права
ТОЛЬКО из `useQuery(['me'])` (ARCH-FE-010), guards RequireAuth/RequirePermission,
LoginPage (RHF+zod «ровно одно»), глобальный handle401 (QueryCache+MutationCache).
Браузерного раннера нет → E2E-уровень стека = vitest 4 + RTL + user-event +
MSW 2 (jsdom per-file, прецедент QA 8.5).

Dev-стори принесла 30 тестов, включая собственный E2E-файл
`src/app/auth-flow.test.tsx` (вход по ID, 401-на-mutation → logout, 403 → нет,
onError на обоих кэшах). QA-проход искал непокрытые связки поверх него.

## Найденные пробелы покрытия (auto-applied, 90 → 95 тестов)

Все пять закрыты новым файлом **`src/app/auth-flow.qa.test.tsx`** — E2E через
РЕАЛЬНУЮ композицию `<Providers>` (шпион QueryClientSpy достаёт внутренний
QueryClient для кэш-ассертов; размещение в `app/` — imports features+shared
легальны, ARCH-FE-013):

1. **`logout()` не покрыт НИ ОДНИМ тестом** (Task 6: clearCredential +
   `removeQueries(['me'])` — кнопки в UI нет до 8.7, механика висела в воздухе).
   Закрыто: клик «Выйти» → credential очищен всюду (store/storage/authHeaders),
   `['me']` снят с кэша (removeQueries, не invalidate — Ловушка 4), RequireAuth
   реактивно уводит на /login.
2. **JWT-вход существовал только на локальной обёртке** (LoginPage.test) с
   ручным `apiClient.get`. Закрыто: вставка JWT + **Enter в JWT-поле** (L262
   теперь доказан для обоих полей) через реальный Providers → запрос самого
   приложения `['me']` несёт ровно `Authorization: Bearer`, без X-User-Id (AC 2).
3. **401 на query в UI не покрыт** (в стори — 401 на mutation в UI и fetchQuery
   на кэш-уровне). Закрыто самым реалистичным сценарием: старт приложения с
   протухшим JWT из sessionStorage → `['me']` сам ловит 401 → после дефолтных
   ретраев глобальный logout → молчаливый /login (AC 6). Ассерт
   `captured.toHaveLength(4)` **документирует цену Д10**: 1 запрос + 3 ретрая,
   ~7 с до разлогина (кандидат на донастройку 8.7+ из Completion Notes).
4. **«Переживает F5» на уровне приложения**: remount дерева с новым Providers
   (новый QueryClient, пустой кэш) → сразу контент без /login, `['me']`
   перезапрошен каждым клиентом (AC 1; гидратация модуля из storage — юнит
   credential.test.ts, здесь — поведение целого приложения).
5. **Deny-ветка по полному флоу входа**: guard увёл с защищённого маршрута →
   вход → возврат на `state.from` → права без нужного кода → «Доступ запрещён»,
   контент скрыт, БЕЗ редиректа и очистки credential — deny ≠ logout (AC 5;
   в стори state.from-возврат и deny жили только на локальных обёртках).

## API-тесты (Step 2 workflow): не требуются

Бэк-половина стори — только схемная аннотация `@extend_schema` (поведение не
менялось). Эндпоинт `GET /api/operations/my-permissions/` уже покрыт бэком:
`test_temp_duty_api.py` (happy + 403 без credential), `test_rbac_matrix.py`
(гейт «любой аутентифицированный»), `test_authentication.py` (JWT/X-User-Id,
5.1); контракт схемы — дрифт-гейтами (`test_schema_drift` + `schema-check.mjs`).

## Верификация (не вакуумность)

- `vitest run` — **95/95 зелёные** (90 стори/базы + 5 QA), первый прогон QA-файла
  5/5 без правок прод-кода.
- **Мутационная проба А**: убран `removeQueries(['me'])` из `logout()` →
  красный РОВНО один — новый logout-тест (1 failed | 4 passed): единственное
  покрытие этой ветки в проекте. Откачено.
- **Мутационная проба Б**: `navigate(...)` LoginPage игнорирует `state.from` →
  красные РОВНО два флоу-теста QA (JWT-вход и deny-ветка): возврат на исходный
  маршрут пинуется через реальную композицию. Откачено.
- Прод-код восстановлен байт-в-байт (обратные Edit; файлы стори untracked до
  коммита — git restore недоступен, урок 8.4 учтён).
- `npm run gate` — **все 9 шагов зелёные**: deps-gate (418 пакетов), schema-check,
  tsc -b, eslint (boundaries чисты для нового файла в app/), lint-canon (13+6),
  schema-check.test, vitest 95/95, vite build, size-gate. Бандл **108.0 KB gzip —
  не вырос** (тесты в бандл не утекли). Бэк не трогался → `make gate` бэка
  не перезапускался (зелёный 1841 passed зафиксирован dev-стори).

## Покрытие

- AC стори: 8/8 автоматизированы (AC 1–6 — юниты + E2E; AC 7 — дрифт-гейты;
  AC 8 — сам gate). QA добавил E2E-срез поверх изолированных срезов стори
  для AC 1, 2, 5, 6.
- Механики auth-флоу: **login/JWT/deny/401-mutation/401-query/403/F5/logout —
  8/8 в user-флоу** (было 5/8: JWT и deny — только изолированно, logout — никак).
- Файлы стори с тестами: 6/6 прод-файлов auth-слоя исполняются E2E-тестами
  через реальную композицию (credential, AuthContext, usePermissions, guards,
  LoginPage, providers).
- Suite: 12 файлов, 95 тестов; QA-файл добавляет ~7.5 с к прогону (осознанно:
  тест цены Д10 ждёт реальные ретраи, hardcoded-sleep нет — только polling
  findBy*/waitFor).

## Файлы

- Создано: `frontend/src/app/auth-flow.qa.test.tsx` (5 E2E).
- Обновлено: `_bmad-output/implementation-artifacts/tests/test-summary.md` (эта сводка).
- Продакшен-код, конфиги, gate-цепочка — не тронуты (пробы откачены байт-в-байт).

## Next Steps

- Цена Д10 теперь задокументирована ассертом (4 запроса, ~7 с до logout при
  протухшем токене): при донастройке retry для `['me']` в 8.7+ тест подскажет
  новое число — обновить `toHaveLength`.
- Кнопка «Выйти» приезжает в 8.7 (сайдбар) — механика `logout()` уже доказана,
  8.7 останется подключить UI к готовому `useAuth().logout`.
- Q1–Q4 стори (Д1–Д10) ждут подтверждения Bratan на ревью — QA-тесты пинуют
  Д7 (двухуровневая 401-механика) и Д10 (дефолтные политики Query).
- Настоящие браузерные E2E (Playwright) — кандидат на конец E8/E9; текущий
  стек сознательно ограничен jsdom (без изменений с 8.5).
