---
baseline_commit: 947082d
---

# Story 12.6a: worker/beat-контейнеры и broker-smoke

Status: ready-for-dev

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

- [ ] Task 1 — `worker`+`beat` в `deploy/docker-compose.yml` (NEW services) (AC: 1, 4)
  - [ ] Тот же образ/build, что `app`; без публикации портов; `depends_on: postgres/redis healthy`; `restart: unless-stopped`.
  - [ ] Комментарий переписан — контейнеры реально добавлены.
- [ ] Task 2 — Broker-smoke тест (`Backend/VAPS/apps/core/tests/test_celery_broker_smoke.py`, NEW) (AC: 2, 3)
  - [ ] `@pytest.mark.slow`.
  - [ ] Подпроцесс `celery -A config worker` на гейт-харнесс-Redis.
  - [ ] `.delay()` реальной задачи, поллинг `AsyncResult` с таймаутом, временный `result_backend`-override.
  - [ ] Подпроцесс корректно завершается в `finally` — не оставляет висящих worker-процессов при провале теста.
- [ ] Task 3 — Реальный прогон (AC: 5)
  - [ ] `make gate` зелёный (smoke НЕ запускается — `slow`-фильтр).
  - [ ] `make test-full` — smoke реально зелёный, прогнан вручную дев-агентом.
  - [ ] Никаких висящих docker/процессов после прогона.

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

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
