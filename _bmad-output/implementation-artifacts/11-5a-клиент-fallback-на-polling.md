---
baseline_commit: a16141d
---

# Story 11.5a: Клиент — fallback на polling

Status: done

## Story

As a **оператор, у которого администратор выключил WS-транспорт (`VAPS_WS_ENABLED=0`)**,
I want **молчаливый, не пугающий переход колокольчика на периодический опрос вместо WS**,
so that **уведомления продолжают доходить (пусть и с задержкой до интервала опроса), а не выгляжу как «нет связи с сервером», хотя доставка на самом деле работает через REST**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/11-5-kill-switch-ws.md` — фронтовая половина, вынесенная поимённо (scope_note, AC-8, Решения №2/№3, Открытый вопрос №2). Бэкенд-пререквизит (11.5, `CLOSE_WS_DISABLED = 4503`, accept-then-close) — уже `done`.

1. **AC-1 (клиент распознаёт код 4503, а не путает его с обрывом сети).** `notificationsSocket.ts`'s `onclose`-хендлер читает `event.code`. Given сервер закрывает сокет с `code: 4503` (kill-switch, отличимо от 1006 «обрыв сети» — 4403 НИКОГДА не доходит до провода, см. Dev Notes родительской 11.5, поэтому ветка по коду здесь безопасна и не «зелёная на фейке»), Then клиент переходит в НОВОЕ состояние `'disabled'` (пятое значение `ConnectionStatus`, было ровно четыре) — НЕ в `'reconnecting'`.
2. **AC-2 (в состоянии `'disabled'` — никакого backoff-цикла).** Given код 4503, Then `scheduleReconnect()` НЕ вызывается — переподключение по обычному backoff-таймеру (1с → 2с → ... → потолок 30с) было бы бессмысленным долблением по флагу, который сменит администратор, не таймер. `RECONNECT_*`-константы этой стори не касаются.
3. **AC-3 (polling активируется РОВНО в состоянии `'disabled'`, не всегда).** `useNotificationsFeed.ts`'s `useQuery` получает `refetchInterval`, зависящий от статуса сокета (подписка на `subscribeStatus`/`getStatusSnapshot`, зеркало того, как `ConnectionIndicator.tsx` уже читает тот же стор): в состоянии `'disabled'` — `NOTIFICATIONS_POLL_MS` (зеркало `TRAFFIC_LIGHT_POLL_MS = 30_000`, `TrafficLightTreePage.tsx:43`, тот же стиль константы, `refetchIntervalInBackground` НЕ включать — тот же довод, что у трафик-света: фоновая вкладка не платит за картину, которую никто не смотрит), иначе (`'online'`/`'connecting'`/`'reconnecting'`/`'idle'`) — `false` (WS уже несёт живые обновления, второй параллельный канал был бы избыточен).
4. **AC-4 (спокойный, отличимый от «нет связи» сигнал — НЕ переиспользует `CONNECTION_LOST_TEXT`).** `ConnectionIndicator.tsx` получает новую ветку рендера для `status === 'disabled'`: отдельный текст (например «Обновления раз в 30 секунд» — НЕ «Нет связи с сервером»), НЕ деструктивная цветовая семантика (не `text-destructive`/`WifiOff`-иконка красным — это ложь про реально работающую доставку, EXPERIENCE.md#L276 vs epic-AC «молчаливый переход», решено родительской 11.5 в пользу буквы epic-AC). Другая иконка (не `WifiOff`) или её отсутствие — сверить с доступным набором `lucide-react`, уже используемым в проекте.
5. **AC-5 (`ConnectionIndicator` остаётся ЕДИНСТВЕННЫМ владельцем жизненного цикла транспорта).** Новая ветка рендера — ВНУТРИ существующего компонента, не новый компонент со своим `useEffect(startNotificationsSocket/stopNotificationsSocket)` (урок `useNotificationsFeed.ts`'s докстринга: «второй владелец убил бы сокет обоим»).
6. **AC-6 (восстановление — только перезагрузкой страницы, явно принятое и задокументированное ограничение).** Открытый вопрос №2 родительской 11.5 явно перекладывает решение на эту стори. Принято: НЕ добавлять периодический ретрай на `visibilitychange`/`online` — это был бы первый в кодовой базе случай такого паттерна ради редкого административного события (флаг переключает человек, не сеть мигает). Клиент, ушедший в `'disabled'`, возвращается на WS только после `F5`/навигации. Задокументировано в Dev Notes, не молчаливо пропущено.
7. **AC-7 (регресс нулевой, `Backend/**`/`schema.*` не тронуты).** `npm run gate` (frontend) зелёный: существующие тесты `notificationsSocket.test.ts` (backoff/дочитка/identity) и `ConnectionIndicator.test.tsx` (4 текущих кейса) не сломаны — ни один не эмитил код 4503 раньше (подтверждено research: `emitClose(4503)` нигде не встречается до этой стори). `Backend/VAPS/**`, `schema.yaml`, `schema.d.ts` — ноль изменений (WS вне OpenAPI, drift-тест сравнивает байт-в-байт).

## Tasks / Subtasks

- [x] Task 1 — Новое состояние `'disabled'` в WS-клиенте (`frontend/src/shared/notifications/notificationsSocket.ts`, MOD) (AC: 1, 2)
  - [x] `export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'disabled'` — обновить докстринг-комментарий над типом (было «ровно четыре», станет пять — переписать формулировку, не оставить лживый комментарий).
  - [x] `fresh.onclose` (сейчас безусловно вызывает `handleDrop()`) — читает `event.code`. `if (event.code === 4503) { setStatus('disabled'); return }` — ДО вызова `handleDrop()`, не после (иначе `handleDrop` всё равно спланирует backoff). Обычный путь (любой другой код, включая 1006) — `handleDrop()` без изменений.
  - [x] Константу `4503` НЕ хардкодить голым числом без комментария — сослаться на `Backend/VAPS/apps/notifications/consumers.py`'s `CLOSE_WS_DISABLED`, зеркалить смысл (frontend не может импортировать Python-константу — числовой литерал с комментарием-ссылкой, тот же паттерн, что уже был бы у 4403, если бы тот доходил до провода).
  - [x] Убедиться, что состояние `'disabled'` — терминальное для ЭТОГО соединения (`stopNotificationsSocket`/новый `startNotificationsSocket` — единственный путь выйти из него, AC-6) — не подписывать НИКАКОГО таймера/слушателя из этой ветки.
- [x] Task 2 — Polling в `useNotificationsFeed` (`frontend/src/shared/notifications/useNotificationsFeed.ts`, MOD) (AC: 3)
  - [x] `export const NOTIFICATIONS_POLL_MS = 30_000` (зеркало `TRAFFIC_LIGHT_POLL_MS`, тот же файл-локальный стиль экспорта, что уже принят для `NOTIFICATIONS_LIMIT`).
  - [x] Хук подписывается на `getStatusSnapshot`/`subscribeStatus` (импорт из `notificationsSocket.ts`, тот же стор, что уже читает `ConnectionIndicator.tsx` — НЕ дублировать источник истины) — через `useSyncExternalStore`, зеркало `ConnectionIndicator.tsx`'s паттерна.
  - [x] `useQuery`'s `refetchInterval: status === 'disabled' ? NOTIFICATIONS_POLL_MS : false`.
  - [x] `refetchIntervalInBackground` НЕ ставить (AC-3, тот же довод, что трафик-свет).
  - [x] Обновить докстринг файла (строка «Осознанно НЕТ: ... start/stopNotificationsSocket» уже верна — эта стори НЕ трогает владение жизненным циклом сокета, только читает статус; уточнить комментарий, если он неявно подразумевал отсутствие ЛЮБОГО чтения статуса).
- [x] Task 3 — Спокойный индикатор (`frontend/src/shared/ui/ConnectionIndicator.tsx`, MOD) (AC: 4, 5)
  - [x] Новая экспортируемая строка `export const NOTIFICATIONS_DISABLED_TEXT = '...'` (текст решить при реализации — короткий, спокойный, НЕ «нет связи», сверить тон с существующими `NOTIFICATIONS_*`-строками `NotificationBell.tsx`).
  - [x] Условие рендера расширяется: было `if (status !== 'reconnecting') return null`; станет ветвление на 3 исхода — `'reconnecting'` (существующий деструктивный блок, БЕЗ изменений), `'disabled'` (новый спокойный блок — другие классы, не `text-destructive`, другая/никакая иконка), иначе `null`.
  - [x] `role="status"` + `aria-live="polite"` — сохранить на обоих ветках (не только на `'reconnecting'`) для консистентности a11y-контракта, но РАЗНЫЙ `aria-label`/текст, чтобы скринридер не путал «нет связи» с «плановый режим опроса».
  - [x] НЕ заводить новый `useEffect(startNotificationsSocket/stopNotificationsSocket)` — существующий эффект компонента остаётся единственным владельцем (AC-5).
- [x] Task 4 — Тесты (`notificationsSocket.test.ts`, `ConnectionIndicator.test.tsx`, `useNotificationsFeed.test.tsx`, MOD) (AC: 1, 2, 3, 4, 7)
  - [x] `notificationsSocket.test.ts`: новый кейс в стиле существующего `describe('notificationsSocket: backoff', ...)` — `sockets[0].emitClose(4503)` → `state().status === 'disabled'`, И явный негативный контроль: `scheduleReconnect`/следующий `FakeSocket` НЕ создаётся (нет попытки переподключения) — не только «статус сменился», а «побочный эффект backoff отсутствует» (иначе тест был бы вакуумным по духу урока проекта про DB-персистентность/побочные эффекты).
  - [x] `notificationsSocket.test.ts`: негативный контроль — `emitClose(1006)` (обычный обрыв) по-прежнему уходит в `'reconnecting'`, не в `'disabled'` (доказывает, что ветка различает коды, а не ловит любое закрытие).
  - [x] `ConnectionIndicator.test.tsx`: новый кейс — `emitClose(4503)` → рендерится `NOTIFICATIONS_DISABLED_TEXT`, `CONNECTION_LOST_TEXT` НЕ рендерится, класс/семантика НЕ деструктивная (ассертить именно ОТСУТСТВИЕ `text-destructive`, не только присутствие своего текста — иначе регресс «оба блока показались разом» прошёл бы мимо).
  - [x] `useNotificationsFeed.test.tsx` (или новый файл, зеркало `TrafficLightTreePage.polling.test.tsx`'s стиля fake-timer): статус `'disabled'` → `refetchInterval` реально планирует повторный запрос через `NOTIFICATIONS_POLL_MS` (fake timers, `vi.advanceTimersByTimeAsync`); статус `'online'` → нет автоматического повторного запроса за тот же интервал (негативный контроль).
- [x] Task 5 — Валидация (AC: 7)
  - [x] `npm run gate` (frontend, из `frontend/`) — зелёный целиком, включая существующие тесты `notificationsSocket.test.ts` (backoff/дочитка/identity) и `ConnectionIndicator.test.tsx` (4 текущих кейса) без изменений в их ассертах.
  - [x] Подтвердить пустой `git diff` по `Backend/VAPS/**`, `schema.yaml`, `frontend/src/shared/api/schema.d.ts` (WS вне OpenAPI, AC-7).

## Dev Notes

- **Единственный код, который реально доходит до браузера, — 4503, не 4403.** Родительская 11.5 (Решение №2) явно доказала: ASGI-контракт для `close()` ДО `accept()` (случай 4403, анонимный отказ) отвечает браузеру HTTP 403 на уровне рукопожатия — WS-соединение не завершается вовсе, браузер видит `CloseEvent{code: 1006, wasClean: false}`, приватный код 4403 НИКОГДА не долетает. Именно поэтому клиент 11.3 сознательно не содержит ветки по `event.code` — она была бы «зелёной на фейке (Python `WsCommunicator` читает ASGI-сообщения напрямую) и мёртвой в проде». Kill-switch (11.5) — ПЕРВЫЙ случай, где `accept()` вызывается ПЕРЕД `close()`, поэтому код 4503 реально долетает как `CloseEvent{code: 4503, wasClean: true}` — ветка по коду в этой стори не повторяет ту же ошибку, потому что код в принципе достижим.
- **Один тик `'online'` перед `'disabled'` — цена, названная честно родительской стори, не баг этой.** Клиент на мгновение увидит `accept()` (переход в статус online, SEED-дочитка `limit=1`) до прихода close-фрейма — один дешёвый запрос на сессию, разобран заранее в 11.5 Dev Notes, не всплывает сюрпризом при ревью этой стори.
- **Спор «polling vs ручной refresh» — уже закрыт родительской 11.5 (Решение №3), не переоткрывать.** Обоснование в пользу polling там дано не подсчётом голосов источников (`architecture.md#L64,327` против `epics.md#L1262,1266`+`EXPERIENCE.md#L276`), явно ссылается сюда как на место реализации. `architecture.md#L466` («WS — ускоритель, поллинг — истина») НЕ аргумент — та строка про AsyncJob (ARCH-DEFERRED-048), не про уведомления.
- **Восстановление только перезагрузкой — осознанный выбор, не недосмотр (AC-6).** Открытый вопрос №2 родительской 11.5 явно передал решение сюда: «если это неприемлемо, 11.5a обязана предусмотреть редкую повторную попытку». Решено НЕ предусматривать: периодический ретрай на `visibilitychange`/`online` был бы ПЕРВЫМ таким паттерном в кодовой базе (единственное существующее упоминание `visibilityState` — в тесте `TrafficLightTreePage.polling.test.tsx`, проверяющем встроенный `focusManager` react-query, не авторский код) ради редкого административного события — флаг переключает человек по рунбуку (12.1/12.7), не флап сети. Если это решение окажется неверным на практике — отдельная стори с явным потребителем, не тихое усложнение здесь.
- **`ConnectionIndicator` — единственный владелец `start`/`stopNotificationsSocket`.** Новая ветка рендера живёт ВНУТРИ существующего компонента и существующего `useEffect`; `useNotificationsFeed.ts` только ЧИТАЕТ статус (`subscribeStatus`/`getStatusSnapshot`), не вызывает `start`/`stop` — тот же источник истины, что уже читает индикатор, не второй независимый канал.
- **`refetchInterval` — условный, не всегда-включённый (в отличие от `TRAFFIC_LIGHT_POLL_MS`).** Трафик-свет поллит всегда (у него нет альтернативного живого канала); уведомления уже имеют WS как основной канал — polling должен включаться РОВНО когда WS реально недоступен (`'disabled'`), иначе — два параллельных источника обновлений без нужды (лишняя нагрузка, не лишний баг, но неоправданная).

### References

- [Source: _bmad-output/implementation-artifacts/11-5-kill-switch-ws.md] — scope_note, AC-8, Решения №2/№3/№4, Открытый вопрос №2 (все процитированы дословно исследованием при create-story).
- [Source: Backend/VAPS/apps/notifications/consumers.py] — `CLOSE_UNAUTHENTICATED = 4403` (недостижим для браузера), `CLOSE_WS_DISABLED = 4503` (достижим, accept-then-close).
- [Source: frontend/src/shared/notifications/notificationsSocket.ts] — `ConnectionStatus` (было 4 значения), `fresh.onclose`/`handleDrop()`, `RECONNECT_*`-константы, `subscribeStatus`/`getStatusSnapshot`.
- [Source: frontend/src/shared/notifications/useNotificationsFeed.ts:129-136] — текущий `useQuery` без `refetchInterval`, докстринг про единственного владельца транспорта.
- [Source: frontend/src/shared/ui/ConnectionIndicator.tsx] — единственный владелец `start`/`stopNotificationsSocket`, `CONNECTION_LOST_TEXT`, текущее условие рендера (только `'reconnecting'`).
- [Source: frontend/src/features/traffic-light/TrafficLightTreePage.tsx:35-43] — `TRAFFIC_LIGHT_POLL_MS = 30_000`, прецедент именования/стиля константы и `refetchInterval`-опции.
- [Source: frontend/src/features/traffic-light/TrafficLightTreePage.polling.test.tsx] — единственный существующий пример работы с `visibilitychange` в тестах (react-query `focusManager`, не авторский код) — довод против AC-6's отклонённой альтернативы.
- [Source: frontend/src/shared/notifications/notificationsSocket.test.ts, frontend/src/shared/ui/ConnectionIndicator.test.tsx] — существующий `FakeSocket`/`emitClose(code)`-паттерн для новых тестов, подтверждено research: код 4503 нигде не эмитировался до этой стори.

## Dev Agent Record

### Context Reference

- Собрано research-агентом (полное чтение родительской 11.5-стори с построчными цитатами Dev Notes/Решений/Открытых вопросов, текущего `notificationsSocket.ts`/`useNotificationsFeed.ts`/`ConnectionIndicator.tsx` целиком, прецедента `TRAFFIC_LIGHT_POLL_MS`, подтверждение точного значения kill-switch кода 4503 в `consumers.py`, существующих тестовых паттернов `FakeSocket`/`emitClose`).

### Completion Notes

Реализовано по плану. `ConnectionStatus` расширен до пяти значений (`'disabled'`), `useNotificationsFeed.ts` читает статус тем же стором, что уже читает `ConnectionIndicator` (`useSyncExternalStore(subscribeStatus, getStatusSnapshot, ...)`) — не заводит второго владельца жизненного цикла транспорта. `refetchInterval` условный (`status === 'disabled' ? NOTIFICATIONS_POLL_MS : false`). Индикатор получил спокойную ветку рендера с отдельными текстом/aria-label/иконкой/цветом.

**Ревью (3 агента, cross-model):**
- **Blind Hunter** (diff-only) поднял 3 вопроса: (а) параметрless-вызов `onclose()` в фейковых сокетах тестов мог бы упасть на `event.code` — проверено прямым грепом по всем тестовым файлам: ВСЕ `emitClose(code)`-хелперы уже конструируют полноценный `CloseEvent` с кодом, зеро-арг вызовов нет нигде в кодовой базе, false positive; (б) окно до ~30с молчания между обрывом WS и первым poll-запросом (TanStack `refetchInterval` не форсирует немедленный fetch при включении) — реальное наблюдение, но признано приемлемым: сама суть periodic-polling уже принимает интервальную задержку по дизайну родительской 11.5 (Решение №3), а не баг этой стори; (в) текстовая строка «30 секунд» была захардкожена отдельно от `NOTIFICATIONS_POLL_MS` — **исправлено**: `NOTIFICATIONS_DISABLED_TEXT` теперь вычисляется из константы (`` `Обновления раз в ${NOTIFICATIONS_POLL_MS / 1000} секунд` ``), не может молча разъехаться при будущей правке интервала.
- **Edge Case Hunter** (полный доступ к проекту) независимо подтвердил: «один тик online» — безвреден (`catchUp()` best-effort, ничем не аборчен, но и не ломает ничего); AC-6 технически неполон в формулировке — смена credential (logout/login) ТОЖЕ выводит канал из `'disabled'` (перезапускает `connect()`), не только перезагрузка страницы. Это НЕ баг (тот же класс восстановления, что уже задокументирован для credential-смены в остальном модуле), но формулировка AC-6 «только перезагрузка» неточна буквально — уточнено здесь, а не в самом AC (менять формулировку принятого AC пост-фактум неоправданно, комментарий фиксирует нюанс). Двойной подписки на `statusListeners` (оба потребителя, `NotificationBell` и `ConnectionIndicator`, читают один стор) не обнаружено — независимые записи в `Set`, `AppLayout.tsx` подтверждает: оба компонента смонтированы безусловно вместе, рассинхрон статусов между ними невозможен.
- **Acceptance Auditor** независимо перепрочитал код, прогнал целевой набор и полный `npm run gate` (1007/1007, size-gate 212.8 KB/300 KB), подтвердил пустой `git diff` по `Backend/VAPS/**`/`schema.*` — все 7 AC удовлетворены без расхождений.

### File List

- `frontend/src/shared/notifications/notificationsSocket.ts` (MOD) — `ConnectionStatus` (+`'disabled'`), `CLOSE_WS_DISABLED = 4503`, ветка в `onclose`.
- `frontend/src/shared/notifications/notificationsSocket.test.ts` (MOD) — новый describe-блок «kill-switch (11.5a)», 3 теста.
- `frontend/src/shared/notifications/useNotificationsFeed.ts` (MOD) — `NOTIFICATIONS_POLL_MS`, чтение статуса, условный `refetchInterval`.
- `frontend/src/shared/notifications/useNotificationsFeed.test.tsx` (MOD) — новый describe-блок «polling-fallback», 3 теста (включая негативный контроль на `'online'`).
- `frontend/src/shared/ui/ConnectionIndicator.tsx` (MOD) — новая спокойная ветка рендера для `'disabled'`.
- `frontend/src/shared/ui/ConnectionIndicator.test.tsx` (MOD) — новый тест на спокойный индикатор.

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
| 2026-07-29 | dev-story: реализация + фикс текстового дрейфа от NOTIFICATIONS_POLL_MS (ревью) → done |
