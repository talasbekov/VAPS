---
name: vaps-ws-testing-no-daphne
description: "WS-тесты VAPS: channels.testing НЕ импортировать (тянет daphne); свой WsCommunicator поверх asgiref.testing — решение Bratan на 11.1"
metadata: 
  node_type: memory
  type: project
  originSessionId: fc21873d-8fa8-40f5-807d-6856043b686e
  modified: 2026-07-19T08:13:40.854Z
---

**Решение Bratan (dev-story 11.1, 2026-07-19).** WS-тесты в VAPS НЕ используют `channels.testing.WebsocketCommunicator`.

Причина механическая: `channels/testing/__init__.py` безусловно импортирует `.live`, а тот — `from daphne.testing import DaphneProcess` (проверено на channels 4.3.2). Импорт подмодуля не спасает — `__init__` пакета выполняется всегда. Установка daphne = +14 транзитивных пакетов (Twisted, autobahn, pyOpenSSL, service-identity…) и 3 C-расширения (`zope.interface`, `ujson`, `cbor2`) в offline-зеркало контура; AC-1 стори daphne запрещал прямо.

**Что вместо:** `WsCommunicator` в `apps/notifications/tests/test_ws_consumer.py` — подкласс `asgiref.testing.ApplicationCommunicator` (asgiref уже жёсткая зависимость channels). Своими руками только `__init__` (сборка scope), `connect`, `receive_json_from`, `disconnect`; `receive_output`/`receive_nothing`/`wait` наследуются. Единственное, что обёртка channels добавляет поверх asgiref — патч `close_old_connections` в no-op, а для ORM-free consumer'а это пустышка.

**Как применять:** стори 11.3/11.4/11.6 при написании WS-тестов переиспользуют этот класс, а не тянут daphne «чтобы было проще». Если понадобится `ChannelsLiveServerTestCase` (реальный сервер, Playwright-e2e 11.6) — это отдельный разговор с Bratan, daphne там может стать оправдан.

**Сопутствующее (11.1):** `pytest-asyncio` в `asyncio_mode = "strict"` — явный `@pytest.mark.asyncio`. Autouse **async**-фикстура ломает коллекцию синхронных тестов в том же файле (`AssertionError` в плагине) — не заводить их.

**ORM + WS в одном тесте (найдено при create-story 11.2, проверено прогоном).** 11.1 обошла проблему, не ставя `django_db` вовсе, — с 11.2 так уже нельзя. Наивная форма «async-тест с `WsCommunicator` + вызов сервиса с ORM» не работает вообще: `WsCommunicator` вынуждает `async def`, Django ORM `@async_unsafe` → `SynchronousOnlyOperation`, а `async_to_sync` в потоке с работающим циклом → `RuntimeError: You cannot use AsyncToSync in the same thread as an async event loop`. Рабочая форма — синхронный островок: ORM + `transaction.on_commit` + `async_to_sync` внутри обычной функции, вызванной через `await sync_to_async(_work, thread_sensitive=True)()`; `thread_sensitive=True` несущий.

**`transaction.on_commit` под обычным `django_db` НЕ выполняется никогда** (тестовая транзакция не коммитится) → негативный тест «на откате не шлём» вакуумно зелёный и при полном отсутствии реализации. Лечение: `django_capture_on_commit_callbacks(execute=True)` (pytest-django 4.12 есть) либо `django_db(transaction=True)`; позитивный контроль обязан идти тем же механизмом.

**msgpack не сериализует `date`/`datetime`** (`channels_redis` пакует конверт им): всё, что уходит в `group_send`, — только JSON-примитивы. Ловушка видна ТОЛЬКО на реальном слое — сравнение словарей в памяти её не ловит.

См. [[vaps-arch-guards]], [[bmad-story-cycle-flow]], [[vaps-verify-against-raise-sites]].
