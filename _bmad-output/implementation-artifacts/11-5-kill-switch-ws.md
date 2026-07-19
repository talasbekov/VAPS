---
baseline_commit: 8573b32 (HEAD, `feat(story-11.4)`). ⚠️ **Рабочее дерево НЕ чистое:** в нём идёт незакоммиченная фронт-стори 10.5 (`frontend/src/app/App.tsx`, `section-stubs.tsx`, `shared/api/client.ts` (+`getBlob`), `client.test.ts`, `testing/handlers.ts`, untracked `frontend/src/features/expense/`). **`Backend/**` при этом чист — проверено `git status --short -- Backend/` → пусто.** 11.5 бэковая целиком, поэтому пересечений с 10.5 нет ни одного файла. См. Git Intelligence.
baseline_tests: `cd Backend/VAPS && make gate` → **зелёный, 2373 passed, 56 deselected, 85 с** (бюджет 300 с, NFR-8). Замерено при создании стори на `8573b32`. Прирост числа тестов обязан совпасть с числом добавленных.
prerequisite: 11.1 (`done`) — транспорт, consumer, `CLOSE_UNAUTHENTICATED = 4403`; 11.2 (`done`) — `notify()` → `on_commit(partial(_publish, …))`; 11.4 (`done`) — потребитель на фронте. Все три в HEAD.
scope_note: **стори БЭКОВАЯ ЦЕЛИКОМ.** Фронтовая половина epic-AC («клиенты переходят на polling») вынесена в **11.5a** поимённо — правило декомпозиции проекта запрещает стори, смешивающую бэк и фронт (CLAUDE.md §Story Size Rules), а совместная стори тронула бы 11 файлов и оба гейта. Прецеденты того же спринта: 10.1a/10.2, 10.3a/10.4, 11.4a/11.4b. Порядок — 11.5 → 11.5a (AI-4 ретро E9: бэк-слой ДО фронт-стори).
context:
  - _bmad-output/planning-artifacts/epics.md#L1260-1266 (Story 11.5 — AC эпика)
  - _bmad-output/planning-artifacts/architecture.md#L56 («релизы переносом носителя → kill-switch-флаги в конфиге ОБЯЗАТЕЛЬНЫ, MTTR ≥ время доставки»), #L64 + #L327 («fallback на ручной refresh» — обе ранние формулировки, закрыты Решением №3), #L95 («СЕЙЧАС(6)»: kill-switch для WebSocket), #L338 («kill-switch-флаги (env/таблица) — отключение рисковой логики без редеплоя»), #L339 («конфиг — env, без веток кода по окружению»), #L459 (`group_send` только через `on_commit`)
  - _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md#L276 («WS деградирует в polling (kill-switch) … уведомление ВСЕГДА персистится в DB»)
  - _bmad-output/implementation-artifacts/11-1-channels-и-channels-redis.md (Решение №4 — `close(4403)` до `accept()`; WsCommunicator; гварды)
  - _bmad-output/implementation-artifacts/11-3-ws-клиент-с-reconnect.md#Открытые вопросы №1 (**адрес 11.5 назван прямо**: «браузерно-честный вариант — `accept()` → `close(…)`… Ревью: подтвердить адрес») + Решения №4/№5
  - _bmad-output/implementation-artifacts/11-2-публикация-в-ws-из-notify.md#Решение №5 («kill-switch НЕ реализуем здесь. Флаг — 11.5, с собственным тестом семантики отката»)
  - _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L72-83 (AI-1 красная проба = гейт; AI-3 сверка File List)
---

# Story 11.5: Kill-switch WS

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **разработчик, обслуживающий закрытый контур**,
I want **конфигурационный флаг, который отключает WebSocket-путь целиком: consumer перестаёт принимать соединения (закрывая их различимым кодом), а `notify()` перестаёт трогать channel layer — при том что уведомления продолжают писаться в БД и читаться по REST**,
so that **рисковая инфраструктура (Channels + Redis) гасится перезапуском контейнера с изменённым env, а не переносом носителя с новым образом (architecture.md#L56: MTTR kill-switch'а обязан быть меньше времени доставки релиза)**.

## Acceptance Criteria

Источник: epics.md#L1260-1266 (Story 11.5 AC); architecture.md#L56/#L64/#L95/#L327/#L338/#L339/#L459; EXPERIENCE.md#L276; 11.2 Решение №5 («флаг — 11.5, с собственным тестом семантики отката»); 11.3 Открытый вопрос №1 (адрес правки consumer'а).

**AC-0 · ГРАНИЦА И НОСИТЕЛЬ ФЛАГА — ОБРАТНЫЙ ГЕЙТ (проверить ПЕРВЫМ, до единой строки кода).**
**Given** рабочее дерево, **When** выполнено `git status --short -- Backend/`, **Then** вывод **пуст** (незакоммиченная 10.5 — фронтовая; если в `Backend/` появился чужой код — остановиться и разобраться, а не собирать File List поимённо).
**Носитель флага — env-переменная, и это решено, а не оставлено на вкус (Решение №1).** Таблица `SubmissionControlSettings` (`apps/operations/submissions/models/control_settings.py:9`) существует и Admin-редактируема, но живёт в домене сдачи; чтение её из `notifications` инвертировало бы границу «notifications ← все» (`consumers.py:5-6`, architecture.md#L592) и втащило бы ORM в consumer, запрещённый там гвардом `test_ws_guards.py:240`. Эндпоинта конфигурации на бэке **НЕ СУЩЕСТВУЕТ** (проверено grep по всем `urls.py`: `/api/config/`, `/api/version/`, health — нет ни одного), и заводить его в этой стори **запрещено**: новый роут = регенерация `schema.yaml`/`schema.d.ts` + запись в fail-closed RBAC-матрицу + `@extend_schema`, то есть другая стори.
**Если по ходу работы возникает потребность тронуть `frontend/**` — ОСТАНОВИТЬСЯ и эскалировать.** Адрес фронтовой половины — **11.5a**, заведена в `sprint-status.yaml`.

1. **AC-1 · Флаг `VAPS_WS_ENABLED` в `config/settings.py`; дефолт — ВКЛЮЧЁН.**
   Форма — дословный канон проекта, третий экземпляр одного и того же паттерна: `VAPS_WS_ENABLED = os.environ.get("VAPS_WS_ENABLED", "1") == "1"` (зеркало `VAPS_XACCEL_ENABLED`, `settings.py:292`, и `DEBUG`, `settings.py:9`). **Копировать именно эти две формы** — `AUTO_GENERATE_PERSONNEL_NUMBER` (`settings.py:152-154`) использует другой литерал (`"false"`/`== "true"`) и образцом здесь не является. Парсер-функцию (`*_from_env`) **не заводить** — она оправдана только для нетривиального разбора (`jwt_config_from_env`, `max_upload_mb_from_env`, `channel_layers_from_env`); булев флаг разбора не требует.
   **🔴 Дефолт обязан быть `"1"`, и это не стилистика.** Две независимые причины: (а) прод-дефолт фичи — «включено», выключение обязано быть явным действием администратора; (б) `make gate` (`Makefile:95-101`) экспортирует `VAPS_DB*`/`VAPS_REDIS_URL` и **не экспортирует** `VAPS_WS_ENABLED` — значит дефолт есть единственное, что задаёт состояние всего WS-сьюта. Дефолт `"0"` увёл бы `test_ws_consumer.py`/`test_ws_notify.py`/`test_ws_e2e.py` в **красное** (не в «молча зелёное»: закрытый сразу после accept сокет отдаёт `websocket.close` там, где delivery-тест ждёт `websocket.send`, и `WsCommunicator.receive_json_from` падает на своём ассерте, `test_ws_consumer.py:113`). Выключенное состояние проверяется **только** через `override_settings`, никогда через окружение гейта.
   Ветвление по `if DEBUG` **ЗАПРЕЩЕНО** — architecture.md#L339 и комментарий-канон `settings.py:256` («Переключение отдачи — env-флаг, НЕ `if DEBUG`»).
2. **AC-2 · Consumer при выключенном флаге: `accept()`, ЗАТЕМ `close(CLOSE_WS_DISABLED)` — именно в таком порядке (ЯДРО СТОРИ).**
   Given `VAPS_WS_ENABLED = False`, When приходит соединение **с валидной identity**, Then consumer вызывает `accept()` и сразу за ним `close(code=CLOSE_WS_DISABLED)`, **не вызывая `group_add`**. Новая константа рядом с существующей: `CLOSE_WS_DISABLED = 4503` (приватный диапазон 4000-4999, зеркалит HTTP 503 ровно так же, как `CLOSE_UNAUTHENTICATED = 4403` зеркалит 403 — `consumers.py:37-41`).
   **🔴 Почему НЕ `close()` до `accept()`, как сделано для анонима.** Это не копия соседней ветки и не небрежность — это ровно та правка, чей адрес 11.3 назвала поимённо (её Открытый вопрос №1: «браузерно-честный вариант — `accept()` → `close(…)`… адрес: 11.5, когда consumer всё равно правится под kill-switch»). ASGI-контракт: `websocket.close` **до** `websocket.accept` предписывает серверу ответить HTTP 403, рукопожатие не завершается, и браузер получает `CloseEvent{code: 1006}` — приватный код на провод **не выходит вовсе** (доказано в 11.3 Решение №4 и зафиксировано в `notificationsSocket.ts:15-18`). Отказ до `accept()` был бы для клиента неотличим от обрыва сети → бесконечный backoff в никуда → «нет связи» в шапке при живых уведомлениях по REST. То есть epic-AC «**молчаливый** переход на polling» технически недостижим без accept-then-close. После `accept()` соединение установлено, и close-фрейм несёт код честно: `CloseEvent{code: 4503, wasClean: true}`.
   **Обоснование в коде — обязательный `#`-комментарий над константой** (почему 4503 и почему после accept), потому что следующий читатель увидит рядом ветку-антипример.
3. **AC-3 · Порядок проверок в `connect()`: identity ПЕРВЫМ, флаг ВТОРЫМ — и это запинено отдельным тестом.**
   Given `VAPS_WS_ENABLED = False` **и** соединение **без** identity, Then поведение **не меняется**: `close(4403)` **до** `accept()`, ровно как сегодня. Неаутентифицированный сокет не принимается **никогда** — иначе kill-switch стал бы дырой в контроле доступа, а **шесть** тестов 11.1, ассертящих `code == 4403` (`test_ws_consumer.py:141, 160, 185, 197, 208, 220` — аноним, blank-id, `X-User-Id`-при-JWT, `?user_id=`-при-JWT, просроченный токен, чужая подпись), покраснели бы, и «починка» их под новый порядок была бы молчаливой отменой AC-4 стори 11.1.
   Наивная реализация ставит дешёвую проверку флага первой — **этот тест существует именно против неё**.
4. **AC-4 · `_publish()` при выключенном флаге не приобретает channel layer вовсе.**
   Given `VAPS_WS_ENABLED = False`, When `notify()` создал строку и `on_commit` дошёл до `_publish`, Then функция выходит **до** `get_channel_layer()` — то есть `group_send` не вызывается, Redis не трогается, соединение к нему не открывается. Гард — **первым оператором тела `_publish`, до `try`** (`services.py:88`): смысл kill-switch'а в том, чтобы не касаться рисковой инфраструктуры, а не в том, чтобы аккуратно проглотить её отказ (проглатывание уже есть — `except Exception` + `logger.exception`, `:124-134`).
   **🔴 `group_send` обязан остаться лексически внутри `_publish`, а `_publish` — объектом, переданным в `transaction.on_commit(partial(...))`** (`services.py:188`). AST-гвард `test_ws_guards.py:563` `test_group_send_only_inside_on_commit` **называет 11.5 поимённо** в докстринге («11.4 (mark-as-read) and **11.5 (kill-switch)** add more senders»). Форма `on_commit(lambda: ...)` гвард **не проходит** (`:594-619`). Ранний `return` внутри `_publish` гвард не задевает — проверить прогоном, а не рассуждением.
   Лог при выключенном флаге — **тишина или один `logger.debug`**, но **не** `warning`/`exception`: выключенный по решению администратора канал не является ошибкой, а `notify()` вызывается по расписанию catch-up'а и зальёт журнал. **ПДн в лог не писать** (не `recipient`, не `payload` — канон 11.2/11.3).
5. **AC-5 · Строка в БД пишется ВСЕГДА; возвращаемое значение `notify()` не меняется.**
   Given `VAPS_WS_ENABLED = False`, When вызван `notify(...)`, Then `Notification` создан и `notify()` вернул его (не `None`). EXPERIENCE.md#L276 — «уведомление **всегда** персистится в DB»; architecture.md#L327 — «событие в БД — истина, WS — сигнал».
   **🔴 Почему это отдельный AC, а не очевидность:** `lagging_check._emit_lagging` читает `None` как «нотис не сохранился» → `LaggingNotifyError` → **catch-up останавливается** (докблок `services.py:75-80`). Флаг, уронивший `notify()` в `None`, превратил бы отключение СИГНАЛА в остановку БИЗНЕС-операции. Сигнатуру и тело `notify()` (`services.py:137-201`) стори **не трогает вовсе** — весь гард живёт в `_publish`.
6. **AC-6 · Бэк-половина «состояния консистентно» (epic-AC «тест отката»): REST-чтение флагом не затронуто.**
   Given `VAPS_WS_ENABLED = False` и накопленные уведомления, When `GET /api/notifications/`, Then ответ идентичен ответу при включённом флаге: те же строки, тот же порядок `-created_at, id`, та же LimitOffset-пагинация. Это и есть «выключили посреди дня → консистентное читаемое состояние» в той части, которую вообще можно проверить на бэке; фронтовая половина (клиент реально перешёл на polling) — **11.5a**.
   `views.py`/`selectors.py`/`serializers.py`/`api/urls.py` при этом **не правятся ни на строку** — тест доказывает независимость, а не реализует её.
7. **AC-7 · Существующие гварды переживают правку — проверено прогоном, не рассуждением.**
   - `test_ws_guards.py:563` `test_group_send_only_inside_on_commit` — AC-4;
   - `test_ws_guards.py:484` `test_ws_tests_are_never_skipped` — AST-скан `TESTS_DIR.glob("test_ws_*.py")` на `skip`/`skipif`/`importorskip`. **Новый тест-файл обязан называться `test_ws_kill_switch.py`** (иначе он выпадает из-под гварда) и **не имеет права скипаться** ни при каких условиях;
   - `test_ws_guards.py:148` `test_in_memory_channel_layer_is_absent_from_config` — 🔴 **AST-скан строковых констант под `config/**` на литерал `InMemoryChannelLayer`**. Если пояснение к флагу в `settings.py` понадобится написать со словом «in-memory», оно обязано жить в `#`-комментарии, **не в докстринге и не в строке** — иначе гвард краснеет на безобидном тексте (`:149-153`);
   - `test_ws_guards.py:240` `test_consumers_use_database_sync_to_async` — форвард-защита: ORM в consumer запрещён. Флаг читается из `django.conf.settings`, ORM не привлекается вовсе;
   - `test_ws_guards.py:344` `test_gate_starts_redis_and_points_the_suite_at_it` — сверяет `docker-compose.yml` с `Makefile` регулярками. **`Makefile` и `docker-compose.yml` стори НЕ трогает** (AC-8).
8. **AC-8 · Границы — что НЕ входит.**
   **НЕ трогаем:** `frontend/**` целиком (**11.5a**; любая правка фронта = скоуп поехал, остановиться и эскалировать); `apps/notifications/api/**`, `selectors.py`, `models.py`, `groups.py`, `routing.py`, `config/asgi.py`, `apps/core/auth/ws.py` (транспорт и чтение закрыты 11.1/5.7c); `Makefile`, `docker-compose.yml`, `pyproject.toml` (**прод-обвязка флага — 12.1**: env в прод-compose, nginx, uvicorn); `schema.yaml`/`schema.d.ts` (**HTTP-поверхность не менялась, WS вне OpenAPI — regen ЗАПРЕЩЁН**, drift-тест в гейте сравнивает байт-в-байт).
   **НЕ делаем:** клиентскую ветку по close-коду, `refetchInterval`, статус «WS отключён» в `ConnectionIndicator` (**11.5a**); конверсию `CLOSE_UNAUTHENTICATED` в accept-then-close (**Решение №4** — отдельная стори, меняет запиненное поведение 11.1); эндпоинт конфигурации `/api/config/` (AC-0); Playwright-сценарий «kill-switch прячет фичу» (architecture.md#L259, сценарий №5 из лимита 5 — **12.x**, после 11.5a); отметку прочтения (**11.4a/11.4b**); флаг для любой другой рисковой логики (стори про WS).
   **Моделей и полей стори не добавляет** → `manage.py makemigrations --check --dry-run` обязан остаться пустым. **Новых зависимостей НОЛЬ** — `pyproject.toml` в диффе быть не должно.
9. **AC-9 · Тесты — все в одном новом файле, детерминированные, с дискриминирующими парами.**
   `Backend/VAPS/apps/notifications/tests/test_ws_kill_switch.py` (NEW) — вся стори тестируется здесь; два 500-строчных соседа (`test_ws_consumer.py`, `test_ws_notify.py`) **не правятся**, что делает дифф читаемым и позволяет удалить флаг одним файлом, если он когда-нибудь уйдёт.
   Переиспользование — **прямым импортом из тестового модуля** (канон проекта, `test_ws_e2e.py:31-35`, `test_ws_notify.py:61`): `from apps.notifications.tests.test_ws_consumer import _communicator`. Копировать `WsCommunicator` **запрещено** — мотивировка «две расходящиеся копии «как водить сокет»» записана в `test_ws_e2e.py:18-20`.
   **Каждый ассерт — дискриминирующей парой** (флаг включён / выключен) в одном тесте или в двух соседних: «при выключенном не отправилось» в одиночку зелено и на сломанном коде, который не отправляет никогда.
   `asyncio_mode = "strict"` (`pyproject.toml:76`) → **каждый async-тест несёт явный `@pytest.mark.asyncio`**. Consumer-тесты — **без `django_db`** (consumer не касается ORM; смешивать async с DB-фикстурами — боль без выгоды, `test_ws_consumer.py:3-5`). `notify()`-тесты — синхронные, с `django_db` и `django_capture_on_commit_callbacks(execute=True)` (образец `test_ws_notify.py:357-384`).
   **🔴 Механизмов подмены ДВА, и они не взаимозаменяемы — перепутать значит написать вечнозелёный тест.**
   - **Для `_publish`-тестов (AC-4/AC-5)** — подменять **имя, связанное в `services` при импорте**: `monkeypatch.setattr("apps.notifications.services.get_channel_layer", …)`. Причина в `test_ws_notify.py:113-118`: `services.py` сделал `from channels.layers import get_channel_layer`, поэтому патчить `channels.layers` бесполезно.
   - **Для consumer-теста (`group_add`)** — наоборот: consumer берёт слой **не из `services`**, а сам, через `channels.consumer` (`self.channel_layer = get_channel_layer(self.channel_layer_alias)`). Подмена имени в `services` до него не достаёт, и тест «`group_add` не вызывался» был бы зелёным **всегда, при любом флаге**. Правильно — шпион на методе кэшированного синглтона: `layer = get_channel_layer(); real = layer.group_add; monkeypatch.setattr(layer, "group_add", spy)`, где `spy` — корутина, пишущая вызов в список и делегирующая в `real`.
   Записывающий фейк — **свой, локальный**: `_ExplodingChannelLayer`/`_explode` (`test_ws_notify.py:95-121`) доказывают «отказ не фатален», а здесь нужно «вызова не было вовсе» — другой инструмент.
   **🔴 `group_send`/`group_add` фейка обязаны быть настоящими корутинами (`async def`), не `Mock`/`lambda`** — `async_to_sync` тайп-чекает аргумент и кидает `TypeError` **до** вызова (`test_ws_notify.py:98-100`), превращая «слой не позвали» в «тест до слоя не дошёл».
   **Форма `override_settings` — `with` внутри тела теста**, не декоратор: канон проекта для async-тестов (`test_ws_consumer.py:177, 188, 198`).
   Обязательный минимум:
   - `test_ws_disabled_accepts_then_closes_with_the_disabled_code` — `override_settings(VAPS_WS_ENABLED=False)`; `await communicator.connect()` → `(True, None)` (**принят**), затем `await communicator.receive_output()` → `{"type": "websocket.close", "code": 4503}`. **Харнесс править не нужно:** `WsCommunicator.connect()` возвращает по первому выходному сообщению (`test_ws_consumer.py:102-109`), а `receive_output` унаследован от `ApplicationCommunicator`;
   - `test_ws_enabled_still_accepts_and_stays_open` — та же пара с `VAPS_WS_ENABLED=True` → принят и close-фрейма нет (`receive_nothing`). **🔴 Этот тест ОБЯЗАН ассертить отсутствие close-фрейма, а не `connected is True`:** после accept-then-close `connect()` возвращает `(True, None)` **в обоих** состояниях флага, то есть голый `assert connected is True` (форма `test_ws_consumer.py:133`) перестаёт быть дискриминирующим ассертом вообще;
   - `test_ws_disabled_never_joins_a_group` — шпион на `group_add` синглтона слоя (см. выше); при выключенном флаге вызовов ноль, при включённом — ровно один. **Формулировка «kill-switch не касается Redis» здесь НЕВЕРНА и в тест не переносится:** `channels/consumer.py:44-49` вызывает `new_channel()` на слое **до** `connect()`, безусловно; флаг пропускает только вступление в группу. «Redis не трогается» верно **только** для `_publish` (AC-4);
   - **🔴 `test_anonymous_is_still_refused_before_accept_when_ws_disabled`** — флаг выключен, identity нет → `(False, 4403)`, то есть **не принят** (AC-3);
   - `test_disabled_flag_writes_the_row_and_publishes_nothing` — дискриминирующая пара: флаг выключен → `Notification` создан **и** записей в слое ноль; флаг включён → та же строка **и** ровно одна запись;
   - `test_disabled_flag_does_not_acquire_the_channel_layer` — `get_channel_layer` подменён на функцию, которая **падает при вызове**; при выключенном флаге тест проходит (значит не вызывалась), при включённом — ловим падение как контроль (AC-4);
   - `test_notify_still_returns_the_row_when_ws_is_disabled` — возврат не `None` (AC-5, защита catch-up'а);
   - `test_read_api_is_unaffected_by_the_flag` — список из `GET /api/notifications/` идентичен при обоих значениях флага (AC-6). Харнесс — образец `test_notifications_read_api.py`: `reverse("notification-list")` (`:34-36`) и `_client()` с `HTTP_X_USER_ID` (`:53-57`), `pytestmark = pytest.mark.django_db`.
10. **AC-10 · Гейт зелёный, регресс нулевой.**
    `cd Backend/VAPS && make gate` зелёный целиком: `ruff check .` (select = `E,F`, `pyproject.toml:85-89`) → `pytest -m "not property and not concurrency and not slow and not golden"` → `makemigrations --check --dry-run` (**обязан сказать `No changes detected`**).
    **Baseline для сверки: 2373 passed / 56 deselected / 85 с** (замер на `8573b32` при создании стори). Прирост числа тестов обязан совпасть с числом добавленных. Отдельно подтвердить зелёными **без единой правки**: `test_ws_consumer.py`, `test_ws_notify.py`, `test_ws_e2e.py`, `test_ws_guards.py`, `test_notify.py`, `test_notifications_read_api.py`.
    **🔴 `WsCommunicator` править ЗАПРЕЩЕНО** (он и не нужен — Ловушка 7): его импортируют `test_ws_e2e.py:31-35` и `test_ws_notify.py:61`, так что одна правка харнесса ломает три файла разом. Если кажется, что харнесс надо доработать под accept-then-close — это находка для ревью, а не задача.
    `npm run gate` фронта **не гонять** — `frontend/**` не тронут (и в дереве лежит чужая незакоммиченная 10.5, чей гейт к этой стори отношения не имеет). `graphify update .` **нужен** — стори меняет `Backend/VAPS/apps/notifications`; отдельным `chore`-коммитом после ревью.
11. **AC-11 · Красная проба — гейт, а не намерение (AI-1 ретро E9).**
    Минимум **восемь** мутаций по таблице в Dev Notes; для каждой в Dev Agent Record построчно: мутация → какой тест покраснел. Зелёная проба = ассерт вакуумен = стори **не** `done`. Бэкап файлов — `cp` в скретчпад; **`git checkout` ЗАПРЕЩЁН** (урок 9.6: стирает незакоммиченные ревью-правки — а в этом дереве ещё и чужую 10.5). После восстановления `diff` → IDENTICAL и гейт зелёный повторно.

## Tasks / Subtasks

- [x] **Task 0 — Обратный гейт границы** (AC: 0)
  - [x] `git status --short -- Backend/` → пусто. Зафиксировать вывод в Debug Log. Если не пусто — ОСТАНОВИТЬСЯ.
  - [x] Зафиксировать baseline: `cd Backend/VAPS && make gate` → записать число passed/deselected (ожидание **2373 / 56**). Расхождение с baseline **до** правок = разбираться, а не продолжать.
  - [x] Принять как данность: `frontend/**` в этой стори не открывается. Адрес фронта — 11.5a.
- [x] **Task 1 — Флаг в настройках** (`Backend/VAPS/config/settings.py`, MOD) (AC: 1)
  - [x] Рядом с блоком X-Accel (`:290-293`) добавить `VAPS_WS_ENABLED = os.environ.get("VAPS_WS_ENABLED", "1") == "1"` с `#`-комментарием: назначение (kill-switch WS, architecture.md#L56/#L338), почему дефолт `1`, и что выключение требует перезапуска контейнера — не редеплоя.
  - [x] **Никаких `InMemoryChannelLayer` в строках/докстрингах под `config/`** (гвард `test_ws_guards.py:148`) — только `#`-комментарии.
  - [x] Парсер-функцию не заводить (AC-1).
- [x] **Task 2 — Отказ consumer'а** (`Backend/VAPS/apps/notifications/consumers.py`, MOD) (AC: 2, 3)
  - [x] Константа `CLOSE_WS_DISABLED = 4503` рядом с `CLOSE_UNAUTHENTICATED` (`:41`) + `#`-комментарий: зеркало 503, и **почему после `accept()`, а не до** (ASGI: close до accept → HTTP 403 → браузер видит 1006; ссылка на 11.3 Решение №4).
  - [x] В `connect()` (`:55-63`) — вторая ветка **строго после** проверки `actor`: `if not settings.VAPS_WS_ENABLED: await self.accept(); await self.close(code=CLOSE_WS_DISABLED); return`. **До `group_add`.**
  - [x] Импорт `from django.conf import settings`. Флаг читать **через `settings.`**, не копировать в модульную константу — иначе `override_settings` в тестах не подействует и тест окажется вакуумным.
  - [x] `disconnect()` не трогать: `getattr(self, "group", None)` (`:68`) уже корректно обрабатывает путь без `group_add` — проверить, что это так, и не «чинить».
- [x] **Task 3 — Молчание `_publish`** (`Backend/VAPS/apps/notifications/services.py`, MOD) (AC: 4, 5)
  - [x] Первым оператором тела `_publish` (`:63`, **до `try` на `:88`**): `if not settings.VAPS_WS_ENABLED: return`. Импорт `from django.conf import settings`.
  - [x] Дополнить докстринг `_publish` абзацем про kill-switch (это не строковая константа под `config/` — гвард `:148` сюда не смотрит).
  - [x] **`notify()` (`:137-201`) не трогать ни на строку** — включая `transaction.on_commit(partial(_publish, notification))` на `:188` (AC-4, гвард `test_ws_guards.py:563`).
  - [x] Лог: тишина либо один `debug` без ПДн (AC-4).
- [x] **Task 4 — Тесты** (`Backend/VAPS/apps/notifications/tests/test_ws_kill_switch.py`, NEW) (AC: 2–6, 9)
  - [x] Имя файла — строго `test_ws_kill_switch.py` (гвард `test_ws_guards.py:484` ловит по `test_ws_*.py`); **ни одного `skip`/`skipif`/`importorskip`**.
  - [x] `from apps.notifications.tests.test_ws_consumer import _communicator` — не копировать харнесс.
  - [x] Локальный записывающий слой (`group_send`/`group_add` копят вызовы) + подмена `apps.notifications.services.get_channel_layer` через `monkeypatch`.
  - [x] Восемь тестов из AC-9, каждый — дискриминирующей парой значений флага.
  - [x] Async-тесты: `@pytest.mark.asyncio`, без `django_db`, `await communicator.disconnect()` в каждом (утечка соединений между тестами = флейк — урок 11.1).
  - [x] `notify()`-тесты: `django_db` + `django_capture_on_commit_callbacks(execute=True)` (образец `test_ws_notify.py:357-384`).
  - [x] Кириллица — в телах фикстур; `recipient` для WS-identity — **ASCII** (нелатиница в `X-User-Id` отклоняется до сети — находка 11.3).
- [x] **Task 5 — Гейт и красная проба** (AC: 10, 11)
  - [x] `cd Backend/VAPS && make gate` — зелёный целиком; зафиксировать passed/deselected и сверить прирост с числом добавленных тестов.
  - [x] `makemigrations --check --dry-run` → `No changes detected`.
  - [x] `git diff --name-only` обязан показать **ровно четыре** пути (три MOD + один NEW) и **ни одного** под `frontend/`, `Makefile`, `docker-compose.yml`, `pyproject.toml`, `schema.yaml` (AC-8).
  - [x] **Красная проба — минимум 8 мутаций** по таблице. Бэкап `cp` в скретчпад; `git checkout` ЗАПРЕЩЁН. Якорь каждой мутации проверять на уникальность (`grep -c` == 1). После восстановления `diff` → IDENTICAL, гейт зелёный повторно.
  - [x] Сверить File List с `git status --short -- Backend/` **до** ревью (AI-3 ретро E9).

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; менять осознанно)

> **№1 = A (носитель флага — env `VAPS_WS_ENABLED`, НЕ таблица и НЕ эндпоинт).**
> architecture.md#L338 оставляет выбор открытым («env/таблица»), поэтому решение принимается здесь явно.
> **Почему не таблица.** Единственная существующая таблица настроек — `SubmissionControlSettings` (`apps/operations/submissions/models/control_settings.py:9`, singleton + Admin + seed миграцией). Она в домене сдачи (FR-13/18/39); чтение её из `notifications` инвертирует границу «notifications ← все» (`consumers.py:5-6`) и требует ORM **внутри consumer'а**, где он запрещён (`test_ws_guards.py:240`, AC-7 стори 11.1) — обход через `database_sync_to_async` возможен, но покупает удар по каждому хендшейку ради флага, который меняют раз в год.
> **Почему не эндпоинт.** `/api/config/` не существует; его заведение = новый роут + `@extend_schema` + regen `schema.yaml`/`schema.d.ts` + запись в fail-closed RBAC-матрицу. Это отдельная стори, и она не нужна: клиент узнаёт состояние из close-кода (Решение №2), не тратя запрос.
> **Почему env достаточен для «посреди дня».** Смена env + `docker compose up -d` перезапускает контейнер — это **не редеплой** (редеплой в этом проекте = перенос носителя с новым образом, architecture.md#L338). Перезапуск рвёт все сокеты, клиенты реконнектятся и получают отказ — то есть epic-AC «флаг выключен посреди дня → клиенты переходят» исполняется **механикой перезапуска**, дополнительной машинерии не требуется. Прецедент один в один: `VAPS_XACCEL_ENABLED` (`settings.py:292`) — тот же класс задачи (выключить рискованную инфраструктуру, откатиться на деградированный путь) тем же способом.

> **№2 = A (`accept()` → `close(4503)`; отказ ДО `accept()` не годится). ⚠️ ЭТО ОТМЕНА ОЧЕВИДНОГО ДИЗАЙНА — читать целиком.**
> Напрашивается копия соседней ветки: `await self.close(code=…)` без `accept()`, как для анонима (`consumers.py:55-60`). **Это дало бы неработающий kill-switch,** и доказательство лежит в предыдущей стори, а не в рассуждении.
> 11.3 Решение №4: ASGI-контракт для `websocket.close` **до** `websocket.accept` предписывает серверу ответить **HTTP 403**; WS-рукопожатие не завершается, браузер получает `CloseEvent{code: 1006, wasClean: false}`, и приватный код на провод **не выходит**. `4403` видят только Python-тесты, чей `WsCommunicator` читает ASGI-сообщения напрямую. Именно поэтому клиент 11.3 **не содержит ветки по `event.code`** — она была бы зелёной на фейке и мёртвой в проде.
> Следствие для 11.5: отказ до `accept()` неотличим для клиента от обрыва сети → вечный backoff (потолок 30 с, ~2 попытки в минуту на клиента) + постоянное «Нет связи с сервером» в шапке (`ConnectionIndicator.tsx:42` рендерит при `reconnecting`) при том, что уведомления исправно идут по REST. Это прямая противоположность epic-AC «**молчаливый** переход на polling».
> **11.3 сама назвала адрес этой правки:** её Открытый вопрос №1 — «браузерно-честный вариант — `accept()` → `close(…)` в `NotificationConsumer`… **адрес: 11.5 (когда consumer всё равно правится под kill-switch)** или 12.1. **Ревью: подтвердить адрес.**» Здесь адрес подтверждается и исполняется — для kill-switch-кода.
> **Возражение «11.1 отвергла accept-then-…» снимается точностью формулировки.** `consumers.py:37-40` отвергает «accepting-then-**staying-silent**» — принять и молчать. Здесь close следует за accept немедленно; молчания нет ни мгновения, клиент получает однозначный ответ. Мотивировка 11.1 («клиент не отличит «нет прав» от «нет событий»») этой веткой не нарушается, а исполняется.
> **Цена, названная честно:** клиент на мгновение увидит `open` (статус `online`, SEED-дочитка `limit=1`) до прихода close-фрейма. Один тик, один дешёвый запрос на сессию. Разбор этого мигания — задача **11.5a**, и она внесена в её описание, чтобы не всплыть сюрпризом.
> **Смежное расхождение, снимаемое здесь заранее (ревью упрётся, если не проговорить).** EXPERIENCE.md#L276 полностью: «WS деградирует в polling (kill-switch) **с индикатором «нет связи»**». Буквальное исполнение противоречит epic-AC «**молчаливый** переход»: `ConnectionIndicator` показывает `CONNECTION_LOST_TEXT = 'Нет связи с сервером'` (`frontend/src/shared/ui/ConnectionIndicator.tsx:19,42`), а связь с сервером есть — уведомления идут по REST. Красный индикатор при работающей доставке — ложь, которая приучает оператора его игнорировать. **Разведение:** обрыв сети → «нет связи» (как сегодня); kill-switch → отдельное, спокойное состояние либо молчание. Решение и его форма — **11.5a** (AC-8); 11.5 фиксирует, что буква UX-спеки здесь не исполняется дословно, и это сознательно.

> **№3 = A (fallback = polling, спор «ручной refresh vs polling» закрывается здесь). ⚠️ Это решение унаследовано тремя сторями и обязано быть принято именно в 11.5.**
> Расхождение зафиксировано трижды с адресом «решить к 11.5» (11.1:155, 11.2:174, 11.4:263). Счёт источников честный: **polling** — epics.md#L1262 и #L1266 (буква AC **этой** стори) и EXPERIENCE.md#L276 («WS деградирует в polling»); **ручной refresh** — architecture.md **#L64 и #L327**, то есть дважды, а не однажды.
> **Принимается polling**, и обоснование — не арифметика голосов. Эпик и UX-спека адресованы **этой фиче** и написаны позже; #L64/#L327 — ранние формулировки того же архитектурного документа, зафиксированные до того, как у центра уведомлений появился штатный REST-запрос. Содержательный довод: «ручной refresh» означает, что оператор узнаёт о событии, только если догадается нажать F5 — при выключенном по решению админа канале это деградация не в «медленнее», а в «никак», тогда как REST-список уже существует и читается тем же ключом. Цена polling'а — один запрос в интервал на вкладку, и она измерима.
> **⚠️ Не опираться на architecture.md#L466** («WS-уведомление — ускоритель, поллинг — истина»): эта строка про `AsyncJob`/долгие операции (сам механизм DEFERRED, ARCH-DEFERRED-048), а не про уведомления — аргументом здесь она не является, хотя выглядит подходящей.
> **Реализация polling'а — НЕ в этой стори** (`refetchInterval` в `useNotificationsFeed.ts:129-136` по образцу `TRAFFIC_LIGHT_POLL_MS`, `TrafficLightTreePage.tsx:43`) — **11.5a**. 11.5 фиксирует решение и отдаёт клиенту различимый сигнал, на котором polling включается.

> **№4 = A (конверсию `CLOSE_UNAUTHENTICATED` в accept-then-close 11.5 НЕ делает).**
> Соблазн: consumer всё равно правится, а 11.3 просила «подтвердить адрес» именно для 4403 — почему не заодно? Отвергается по трём причинам.
> (1) **Это другое изменение поведения.** 4403 сегодня отказывает **до** accept, то есть неаутентифицированный сокет не принимается никогда. Конверсия означала бы принимать соединение от неразрешённого пира — пусть на миллисекунды. Это решение уровня безопасности, ему нужна своя стори и своё ревью, а не строчка в диффе про флаг.
> (2) **Оно запинено шестью тестами 11.1** (`test_ws_consumer.py:141, 160, 185, 197, 208, 220`) и её AC-4. Правка «заодно» переписала бы чужие ассерты — ровно тот дрейф, против которого AI-3 ретро E9.
> (3) **Пользы до 11.5a нет.** Клиент кодов не читает вовсе; браузерно-честный 4403 без клиентской ветки ничего не меняет.
> **Адрес подтверждается как «отдельная стори после 11.5a»** (когда клиент уже умеет читать коды и выгода станет измеримой) — записано в Открытые вопросы №1. 11.5 при этом **прокладывает паттерн**: accept-then-close с приватным кодом теперь есть в кодовой базе и обоснован комментарием.

> **№5 = A (`4503` как номер; проверка — через `settings.`, не через модульную константу).**
> Приватный диапазон 4000-4999; `4503` зеркалит HTTP 503 «сервис недоступен» ровно так же, как `4403` зеркалит 403 (`consumers.py:37-41`) — конвенция уже заведена 11.1, стори её продолжает, а не изобретает вторую.
> **Читать `settings.VAPS_WS_ENABLED` в момент вызова**, а не копировать в модульную константу при импорте: `override_settings` подменяет атрибут объекта настроек, и модульная копия его не увидит — тест выключенного состояния оказался бы вакуумным (зелёным при любом коде). Тот же класс, что «формула обязана читать `RECONNECT_FACTOR`, а не литеральную двойку» (11.3 AC-4).

### Архитектурные правила (developer guardrails)

- **Конфиг — env, без веток по окружению** (architecture.md#L339, канон-комментарий `settings.py:256`). `if DEBUG` для флага запрещён.
- **Слои.** `notifications ↛ apps.core.models` — AST-гвард `apps/notifications/tests/test_isolation.py`. Флаг из `django.conf.settings` границ не пересекает вовсе.
- **`group_send` — только через `transaction.on_commit`** (architecture.md#L459), форма `partial(_publish, notification)`; гвард `test_ws_guards.py:563` назвал 11.5 поимённо.
- **ORM в consumer запрещён** (11.1 AC-7, гвард `test_ws_guards.py:240`) — ещё одно основание Решения №1.
- **Best-effort контракт WS** (architecture.md#L327): событие в БД — истина, WS — сигнал «обнови». Kill-switch гасит сигнал, не истину.
- **Логи.** `logging.getLogger(__name__)`, structured, **без ПДн** (не `recipient`, не `payload`); `print()` запрещён. Выключенный флаг — не ошибка: `warning`/`exception` на этом пути не писать.
- **ruff `select = ["E","F"]`** (`pyproject.toml:89`) — гейт ловит pycodestyle-errors + pyflakes. `ruff format` по файлу, **не** по папке (иначе трогает out-of-scope; урок проекта).
- **Что уже есть и не надо писать заново.** Паттерн булева env-флага (`settings.py:9` и `:292` (форма `== "1"`; `:152-154` — ИНАЯ форма, не образец)); `WsCommunicator` + `_communicator` (`test_ws_consumer.py:72,122`); подмена слоя через `monkeypatch.setattr("apps.notifications.services.get_channel_layer", …)` (`test_ws_notify.py:112-121`); `django_capture_on_commit_callbacks(execute=True)` (`test_ws_notify.py:357-384`). **Чего НЕТ:** `conftest.py` в `notifications/tests/` — переиспользование только прямым импортом.

### Ловушки (проверено в коде — не наступать)

1. **🔴 `make gate` не экспортирует `VAPS_WS_ENABLED`** (`Makefile:95-101` перечисляет только `VAPS_DB*` и `VAPS_REDIS_URL`), поэтому **дефолт в `settings.py` — единственное, что задаёт состояние всего WS-сьюта**. Дефолт `"0"` не «побелит» сьют, а **уронит** его: закрытый сразу после accept сокет отдаёт `websocket.close` там, где delivery-тест ждёт `websocket.send` (`WsCommunicator.receive_json_from`, `test_ws_consumer.py:113`). Дефолт = `"1"` — и по прод-смыслу, и по гейту.
2. **🔴 Модульная копия флага ломает `override_settings`.** Читать `settings.VAPS_WS_ENABLED` в момент вызова (Решение №5).
3. **🔴 Гвард `test_in_memory_channel_layer_is_absent_from_config`** (`test_ws_guards.py:148`) сканирует **строковые константы** под `config/**` на литерал `InMemoryChannelLayer`. Пояснения — только в `#`-комментариях (`:149-153`).
4. **🔴 Гвард `test_ws_tests_are_never_skipped`** (`test_ws_guards.py:484`) ловит по `test_ws_*.py`. Файл, названный `test_kill_switch.py`, **выпадет из-под гварда молча** — имя обязано быть `test_ws_kill_switch.py`.
5. **🔴 Гвард `test_group_send_only_inside_on_commit`** (`test_ws_guards.py:563`) требует, чтобы объект, переданный в `on_commit`, содержал `group_send` лексически. Ранний `return` внутри `_publish` его не задевает; вынос `group_send` в отдельную функцию или переход на `lambda` — задевает (`:594-619`).
6. **🔴 `asyncio_mode = "strict"`** (`pyproject.toml:76`) — async-тест без `@pytest.mark.asyncio` не запустится и не упадёт: он будет **пропущен как не-тест**. Проверять по числу собранных тестов, а не по зелёному цвету.
7. **🔴 `WsCommunicator.connect()` возвращает по ПЕРВОМУ выходному сообщению** (`test_ws_consumer.py:102-109`): при accept-then-close он вернёт `(True, None)`, и close-фрейм надо забрать **следующим** `receive_output()`. Тест, ожидающий `(False, 4503)`, покраснеет — и это не баг реализации.
8. **🔴 Утечка соединений между async-тестами = флейк** — `await communicator.disconnect()` в каждом тесте (запинено уроком 11.1, `test_ws_consumer.py`).
9. **🔴 Нелатиница в значении `X-User-Id`** отклоняется до сети (находка дев-прохода 11.3, 11 падений). Кириллица — в телах фикстур, не в identity.
10. **`_publish` уже глотает всё** (`services.py:124-134`, `except Exception` + `logger.exception`). Поэтому «флаг работает» **нельзя** доказывать отсутствием падения — только отсутствием вызова (AC-4, записывающий/падающий слой).
11. **`notify()` возвращает `None` при ошибке**, и `lagging_check._emit_lagging` читает это как «не сохранилось» → `LaggingNotifyError` → catch-up встаёт (`services.py:75-80`). Гард флага **не должен** оказаться на пути возврата (AC-5).
12. **`disconnect()` рассчитан на путь без группы** — `getattr(self, "group", None)` (`consumers.py:65-70`). Kill-switch-ветка группу не создаёт; «починить» этот getattr = сломать и путь анонима.
13. **CI для VAPS не существует** — де-факто гейт это локальный `make gate` (`test_ws_guards.py:4-7`). «Fail CI» в спеках 11.x означает «fail внутри gate».
14. **`docker compose up -d --wait db redis` поднимает Redis на 6380** (`docker-compose.yml:26`), и гвард `:344` сверяет порт с `Makefile` регулярками. Ни тот, ни другой файл стори не трогает.

### Previous Story Intelligence

- **11.3 (done, `1353291`).** Источник Решения №2 целиком. Её Решение №4 доказало (кодом ASGI-контракта, не рассуждением), что close до accept доходит до браузера как 1006 — и назвало 11.5 адресом браузерно-честного отказа. Её Решение №5 сознательно **не** зашивало модель fallback'а, оставив выбор этой стори (Решение №3). Транспорт (`notificationsSocket.ts`) 11.5 **не трогает** — он вообще во фронте.
- **11.2 (done).** Решение №5 дословно: «kill-switch НЕ реализуем здесь. `notify()` в 11.2 шлёт безусловно. Флаг — 11.5, с собственным тестом семантики отката. Заводить полу-флаг сейчас = две модели включения и тест, который ничего не доказывает.» Её AC-10 поставил форвард-гвард `on_commit`, назвав 11.5 будущим отправителем — гвард обязан пережить (AC-7).
- **11.1 (done).** Дала consumer, `CLOSE_UNAUTHENTICATED = 4403`, конвенцию приватных кодов (зеркало HTTP-статуса), `WsCommunicator` (решение Bratan против daphne) и четыре теста отказа анонима, которые AC-3 обязан сохранить нетронутыми.
- **11.4 (done, `8573b32`).** Её Открытый вопрос №6 адресован сюда и закрыт Решением №3. Её наблюдение «11.5 добавит `refetchInterval` одной строкой» верно по существу, но относится к **11.5a**: одной строкой добавляется интервал, а не распознавание того, **когда** его включать.
- **Ретро E9.** AI-1: красная проба = гейт (AC-11). AI-3: сверка File List с git-диффом ДО ревью. AI-2: cross-model для рискованного — стори правит общий consumer и `notify()`, на которых висит весь E11; **same-model ревью для 11.5 не принимается**.
- **Ретро эпиков 10 и 11 не существует** (эпики не закрыты). Действующие процессные гейты — AI-1/AI-2/AI-3 ретро E9.

### Git Intelligence

- Baseline `8573b32` (`feat(story-11.4)`). Последние пять: `8573b32` 11.4 · `15b9268` 10.4 · `303476e` graphify · `1353291` 11.3 · `a56ad92` 10.3a.
- **🔴 Дерево грязное чужой стори.** Незакоммичены `frontend/src/app/App.tsx`, `section-stubs.tsx`, `shared/api/client.ts` (+`getBlob`), `client.test.ts`, `testing/handlers.ts` и untracked `frontend/src/features/expense/` — это **10.5 (`ready-for-dev`, экран расхода)**, идущая параллельно в этом же worktree. `Backend/**` чист.
  **Что это значит практически:** (а) 11.5 не пересекается с 10.5 **ни одним файлом** — это главный аргумент вести её сейчас; (б) `git add -A` и `git commit -a` **ЗАПРЕЩЕНЫ** — чужие правки уедут в коммит 11.5 (инцидент уже был в проекте: «параллельная стори крадёт правку в свой коммит»); коммитить **поимённо** четыре пути; (в) `git checkout`/`git stash` для отката красной пробы **ЗАПРЕЩЕНЫ** (урок 9.6) — бэкап только `cp` в скретчпад; (г) `npm run gate` фронта в этой стори не гоняется, и его возможный красный — не регресс 11.5.
- Коммит (за Bratan, после ревью): `feat(story-11.5): kill-switch WS — env-флаг, отказ consumer'а и молчание notify()`. Артефакты агент НЕ коммитит. `graphify update .` — отдельным `chore`-коммитом после ревью (стори меняет `apps/notifications`).
- Ревью: **cross-model + красная проба** (AI-1/AI-2). Стори правит общий consumer и публикацию `notify()` — весь E11 и catch-up 5.7b2 висят на этом пути.

### Красная проба (гейт AI-1 ретро E9 — условие `done`, не намерение)

Минимум восемь мутаций. Бэкап — `cp` в скретчпад; **`git checkout` запрещён** (урок 9.6 + чужая 10.5 в дереве). Якорь каждой мутации проверять на уникальность (`grep -c` == 1), иначе проба невалидна. После восстановления `diff` → IDENTICAL, гейт снова зелёный.

| # | Мутация | Обязан покраснеть | Что доказывает |
|---|---|---|---|
| 1 | в `connect()` убрать `await self.accept()` перед `close(CLOSE_WS_DISABLED)` | `test_ws_disabled_accepts_then_closes_with_the_disabled_code` | код действительно доставляется после accept, а не «отказ вообще» (Решение №2) |
| 2 | поменять ветки местами: проверку флага **до** проверки `actor` | `test_anonymous_is_still_refused_before_accept_when_ws_disabled` | порядок запинен, аноним не принимается даже при выключенном WS (AC-3) |
| 3 | снять `if not settings.VAPS_WS_ENABLED: return` в `_publish` | `test_disabled_flag_writes_the_row_and_publishes_nothing` | молчание публикации — код, а не рассуждение (AC-4) |
| 4 | заменить `return` в `_publish` на `pass` **внутри** `try` (после `get_channel_layer()`) | `test_disabled_flag_does_not_acquire_the_channel_layer` | Redis не трогается **вовсе**, а не «отказ проглочен» (Ловушка 10) |
| 5 | вернуть `None` из `notify()` при выключенном флаге | `test_notify_still_returns_the_row_when_ws_is_disabled` | сигнал выключен, бизнес-операция жива (AC-5, защита catch-up) |
| 6 | заменить `settings.VAPS_WS_ENABLED` на модульную копию, снятую при импорте | тесты выключенного состояния (все) | `override_settings` действует; ассерты не вакуумны (Решение №5, Ловушка 2) |
| 7 | дефолт флага сменить на `"0"` (выключено) | `test_ws_consumer.py::test_group_send_from_another_process_reaches_the_socket` (и вся delivery-группа). **Собственный `test_ws_enabled_still_accepts_and_stays_open` к этой мутации ИММУНЕН** — он под `override_settings(True)`; называть его здесь — ошибка пробы | дефолт «включено» — единственное, что задаёт состояние сьюта (AC-1, Ловушка 1) |
| 8 | в `connect()` оставить `group_add` перед kill-switch-веткой | `test_ws_disabled_never_joins_a_group` | выключенный WS не вступает в группу (Redis на входе трогается в любом случае — `channels/consumer.py:44-49`) |

### Открытые вопросы (Bratan — не блокируют dev 11.5)

1. **🟡 Конверсия `CLOSE_UNAUTHENTICATED` в accept-then-close — адрес подтверждён как «после 11.5a».** 11.3 просила подтвердить адрес (её ОВ №1, «11.5 или 12.1»). Решение №4 отвечает: **не 11.5** — это отдельное изменение поведения (принимать сокет от неаутентифицированного пира), запиненное четырьмя тестами 11.1 и стоящее собственного ревью; и до того, как клиент научится читать коды (11.5a), выгоды от него нет. **Ревью: подтвердить перенос.**
2. **🟡 Кто и по какому сигналу включает флаг обратно.** 11.5 отдаёт механизм; операционная процедура (кто решает, что Redis починен, и что при этом делают открытые вкладки операторов) — вопрос рунбука **12.1/12.7**, не кода. Смежное: клиент, ушедший в polling, вернётся на WS **только после перезагрузки страницы** — если это неприемлемо, 11.5a обязана предусмотреть редкую повторную попытку; решение за 11.5a.
3. **🟡 Наблюдаемость выключенного состояния.** Сегодня узнать, что kill-switch активен, можно только чтением env контейнера: health-эндпоинта нет (architecture.md#L340 объявляет его будущим), версии в футере тоже нет (E13). Вариант — вывести флаг в будущий health/version-ответ. Адрес — **12.x / E13**, не 11.5.
4. **🟡 Kill-switch только для WS.** architecture.md#L143 говорит о kill-switch'ах для рисковой логики вообще; 11.5 заводит **один** флаг под свою задачу и **не** строит фреймворк фичефлагов. Если флагов станет больше трёх — заводить общий механизм отдельной стори, а не наращивать `settings.py`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1260-1266] — Story 11.5: «флаг, отключающий WS с молчаливым переходом клиента на polling»; AC «выключен посреди дня → клиенты переходят на polling, уведомления продолжают приходить, состояние консистентно (тест отката)».
- [Source: _bmad-output/planning-artifacts/architecture.md#L56] — «релизы доставляются переносом носителя → kill-switch-флаги в конфиге обязательны (MTTR ≥ время доставки)» — бизнес-основание стори.
- [Source: _bmad-output/planning-artifacts/architecture.md#L95] — «СЕЙЧАС (6)»: kill-switch для WebSocket в списке того, что делается сразу, а не откладывается.
- [Source: _bmad-output/planning-artifacts/architecture.md#L327] — best-effort WS, «событие в БД — истина»; «kill-switch → ручной refresh, с тестом семантики отката» (расхождение закрыто Решением №3).
- [Source: _bmad-output/planning-artifacts/architecture.md#L338, #L339] — «kill-switch-флаги (env/таблица) — отключение рисковой логики без редеплоя»; «конфиг — env, без веток кода по окружению» (основание Решения №1).
- [Source: _bmad-output/planning-artifacts/architecture.md#L459, #L466] — `group_send` только через `on_commit`; «WS-уведомление — ускоритель, поллинг — истина» (второе основание Решения №3).
- [Source: _bmad-output/planning-artifacts/architecture.md#L259] — Playwright-лимит 5 сценариев включает «kill-switch прячет фичу» — вне 11.5 (AC-8).
- [Source: .../ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md#L276] — «WS деградирует в polling (kill-switch) с индикатором «нет связи»; уведомление всегда персистится в DB» (основание AC-5 и Решения №3).
- [Source: Backend/VAPS/apps/notifications/consumers.py:37-41, 55-63, 65-70] — `CLOSE_UNAUTHENTICATED = 4403` и комментарий «accepting-then-staying-silent was rejected»; `connect()` целиком; `getattr(self,"group",None)` в `disconnect`.
- [Source: Backend/VAPS/apps/notifications/services.py:63, 75-80, 88, 120-134, 137-201] — `_publish` и его try/except; «отказ СИГНАЛА не должен останавливать БИЗНЕС-операцию»; `notify()` + `on_commit(partial(_publish, notification))` на `:188`.
- [Source: Backend/VAPS/config/settings.py:9, 87-115, 152-154, 256, 290-293] — паттерн булева env-флага (три экземпляра); `channel_layers_from_env`; канон «env-флаг, НЕ `if DEBUG`»; прецедент `VAPS_XACCEL_ENABLED`.
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_guards.py:148-153, 240, 344, 484, 563-570, 594-619] — четыре гварда, которые правка обязана пережить; докстринг `test_group_send_only_inside_on_commit` называет 11.5 поимённо.
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_consumer.py:72-124] — `WsCommunicator` (возврат по первому сообщению — Ловушка 7) и фабрика `_communicator`.
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_notify.py:61, 95-121, 357-384] — импорт харнесса вместо копирования; подмена `services.get_channel_layer`; образец теста с `django_capture_on_commit_callbacks`.
- [Source: Backend/VAPS/Makefile:88-112; pyproject.toml:67-89] — состав `make gate` (env, ruff `E,F`, `-m "not property…"`, `makemigrations --check`), бюджет 300 с; `asyncio_mode = "strict"`.
- [Source: Backend/VAPS/apps/operations/submissions/models/control_settings.py:9-58; selectors.py:154-175] — `SubmissionControlSettings` (рассмотрена и отклонена как носитель флага, Решение №1).
- [Source: _bmad-output/implementation-artifacts/11-3-ws-клиент-с-reconnect.md#Решения №4,№5; #Открытые вопросы №1] — ASGI-доказательство «close до accept → 1006»; fallback не зашит; адрес правки consumer'а назван 11.5.
- [Source: _bmad-output/implementation-artifacts/11-2-публикация-в-ws-из-notify.md#Решение №5; AC-10] — «kill-switch — 11.5»; форвард-гвард `on_commit`.
- [Source: _bmad-output/implementation-artifacts/11-1-channels-и-channels-redis.md#Решение №4; AC-4] — конвенция приватных close-кодов и четыре теста отказа анонима.
- [Source: _bmad-output/implementation-artifacts/11-4-центр-уведомлений-ui.md#Открытые вопросы №6] — «решить к 11.5: ручной refresh vs polling» (закрыто Решением №3).
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L72-83] — AI-1 (красная проба = гейт), AI-2 (cross-model), AI-3 (сверка File List).
- [Source: прогон в worktree, 2026-07-19] — `make gate` на `8573b32`: **2373 passed, 56 deselected, 85 с**, `No changes detected`; `git status --short -- Backend/` → пусто; эндпоинта конфигурации на бэке нет (grep по всем `urls.py`); `import.meta.env` во фронте не встречается ни разу.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`, dev-проход 2026-07-19.
⚠️ **Ревью обязано быть cross-model** (AI-2 ретро E9): стори правит общий
consumer и путь публикации `notify()`, на которых висит весь E11 и catch-up
5.7b2.

### Debug Log References

**Task 0 — обратный гейт границы (AC-0).**
- `git status --short -- Backend/` → **пустой вывод**. HEAD = `8573b32` —
  совпал с `baseline_commit` стори.
- Baseline `make gate` до единой правки: **2373 passed, 56 deselected, 81 с**,
  `No changes detected`. Совпало с заявленным в стори baseline точно.

**Task 5 — гейт после реализации.**
- `make gate` → **2381 passed, 56 deselected, 85 с**, `No changes detected`.
  Прирост **+8** = ровно число добавленных тестов (AC-10).
- Именованные сьюты отдельным прогоном, **без единой правки в них**:
  `test_ws_consumer.py`, `test_ws_notify.py`, `test_ws_e2e.py`,
  `test_ws_guards.py`, `test_notify.py`, `test_notifications_read_api.py` →
  **116 passed**.
- `git status --short -- Backend/` → ровно четыре пути (3 MOD + 1 NEW), ни
  одного под `frontend/`, `Makefile`, `docker-compose.yml`, `pyproject.toml`,
  `schema.yaml` (AC-8).
- Гейт **повторно** после восстановления файлов красной пробы: **2381 passed,
  56 deselected, 78 с**, `No changes detected`.

**RED-фаза (TDD).** Тест-файл написан ПЕРВЫМ: прогон до реализации →
`ImportError: cannot import name 'CLOSE_WS_DISABLED'`, 0 collected / 1 error.

#### Красная проба — 8 мутаций, построчно (AC-11, гейт AI-1 ретро E9)

Бэкап — `cp` в скретчпад (`git checkout` НЕ применялся: урок 9.6 + чужая
незакоммиченная 10.5 в дереве). Якорь каждой мутации проверялся на
уникальность программно (`assert count == 1`), мутация с неуникальным якорем
не применялась.

| # | Мутация | Что покраснело | Вердикт |
|---|---------|----------------|---------|
| 1 | убран `await self.accept()` перед `close(CLOSE_WS_DISABLED)` | `test_ws_disabled_accepts_then_closes_with_the_disabled_code` (1 failed, 7 passed) | ✅ как в таблице |
| 2 | проверка флага перенесена **до** проверки `actor` | `test_anonymous_is_still_refused_before_accept_when_ws_disabled` (1 failed, 7 passed) | ✅ как в таблице |
| 3 | снят `if not settings.VAPS_WS_ENABLED: return` в `_publish` | `test_disabled_flag_writes_the_row_and_publishes_nothing` **+** `test_disabled_flag_does_not_acquire_the_channel_layer` (2 failed, 6 passed) | ✅ ожидаемый + бонус |
| 4 | гвард сдвинут **внутрь `try`, после `get_channel_layer()`** | **только** `test_disabled_flag_does_not_acquire_the_channel_layer` (1 failed, 7 passed) | ✅ ключевая дискриминация: `..._publishes_nothing` остался ЗЕЛЁНЫМ, то есть два теста ловят разные вещи, как и задумано AC-4 |
| 5 | `notify()` возвращает `None` при выключенном флаге | `test_notify_still_returns_the_row_when_ws_is_disabled` **+** `..._writes_the_row_and_publishes_nothing` (2 failed, 6 passed) | ✅ как в таблице |
| 6 | `settings.VAPS_WS_ENABLED` → модульная копия, снятая при импорте (в обоих файлах) | **все четыре** теста выключенного состояния: `..._writes_the_row_and_publishes_nothing`, `..._does_not_acquire_the_channel_layer`, `..._accepts_then_closes_with_the_disabled_code`, `..._never_joins_a_group` (4 failed, 4 passed) | ✅ `override_settings` действует, ассерты не вакуумны |
| 7 | дефолт флага `"1"` → `"0"` | `test_ws_consumer.py::test_group_send_from_another_process_reaches_the_socket` (падение ровно на `test_ws_consumer.py:113`, как предсказала стори) + ещё 3 из delivery-группы + 4 в `test_ws_e2e.py` (8 failed, 42 passed) | ✅ и **`test_ws_enabled_still_accepts_and_stays_open` остался зелёным** — иммунитет, предсказанный стори, подтверждён прогоном |
| 8 | `group_add` оставлен **перед** kill-switch-веткой | `test_ws_disabled_never_joins_a_group` (1 failed, 7 passed) | ✅ как в таблице |

**Зелёных проб нет — все 8 мутаций покраснели на предсказанном тесте.**
После каждой мутации файл восстанавливался из `cp`-бэкапа; `diff` по всем
четырём файлам → **IDENTICAL**; финальный `make gate` повторно зелёный.

### Completion Notes List

**Что реализовано (AC → код).**
- **AC-1.** `config/settings.py`: `VAPS_WS_ENABLED = os.environ.get("VAPS_WS_ENABLED", "1") == "1"` рядом с блоком X-Accel, дословная форма-зеркало `VAPS_XACCEL_ENABLED`. Парсер-функции нет. Пояснение — только `#`-комментарии (гвард `test_ws_guards.py:148` зелёный).
- **AC-2.** `consumers.py`: `CLOSE_WS_DISABLED = 4503` с `#`-обоснованием (зеркало 503; почему **после** `accept()`, со ссылкой на ASGI-контракт и 11.3 Решение №4; и почему конверсия 4403 сюда НЕ входит). В `connect()` — `accept()` → `close(4503)` → `return`, до `group_add`.
- **AC-3.** Ветка флага стоит **строго после** проверки `actor`; порядок запинен тестом `test_anonymous_is_still_refused_before_accept_when_ws_disabled` (мутация №2 это подтвердила).
- **AC-4.** `services.py`: `if not settings.VAPS_WS_ENABLED: return` — **первым оператором тела `_publish`, до `try`**. Логирования на этом пути нет вовсе (ни `debug`, ни `warning`) — тишина, ПДн не пишутся.
- **AC-5.** `notify()` не тронут ни на строку; возврат строки не зависит от флага.
- **AC-6.** `views.py`/`selectors.py`/`serializers.py`/`api/urls.py` не открывались; независимость REST доказана тестом.
- **AC-7.** Все четыре названных гварда зелёные в общем прогоне; `disconnect()` не правился — `getattr(self, "group", None)` корректно отработал путь без `group_add` (подтверждено тем, что async-тесты вызывают `disconnect()` и проходят).
- **AC-9.** Восемь тестов в `test_ws_kill_switch.py`, каждый — дискриминирующей парой. Харнесс переиспользован импортом `_communicator`; `WsCommunicator` **не правился** — доработка под accept-then-close не понадобилась (Ловушка 7 подтвердилась: `connect()` вернул `(True, None)`, close-фрейм забран следующим `receive_output()`).

**🔴 ОТКЛОНЕНИЕ ОТ БУКВЫ ЗАДАЧИ — на решение ревью (не замолчано).**
Помимо перечисленных в Task 3 подзадач я правил **ещё одно место в
`services.py`: модульный докстринг** (`:29-30`). Он утверждал дословно: «the WS
kill-switch is 11.5 (`notify()` publishes unconditionally today)» — после этой
стори это ложь в первой же строке файла. Заменил на описание фактического
поведения. Формально это **не** входило ни в одну подзадачу Task 3 (там названы
только гвард, докстринг `_publish` и запрет трогать `notify()`), и правило
«не реализовывать ничего вне задач» я тут перешагнул сознательно. Обоснование:
устаревший докстринг — это дефект, который стори создаёт своими руками. Если
ревью сочтёт это выходом за скоуп — правка снимается одним `Edit`, на тесты и
поведение она не влияет никак.

**Что НЕ делалось (границы AC-8 соблюдены).**
`frontend/**` не открывался ни разу — потребности не возникло, эскалация не
потребовалась. Не тронуты: `Makefile`, `docker-compose.yml`, `pyproject.toml`,
`schema.yaml`/`schema.d.ts`, `apps/notifications/api/**`, `selectors.py`,
`models.py`, `groups.py`, `routing.py`, `config/asgi.py`, `apps/core/auth/ws.py`,
`WsCommunicator`, а также `test_ws_consumer.py`/`test_ws_notify.py`/
`test_ws_e2e.py`/`test_ws_guards.py`. Миграций нет: `makemigrations --check
--dry-run` → `No changes detected`. Новых зависимостей ноль.

**Наблюдение для ревью (не дефект).** Мутация №4 показала, что
`test_disabled_flag_writes_the_row_and_publishes_nothing` и
`test_disabled_flag_does_not_acquire_the_channel_layer` ловят **разные** отказы:
первый остаётся зелёным, если гвард сдвинуть после `get_channel_layer()`. Это
ровно то разделение, ради которого AC-4 сформулирован как «не приобретает слой
вовсе», а не «не отправляет» — и оно теперь подтверждено прогоном.

**Состояние дерева.** Параллельная 10.5 (фронтовая) продолжает жить
незакоммиченной в этом же worktree и за время прохода **выросла** (добавились
`frontend/eslint.config.js`, `test-results/`,
`_bmad-output/implementation-artifacts/tests/test-summary-10-5.md`). К 11.5 это
отношения не имеет, пересечений по файлам ноль. При коммите: `git add -A` и
`git commit -a` **ЗАПРЕЩЕНЫ** — коммитить строго четыре пути поимённо.
`npm run gate` фронта не гонялся (AC-10).

### File List

**Modified (3):**
- `Backend/VAPS/config/settings.py` — флаг `VAPS_WS_ENABLED` (AC-1)
- `Backend/VAPS/apps/notifications/consumers.py` — `CLOSE_WS_DISABLED = 4503`, импорт `settings`, kill-switch-ветка в `connect()` (AC-2, AC-3)
- `Backend/VAPS/apps/notifications/services.py` — импорт `settings`, гвард первым оператором `_publish`, абзац в его докстринге + актуализация модульного докстринга (AC-4, AC-5; см. отклонение выше)

**Added (1):**
- `Backend/VAPS/apps/notifications/tests/test_ws_kill_switch.py` — **12 тестов**: 8 дев-прохода (AC-9, обязательный минимум) + 4 QA-прохода (дефолт флага, `disconnect()` без группы, сквозной без подмен, цепочка «эмиссия при WS off → REST»; см. `tests/test-summary-11-5.md`)

Сверено с `git status --short -- Backend/` **до** ревью (AI-3 ретро E9) —
списки совпадают ровно, лишнего в `Backend/` нет.

**Артефакты (агент НЕ коммитит):** `_bmad-output/implementation-artifacts/11-5-kill-switch-ws.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/tests/test-summary-11-5.md`.

## Senior Developer Review (AI)

**Ревьюер:** Claude Fable 5 (`claude-fable-5`), 2026-07-19 — **cross-model** относительно дев-прохода на Opus 4.8, гейт AI-2 ретро E9 соблюдён.
**Вердикт: Approve** — CRITICAL-находок нет, статус → done.

**Что проверено прогоном (не рассуждением):**
- `make gate` перепрогнан ревьюером: **2385 passed, 56 deselected, 71 с**, `No changes detected`. 2385 = 2373 (baseline) + **12** добавленных тестов — сходится с QA-сводкой, а не с числами дев-прохода (см. находку №1).
- `test_ws_kill_switch.py` отдельно: **12 passed**, collected 12 — ни один async-тест не выпал из сборки молча (Ловушка 6 не сработала).
- `ruff check` по четырём файлам стори — чисто; литерала `InMemoryChannelLayer` в строках под `config/` нет (гвард `:148` жив).
- `git diff -U0` по `services.py`: ханки только в модульном докстринге, импорте и `_publish` — **`notify()` не тронут ни на строку** (AC-4/AC-5, гвард `:563` зелёный в общем прогоне).
- Все `[x]`-чекбоксы Tasks 0–5 сверены с кодом построчно — дрейфа нет (проверка против известного паттерна дев-агента).
- `git status --short -- Backend/` → ровно четыре пути стори (AC-0/AC-8, AI-3).

**Находки (CRITICAL — 0, MEDIUM — 1, LOW — 2):**
1. **[MEDIUM][исправлено]** Рассинхрон записей стори с реальностью: Dev Agent Record и Change Log дев-прохода фиксируют «8 тестов / +8 / 2381 passed», фактическое состояние после QA-прохода той же сессии — **12 тестов / +12 / 2385** (`tests/test-summary-11-5.md`, «Для ревью» №1, — QA сознательно оставил реконсиляцию ревью). Исправлено: File List актуализирован (12 тестов с разбивкой), Change Log дополнен ревью-записью. Числа дев-прохода в Debug Log оставлены как есть — они были верны на момент записи; красная проба дев-прохода (`1 failed, 7 passed` и т.п.) читается против 8-тестового файла до QA-дописки.
2. **[LOW][принято]** Отклонение дев-прохода — правка модульного докстринга `services.py` вне буквы Task 3 — **принимается**: строка «`notify()` publishes unconditionally today» стала бы ложью в первой строке файла, дефект создавала сама стори. Поведение и тесты не задеты.
3. **[LOW][зафиксировано]** В worktree чужие не-сторийные изменения: `.claude/settings.json` (PROJECT_ROOT хука story-automator), untracked `test-results/` (прогоны фронтовой 10.5) и артефакты автоматора. К 11.5 не относятся; коммит стори — **строго четырьмя путями поимённо** (уже предписано Git Intelligence).

**Открытый вопрос №1 (перенос конверсии `CLOSE_UNAUTHENTICATED` в accept-then-close на «после 11.5a») — перенос ПОДТВЕРЖДАЮ:** изменение принимает сокет от неаутентифицированного пира, запинено шестью тестами 11.1 и до клиентской ветки по кодам (11.5a) не даёт пользы. Решения №1–№5 стори проверены против кода — расхождений нет.

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-07-19 | Story 11.5 реализована: env-флаг `VAPS_WS_ENABLED` (дефолт «включено»), отказ consumer'а через `accept()` → `close(4503)` со строгим приоритетом identity над флагом, ранний выход `_publish` до приобретения channel layer. Строка в БД и REST-чтение флагом не затронуты. Добавлен `test_ws_kill_switch.py` (8 тестов). Гейт: 2373 → **2381 passed**, 56 deselected, `No changes detected`. Красная проба: 8/8 мутаций покраснели на предсказанных тестах. Status → review. |
| 2026-07-19 | QA-проход (`bmad-qa-generate-e2e-tests`): +4 теста в тот же `test_ws_kill_switch.py` (дефолт флага, `disconnect()` без группы, сквозной прогон без подмен, цепочка «эмиссия при WS off → REST»). Гейт: **2385 passed** (+12 итого). Красная проба QA: 4/4 мутации покраснели. См. `tests/test-summary-11-5.md`. |
| 2026-07-19 | Ревью (cross-model: Fable 5 после дев-прохода на Opus 4.8, AI-2). Гейт перепрогнан ревьюером: **2385 passed, 56 deselected, `No changes detected`** — прирост +12 сверен с фактическим числом тестов в файле (12). Все AC и чекбоксы подтверждены кодом; CRITICAL — 0. MEDIUM-рассинхрон «8 тестов/2381» в записях стори снят актуализацией File List и этой записью; отклонение дев-прохода (модульный докстринг `services.py`) принято; перенос конверсии 4403 на «после 11.5a» подтверждён. Status → done. |
