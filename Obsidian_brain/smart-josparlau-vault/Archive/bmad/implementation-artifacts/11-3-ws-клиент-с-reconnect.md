---
baseline_commit: 7c88f0a (HEAD, `feat(story-11.2)`). Предшественники: 11.1 (done, `e2c7890`) — WS-транспорт; 11.2 (done, `7c88f0a`) — первый отправитель в него. 11.3 — ПЕРВЫЙ потребитель WS на фронте и ПЕРВЫЙ таймерный контур в прод-коде фронта (сегодня единственный `setTimeout` вне тестов — авто-dismiss тоста).
baseline_tests: `cd frontend && npx vitest run` на baseline → **31 файл, 379 тестов** (замерено при создании стори; бандл ~168 КБ gzip при потолке 300).
⚠️ В worktree параллельно лежит НЕЗАКОММИЧЕННАЯ стори 10.3 (статус `review`): `frontend/src/features/daily-grid/**`, `frontend/e2e*`, `docs/contracts/09-01-*`. К 11.3 отношения не имеет; File List и коммит — путево-ограниченные (урок 10.2/10.3/11.2).
---

# Story 11.3: WS-клиент с reconnect

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор**,
I want **фронтовый клиент `/ws/notifications/`, который переживает разрыв соединения: переподключается по экспоненциальному backoff, после каждого подключения дочитывает пропущенное через `GET /api/notifications/?since=` и честно показывает «нет связи»**,
so that **уведомление, родившееся в момент, когда мой сокет был мёртв (деплой рвёт ВСЕ WS — architecture.md#L337), не теряется: WS остаётся сигналом «обнови», истина живёт в БД/REST, а reconnect + дочитка закрывают разрыв между ними (FR-35)**.

## Acceptance Criteria

Источник: epics.md#L1244-1250 (Story 11.3 AC); architecture.md#L327 (best-effort + дочитка REST после reconnect), #L337 («reconnect на клиенте обязателен»; ping/pong + `proxy_read_timeout` — nginx 12.1), #L258 («WS-логика на фейках: реконнект с backoff, дочитка по REST после reconnect»), #L246/#L261 (детерминированные ассерты, НЕ тайминги), #L237 ARCH-FE-010 (стейт), #L240 ARCH-FE-013 (слои), #L231 (FF100 + бюджет бандла); EXPERIENCE.md#L187 (backoff + heartbeat + `?since=` + индикатор «нет связи» — единственное место, где это названо одной строкой); **deferred-work.md:509 (курсор с grace ~5s + дедуп по `id`) — прямая инструкция реализации, адресованная именно этой стори**; FR-35 (prd.md#L159).

1. **AC-1 (транспорт: модуль-синглтон в `shared/`, без Context и без стора).** NEW `frontend/src/shared/notifications/notificationsSocket.ts` — React-free модуль с состоянием в замыкании модуля; наружу: `subscribeStatus`/`getStatusSnapshot` (контракт `useSyncExternalStore`), `subscribeMessages`, `startNotificationsSocket()`/`stopNotificationsSocket()`, `configureNotificationsSocket()`. **Ни стора, ни ТРЕТЬЕГО React-Context**: ARCH-FE-010 называет ровно два (Auth/Theme). Образец один-в-один — `shared/auth/credential.ts:18-95` (`let current` + `Set` слушателей + стабильная ссылка `getSnapshot`). **Расположение `shared/`, а не `features/notifications/` — не вкусовщина:** индикатор монтирует `shared/ui/AppLayout.tsx`, а потребитель сообщений — будущая фича 11.4; `shared → features` запрещён матрицей `eslint-plugin-boundaries` (eslint.config.js:161-164), из `features/` модуль был бы недостижим для AppLayout. Barrel-`index.ts` НЕ создавать (ARCH-FE-013).
   **Статусы — ровно четыре:** `idle` (не запущен / нет credential), `connecting`, `online`, `reconnecting`. Статуса `unauthorized` НЕТ — см. AC-5.
2. **AC-2 (URL строится из `location`, а не литералом) — иначе гейт красный.** Адрес сокета собирается в рантайме: `` `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${WS_NOTIFICATIONS_PATH}` ``, где `WS_NOTIFICATIONS_PATH = '/ws/notifications/'` — экспортируемая константа. **Литерал `wss://<host>/...` в бандле валит `npm run gate`**: `scripts/size-gate.mjs:88-93` флагует схемы `ws:`/`wss:` **безусловно, без анализа контекста**, а `LOAD_CONTEXT` (size-gate.mjs:77) отдельно перечисляет `WebSocket\s*\(\s*["']`; спасает только точное совпадение хоста с `localhost`/`127.0.0.1` (size-gate.mjs:58) — прод-адрес не спасает ничто. При динамической сборке после `//` в бандле стоит `${`, а регексп `EXTERNAL` (size-gate.mjs:57) требует там `[a-z0-9-]+` и не матчится (**проверено воспроизведением логики скрипта на минифицированных сниппетах**: динамическая сборка — clean, `new WebSocket("wss://vaps.local/…")` — FLAGGED). **Трейлинг-слеш обязателен:** `APPEND_SLASH` для WS не существует, `/ws/notifications` сокет не открывает вовсе (`Backend/VAPS/apps/notifications/tests/test_ws_e2e.py:120-148`, «the #1 client typo»). Same-origin работает и в dev: `vite.config.ts:39-43` уже проксирует `'/ws'` с `ws: true`.
3. **AC-3 (identity — зеркало `credential.ts`, обе ветки).** Query-строка сокета выводится из `getCredential()` (`credential.ts:67`): `{kind:'jwt'}` → `?token=<encodeURIComponent(token)>`; `{kind:'dev'}` → `?user_id=<encodeURIComponent(userId)>`; `null` → **сокет не открывается вовсе**, статус `idle`. Основание не догадка: браузерный `WebSocket` физически не умеет заголовок `Authorization` (`Backend/VAPS/apps/core/auth/ws.py:20-23`, Решение №1 стори 11.1), а сервер резолвит actor РОВНО так: JWT сконфигурирован → только `?token=`; иначе → `X-User-Id`-заголовок ИЛИ `?user_id=` (`ws.py:61-80`). Тест обязан проверить обе ветки **по фактическому URL сокета** (`new URL(fake.url).searchParams`), а не «сокет создан». **Токен не логировать никогда** — он же в URL.
4. **AC-4 (экспоненциальный backoff — расписание, а не «ретраи бывают»; планирование ИДЕМПОТЕНТНО).** На `close` или `error` статус → `reconnecting` и планируется следующая попытка с задержкой `min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * RECONNECT_FACTOR ** attempt)`, где `attempt` — число неудачных подряд попыток. **Формула обязана читать `RECONNECT_FACTOR`, а не литеральную двойку** — иначе красная проба №1 не может покраснеть, и ассерт расписания вакуумен по построению. Константы экспортируются (`RECONNECT_BASE_MS = 1000`, `RECONNECT_FACTOR = 2`, `RECONNECT_CAP_MS = 30_000`) — образец `toast.tsx:26` («экспорт — для тестов с fake timers»). Джиттер: фактическая задержка = `delay * (0.5 + random() * 0.5)`, `random` **инъектируется** через `configureNotificationsSocket({random})`, дефолт `Math.random`. Потолка попыток НЕТ (деплой рвёт все сокеты — клиент обязан вернуться сам); успешный `open` сбрасывает `attempt` в 0.
   **🔴 Планирование обязано быть идемпотентным (гард `retryTimer !== null` ИЛИ снятие предыдущего).** Браузер при неудачном подключении фаерит `error`, а СЛЕДОМ `close` — наивные два обработчика создадут два таймера, два сокета, и дальше 4, 8, 16. Тест обязан гонять `emitError()` + `emitClose()` подряд и утверждать **ровно один** новый сокет.
   Ассерт расписания — по **полному массиву** (`random: () => 1` → `[1000, 2000, 4000, 8000, 16000, 30000, 30000]`), а не «была хотя бы одна повторная попытка»: последнее зелено и на фиксированной задержке, и на линейной — форма вакуума «ассерт, зелёный на сломанном коде» (ретро E9 §3). Отдельным ассертом — сброс `attempt` после успешного `open`.
5. **AC-5 (клиент НЕ разбирает close-коды — код `4403` в браузере недостижим; терминирует смена credential).** **Клиент не содержит ветки по `event.code`.** Обоснование проверено в коде, а не взято из спеки 11.1: consumer закрывает handshake **до `accept()`** (`Backend/VAPS/apps/notifications/consumers.py:55-59`, комментарий «Refuse the handshake itself — no accept() first»), а ASGI-контракт для `websocket.close` до `websocket.accept` предписывает серверу ответить **HTTP 403** и не завершать WS-рукопожатие — то есть браузер получает `CloseEvent` с `code: 1006, wasClean: false`, и приватный `4403` (`consumers.py:41`) на провод **не выходит вовсе**. `4403` видят только Python-тесты 11.1, чей `WsCommunicator` читает ASGI-сообщения напрямую, минуя браузерный handshake.
   **Следствие, которое надо принять сознательно:** ветка `if (code === 4403) stop()` была бы зелёной на `FakeSocket` и мёртвой в проде — заложенный в спеку вакуум. Поэтому её нет. Отказ по identity ведёт себя как транспортный сбой: backoff с потолком 30 с (≤2 запроса в минуту — стоимость приемлемая).
   **Реальное терминирующее условие — AC-6:** протухший токен даёт 401 на обычных запросах приложения → `handle401` (`app/providers.tsx:27-33`) чистит credential → обработчик credential останавливает сокет. Плюс усиление здесь: **дочитка, получившая `401`, сама зовёт `clearCredential()`** (`shared/auth/credential.ts:80`) — канон 401-семантики, не новая норма. Тест обязан утверждать: после `clearCredential()` новых сокетов не создаётся и **не остаётся ни одного таймера**.
   Браузерно-наблюдаемый отказ требует правки consumer'а (`accept()` → `close(4403)`), а `Backend/**` вне скоупа (AC-13) → вынесено открытым вопросом №1.
6. **AC-6 (смена credential перезапускает клиента И СБРАСЫВАЕТ ВСЁ его состояние).** Модуль подписан на `credential.subscribe` (`credential.ts:90`). При изменении credential: текущий сокет закрывается, снимается `retryTimer`, `attempt` → 0, **курсор `?since=`, кольцо дедупа и флаг `seeded` очищаются**, и при непустом credential соединение открывается заново.
   **Сброс курсора — самостоятельное требование, а не следствие:** курсор пользователя A, доживший до сессии B, отфильтрует дочитку B по чужому времени и молча съест его уведомления. Класс «фантомный флаг переживает смену контекста», ловившийся ревью дважды подряд (10.2 — `dirtyCount`; 10.3 — `localDrift`).
   **🔴 Обработчик обязан быть безопасен при незапущенном клиенте.** `credential.subscribe` регистрируется на импорте модуля, а модуль импортируется общим `vitest.setup.ts` (AC-11) → он загружен в КАЖДОМ тест-файле, включая окружение `node`, где `location` не существует (проверено прогоном: `node → location: undefined`, `jsdom → location: object`). Если `start()` не вызывался — обработчик только чистит состояние и **не трогает `location`/`WebSocket`**. Иначе любой `setCredential()` в node-тесте упадёт `ReferenceError` изнутри чужого теста. Аналогично: на импорте модуля `location`/`WebSocket` не читаются вовсе.
   Побочно: `setCredential` уведомляет слушателей **всегда**, даже при повторной установке того же значения (`credential.ts:71-78`) — сравнивать новое значение с прежним и не дёргать сокет на no-op.
7. **AC-7 (дочитка на каждый `open`; первый раз — только SEED, без эмита) — ядро стори.**
   - **Первое подключение за жизнь клиента (`seeded === false`):** `GET /api/notifications/?limit=1`. Строки наружу **НЕ эмитятся**, курсор инициализируется по единственной вернувшейся строке, `seeded = true`. **Почему не эмитим:** без этого каждая загрузка страницы выплёвывала бы в поток до 200 «новых» уведомлений за всю историю, а 11.4 и без того читает полный список штатной пагинацией — истина в REST/БД (architecture.md#L327). Поток 11.3 — это ДЕЛЬТЫ, а не начальная загрузка.
   - **Каждое последующее `open` (`seeded === true`):** `GET /api/notifications/?since=<курсор>&limit=200`; при пустом курсоре (за всю сессию не было ни одной строки) параметр `since` **не добавляется**, и в этом случае эмитить можно всё — на момент seed'а строк не существовало.
   - **Курсор** = `max(created_at)` всех уже отданных/увиденных строк **МИНУС `SINCE_GRACE_MS = 5000`**. Grace — предписанное закрытие известного дефекта: `deferred-work.md:509` (ревью 5.7c) — `created_at` ставится на INSERT (`auto_now_add`), видимость строки — на COMMIT, поэтому курсор, продвинутый по видимым строкам, **никогда** не получит строку, закоммиченную позже с меньшим `created_at`; «строгость Q2 ни при чём: `>=` не лечит». Там же прописано лечение целиком: «перекрытие окна (`since = max_seen_created_at − grace ~5s`) + **дедуп по `id`**».
   - **🔴 Курсор монотонен: `cursor = max(cursor, новое)`.** Без клэмпа он откатывается назад в двух реальных сценариях: (а) WS-строка пришла, пока дочитка в полёте, — резолв дочитки перезапишет курсор своими, более старыми строками; (б) два перекрывающихся `open` (реконнект поверх живого сокета — случай признан Ловушкой 13 и запинен `test_ws_e2e.py:201-222`) дадут две параллельные дочитки. Дополнительно: **вторая дочитка не стартует, пока первая в полёте**.
   - **Дедуп по `id`:** кольцо последних `SEEN_IDS_LIMIT = 1000` id; строка с уже виденным `id` наружу не отдаётся. **Кольцо обязано быть заметно больше страницы дочитки (200)** — иначе одна полная страница вытеснит его целиком вместе с id из grace-хвоста, и дедуп перестанет работать ровно в том сценарии, ради которого заведён.
   - **Пустой ответ (`results: []`) — курсор НЕ трогаем.** Наивный `Math.max()` на пустом массиве даёт `-Infinity` → `new Date(-Infinity).toISOString()` бросает `RangeError`, который проглотит `try/catch` из AC-8; либо, если проскочит, `Invalid Date` в `since` даст **400** от `NotificationFilterSerializer` (`api/serializers.py:33`, `raise_exception=True`) — и дочитка не заработает больше никогда, молча. Тест на пустой ответ обязателен.
   - **Порядок эмита — по возрастанию `created_at`.** Ответ приходит `-created_at, id` (`selectors.py:43`), значит массив разворачивается — **`[...rows].reverse()`, НЕ `.toReversed()`**: `Array.prototype.toReversed` — Firefox 115, цель сборки `firefox100` (`.browserslistrc`), а `eslint-plugin-compat` покрывает Web API, но не методы `Array`, и `build.target` их не полифиллит → гейт зелёный, прод сломан.
   - **Оба входа канала (WS-кадр и дочитка) идут через ОДНУ функцию `emit(rows)`** — с общим дедупом и общим продвижением курсора. Две ветки = два расходящихся курсора.
   - **Формат `since` на проводе:** `new Date(cursorMs).toISOString()` (UTC, `Z`) + `encodeURIComponent`. Сырое `created_at` с `+05:00` без кодирования превратит `+` в пробел → 400, а AC-8 это молча проглотит. Тест обязан ассертить **значение** параметра, а не факт запроса.
8. **AC-8 (дочитка best-effort: её сбой не трогает сокет).** **Given** дочитка вернула 5xx/`NetworkError`/невалидное тело, **Then** исключение поймано и залогировано (`console.warn`, без ПДн и без токена), курсор НЕ двигается, сокет остаётся открытым, backoff не запускается. Зеркалит AC-7 стори 11.2: сигнальный канал не имеет права ронять то, что уже работает. Разбор тела защитный (образец стиля — `features/daily-grid/daySubmission.ts::parseSubmissionList`): не массив `results` → трактуем как пустую дочитку, не как краш. `Notification.payload` в схеме — `unknown` (`schema.d.ts:1353`), типизировать его не пытаться. `NetworkError` **не наследует** `ApiError` (`errors.ts:102-108`) → ловить всё через `catch (e)`, не ветвиться по типу; единственная ветка — `ApiError.status === 401` → `clearCredential()` (AC-5).
   **Ловушка окружения:** дефолтный MSW-хендлер `*/api/notifications/` уже занят фикстурой **502 HTML** (`shared/api/testing/handlers.ts:181-188`), и от неё зависят `client.test.ts:217` и `useApiMutation.test.tsx:256` — **дефолтный хендлер НЕ переопределять глобально**, только `server.use(...)` внутри своих тестов. Побочно это даёт готовый негативный кейс для этого AC.
9. **AC-9 (полный тираж пропущенного не гарантируется — и это осознанно).** Если ответ дочитки сообщает `count > results.length` (за один разрыв пропущено больше 200 строк), клиент логирует предупреждение и **всё равно двигает курсор к самой новой строке**; догонять страницы через `offset` он НЕ пытается. Причины: (а) истина — REST/БД, центр уведомлений 11.4 читает полный список штатной пагинацией, поэтому «недоэмитили в живой поток» ≠ «потеряли данные»; (б) `SUBMISSION_LAGGING` — «одно уведомление на день», 200 пропущенных ≈ 200 дней офлайна; (в) цикл дочитки по страницам — ровно тот код, который на ревью 10.2 уронил vitest-воркер по OOM (пустая страница при непустом `next`, `for(;;)` без гарда прогресса). **Цикл дочитки НЕ заводить.** Ограничение зафиксировать комментарием в коде. Благодаря SEED (AC-7) на старте эта ветка больше не срабатывает у каждого живого пользователя.
10. **AC-10 (индикатор «нет связи» — текстом, не только цветом, и без мигания на старте).** NEW `frontend/src/shared/ui/ConnectionIndicator.tsx`: подписывается на статус через `useSyncExternalStore(subscribeStatus, getStatusSnapshot, getStatusSnapshot)`, стартует/останавливает клиента в `useEffect` (cleanup обязателен), рендерит `null` при `idle`/`connecting`/`online` и при `reconnecting` — элемент с `role="status"`, `aria-live="polite"` и **видимым текстом** «Нет связи с сервером».
    **`connecting` намеренно НЕ показывает индикатор**: иначе «нет связи» мигало бы на каждой загрузке страницы до первого `open`; тест этого поведения ловит регресс, который иначе увидит только оператор.
    **🔴 Коллизия ролей:** `ToastProvider` держит **постоянный** `role="status"` в DOM (`toast.tsx:54`) и смонтирован в `Providers` (`providers.tsx:51`) — голый `getByRole('status')` в app-тестах станет неоднозначным. Индикатору дать различающее accessible name (`aria-label`), в тестах запрашивать **по имени** (`getByRole('status', { name: ... })`). В репозитории эту грабельку уже обходили дважды (`print-routing.test.tsx:49`, `DaySubmissionPanel.test.tsx:489`).
    Цвет не может быть единственным сигналом (EXPERIENCE.md#L238); модалку не делать — jsdom не эмулирует модальность (дефер 9.5, подтверждён 9.9, повтор 10.3 Решение №5), ассерт был бы вакуумным. Монтируется в `shared/ui/AppLayout.tsx` (MOD) в шапке (AppLayout.tsx:69-79). **`disabled`-заглушку колокольчика НЕ трогать** — она 11.4, её `aria-label` держат два живых теста (`app/AppLayout.test.tsx:128-136`, `app/app-layout.qa.test.tsx:199`).
11. **AC-11 (юнит-тесты не открывают настоящих сокетов).** `shared/api/testing/vitest.setup.ts` (MOD): инертная socket-фабрика ставится **на уровне модуля setup-файла, НЕ в `beforeAll`** — `setupFiles` вычисляются до импорта тест-файла, но `beforeAll` исполняется ПОСЛЕ вычисления его модуля, поэтому любой top-level сайд-эффект в чужом тесте успел бы получить дефолтную фабрику. В `afterEach` — `stopNotificationsSocket()` + `__resetNotificationsSocketForTests()` (имя намеренно явное).
    **Без этого шага стори ломает чужие тесты:** `AppLayout` рендерят `app/AppLayout.test.tsx` и `app/app-layout.qa.test.tsx`; в jsdom `WebSocket` **настоящий** (проверено: `typeof === 'function'`, `CLOSED === 3`), он полез бы на `ws://localhost/...`, получил отказ, увёл статус в `reconnecting` и вывесил «Нет связи» посреди чужих ассертов (заодно сломав `getByRole('status')` — AC-10). Инертная фабрика → статус остаётся `idle` → индикатор не рендерится → чужие тесты не тронуты. Мотив тот же, что у `onUnhandledRequest: 'error'` (`vitest.setup.ts:6`): молчаливый выход в реальную сеть делает тесты недостоверными.
12. **AC-12 (тесты — на фейках, детерминированные, с доказанной не-вакуумностью).** NEW `frontend/src/shared/notifications/notificationsSocket.test.ts` (докблок `// @vitest-environment jsdom` — модулю нужен `location`) и NEW `frontend/src/shared/ui/ConnectionIndicator.test.tsx`. Фейковый сокет — **свой ~40-строчный класс**, инъектируемый через `configureNotificationsSocket({socketFactory})` (Решение №2: `mock-socket` НЕ ставим). Таймеры — `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(...)`, `vi.useRealTimers()` в `afterEach`. **Никаких блокирующих таймингов** (architecture.md#L246/#L261): ни одного `await new Promise(r => setTimeout(r, 50))` в тестах расписания. Обязательный минимум — полный список в Task 4/Task 5; каждый ассерт обязан иметь красную пробу (Dev Notes).
13. **AC-13 (границы — что НЕ входит).** **НЕ трогаем:** `Backend/**` целиком — стори чисто фронтовая, **любая правка бэка = сигнал, что скоуп поехал: остановиться и эскалировать** (формулировка 10.3); `schema.yaml`/`schema.d.ts` (WS вне OpenAPI, HTTP-поверхность не менялась; regen ЗАПРЕЩЁН — `schema-check.mjs` сравнивает байт-в-байт); дефолтные MSW-фикстуры (AC-8); `features/daily-grid/**` (там незакоммиченная 10.3); `grammar.ts` (заморожена с 9.2). **НЕ делаем:** колокольчик/список/unread/mark-as-read и `queryClient.setQueryData` (**11.4** — первый потребитель `subscribeMessages`, epics.md#L1256); kill-switch и polling-fallback (**11.5** — 11.3 не зашивает выбор между «ручной refresh» и «polling», Решение №5); Playwright-e2e (**11.6**); nginx/`proxy_read_timeout`/ping (**12.1**); бан глобала `WebSocket` в eslint (**вынесено в 11.3a**). **Новых npm-зависимостей НОЛЬ** — `package.json`/`package-lock.json` в диффе быть не должно.
14. **AC-14 (гейт зелёный, регресс нулевой).** `cd frontend && npm run gate` (`package.json:20`) зелёный целиком: `deps-gate`, `schema-check`, `tsc -b`, `eslint .` (в т.ч. `boundaries/*`, `react-hooks/exhaustive-deps`, `react-hooks/set-state-in-effect`, `eslint-plugin-compat`), `lint-canon.test.mjs`, `schema-check.test.mjs`, `vitest run`, `vite build`, `size-gate.mjs` (≤300 КБ gzip; AC-2 относится именно к этому шагу). **Baseline для сверки: 31 файл / 379 тестов, ~168 КБ** — рост числа тестов обязан совпасть с числом добавленных. Отдельно подтвердить зелёными **без правок**: `app/AppLayout.test.tsx`, `app/app-layout.qa.test.tsx`, `shared/api/client.test.ts`, `shared/api/useApiMutation.test.tsx`. `make gate` бэка **не гонять** — бэк не тронут.

## Tasks / Subtasks

- [x] **Task 1 — Транспортный модуль** (`frontend/src/shared/notifications/notificationsSocket.ts`, NEW) (AC: 1-9)
  - [x] Состояние в замыкании по образцу `credential.ts:18-95`: `status`, `socket`, `attempt`, `cursorMs`, `seeded`, `seenIds`, `retryTimer`, `catchUpInFlight`, `epoch`, `started`, два `Set` слушателей. Экспорт `subscribeStatus`/`getStatusSnapshot` (**стабильная ссылка** — Ловушка 6), `subscribeMessages`, `start`/`stop`, `configureNotificationsSocket`, `__resetNotificationsSocketForTests`.
  - [x] Константы (все `export`, UPPER_SNAKE): `WS_NOTIFICATIONS_PATH`, `RECONNECT_BASE_MS = 1000`, `RECONNECT_FACTOR = 2`, `RECONNECT_CAP_MS = 30_000`, `SINCE_GRACE_MS = 5000`, `SEEN_IDS_LIMIT = 1000`, `CATCHUP_LIMIT = 200`.
  - [x] `buildSocketUrl()` — динамически из `location` (AC-2), путь константой, credential из `getCredential()` с `encodeURIComponent` (AC-3). Литерала `ws://`/`wss://` с хостом в коде быть НЕ ДОЛЖНО. **На импорте модуля `location`/`WebSocket` не читать** (AC-6).
  - [x] Типы: `type Notification = components['schemas']['Notification']`, `type Page = components['schemas']['PaginatedNotificationList']` (`schema.d.ts:1347, 1406`) — руками не переписывать. Тип WS-конверта описать руками (WS вне OpenAPI), но `payload` типизировать тем же `Notification`: конверт 11.2 повторяет проекцию `NotificationSerializer` **по значениям** (запинено `test_ws_notify.py:487-513`). Реестр `ws-message-types.yaml:30` (`payload_fields`) — донорская форма, **по нему не типизировать** (открытый вопрос №5).
  - [x] Backoff (AC-4): `scheduleReconnect()` с **идемпотентным** гардом (`retryTimer !== null` → выход) и формулой через `RECONNECT_FACTOR`; `open` → `attempt = 0`, статус `online`; `close` И `error` → статус `reconnecting` + планирование. **Ветки по `event.code` НЕТ** (AC-5).
  - [x] `credential.subscribe(...)` (AC-6): сравнить с прежним значением; при изменении — закрыть сокет, снять `retryTimer`, `attempt = 0`, `cursorMs = null`, `seeded = false`, `seenIds.clear()`, `epoch++`; переоткрыть только если `started === true` и credential непустой. **При `started === false` — только чистка, без обращения к `location`.**
  - [x] `catchUp()` на каждый `open` (AC-7): гард `catchUpInFlight`; SEED-ветка (`limit=1`, без эмита) vs дельта-ветка (`since` + `limit=200`); строка запроса вручную с `encodeURIComponent` (прецедент `DailyUpdatePage.tsx:200-213` — «схема параметров этих путей не эмитит вовсе»); `apiClient.get<Page>`; защитный разбор; `[...results].reverse()`; `emit()`; курсор — **монотонный клэмп** и только при непустых `results`. **Гард по `epoch`:** после `await` сравнить сохранённый `epoch` с текущим — `stop()`/смена credential во время полёта не должны продвинуть курсор и эмитнуть (у `apiClient` нет `AbortSignal` — `client.ts:31-55`). Всё тело — `try/catch` с `console.warn`; `ApiError.status === 401` → `clearCredential()` (AC-5/AC-8). `count > results.length` → warning, курсор двигать, **цикла НЕ заводить** (AC-9).
  - [x] Живое WS-сообщение: `JSON.parse` в `try/catch` (битый кадр не должен ронять обработчик), проверить форму `{type, payload}`, прогнать через **тот же** `emit()`.
  - [x] `start()`/`stop()` идемпотентные: `main.tsx:8` монтирует под `StrictMode` → эффект отработает дважды (Ловушка 7 стори 8.5). `stop()` снимает `retryTimer` (`clearTimeout`), закрывает сокет, `epoch++`, статус → `idle`.
  - [x] **`fetch`/`XMLHttpRequest` в модуле НЕ использовать** — забанены eslint-ом вне `src/shared/api/**` вместе с `window.*`/`globalThis.*`-формами (eslint.config.js:205-249; обход через `window.fetch` был находкой ревью 8.4). Только `apiClient`.
- [x] **Task 2 — Индикатор** (`frontend/src/shared/ui/ConnectionIndicator.tsx`, NEW; `frontend/src/shared/ui/AppLayout.tsx`, MOD) (AC: 10)
  - [x] Компонент: `useSyncExternalStore` на статус, `useEffect` → `start()` + cleanup `stop()`, ранний `return null` для `idle`/`connecting`/`online`.
  - [x] Разметка: `role="status"` + `aria-live="polite"` + **различающий `aria-label`** (AC-10, коллизия с тостом); видимый текст «Нет связи с сервером»; иконка `lucide-react` — только как дополнение к тексту, не вместо него.
  - [x] `AppLayout.tsx`: вставить `<ConnectionIndicator />` в `<header>` перед колокольчиком. **Колокольчик и его `aria-label` не трогать.**
  - [x] Локальной копии статуса в `useState` не заводить (ARCH-FE-010 «дублирование Query-кэша/серверных данных в useState») — и заодно это снимает риск `react-hooks/set-state-in-effect`, красного в гейте (инцидент 10.3).
  - [x] Классы — семантические токены существующего словаря `shared/ui`; произвольный hex, `@apply` вне `index.css`, `:has()`, `h-dvh`, `color-mix()` запрещены (ARCH-FE-014 + FF100).
- [x] **Task 3 — Инертный сокет в общем setup** (`frontend/src/shared/api/testing/vitest.setup.ts`, MOD) (AC: 11)
  - [x] `configureNotificationsSocket({ socketFactory: () => inertSocket })` **на уровне модуля**, не в `beforeAll` (AC-11). Инертный сокет — объект с `close()`-заглушкой, который никогда не зовёт `onopen`/`onclose`.
  - [x] `afterEach`: `stopNotificationsSocket()` + `__resetNotificationsSocketForTests()`.
  - [x] Комментарий — «почему», а не «что»: в jsdom `WebSocket` настоящий; без этого шага AppLayout-тесты уйдут в реальную сеть и увидят «Нет связи», сломав в т.ч. `getByRole('status')`.
  - [x] Прогнать `app/AppLayout.test.tsx` и `app/app-layout.qa.test.tsx` **до** Task 2 и **после** — обе зелёные без правок.
- [x] **Task 4 — Тесты транспорта** (`frontend/src/shared/notifications/notificationsSocket.test.ts`, NEW) (AC: 3-9, 12)
  - [x] Докблок `// @vitest-environment jsdom` **первой строкой** (vitest 4 удалил `environmentMatchGlobs`, Ловушка 1 стори 8.5); `vi.useRealTimers()` + сброс модуля в `afterEach`.
  - [x] `FakeSocket` (~40 строк, ноль зависимостей): `url`, `readyState`, `onopen/onmessage/onclose/onerror`, `close()`, и хелперы `open()`, `emitMessage(obj)`, `emitClose(code)`, **`emitError()`**.
  - [x] `test_url_carries_jwt_token` / `test_url_carries_dev_user_id` — ассерт по `new URL(fake.url).searchParams` + отдельно, что путь оканчивается на `/ws/notifications/` (AC-2/AC-3).
  - [x] `test_backoff_follows_the_schedule` — `random: () => 1`, ассерт **полного массива** `[1000, 2000, 4000, 8000, 16000, 30000, 30000]`; граничная пара `advanceTimersByTimeAsync(delay - 1)` / `(1)` по образцу `toast.test.tsx:43-50` (AC-4).
  - [x] `test_error_and_close_schedule_a_single_retry` — `emitError()` + `emitClose(1006)` подряд → **ровно один** новый сокет (AC-4, идемпотентность).
  - [x] `test_successful_open_resets_the_attempt_counter` — два разрыва с успешным `open` между ними; вторая серия снова начинается с 1000 мс (AC-4).
  - [x] `test_clearing_credential_stops_everything` — после `clearCredential()`: новых сокетов нет **и таймеров не осталось** (прокрутить 120 000 мс). **Позитивный контроль тем же механизмом в том же тесте** (`emitClose` при живом credential → сокет создан) — иначе «не создано» неотличимо от «фабрика вообще не работает» (AC-5).
  - [x] `test_first_open_seeds_the_cursor_without_emitting` — первый `open` → запрос с `limit=1` **без** `since`, подписчик не получил НИЧЕГО, а следующий `open` уже несёт `since` (AC-7, SEED).
  - [x] `test_catchup_uses_cursor_with_grace` — после строки с `created_at = T` дочитка ушла с `since = ISO(T − 5000)`. **Ассерт по ЗНАЧЕНИЮ параметра из URL**: опечатка в имени параметра молча игнорируется сервером и вернёт всю историю с 200 (`deferred-work.md:524`) — тест «запрос был» это пропустит (AC-7).
  - [x] `test_cursor_never_moves_backwards` — WS-строка новее приходит во время полёта дочитки со старыми строками → следующий `since` соответствует НОВОЙ строке (AC-7, монотонность).
  - [x] `test_empty_catchup_keeps_the_cursor` — `results: []` → курсор прежний, исключения нет, сокет жив (AC-7).
  - [x] `test_duplicate_id_is_emitted_once` — одна строка приходит и по WS, и в дочитке → подписчик получил её РОВНО один раз (AC-7).
  - [x] `test_catchup_rows_are_emitted_oldest_first` — ответ в порядке `-created_at`, наружу по возрастанию (AC-7).
  - [x] `test_catchup_failure_keeps_the_socket_and_the_cursor` — 502 (дефолтная фикстура даёт его даром) → сокет открыт, курсор не сдвинут, backoff не стартовал (AC-8).
  - [x] `test_catchup_401_clears_the_credential` — 401 → `getCredential() === null` (AC-5/AC-8).
  - [x] `test_credential_change_resets_the_cursor` — A → строка → `setCredential(B)` → дочитка B **без `since`** (AC-6). Кириллица в фикстурах обязательна (повтор 10.2).
  - [x] `test_oversized_gap_advances_cursor_without_paging` — `count: 500`, `results.length: 200` → второго запроса нет, курсор сдвинут (AC-9).
- [x] **Task 5 — Тест индикатора** (`frontend/src/shared/ui/ConnectionIndicator.test.tsx`, NEW) (AC: 10, 12)
  - [x] Докблок jsdom, `import '@testing-library/jest-dom/vitest'` per-file (общий setup гоняется и в node-тестах), явный `afterEach(cleanup)` (globals выключены).
  - [x] Запрос — `getByRole('status', { name: ... })`, не голый `getByRole('status')` (AC-10).
  - [x] Три состояния: при монтировании до `open` индикатора **нет** (анти-мигание); после `emitClose(1006)` — текст «Нет связи с сервером» есть; после успешного `open` — снова нет. Смена статуса — в `act()`.
- [x] **Task 6 — Гейт и красная проба** (AC: 12, 14)
  - [x] `cd frontend && npm run gate` — зелёный целиком; зафиксировать число тестов (baseline **379**) и размер бандла (baseline ~168 КБ).
  - [x] `git diff --stat` по `package.json`/`package-lock.json`/`schema.d.ts` обязан быть **пустым** (AC-13).
  - [x] **Красная проба обязательна** — минимум 10 мутаций, таблица в Dev Notes. Бэкап через `cp` в скретчпад, **`git checkout` запрещён**, восстановление + `diff` → IDENTICAL.
  - [x] Сверить File List и число тестов с `git diff --name-only 7c88f0a` + untracked **до** ревью (AI-3 ретро E9), исключив чужие файлы 10.3 поимённо.

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; менять осознанно)

> **№1 = A (heartbeat в 11.3 НЕ реализуется — он протокольный, и это проверено, а не предположено).**
> Формулировка epics.md#L1246 «клиент с … heartbeat» при столкновении с живым бэком не имеет реализуемого содержания на стороне браузера. Три факта, каждый проверен в коде: (1) `NotificationConsumer.receive` — **явный no-op** с комментарием, адресованным этой стори: «The 11.3 client only listens; liveness is protocol-level ping/pong plus the nginx read-timeout in 12.1» (`consumers.py:72-76`), запинено `test_inbound_frames_are_ignored_and_the_socket_survives_them` (`test_ws_consumer.py:428-443`) — прикладной `{"type":"ping"}` уйдёт в тишину; (2) браузерный `WebSocket` **не умеет** инициировать протокольный ping — такого API в JS нет; (3) architecture.md#L337 отдаёт ping/pong и `proxy_read_timeout 3600` в nginx стори 12.1.
> **Отвергнуто (б) «watchdog по входящим кадрам»:** сервер молчит сутками ПО ЗАМЫСЛУ (`SUBMISSION_LAGGING` — одно уведомление на день), поэтому «нет кадров N секунд → переподключись» породил бы шторм реконнектов на исправном соединении. Это не консервативная реализация, а поломка.
> **Отвергнуто (в) «периодический REST-поллинг как liveness»:** работает, но (1) вводит поллинг, который epics.md#L1262 отдаёт стори 11.5 как содержание kill-switch-fallback; (2) каденс не задан НИ ОДНИМ артефактом (EXPERIENCE.md#L300 и UX `.decision-log.md:150` держат это открытым вопросом) — то есть это новое решение без источника; (3) architecture.md#L31 прямо запрещает цитировать отвергнутый polling как решение.
> **Что остаётся вместо heartbeat:** `close`/`error` → backoff (AC-4) и дочитка на каждый `open` (AC-7). **Признаваемый пробел:** «чёрная дыра» — сокет с молча умершим TCP — до 12.1 не детектируется ничем, оператор будет видеть `online` без событий. Принято сознательно (12.1 приходит до пилота) и **вынесено входом в 12.1**, чтобы не потерялось как «просто не сделали» — ровно как 11.1 вынесла `?token=` в логах nginx.

> **№2 = A (`mock-socket` НЕ ставим; свой ~40-строчный `FakeSocket` + инъекция фабрики).**
> epics.md#L1250 называет `mock-socket` в скобках как подсказку инструмента, не как контракт. Отвергаем: (1) **прецедент этого же эпика** — 11.1 отказалась от `channels.testing`, потому что он тянет daphne (14 транзитивных пакетов в offline-зеркало контура), решение Bratan — свой тонкий `WsCommunicator`; здесь ситуация зеркальная, а цена своего фейка ниже (~40 строк, ноль зависимостей); (2) любая новая npm-зависимость проходит через offline-зеркало (architecture.md#L264) и дисциплину пинов (ретро E8); (3) `mock-socket` патчит **глобальный** `WebSocket`, а инъекция фабрики даёт то же покрытие без глобальной мутации и попутно закрывает AC-11 той же механикой. Канон проекта прямой: свой `client.ts` вместо orval, свой `toast.tsx` вместо sonner, свой `WsCommunicator` вместо daphne.
> **Отклонение от буквы epic-AC зафиксировано здесь сознательно** — ревью обязано подтвердить, а не «обнаружить». Проверено: `mock-socket` в `node_modules` отсутствует.

> **№3 = A (курсор с grace 5 с + дедуп по `id`; НЕ голый `max(created_at)`).**
> Это не выбор стори, а исполнение предписания: `deferred-work.md:509` (ревью 5.7c) описывает дефект и назначает лечение дословно — «перекрытие окна (`since = max_seen_created_at − grace ~5s`) + дедуп по `id`», с адресатом «UI-поллинг (10.9/E11)». Голый курсор навсегда теряет строку, закоммиченную позже её `created_at`; `>=` вместо `>` не лечит (сказано там же). Дедуп — обязательная вторая половина grace: без него каждый reconnect выдавал бы 5-секундный хвост повторов.
> **Почему дедуп живёт здесь, а не в 11.4:** канал доставки один (`emit`), и оба его входа пересекаются по построению; дедуп на потребителе означал бы, что каждый будущий потребитель обязан об этом помнить.

> **№4 = A (клиент НЕ разбирает close-коды; терминирует смена credential). ⚠️ ЭТО ИСПРАВЛЕНИЕ ОЧЕВИДНОГО ДИЗАЙНА — читать целиком.**
> Напрашивающееся решение — «`4403` терминален, не ретраить» — **неверно, и его тест был бы вакуумным**. `consumers.py:55-59` закрывает handshake **до `accept()`**; ASGI-контракт для `websocket.close` до `websocket.accept` предписывает серверу ответить **HTTP 403**, то есть WS-рукопожатие не завершается и браузер получает `CloseEvent{code: 1006, wasClean: false}` — приватный `4403` (`consumers.py:41`) на провод не выходит. Python-тесты 11.1 видят `4403` только потому, что `WsCommunicator` читает ASGI-сообщения напрямую, минуя браузерный handshake. Ветка `if (code === 4403)` была бы зелёной на `FakeSocket` и мёртвой в проде — заложенный в спеку вакуум (ретро E9 §3).
> **Что делаем вместо:** отказ по identity ведёт себя как транспортный сбой — backoff с потолком 30 с (≤2 запроса в минуту). Терминирует его существующая 401-машинерия: протухший токен даёт 401 на обычных запросах → `handle401` (`providers.tsx:27-33`) чистит credential → AC-6 останавливает сокет. Усиление: дочитка на 401 сама зовёт `clearCredential()` — это канон 401-семантики, а не новая норма.
> **Что при этом теряется, честно:** комментарий `consumers.py:37-40` предупреждал ровно об этом («would reconnect into the void forever»), и предупреждение остаётся в силе — просто лечится оно не на клиенте. Настоящий фикс — `accept()` → `close(4403)` на сервере, и он в скоуп 11.3 не входит (AC-13). Вынесено **открытым вопросом №1** с адресом (11.5/12.1) вместо тихой поломки.

> **№5 = A (fallback-модель НЕ зашивается: 11.3 не решает спор «ручной refresh» vs «polling»).**
> Расхождение уже вынесено открытым вопросом №6 стори 11.2 «решить к 11.5»: architecture.md#L64/#L327 говорят «ручной refresh», а EXPERIENCE.md#L187/#L276, UX `.decision-log.md:58,73` и **epics.md#L1262 (сам AC стори 11.5)** — «polling». Счёт 6:2 в пользу polling, но решение не за 11.3. **Следствие для дизайна:** держим границу «WS — только канал доставки события в `emit`», а не «WS — единственный источник данных». Тогда 11.5 добавляет fallback одной точкой — конфигурацией, а не второй архитектурой.

> **№6 = A (эмит наружу через `subscribeMessages`, а НЕ `queryClient.setQueryData` из транспорта).**
> ARCH-FE-010 предписывает «уведомления = WS → `queryClient.setQueryData`», и это будет выполнено — в 11.4, которая владеет ключом запроса и формой кэша. Транспорт из `shared/` не должен знать `queryKey` чужой фичи: правило «один владелец запроса, вниз — данные» зафиксировано 10.3 Решением №7 (два вызова одного ключа с разными `queryFn` — известная ловушка react-query).
> **Честно про риск:** до 11.4 у `subscribeMessages` нет прод-потребителя, и ревью вправе назвать это «кодом впрок». Контраргумент: именно этот поток — предмет AC «пропущенные события не теряются», он покрыт восемью поведенческими тестами; альтернатива (писать в `queryClient` ключ, которого ещё никто не читает) хуже — она создаёт неявного владельца кэша.

> **№7 = A (первое подключение только SEED-ит курсор и НЕ эмитит).**
> Без этого пустой курсор на старте даёт `GET ?limit=200` **за всю историю** (`views.py:24-29`, `max_limit=200`), и весь этот залп ушёл бы в `emit` на каждой загрузке страницы — в 11.4 это тосты/счётчик по двухсотлетней истории. Плюс AC-9 (`count > results.length`) срабатывал бы у любого живого пользователя на каждом старте, превращая предупреждение в шум.
> **Почему это не потеря данных:** истина — REST/БД (architecture.md#L327), и центр уведомлений 11.4 читает полный список собственной пагинацией. Поток 11.3 — ДЕЛЬТЫ.
> **Краевой случай закрыт явно:** если на момент SEED строк не было вовсе, курсор остаётся пустым, но `seeded = true`; следующая дочитка идёт без `since` и **эмитит** — все вернувшиеся строки заведомо новее момента старта. Иначе строка, родившаяся в первый же разрыв, потерялась бы навсегда.

### Архитектурные правила (developer guardrails)

- **Слои (ARCH-FE-013, eslint.config.js:130-166).** `shared → только shared`. Проверено валидацией: `shared/notifications/**` попадает в `{type:'shared', pattern:'src/shared/**'}`, политика `shared → shared` (eslint.config.js:161-164) покрывает и `shared/notifications → shared/api|auth`, и `shared/ui/ConnectionIndicator → shared/notifications`; `no-unknown-files` не сработает. Barrel-`index.ts` запрещены.
- **Стейт (ARCH-FE-010).** Ни `zustand`/`jotai`/`redux`/`valtio`/`nanostores` (забанены и в eslint, и в `deps-gate.mjs` по `package-lock.json`, включая npm-алиасы), ни третьего Context, ни дублирования серверных данных в `useState`. Внешний источник + `useSyncExternalStore` — принятый паттерн (`usePermissions.ts:18`, `credential.ts:63-95`).
- **Сеть (ARCH-FE-015).** Только `apiClient`; `fetch`/`XMLHttpRequest` и их `window.*`/`globalThis.*` формы забанены вне `src/shared/api/**`.
- **Совместимость FF100 (architecture.md#L231).** `AbortSignal.timeout` использовать нельзя (граница зафиксирована в `client.ts:1-8`) → таймауты только `setTimeout`. `.toReversed()`/`.toSorted()` — **Firefox 115**, вне цели: `eslint-plugin-compat` покрывает Web API, но не методы `Array`, и `build.target` их не полифиллит → используем `[...rows].reverse()`.
- **Логи.** `console.warn`/`console.error` легальны (`no-console` в конфиге отсутствует — проверено). **Без ПДн, без токена**: в лог — код закрытия, `kind`, `business_date`; не `payload`, не URL сокета целиком.
- **Пути роутера (ARCH-FE-012).** Правило про литеральные пути касается роутов React Router, не URL API/WS (уточнено 10.3) — константу всё равно завести (AC-2).
- **Кириллица в путях репо.** Node-скриптов стори не заводит; если появятся — только `fileURLToPath(new URL(...))` (инцидент 8.8).

### Ловушки (проверено в коде/прогоном — не наступать)

1. **🔴 `size-gate.mjs` роняет ВЕСЬ `npm run gate` на литерале `ws://`/`wss://` в `dist/`** — без анализа контекста (`size-gate.mjs:88-93`), спасает только точное `localhost`/`127.0.0.1` (`:58`). Лечение — динамическая сборка URL (AC-2). **Проверено воспроизведением логики скрипта**, не чтением по диагонали.
2. **🔴 Дефолтный MSW-хендлер `*/api/notifications/` уже отдаёт 502 HTML** (`handlers.ts:181-188`). При `onUnhandledRequest: 'error'` (`vitest.setup.ts:6`) любой тест дочитки без `server.use(...)` получит 502 и «докажет» не то, что хотел. **Дефолтный хендлер не переопределять глобально** — на нём висят `client.test.ts:217` и `useApiMutation.test.tsx:256` (оба проверены). Точный аналог Ловушки №1 стори 10.3, где правка общей фикстуры уронила 16 чужих тестов.
3. **🔴 В jsdom `WebSocket` настоящий** (`typeof === 'function'`, `CLOSED === 3` — проверено прогоном), в node-окружении тоже (node 24). Без Task 3 два существующих AppLayout-теста полезут в сеть и увидят «Нет связи». Это не гипотеза — это то, что произойдёт при первом же `npm run gate` после Task 2.
4. **🔴 Модуль трогает `location` → его тест обязан идти в jsdom.** Дефолтное окружение vitest в проекте — **`node`** (`vite.config.ts:27`), там `location === undefined` (проверено). Докблок `// @vitest-environment jsdom` **первой строкой** (vitest 4 удалил `environmentMatchGlobs`). MSW/node в jsdom работает, и синглтон `apiClient` с относительным путём доходит до хендлера как `http://localhost:3000/...` — **проверено прогоном**, прецедент `DailyUpdatePage.test.tsx`.
5. **🔴 `error` и `close` фаерятся ОБА** при неудачном подключении → без идемпотентного гарда планирования получаются два таймера и удвоение сокетов на каждой итерации (AC-4).
6. **`getSnapshot` обязан возвращать стабильную ссылку.** Новый объект на каждый вызов → «The result of getSnapshot should be cached» + бесконечный ререндер (Ловушка 7 стори 8.6). Статус — строковый литерал; наружу объект `{status, attempt}` НЕ собирать.
7. **StrictMode монтирует эффект дважды** (`main.tsx:8`). `start()`/`stop()` идемпотентны, иначе в dev два сокета и удвоенная дочитка. `stop()` обязан снимать `retryTimer` — иначе висящий таймер откроет сокет после размонтирования.
8. **Неизвестный query-ключ read-API молча игнорируется** (`deferred-work.md:524`): опечатка `?sinse=` вернёт **всю** видимую историю со статусом 200. Поэтому ассерт AC-7 — по значению параметра в URL. **Отдельно и не путать:** битый *формат* `since` даёт **400** (`api/serializers.py:33`, `raise_exception=True`), а не игнорирование.
9. **`since` строго больше** (`selectors.py:41-42`, `created_at__gt`) — строка ровно на границе НЕ вернётся (`test_notifications_read_api.py:110-119`). Поэтому grace вычитается, а не прибавляется.
10. **Формат времени — `+05:00`, не UTC.** `TIME_ZONE = "Asia/Qyzylorda"`; `created_at` в REST и в WS-конверте байт-в-байт одинаков (`test_ws_notify.py:487-513`, `:543`). Курсор считать через `Date.parse`, **не лексикографическим сравнением строк** — оно верно лишь пока смещение у всех строк одинаково, а это не контракт. На провод отдавать `.toISOString()` (UTC `Z`) — DRF примет; сырое `+05:00` без `encodeURIComponent` превратит `+` в пробел → 400, и AC-8 это молча проглотит.
11. **Пагинация здесь LimitOffset (`limit`/`offset`), а не `page`.** У `/api/core/employees/` — PageNumber; код дочитки, скопированный из соседней фичи, не подойдёт (повтор ловушки 10.3).
12. **`NetworkError` НЕ наследует `ApiError`** (`errors.ts:102-108`) — `instanceof ApiError` его не поймает. В `catch` дочитки ловить всё; единственная ветка — `ApiError.status === 401`.
13. **Один actor может держать несколько сокетов** (две вкладки, перекрывающийся reconnect) — группа привязана к actor, а не к соединению (`test_ws_e2e.py:201-222`). Дубликаты доставки — норма транспорта; дедуп по `id` (AC-7) закрывает это тем же механизмом, что и grace.
14. **`?since=` нет в сгенерированной схеме.** `schema.d.ts:2440-2447` знает только `limit`/`offset` (`grep since` по схеме — пусто). **Тип ОТВЕТА брать из схемы**, **строку запроса собирать руками** — прецедент `DailyUpdatePage.tsx:200-213`. Схему **не регенерировать** (AC-13).
15. **`Notification.payload` в схеме — `unknown`** (`schema.d.ts:1353`). Не пытаться типизировать доменный payload: 11.3 его не читает, только переносит.
16. **`stop()` не отменяет дочитку в полёте** — у `apiClient` нет `AbortSignal` вовсе (`client.ts:31-55`). Без гарда по `epoch` ответ придёт после размонтирования, продвинет курсор и эмитнёт в отписанных слушателей.
17. **`role="status"` уже занят тостом** (`toast.tsx:54`, постоянный элемент, смонтирован в `providers.tsx:51`) — запрашивать индикатор по accessible name (AC-10). В репозитории обходили дважды (`print-routing.test.tsx:49`, `DaySubmissionPanel.test.tsx:489`).

### Previous Story Intelligence

- **11.1 (done).** Путь `/ws/notifications/` со **значимым трейлинг-слешем**; identity `?token=`/`?user_id=` (Решение №1 — принято именно ради этого клиента); `AllowedHostsOriginValidator` сознательно НЕ добавлен (Решение №6) — иначе dev через vite-прокси с Origin `localhost:5173` не подключился бы вовсе. Входящие кадры игнорируются — основание Решения №1. **Осторожно:** «клиент увидит close-код 4403» из 11.1 верно для Python-теста и НЕ верно для браузера — см. Решение №4.
- **11.2 (done).** Конверт `{"type": <kind>, "payload": <проекция NotificationSerializer>}`; `payload` — те же 7 полей и тот же формат времени, что у REST, **проверено полным равенством значений**. Поэтому строки из WS и из дочитки льются в один поток без нормализации. Инвариант «WS-сигнал = изменение состояния, а не факт вызова» (шлём только при `created`) означает: повторов «того же уведомления» от сервера НЕ будет — все дубли порождены grace-окном и мульти-вкладками, то есть дедуп по `id` покрывает их полностью.
- **5.7c (done).** `?since=` живой: строго `created_at > since`, порядок `-created_at, id`, LimitOffset (default 50, max 200), 403 без actor, 400 на битый datetime, чужие query-ключи игнорируются. Индекс `ix_notif_recipient_recency (recipient, -created_at, id)` покрывает ровно этот запрос — дочитка базу не нагрузит.
- **10.2/10.3 (10.3 в `review`).** Три повторяющиеся находки ревью, каждая с прямым аналогом здесь: (а) **фантомный флаг переживает смену контекста** (`dirtyCount`, `localDrift`) → курсор/дедуп/`seeded` умирают со сменой credential (AC-6); (б) **цикл дочитки без гарда прогресса** уронил vitest-воркер по OOM → цикла по страницам нет вовсе (AC-9); (в) **гард стоит не там, где путь реально проходит** → тест доказывает «сокет не создан»/«запрос не ушёл», а не «текст показан».
- **8.4–8.8.** Свой `client.ts` вместо кодогена; `toast.tsx` с экспортом таймаута ради fake timers; `credential.ts` как эталон внешнего источника; локальные render-обёртки в тестах фич и реальная композиция `Providers` в app-тестах; бан глобала `fetch` был добавлен ТЕМ ЖЕ PR, что и клиент (ревью 8.4 закрыло обход через `window.fetch`) — отсюда 11.3a.
- **Ретро E9.** AI-1: красная проба = гейт, зелёная проба = ассерт вакуумен = стори не `done`. AI-2: cross-model ревью. AI-3: сверка File List с git-диффом ДО ревью. §3: «тесты, которые не могут упасть» — пять форм вакуума.
- **Ретро эпика 10 НЕ существует** (эпик не закрыт; 11.1/11.2 ушли вперёд) — действующие процессные гейты это AI-1/AI-2/AI-3 ретро E9.

### Git Intelligence

- Baseline `7c88f0a`; фронтовые предшественники (E8/E9/E10) все на этой ветке — проверено `git log`.
- **В рабочем дереве незакоммиченная стори 10.3** (`review`): `frontend/src/features/daily-grid/**`, `frontend/e2e/day-submission.spec.ts`, `frontend/e2e-harness/day-submission.*`, `frontend/vite.e2e.config.ts`, `docs/contracts/09-01-*`, `.claude/settings.json`. **Пересечений по файлам с 11.3 нет** (11.3 не заходит в `features/`), но `git diff --name-only 7c88f0a` будет полон чужого — File List собирать поимённо (AI-3), коммит делать путево-ограниченным.
- ⚠️ **Общая точка риска ровно одна: `shared/api/testing/vitest.setup.ts`** (Task 3) — файл общий для всех тестов. На момент создания стори в диффе 10.3 он не значится; сверить перед коммитом.
- Таймерного прод-кода на фронте практически нет: единственный `setTimeout` вне тестов — авто-dismiss тоста. 11.3 вводит первый настоящий таймерный контур — отсюда требование ассерта-расписания, а не «ретраи бывают».
- Коммит (за Bratan, после ревью): `feat(story-11.3): WS-клиент с reconnect, дочиткой ?since= и индикатором связи`. Артефакты агент НЕ коммитит. `graphify update .` **не нужен** — граф покрывает `Backend/VAPS/apps`, бэк не тронут.
- Ревью: **cross-model обязательно + красная проба** — стори трогает живой сетевой контур (прецедент правила: 10.3, «same-model без красной пробы не принимается»).

### Красная проба (гейт AI-1 ретро E9 — условие `done`, не намерение)

Минимум десять мутаций. Бэкап — `cp` в скретчпад; **`git checkout` запрещён** (урок 9.6: стирает незакоммиченные правки, а в дереве прямо сейчас лежит чужая 10.3); после восстановления `diff` → IDENTICAL, гейт снова зелёный.

| # | Мутация | Обязан покраснеть | Что доказывает |
|---|---|---|---|
| 1 | `RECONNECT_FACTOR` → 1 | `test_backoff_follows_the_schedule` | ассерт проверяет РАСПИСАНИЕ, а не «ретрай был». **Если зелёный — формула читает литерал вместо константы (AC-4)** |
| 2 | снять гард идемпотентности в `scheduleReconnect` | `test_error_and_close_schedule_a_single_retry` | `error`+`close` не удваивают попытки |
| 3 | убрать сброс `attempt = 0` в `open` | `test_successful_open_resets_the_attempt_counter` | покрыта отдельная ветка, а не одна дважды |
| 4 | убрать вычитание `SINCE_GRACE_MS` | `test_catchup_uses_cursor_with_grace` | сравнение по ЗНАЧЕНИЮ; при ассерте «запрос ушёл» осталось бы зелёным (Ловушка 8) |
| 5 | отключить дедуп по `id` | `test_duplicate_id_is_emitted_once` | grace и дедуп — одна пара |
| 6 | снять монотонный клэмп курсора | `test_cursor_never_moves_backwards` | гонка WS ↔ дочитка реально покрыта |
| 7 | эмитить строки в SEED-ветке | `test_first_open_seeds_the_cursor_without_emitting` | старт не выплёвывает историю |
| 8 | не очищать курсор в обработчике `credential.subscribe` | `test_credential_change_resets_the_cursor` | утечка курсора между пользователями |
| 9 | двигать курсор при пустых `results` | `test_empty_catchup_keeps_the_cursor` | `-Infinity`/`Invalid Date` не проскакивает |
| 10 | убрать `try/catch` вокруг дочитки | `test_catchup_failure_keeps_the_socket_and_the_cursor` | non-fatal проверяется, а не подразумевается |
| 11 | показывать индикатор при `connecting` | тест анти-мигания (Task 5) | регресс, который иначе увидит только оператор |

**Если мутация НЕ покраснела — это находка, а не формальность.** Прецедент 10.3: две непокрасневшие пробы вскрыли реальную слабость тестов (дублирующие рубежи), и правильной реакцией было усилить тест, а не объявить пробу неудачной.

### Project Structure Notes

- **NEW:** `frontend/src/shared/notifications/notificationsSocket.ts`; `frontend/src/shared/notifications/notificationsSocket.test.ts`; `frontend/src/shared/ui/ConnectionIndicator.tsx`; `frontend/src/shared/ui/ConnectionIndicator.test.tsx`.
- **MOD:** `frontend/src/shared/ui/AppLayout.tsx` (одна вставка в шапку); `frontend/src/shared/api/testing/vitest.setup.ts` (инертный сокет).
- **Файлов 6 — сверх ориентира «≤5», и это заявлено, а не проглядено.** Прод-кода **три** файла (транспорт, компонент, одна строка в AppLayout), тестов два, инфраструктуры тестов один. Резать дальше нечего: транспорт без теста непроверяем, индикатор без Task 3 ломает чужие тесты. Ответственность одна — «соединение с `/ws/notifications/` живёт, чинится и не теряет событий».
- **Мелочь, о которой сказать вслух:** `__resetNotificationsSocketForTests` уедет в прод-бандл (tree-shaking его не выбросит — он экспортируется и используется). Пять строк при бюджете 300 КБ и запасе 44% — цена принята; отдельная тестовая точка входа не заводится.
- **Вынесено из скоупа с поимённым преемником** (чтобы хвост не «завис намерением» — урок E8/E9 «action item без триггера-гейта не исполняется»):
  - **11.3a — бан глобала `WebSocket` вне транспорта.** По прецеденту 8.4 (бан `fetch` пришёл тем же PR, что и клиент) правильный второй слой enforcement — `no-restricted-globals` на `WebSocket` вне `src/shared/notifications/**` + красная фикстура в `scripts/lint-canon.test.mjs`. Не включено сюда: ещё два файла и отдельный самотест линта, ортогональные поведению клиента. Дыра реальна и проверена: `WebSocket` в бан-списке отсутствует, `grep WebSocket src/` → ноль, то есть `new WebSocket` сегодня легален в любом слое.
  - **`?since=` в OpenAPI-схеме.** Параметр живой на бэке (`api/serializers.py:33`, `selectors.py:41-42`), но drf-spectacular его не эмитит → в `schema.d.ts` его нет. Тот же класс, что уже вынесенная **10.1c** — сложить туда, а не заводить третью схема-стори. 11.3 не блокирует: тип ответа из схемы, строка запроса руками.
- **File List обязан совпасть с `git diff --name-only 7c88f0a` + untracked, ЗА ВЫЧЕТОМ файлов 10.3** — исключённые перечислить поимённо (AI-3).

### Открытые вопросы (Bratan — не блокируют dev 11.3)

1. **🔴 Отказ по identity не наблюдаем в браузере — нужен ли серверный фикс, и чей он.** `close(4403)` до `accept()` доходит до браузера как `1006` (Решение №4). Сегодня это лечится 401-машинерией с задержкой; браузерно-честный вариант — `accept()` → `close(4403)` в `NotificationConsumer`, что ломает мотивировку `consumers.py:37-40` («accepting-then-staying-silent was rejected») лишь на словах: закрытие следует сразу за accept, «молчания» нет. Правка бэка вне скоупа 11.3 → **адрес: 11.5 (когда consumer всё равно правится под kill-switch) или 12.1**. **Ревью: подтвердить адрес.**
2. **🟡 Текст индикатора «Нет связи с сервером» — предложен, не канонизирован.** UX фиксирует только ярлык «нет связи» (EXPERIENCE.md#L187, #L276) и прямо оговаривает, что литеральные строки/aria не выдумывались (EXPERIENCE.md#L299). Правка — одна строка + один ассерт.
3. **🟡 Расписание backoff (1 с → ×2 → потолок 30 с, полный джиттер, без потолка попыток) — решение стори.** Ни один артефакт не называет чисел (проверено). По правилу «молчание источников = вынести решением» — вынесено. Числа — экспортируемые константы, цена смены нулевая.
4. **🟡 Heartbeat как протокольный ping/pong — вход в 12.1, а не забытая задача.** До nginx с `proxy_read_timeout 3600 + ping` молча умерший сокет не детектируется ничем (Решение №1). Зафиксировать в 12.1 рядом с однородными входами (`?token=` не логировать в `$args`; `AllowedHostsOriginValidator`).
5. **Наследуется от 11.2 (вход 11.4):** `payload_fields` в `ws-message-types.yaml:30` описывает донорскую форму, противоречащую реальной проекции — **не типизировать конверт по реестру**; истина — `NotificationSerializer`. И: `SUBMISSION_LAGGING` отсутствует в списке пилотных событий UX (EXPERIENCE.md#L187) — блокер 11.4 (нужен текст/иконка/приоритет), для 11.3 нет: клиент type-agnostic.
6. **Наследуется (решить к 11.5):** «ручной refresh» (architecture.md#L327) vs «polling» (epics.md#L1262, EXPERIENCE.md#L276) — 11.3 выбор не зашивает (Решение №5). Каденс fallback-поллинга не задан ни одним источником (EXPERIENCE.md#L300).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1244-1250] — Story 11.3 AC (backoff, heartbeat, дочитка `?since=`, индикатор «нет связи»).
- [Source: _bmad-output/planning-artifacts/epics.md#L1252-1274] — 11.4/11.5/11.6: границы AC-13 (`setQueryData` — 11.4; polling-fallback — 11.5; e2e — 11.6).
- [Source: _bmad-output/planning-artifacts/architecture.md#L327] — best-effort + дочитка REST после reconnect; «событие в БД — истина, WS — сигнал» (основание AC-7/AC-8/AC-9, Решения №7).
- [Source: _bmad-output/planning-artifacts/architecture.md#L337] — «Reconnect на клиенте обязателен (деплой рвёт все WS)»; ping/pong + `proxy_read_timeout 3600` — nginx 12.1 (основание Решения №1).
- [Source: _bmad-output/planning-artifacts/architecture.md#L258, #L246, #L261] — «WS-логика на фейках: реконнект с backoff, дочитка по REST»; детерминированные счётчики, НЕ тайминги; блокирующие тайминги — DEFERRED.
- [Source: _bmad-output/planning-artifacts/architecture.md#L237, #L240, #L231, #L264, #L31] — ARCH-FE-010 (стейт), ARCH-FE-013 (слои), FF100 + бюджет бандла, offline-зеркало npm (Решение №2), «отвергнутый polling цитировать как решение запрещено» (Решение №1в).
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L159] — FR-35.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md#L187, #L238, #L276, #L299, #L300] — backoff + heartbeat + `?since=` + индикатор; цвет не единственный сигнал; литеральные строки не выдуманы; каденс polling не задан.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:509] — **предписание AC-7**: `since = max_seen_created_at − grace ~5s` + дедуп по `id`; `>=` не лечит.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:495, 524] — unread-индекс (→11.4); неизвестный query-ключ молча игнорируется (Ловушка 8).
- [Source: Backend/VAPS/apps/notifications/routing.py:11-13] + [tests/test_ws_e2e.py:120-148] — путь `/ws/notifications/`; трейлинг-слеш значим.
- [Source: Backend/VAPS/apps/core/auth/ws.py:20-23, 61-80] — `?token=`/`?user_id=`; «браузерный WebSocket не может ставить Authorization» (AC-3).
- [Source: Backend/VAPS/apps/notifications/consumers.py:37-40, 41, 55-59, 72-76] — комментарий «reconnect into the void», `CLOSE_UNAUTHENTICATED = 4403`, **close до `accept()`** (основание Решения №4), `receive` — no-op (основание Решения №1).
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_consumer.py:428-443] — входящие кадры игнорируются, ответа нет.
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_e2e.py:201-222] — несколько сокетов одного actor получают одно сообщение (Ловушка 13).
- [Source: Backend/VAPS/apps/notifications/selectors.py:41-43] — `created_at__gt` (строго больше) + порядок `-created_at, id`.
- [Source: Backend/VAPS/apps/notifications/api/views.py:24-29, 37-49] + [api/serializers.py:12-33] — LimitOffset (50/200), GET-only, 403 без actor, `since` = `DateTimeField` c `raise_exception` (Ловушка 8).
- [Source: Backend/VAPS/apps/notifications/services.py:90-119] + [tests/test_ws_notify.py:487-513, 543] — конверт `{type, payload}`; `payload` == проекция read-API; `+05:00`.
- [Source: frontend/src/shared/auth/credential.ts:7-10, 18, 63-95] — `Credential`-union, `getCredential`, `subscribe`, `clearCredential`, стабильный `getSnapshot`.
- [Source: frontend/src/app/providers.tsx:27-33, 51] — `handle401` (основание AC-5); `ToastProvider` в композиции (Ловушка 17).
- [Source: frontend/src/shared/api/client.ts:28-69, 31-55] + [errors.ts:102-108] — `apiClient`, отсутствие `AbortSignal` (Ловушка 16); `NetworkError` вне иерархии `ApiError` (Ловушка 12).
- [Source: frontend/src/shared/api/schema.d.ts:1347, 1353, 1406, 2440-2447] — `Notification`/`PaginatedNotificationList`; `payload: unknown`; **`since` отсутствует** (Ловушки 14/15).
- [Source: frontend/src/shared/api/testing/handlers.ts:181-188] + [vitest.setup.ts:6] + [client.test.ts:217] + [useApiMutation.test.tsx:256] — 502-фикстура и два её потребителя; `onUnhandledRequest: 'error'` (Ловушка 2).
- [Source: frontend/src/shared/ui/AppLayout.tsx:69-79] + [src/app/AppLayout.test.tsx:128-136] + [src/app/app-layout.qa.test.tsx:199] — место индикатора; `disabled`-колокольчик и два живых теста (AC-10/AC-11).
- [Source: frontend/src/shared/ui/toast.tsx:26, 54] + [toast.test.tsx:29-67] — экспорт константы ради fake timers; граничная пара в `act()`; постоянный `role="status"` (Ловушка 17).
- [Source: frontend/src/app/print-routing.test.tsx:49] + [features/daily-grid/DaySubmissionPanel.test.tsx:489] — прецеденты обхода коллизии `role="status"`.
- [Source: frontend/src/shared/auth/usePermissions.ts:18] — `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` (образец Task 2).
- [Source: frontend/src/features/daily-grid/DailyUpdatePage.tsx:200-213] — ручная сборка query-строки с `encodeURIComponent`; LimitOffset ≠ PageNumber (Ловушки 11/14). ⚠️ Файл правит незакоммиченная 10.3 — номера строк верны на текущем дереве.
- [Source: frontend/scripts/size-gate.mjs:57-58, 77, 88-93] — безусловный флаг `ws:`/`wss:` (Ловушка 1, основание AC-2).
- [Source: frontend/scripts/deps-gate.mjs + scripts/banned-packages.mjs] — скан `package-lock.json` (транзитивные и npm-алиасы); категории запретов (AC-13).
- [Source: frontend/eslint.config.js:130-166, 161-164, 205-249] — матрица `boundaries` (`shared → shared`), бан `fetch`/`XMLHttpRequest` и `window.*`-форм; `WebSocket` в бане ОТСУТСТВУЕТ (основание выноса 11.3a).
- [Source: frontend/vite.config.ts:27-32, 39-43] — окружение vitest `node` по умолчанию (Ловушка 4); dev-прокси `/ws` с `ws: true`.
- [Source: frontend/package.json:20] — состав `npm run gate` (AC-14); [.browserslistrc] — `firefox >= 100` (Ловушка про `[...].reverse()`).
- [Source: _bmad-output/implementation-artifacts/11-1-channels-и-channels-redis.md#Решения №1,№4,№6; :56] — `?token=`, `close(4403)`, Origin-валидатор отложен, «heartbeat — ping/pong протокола + nginx 12.1».
- [Source: _bmad-output/implementation-artifacts/11-2-публикация-в-ws-из-notify.md#AC-9, #Открытые вопросы №3,№4,№6] — паритет конверта с read-API; донорский `payload_fields`; расхождение fallback-семантики.
- [Source: _bmad-output/implementation-artifacts/10-2-экран-массового-обновления.md#Ревью] — фантомный флаг после смены контекста; цикл дочитки без гарда прогресса → OOM (основания AC-6/AC-9).
- [Source: _bmad-output/implementation-artifacts/10-3-экран-сдачи-дня.md#Решение №5,№7; #Ловушки] — модальность в jsdom не эмулируется; «один владелец запроса»; `react-hooks/set-state-in-effect`; правка общей фикстуры ломает чужие тесты.
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md] — AI-1 (красная проба = гейт), AI-2 (cross-model), AI-3 (сверка File List), §3 («тесты, которые не могут упасть»).
- [Source: прогон в worktree, 2026-07-19] — `npx vitest run` на baseline: **31 файл / 379 тестов**; jsdom 29 отдаёт настоящий `WebSocket`, node — `location: undefined`; `msw/node` перехватывает `apiClient` в jsdom (`http://localhost:3000/...`); `mock-socket` отсутствует; `advanceTimersByTimeAsync` есть в vitest 4.1.10 и в репозитории не встречается ни разу; `no-console` в eslint-конфиге отсутствует; логика `size-gate` воспроизведена на сниппетах (динамический URL — clean, литеральный `wss://` — FLAGGED).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`. ⚠️ Ревью обязано быть **cross-model** (AI-2 ретро E9).

### Debug Log References

- **Baseline подтверждён прогоном**, а не со слов спеки: `npx vitest run` на `7c88f0a` + рабочее дерево → **31 файл / 379 тестов**. Совпало со стори.
- **Ловушка 3 НЕ воспроизвелась — и это надо знать ревью.** Стори утверждала, что после Task 2 `app/AppLayout.test.tsx` и `app/app-layout.qa.test.tsx` полезут в реальную сеть и покраснеют («это не гипотеза — это то, что произойдёт при первом же `npm run gate`»). Фактически: **до** Task 3 обе зелёные (21/21), в stderr ни одного упоминания WebSocket. Причина — jsdom-соединение не успевает провалиться до конца теста, то есть краснота тайминг-зависима, а не детерминирована. Task 3 сделан всё равно: AC-11 требует, чтобы юнит-тест не выходил в сеть, независимо от того, покраснел он сегодня или нет. **Ревью:** «Task 3 не был обязателен» — неверный вывод; верный — «предсказанный симптом был флейком, требование осталось».
- **Кириллица в credential ломает дочитку — ловушка, которой в стори нет.** Первый прогон тестов дочитки: 11 падений, все `NetworkError`, ноль запросов у MSW. Причина не в MSW и не в jsdom: `setCredential({kind:'dev', userId:'оператор-42'})` кладёт нелатиницу в `authHeaders['X-User-Id']`, а undici отклоняет такое **значение заголовка** ещё до сети. Лечение: `userId` в фикстурах — ASCII (`operator-42`), как реальный идентификатор. Требование «кириллица в фикстурах обязательна» (повтор 10.2) выполнено там, где оно осмысленно — в **теле ответа** (`recipient: 'Ким Оператор Сергеевич'`, `payload.division: 'Отдел кадров'`) и в query-параметре сокета (`user_id=опер 42` — проверка `encodeURIComponent`, HTTP там не участвует).
- Красная проба прогнана скриптом с восстановлением после каждой мутации; якорь каждой мутации проверялся на уникальность (`count == 1`), иначе проба объявлялась невалидной.

### Completion Notes List

**Что реализовано (все 6 задач, все AC):**

- **Task 1 — транспорт.** `notificationsSocket.ts`: модуль-синглтон без стора и без Context, статусы `idle`/`connecting`/`online`/`reconnecting`, URL из `location` (AC-2), identity зеркалом `credential.ts` (AC-3), экспоненциальный backoff с идемпотентным планированием (AC-4), ветки по `event.code` нет (AC-5), полный сброс состояния на смену credential (AC-6), SEED + дочитка с grace/дедупом/монотонным курсором (AC-7), best-effort catch (AC-8), отказ от цикла по страницам (AC-9).
- **Task 2 — индикатор.** `ConnectionIndicator.tsx` + одна вставка в `AppLayout.tsx`; `role="status"` с различающим `aria-label`, видимый текст, `connecting` намеренно не показывает индикатор.
- **Task 3 — инертный сокет** в общем `vitest.setup.ts` на уровне модуля; `AppLayout`-тесты зелёные и до, и после Task 2 **без правок**.
- **Task 4/5 — тесты.** 18 тестов транспорта + 4 теста индикатора = **22**, ровно на столько вырос прогон (379 → 401).
- **Task 6 — гейт и проба.** `npm run gate` зелёный целиком; **11/11 мутаций покраснели**; восстановление → `diff` IDENTICAL, гейт зелёный повторно (тот же хеш бандла `index-BTa1vYT3.js`).

**Гейт (AC-14):** `deps-gate` ✓ · `schema-check` (байт-в-байт) ✓ · `tsc -b` ✓ · `eslint .` ✓ · `lint-canon` ✓ · `schema-check.test` ✓ · `vitest run` **33 файла / 401 тест** ✓ · `vite build` ✓ · `size-gate` **169.7 КБ gzip** при бюджете 300 (было ~168) · **no-CDN чисто** — то есть AC-2 подтверждён на реальном `dist/`, а не рассуждением. Именованные в AC-14 файлы (`AppLayout.test.tsx`, `app-layout.qa.test.tsx`, `client.test.ts`, `useApiMutation.test.tsx`) — 56/56 зелёных, `git status` по ним пуст. `make gate` бэка не гонялся: `Backend/**` не тронут.

**Границы (AC-13) проверены командой, а не памятью:** `git diff --stat 7c88f0a -- frontend/package.json frontend/package-lock.json frontend/src/shared/api/schema.d.ts Backend/` → пусто. Новых npm-зависимостей ноль. Общая точка риска с 10.3 (`vitest.setup.ts`) сверена: в диффе только мои строки; `AppLayout.tsx` — тоже только мои. `handlers.ts` в диффе есть, но это **10.3**, я его не трогал (дефолтная 502-фикстура цела и использована как есть в `test_catchup_failure_...`).

**Красная проба — 11/11 покраснели** (таблица стори + мутация №11):

| # | Мутация | Тест | Итог |
|---|---|---|---|
| 1 | `RECONNECT_FACTOR` → 1 | `test_backoff_follows_the_schedule` | 🔴 |
| 2 | снят гард идемпотентности | `test_error_and_close_schedule_a_single_retry` | 🔴 |
| 3 | убран сброс `attempt = 0` | `test_successful_open_resets_the_attempt_counter` | 🔴 |
| 4 | убрано вычитание `SINCE_GRACE_MS` | `test_catchup_uses_cursor_with_grace` | 🔴 |
| 5 | отключён дедуп по `id` | `test_duplicate_id_is_emitted_once` | 🔴 |
| 6 | снят монотонный клэмп | `test_cursor_never_moves_backwards` | 🔴 |
| 7 | эмит в SEED-ветке | `test_first_open_seeds_the_cursor_without_emitting` | 🔴 |
| 8 | курсор не чистится на смене credential | `test_credential_change_resets_the_cursor` | 🔴 |
| 9 | курсор двигается скопом, без гарда пустых | `test_empty_catchup_keeps_the_cursor` | 🔴 |
| 10 | убран `try/catch` вокруг дочитки | `test_catchup_failure_keeps_the_socket_and_the_cursor` | 🔴 |
| 11 | индикатор показывается при `connecting` | тест анти-мигания | 🔴 |

**Отклонения от спеки — три, все заявлены, ревью обязано подтвердить, а не обнаружить:**

1. **Добавлен экспорт `__notificationsSocketStateForTests()`** (спекой не предусмотрен). Зачем: тестам дочитки нужна детерминированная точка «дочитка ОСЕЛА» — без неё пришлось бы спать фиксированные мс, что запрещено (architecture.md#L246/#L261). Снапшот отдаёт `{status, attempt, seeded, cursorMs, catchUpInFlight}` и используется **только как примитив синхронизации**. Ассерты курсора остались **по значению `since` в URL запроса** — иначе Ловушка 8 (опечатка в имени параметра молча вернёт всю историю с 200) перестала бы ловиться. Цена — пять строк в бандле, тот же класс, что уже принятый спекой `__resetNotificationsSocketForTests` (Project Structure Notes).
2. **Второе подключение в тестах дочитки делается парой `stop()`/`start()`, а не прокруткой backoff-таймера.** Иначе каждый такой тест ждал бы реальную секунду либо тянул fake timers в связку с MSW. Путь реконнекта покрыт отдельно тестами расписания; тесту дочитки нужна только ветка «ещё один `open`». Итог — весь файл транспорта отрабатывает за ~1.9 с, блокирующих таймингов ноль.
3. **`__resetNotificationsSocketForTests()` НАМЕРЕННО не восстанавливает инъекции** (`socketFactory`/`random`). Если бы восстанавливал, общий `vitest.setup.ts` (Task 3) терял бы инертную фабрику после первого же `afterEach`, и следующий тест в том же файле ушёл бы к настоящему `WebSocket` — ровно та дыра, которую Task 3 закрывает. Зафиксировано комментарием в коде.

**Сверх спеки добавлены 4 теста** (не заменяют обязательные, а закрывают дыры, которые иначе всплыли бы на ревью): «без credential сокет не открывается вовсе», «битый кадр WS не роняет обработчик», «размонтирование останавливает транспорт», «индикатор не конфликтует с постоянным `role="status"` тоста» (последний — прямой guard Ловушки 17: в DOM реально два `role="status"`, и тест это утверждает).

**Открытые вопросы стори не закрыты и остаются на Bratan** — №1 (браузерно-ненаблюдаемый отказ по identity → адрес 11.5/12.1), №2 (текст «Нет связи с сервером» предложен, не канонизирован), №3 (числа backoff — решение стори), №4 (heartbeat → вход 12.1). Реализация ни один из них не предрешает: числа — экспортируемые константы, текст — экспортируемая константа `CONNECTION_LOST_TEXT`.

### Change Log

| Дата | Изменение |
|---|---|
| 2026-07-19 | Реализована стори 11.3: WS-клиент `/ws/notifications/` с экспоненциальным backoff, дочиткой `GET /api/notifications/?since=` (grace 5 с + дедуп по `id` + монотонный курсор), SEED-подключением без эмита и индикатором «нет связи». Инертная socket-фабрика в общем `vitest.setup.ts`. +22 теста (379 → 401), бандл 168 → 169.7 КБ gzip. Красная проба 11/11. Статус → `review`. |
| 2026-07-19 | Ревью (cross-model, AI-2 ретро E9): 1 HIGH + 2 MEDIUM + 1 LOW, все исправлены автофиксом — фантомный реконнект от позднего `close` заменённого сокета (отцепление в `connect()`); ложный warning AC-9 при битой строке в странице (`count` теперь сверяется с сырой длиной `results`); устаревший перечень «чужого» в File List; проверка формы конверта `{type, payload}` целиком. +1 регресс-тест, 2 усилены (прогон 415). Гейт зелёный повторно (169.7 КБ gzip). Статус → `done`. |

### File List

**NEW (4):**
- `frontend/src/shared/notifications/notificationsSocket.ts`
- `frontend/src/shared/notifications/notificationsSocket.test.ts`
- `frontend/src/shared/ui/ConnectionIndicator.tsx`
- `frontend/src/shared/ui/ConnectionIndicator.test.tsx`

**MOD (2):**
- `frontend/src/shared/ui/AppLayout.tsx` (импорт + одна вставка в `<header>`)
- `frontend/src/shared/api/testing/vitest.setup.ts` (инертная socket-фабрика + очистка в `afterEach`)

**Итого 6 файлов** — ровно как заявлено в Project Structure Notes.

**Добавлено QA-проходом (`bmad-qa-generate-e2e-tests`, 2026-07-19) — только тесты, прод-код не тронут:**

- **NEW (1):** `frontend/src/app/connection-indicator-wiring.test.tsx` — разводка индикатора в реальной композиции `Providers + AppRoutes`. Отдельным файлом, а не правкой `AppLayout.test.tsx`, чтобы тот остался зелёным без изменений (AC-14).
- **MOD (1):** `frontend/src/shared/notifications/notificationsSocket.test.ts` — +12 тестов на непокрытые ветки.

**Итого по стори 7 файлов.** Тестов 22 → **35**; прогон 401 → **414** (34 файла). Красная проба QA — **13/13**. Сводка: `_bmad-output/implementation-artifacts/tests/test-summary-11-3.md`.

**Ревью-проходом (2026-07-19) — правки только внутри уже заявленных файлов, новых нет:**

- **MOD:** `frontend/src/shared/notifications/notificationsSocket.ts` (отцепление заменяемого сокета в `connect()`; `count` vs сырая длина `results`; проверка `type` в конверте).
- **MOD:** `frontend/src/shared/notifications/notificationsSocket.test.ts` (+1 регресс-тест «поздний close заменённого сокета», усилены «битая строка внутри страницы» и «битый кадр»). Тестов 35 → **36**; прогон 414 → **415**.

**Сверено с `git diff --name-only 7c88f0a` + untracked (AI-3 ретро E9); перечень «чужого» актуализирован ревью 2026-07-19.** На момент дев-прохода чужим была незакоммиченная 10.3 — она уже **закоммичена** (`9e013d2` + `608765f`). Остальное в текущем диффе — **чужое, к 11.3 отношения не имеет**, перечислено поимённо: стори **10-3a** (роут светофора: `Backend/VAPS/apps/operations/api/urls.py`, `Backend/VAPS/apps/operations/submissions/api/{serializers,views}.py`, `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py`, `Backend/VAPS/apps/operations/submissions/tests/test_traffic_light_api.py`, `Backend/VAPS/schema.yaml`, `frontend/src/shared/api/schema.d.ts` — все правки только traffic-light, к WS/`?since=` не относятся), `.claude/settings.json` и BMAD-артефакты `_bmad-output/**`. **Коммит обязан быть путево-ограниченным** — семь файлов стори плюс `sprint-status.yaml`.

## Senior Developer Review (AI)

**Дата:** 2026-07-19 · **Ревьюер:** Bratan (cross-model: ревью — Claude Fable 5, дев — Opus 4.8; AI-2 ретро E9 соблюдён) · **Итог: Approve** (после автофиксов; CRITICAL — 0)

### Проверено

- **AC-1…AC-14 сверены с кодом построчно**, каждый чекбокс Task 1–6 — с реализацией (дрейф чекбоксов не обнаружен; одно отклонение буквы Task 1 закрыто фиксом №4 ниже). Все 16 поимённо заказанных тестов Task 4 существуют и ассертят по значениям (URL-параметры, полный массив расписания), не по фактам вызова.
- **Гейт прогнан целиком после фиксов:** `npm run gate` зелёный — 415 тестов / 34 файла, бандл **169.7 КБ gzip** (бюджет 300), `no-CDN` чисто, `tsc`/`eslint`/`lint-canon`/`schema-check` без замечаний. Именованные в AC-14 файлы зелёные без правок.
- **Границы (AC-13):** `package.json`/`package-lock.json`/`Backend/**` (в части 11.3) не тронуты; правки `Backend/**`+`schema.{yaml,d.ts}` в дереве принадлежат стори 10-3a (traffic-light) — проверено чтением диффа, пересечений с 11.3 нет.
- Решения №1–№7 стори (heartbeat, mock-socket, grace+дедуп, close-коды, fallback, subscribeMessages, SEED) — реализация им соответствует; три заявленных отклонения дев-агента подтверждены как обоснованные.

### Находки и резолюции

| # | Severity | Находка | Резолюция |
|---|---|---|---|
| 1 | HIGH | **Поздний `close` уже заменённого сокета рождал фантомный цикл.** `connect()` перезаписывал `socket` без отцепления обработчиков предшественника, а эпоха у них общая — `error`+опоздавший `close` (в браузере они пара, close может прийти позже retry-окна) флапал статус в `reconnecting` при живом преемнике и плодил лишний сокет; заменённый живой сокет при этом утекал незакрытым. Красная проба: сценарий падал до фикса. | Исправлено: `closeSocket()` в начале `connect()` + регресс-тест «поздний close УЖЕ ЗАМЕНЁННОГО сокета не рождает фантомный цикл» |
| 2 | MEDIUM | **Ложный warning AC-9 на битой строке.** `count > rows.length` сверял `count` с числом строк ПОСЛЕ защитного отсева: одна битая строка в странице давала «пропущено больше 200 (всего 2)» при полном ответе. AC-9 говорит про `results.length` сервера. | Исправлено: `readPage` возвращает `served` (сырая длина `results`), условие — `count > served`; тест «битая строка внутри страницы» усилен ассертом отсутствия warning'а |
| 3 | MEDIUM | **File List: перечень «чужого» устарел.** Исключения перечисляли незакоммиченную 10.3, которая уже в истории (`9e013d2`), и не знали про появившиеся в дереве файлы 10-3a (`Backend/**`, `schema.yaml`, `schema.d.ts`). | Исправлено: перечень актуализирован по текущему `git status`, принадлежность каждого чужого файла 10-3a подтверждена чтением диффа |
| 4 | LOW | **Форма конверта проверялась наполовину.** Чекбокс Task 1 «проверить форму `{type, payload}`» — код валидировал только `payload`; кадр без `type` (не конверт 11.2) эмитился. | Исправлено: кадр без строкового `type` игнорируется; тест «битый кадр» усилен кейсом «payload без type» |
| 5 | LOW | **`aria-live`-регион монтируется вместе со своим текстом** — вставку live-региона одновременно с контентом скринридеры анонсируют ненадёжно (надёжен постоянный контейнер с меняющимся содержимым, как у тоста). Реализация соответствует букве AC-10 («рендерит `null` при idle/connecting/online»), поэтому это дефект спеки, не кода. | Не фиксится против контракта стори; **вход в открытый вопрос №2 (канонизация текста/поведения индикатора) и 11.4** |

**Git vs File List:** файлы стори совпадают с git-реальностью 1:1 (7 файлов, все untracked/MOD как заявлено); расхождение одно — №3 выше, документационное.

**Красные пробы дев/QA (11/11 и 13/13) приняты по таблицам + перепроверены построением новой пробы №1 (упала до фикса, зелёная после) — механика проб живая.**
