---
baseline_commit: 3cce774 (HEAD, `chore(graphify)` после story-10.2/11.1). Предшественник — 11.1 (done, коммит e2c7890): WS-транспорт существует и доставляет из любого процесса. 11.2 — ПЕРВЫЙ отправитель в этот транспорт и ПЕРВЫЙ `transaction.on_commit` в проекте (в проде их сегодня НОЛЬ, проверено `grep -rn on_commit`).
---

# Story 11.2: Публикация в WS из notify()

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система**,
I want **дополнить `notifications.services.notify()` отправкой `group_send` через `transaction.on_commit`, оставив запись в БД синхронной и внутри транзакции вызывающего**,
so that **событие в БД остаётся ИСТИНОЙ, а WS — best-effort сигналом «обнови»: откат бизнес-транзакции не рождает фантомное WS-сообщение о несуществующей строке, а сбой Redis не роняет уже валидную бизнес-операцию (FR-35, architecture.md#L459)**.

## Acceptance Criteria

Источник: epics.md#L1236-1242 (Story 11.2 AC); architecture.md#L459 (WS-конверт + «отправка **только** через `transaction.on_commit`»), #L327 (best-effort + дочитка REST, «событие в БД — истина»), #L592 (граница `notifications ← все`, «синхронно in-txn, вариант B 5.7a; non-fatal»); FR-35 (prd.md#L159); открытый вопрос №1 стори 11.1 (реестр vs код) — закрывается здесь, см. Решение №1.

1. **AC-1 (реестр разыменован — `SUBMISSION_LAGGING` легализован; СТОП-правило снято).** `docs/registries/ws-message-types.yaml` (MOD): добавлен тип `SUBMISSION_LAGGING` (`priority: WARNING`, `recipients: "division submission recipients"`, `repeat: "daily until submitted"`, `action_url: "/daily-expense"`, `trigger: "catch-up несдачи за прошедший день (lagging_check)"`, `source: "VAPS story 5.7a/5.7b — реальный эмиттер, не донор"`). Заголовочный контракт-комментарий файла приведён к факту: таблица **`notifications`**, колонка **`kind`** — исправить **оба** вхождения `notifications_messages` (строка 11 «персистится в notifications_messages» и строка 12 «`notifications_messages.type_code`»; такой таблицы в VAPS нет — донорский фантом, проверено). **НЕ переименовывать** `Notification.Kind.SUBMISSION_LAGGING` в `DAILY_MARK_MISSING` — см. Решение №1.
2. **AC-2 (реестр становится ИСПОЛНЯЕМЫМ контрактом, а не документом).** `apps/notifications/tests/test_ws_guards.py` (MOD): гвард `test_notification_kinds_subset_of_ws_registry` — `Notification.Kind.values ⊆` типы из `ws-message-types.yaml`. Направление именно `code ⊆ registry` (обратное — «нет сирот» — сегодня красное: 24 типа реестра суть форвард-семена эпиков 14-20; **точное зеркало решения №3 в `test_audit_coverage.py::test_emitted_actions_subset_of_registry`**). Парсинг — indent-aware regex по секции `types:`, **без PyYAML**, по образцу `_registry_actions()` (test_audit_coverage.py:126-143). *Обоснование точное, проверь прежде чем «улучшать»:* `import yaml` в venv **работает** (PyYAML 6.0.3 стоит транзитивно как жёсткая зависимость `drf-spectacular`), но в `pyproject.toml` он **не объявлен** — закреплять тест за необъявленной транзитивной зависимостью нельзя, она исчезнет при смене `drf-spectacular`. Анти-вакуум обязателен: (а) `assert` непустоты распарсенного реестра с полом **≥25** (24 донорских + `SUBMISSION_LAGGING` из AC-1; пол 24 стерпел бы парсер, теряющий ровно одну запись); (б) guard-the-guard `test_registry_parse_rejects_unknown_kind` — синтетический `Kind`-набор с несуществующим кодом обязан ловиться сравнением. **Причина, по которой этот гвард важнее самого фикса:** сегодня реестр не проверяет НИЧЕГО (0 тестов ссылаются на файл — проверено), ровно поэтому расхождение дожило до 11.2. Без гварда следующий `Kind` разойдётся с реестром так же молча.
3. **AC-3 (тип WS-конверта = `kind` строки, без второго словаря).** Конверт клиенту: `{"type": <notification.kind>, "payload": {...}}`. `type` берётся **напрямую из `notification.kind`** — никакой мапы `kind → type_code`. Второй словарь = второй источник истины = дрейф (класс инцидента 10.1: «реестр несёт донор-фантомы»). Именно AC-1 делает это корректным: после легализации `kind` и `type_code` — одно пространство имён, ровно как утверждает шапка самого реестра.
4. **AC-4 (откат → WS молчит; коммит → WS уходит) — ядро стори.** **Given** `notify()` вызвана внутри `transaction.atomic()`, которая затем **откатывается**, **Then** `group_send` НЕ выполняется вовсе (колбэк `on_commit` отбрасывается вместе с транзакцией) и в БД нет строки. **Given** та же транзакция **коммитится**, **Then** (а) строка в БД есть, (б) ровно один `group_send` в группу `group_name_for(notification.recipient)` с конвертом channel layer `{"type": NOTIFY_MESSAGE_TYPE, "message": {"type": kind, "payload": {...}}}`. **Отправка обязана быть зарегистрирована через `transaction.on_commit`, а не вызвана инлайн** — инлайн-вызов проходит «happy path»-тест и падает только на откате, в проде, сообщением о строке, которой нет.
5. **AC-5 (запись в БД остаётся синхронной — вариант B 5.7a НЕ отменяется).** В `on_commit` уходит **ТОЛЬКО `group_send`**. `Notification.objects.get_or_create(...)` остаётся на месте: синхронно, внутри транзакции вызывающего, с немедленным возвратом строки. **Гейт корректности: `apps/notifications/tests/test_notify.py` обязан остаться зелёным БЕЗ ЕДИНОЙ ПРАВКИ**, в частности `test_notify_visible_within_caller_transaction` — он дискриминирующий и его докстринг (test_notify.py:61-63) буквально говорит: «Under variant A (`transaction.on_commit`) both assertions would fail». Если этот тест пришлось править — реализация утащила в `on_commit` запись, а не сигнал; это регресс 5.7a, а не «обновление теста».
6. **AC-6 (WS шлётся только при РЕАЛЬНО созданной строке).** `get_or_create` возвращает флаг `created` (сейчас отбрасывается: `notification, _ =`, services.py:44). **Given** повторный вызов `notify()` с тем же `(recipient, kind, business_date)` (no-op в БД, «одно уведомление на день»), **Then** `group_send` НЕ выполняется. Обоснование не косметическое: `lagging_check.catch_up` прогоняет пропущенные дни пачкой и по построению переспрашивает уже уведомлённые дни (идемпотентность-по-watermark) — отправка «по факту вызова» превратила бы один retry в шторм дублей строк, которые не менялись. Правило: **WS-сигнал соответствует изменению состояния, а не факту вызова.**
7. **AC-7 (сбой WS не влияет ни на возврат `notify()`, ни на транзакцию) — самый дорогой инвариант стори.** **Given** channel layer недоступен/`group_send` бросает исключение, **Then** исключение поймано, залогировано (`logger.exception`, structured, без ПДн) и **проглочено**; строка в БД остаётся, `notify()` **уже вернула** её (колбэк выполняется ПОСЛЕ коммита — возврат физически не может измениться, и это надо зафиксировать тестом, а не подразумевать). **Почему это критично, а не «best-effort ради красоты»:** `lagging_check._emit_lagging` (lagging_check.py:235-246) поднимает `LaggingNotifyError`, если `notify()` вернула `None` → откат дня + watermark держится на N-1. Если сбой Redis протечёт в возврат/исключение, недоступность **сигнального** канала остановит **бизнес-catch-up несдачи** — инверсия приоритетов, прямо запрещённая architecture.md#L327 («событие в БД — истина, WS — ускоритель»). Тест обязан утверждать оба следствия: возврат не `None` И строка на месте.
8. **AC-8 (конверт сериализуем через channel layer — msgpack не умеет `date`/`datetime`).** Все значения в `payload` — JSON-примитивы: `business_date` → `.isoformat()`; `created_at` → **`timezone.localtime(created_at).isoformat()`** (именно так, см. AC-9 — голый `.isoformat()` даёт другую строку, чем REST); `read_at` у только что созданной строки — `None`. **Проверено эмпирически, не по памяти:** `msgpack.packb({'d': date(2026,7,19)})` → `TypeError: can not serialize 'datetime.date' object`; `channels_redis` сериализует конверт именно msgpack'ом, а `consumers.NotificationConsumer.notify_message` затем зовёт `json.dumps` (consumers.py:81) — который на `date` падает так же. Ловушка сработала бы **только в рантайме** и только на реальном слое. Тест обязан гонять конверт через **реальный Redis-слой** (`group_send` → приём подписчиком), а не сравнивать словари в памяти — сравнение словарей эту ловушку не ловит вовсе.
9. **AC-9 (паритет с read-API — по ЗНАЧЕНИЯМ, не по ключам).** `payload` конверта повторяет проекцию `NotificationSerializer` (api/serializers.py:13-21): `id`, `recipient`, `kind`, `business_date`, `payload`, `read_at`, `created_at`. Требование 11.4 («`queryClient.setQueryData` обновляет список без отдельного стора»): строка из WS обязана быть подставима в кэш рядом со строками `GET /api/notifications/`, иначе кэш разнороден. **Тест обязан сравнивать ПОЛНЫЕ значения: `envelope["payload"] == NotificationSerializer(notification).data`.** Сравнение одних ключей — вакуум: оно зелено при расхождении формата времени, а расхождение здесь реально и уже измерено. `TIME_ZONE = "Asia/Qyzylorda"` (settings.py:147), DRF рендерит в локальной зоне, а `created_at` хранится в UTC — для одного мгновения получается `2026-07-19T08:05:44.813377+00:00` (голый `.isoformat()`) против `2026-07-19T13:05:44.813377+05:00` (REST). Проверено прогоном; **`timezone.localtime(created_at).isoformat()` даёт байт-в-байт REST-строку** — использовать её (AC-8). Разошедшийся формат ломает и сортировку кэша 11.4, и сравнение курсора `?since=` в 11.3. **`services.py` НЕ импортирует `api.serializers`** (инверсия слоя, architecture.md#L444-454) — словарь собирается руками; но **тест импортировать сериализатор ОБЯЗАН**: запрет связывает прод-код, не тест, а иначе контракт не держит ничто. `timezone.localtime()` — перевод уже сохранённого значения, а не чтение часов: гвард wall-clock (`timezone.now()`) не задевается. Вложенное `payload` внутри `payload` — не опечатка (внешнее — оболочка WS-контракта, внутреннее — доменный payload строки); задокументировать комментарием.
10. **AC-10 (форвард-гвард: `group_send` только под `on_commit`).** AST-гвард `test_group_send_only_inside_on_commit` в `test_ws_guards.py`: скан `apps/**/*.py` (без `tests`) — каждый вызов `group_send` обязан лежать в теле функции, **объект которой передан в `transaction.on_commit`** в том же модуле. **Гвард и реализация обязаны сойтись — это отдельное требование, а не следствие.** Поэтому Task 3 предписывает `transaction.on_commit(partial(_publish, notification))`: имя `_publish` передаётся как объект, и гвард его находит. Форма `on_commit(lambda: _publish(n))` этот гвард **не проходит** (внутри лямбды нет `group_send`, а `_publish` лишь вызывается) — если реализация уйдёт в лямбду, чинить надо реализацию, а не ослаблять гвард. `partial` заодно снимает late-binding-грабли голой лямбды. Сегодня сайт один, гвард форвардный: 11.4 (mark-as-read) и 11.5 (kill-switch) добавят отправителей, и правило architecture.md#L459 «**только** через `transaction.on_commit`» должно пережить смену автора. Анти-вакуум: `assert files` + guard-the-guard на синтетическом сниппете (инлайн-`group_send` обязан ловиться, переданный в `on_commit` — нет).
11. **AC-11 (границы — что НЕ входит).** **НЕ трогаем:** `consumers.py`/`routing.py`/`asgi.py`/`ws.py`/`groups.py` (транспорт 11.1 готов и type-agnostic — если понадобилась правка транспорта, значит спека 11.2 неверна, эскалировать, а не править); фронт-клиент/reconnect/`?since=` (**11.3**); UI-центр/колокольчик/mark-as-read/unread-индекс (**11.4**, deferred-work.md:495); kill-switch WS (**11.5** — `notify()` в 11.2 шлёт безусловно); Playwright-e2e (**11.6**); nginx/прод-compose (**12.1**). **Celery НЕ вводится** (epics.md#L759, ARCH-DEFERRED-048). Моделей/полей стори не добавляет → `makemigrations --check` обязан остаться пустым (`kind` НЕ переименовывается — AC-1 → миграции не нужны вовсе). `schema.yaml`/`schema.d.ts` НЕ регенерируются: HTTP-поверхность не менялась, WS вне OpenAPI.
12. **AC-12 (регресс нулевой, гейт зелёный).** `make gate` (из `Backend/VAPS`) зелёный: `ruff check .` чист (E,F), `makemigrations --check --dry-run` — «No changes detected», весь сет проходит. Отдельно подтвердить: `test_notify.py` (**зелёный без правок**, AC-5), `test_notifications_read_api.py`, `apps/operations/submissions/tests/` (`lagging_check`/`catch_up` — единственный прод-вызыватель `notify()`; **это проверка на регресс, а не покрытие WS-пути**: там обычный `django_db`, колбэки `on_commit` отбрасываются, `group_send` не выполняется вовсе — покрытие живёт в Task 4), `apps/notifications/tests/test_isolation.py` (новые импорты в `services.py` — `channels`/`asgiref`/`django.db.transaction`, ни один не `apps.core.models`), `test_ws_consumer.py`/`test_ws_e2e.py` (транспорт не тронут). HTTP-роутов не добавлено → новых строк в `MATRIX`/`AUDIT_MATRIX` быть не должно. Фронт не затронут — `npm run gate` не гонять.

## Tasks / Subtasks

- [x] **Task 1 — Легализовать `SUBMISSION_LAGGING` в реестре** (`docs/registries/ws-message-types.yaml`, MOD) (AC: 1)
  - [x] Добавить блок `SUBMISSION_LAGGING` в секцию `types:` с полями по образцу `DAILY_MARK_MISSING` (priority/recipients/repeat/action_url/trigger/source). Отступ и порядок ключей — точное зеркало соседей (гвард парсит regex'ом по отступу; лишний пробел = невидимый тип).
  - [x] Поправить шапку-контракт: `notifications_messages.type_code` → «таблица `notifications`, колонка `kind`». Одной строкой-комментарием отметить, что остальные 24 типа — форвард-семена эпиков 14-20 (не эмитируются сегодня), чтобы никто не принял их за реализованные.
  - [x] **НЕ** трогать `meta.growth_rule` и не удалять существующие типы.
- [x] **Task 2 — Гвард реестра** (`apps/notifications/tests/test_ws_guards.py`, MOD) (AC: 2)
  - [x] `_registry_types()` — indent-aware парсер секции `types:` без PyYAML; копировать структуру `_registry_actions()` (test_audit_coverage.py:126-143), не изобретать свою.
  - [x] `test_notification_kinds_subset_of_ws_registry`: `set(Notification.Kind.values) - _registry_types() == set()`; сообщение об ошибке цитирует `growth_rule` («добавь тип в реестр тем же PR») — зеркало формулировки audit-гварда.
  - [x] Анти-вакуум: `assert len(_registry_types()) >= 24` (пол = сегодняшний реестр; сломанный парсер обязан краснеть, а не проходить на пустом множестве).
  - [x] Guard-the-guard `test_registry_parse_rejects_unknown_kind`: синтетический набор `{"SUBMISSION_LAGGING", "TOTALLY_MADE_UP"}` минус реестр == `{"TOTALLY_MADE_UP"}`.
- [x] **Task 3 — `notify()`: сборка конверта + `on_commit`** (`apps/notifications/services.py`, MOD) (AC: 3,4,5,6,7,8,9)
  - [x] Импорты: `from functools import partial`, `from django.db import transaction`, `from django.utils import timezone`, `from asgiref.sync import async_to_sync`, `from channels.layers import get_channel_layer`, `from apps.notifications.groups import NOTIFY_MESSAGE_TYPE, group_name_for`. **`NOTIFY_MESSAGE_TYPE` импортировать, не перепечатывать** (groups.py:11-18 требует это прямым текстом: опечатка = `No handler for message type` в рантайме, а не ошибка сборки). `get_channel_layer` импортировать **на уровне модуля** — тест патчит `apps.notifications.services.get_channel_layer` (AC-7).
  - [x] Развернуть `notification, _ = get_or_create(...)` → `notification, created = ...`; **`created` больше не отбрасывается** (AC-6).
  - [x] `if created:` → `transaction.on_commit(partial(_publish, notification))`. **Именно `partial`, не `lambda`** — гвард AC-10 ищет функцию, чей объект передан в `on_commit`; лямбда его не проходит. Регистрация — **внутри** существующего `try`, чтобы её собственный сбой попал в тот же non-fatal контракт.
  - [x] Приватная `_publish(notification) -> None`: строит `{"type": notification.kind, "payload": {…}}` (`business_date.isoformat()`, `timezone.localtime(created_at).isoformat()` — AC-8/AC-9), зовёт `async_to_sync(get_channel_layer().group_send)(group_name_for(notification.recipient), {"type": NOTIFY_MESSAGE_TYPE, "message": envelope})`, **всё тело — под собственным `try/except Exception: logger.exception(...)`** (AC-7). Свой `try` обязателен по ДВУМ причинам: (1) внутри транзакции колбэк выполняется ПОСЛЕ коммита, вне `try` из `notify()` — та давно вышла; (2) **вне транзакции (autocommit) `on_commit` выполняет колбэк НЕМЕДЛЕННО и инлайн** — то есть внутри `try` из `notify()`, и тогда сбой слоя был бы проглочен так, что `notify()` вернула бы `None` → `LaggingNotifyError` → catch-up мёртв. Собственный `try` в `_publish` — единственное, что закрывает обе ветки (тест — Task 4).
  - [x] Комментарий над `on_commit` — «почему именно так», а не «что делает»: запись синхронна (вариант B 5.7a, дискриминирующий тест `test_notify_visible_within_caller_transaction`), в `on_commit` уходит ТОЛЬКО сигнал; откат бизнес-транзакции обязан унести сигнал с собой (architecture.md#L459).
  - [x] Обновить докстринг модуля: строка «WS delivery is E11» (services.py:18) больше не верна — заменить на описание реализованного сигнала + явную фиксацию, что `notify()` остаётся non-fatal И для WS-ветки.
- [x] **Task 4 — Поведенческие тесты** (`apps/notifications/tests/test_ws_notify.py`, NEW) (AC: 4,6,7,8,9)
  - [x] **Имя файла — строго `test_ws_notify.py`, НЕ `test_notify_ws.py`.** Анти-скип-гвард 11.1 (`test_ws_guards.py:366`) сканирует `TESTS_DIR.glob("test_ws_*.py")`; при имени `test_notify_ws.py` самые ответственные тесты стори оказались бы **единственными WS-тестами, которые можно молча заскипать**.
  - [x] **🔴 Форма теста — не изобретать, взять эту (проверена прогоном).** Наивная форма из «подписчик + `notify()` в async-тесте» **не работает вообще**: `WsCommunicator` вынуждает `async def` (test_ws_consumer.py:70-124), Django ORM `@async_unsafe` → `SynchronousOnlyOperation`, а `async_to_sync` в потоке с работающим циклом → `RuntimeError: You cannot use AsyncToSync in the same thread as an async event loop`. ORM + `on_commit` + отправка обязаны жить в **синхронном островке**:
    ```python
    @pytest.mark.asyncio
    @pytest.mark.django_db
    async def test_commit_publishes_to_the_recipient_group(django_capture_on_commit_callbacks):
        communicator = _communicator(user_id="boss")
        assert (await communicator.connect())[0] is True

        def _work():  # синхронный островок: ORM + on_commit + async_to_sync живут ЗДЕСЬ
            with django_capture_on_commit_callbacks(execute=True):
                with transaction.atomic():
                    notify("boss", KIND, DAY, payload={"laggard_division_ids": ["x"]})

        await sync_to_async(_work, thread_sensitive=True)()   # thread_sensitive=True несущий
        got = await communicator.receive_json_from(timeout=5)
    ```
  - [x] **Фикстура `django_capture_on_commit_callbacks(execute=True)` ОБЯЗАТЕЛЬНА** (pytest-django 4.12 — наличие проверено). Под обычным `django_db` транзакция теста не коммитится → колбэки `on_commit` не выполняются НИКОГДА, и негативные тесты вакуумно зелёные (Ловушка №1).
  - [x] `test_commit_publishes_to_the_recipient_group` (AC-4 позитив, скелет выше): `receive_json_from` вернул конверт с `type == "SUBMISSION_LAGGING"`. **Через реальный слой, не через мок** — только так ловится msgpack-ловушка (AC-8).
  - [x] `test_rollback_publishes_nothing` (AC-4 негатив): `notify()` внутри atomic → `raise` → откат. Утверждать И «строки нет» И «сообщение не пришло». **Позитивный контроль тем же механизмом в том же модуле обязателен** — иначе «не пришло» неотличимо от «механизм не работает вовсе».
  - [x] `test_repeat_call_publishes_nothing` (AC-6): два `notify()` с одним ключом в одной коммитящейся транзакции → ровно ОДНО сообщение (второе — `receive_nothing`).
  - [x] `test_channel_layer_failure_is_non_fatal` (AC-7): патчить **`apps.notifications.services.get_channel_layer`** (не `channels.layers.get_channel_layer` — `services.py` связал имя у себя при импорте, патч источника молча ничего не даст и тест позеленеет по неверной причине) → `group_send` бросает `RuntimeError` → `notify()` вернула строку (**не `None`**), строка в БД есть, исключение не всплыло. Проверять оба следствия: «не упало» без проверки возврата пропустит регресс, который читает `lagging_check`.
  - [x] `test_autocommit_layer_failure_is_non_fatal` (AC-7, вторая ветка): то же, но **без `transaction.atomic`** (`django_db(transaction=True)`) — там `on_commit` выполняет колбэк немедленно и инлайн, внутри `try` из `notify()`. Без собственного `try` в `_publish` возврат схлопнется в `None` → `LaggingNotifyError`. Ветка отдельная и иначе не покрыта ничем.
  - [x] `test_ws_envelope_matches_read_api_projection` (AC-9): `envelope["payload"] == NotificationSerializer(notification).data` — **полное равенство значений**, не ключей (иначе расхождение tz-формата проходит незамеченным).
  - [x] `test_envelope_survives_the_real_channel_layer` (AC-8): принятый на той стороне конверт содержит `business_date`/`created_at` строками и пережил `json.dumps` — путь `msgpack → consumer → json` пройден целиком.
  - [x] Изоляция: `await communicator.disconnect()` в каждом тесте (утечка соединений = флейк — урок 11.1 Task 8).
- [x] **Task 5 — AST-гвард `group_send` только под `on_commit`** (`apps/notifications/tests/test_ws_guards.py`, MOD) (AC: 10)
  - [x] `test_group_send_only_inside_on_commit` + guard-the-guard на синтетическом сниппете (инлайн ловится, переданный в `on_commit` — нет). Стиль — точное зеркало существующих гвардов файла.
  - [x] **Обновить докстринг модуля** (`test_ws_guards.py:1-18`): он перечисляет «два инварианта», эта стори добавляет ещё два (реестр AC-2, `on_commit` AC-10). Устаревшая шапка = находка ревью.
- [x] **Task 6 — Гейт** (AC: 12)
  - [x] `make gate` из `Backend/VAPS`. Убедиться: ruff чист, `makemigrations --check` пуст, **`test_notify.py` зелёный без правок**, RBAC/audit-матрицы без новых строк, бюджет 300s не превышен.
  - [x] **Красная проба обязательна** (гейт AI-1 ретро E9) — минимум 4 ассерта, см. Dev Notes → «Красная проба».

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; менять осознанно)

> **№1 = A (реестр: ДОБАВИТЬ `SUBMISSION_LAGGING`, а НЕ переименовывать `kind`). Закрывает открытый вопрос №1 стори 11.1 — блокер этой стори.**
> Факты (проверены в коде, не по документу): единственный прод-эмиттер — `lagging_check.py:229` с `Notification.Kind.SUBMISSION_LAGGING`; это единственное значение `Kind`, оно же зашито в `CheckConstraint chk_notification_kind` (models.py:55-58) и в тестах 5.7a/5.7b/5.7c. В реестре его нет. Реестр — донорского происхождения (`source_spec: docs/PersonnelStatus/VAPS_7.8.2.md`), 24 типа, из которых в коде VAPS не эмитируется НИ ОДИН; `DAILY_MARK_MISSING` встречается 10 раз и все 10 — тестовые фикстуры-пробы 11.1, ноль прод-сайтов (проверено `grep`).
> **Вариант (б) «переименовать `kind` в `DAILY_MARK_MISSING`» отвергнут по трём причинам.** (1) *Семантика разная, а не «почти та же»:* `DAILY_MARK_MISSING` в реестре = «09:00 нет INITIAL-отметки», адресат «division operators», триггер — время суток; `SUBMISSION_LAGGING` = catch-up несдачи за **прошедший** день, адресаты — резолвнутые `NotifyRecipient`, триггер — watermark. Переименование склеило бы два разных события в один код и сожгло бы имя, которое понадобится настоящему 09:00-триггеру. (2) *Цена:* миграция данных + правка живого `CheckConstraint` + правки 5.7a/5.7b/5.7c и их тестов — ради строки в каталоге. (3) *Направление истины:* память проекта «сверять с raise-сайтами, не словарём» (инцидент 10.1, где `error-codes.yaml` нёс донор-фантомы) — здесь ровно тот же класс: живой код против донорского каталога.
> **Дополнительный аргумент ЗА (а):** шапка реестра утверждает «`type_code` здесь = и тип WS-конверта, и колонка БД». Сегодня это ложь. Вариант (а) делает утверждение истинным **без единой миграции** — и тогда AC-3 (тип конверта = `kind` напрямую, без мапы) становится не срезанием угла, а прямым следствием контракта.
> **Что делает решение необратимым в хорошую сторону:** гвард AC-2. Без него мы чиним один расход и оставляем механизм, который его породил.

> **№2 = A (в `on_commit` уходит ТОЛЬКО `group_send`; запись остаётся синхронной).**
> Соблазн «раз уж трогаем — унести в `on_commit` всё» уничтожил бы вариант B из 5.7a (Review D1), который выбран осознанно: строка видна сразу, `notify()` возвращает её, `lagging_check` читает возврат для решения об откате дня. Вариант A вернул бы `None` всегда → `LaggingNotifyError` на каждом вызове → catch-up мёртв. Дискриминирующий тест уже написан и стоит в репозитории с 5.7a (`test_notify_visible_within_caller_transaction`, докстринг прямо называет `on_commit` как то, что его сломает). **Если он покраснел — это не «тест устарел», это регресс.**

> **№3 = A (шлём только при `created is True`).**
> Альтернатива «слать на каждый вызов» отвергнута: `catch_up` по построению переспрашивает уже уведомлённые дни (идемпотентность-по-watermark), и «сигнал по факту вызова» превратил бы один ретрай в шторм дублей строк, которые не менялись. Инвариант: **WS-сигнал = изменение состояния, не факт вызова.** Побочно это чинит `notification, _ =` — отбрасывание `created` было безобидным ровно до сегодняшнего дня.

> **№4 = A (сбой WS проглатывается; возврат `notify()` неприкосновенен).**
> Колбэк `on_commit` выполняется вне `try` из `notify()` (та давно вернулась), поэтому нужен СВОЙ `try/except` в `_publish`. Непойманное исключение в `on_commit`-колбэке всплывает в вызывающий код **после** коммита — то есть «бизнес-операция уже применена, но вызвавший её код упал». Это худший из возможных исходов и ровно то, что запрещает architecture.md#L327.

> **№5 = A (kill-switch НЕ реализуем здесь).** `notify()` в 11.2 шлёт безусловно. Флаг — 11.5, с собственным тестом семантики отката. Заводить полу-флаг сейчас = две модели включения и тест, который ничего не доказывает.

### Архитектурные правила (developer guardrails)

- **Граница `notifications ← все` (architecture.md#L592).** `notify()` остаётся ЕДИНСТВЕННЫМ писателем и теперь — единственным отправителем. Не добавлять `group_send` в `lagging_check`, вьюхи или сигналы: сайт отправки один, и AC-10 это цементирует.
- **Слоевой контракт (architecture.md#L444-454).** `services.py` **не импортирует** `api/serializers.py` (инверсия слоя). Паритет формы держит тест (AC-9), а не импорт.
- **`notifications` ↛ `apps.core.models`** — AST-гвард `test_isolation.py`. Новые импорты (`channels.layers`, `asgiref.sync`, `django.db.transaction`) его не задевают, но прогнать явно (AC-12).
- **`timezone.now()` в домене запрещён** (гвард wall-clock). Время в конверте берётся из уже записанной строки (`created_at`, `auto_now_add`), часы не читаются вовсе.
- **Логи:** `logging.getLogger(__name__)`, structured, без ПДн, без `print()` (architecture.md#L460). В `_publish` логировать `recipient`/`kind`/`business_date` — уже принятый в `notify()` набор (services.py:56-61), новых полей не изобретать. **`request_id` в WS-ветке пуст** — известный и принятый пробел 11.1 (Task 6), не чинить здесь.
- **Никаких `if DEBUG:`-веток** (architecture.md#L338).
- **`makemigrations --check` обязан остаться пустым.** Решение №1 выбрано в том числе поэтому: `kind` не переименовывается → миграций нет. Если `--check` не пуст — что-то пошло не по спеке.

### Ловушки (проверено в коде/прогоном — не наступать)

1. **🔴 `on_commit` НЕ выполняется под обычным `pytest.mark.django_db`.** Тестовая транзакция откатывается и никогда не коммитится → колбэки просто отбрасываются. Следствие, которое и делает ловушку опасной: тест «на откате WS молчит» **вакуумно зелёный** — он зелен и когда `on_commit` вообще не реализован, и когда реализован неверно. Лечение: `django_capture_on_commit_callbacks(execute=True)` (pytest-django 4.12 — наличие подтверждено в `.venv`) ЛИБО `django_db(transaction=True)`. **Позитивный тест обязан идти тем же механизмом и в том же модуле** — иначе негативный ничего не доказывает. Это ровно паттерн «тесты, которые не могут упасть» из ретро E9 §3 (всплыл в ПЯТИ стори).
2. **🔴 msgpack не сериализует `date`/`datetime`.** Проверено прогоном: `msgpack.packb({'d': date(2026,7,19)})` → `TypeError: can not serialize 'datetime.date' object`. `channels_redis` пакует конверт msgpack'ом, дальше `consumers.notify_message` зовёт `json.dumps` — падение на `date` там же. Обе стадии проходятся ТОЛЬКО на реальном слое: сравнение словарей в памяти ловушку не видит. Отсюда AC-8 требует сквозной тест через Redis.
3. **Два разных `type` в одном вызове** (11.1 предупреждала прямым текстом). Конверт channel layer: `{"type": NOTIFY_MESSAGE_TYPE ("notify.message"), "message": {...}}` — маршрутизация к хендлеру. Конверт WS: `{"type": "SUBMISSION_LAGGING", "payload": {...}}` — ВНУТРИ `message`. Перепутать = либо `No handler for message type`, либо код реестра, потерянный на транспорте. `NOTIFY_MESSAGE_TYPE` **импортировать** из `groups.py`, не перепечатывать.
4. **🔴 `async_to_sync` внутри работающего event loop бросает `RuntimeError` — и это бьёт ИМЕННО в тестах этой стори.** В проде безопасно (`notify()` зовут синхронные сервисы, колбэк идёт в том же синхронном потоке). Но тест обязан держать реального WS-подписчика, а `WsCommunicator` вынуждает `async def` — и там ORM даёт `SynchronousOnlyOperation`, а `async_to_sync` → `RuntimeError: You cannot use AsyncToSync in the same thread as an async event loop` (оба воспроизведены прогоном). Лечение — синхронный островок `await sync_to_async(_work, thread_sensitive=True)()`, скелет в Task 4. **Прецедента в репозитории нет:** 11.1 обошла проблему, не ставя `django_db` вовсе (test_ws_consumer.py:9 «No `django_db` anywhere on purpose») — копировать оттуда нечего, 11.2 первой соединяет ORM и сокет в одном тесте.
5. **`get_channel_layer()` может вернуть `None`** при несконфигурированном `CHANNEL_LAYERS`. По 11.1 бэкенд захардкожен и env валидируется на старте, так что практически недостижимо — но `None.group_send` дал бы `AttributeError` внутри колбэка после коммита. Общий `try/except Exception` покрывает; отдельную ветку-проверку не городить.
6. **Колбэк захватывает `notification` по ссылке.** Внутри `if created:` объект уже сохранён и не мутируется дальше — безопасно. Не переносить сборку конверта внутрь колбэка «чтобы свежее»: это лишний повод потрогать ORM после коммита, а данные и так финальны.
7. **`on_commit` привязывается к ВНЕШНЕЙ atomic.** `lagging_check` зовёт `notify()` внутри per-day `transaction.atomic` — колбэк выполнится по коммиту этого блока (или будет отброшен на его откате). Это и есть желаемое поведение; специально ничего делать не надо, но понимать — надо.
8. **Отступы в YAML-реестре значимы для гварда.** Парсер — regex по отступу (PyYAML нет). Блок, добавленный с другим отступом, окажется «невидимым» и гвард покраснеет, указав на несуществующую проблему.

### Previous Story Intelligence

- **11.1 (done, предшественник).** Транспорт готов и **type-agnostic**: `notify_message` ретранслирует `event["message"]` дословно (consumers.py:78-81) → 11.2 не требует НИ ОДНОЙ правки транспорта. Экспортированы ровно те два контракта, которые здесь нужны: `group_name_for()` и `NOTIFY_MESSAGE_TYPE` (обе — в `groups.py`, с докстрингами, прямо адресованными 11.2). Ревью 11.1 (finding M3) специально вынесло `NOTIFY_MESSAGE_TYPE` в константу именно ради этой стори — воспользоваться, а не перепечатать. Открытый вопрос №1 из 11.1 («реестр vs код блокирует 11.2») закрыт здесь Решением №1.
- **Тестовая оснастка 11.1 переиспользуется целиком:** `WsCommunicator` поверх `asgiref.testing` (свой, т.к. `channels.testing` тянет daphne — решение Bratan, память проекта), `_CHANNELS_GROUP_RE`, паттерн `disconnect()` в каждом тесте. Не изобретать второй драйвер.
- **5.7a (done):** вариант B (синхронно in-txn) + non-fatal — оба контракта 11.2 обязана сохранить (AC-5, AC-7). `get_or_create` поглощает дубль в собственном savepoint (урок 5.6b) — поэтому `created` достоверен даже в гонке.
- **5.7b (done):** `lagging_check._emit_lagging` — единственный прод-вызыватель. Его реакция на `None` (откат дня + удержание watermark) — причина, по которой AC-7 сформулирован жёстко.
- **5.7c (done):** `NotificationSerializer` — форма, которую обязан повторить конверт (AC-9); read-API уже отдаёт `?since=` для дочитки после reconnect (11.3).
- **10.1 (инцидент, память проекта):** «живой бэк = raise-сайт + тип возврата, НЕ словарь» — `error-codes.yaml` нёс донор-фантомы. `ws-message-types.yaml` — тот же класс артефакта (24 донорских типа, 0 эмиттеров). Отсюда и Решение №1, и требование гварда AC-2.
- **Ретро E9 §3 + AI-1:** «тесты, которые не могут упасть» — здесь два кандидата на вакуум, оба закрыты явно: (а) `on_commit` под `django_db` (Ловушка №1); (б) AST/registry-гвард на пустом множестве файлов (`assert files` + пол ≥25 + guard-the-guard). Третий, найденный при валидации: (в) паритет конверта с read-API по КЛЮЧАМ вместо значений — зелен при разошедшемся формате времени (AC-9).
- **Дрейф чекбоксов (память проекта):** ревью сверяет каждый `[x]` с кодом, не с намерением. Отклонения — эскалировать в Completion Notes, а не помечать выполненным.

### Git Intelligence

- Baseline `3cce774`; предшественник 11.1 — `e2c7890`. Рабочее дерево содержит только untracked-артефакты automator'а.
- `on_commit` в прод-коде сегодня НОЛЬ (единственное упоминание — докстринг `test_notify.py:62`, где он назван как то, что сломало бы вариант B). 11.2 — первый. Прецедента в проекте нет → Ловушка №1 не «известная всем классика», а реальный риск этой конкретной стори.
- Параллельных стори по `apps/notifications/**` нет (10.x — фронт, `frontend/src/**`). Пересечений файлов не ожидается; при `maxParallel=2` конфликт возможен только по `docs/registries/` — маловероятно.
- Коммит (за Bratan, после ревью): `feat(story-11.2): публикация в WS из notify() через transaction.on_commit`. Артефакты агент НЕ коммитит. `graphify update .` — отдельным `chore`-коммитом после ревью (память: стори-цикл).
- Ревью: если та же модель — **красная проба обязательна** (AI-1/AI-2 ретро E9).

### Красная проба (гейт AI-1 ретро E9 — не намерение, а условие `done`)

Зафиксировать в ревью-секции «мутация X → тест покраснел» минимум для четырёх ассертов:
1. **AC-4 (`on_commit`):** заменить `transaction.on_commit(partial(_publish, n))` на прямой `_publish(n)` → тест отката обязан покраснеть (сообщение уходит о строке, которой не будет). **Это же доказывает не-вакуумность механизма `django_capture_on_commit_callbacks`** — если тест отката зелен и после этой мутации, он не проверяет ничего (Ловушка №1).
2. **AC-6 (`created`):** снять условие `if created:` (слать всегда) → тест повторного вызова обязан покраснеть на втором сообщении.
3. **AC-7 (non-fatal, ветка транзакции):** убрать `try/except` в `_publish` → тест сбоя слоя обязан покраснеть (исключение всплывает из колбэка после коммита).
4. **AC-7 (non-fatal, ветка autocommit):** та же мутация обязана покраснить `test_autocommit_layer_failure_is_non_fatal` **иначе** — возвратом `None` вместо всплывшего исключения. Разные симптомы одной мутации доказывают, что ветки покрыты обе, а не одна дважды.
5. **AC-8/AC-9 (tz и msgpack):** заменить `timezone.localtime(created_at).isoformat()` на голый `.isoformat()` → тест паритета с read-API обязан покраснеть. **Мутация вдвойне ценна:** она же проверяет, что паритет сравнивает ЗНАЧЕНИЯ, а не ключи (при сравнении ключей останется зелёным — то есть тест написан вакуумно). Отдельно: `business_date` объектом `date` вместо строки → сквозной тест через реальный слой краснеет на сериализации, доказывая, что гоняется РЕАЛЬНЫЙ слой.
6. **AC-2 (гвард реестра):** guard-the-guard встроен как постоянный тест (синтетический код вне реестра обязан ловиться).

Бэкап мутируемых файлов — через `cp`, восстановление — из бэкапа; **`git checkout` запрещён** (урок 9.6: стирает незакоммиченные ревью-правки). После восстановления — `diff` с бэкапом обязан быть IDENTICAL, прогон снова зелёный.

### Project Structure Notes

- **NEW:** `apps/notifications/tests/test_ws_notify.py` (имя обязано начинаться с `test_ws_` — анти-скип-гвард 11.1, Task 4).
- **MOD:** `apps/notifications/services.py`; `apps/notifications/tests/test_ws_guards.py`; `docs/registries/ws-message-types.yaml`.
- **Файлов 4** — в пределах ориентира «≤5». Одна ответственность: «`notify()` публикует сигнал в WS по коммиту». Прод-кода меняется ровно один файл.
- **`test_notify.py` в списке НЕТ намеренно** (AC-5): его неизменность — гейт корректности. Появление файла в `git diff` = сигнал ревью, а не деталь.
- **File List в Dev Agent Record обязан совпасть с `git diff --name-only 3cce774` + untracked** (AI-3 ретро E9: дрейф File List — 2 эпика подряд; на 11.1 это была находка ревью M1).

### Открытые вопросы (Bratan — не блокируют dev 11.2)

1. **Решение №1 принято в этой стори** (добавить `SUBMISSION_LAGGING` в реестр, не переименовывать `kind`) — это было отмечено 11.1 как решение Bratan. Аргументы и отвергнутая альтернатива — выше; при несогласии откат дешёвый: реализация не зависит от выбранного кода, меняется значение в YAML и в `Kind` (плюс миграция, если выбран вариант «б»). **Ревью: подтвердить явно.**
2. **Остальные 24 типа реестра остаются форвард-семенами** без эмиттеров. Гвард AC-2 сознательно однонаправленный (`code ⊆ registry`) — «нет сирот» появится, когда эпики 14-20 доедут. Зафиксировать в ретро E11.
3. **🟡 В реестре живёт ВТОРОЙ контракт payload, противоречащий AC-9.** `ws-message-types.yaml:22` объявляет `payload_fields: [type_code, title, body, entity_type, entity_id, action_url, priority, expires_at]` — ничего общего с реальной проекцией (`id/recipient/kind/business_date/payload/read_at/created_at`). Это донорское поле того же класса, что и `notifications_messages`. **Сознательно НЕ трогаем в 11.2** (AC-1 правит только шапку и добавляет тип; переписывать чужой контракт заодно — расширение скоупа), но AC-2 повышает файл до исполняемого контракта, оставляя внутри неисполняемую ложь. Решение Bratan: пометить `payload_fields` как донорское/неприменимое либо привести к факту — вход в 11.4, где конверт начнут рендерить.
4. **🟡 `SUBMISSION_LAGGING` отсутствует в списке пилотных событий UX** (EXPERIENCE.md#L187: `DAILY_MARK_MISSING`, `DAILY_MARK_ESCALATION`, `REPORT_READY`, `REPORT_FAILED`, `TEMP_PERMISSION_*`). После Решения №1 единственный реальный эмиттер системы — тип, которого UX не перечисляет, а колокольчик 11.4 обязан его рендерить (заголовок, иконка, приоритет, `action_url`). Не блокирует 11.2 (транспорт и конверт от текста не зависят), но **блокирует 11.4** — нужен текст/приоритет для `SUBMISSION_LAGGING` от Bratan.
5. **Наследуется от 11.1 (входы 12.1):** `?token=` не должен попадать в access-логи nginx (`/ws/` логировать без `$args`); `AllowedHostsOriginValidator` отложен осознанно (Решение №6 стори 11.1).
6. **Семантика fallback при kill-switch расходится** (architecture.md#L327 «ручной refresh» vs Story 11.5/EXPERIENCE.md#L276 «polling») — решить к 11.5.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1236-1242] — Story 11.2 AC (откат → WS молчит; коммит → БД + `{"type", "payload"}`).
- [Source: _bmad-output/planning-artifacts/epics.md#L1226-1234, #L1244-1274] — Epic 11: 11.1 (сделано) и 11.3-11.6 (границы AC-11).
- [Source: _bmad-output/planning-artifacts/epics.md#L759] — «НЕ вводить Celery».
- [Source: _bmad-output/planning-artifacts/architecture.md#L459] — WS-конверт `{"type": UPPER_SNAKE из реестра, "payload"}`; «отправка **только** через `transaction.on_commit`» (основание AC-4 и AC-10).
- [Source: _bmad-output/planning-artifacts/architecture.md#L327] — best-effort + дочитка REST; «событие в БД — истина, WS — сигнал» (основание AC-7).
- [Source: _bmad-output/planning-artifacts/architecture.md#L592] — граница «notifications ← все: только `notifications.services.notify()` (синхронно in-txn, вариант B 5.7a; non-fatal)».
- [Source: _bmad-output/planning-artifacts/architecture.md#L444-454] — layer contract (основание запрета импорта `api.serializers` из `services.py`).
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L159] — FR-35.
- [Source: Backend/VAPS/apps/notifications/services.py:28-62] — `notify()`: единственный файл прод-кода, который меняется; `notification, _ = get_or_create` (строка 44) → `created`.
- [Source: Backend/VAPS/apps/notifications/groups.py:11-18, 21-41] — `NOTIFY_MESSAGE_TYPE` и `group_name_for()`: контракты, экспортированные 11.1 специально для этой стори.
- [Source: Backend/VAPS/apps/notifications/consumers.py:9-25, 78-81] — два разных «type»; `notify_message` ретранслирует `event["message"]` дословно (транспорт не трогаем).
- [Source: Backend/VAPS/apps/notifications/models.py:22-23, 55-58] — `Kind.SUBMISSION_LAGGING` (единственное значение) и `chk_notification_kind` (цена варианта «б»).
- [Source: Backend/VAPS/apps/notifications/api/serializers.py:13-21] — `NotificationSerializer.Meta.fields` — эталон формы `payload` (AC-9).
- [Source: Backend/VAPS/apps/notifications/tests/test_notify.py:59-71, 119-129] — `test_notify_visible_within_caller_transaction` (дискриминирующий для варианта B, докстринг называет `on_commit`) и `test_notify_not_emitted_on_rollback`. **Файл не править** (AC-5).
- [Source: Backend/VAPS/apps/operations/submissions/services/lagging_check.py:200-248] — единственный прод-вызыватель; реакция на `None` → `LaggingNotifyError` + удержание watermark (основание AC-7).
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_consumer.py:1-80, 367-435] — `WsCommunicator`, `_send_from_another_process`, паттерны конвертов — переиспользовать.
- [Source: Backend/VAPS/apps/audit/tests/test_audit_coverage.py:126-143, 147-172] — `_registry_actions()` (парсинг YAML без PyYAML), `test_emitted_actions_subset_of_registry` (решение «однонаправленно»), `test_scan_detects_both_emission_forms` (guard-the-guard) — образцы для AC-2.
- [Source: Backend/VAPS/apps/notifications/tests/test_isolation.py:25-49] — `_module_files`/`_imports` + анти-вакуумный `assert files` — образец для AC-10.
- [Source: Backend/VAPS/apps/notifications/tests/test_ws_guards.py:1-18, 366-386] — устаревающая шапка «два инварианта» (Task 5) и анти-скип-гвард с `glob("test_ws_*.py")` — диктует имя нового файла (Task 4).
- [Source: Backend/VAPS/config/settings.py:147] — `TIME_ZONE = "Asia/Qyzylorda"`: причина расхождения `.isoformat()` с рендером DRF (AC-9).
- [Source: docs/registries/ws-message-types.yaml:11-12, 22] — оба вхождения фантомной `notifications_messages` (Task 1) и донорский `payload_fields`, противоречащий AC-9 (открытый вопрос №3).
- [Source: docs/registries/ws-message-types.yaml:1-24] — шапка-контракт (`type_code` = тип конверта и колонка БД) и `growth_rule` «тип не в реестре → СТОП; новые типы — тем же PR» (основание AC-1).
- [Source: _bmad-output/implementation-artifacts/11-1-channels-и-channels-redis.md#Открытые вопросы] — открытый вопрос №1 (реестр vs код), объявленный блокером 11.2 → закрыт Решением №1.
- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md] — AI-1 (красная проба = гейт), AI-2 (cross-model ревью), AI-3 (дрейф File List), §3 («тесты, которые не могут упасть»).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:495, 509] — unread-индекс (→11.4); курсор `?since=` и замена поллинга WS (→11.3).
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md#L187] — пилотные события и роль WS как ускорителя; расхождение fallback-семантики (открытый вопрос №4).
- [Source: прогон в `.venv`, 2026-07-19] — pytest-django 4.12.0 (фикстура `django_capture_on_commit_callbacks` доступна), Django 5.1.15, channels 4.3.2, PyYAML 6.0.3 (транзитивно через `drf-spectacular`, в `pyproject.toml` НЕ объявлен — основание AC-2); `msgpack.packb({'d': date(...)})` → `TypeError` (AC-8); `async_to_sync` в потоке с работающим циклом → `RuntimeError`, через `sync_to_async(..., thread_sensitive=True)` — работает (Ловушка №4, Task 4); `timezone.localtime(created_at).isoformat()` == рендер DRF байт-в-байт, голый `.isoformat()` — нет (AC-9).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`, bmad-dev-story, 2026-07-19.
⚠️ **Same-model caveat:** спека 11.2 писалась той же моделью → красная проба
обязательна (AI-1/AI-2 ретро E9) и выполнена, см. ниже; ревью — cross-model.

### Debug Log References

- `make gate` (из `Backend/VAPS`): **2313 passed, 56 deselected, 71s** (бюджет
  300s). `ruff check .` чист, `makemigrations --check --dry-run` — «No changes
  detected». Первый прогон был КРАСНЫМ — см. отклонение №3.
- `apps/notifications/` — 108 passed (101 до стори + 7 новых).
- AC-12 точечно: `test_notify.py` (**зелёный, файл не тронут** — `git diff
  --stat 3cce774` по нему пуст), `test_notifications_read_api.py`,
  `test_isolation.py`, `test_ws_consumer.py`, `test_ws_e2e.py`,
  `apps/operations/submissions/tests/` → 556 passed.
- ⚠️ В этом точечном прогоне (БЕЗ `-m` фильтра гейта) один teardown-ERROR:
  `test_document_release.py::test_concurrent_issue_exactly_one_wins_no_number_gap`.
  **Не регресс 11.2:** тест помечен `@pytest.mark.concurrency`, в гейте
  дизелектится (проверено: `-m "not ... not concurrency ..."` → 16 passed,
  1 deselected), причина — `django_db(transaction=True)` + append-only
  `audit_logs` (см. отклонение №2). Известный класс (память проекта:
  «test-full concurrency teardown»), к notifications отношения не имеет.

### Completion Notes List

Реализовано: `notify()` публикует WS-сигнал о СОЗДАННОЙ строке через
`transaction.on_commit(partial(_publish, notification))`; запись в БД осталась
синхронной и внутри транзакции вызывающего (вариант B 5.7a не тронут); сбой слоя
проглатывается в собственном `try` внутри `_publish` и не может изменить возврат
`notify()`. Реестр `ws-message-types.yaml` разыменован и впервые стал
исполняемым контрактом (гвард `code ⊆ registry`), добавлен форвард-гвард
«`group_send` только под `on_commit`».

**🔴 ТРИ ОТКЛОНЕНИЯ ОТ СПЕКИ — ревью обязано подтвердить каждое:**

1. **Task 4: `django_capture_on_commit_callbacks` применена НЕ ко всем тестам**
   (спека называла её ОБЯЗАТЕЛЬНОЙ для всех). Фикстура стоит только в
   `test_channel_layer_failure_is_non_fatal` — единственном тесте на главном
   потоке, где Ловушка №1 реальна. Причина: **проверено эмпирически**, что
   синхронный островок `sync_to_async(..., thread_sensitive=True)` выполняется в
   отдельном потоке (`ThreadPoolExecutor-0_0`), а соединения Django
   thread-local → островок получает СВОЁ соединение и не видит строк, записанных
   главным потоком внутри тестовой atomic. Значит atomic pytest-django его не
   накрывает, и `transaction.atomic()` в островке — НАСТОЯЩАЯ транзакция:
   реальный COMMIT реально запускает `on_commit`, реальный ROLLBACK реально его
   отбрасывает. Фикстура эмулировала бы коммит, который и так происходит, —
   строго слабее. Цель подпункта (не-вакуумность) достигнута и **доказана
   мутацией**: инлайн-`_publish` роняет тест отката (проба №1).
2. **Task 4: `django_db(transaction=True)` для autocommit-ветки НЕ применён — он
   в этом проекте нерабочий.** Его teardown делает `flush` → `TRUNCATE` по всем
   таблицам, а `audit_logs` отклоняет TRUNCATE на уровне БД (story 4.2,
   ARCH-SEC-032, триггер `audit_logs_reject_modification`) → `CommandError:
   Database test_vaps couldn't be flushed`. Воспроизведено. Все существующие
   `transaction=True`-тесты репозитория помечены `concurrency`/`slow` и бегут
   только в `test-full` — они и есть источник известных teardown-ERROR; тащить
   такой в ГЕЙТ нельзя. Autocommit-ветка покрыта иначе: в островке вне `atomic`
   соединение и так в autocommit, `on_commit` выполняет колбэк немедленно и
   инлайн — ровно целевая ветка. **Доказано мутацией:** одна и та же мутация
   (снять `try` в `_publish`) роняет обе ветки РАЗНЫМИ симптомами (пробы №3/№4).
3. **Dev Notes AC-9 содержали неверный факт — исправлено в коде.** Спека
   утверждала: «`timezone.localtime()` — перевод уже сохранённого значения…
   гвард wall-clock не задевается». **Это не так:** `timezone.localtime` стоит в
   `WALL_CLOCK_DENYLIST` (`apps/core/tests/test_isolation.py`) наряду с
   `timezone.now` — и справедливо, ибо без аргумента `localtime()` читает часы, а
   AST-гвард форму вызова не различает. Первый `make gate` был красным именно
   на этом. Гвард НЕ ослаблялся (чужой инвариант из E1). Вместо этого введён
   `_local_isoformat()` = `value.astimezone(timezone.get_current_timezone())
   .isoformat()` — буквально то, что `timezone.localtime(value)` делает внутри,
   и то, что делает DRF `enforce_timezone`. Паритет с read-API сохранён
   побайтово (тест сравнивает ПОЛНЫЕ значения), а «часы не читаются» стало
   структурным свойством, а не обещанием.

**Красная проба (гейт AI-1 — выполнена, бэкап через `cp`, `git checkout` НЕ
использовался; восстановление сверено `diff` → IDENTICAL, гейт снова зелёный):**

| # | Мутация | Тест | Симптом |
|---|---|---|---|
| 1 | `on_commit(partial(_publish, n))` → инлайн `_publish(n)` | `test_rollback_publishes_nothing` | 🔴 FAILED — сообщение уходит о строке, которой не будет. Заодно доказывает не-вакуумность механизма коммита (Ловушка №1) |
| 2 | снять условие `if created:` | `test_repeat_call_publishes_nothing` | 🔴 FAILED на втором сообщении |
| 3 | убрать `try/except` в `_publish` | `test_channel_layer_failure_is_non_fatal` | 🔴 FAILED — `RuntimeError: channel layer is down` всплыл после коммита |
| 4 | **та же** мутация | `test_autocommit_layer_failure_is_non_fatal` | 🔴 FAILED **другим** симптомом — `assert None is not None` (возврат схлопнулся) ⇒ ветки покрыты обе, а не одна дважды |
| 5a | `_local_isoformat()` → голый `.isoformat()` | `test_ws_envelope_matches_read_api_projection` | 🔴 FAILED — расхождение tz-формата; красный доказывает, что паритет сравнивает ЗНАЧЕНИЯ, а не ключи |
| 5b | `business_date` объектом `date` | `test_envelope_survives_the_real_channel_layer` | 🔴 FAILED — сообщение НЕ доходит вовсе (msgpack падает внутри проглатывающего `try`) ⇒ гоняется РЕАЛЬНЫЙ слой, сравнение словарей это не поймало бы |
| 6 | — | `test_registry_parse_rejects_unknown_kind`, `test_scan_detects_group_send_outside_on_commit` | guard-the-guard встроены постоянными тестами |

Дополнительно: гвард реестра проверен на версию файла из HEAD (24 типа, без
`SUBMISSION_LAGGING`) — был бы КРАСНЫМ до Task 1, то есть чинит реальное
расхождение, а не фиксирует статус-кво.

**Открытые вопросы стори не закрывались** (№3 `payload_fields`, №4 UX-текст для
`SUBMISSION_LAGGING`) — оба вход в 11.4, как и предписано. Решение №1
(добавить тип, не переименовывать `kind`) реализовано; миграций нет,
`makemigrations --check` пуст.

⚠️ **Для ревью — о рабочем дереве:** в worktree параллельно шла стори 10.3, и
`git diff --name-only 3cce774` содержит ЧУЖИЕ файлы (`frontend/src/**`,
`docs/contracts/09-01-*`, `.claude/settings.json`). К 11.2 они отношения не
имеют; File List ниже — ровно и только файлы этой стори (AI-3).

### File List

**MOD** (прод-код — ровно один файл):
- `Backend/VAPS/apps/notifications/services.py`

**MOD** (тесты/реестр):
- `Backend/VAPS/apps/notifications/tests/test_ws_guards.py`
- `docs/registries/ws-message-types.yaml`

**NEW**:
- `Backend/VAPS/apps/notifications/tests/test_ws_notify.py`

**Трекинг (не код стори)**:
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — статус →
  `in-progress` → `review`
- `_bmad-output/implementation-artifacts/11-2-публикация-в-ws-из-notify.md` —
  этот файл
- `_bmad-output/implementation-artifacts/tests/test-summary-11-2.md` — сводка
  QA-шага (добавлен ревью: 6 поведенческих тестов + 1 гвард дописаны ПОСЛЕ
  dev-шага, см. Change Log)

`test_notify.py` в списке ОТСУТСТВУЕТ намеренно (AC-5): его неизменность —
гейт корректности варианта B, проверено `git diff` (пусто).

### Change Log

| Дата | Версия | Изменение |
|---|---|---|
| 2026-07-19 | 11.2 | `notify()` публикует WS-сигнал через `transaction.on_commit` (AC-3..AC-9): конверт `{"type": kind, "payload": <проекция read-API>}`, только при `created`, non-fatal в обеих ветках (транзакция + autocommit) |
| 2026-07-19 | 11.2 | Реестр `ws-message-types.yaml`: легализован `SUBMISSION_LAGGING`, шапка приведена к факту (`notifications.kind` вместо донорского `notifications_messages`, оба вхождения) — AC-1 |
| 2026-07-19 | 11.2 | Реестр стал исполняемым контрактом: гвард `Notification.Kind ⊆ types` + пол ≥25 + guard-the-guard (AC-2); форвард-гвард «`group_send` только под `on_commit`» + guard-the-guard (AC-10); шапка `test_ws_guards` обновлена с двух инвариантов до четырёх |
| 2026-07-19 | 11.2 | NEW `test_ws_notify.py` — 7 поведенческих тестов через РЕАЛЬНЫЙ Redis-слой (коммит/откат/повтор/сбой слоя ×2 ветки/паритет с read-API/сквозная сериализация) |
| 2026-07-19 | 11.2 | Отклонение №3: `timezone.localtime` заменён на `_local_isoformat()` (`astimezone(get_current_timezone())`) — `localtime` в wall-clock denylist, гвард ARCH-DATA-022 не ослаблялся |
| 2026-07-19 | 11.2 | QA-шаг (после dev, та же модель): `test_ws_notify.py` 7→13 тестов (адресация ×2, savepoint, повтор в отдельной txn, лог сбоя, `None`-слой), `test_ws_guards.py` +1 (отступы реестра); гейт 2313→2320. Детали и красная проба — `tests/test-summary-11-2.md` |
| 2026-07-19 | 11.2 | Ревью (cross-model, Fable 5): Approve — 0 critical/0 high; гейт перепрогнан (2320 passed, 74s), 2 красные пробы воспроизведены независимо; Решение №1 подтверждено явно; статус → done. Правки ревью — только запись стори (дрейф Change Log/File List после QA-шага) |

## Senior Developer Review (AI)

**Ревьюер:** Bratan (автономный review-цикл story-automator) · **Дата:** 2026-07-19 ·
**Модель ревью:** Claude Fable 5 (`claude-fable-5`) — **cross-model** относительно
dev/QA (оба — Opus 4.8), требование AI-2 ретро E9 выполнено.

**Итог: APPROVE.** 0 critical, 0 high. Реализация соответствует всем 12 AC; три
заявленных отклонения проверены и подтверждены; найденные проблемы — только
дрейф записи стори после QA-шага (исправлен этим ревью, см. Change Log).

### Проверено против кода и прогоном (не по документу)

- **Гейт перепрогнан ревью:** `make gate` из `Backend/VAPS` — **2320 passed,
  56 deselected, 71.67s** (бюджет 300s); `ruff check .` чист; `makemigrations
  --check --dry-run` — «No changes detected» (AC-11/AC-12). `apps/notifications`
  — 117 passed, прогнан трижды (гейт + 2 повтора) — стабильно, флейка нет.
- **AC-5 (гейт корректности):** `git diff 3cce774 -- test_notify.py` пуст —
  файл не тронут, дискриминирующий тест варианта B зелёный без правок.
- **AC-11 (границы):** `consumers.py`/`routing.py`/`groups.py`/`config/asgi.py`
  без диффа; прод-код стори — ровно один файл (`services.py`). File List
  совпадает с `git diff --name-only 3cce774` + untracked (чужие файлы в
  worktree — стори 10.3, frontend, к 11.2 не относятся — подтверждено).
- **AC-10:** единственный прод-сайт `group_send` — `services._publish`,
  передан в `on_commit` через `partial` (AST-гвард и реализация сошлись).
- **AC-7 против raise-сайта:** `lagging_check.py:229-246` — `row is None` →
  `LaggingNotifyError`; обе ветки non-fatal (транзакция + autocommit) покрыты
  разными тестами, симптомы расходятся (проба dev №3/№4) — сверено с кодом,
  не со словарём (память: инцидент 10.1).
- **Красная проба — независимое воспроизведение (2 из 10 заявленных, cp-бэкап,
  restore `diff` → IDENTICAL, `git checkout` не использовался):**
  1. снять `if created:` → 🔴 ровно `test_repeat_call_publishes_nothing` +
     `test_repeat_call_in_a_separate_transaction_publishes_nothing`, остальные 11 зелёные;
  2. голый `.isoformat()` для `created_at` → 🔴 ровно
     `test_ws_envelope_matches_read_api_projection` +
     `test_envelope_survives_the_real_channel_layer`.
  Таблицы проб dev-шага и QA-шага признаются достоверными.

### Три отклонения dev-шага — подтверждены

1. **Фикстура не во всех тестах** — обоснование верно: `sync_to_async(...,
   thread_sensitive=True)` без внешнего `AsyncToSync` уходит в отдельный
   executor-поток asgiref → своё thread-local соединение → atomic pytest-django
   островок не накрывает, коммиты/откаты в нём настоящие. Не-вакуумность
   доказана пробой №1 (и воспроизведена ревью).
2. **`transaction=True` не используется** — совпадает с памятью проекта
   (append-only `audit_logs` отклоняет TRUNCATE teardown-flush; все такие тесты
   в репо помечены `concurrency`/`slow` и живут в `test-full`).
3. **`_local_isoformat` вместо `timezone.localtime`** — проверено:
   `timezone.localtime` действительно в `WALL_CLOCK_DENYLIST`
   (`apps/core/tests/test_isolation.py:56-58`), `astimezone`/
   `get_current_timezone` — нет; гвард не ослаблялся (диффа по core-тестам нет);
   байт-паритет с DRF держит тест полного равенства значений.

### Решение №1 — подтверждено явно (открытый вопрос №1)

Добавить `SUBMISSION_LAGGING` в реестр, НЕ переименовывать `kind` — верно.
Сверено с raise-сайтом: единственный живой эмиттер
(`lagging_check.py:231`) шлёт `Notification.Kind.SUBMISSION_LAGGING`
(единственное значение `Kind`, models.py:22-23, зашито в `CheckConstraint`);
семантика `DAILY_MARK_MISSING` (09:00-триггер) другая; миграций нет.
Гвард AC-2 делает механизм расхождения невоспроизводимым.

### Findings

| # | Sev | Находка | Действие |
|---|---|---|---|
| 1 | MEDIUM | Запись стори устарела после QA-шага: Change Log «7 поведенческих тестов» / Debug Log «2313 passed», «108 passed (101+7)» — фактически 13 тестов в `test_ws_notify.py`, 25 в `test_ws_guards.py`, 117 в приложении, гейт 2320; QA-добавки жили только в `tests/test-summary-11-2.md`, из стори не видимы | ✅ Исправлено ревью: строка QA-шага в Change Log + `test-summary-11-2.md` в File List (трекинг). Числа Debug Log оставлены как исторические — снимок dev-времени |
| 2 | LOW | Внутренняя несостыковка спеки: Task 2 говорит «пол ≥24», AC-2 — «≥25»; код реализует 25 (строже, по AC-2) | Без правки кода — верное направление уже выбрано; зафиксировано здесь |
| 3 | LOW | QA-сводка поднимает нерешённый вопрос конвенции: пофайловые `test-summary-N-M.md` против дефолта скилла `test-summary.md` — третий прогон подряд отклоняется от дефолта | Решение за Bratan (вход в ретро E11); не блокирует |

Рассмотрено и отклонено как не-находки: unscoped `delete()` в `_island`
(единственный писатель, обоснование в докстринге верно); импорт `_communicator`
из `test_ws_consumer` (переиспользование оснастки 11.1 предписано спекой);
«лишние» 6 тестов сверх Task 4 (аддитивные, каждый закрывает реальную дыру,
красные пробы есть).

### Открытые вопросы — статус после ревью

Подтверждено: №3 (`payload_fields` — донорская ложь в реестре) и №4 (UX-текст
для `SUBMISSION_LAGGING`) осознанно НЕ закрыты — оба вход в 11.4, как
предписано. №2, №5, №6 — без изменений (11.4/12.1/11.5).
