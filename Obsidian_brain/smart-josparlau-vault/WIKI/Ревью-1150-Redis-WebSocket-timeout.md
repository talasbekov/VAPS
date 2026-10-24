# №1150 — независимое scoped review Redis timeout канала WebSocket

Дата: 10.09.2026. Исполнитель: Кодекс Астра 6.

Scope: `c4931289..66360b3321e7202023ab4277e4fb6fb2178c7e82`, только contour.py; diff `QA-Audits/contour-2026-09-10/1150-review.diff`. Требование — устранить наблюдаемый в браузере reconnect после accepted WebSocket из-за Redis TimeoutError, сохранив HTTP/WS и cache/auth без расширения правки. Прочитаны текущий Infrastructure/Changelog и diff; независимое чтение исходника библиотек выполнено в существующем backend-образе через разрешённый nested docker exec.

## Вердикты

**Spec compliance: PASS для исправления кода. Code quality: PASS.** Critical: 0. Important: 0. Minor: 0. Фактическая стабильность idle WebSocket после установки остаётся браузерной проверкой контроллера.

## Независимые доказательства

Read-only inspect в `sj-offline-daemon-1138` → `smart-josparlau-contour-final-backend-1` показал:

- Фактическая сигнатура redis.asyncio.connection.AbstractConnection.__init__: socket_timeout=5, socket_connect_timeout=5.
- RedisChannelLayer.brpop_timeout = 5.
- channels_redis.utils.create_pool копирует dict host и передаёт его ключи в `aioredis.ConnectionPool(**host)`: обе новые настройки действительно доходят до Redis pool.
- `_brpop_with_clean` вызывает `await connection.bzpopmin(channel, timeout=timeout)`; серверный timeout5 не отменяется изменением socket timeout.
- Redis read_response при отсутствии timeout аргумента берёт `self.socket_timeout`. Значение None исключает блок async_timeout; при прежнем self.socket_timeout5 его истечение отключало соединение и выбрасывало `TimeoutError: Timeout reading from …`.
- Ветка except BaseException с disconnect и повторным raise сохраняет отменяемость асинхронного ожидания.

Вывод команды чтения завершился exit0. Настройки runtime, переменные окружения, секреты и сообщения пользователей не выводились; выполнялись только inspect.signature/getsource и чтение константы.

## Оценка diff

Переопределение CHANNEL_LAYERS только в contour заменяет tuple host/port на поддерживаемый dict с теми же REDIS_HOST/REDIS_PORT. `socket_timeout=None` убирает гонку клиентского5-секундного таймера с серверным BZPOPMIN5; `socket_connect_timeout=5` сохраняет ограничение установления соединения. Backend RedisChannelLayer, hosts, номер default DB, topology и прочие defaults остаются прежними. Cache/Celery/Auth/frontend diff не меняет.

Граница действия описана точно: отсутствие клиентского read timeout относится ко всем операциям этого channel-layer pool, а не только к BZPOPMIN; это не обещание обнаруживать зависший Redis за5секунд. Для штатного пустого канала блокирующая команда ограничена сервером, и выбранная настройка устраняет подтверждённую причину reconnect. Дополнительных изменений вне scope не требуется.

Reviewer не запускал тесты, сборку, HTTP/WS-сеансы, новые контейнеры или изменения runtime. Исходники не менялись. Связанные материалы: [[Ревью-1138-Офлайн-бандл]], [[Бриф-1138-Офлайн-бандл-report]].
