---
baseline_commit: |
  814a80d (chore(epic-10-retro-ai1): хойст дата-хелперов в shared/lib/dates.ts) на
  ветке claude/hungry-leavitt-78b450. Epic 10 (10.1-10.10) done, epic-10 в
  sprint-status.yaml синхронизирован на done (retro AI-4). Ретро E9 AI-1 (хойст
  дата-хелперов) выполнен ДО этой стори (retro E10 AI-1), как предписано. Первая
  стори Epic 11 (WebSocket-уведомления) — ASGI/Channels в проекте ОТСУТСТВУЮТ
  полностью (нет asgi.py, нет Celery, нет Redis нигде в стеке) — 11.1 вводит их
  с нуля.
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 11 заголовок: "Channels
    (channels_redis) + consumers, WS-клиент с reconnect и дочиткой ?since=, центр
    уведомлений UI, kill-switch с fallback"; §Story 11.1: "ASGI-роутинг
    /ws/notifications/ + consumer с группой по user_id на channels_redis, So that
    доставка работает из любого процесса (web, worker)". AC: "Given group_send из
    Celery worker, Then подключённый consumer получает сообщение;
    InMemoryChannelLayer в конфиге = fail CI; ORM в consumers только через
    database_sync_to_async.")
  - _bmad-output/planning-artifacts/architecture.md (L337 "ASGI-монопроцесс:
    uvicorn (--lifespan off) за nginx, HTTP + WS; Celery worker + beat — отдельные
    контейнеры. Compose: nginx, app, worker, beat, postgres, redis. **channels_redis
    обязателен; InMemoryChannelLayer = fail в CI** (group_send из worker'а через
    InMemory уходит в никуда молча)." L64/L121/L327: WS — подтверждённое решение
    заказчика (MVP), Channels/ASGI фиксируются на шаге технологий, event/outbox-слой
    делает транспорт заменяемым адаптером; L540 apps/notifications — "in-app центр,
    WS consumers (channels_redis)"; L600 WS `/ws/notifications/`; L650 Decision
    Compatibility — WebSocket × deadline-домен разрешён (event-слой, kill-switch,
    дочитка); L660 NFR real-time → channels_redis + дочитка + kill-switch.
    ВАЖНО: Prod-compose (nginx/worker/beat/redis-контейнеры, nginx Upgrade-заголовки
    + proxy_read_timeout 3600s) — это Epic 12 (Story 12.1), НЕ в скоупе 11.1. 11.1
    ограничена dev/test-окружением: сам ASGI-app + channel_layer + минимальный
    consumer.
  - _bmad-output/implementation-artifacts/epic-10-retro-2026-07-17.md (§6 "Значимые
    открытия для Epic 11" — оба пункта НЕ блокер старта эпика: (1) polling
    traffic-tree defer живёт, пока WS-миграция не покроет day-state/traffic-tree —
    11.1 инфраструктурная, покрытие day-state НЕ входит в её скоуп, вопрос остаётся
    открытым для 11.2/11.4; (2) kill-switch (11.5) должен явно гарантировать
    fallback-polling не хуже pre-WS baseline — вне скоупа 11.1. §8 AI-1 (хойст дат)
    выполнен коммитом 814a80d ДО этой стори. §8 AI-2 (POLICY-развилки «отстающие»/
    422-на-пустой-горизонт) — см. секцию "AI-2 применимость" ниже. §8 AI-4
    (epic-10→done в sprint-status.yaml) выполнено.)
  - Backend/VAPS/config/settings.py (текущий стек: Django 5.1.15, DRF, WSGI_APPLICATION
    уже `= None` — задел под ASGI-переход; INSTALLED_APPS без Channels; DATABASES
    переключается на Postgres через VAPS_DB=postgres env; AUTH_USER_MODEL=core.User)
  - Backend/VAPS/config/urls.py (HTTP-роуты плоские: /api/core/, /api/operations/,
    /api/audit/, /api/notifications/, /api/documents/ — WS-роут ЖИВЁТ ОТДЕЛЬНО в
    asgi.py routing, не в urls.py)
  - Backend/VAPS/apps/notifications/models.py (Notification.recipient — плоский
    CharField, "внешний actor id, та же строка, что User.username/
    UserEmployeeBinding.user_id/UserRole.user_id" — ARCH-007. Это и есть "user_id"
    из AC стори: группа consumer'а именуется по recipient/username, НЕ по
    Employee UUID)
  - Backend/VAPS/apps/notifications/services.py (notify() — Story 5.7a,
    write-primitive, синхронный внутри транзакции вызывающего; docstring прямо
    говорит "WS delivery is E11" — 11.1 закладывает транспорт, но САМА публикация
    group_send из notify() — Story 11.2, вне скоупа 11.1)
  - Backend/VAPS/apps/core/auth/authentication.py (JWTAuthentication/
    XUserIdAuthentication — HTTP-only DRF authentication classes; Channels НЕ видит
    DRF authentication chain — ASGI middleware/consumer должен извлекать identity
    самостоятельно из query-string токена или заголовка при handshake, это ОТДЕЛЬНЫЙ
    механизм от REST-auth)
  - Backend/VAPS/apps/core/middleware.py (RequestContextMiddleware — чисто
    WSGI/ASGI-HTTP __call__(request) синхронный middleware; НЕ применяется к
    Channels ProtocolTypeRouter/WS-стеку автоматически — request_id-контекст в
    consumer'е не течёт бесплатно, вне скоупа 11.1 явно чинить, но НЕ ломать
    существующий HTTP-путь)
  - Backend/VAPS/docker-compose.yml (сейчас ТОЛЬКО db: postgres:16 на :5433; НЕТ
    redis, НЕТ worker/beat/app-контейнеров — 11.1 добавляет redis-сервис для
    dev/test channel_layer)
  - Backend/VAPS/pyproject.toml (dependencies: Django, DRF, psycopg[binary],
    openpyxl, PyJWT[crypto], drf-spectacular, python-docx, fpdf2 — НЕТ channels/
    channels-redis нигде; каждая новая зависимость в истории пришла с обоснованием
    в inline-комментарии — 11.1 добавляет тем же паттерном)
  - Backend/VAPS/Makefile (gate target: docker compose up -d --wait db (порт
    задаётся VAPS_DB_PORT env, дефолт 5433 в самом target) && ruff check .
    && pytest -m "not property and not concurrency and not slow and not golden"
    && makemigrations --check --dry-run; ГЕЙТ ЗАПУСКАЕТСЯ ИЗ Backend/VAPS, не из
    корня worktree)
  - Окружение на момент create-story: :5433 занят чужим контейнером
    (masterqalakz-db_test-1), :5434 = vaps-test-5434 (изолированный postgres:16,
    креды vaps/vaps/vaps) уже поднят и живой — dev-агент гоняет гейт-эквивалент
    вручную на VAPS_DB_PORT=5434 и явно отмечает это в стори (паттерн из E10).
  - Внешние версии (веб-индекс, сверено на create-story): channels 4.3.2
    (последний стабильный, Django 5.x совместим), channels-redis 4.3.0 — оба
    актуальны на 2026-07-17.
---

# Story 11.1: Channels и channels_redis

Status: done

## Story

As a **система**,
I want **ASGI-роутинг `/ws/notifications/` + consumer с группой по user_id (`recipient`/`username`) на `channels_redis`**,
so that **доставка WS-уведомлений работает из любого процесса (web-процесс, будущий Celery worker), а не только в рамках одного in-memory процесса**.

## Scope

Узкая инфраструктурная стори (Database/Backend Decomposition, корневой CLAUDE.md): только сама интеграция `channels` + `channels-redis` в проект.

Входит:
1. Зависимости `channels>=4.3,<5` и `channels-redis>=4.3,<5` в `pyproject.toml` (с обоснованием в inline-комментарии — паттерн проекта).
2. `Backend/VAPS/config/asgi.py` — `ProtocolTypeRouter` с `http` (стандартный Django ASGI handler) и `websocket` (`AuthMiddlewareStack`/собственный auth-стек → `URLRouter` → consumer).
3. `Backend/VAPS/config/routing.py` (или `apps/notifications/routing.py` — решить по месту, см. Dev Notes) — WS `URLRouter` с одним маршрутом `ws/notifications/`.
4. Минимальный `NotificationConsumer` (`apps/notifications/consumers.py`, `AsyncJsonWebsocketConsumer` или `AsyncWebsocketConsumer`): на `connect()` вступает в группу, именованную по идентичности вызывающего (`recipient`/`username` — та же строка, что `Notification.recipient`), принимает входящие `group_send`-сообщения и отдаёт их клиенту как JSON. Никакой бизнес-логики публикации уведомлений (это 11.2) — только smoke-путь «сервер может отправить сообщение в группу, и подключённый клиент его получит».
5. `CHANNEL_LAYERS` в `settings.py`: `channels_redis.core.RedisChannelLayer` для `VAPS_DB=postgres`/prod-подобных окружений (redis host/port из env, паттерн `VAPS_DB_HOST`/`VAPS_DB_PORT`); явный `InMemoryChannelLayer` НЕ допускается как дефолт вне unit-тестов (AC epics: "InMemoryChannelLayer в конфиге = fail CI").
6. `ASGI_APPLICATION = "config.asgi.application"` в settings.py.
7. Redis-сервис в `Backend/VAPS/docker-compose.yml` для dev/test channel_layer (см. Dev Notes — решение "переиспользовать/новый").
8. ORM-доступ внутри consumer (если появится, например для будущей idempotent-регистрации подключения) — **только** через `channels.db.database_sync_to_async`; в 11.1, скорее всего, ORM-доступа в consumer'е ещё нет вовсе (smoke-consumer не читает БД), но паттерн задокументировать для 11.2+.
9. Тест(ы): `channels.testing.WebsocketCommunicator` — подключение к `/ws/notifications/`, `group_send` из отдельного контекста (симулирующего Celery worker — то есть НЕ того же asyncio-event-loop, что и коннект, через `channel_layer.group_send` вызванный напрямую) доходит до подключённого consumer.

Не входит (Out of Scope):
- Публикация реальных бизнес-уведомлений из `notifications.services.notify()` через `group_send`/`transaction.on_commit` — это **Story 11.2**.
- WS-клиент на фронте (reconnect, backoff, дочитка `?since=`) — **Story 11.3**.
- UI центра уведомлений (колокольчик, список, отметка прочтения) — **Story 11.4**.
- Kill-switch — **Story 11.5**.
- E2E-сценарий целиком — **Story 11.6**.
- Прод-compose (nginx Upgrade-заголовки, `proxy_read_timeout 3600s` + ping/pong, `uvicorn --lifespan off`, отдельные контейнеры worker/beat) — **Epic 12, Story 12.1**. 11.1 не трогает деплой-топологию, только dev/test ASGI-приложение и channel_layer.
- Traffic-tree/day-state polling → WS-миграция (ретро E10 §6 п.1) — НЕ входит; 11.1 не публикует и не подписывает никакой traffic-tree/readiness-семантики, только транспортный smoke-путь на generic-группе. Открытый вопрос "войдёт ли traffic-tree polling в объём WS-миграции этого эпика" остаётся нерешённым и должен быть явно закрыт при create-story 11.2/11.4 (см. AI-2 применимость ниже).
- `RequestContextMiddleware`-эквивалент (request_id) для WS-пути — не чинится в 11.1; существующий HTTP-путь не должен сломаться.

## AI-2 применимость (ретро Epic 10, action item обязателен к сверке перед create-story E11)

Ретро E10 AI-2 требует: **обе POLICY-развилки** («отстающие» vs late — `laggardsOnly`-семантика readiness-tree; 422 на `horizon=None`) **требуют явного решения Bratan ДО создания стори Epic 11, которая ТРОГАЕТ traffic-tree или readiness-семантику**.

**Вывод: AI-2 НЕ применим к Story 11.1.** Обоснование:
- 11.1 — чисто транспортная инфраструктура (`channels`/`channels-redis`/ASGI-роутинг/generic-consumer). Она не читает, не публикует и не агрегирует ничего из `readiness-tree`/`traffic_tree`/`tomorrow_block.py`/day-state.
- Consumer группируется по `recipient`/`username` (произвольный actor-id string, тот же, что уже существует в `Notification.recipient` с 5.7a) — не по division/статусу/светофору.
- Единственная точка соприкосновения с readiness-семантикой — сама модель `Notification.Kind.SUBMISSION_LAGGING` (уже существует с 5.7a, ДО этой стори и ДО ретро E10), но 11.1 её не трогает: `Kind`-словарь и его источники правды не меняются в этой стори.

**Предупреждение для будущих E11-стори:** Story 11.2 («Публикация в WS из notify()») публикует существующие `Notification`-записи, включая `SUBMISSION_LAGGING` — она пограничная, но публикует уже-существующий факт из БД, не решает заново семантику «отстающих». Story 11.4 (Центр уведомлений UI) и в особенности любая стори, которая переводит `readiness-tree`/`traffic_tree` polling на WS push (ретро E10 §6 п.1, "не обязательно чинить memo отдельно, если WS его вытесняет") — вот где AI-2 становится блокером и требует явного решения Bratan ДО create-story. **Зафиксировать это явно в спеке 11.2 и 11.4 при их создании.**

## AI-5 применимость (абсолютный query-пин)

Ретро E10 AI-5 рекомендует пинить точное число запросов/DOM-узлов константой там, где стори вводит счётные тесты.

**Оценка: AI-5 малоприменим к 11.1.** Инфраструктурная стори без грид/дерева/списочных эндпоинтов — нет N+1-подобной поверхности для абсолютного query-пина. Единственный потенциальный кандидат — сам факт `WebsocketCommunicator`-теста подключения (можно было бы пиновать число сообщений/групп), но это уже покрывается прямым функциональным ассертом ("клиент получил ровно одно сообщение с ожидаемым payload"), а не query-count. Если 11.2 введёт `group_send` внутри `notify()` с потенциальным N-вызовов-на-N-получателей, AI-5-рекомендацию стоит применить ТАМ (абсолютный пин числа `group_send`-вызовов), не здесь.

## Redis-решение

**Docker-compose сейчас содержит ТОЛЬКО `db` (postgres:16, `:5433`). Redis отсутствует полностью — ни для Celery (Celery тоже отсутствует в проекте — grep по `celery`/`Celery` в `config/` и `pyproject.toml` не нашёл ни одного упоминания), ни для чего-либо ещё.**

Решение: **11.1 добавляет НОВЫЙ `redis`-сервис** в `Backend/VAPS/docker-compose.yml` (образ `redis:7-alpine` или аналогичный лёгкий официальный тег — dev-агент выбирает точный тег на этапе реализации, зафиксировать в Dev Agent Record). Не «переиспользование», потому что переиспользовать нечего — это первый Redis в проекте. Будущая Story 12.1 (прод-compose) добавит `redis` в прод-топологию как отдельный контейнер по тому же принципу — 11.1 не предвосхищает и не блокирует это решение, просто вводит dev/test-эквивалент.

Порт: **не использовать `6379` бездумно, если на машине уже есть чужой Redis** — проверить `docker ps`/`ss -ltnp` на этапе dev-story аналогично прецеденту с Postgres `:5433`/`:5434`; при конфликте — нестандартный порт с явной пометкой в docker-compose.yml и `.env`/README.

**Тестовый channel layer:** Channels предоставляет `channels.layers.InMemoryChannelLayer` именно для unit-тестов (`channels.testing.WebsocketCommunicator` умеет работать с ним без реального Redis) — **но AC эпика прямо требует "InMemoryChannelLayer в конфиге = fail CI"**. Разрешение этого кажущегося противоречия: `InMemoryChannelLayer` не должен быть значением `CHANNEL_LAYERS` **в `settings.py` по умолчанию/в `VAPS_DB=postgres` (гейтовом) окружении** — там должен стоять `RedisChannelLayer`, и гейт обязан гонять `channels_redis` против реального Redis (`docker compose up -d --wait redis` рядом с `db`), иначе тест «сообщение доходит из другого процесса» (worker-симуляция) не докажет ничего про реальный `channels_redis`-транспорт. Тесты **могут** локально override'ить `CHANNEL_LAYERS` на `InMemoryChannelLayer` через `@override_settings` для узких unit-тестов routing/consumer-логики, которые не проверяют межпроцессную доставку — но флагманский AC-тест («group_send из отдельного контекста доходит до consumer») обязан идти через настоящий `channels_redis` + реальный Redis в docker-compose, иначе сам смысл AC («работает из любого процесса») не проверен.

## Acceptance Criteria

1. **WS-эндпоинт поднимается и consumer вступает в группу по идентичности.** Given ASGI-приложение запущено (dev-сервер `daphne`/`uvicorn` или `channels.testing.WebsocketCommunicator` в тесте) с настроенным `channels_redis`, When клиент подключается к `ws://.../ws/notifications/` с идентификацией (query-string токен или заголовок — механизм извлечения задокументировать явно, HTTP-auth chain сюда не течёт автоматически), Then соединение принимается (`connect()` возвращает accept) и consumer добавлен в group, именованную по `recipient`/`username` вызывающего.

2. **`group_send` из независимого контекста доходит до подключённого consumer через `channels_redis`.** Given реальный Redis (docker-compose `redis`-сервис) и настроенный `RedisChannelLayer`, When тест вызывает `channel_layer.group_send(group_name, message)` из кода, не разделяющего asyncio event loop с `WebsocketCommunicator`-подключением (симуляция "из Celery worker" — например через `async_to_sync` в отдельном потоке/процессе, или явно новый `get_channel_layer()`-инстанс), Then подключённый communicator получает сообщение (`receive_json_from`/`receive_from`) с ожидаемым payload.

3. **`InMemoryChannelLayer` в гейтовом конфиге = красный CI.** Given `settings.py` при `VAPS_DB=postgres` (или эквивалентном gate-окружении), Then `CHANNEL_LAYERS["default"]["BACKEND"]` НЕ равен `"channels.layers.InMemoryChannelLayer"` — покрыто прямым тестом, читающим `settings.CHANNEL_LAYERS` (или `django.conf.settings` после загрузки с gate-переменными окружения), который падает, если бэкенд когда-либо регрессирует на in-memory.

4. **ORM в consumer'е только через `database_sync_to_async`.** Given consumer(ы) в `apps/notifications/consumers.py` (если 11.1 вообще обращается к ORM — минимальный smoke-consumer может не обращаться вовсе), Then любой синхронный Django ORM вызов обёрнут `channels.db.database_sync_to_async` — либо прямой grep-гвард/код-ревью пункт, либо (если ORM не используется в 11.1) явная пометка в Dev Notes "не применимо — consumer 11.1 не трогает ORM" с обоснованием, что паттерн задокументирован для 11.2+.

5. **Гейт зелёный, HTTP-путь не сломан.** Given `make gate` (из `Backend/VAPS`, с добавленным `redis`-сервисом в docker-compose), Then все существующие HTTP-эндпоинты и тесты проходят без регресса (ASGI-переход не меняет поведение существующих `apps.core`/`apps.operations`/`apps.notifications` HTTP view'ов); `ruff check .` чист; `makemigrations --check --dry-run` без дрейфа (11.1 не должна вводить миграций — Channels не имеет собственных моделей по умолчанию, если только явно не подключён `channels.models` для persistent history, что НЕ требуется этой стори).

## Tasks / Subtasks

- [x] Task 1: Зависимости и ASGI-скелет (AC: 1)
  - [x] Добавить `channels>=4.3,<5` и `channels-redis>=4.3,<5` в `pyproject.toml` `[project.dependencies]` с inline-обоснованием (паттерн проекта — см. существующие комментарии у PyJWT/python-docx/fpdf2), сослаться на architecture.md L337 и epics.md §Epic 11 как источник требования.
  - [x] `pip install -e '.[dev]'` в `.venv`, зафиксировать точные resolved-версии в Dev Agent Record.
  - [x] `Backend/VAPS/config/asgi.py`: `ProtocolTypeRouter({"http": get_asgi_application(), "websocket": <auth-стек> → URLRouter(...)})`.
  - [x] `ASGI_APPLICATION = "config.asgi.application"` в `settings.py`.
- [x] Task 2: `CHANNEL_LAYERS` конфигурация (AC: 3)
  - [x] `settings.py`: `CHANNEL_LAYERS` с `channels_redis.core.RedisChannelLayer`, host/port из `VAPS_REDIS_HOST`/`VAPS_REDIS_PORT` env (паттерн `VAPS_DB_HOST`/`VAPS_DB_PORT`), дефолты для dev.
  - [x] Тест, читающий итоговый `settings.CHANNEL_LAYERS["default"]["BACKEND"]` под gate-окружением ≠ `InMemoryChannelLayer`.
- [x] Task 3: Redis в docker-compose (AC: 2, 5)
  - [x] Добавить `redis`-сервис в `Backend/VAPS/docker-compose.yml` (healthcheck по образцу `db`), проверить отсутствие конфликта портов (`docker ps`/`ss` перед фиксацией порта).
  - [x] Обновить `Makefile` `gate` target: `docker compose up -d --wait db redis` (или отдельная цель) — гейт поднимает оба сервиса.
- [x] Task 4: Auth-извлечение identity для WS handshake (AC: 1)
  - [x] Решить и задокументировать механизм: query-string токен (`?token=` или `?user_id=` для dev-паритета с `X-User-Id`) vs custom ASGI middleware, читающий заголовок при handshake. Учесть, что браузерный `WebSocket` API НЕ может ставить произвольные заголовки (Authorization) — если прод-путь предполагает JWT, механизм обязан работать через query-string или sub-protocol, задокументировать выбор явно (влияет на Story 11.3 WS-клиент).
  - [x] Custom ASGI middleware или `channels.auth.AuthMiddlewareStack`-эквивалент, кладущий `scope["actor_id"]` (зеркало `request.actor_id` из HTTP-пути) — БЕЗ полного дублирования JWT-верификации, если возможно переиспользовать логику `apps/core/auth/authentication.py` в ASGI-контексте (оценить на этапе реализации; если переиспользование нетривиально, минимальный dev-эквивалент допустим с явной пометкой TODO/defer на прод-hardening в 12.1).
- [x] Task 5: `NotificationConsumer` — минимальный smoke-consumer (AC: 1, 2, 4)
  - [x] `apps/notifications/consumers.py`: `connect()` → `group_add` в группу `f"user_{actor_id}"` (или аналогичное именование — задокументировать конвенцию, она понадобится 11.2 для `group_send`), `accept()`.
  - [x] Обработчик входящих group-сообщений → отправка клиенту как JSON.
  - [x] `disconnect()` → `group_discard`.
  - [x] Если ORM-доступ появляется — обернуть `database_sync_to_async`; иначе явно пометить в коде/Dev Notes отсутствие ORM-обращений.
- [x] Task 6: WS routing (AC: 1)
  - [x] `apps/notifications/routing.py` (или `config/routing.py` — решить по аналогии с `urls.py`-паттерном проекта, где app-роуты инклюдятся из `config`) с одним маршрутом `ws/notifications/` → `NotificationConsumer`.
- [x] Task 7: Тесты (AC: 1, 2, 3, 4)
  - [x] `apps/notifications/tests/test_ws_consumer.py`: `WebsocketCommunicator` — connect → accept; `group_send` из независимого контекста (реальный Redis, НЕ тот же event loop) доходит до communicator; disconnect корректен.
  - [x] Тест `CHANNEL_LAYERS`-бэкенда (AC 3).
  - [x] Пометить async-тесты `pytest.mark.django_db` + `pytest-asyncio`/`channels.testing` конвенцией проекта (проверить, есть ли уже `pytest-asyncio` в `dev`-зависимостях — если нет, добавить с тем же обоснованием-паттерном, что и остальные dev-deps).
- [x] Task 8: Гейт и регресс (AC: 5)
  - [x] `make gate` зелёный на `VAPS_DB_PORT=5434` (см. Dev Notes — `:5433` занят чужим контейнером) + `redis`-сервис поднят.
  - [x] `ruff check .` по изменённым файлам.
  - [x] `makemigrations --check --dry-run` — подтвердить отсутствие дрейфа (Channels не должен требовать миграций для этой стори).
  - [x] Существующий HTTP-тест-сьют без регресса (ASGI-обёртка не меняет WSGI-эквивалентное поведение `get_asgi_application()` для HTTP-пути).

## Dev Notes

- **Нет прецедента ASGI/Channels в проекте** — 11.1 первая. Читать `channels`/`channels-redis` официальную документацию (4.3.x) на этапе реализации для актуального API `AsyncJsonWebsocketConsumer`, `ProtocolTypeRouter`, `URLRouter`, `channels.testing.WebsocketCommunicator`, `channels.db.database_sync_to_async` — не полагаться на память о более старых версиях (2.x/3.x API отличается: `channel_layer.group_send` сигнатура стабильна, но `routing.py`-конвенции и `AuthMiddlewareStack` детали могли измениться).
- **`WSGI_APPLICATION = None` уже стоит в settings.py** — это существующий задел (не факт, что осознанный под Channels, но он не мешает и не требует правки; `ASGI_APPLICATION` добавляется рядом).
- **Группа именуется по `recipient`/`username`, НЕ по `Employee.id`.** `Notification.recipient` (5.7a) и `User.username` (ARCH-007, "external auth account id") — одна и та же строка. Consumer должен группировать по этому идентификатору, чтобы 11.2 могла напрямую переиспользовать `notify()`'s `recipient` для `group_send(f"user_{recipient}", ...)` без дополнительного маппинга.
- **RequestContextMiddleware (request_id) НЕ покрывает WS-путь.** Это существующий HTTP-only middleware (`__call__(request)`, синхронный WSGI/ASGI-HTTP). WS-консьюмер не получит `request_id`-контекст бесплатно. Явно не в скоупе 11.1 чинить, но убедиться, что существующий HTTP-путь (включая admin, DRF-эндпоинты) продолжает получать `X-Request-Id` без изменений — `ProtocolTypeRouter`, оборачивающий `get_asgi_application()` в `"http"`-ключ, не должен обходить существующий Django middleware stack.
- **Auth-извлечение для WS — отдельный от HTTP механизм.** `apps/core/auth/authentication.py` (`JWTAuthentication`/`XUserIdAuthentication`) — DRF `BaseAuthentication` классы, вызываемые DRF view-диспетчером; Channels consumer их не увидит автоматически. Handshake-time идентификация — либо query-string, либо custom ASGI middleware. Решение здесь формирует контракт для Story 11.3 (WS-клиент) — задокументировать выбор чётко в Completion Notes, чтобы 11.3 не гадала.
- **Redis — первый в проекте**, не «ещё один инстанс существующего Celery Redis» (Celery тоже отсутствует). Прод-топология (Story 12.1) заведёт свой `redis`-контейнер по архитектурному документу (compose: nginx, app, worker, beat, postgres, redis) — 11.1 её не предвосхищает, только dev/test.
- **Гейт-окружение:** `:5433` занят `masterqalakz-db_test-1` на момент create-story; `vaps-test-5434` (изолированный `postgres:16`, креды `vaps/vaps/vaps`) уже поднят. Dev-агент гоняет гейт-эквивалент на `VAPS_DB_PORT=5434`, добавляя `redis`-сервис рядом (новый порт, не конфликтующий — проверить `docker ps` на этапе реализации, т.к. состояние окружения могло измениться между create-story и dev-story) и явно отмечает это в Dev Agent Record (паттерн из E10, зафиксирован в CLAUDE.md).
- **Ruff `E,F` только** — `ruff format` только по изменённым файлам, никогда по папке (проектное правило).
- **Никаких миграций не ожидается** — Channels по умолчанию не требует моделей БД для этой стори (persistent history/`channels.models` — не запрошено epics/architecture). Если реализация неожиданно вводит миграцию — явно обосновать в Completion Notes, иначе это красный флаг drift от AC 5.

### Project Structure Notes

- `apps/notifications/` — уже существующий app (models.py, services.py, selectors.py, api/, tests/) — Consumer и routing естественно ложатся туда же (`consumers.py`, `routing.py`), а не в новый app. Architecture.md L540 явно называет `apps/notifications/` домом для "WS consumers (channels_redis)".
- `config/asgi.py` — новый файл рядом с существующими `config/settings.py`, `config/urls.py`, `config/__init__.py`.
- Возможна развилка: WS `URLRouter` определяется в `config/routing.py` (аналог `config/urls.py`, агрегирующий app-роуты) или напрямую в `apps/notifications/routing.py`, инклюдится в `config/asgi.py`. Для одного WS-эндпоинта в MVP оба варианта разумны — решить по аналогии с существующим `urls.py`-паттерном (плоский корневой файл, app-специфичные `api/urls.py` инклюдятся) → предпочтительно `config/asgi.py` инклюдит `apps.notifications.routing.websocket_urlpatterns`, зеркалируя `config/urls.py`'s `include("apps.notifications.api.urls")`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 11.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#L337 Infrastructure & Deployment]
- [Source: _bmad-output/planning-artifacts/architecture.md#L540, L600, L650, L660]
- [Source: _bmad-output/implementation-artifacts/epic-10-retro-2026-07-17.md#6, #8 AI-2]
- [Source: Backend/VAPS/apps/notifications/models.py — Notification.recipient]
- [Source: Backend/VAPS/apps/notifications/services.py — notify() docstring "WS delivery is E11"]
- [Source: Backend/VAPS/apps/core/models.py#User — username = ARCH-007 external auth account id]
- [Source: Backend/VAPS/apps/core/auth/authentication.py — HTTP-only DRF auth chain]
- [Source: Backend/VAPS/config/settings.py — WSGI_APPLICATION = None, VAPS_DB env pattern]
- [Source: Backend/VAPS/docker-compose.yml — только db-сервис, нет redis]
- [Source: Backend/VAPS/Makefile#gate — VAPS_DB_PORT дефолт 5433, docker compose up -d --wait db]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), субагент dev-story шага BMAD-цикла.

### Debug Log References

**Resolved dependency versions** (installed into `.venv` via `pip install -e '.[dev]'`, web-index snapshot 2026-07-17):
- `channels` 4.3.2, `channels-redis` 4.3.0 (as pinned in spec).
- `redis` (Python client, transitive via channels-redis) 8.0.1, `msgpack` 1.2.1.
- `pytest-asyncio` 1.4.0 (new dev-dep — `asyncio_mode = "auto"` in `pyproject.toml` `[tool.pytest.ini_options]`, so `async def test_*` run without a per-test marker).
- `daphne` 4.2.2 + its transitive deps (`twisted`, `autobahn`, `txaio`, etc.) — see "Отклонение: daphne" below.

**RED-phase (confirmed real red before implementation):**
1. `apps/notifications/tests/test_ws_consumer.py` written first (all 5 tests), executed against the pre-implementation tree (no `config/asgi.py`, no `CHANNEL_LAYERS` in settings):
   - First run failed at collection: `ModuleNotFoundError: No module named 'daphne'` — `channels.testing.__init__` unconditionally imports `ChannelsLiveServerTestCase`, which imports `daphne.testing`, even though only `WebsocketCommunicator` was needed. Added `daphne` to `dev` extras (see Отклонение below) to get past this to the *intended* red.
   - Second run (after `daphne` installed, before `config/asgi.py` existed): `ModuleNotFoundError: No module named 'config.asgi'` — the correct RED for AC 1/2/4 (nothing to import).
   - Independently confirmed AC 3's red: `python -c "... print(getattr(settings, 'CHANNEL_LAYERS', 'MISSING'))"` → `MISSING` before `CHANNEL_LAYERS` was added to `settings.py`.
2. GREEN: after implementing `config/asgi.py`, `apps/notifications/{consumers,routing,ws_auth}.py`, and the `settings.py` additions, all 5 tests in `test_ws_consumer.py` passed (`5 passed in 1.51s`) against a real `redis:7-alpine` container (`docker compose up -d --wait redis`, port 6379 — confirmed free via `ss -tlnp`/`docker ps` before use, no conflict).
3. One regression surfaced by the existing architecture guard `apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth` (ARCH-SEC-030: the dev identity-header stand-in name must appear only in `apps/core/auth/`, as an AST string-constant scan): the first draft of `apps/notifications/ws_auth.py`'s docstring literally named that header/class outside `core/auth`. Fixed by rewording the docstring to describe the boundary without repeating the literal string; guard test re-run green. This is exactly the kind of pre-existing arch-guard the CLAUDE.md instructs checking for at spec time — confirmed it still holds post-implementation.

**Redis for gate/tests:** first Redis in the project (no prior instance to conflict with `6379` — `ss -tlnp`/`docker ps` checked before fixing the port, mirroring the `:5433`/`:5434` Postgres precedent). New `redis` service added to `Backend/VAPS/docker-compose.yml` (`redis:7-alpine`, healthcheck via `redis-cli ping`, port overridable via `VAPS_REDIS_PORT` env, default `6379`). `Makefile`'s `gate` and `test-full` targets updated to `docker compose up -d --wait db redis`. Gate-equivalent run manually with `VAPS_DB_PORT=5434` (see below — `:5433` occupied by an unrelated container, `masterqalakz-db_test-1`, matching the story's documented environment state) and `redis` up on its default port.

**Final gate-equivalent (manual, `VAPS_DB_PORT=5434`, `redis` up on 6379):**
```
.venv/bin/ruff check .                                              → All checks passed!
.venv/bin/pytest -m "not property and not concurrency and not slow and not golden"
                                                                     → 2395 passed, 56 deselected in ~51-53s
.venv/bin/python manage.py makemigrations --check --dry-run         → No changes detected
```
No regressions in the existing HTTP test suite (`apps.core`/`apps.operations`/`apps.notifications` HTTP views unaffected by the ASGI wrap — `config/asgi.py`'s `"http"` key is `django.core.asgi.get_asgi_application()` unchanged, full existing `MIDDLEWARE` stack intact).

### Completion Notes List

- **Scope delivered exactly as spec'd**: `channels`/`channels-redis` deps, `config/asgi.py` (`ProtocolTypeRouter` http+websocket), `apps/notifications/consumers.py` (`NotificationConsumer`, smoke-only — no business notification logic, that's 11.2), `apps/notifications/routing.py` (`websocket_urlpatterns`, single route `ws/notifications/`), `CHANNEL_LAYERS` in `settings.py` (`channels_redis.core.RedisChannelLayer`, always the settings default — never `InMemoryChannelLayer`), `ASGI_APPLICATION` setting, new `redis` service in `docker-compose.yml`. No Out-of-Scope item touched (no `notify()`→`group_send` wiring, no frontend WS client, no prod nginx topology).
- **WS handshake identity mechanism (AC 1, Task 4) — decided and documented**: query-string `?token=<actor_id>` (new `apps/notifications/ws_auth.py::AuthenticatedWSMiddleware`), NOT a header, because the browser `WebSocket` constructor cannot set arbitrary headers (no `Authorization`) on the handshake request. This is a **dev-equivalent, not full JWT verification** — `token` is the bare actor-id string (same as the dev HTTP header stand-in's value, mirroring `recipient`/`username`, ARCH-007), with an explicit `TODO` in the module docstring deferring real JWT verification over query-string to Epic 12/Story 12.1 prod-hardening. **This is the WS-client contract Story 11.3 must follow**: `ws://.../ws/notifications/?token=<actor_id>`.
- **Group naming convention (AC 1, feeds 11.2)**: `f"user_{actor_id}"`, where `actor_id` is `Notification.recipient`/`User.username` (ARCH-007) — documented in `consumers.py` so Story 11.2 can call `channel_layer.group_send(f"user_{recipient}", ...)` directly from `notify()` with zero additional mapping. Missing/blank `actor_id` from the handshake → `connect()` closes with code 4401 (custom app-close code, not an accepted-then-silently-broken connection).
- **AC 4 (ORM via `database_sync_to_async`)**: not applicable in 11.1 — `NotificationConsumer` performs no ORM access at all (group membership is keyed purely off the handshake `actor_id` string, no `User`/`Notification` row lookup). This is documented explicitly in the consumer's module docstring, including the requirement that any future ORM access (11.2+) must be wrapped in `channels.db.database_sync_to_async`.
- **Message dispatch convention**: consumer defines `notify_message(self, event)` — Channels' documented `group_send({"type": "notify.message", ...})` → `notify_message` dispatch (dots replaced by underscores). The test suite's `group_send` payload/handler shape is the de-facto transport contract for 11.2's `notify()` → `group_send` wiring.
- **`RequestContextMiddleware`/request_id**: confirmed NOT applied to the WS path (it's HTTP-only, `__call__(request)` sync middleware) — left unfixed per explicit Out-of-Scope; confirmed via gate run that the existing HTTP path (including admin, DRF endpoints) is unaffected, since `config/asgi.py`'s `"http"` key wraps `get_asgi_application()` untouched (same full `MIDDLEWARE` stack).
- **No migrations introduced** — confirmed via `makemigrations --check --dry-run` → "No changes detected". Channels itself defines no models used by this story (no `channels.models` persistent history, not requested).
- **Отклонение (не выбор, вынужденное): `daphne` добавлен в `dev` extras.** Не заявлен явно в спеке стори, но НЕ является отдельной инициативой — `channels.testing.__init__` (4.3.2) безусловно импортирует `ChannelsLiveServerTestCase`, которая импортирует `daphne.testing`, даже если тест использует только `WebsocketCommunicator` (напрямую импортировать `channels.testing.websocket`, минуя `__init__.py`, не получилось — тот же `ModuleNotFoundError`, `__init__.py` выполняется в любом случае). Задокументировано инлайн-комментарием в `pyproject.toml` рядом с записью зависимости. `daphne` — тест-only (`dev` extras), НЕ используется как ASGI-сервер в runtime-конфигурации этой стори (uvicorn/прод-топология — Epic 12/Story 12.1, вне скоупа 11.1).
- **Найденная и исправленная регрессия architecture-guard-теста**: `apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth` (ARCH-SEC-030) изначально краснел из-за докстринга `ws_auth.py`, буквально называвшего HTTP dev-заголовок вне `apps/core/auth/`. Переформулировано без потери информации (гвард — AST-скан строковых констант, не импортов) — тест снова зелёный, ARCH-SEC-030 не нарушен (WS-путь физически не читает тот заголовок вовсе, только упоминал его имя в докстринге).

### File List

**Created:**
- `Backend/VAPS/config/asgi.py`
- `Backend/VAPS/apps/notifications/consumers.py`
- `Backend/VAPS/apps/notifications/routing.py`
- `Backend/VAPS/apps/notifications/ws_auth.py`
- `Backend/VAPS/apps/notifications/tests/test_ws_consumer.py`

**Modified:**
- `Backend/VAPS/pyproject.toml` (deps: `channels`, `channels-redis`, `pytest-asyncio`, `daphne`; `asyncio_mode = "auto"` in pytest config)
- `Backend/VAPS/config/settings.py` (`ASGI_APPLICATION`, `CHANNEL_LAYERS`)
- `Backend/VAPS/docker-compose.yml` (new `redis` service)
- `Backend/VAPS/Makefile` (`gate`/`test-full` targets now bring up `redis` alongside `db`)

## Review Findings

**Проход 1** (bmad-code-review, uncommitted diff по File List 11.1; 3 адверсариальных слоя — Blind Hunter, Edge Case Hunter, Acceptance Auditor; same-model, санкционировано — 11.1 не входит в ultra-список E11).

**Чекбоксы Tasks 1-8**: все сверены с фактическим кодом построчно (deps в `pyproject.toml`, `ASGI_APPLICATION`/`CHANNEL_LAYERS` в `settings.py`, `redis`-сервис в `docker-compose.yml` + `Makefile` gate/test-full targets, `AuthenticatedWSMiddleware` в `ws_auth.py`, `group_add`/`accept`/`group_discard` в `consumers.py`, `websocket_urlpatterns` в `routing.py`, 5 тестов в `test_ws_consumer.py`, `pytest-asyncio`+`asyncio_mode=auto`) — дрейфа не обнаружено, все [x] подтверждены.

**AC 1-5 — построчная проверка против реального поведения:**
- AC-1 (connect + group-join по идентичности): подтверждено тестом + ручной проверкой close-код 4401 при отсутствующем `?token=` (`WebsocketCommunicator` без query-string → `connected=False, close_code=4401`, соответствует докстрингу).
- AC-2 (`group_send` из независимого контекста через реальный `channels_redis`): **красная проба** — временно сломан naming-convention (`user_` → `userX_`) в `consumers.py` → тест `test_group_send_from_independent_context_reaches_connected_consumer` упал по РЕАЛЬНОМУ `redis.exceptions.TimeoutError` (не мок, не заглушка — таймаут ожидания сообщения на настоящем Redis), откат через `cp` восстановил зелёный. Доказывает: тест реально проверяет межпроцессную доставку через `channels_redis`, а не молчаливую in-memory подмену.
- AC-3 (`InMemoryChannelLayer` в gate-конфиге = красный CI): **красная проба** — временно заменён `BACKEND` в `settings.py` на `channels.layers.InMemoryChannelLayer` → `test_channel_layers_backend_is_not_in_memory` упал (`AssertionError`), откат восстановил зелёный.
- AC-4 (ORM только через `database_sync_to_async`): подтверждено — `consumers.py` не делает ORM-вызовов вовсе (grep не находит `.objects`/ORM-паттернов), задокументировано в докстринге, AC формально удовлетворён по "не применимо" ветке.
- AC-5 (гейт зелёный, HTTP не сломан): подтверждено полным прогоном гейта (см. ниже) + существующий HTTP-сьют (`apps.core`/`apps.operations`/`apps.notifications`) без регресса.

**Дополнительная красная проба** (не из явного списка, но существующий arch-guard, задетый стори): ARCH-SEC-030 (`test_x_user_id_literal_only_in_core_auth`) — временно возвращён буквальный литерал `X-User-Id` в докстринг `ws_auth.py` → тест упал (`AssertionError: X-User-Id read outside core/auth`), откат восстановил зелёный. Подтверждает, что дев-агент действительно исправил регрессию (не просто переформулировал мимо гварда случайно).

**Результат гейта (финальный, после всех проб и отката):**
```
VAPS_DB_PORT=5434, redis :6379
.venv/bin/ruff check .                                    → All checks passed!
.venv/bin/pytest -m "not property and not concurrency and not slow and not golden"
                                                            → 2395 passed, 56 deselected, 52.47s
.venv/bin/python manage.py makemigrations --check --dry-run → No changes detected
```
0 failed. Идентично Dev Agent Record — регрессов не внесено ревью.

**Patch применено: 0.** Кода менять не пришлось — все находки либо by-design (spec-prescribed defer), либо ложные (чекбоксы верны).

**Defer: 1** (записан в `deferred-work.md`, секция "Deferred from: code review of story-11.1"): WS handshake (`?token=`) не DEBUG-гейтится и не верифицируется, в отличие от HTTP-пути (`jwt_config_from_env` fail-closed в проде) — spec-prescribed, TODO уже в докстринге `ws_auth.py`, адресовано Story 12.1 прод-hardening. Medium-severity security gap, но осознанно раскрыт стори, не сюрприз.

**Dismiss (не эскалировано в defer, тривиально):** `test_connect_without_identity_is_rejected` не ассертит конкретный `close_code=4401`, только `connected is False` — ручная проверка подтвердила код совпадает с докстрингом; усилить ассерт можно бесплатно при следующем касании файла, не отдельная запись.

**Блокеры/красные флаги для Bratan:** нет. Гейт зелёный, все red-probe прошли, единственный defer — уже раскрытый и запланированный на 12.1 security-gap, консистентный с прецедентами (1.2/1.4 dev-header stand-ins).
