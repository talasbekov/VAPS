---
baseline_commit: 52e1c7d (HEAD, merge PR#13 «story-10.1a»). ПЕРВАЯ стори Epic 11 (epic-11 backlog→in-progress). Идёт ПАРАЛЛЕЛЬНО с 10.2 (automator maxParallel=2): 10.2 — фронт (`frontend/src/**`), 11.1 — только бэк (`Backend/VAPS/**`), пересечения файлов НЕТ. Первая async-поверхность в проекте.
---

# Story 11.1: Channels и channels_redis

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система**,
I want **ASGI-точку входа `config/asgi.py` с WS-роутом `/ws/notifications/` и consumer'ом, который подписывает соединение на группу, выведенную из аутентифицированного `actor_id`, поверх `channels_redis`**,
so that **доставка уведомлений работает из ЛЮБОГО процесса (web, beat/worker, management-команда), а не только изнутри процесса, обслуживающего сокет — это транспортный фундамент, на который 11.2 повесит `group_send` из `notify()`, а 11.3 — клиент с reconnect (FR-35)**.

## Acceptance Criteria

Источник: epics.md#L1228-1234 (Story 11.1 AC); architecture.md#L337 (ASGI/channels_redis/InMemory=fail), #L327 (best-effort + дочитка), #L459 (WS-конверт), #L600 (`/ws/notifications/`), #L540 (consumers живут в `apps/notifications/`), #L592 (граница `notifications ← все`); ARCH-SEC-030/ARCH-007 (`actor_id` ставит только `core/auth`); FR-35 (prd.md#L159).

1. **AC-1 (зависимости зафиксированы с обоснованием).** `Backend/VAPS/pyproject.toml`: в `dependencies` — `channels>=4.3,<5` и `channels-redis>=4.3,<5`; в `[project.optional-dependencies] dev` — `pytest-asyncio>=1,<2`. Каждая строка несёт комментарий в стиле существующих (`python-docx`/`fpdf2`, pyproject.toml:24-42): стори, дата снапшота реестра, offline-последствие. **Обязательно отметить:** `channels-redis` тянет `redis>=4.6` и `msgpack~=1.0` (**C-расширение** → колёса вендорятся в offline-зеркало контура, architecture.md#L56,#L264). `channels 4.3.2` заявляет `Framework :: Django :: 5.1` — совместимо с пином `Django>=5.0,<5.2`. **НЕ добавлять** `uvicorn`/`daphne`/`celery` (см. AC-9).
2. **AC-2 (channel layer — только Redis; InMemory невозможен).** `settings.py`: `CHANNEL_LAYERS` с `BACKEND = "channels_redis.core.RedisChannelLayer"`, хост из `VAPS_REDIS_URL` (дефолт `redis://127.0.0.1:6379/0`), разобранный валидирующим хелпером `channel_layers_from_env(env)` по образцу `max_upload_mb_from_env` (settings.py:208-222): пустой/не-`redis(s)://` URL → `ImproperlyConfigured` на старте, не молчаливая деградация. Бэкенд **захардкожен** — env выбирает только адрес, не класс. **Гвард (эпик-AC «InMemoryChannelLayer = fail CI»):** тест `test_channel_layer_is_redis_backed` — `settings.CHANNEL_LAYERS["default"]["BACKEND"] == "channels_redis.core.RedisChannelLayer"` И литерал `InMemoryChannelLayer` не встречается среди **строковых констант AST** ни в одном `.py` под `config/` + анти-вакуум `assert files`. **Скан — именно по AST-константам (образец `core/tests/test_isolation.py:26-32`), а не `grep` по тексту:** пояснение «почему InMemory запрещён» обязано быть `#`-комментарием (комментарии в AST не попадают), а НЕ докстрингом — докстринг является строковой константой и сам зажёг бы гвард. Ловушка реальная: без этого правила Task 2 и AC-2 противоречат друг другу. Гейт проекта = `make gate` (CI-workflow на VAPS нет, README.md:15 / architecture.md#L341) — значит гвард обязан быть pytest-тестом, не шагом Actions.
3. **AC-3 (ASGI-вход смонтирован).** `config/asgi.py` (NEW): `ProtocolTypeRouter({"http": get_asgi_application(), "websocket": ActorIdMiddleware(URLRouter(notifications_ws_urlpatterns))})`; `settings.ASGI_APPLICATION = "config.asgi.application"`; `"channels"` добавлен в `INSTALLED_APPS`; `WSGI_APPLICATION = None` **остаётся как есть**. `django.setup()` через `get_asgi_application()` вызывается ДО импорта consumers (иначе AppRegistryNotReady) — импорт `routing` только после него. Тест `test_asgi_application_routes_http_and_websocket`: `application` импортируется, оба ключа протоколов присутствуют.
4. **AC-4 (identity — server-side, аноним отвергнут на handshake).** WS-аутентификация живёт в **`apps/core/auth/ws.py`** (NEW) — иное размещение валит существующий гвард `apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth` (ARCH-SEC-030). `ActorIdMiddleware` кладёт `scope["actor_id"]` по той же fail-closed логике, что `build_auth_classes` (settings.py:165-176): **JWT сконфигурирован** (`settings.VAPS_JWT` не None) → actor берётся ТОЛЬКО из токена `?token=<jwt>`, верифицированного тем же кодом, что REST (`exp`/`sub` обязательны, `aud`/`iss` при наличии, allowlist алгоритмов, sub-гигиена ≤100/printable/без пробелов); dev-заголовок `X-User-Id` при сконфигурированном JWT **игнорируется**. **JWT не сконфигурирован** (dev/тесты) → `X-User-Id` из scope-заголовков ИЛИ `?user_id=`. **Given** соединение без валидной identity, **Then** consumer НЕ вызывает `accept()` и закрывает handshake кодом `4403` (клиент видит отказ рукопожатия, а не «подключился и молчит»). **Given** клиент передал чужой `user_id`/`recipient` любым параметром при сконфигурированном JWT, **Then** это не влияет ни на что: имя группы выводится ИСКЛЮЧИТЕЛЬНО из server-resolved `scope["actor_id"]` (перенос self-scope-инварианта 5.7c AC-2 на WS — иначе сокет обходит доступ-контроль read-API).
5. **AC-5 (группа по actor_id — детерминированная и валидная).** `apps/notifications/groups.py` (NEW): `group_name_for(recipient: str) -> str` → `f"notif.{sha256(recipient.encode()).hexdigest()[:32]}"`. **Почему хэш, а не сырой id:** Channels валидирует имя группы по `^[a-zA-Z\d\-_.]+$`, ≤100 символов (`BaseChannelLayer.valid_group_name`), а `recipient`/`sub` — произвольная printable-строка до 100 символов (может содержать `@`, `:`, кириллицу) → сырое имя роняет `group_add` в рантайме. Функция чистая, без БД, **экспортируется для 11.2** (`notify()` обязана вычислять имя тем же кодом — расхождение = молча недоставленные сообщения). Тесты: детерминизм, валидность по регэкспу Channels для «злых» id (кириллица/`@`/`:`/пробел-в-краях/100-символьный), различимость двух разных id.
6. **AC-6 (доставка ИЗ ДРУГОГО ПРОЦЕССА — ядро стори).** **Given** consumer подключён к `/ws/notifications/` как actor `alice`, **When** `group_send(group_name_for("alice"), {"type": "notify.message", "message": {...}})` выполняется **в отдельном ОС-процессе** (`subprocess` с собственным `django.setup()`, БЕЗ загруженного ASGI-приложения), **Then** подключённый consumer получает сообщение и ретранслирует его клиенту. Дополнительно: сообщение в группу `bob` **не** приходит подписчику `alice`. Это буквальный смысл эпик-AC «group_send из Celery worker»: инвариант — «доставка работает из процесса, который не обслуживает сокет», и он проверяется РЕАЛЬНЫМ вторым процессом (Celery в проект не вводится, AC-9). Same-process-вариант этого теста доказывал бы только работу Redis-цикла внутри одного интерпретатора — недостаточно.
7. **AC-7 (ORM в consumers только через `database_sync_to_async`).** AST-гвард `test_consumers_use_database_sync_to_async`: скан `apps/notifications/consumers.py` (и любых будущих `consumers*.py`) — внутри тел `async def` запрещены обращения к менеджеру ORM (`<X>.objects`) и вызовы `.save()/.delete()/.get()/.filter()` на модельных символах вне обёртки `database_sync_to_async`. Анти-вакуум: (а) `assert files` — скан обязан что-то найти; (б) **guard-the-guard** `test_scan_detects_orm_in_async` скармливает сканеру синтетический сниппет с нарушением и требует, чтобы он был пойман (образец `test_audit_coverage.py::test_scan_detects_both_emission_forms`). Гвард форвардный: consumer 11.1 к ORM не обращается вовсе — гвард стоит ДО того, как 11.2/11.4 захотят прочитать `Notification` в сокете.
8. **AC-8 (Redis поднят гейтом, тесты не «скипаются в зелёное»).** `Backend/VAPS/docker-compose.yml` (MOD): сервис `redis` (`image: redis:7-alpine`, порт **`6380:6379`** — не дефолтный, зеркало решения `5433:5432` против коллизии с локальным Redis разработчика, healthcheck `redis-cli ping`). `Makefile` (MOD): в `gate` — `docker compose up -d --wait db redis` и `VAPS_REDIS_URL=redis://127.0.0.1:6380/0` в блоке env. **WS-тесты НЕ помечаются `skipif`-по-доступности-Redis:** гейт сам поднимает сервис, а «скип = зелёно» — ровно тот вакуум, против которого AI-1 ретро E9 (skip-условие сделало бы главный тест AC-6 неотличимым от отсутствующего). Бюджет `gate` 300s (NFR-8) — соблюдён: +1 контейнер, WS-тесты секундные.
9. **AC-9 (границы — что НЕ входит).** **НЕ трогаем** `apps/notifications/services.py::notify()` (`group_send` из `notify()` = **11.2**), фронт-клиент/reconnect (**11.3**), UI-центр/колокольчик/mark-as-read (**11.4**), kill-switch-флаг WS (**11.5**), Playwright-e2e (**11.6**), `uvicorn`/`nginx`/прод-compose/`worker`/`beat` (**12.1**). **Celery НЕ вводится** — прямое требование epics.md#L759 («НЕ вводить Celery») и ARCH-DEFERRED-048. Модели/миграций стори не добавляет → `makemigrations --check` обязан остаться пустым; unread-индекс (`read_at IS NULL`, deferred-work.md:495) — долг центра уведомлений **11.4**, не транспорта. `schema.yaml`/`schema.d.ts` НЕ регенерируются: WS вне OpenAPI, HTTP-поверхность не менялась.
10. **AC-10 (регресс нулевой, гейт зелёный).** `make gate` (из `Backend/VAPS`) зелёный: `ruff check .` чист (E,F), `makemigrations --check --dry-run` — «No changes detected», весь существующий сет проходит без правок логики. Отдельно подтвердить: `apps/core/tests/test_isolation.py` (X-User-Id-гвард — новый `ws.py` лежит в `core/auth`, значит освобождён легально), `apps/notifications/tests/test_isolation.py` (consumers не импортируют `apps.core.models`), `apps/operations/tests/test_rbac_matrix.py` и `apps/audit/tests/test_audit_coverage.py` (**HTTP-роутов не добавлено → новых строк в MATRIX/AUDIT_MATRIX быть не должно**; если completeness-тест покраснел — значит по ошибке добавлен HTTP-роут). Фронт НЕ затронут — `npm run gate` гонять не нужно.

## Tasks / Subtasks

- [x] **Task 1 — Зависимости и конфигурация pytest-asyncio** (`pyproject.toml`, MOD) (AC: 1)
  - [x] `dependencies`: `"channels>=4.3,<5"`, `"channels-redis>=4.3,<5"` с комментарием-обоснованием (стори 11.1; снапшот PyPI 2026-07-19: channels 4.3.2 / channels-redis 4.3.0; транзитивно `redis>=4.6` + `msgpack~=1.0` — msgpack C-расширение, колесо в offline-зеркало).
  - [x] `[project.optional-dependencies] dev`: `"pytest-asyncio>=1,<2"`.
  - [x] `[tool.pytest.ini_options]`: `asyncio_mode = "strict"` (явный `@pytest.mark.asyncio` — стиль проекта; `auto` захватывал бы async-тесты неявно) + `asyncio_default_fixture_loop_scope = "function"` (иначе DeprecationWarning pytest-asyncio). Маркер `asyncio` регистрирует сам плагин — с `--strict-markers` конфликта нет; **проверить сборкой**, а не на веру.
  - [x] Установка: `.venv/bin/pip install -e '.[dev]'`.
- [x] **Task 2 — Settings: channel layer + ASGI** (`config/settings.py`, MOD) (AC: 2,3)
  - [x] `INSTALLED_APPS`: `"channels"` (после `"django.contrib.postgres"`, перед `"rest_framework"`) с комментарием-стори. `daphne` НЕ добавлять (в Channels 4 он даёт только ASGI-`runserver`; сервер — 12.1).
  - [x] `def channel_layers_from_env(env)` — читает `VAPS_REDIS_URL` (дефолт `redis://127.0.0.1:6379/0`), валидирует непустоту и схему `redis://`/`rediss://` → иначе `ImproperlyConfigured`; возвращает `{"default": {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [url]}}}`. Пояснение «почему бэкенд не конфигурируем» (architecture.md#L337 — InMemory тихо роняет `group_send` из чужого процесса) — **`#`-комментарием, НЕ докстрингом** (см. AC-2: докстринг = строковая константа = ложное срабатывание собственного гварда).
  - [x] `CHANNEL_LAYERS = channel_layers_from_env(os.environ)`; `ASGI_APPLICATION = "config.asgi.application"`. `WSGI_APPLICATION = None` не трогать.
  - [x] Комментарий про Redis-скоуп: architecture.md#L311 «Redis — только брокер, кэш не вводится» → здесь Redis используется как **channel layer**, третьего назначения (кэша) не появляется.
- [x] **Task 3 — WS-identity** (`apps/core/auth/ws.py`, NEW) (AC: 4)
  - [x] `class ActorIdMiddleware(BaseMiddleware)` — `async def __call__(self, scope, receive, send)`: резолв actor → `scope["actor_id"] = <str|None>` → `super().__call__`.
  - [x] Резолв (зеркало `build_auth_classes`, fail-closed): если `settings.VAPS_JWT` **не** None → только `?token=` через общую верификацию; иначе — заголовок `X-User-Id` из `scope["headers"]` (bytes-пары, регистр заголовков нормализовать) ИЛИ `?user_id=`.
  - [x] **Переиспользовать, а не переписывать верификацию JWT:** вынести тело проверки из `JWTAuthentication.authenticate` (authentication.py:81-115) в чистую функцию `verify_jwt_sub(token, cfg) -> str` в `authentication.py` и вызвать её из обоих мест. Дублирование правил (`require`/`aud`/leeway/sub-гигиена) = гарантированный дрейф двух путей аутентификации. Существующие тесты `test_jwt_authentication.py` обязаны остаться зелёными без правок.
  - [x] `_jwt_config()` уже есть (authentication.py:30-37) — использовать его, не читать `settings.VAPS_JWT` вторым способом.
  - [x] Невалидный/просроченный токен → `actor_id = None` (отказ на уровне consumer'а, AC-4), НЕ исключение из middleware.
- [x] **Task 4 — Имя группы** (`apps/notifications/groups.py`, NEW) (AC: 5)
  - [x] `group_name_for(recipient: str) -> str`; `ValueError` на пустой/blank `recipient` (зеркало blank-guard `notify()`, services.py:29-31). Докстринг: ограничение Channels на имя группы + контракт «11.2 обязана звать эту же функцию».
- [x] **Task 5 — Consumer + routing** (`apps/notifications/consumers.py`, `apps/notifications/routing.py`, NEW) (AC: 3,4,6,7)
  - [x] `class NotificationConsumer(AsyncWebsocketConsumer)`:
    - `connect`: `actor = self.scope.get("actor_id")`; если пусто → `await self.close(code=4403)` **без `accept()`**; иначе `self.group = group_name_for(actor)`, `await self.channel_layer.group_add(self.group, self.channel_name)`, `await self.accept()`.
    - `disconnect`: `group_discard` (только если группа была назначена — иначе `AttributeError` на отвергнутом соединении).
    - `receive`: входящие от клиента игнорируются (клиент 11.3 только слушает; heartbeat — ping/pong протокола + nginx 12.1).
    - `async def notify_message(self, event)`: `await self.send(text_data=json.dumps(event["message"]))`.
  - [x] **Явно задокументировать в докстринге два разных «type»** (классический источник багов, критично для 11.2): `type` в конверте **channel layer** = `"notify.message"` — маршрутизация Channels к хендлеру (точки → подчёркивания); `type` в конверте **WS-сообщения клиенту** = UPPER_SNAKE из `docs/registries/ws-message-types.yaml`, живёт ВНУТРИ `event["message"]` (`{"type": ..., "payload": ...}`, architecture.md#L459). Смешать их = либо `No handler for message type`, либо код реестра, потерянный на транспорте.
  - [x] ORM не трогать вовсе (AC-7).
  - [x] `routing.py`: `websocket_urlpatterns = [path("ws/notifications/", NotificationConsumer.as_asgi())]`. Путь без ведущего слэша (Channels отдаёт path в URLRouter без него) — итоговый URL `/ws/notifications/` (architecture.md#L600).
- [x] **Task 6 — ASGI-приложение** (`config/asgi.py`, NEW) (AC: 3)
  - [x] `os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")` → `django_asgi_app = get_asgi_application()` → **только затем** импорт `routing`/`ws`-middleware → `application = ProtocolTypeRouter({...})`.
  - [x] Комментарий: HTTP-ветка сохраняет полный Django-стек (включая `RequestContextMiddleware`); на WS-ветке HTTP-middleware **не выполняется**, поэтому `request_id`-contextvar в consumer'е пуст (`apps/core/middleware.py:44` — «or "" outside a request») — известный и принятый пробел логирования для транспорта, не баг.
- [x] **Task 7 — Redis в compose и гейте** (`docker-compose.yml`, `Makefile`, MOD) (AC: 8)
  - [x] compose: сервис `redis` (`redis:7-alpine`, `6380:6379`, healthcheck `["CMD","redis-cli","ping"]`, interval/retries по образцу `db`).
  - [x] Makefile `gate`: `docker compose up -d --wait db redis`; добавить `VAPS_REDIS_URL=redis://127.0.0.1:6380/0` в env-блок рядом с `VAPS_DB_*`. То же для `test-full`, если он поднимает БД.
- [x] **Task 8 — Тесты consumer'а и доставки** (`apps/notifications/tests/test_ws_consumer.py`, NEW) (AC: 3,4,5,6)
  - [x] `WebsocketCommunicator(application, "/ws/notifications/", headers=[(b"x-user-id", b"alice")])` — `connected is True`.
  - [x] Аноним (без заголовка/параметра) → `connected is False`, close-код `4403`.
  - [x] `group_name_for`: детерминизм / валидность по регэкспу Channels для «злых» id / различимость.
  - [x] **AC-6, главный тест:** подключить `alice` → `subprocess.run([sys.executable, "-c", <скрипт>])`, где скрипт делает `django.setup()` и `async_to_sync(get_channel_layer().group_send)(group_name_for("alice"), {"type":"notify.message","message":{"type":"DAILY_MARK_MISSING","payload":{"probe":1}}})` → `await communicator.receive_json_from(timeout=5)` вернул именно этот конверт. Subprocess наследует env (`VAPS_REDIS_URL`, `VAPS_DB_*`); ненулевой returncode субпроцесса — падение теста с его stderr в сообщении (иначе «не пришло» маскирует «не запустилось»).
  - [x] Изоляция групп: `group_send` в группу `bob` → `alice` НЕ получает (`assert await communicator.receive_nothing(timeout=1)`).
  - [x] JWT-ветка: с сконфигурированным `VAPS_JWT` (`override_settings`) валидный `?token=` подключается, а `X-User-Id` — **нет** (fail-closed зеркало REST).
  - [x] `await communicator.disconnect()` в каждом тесте (утечка соединений между тестами = флейк).
  - [x] БД не нужна ни одному тесту → `django_db` НЕ ставить (async+ORM-фикстуры — источник боли; consumer к ORM не обращается).
- [x] **Task 9 — Гварды** (`apps/notifications/tests/test_ws_guards.py`, NEW) (AC: 2,7)
  - [x] `test_channel_layer_is_redis_backed` + скан `config/**.py` на литерал `InMemoryChannelLayer` (+ `assert files`).
  - [x] `test_consumers_use_database_sync_to_async` (AST) + `test_scan_detects_orm_in_async` (guard-the-guard на синтетическом сниппете).
  - [x] Стиль — точное зеркало `apps/notifications/tests/test_isolation.py` (тот же способ обхода AST, тот же анти-вакуумный `assert`).
- [x] **Task 10 — Гейт** (AC: 10)
  - [x] `make gate` из `Backend/VAPS`. Убедиться: ruff чист, `makemigrations --check` пуст, RBAC/audit-матрицы **без новых строк**, `core/test_isolation` и `notifications/test_isolation` зелёные, бюджет 300s не превышен.
  - [x] **Красная проба обязательна** (гейт AI-1 ретро E9) — минимум на три ассерта, см. Dev Notes → «Красная проба».

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; менять осознанно)

> **№1 = A (транспорт токена в браузерный WS — query-параметр `?token=`).** Браузерный `WebSocket` **не может** ставить заголовок `Authorization` — весь REST-путь identity (Bearer/`X-User-Id`) физически недоступен клиенту 11.3. Варианты: (A) `?token=<jwt>`; (B) `Sec-WebSocket-Protocol: bearer, <token>` (браузер умеет через второй аргумент конструктора, но сервер обязан эхом вернуть выбранный субпротокол — возни больше); (C) session-cookie (отвергнут: API сессиями не пользуется, `django.contrib.sessions` стоит только ради admin). **Принято A** — минимальная механика, тестируемая и из `WebsocketCommunicator`, и из браузера. **Риск и митигация:** токен в query попадает в access-логи → в 12.1 nginx для `location /ws/` логирует `$uri` без `$args` (или `access_log off`); зафиксировать это как вход в 12.1. **Архитектура молчит** по транспорту токена (проверено: ни одного упоминания в architecture.md/PRD) → по правилу «молчание = СТОП» это вынесено как открытый вопрос Bratan, но дефолт A принят, чтобы не блокировать 11.3.
> **№2 = A (доказательство cross-process — реальный `subprocess`, Celery НЕ вводится).** Эпик-AC говорит «group_send из Celery worker», но Celery в проекте нет и вводить его запрещено (epics.md#L759 «НЕ вводить Celery»; ARCH-DEFERRED-048 с измеримыми триггерами). Реальный инвариант эпика — «доставка работает из процесса, не обслуживающего сокет». `subprocess` доказывает именно его, честнее и дешевле, чем поднимать брокер и воркер ради одного ассерта. Когда Celery появится (12.x), тест не потребует переписывания — он и так про «чужой процесс».
> **№3 = A (имя группы — sha256-хэш actor_id, общая функция).** Сырой `actor_id` невалиден как имя группы Channels (regexp + 100 символов). Альтернатива «санитизировать заменой недопустимых символов» отвергнута: два разных id могут схлопнуться в одно имя (`a@b` и `a_b`) → перекрёстная доставка чужих уведомлений. Хэш детерминирован, всегда валиден, коллизия на 128 битах нереалистична. Функция ОБЩАЯ с 11.2 — иначе два разных имени для одного получателя дают тихую недоставку.
> **№4 = A (отказ анонима — `close(4403)` до `accept()`).** Альтернатива «принять и молчать» отвергнута: клиент 11.3 не отличит «нет прав» от «нет событий» и будет бесконечно реконнектиться в никуда. Код 4403 — из приватного диапазона 4000-4999, семантически зеркалит REST-контракт `403 PERMISSION_DENIED` (5.7c AC-3: аноним → 403, а не 401).
> **№6 = A (`AllowedHostsOriginValidator` НЕ добавляем в 11.1).** Канон Channels советует оборачивать WS-ветку валидатором Origin против CSWSH. Отвергнуто на этом шаге по двум причинам: (1) CSWSH эксплуатирует **ambient credentials** (cookie/session) — здесь identity приезжает явным токеном/заголовком, которых чужая страница не добудет; (2) валидатор сверяет Origin с `ALLOWED_HOSTS`, а dev-контур ходит через vite-прокси с Origin `http://localhost:5173` → 11.3 сломалась бы на ровном месте. Origin-фильтрация — уровень nginx в 12.1 (там же, где WS-upgrade и `proxy_read_timeout`). **Зафиксировать входом в 12.1**, чтобы решение не потерялось как «просто не сделали».
> **№5 = A (гварды — pytest, не CI-workflow).** Эпик пишет «fail CI», но единственный CI-workflow репозитория гоняет **донора** (`Backend/PersonnelStatus`), а не VAPS; де-факто гейт VAPS — локальный `make gate` (README.md:15, architecture.md#L341 «деплой требует штамп gate»). Значит «InMemory = fail CI» реализуется как pytest-гвард внутри `gate`. Заводить workflow под VAPS — отдельная задача (12.x), не эта стори.

### Архитектурные правила (developer guardrails)

- **`X-User-Id` читается ТОЛЬКО под `apps/core/auth/`.** Гвард `apps/core/tests/test_isolation.py:35-53` сканирует ВСЕ строковые константы под `apps/` и `config/` (обе формы написания, нормализация `-`→`_`) и освобождает только `apps/core/auth/`. Положить WS-middleware куда-либо ещё (например в `apps/notifications/`) = красный гейт. Это не стилистика, а ARCH-SEC-030.
- **Граница `notifications ← все` (architecture.md#L592).** Consumer — новая точка входа, но не новый писатель: он ничего не создаёт в БД. Запись уведомлений остаётся исключительно за `notifications.services.notify()`. Не соблазняться «отметить прочитанным по WS» — это 11.4 и это HTTP-мутация.
- **`notifications` ↛ `apps.core.models`** — AST-гвард `apps/notifications/tests/test_isolation.py` (усилен в 5.7c: alias/relative-резолюция + анти-вакуумный `assert files`). Consumer читает `scope["actor_id"]` — плоскую строку (ARCH-007), никаких моделей core.
- **Слоевой контракт (architecture.md#L444-454) действует и для consumer'а:** он тонкий транспорт. Бизнес-логики, `transaction.atomic`, вызовов сервисов в 11.1 нет вовсе.
- **`timezone.now()` в домене запрещён** (гвард wall-clock, `core/tests/test_isolation.py`) — время в consumer'е не трогаем.
- **Логи:** `logging.getLogger(__name__)`, structured, без ПДн, без `print()` (architecture.md#L460). `request_id` на WS-ветке пуст — см. Task 6.
- **`makemigrations --check` обязан остаться пустым.** Стори не добавляет ни моделей, ни полей. Если `--check` не пуст — что-то импортировано/зарегистрировано неправильно, а не «нужна миграция».
- **Dev-режим допускает подмену личности — ЭТО BY DESIGN, не баг.** Без сконфигурированного `VAPS_JWT` любой клиент может назвать себя кем угодно (`X-User-Id` / `?user_id=`) — ровно то же свойство, что у существующего REST-стенда `XUserIdAuthentication` (authentication.py:7-27). Защита — не в consumer'е, а в `jwt_config_from_env` (settings.py:114-127): прод (`DEBUG=False`) **без JWT не стартует вовсе**. Не «чинить» это в 11.1 и не изобретать вторую модель доверия; при сконфигурированном JWT dev-путь отключён целиком (AC-4).
- **Никаких `if DEBUG:`-веток** (architecture.md#L338, комментарий settings.py:204-210 «без веток по окружению»). Различия dev/prod — через env (`VAPS_JWT` сконфигурирован или нет, `VAPS_REDIS_URL`).

### Ловушки (проверено в коде — не наступать)

1. **`AppRegistryNotReady`** — в `config/asgi.py` `get_asgi_application()` обязан выполниться ДО импорта модулей, тянущих модели/consumers. Импорт `routing` ставить строкой ниже, с коротким комментарием «почему не сверху» (ruff E402 при необходимости — точечный `# noqa: E402`, это канонический паттерн Channels).
2. **`type` в `group_send` ≠ `type` в WS-конверте** — см. Task 5. `"notify.message"` маршрутизирует, UPPER_SNAKE из реестра едет внутри `message`.
3. **`disconnect` на отвергнутом соединении** — `self.group` не назначена, `group_discard` уронит `AttributeError`. Проверять `getattr(self, "group", None)`.
4. **Заголовки в ASGI-scope — список пар `bytes`, в нижнем регистре**, а не `request.headers`. `scope["headers"]` парсить явно; `scope["query_string"]` — тоже `bytes` (декодировать + `parse_qs`).
5. **Дефолтный порт Redis занят** у разработчика с большой вероятностью → маппинг `6380:6379` (и `VAPS_REDIS_URL` в gate указывает на 6380). Тот же класс инцидента, что «порт 5433 занят чужим контейнером» в Debug Log 10.1a.
6. **`--strict-markers`** (pyproject.toml): любой незарегистрированный маркер = ошибка коллекции. `asyncio` регистрирует плагин, но это надо **увидеть на прогоне**, а не предположить.
7. **Скип вместо провала** — категорически нет (см. AC-8). `test_schema_drift` скипается без Postgres, и это осознанный прецедент для *дрейфа схемы*; для главного теста доставки скип означал бы, что AC-6 не проверяется никогда, а гейт зелёный.
8. **`channels-redis` ≥4.3 требует `channels>=4.2.2`** — пины `>=4.3,<5` на оба это удовлетворяют; не занижать `channels`.

### Previous Story Intelligence

- **5.7a (done):** `Notification` (`recipient`/`kind`/`business_date`/`payload`/`read_at`), `db_table="notifications"`, `UniqueConstraint(recipient,kind,business_date)`, `CheckConstraint chk_notification_kind`. **`recipient` — плоский actor-id-строка** (ARCH-007) → именно он и есть «user_id» группы из эпик-AC. `notify()` пишет **синхронно внутри транзакции вызывающего** (review D1, вариант B) и **non-fatal** (ловит всё, логирует, возвращает `None`) — 11.2 будет вешать `group_send` на `transaction.on_commit`, но это НЕ здесь.
- **5.7c (done):** read-API `GET /api/notifications/` — any-auth + **безусловный self-scope** (`recipient == actor_id` в селекторе, не в RBAC), `?since=` **строго** `created_at > since`, порядок `(-created_at, id)`, `MATRIX["notification-list"] = _AnyAuthenticated()`. WS обязан унаследовать self-scope (AC-4): сокет, позволяющий подписаться на чужую группу, обошёл бы весь доступ-контроль read-API.
- **10.1a (done, последняя):** прецедент «тонкая поверхность над готовым сервисом»; уроки — гварды ловят пропуски спеки (audit-coverage потребовал строки, которой не было в плане), красная проба обязательна, бэкапить прод-код перед мутацией через `cp`, а НЕ `git checkout`.
- **Ретро E9 §3 (главный паттерн проекта):** «тесты, которые не могут упасть» всплыли в ПЯТИ стори. Здесь два кандидата на вакуум: (а) `receive_nothing()` зелен и когда сокет вообще мёртв; (б) AST-гвард зелен, когда сканирует пустой список файлов. Оба закрыты явно: позитивный приём в том же тесте и `assert files` + guard-the-guard.
- **deferred-work.md:509:** курсор `?since=` по timestamp может пропустить строку, закоммиченную позже её `created_at`; отмечено, что «E11-WS заменяет поллинг как основной канал доставки». Транспорт из 11.1 — предпосылка этого закрытия, но само закрытие — 11.3/11.4.

### Git Intelligence

- Baseline `52e1c7d` (merge PR#13, 10.1a done). Рабочее дерево содержит только untracked-артефакты automator'а.
- Последние 5 коммитов — E10/E9-фронт и REST-бэкфилл; ни один не трогает `config/` или `apps/notifications/` → конфликтов с параллельной 10.2 нет по построению (10.2 живёт в `frontend/src/**`).
- Коммит (за Bratan, после ревью): `feat(story-11.1): ASGI + channels_redis — WS-транспорт уведомлений`. Артефакты агент НЕ коммитит.
- Ревью: если та же модель — **красная проба обязательна** (AI-1/AI-2 ретро E9, подтверждено на 9.9).

### Красная проба (гейт AI-1 ретро E9 — не намерение, а условие `done`)

В ревью-секции зафиксировать «мутация X → тест покраснел» минимум для трёх ассертов:
1. **AC-6 (доставка из чужого процесса):** подменить `CHANNEL_LAYERS.BACKEND` на `channels.layers.InMemoryChannelLayer` → cross-process тест обязан покраснеть (это и есть буквальная проверка утверждения архитектуры «через InMemory group_send из чужого процесса уходит в никуда молча»). Заодно доказывает не-вакуумность гварда AC-2.
2. **AC-4 (отказ анонима):** убрать проверку `actor_id` в `connect()` (принимать всех) → тест анонима обязан покраснеть на `connected is True`.
3. **AC-5/изоляция групп:** заменить `group_name_for(actor)` на константу (все в одной группе) → тест изоляции `alice`/`bob` обязан покраснеть.
4. **AC-7 (guard-the-guard):** уже встроен как отдельный тест — синтетический сниппет с ORM в `async def` обязан ловиться сканером.

Бэкап мутируемых файлов — через `cp`, восстановление — из бэкапа; **`git checkout` запрещён** (урок 9.6: стирает незакоммиченные ревью-правки).

### Project Structure Notes

- **NEW:** `config/asgi.py`; `apps/core/auth/ws.py`; `apps/notifications/{groups,consumers,routing}.py`; `apps/notifications/tests/{test_ws_consumer,test_ws_guards}.py`.
- **MOD:** `pyproject.toml`; `config/settings.py`; `apps/core/auth/authentication.py` (вынос `verify_jwt_sub`, поведение не меняется); `docker-compose.yml`; `Makefile`.
- **Файлов 12** (7 NEW + 5 MOD) — выше ориентира «≤5». Обоснование (прецедент 10.1a): это неделимый минимум ОДНОЙ связной ответственности «WS-транспорт существует и доставляет из любого процесса». Разрезать нечего: consumer без channel layer не тестируется, channel layer без consumer'а не проверяет эпик-AC, группа по user_id без identity недостижима, а Redis без compose/gate не поднят. Из 12 файлов 2 — тесты, 3 — инфра-конфиг (`pyproject`/`docker-compose`/`Makefile`), 1 — чисто механический вынос функции (`authentication.py`); содержательного нового кода — 5 небольших модулей. **File List в Dev Agent Record обязан совпасть с `git diff --name-only` против baseline `52e1c7d`** (AI-3 ретро E9: дрейф File List — 2 эпика подряд).
- **`consumers.py`/`routing.py` отсутствуют в §Naming Patterns** (architecture.md#L415 перечисляет `selectors/services/validators/tasks/api/tests`) — имена взяты каноничные для Channels и согласуются с architecture.md#L540 («notifications/ … WS consumers»). Зафиксировать как расширение конвенции в ретро E11.
- **`config/settings.py` остаётся плоским.** architecture.md#L504-506 рисует `settings/{base,production}.py` + `asgi.py`; фактически сплита нет. Эта стори добавляет только `asgi.py`; **сплит settings НЕ делать** (не в скоупе, задел 12.1).

### Открытые вопросы (Bratan — не блокируют dev 11.1, но нужны ДО 11.2/11.3)

1. **🔴 Словарь типов сообщений расходится с кодом (нужно ДО 11.2).** `docs/registries/ws-message-types.yaml` содержит 24 типа и объявляет, что `type_code` — это одновременно тип WS-конверта и колонка `notifications_messages.type_code`. Реально в коде: таблица `notifications`, колонка `kind`, единственное разрешённое значение `SUBMISSION_LAGGING` — которого **в реестре нет** (ближайший по смыслу — `DAILY_MARK_MISSING`, и именно он значится в UX-списке пилотных событий, EXPERIENCE.md#L187). Варианты: (а) добавить `SUBMISSION_LAGGING` в реестр; (б) переименовать `kind` в `DAILY_MARK_MISSING` (миграция данных + правка `CheckConstraint`). По правилу «тип не в реестре → СТОП» это решение Bratan, и 11.1 его сознательно НЕ принимает: транспорт 11.1 type-agnostic (ретранслирует любой конверт как есть), поэтому вопрос не блокирует эту стори, но блокирует 11.2.
2. **Транспорт токена в браузерный WS** — принят дефолт A (`?token=`, Решение №1). Требует подтверждения и входа в 12.1 (nginx: не логировать `$args` на `/ws/`).
3. **Семантика fallback при kill-switch расходится в документах:** architecture.md#L327 говорит «ручной refresh», Story 11.5 и EXPERIENCE.md#L276 — «polling». Решить к 11.5.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1226-1234] — Epic 11 и AC Story 11.1 (ASGI-роутинг, группа по user_id, group_send из воркера, InMemory=fail, `database_sync_to_async`).
- [Source: _bmad-output/planning-artifacts/epics.md#L759] — «НЕ вводить Celery» (архитектурный гвоздь 5.7).
- [Source: _bmad-output/planning-artifacts/architecture.md#L337] — ASGI-монопроцесс, «channels_redis обязателен; InMemoryChannelLayer = fail в CI», nginx/timeout/reconnect.
- [Source: _bmad-output/planning-artifacts/architecture.md#L327, #L459] — best-effort + дочитка REST; WS-конверт `{"type": UPPER_SNAKE из реестра, "payload"}` только через `on_commit`.
- [Source: _bmad-output/planning-artifacts/architecture.md#L540, #L600] — consumers живут в `apps/notifications/`; путь `/ws/notifications/`.
- [Source: _bmad-output/planning-artifacts/architecture.md#L592] — граница «notifications ← все: только `notifications.services.notify()`».
- [Source: _bmad-output/planning-artifacts/architecture.md#L311] — «Redis — только брокер», кэш не вводится.
- [Source: _bmad-output/planning-artifacts/architecture.md#L444-454] — layer contract; ARCH-007 `request.actor_id: str`.
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L159] — FR-35 (in-app + WS, подтверждено 2026-06-10).
- [Source: Backend/VAPS/config/settings.py:12-36] — `INSTALLED_APPS` (куда добавить `channels`).
- [Source: Backend/VAPS/config/settings.py:68] — `WSGI_APPLICATION = None` (не трогать).
- [Source: Backend/VAPS/config/settings.py:165-187] — `build_auth_classes`/`REST_FRAMEWORK` (fail-closed логика, которую зеркалит WS-middleware).
- [Source: Backend/VAPS/config/settings.py:208-222] — `max_upload_mb_from_env` (образец валидирующего env-хелпера).
- [Source: Backend/VAPS/apps/core/auth/authentication.py:30-37, 81-115] — `_jwt_config()`; тело верификации JWT, выносимое в `verify_jwt_sub`.
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py:35-53] — гвард «X-User-Id только в `core/auth`» (определяет размещение `ws.py`).
- [Source: Backend/VAPS/apps/notifications/tests/test_isolation.py] — образец AST-гварда с анти-вакуумным `assert files`.
- [Source: Backend/VAPS/apps/audit/tests/test_audit_coverage.py:126-143, 164-172] — парсинг реестра без PyYAML; guard-the-guard образец.
- [Source: Backend/VAPS/apps/notifications/services.py:28-62] — `notify()` (НЕ трогаем; blank-guard `recipient` — образец для `group_name_for`).
- [Source: Backend/VAPS/apps/notifications/models.py:22-29] — `Notification.Kind` (реестр типов в коде; см. Открытый вопрос №1).
- [Source: Backend/VAPS/Makefile] — цель `gate` (`docker compose up -d --wait db`, env-блок, бюджет 300s).
- [Source: Backend/VAPS/docker-compose.yml] — единственный сервис `db` (`5433:5432`, healthcheck) — образец для `redis`.
- [Source: Backend/VAPS/pyproject.toml:5-42] — стиль комментариев-обоснований к зависимостям; `[tool.pytest.ini_options]` с `--strict-markers`.
- [Source: docs/registries/ws-message-types.yaml:1-22] — контракт WS-конверта и СТОП-правило реестра.
- [Source: _bmad-output/implementation-artifacts/5-7c-api-уведомлений.md] — self-scope + `?since=` контракт read-API.
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L72] — AI-1: красная проба как встроенный гейт цикла.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:495, 509] — unread-индекс к E11 (→11.4); курсор `?since=` и замена поллинга WS.
- [Source: PyPI, снапшот 2026-07-19] — `channels 4.3.2` (`Django>=4.2`, классификатор `Django :: 5.1`, `asgiref>=3.9,<4`); `channels-redis 4.3.0` (`redis>=4.6`, `msgpack~=1.0`, `channels>=4.2.2`).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`, dev-story 2026-07-19.

### Debug Log References

1. **В worktree не было `.venv`** (он живёт только в основном чекауте — дубль окружений). Создан заново: `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`. Установилось ровно по снапшоту стори: channels 4.3.2, channels-redis 4.3.0, msgpack 1.2.1, redis 8.0.1, pytest-asyncio 1.4.0, Django 5.1.15. `daphne`/`celery` не подтянулись — AC-9 соблюдён.
2. **`channels.testing` не импортируется без daphne** — блокер против AC-1. `channels/testing/__init__.py` безусловно тянет `.live` → `from daphne.testing import DaphneProcess`; обхода через импорт подмодуля нет (`__init__` пакета выполняется всегда). Цена установки daphne — 14 транзитивных пакетов (Twisted, autobahn, pyOpenSSL…) и 3 C-расширения (zope.interface, ujson, cbor2) в offline-зеркало контура. **Решение Bratan (AskUserQuestion, 2026-07-19): свой тонкий `WsCommunicator`** поверх `asgiref.testing.ApplicationCommunicator` (asgiref — уже жёсткая зависимость channels). Реализованы только `__init__`/`connect`/`receive_json_from`/`disconnect`; `receive_output`/`receive_nothing`/`wait` унаследованы. Единственное, что добавляет обёртка channels поверх asgiref — патч `close_old_connections` в no-op, а для ORM-free consumer'а (AC-7) это пустышка. Новых пакетов НОЛЬ, буква AC-1 соблюдена.
3. **Автоuse async-фикстура сломала коллекцию всех 18 тестов** (`AssertionError` в pytest-asyncio при `asyncio_mode=strict`): async-генератор-фикстура применялась и к синхронным тестам `group_name_for`. Убрана — оказалась не нужна, пулы Redis между event-loop'ами не потекли.
4. **`sed -i` по всему файлу удалил строку и ВНУТРИ строкового литерала `_SENDER_SCRIPT`** → cross-process тест упал с `NameError: get_channel_layer`. Ровно инцидент из памяти «правки скриптами». Починено точечным `Edit`. Урок подтверждён повторно.
5. **`make gate` красный из-за ПРЕД-СУЩЕСТВУЮЩЕГО `test_vacancies_endpoint`** — см. Completion Notes §«Гейт».
6. Ruff E501 на вынесенном `verify_jwt_sub` (91 > 88) — условие разбито на многострочное.

### Completion Notes List

**Реализовано (Tasks 1–9 закрыты и проверены прогоном).** ASGI-вход `config/asgi.py` (`ProtocolTypeRouter`, оба протокола), channel layer только Redis с валидирующим `channel_layers_from_env`, WS-identity в `apps/core/auth/ws.py` (fail-closed зеркало REST), `group_name_for` (sha256), `NotificationConsumer` + routing, Redis в compose (6380:6379) и в env гейта.

**Переиспользование JWT-верификации (Task 3).** Тело проверки вынесено из `JWTAuthentication.authenticate` в чистую `verify_jwt_sub(token, cfg) -> str` и вызывается из обоих путей. Поведение REST не менялось: `apps/core/tests/test_jwt_authentication.py` зелёный **без правок**.

**Отклонение от буквы Task 8 (согласовано).** Подзадача называет `WebsocketCommunicator`; фактически использован собственный `WsCommunicator` — причина и решение в Debug Log §2. Проверяемое поведение подзадачи (`connected is True`, close-код `4403`, `receive_json_from`) реализовано полностью.

**Осознанное сужение гварда AC-7.** Сканер ловит (а) любой `<X>.objects` внутри `async def` и (б) вызовы `.save()/.delete()/.get()/.filter()/.create()/.get_or_create()/.update()/.refresh_from_db()` — но **только на символах, импортированных из `*.models`**. Без этой привязки запрет `.get()` красил бы каждый `self.scope.get("actor_id")` в самом consumer'е (dict.get). Не ловится случай `self.<instance>.save()`, где корень цепочки — `self`; зафиксировано как известная граница. Обёртка `database_sync_to_async` распознаётся в обеих формах — и как `database_sync_to_async(fn)()`, и как декоратор вложенной sync-функции.

**Красная проба (гейт AI-1 ретро E9) — выполнена, 4 из 4.** Бэкап и восстановление через `cp`, `git checkout` не применялся к файлам стори; после восстановления `diff` с бэкапом — IDENTICAL, прогон снова зелёный (59 passed), ruff чист.

| # | Мутация | Ожидание | Факт |
|---|---------|----------|------|
| 1 | `CHANNEL_LAYERS.BACKEND` → `channels.layers.InMemoryChannelLayer` (реалистичный конфиг, без `hosts`) | cross-process доставка краснеет | ✅ `TimeoutError` — сообщение НЕ пришло, при этом субпроцесс завершился с кодом 0. Буквальное подтверждение architecture.md#L337: «уходит в никуда молча». Оба гварда AC-2 тоже покраснели. Тесты handshake остались зелёными → проба точечная, а не «сломалось всё» |
| 2 | Убрана проверка `actor_id` в `connect()` (принимать всех) | тест анонима краснеет | ✅ покраснели 4 теста отказа: аноним, blank-id, `X-User-Id`-при-JWT, просроченный токен |
| 3 | `group_name_for(actor)` → константа `"notif.shared"` | тест изоляции краснеет | ✅ покраснели оба теста доставки, включая `..._does_not_leak` |
| 4 | guard-the-guard AC-7 | сканер ловит синтетический сниппет | ✅ постоянный тест `test_scan_detects_orm_in_async`: ловит `bad_manager`+`bad_instance`, НЕ трогает обёрнутый/синхронный/`dict.get` варианты |

Первая редакция пробы №1 (подмена только `BACKEND`, с оставшимся `"CONFIG": {"hosts": [...]}`) давала `TypeError` на конструкторе слоя — мутация ловилась, но по неверной причине. Переделано на реалистичный конфиг, чтобы проверялось именно утверждение архитектуры, а не несовместимость kwargs.

**Гейт зелёный: `make gate` — 2262 passed, 56 deselected, «No changes detected», 59s** из бюджета 300s (NFR-8); `ruff check .` чист. Отдельно подтверждены AC-10: `core/test_isolation`, `notifications/test_isolation`, `operations/test_rbac_matrix`, `audit/test_audit_coverage` — 495 passed, новых строк в MATRIX/AUDIT_MATRIX нет (HTTP-роутов стори не добавляет). Фронт не затронут, `npm run gate` не гонялся.

**⚠️ Правка ВНЕ скоупа 11.1 — согласована с Bratan (AskUserQuestion, 2026-07-19).** На первом прогоне гейт был красным на `apps/core/tests/test_staffing_api.py::test_vacancies_endpoint` (`assert 0 == 1`).
*Пред-существование доказано эмпирически, а не рассуждением:* пять изменённых бэкенд-файлов возвращены к baseline (`git checkout` ПОСЛЕ `cp`-бэкапа), тест прогнан на чистом baseline-бэкенде — падает идентично; затем файлы восстановлены из бэкапа, `diff` с бэкапом — IDENTICAL.
*Механизм:* тест слал **UTC-дату** (`timezone.now().date()` = 2026-07-18), а эндпоинт резолвит `date` через `make_aware(combine(date, time.min))` в `Asia/Qyzylorda` → 2026-07-18 00:00+05 = 2026-07-17 19:00 UTC, что **раньше** `valid_from` (2026-07-17 21:59 UTC) → 0 строк. Окно срабатывания — 19:00–24:00 UTC (00:00–05:00 местного); прогон шёл в 02:59 местного. Это НЕ «свойство окружения» и НЕ флейк — детерминированный баг теста в этом окне.
*Фикс:* одна строка — `timezone.now().date()` → `Clock.today_local()` (+ импорт), т.е. порт уже обкатанного на другой ветке решения от 2026-07-10; на этой ветке фикса не было (последний коммит файла — `c5779d9 «2.8 story»`, worktree-дивергенция). `Clock.today_local()` — единственная легитимная точка чтения часов (ARCH-DATA-022).
*Проверка фикса — до/после на ОДНОМ И ТОМ ЖЕ моменте суток:* в 02:59 местного тест падал, в 03:09 местного (то же окно 00:00–05:00) после фикса — 5 passed. Wall-clock не менялся, значит зелёный даёт фикс, а не смена суток.
Файл добавлен в File List (13-й, MOD). Ревью: подтвердить, что правка чужого теста внутри 11.1 приемлема, либо вынести её отдельным коммитом.

**Открытые вопросы стори не закрывались** (это не скоуп 11.1): расхождение реестра `ws-message-types.yaml` с `Notification.Kind` блокирует 11.2; транспорт токена `?token=` требует входа в 12.1 (nginx не логирует `$args` на `/ws/`); `AllowedHostsOriginValidator` сознательно отложен в 12.1 (Решение №6) — оба зафиксированы комментариями в `config/asgi.py`, чтобы не потерялись как «просто не сделали».

**Для ретро E11:** `consumers.py`/`routing.py` отсутствуют в §Naming Patterns (architecture.md#L415) — имена каноничные для Channels, зафиксировать как расширение конвенции.

### File List

Сверено с `git diff --name-only 52e1c7d -- .` + `git ls-files --others --exclude-standard -- .`. **14 файлов (8 NEW + 6 MOD)** — 12 по плану спеки, плюс согласованная вне-скоупная правка `test_staffing_api.py` (см. Completion Notes), плюс `test_ws_e2e.py` QA-шага (test-summary-11-1.md; в File List внесён ревью — расхождение с git было находкой M1).

**NEW**
- `Backend/VAPS/config/asgi.py`
- `Backend/VAPS/apps/core/auth/ws.py`
- `Backend/VAPS/apps/notifications/groups.py`
- `Backend/VAPS/apps/notifications/consumers.py`
- `Backend/VAPS/apps/notifications/routing.py`
- `Backend/VAPS/apps/notifications/tests/test_ws_consumer.py`
- `Backend/VAPS/apps/notifications/tests/test_ws_guards.py`
- `Backend/VAPS/apps/notifications/tests/test_ws_e2e.py` — QA-шаг (bmad-qa-generate-e2e-tests), 10 тестов

**MOD**
- `Backend/VAPS/pyproject.toml`
- `Backend/VAPS/config/settings.py`
- `Backend/VAPS/apps/core/auth/authentication.py`
- `Backend/VAPS/docker-compose.yml`
- `Backend/VAPS/Makefile`
- `Backend/VAPS/apps/core/tests/test_staffing_api.py` — вне скоупа 11.1, согласовано с Bratan (порт tz-фикса, разблокировал гейт)

## Senior Developer Review (AI)

**Ревьюер:** Bratan (агент: Claude Fable 5 — cross-model к dev/QA на Opus 4.8, AI-2 ретро E9 соблюдён). **Дата:** 2026-07-19. **Вердикт: Approve** — 0 CRITICAL, 0 HIGH; 3 MEDIUM + 2 LOW найдены и исправлены на месте.

**Проверено против кода, не по чекбоксам** (память: дрейф чекбоксов dev-агента): все 10 AC сверены с raise-сайтами и тестами; каждый `[x]` Tasks 1–10 подтверждён в файлах; `test_jwt_authentication.py` не тронут (Task 3 ✓); красные пробы dev (4/4) и QA (5/5) выполнены на этой же сессии другой моделью — повторная проба ревью не требуется по гейту AI-1/AI-2. Гейт прогнан ревью дважды независимо: до фиксов 2299 passed / 66s, после — **2301 passed / 67s**, «No changes detected», ruff чист.

**Findings и что сделано:**

| # | Sev | Находка | Фикс |
|---|-----|---------|------|
| M1 | MEDIUM | File List (13 файлов) разошёлся с git: QA-шаг добавил `test_ws_e2e.py` и правил `_SENDER_SCRIPT`, Change Log без QA-записи (класс AI-3 ретро E9) | File List → 14 файлов (8 NEW + 6 MOD), Change Log дополнен записями QA и review |
| M2 | MEDIUM | `channel_layers_from_env`: `VAPS_REDIS_URL=""` (задана, но пуста) молча падала в дефолт-loopback, тогда как `"   "` давала `ImproperlyConfigured` — «молчаливая деградация», запрещённая буквой AC-2 (пустой секрет в проде → тихий коннект на 127.0.0.1) | `settings.py`: unset → дефолт, задана-но-пустая → `ImproperlyConfigured`; кейс `""` добавлен в `test_channel_layers_refuses_a_non_redis_url` |
| M3 | MEDIUM | Контракт `"notify.message"` жил хардкодом (наблюдение QA №3, отдано ревью): опечатка в 11.2 = крэш consumer'а в рантайме, а не ошибка сборки | `groups.py`: экспортирована `NOTIFY_MESSAGE_TYPE`; `_SENDER_SCRIPT` cross-process тестов шлёт через константу (ровно путь 11.2); новый гвард `test_notify_message_type_routes_to_an_existing_handler` пинит связку константа↔хендлер |
| L1 | LOW | Комментарий к `pytest-asyncio` в `pyproject.toml` утверждал «тестируется через channels.testing.WebsocketCommunicator» (противоречит решению Bratan об отказе от daphne) и снапшот «1.2.0» (установлен 1.4.0) | Комментарий исправлен: свой `WsCommunicator` поверх `asgiref.testing`, снапшот 1.4.0 |
| L2 | LOW | Change Log: «Тестов добавлено 22 (18+4)» — фактически 49 collected (32+17) до QA | Цифры исправлены в Change Log |

**Подтверждения ревью по явным запросам стори:** (1) вне-скоупная правка `test_staffing_api.py` — **принята в составе 11.1**: механизм бага и фикс `Clock.today_local()` совпадают с уже обкатанным решением (память: tz-флейк — баг теста, не окружения), пред-существование доказано dev-прогоном на чистом baseline; выносить отдельным коммитом не требуется, запись в Change Log есть. (2) Отклонение Task 8 (`WsCommunicator` вместо `WebsocketCommunicator`) — легально: решение Bratan от 2026-07-19, поведение подзадачи реализовано полностью. (3) Осознанное сужение гварда AC-7 (`self.<x>.save()` не ловится) — принято как задокументированная граница.

**Открытые вопросы стори не закрыты и не потеряны** (не скоуп ревью): реестр `ws-message-types.yaml` vs `Notification.Kind` — блокер 11.2; `?token=` в логах nginx и Origin-фильтр — входы 12.1; судьба `test-summary.md` (10.2 vs 11.1) — решение Bratan.

## Change Log

- **2026-07-19 — dev-story 11.1 (Opus 4.8).** WS-транспорт уведомлений: ASGI-вход с `ProtocolTypeRouter`, channel layer на `channels_redis` (бэкенд захардкожен, env задаёт только адрес), WS-identity в `core/auth/ws.py` с переиспользованием `verify_jwt_sub`, группа по sha256 от server-resolved `actor_id`, `NotificationConsumer` + routing, Redis в compose/гейте. Тестов добавлено 49 collected в двух модулях (32 consumer/доставка + 17 гвардов; изначальная запись «22» была ошибкой подсчёта — исправлено ревью). Красная проба — 4 из 4. `make gate` зелёный: 2262 passed, «No changes detected», 59s.
- **2026-07-19 — вне скоупа, согласовано.** `apps/core/tests/test_staffing_api.py::test_vacancies_endpoint`: `timezone.now().date()` → `Clock.today_local()`. Порт фикса от 2026-07-10, отсутствовавшего на этой ветке (worktree-дивергенция). Разблокировал гейт; пред-существование бага и работоспособность фикса доказаны прогонами (см. Completion Notes).
- **2026-07-19 — QA (bmad-qa-generate-e2e-tests, Opus 4.8).** NEW `test_ws_e2e.py` (+10 тестов: HTTP-ветка ASGI, near-miss пути, регистр заголовка, «злые» id против реального слоя, fan-out двух сокетов, точность ретрансляции) + фикс `_SENDER_SCRIPT` (payload с `false`/`null` ломал субпроцесс `NameError`). Красная проба QA — 5 из 5. Гейт: 2299 passed, 77s. Детали: `tests/test-summary-11-1.md`.
- **2026-07-19 — review (Fable 5, cross-model).** 0 CRITICAL / 0 HIGH / 3 MEDIUM / 2 LOW; все исправлены автоматически (см. Senior Developer Review). Гейт после фиксов: **2301 passed, 56 deselected, «No changes detected», 67s**; ruff чист. Status → done.
