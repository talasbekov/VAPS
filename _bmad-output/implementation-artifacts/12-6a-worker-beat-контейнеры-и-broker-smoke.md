---
baseline_commit: 947082d
---

# Story 12.6a: worker/beat-контейнеры и broker-smoke

Status: review

## Story

As a **разработчик**,
I want **`worker`+`beat`-контейнеры в `deploy/docker-compose.yml` + реальный smoke-тест «задача реально исполняется через брокер» в `test-full`**,
so that **12.6's зарегистрированные beat-задачи не остаются мёртвой конфигурацией — стек реально способен их исполнить, доказано живым прогоном, не только импорт-проверкой**.

## Acceptance Criteria

Источник: `epics.md#L1318-1324` (буква стори, вторая половина: «smoke исполнения через брокер (test-full)») + карв-аут, заведённый при create-story 12.6 (`sprint-status.yaml`'s комментарий) + `deploy/docker-compose.yml`'s комментарий (обновлён 12.6-ревью), явно называющий эту стори адресом контейнеров.

1. **AC-1 (`worker`+`beat`-контейнеры в `deploy/docker-compose.yml`).** `celery -A config worker --loglevel=info` + `celery -A config beat --loglevel=info` — два НОВЫХ сервиса, используют ТОТ ЖЕ образ, что `app` (build-конфигурация идентична — `vaps-app:${VAPS_APP_SHA:-dev}`, тот же `Dockerfile`, 12.1/12.3), НЕ публикуют портов (ничего не принимают снаружи), зависят от `postgres`+`redis` (`condition: service_healthy`), тот же `.env`. `restart: unless-stopped` (тот же принцип, что остальные 4 сервиса, 12.1).
2. **AC-2 (broker-smoke — реальный worker, реальный broker, реальная задача, `test-full`-tier).** Новый тест, помечен `@pytest.mark.slow` (гейт его пропускает — `not slow` уже в фильтре gate; `test-full` включает). Живьём: запускает `celery -A config worker` ПОДПРОЦЕССОМ, поднятым на gate-харнесс-Redis (порт 6380, та же переменная `VAPS_REDIS_URL`, что уже использует `make test-full`), диспатчит РЕАЛЬНУЮ задачу (`materialize_status_effects_task`, безопасна/идемпотентна против гейт-харнесс-БД) через `.delay()` (не `.apply()` — тот синхронный, не проверяет брокер вовсе, 12.6's собственный `.apply()`-прогон это уже покрыл), дожидается исполнения (polling с таймаутом), завершает подпроцесс.
3. **AC-3 (наблюдаемость результата без включения `CELERY_RESULT_BACKEND` в проде).** 12.6's ревью-фикс намеренно отключил result backend (никто его не читает в проде — `CELERY_TASK_IGNORE_RESULT=True`). Тест НЕ включает его глобально (не трогает `config/settings.py`) — временно переопределяет `celery_app.conf.result_backend` ТОЛЬКО на время своего прогона (через `celery_app.conf.update(...)`, restore в `finally`), используя тот же Redis, что уже брокер — не новая инфраструктура, только временная настройка для наблюдения за исходом ОДНОГО smoke-прогона.
4. **AC-4 (`deploy/docker-compose.yml`'s комментарий закрыт).** Комментарий (12.1, обновлён 12.6-ревью), называющий эту стори адресом контейнеров, — переписан на факт: контейнеры добавлены, `CELERY_BEAT_SCHEDULE` больше не «мёртвая конфигурация».
5. **AC-5 (регресс нулевой).** `make gate` зелёный (worker/beat-сервисы не запускаются в gate — только в живом прогоне этой стори и в проде). `make test-full` — новый smoke реально зелёный (не просто «не упал молча», а прогнан и подтверждён дев-агентом).

## Tasks / Subtasks

- [x] Task 1 — `worker`+`beat` в `deploy/docker-compose.yml` (NEW services) (AC: 1, 4)
  - [x] Тот же образ/build, что `app`; без публикации портов; `depends_on: postgres/redis healthy`; `restart: unless-stopped`.
  - [x] Комментарий переписан — контейнеры реально добавлены.
- [x] Task 2 — Broker-smoke тест (`Backend/VAPS/apps/core/tests/test_celery_broker_smoke.py`, NEW) (AC: 2, 3)
  - [x] `@pytest.mark.slow`.
  - [x] Подпроцесс `celery -A config worker` на гейт-харнесс-Redis.
  - [x] `.apply_async(ignore_result=False)` реальной задачи (не `.delay()` — см. Completion Notes), поллинг `AsyncResult` с таймаутом, временный override через `CELERY_RESULT_BACKEND` env var (не `conf.result_backend` — см. Completion Notes).
  - [x] Подпроцесс корректно завершается в `finally` — не оставляет висящих worker-процессов при провале теста.
- [x] Task 3 — Реальный прогон (AC: 5)
  - [x] `make gate` зелёный (smoke НЕ запускается — `slow`-фильтр): 2875 passed, 57 deselected.
  - [x] `make test-full` — smoke реально зелёный, прогнан вручную дев-агентом (`pytest ... -m slow -s`: 1 passed).
  - [x] Никаких висящих docker/процессов после прогона.

## Dev Notes

- **`.delay()`, не `.apply()` — намеренное различие с 12.6's собственной живой проверкой.** `.apply()` (12.6) — синхронный, in-process, НЕ трогает брокер вообще (доказывает только, что сервис-обёртка корректна). `.delay()` (эта стори) — асинхронный, РЕАЛЬНО кладёт сообщение в Redis, РЕАЛЬНЫЙ worker его забирает — это единственный способ доказать «брокер работает», буква эпика требует именно это.
- **Временный `result_backend`-override — не регресс 12.6's фикса.** `config/settings.py` НЕ трогается этой стори — прод остаётся без result backend (никто не читает результаты beat-задач в реальной эксплуатации). Тест сам, локально, на время своего прогона включает наблюдаемость — стандартная техника для smoke-тестов, не архитектурное решение.
- **`materialize_status_effects_task` — безопасный выбор для smoke, не произвольный.** Идемпотентна (advisory lock), безопасна к повторному прогону против гейт-харнесс-БД (та же БД, что уже используют сотни других тестов test-full-suite).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1318-1324] — буква стори, вторая половина AC.
- [Source: deploy/docker-compose.yml] — комментарий, обновлённый 12.6-ревью, явно называющий эту стори.
- [Source: Backend/VAPS/Makefile::gate, ::test-full] — `not slow`-фильтр gate, полный прогон test-full, гейт-харнесс-порты (5433/6380).
- [Source: Backend/VAPS/config/settings.py::CELERY_RESULT_BACKEND] — 12.6's ревью-фикс (`None`), почему тест не трогает прод-конфиг.
- [Source: Backend/VAPS/apps/operations/statuses/tasks.py::materialize_status_effects_task] — задача для smoke-диспатча.

## Dev Agent Record

### Context Reference

- Собрано напрямую при create-story (без отдельного research-агента — скоуп уже полностью описан 12.6's собственным карв-аутом и Completion Notes): `Makefile`'s `gate`/`test-full`-таргетов (фильтр `not slow`, гейт-харнесс-порты), `deploy/docker-compose.yml`'s текущего состояния (4 сервиса, обновлённый 12.6-ревью комментарий), `config/settings.py`'s `CELERY_RESULT_BACKEND=None`-фикса (почему тест не трогает прод-конфиг).

### Completion Notes

- **AC-1/AC-4**: `worker`+`beat` добавлены в `deploy/docker-compose.yml`, тот же build/image что `app` (`vaps-app:${VAPS_APP_SHA:-dev}`), команды `celery -A config worker --loglevel=info` / `celery -A config beat --loglevel=info`, `depends_on: postgres/redis healthy`, `restart: unless-stopped`, без публикуемых портов. Заголовочный комментарий переписан фактически (список всех 6 сервисов, ссылка на эту стори). YAML синтаксис проверен `docker compose config --quiet` с временным `.env` (создан и удалён, не закоммичен).
- **AC-2/AC-3 — план `.delay()` + `conf.result_backend`-override НЕ сработал, найдено и исправлено живым прогоном**: первый реальный прогон упал `AttributeError: 'DisabledBackend' object has no attribute '_get_task_meta_for'` при чтении `async_result.state`, хотя предшествующий `.get(timeout=30)` не бросал исключения. Корень — ДВА независимых слоя, оба вскрыты через `inspect.getsource` на реальных Celery-классах + живые python-репро:
  1. **Backend-кэш**: `app.backend` кэшируется в `app._backend_cache` (thread-safe backends) / `app._local.backend` (thread-local, `DisabledBackend`), НЕ пересчитывается автоматически при изменении `conf.result_backend` после первого обращения к backend в процессе. Фикс: явный сброс `celery_app._backend_cache = None` + `celery_app._local.backend = None` после мутации.
  2. **Мутация `conf.result_backend` вообще не долетает** (первый слой сброса кэша сам по себе не хватило): `celery.app.utils.Settings.result_backend` — именной `@property` на namespaced-ключ `CELERY_RESULT_BACKEND`; Celery резолвит префиксный ключ (`CELERY_RESULT_BACKEND`) РАНЬШЕ обычного (`result_backend`) при поиске по `ChainMap`-цепочке карт. `config/settings.py` явно задаёт `CELERY_RESULT_BACKEND = None` (12.6's фикс) — эта явная запись маскирует запись `conf.result_backend = redis_url`, которая физически попадает в ДРУГОЙ (pending/changes) слой, никогда не достигаемый при чтении, пока не совпадает КЛЮЧ буквально. Подтверждено пошаговой трассировкой (`ChainMap.__getitem__`, `_to_keys`, `PendingConfiguration`).
  - **Итоговый рабочий подход (иной, чем предполагала стори при create-story) — переменная окружения, не `conf`-мутация**: `result_backend`-property — один из немногих в `Settings`, что проверяет `os.environ["CELERY_RESULT_BACKEND"]` ПЕРВЫМ, раньше любых `conf`-слоёв. Тест ставит именно этот env var (не трогая `config/settings.py`) — единственный путь, надёжно работающий И в текущем процессе (после сброса backend-кэша), И в worker-подпроцессе (тот заново грузит Django settings с нуля и иначе снова увидел бы `None`).
  - **`task_ignore_result` — аналогичной env-var лазейки нет** (только `broker_url`/`broker_read_url`/`broker_write_url`/`result_backend`/`timezone` имеют такие property). Вместо глобальной мутации конфига тест диспатчит через `.apply_async(ignore_result=False)` вместо `.delay()` — это оверрайдит воркер-side дефолт (`config/settings.py`'s `CELERY_TASK_IGNORE_RESULT = True`, 12.6) ТОЛЬКО для этого конкретного вызова, на уровне сообщения, не трогая глобальный конфиг вовсе — даже сильнее изолировано, чем исходный план.
  - Живой прогон подтверждён: `pytest apps/core/tests/test_celery_broker_smoke.py -q -m slow -s` → `1 passed in 2.72s`; реальный воркер-подпроцесс забрал `.apply_async()`-задачу через реальный Redis-брокер, вернул `SUCCESS`.
- **AC-5**: `make gate` — `2875 passed, 57 deselected` (smoke корректно исключён `not slow`-фильтром). `make test-full`-эквивалент (сам smoke) прогнан вручную и зелёный (см. выше). Никаких висящих docker-контейнеров/процессов после прогона (`ps aux | grep celery` — пусто; harness-контейнеры `vaps-db-1`/`vaps-redis-1` — предсуществующие gate-контейнеры, не созданы и не тронуты этой стори).
- `ruff check` на новый тестовый файл — чисто.

### File List

- `deploy/docker-compose.yml` (MOD) — добавлены `worker`+`beat`-сервисы, переписан заголовочный комментарий.
- `Backend/VAPS/apps/core/tests/test_celery_broker_smoke.py` (NEW) — broker-execution smoke-тест.

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
| 2026-07-29 | dev-story: worker/beat-контейнеры + broker-smoke реализованы, живой прогон зелёный (`make gate` 2875 passed, smoke `1 passed` через `test-full`-tier). Найден и исправлен реальный баг plана: `conf.result_backend`-мутация маскируется namespaced-ключом `CELERY_RESULT_BACKEND` — заменена на env var + `.apply_async(ignore_result=False)`. Status → review |
