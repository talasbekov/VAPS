---
baseline_commit: e0dd36d
---

# Story 12.6: Регистрация beat-задач и smoke брокера

Status: done

## Story

As a **разработчик**,
I want **три уже существующих catch-up-команды (`materialize_status_effects`/`check_lagging_submissions`/`parallel_run_diff`), обёрнутые в Celery `@shared_task` и зарегистрированные в beat-расписании, плюс gate-тест «каждая periodic-задача существует и импортируется»**,
so that **переименованная/удалённая задача не умирает молча в проде — гейт красный ДО деплоя, не тихий пропуск в 03:00 ночи**.

## Acceptance Criteria

Источник: `epics.md#L1318-1324` (буква стори) + `architecture.md#L117,337` (целевая связка Celery+Beat+Redis, worker/beat — отдельные контейнеры) + три command-докстринга (3.12/5.7b2/6.9), явно называющие 12.6 адресом обёртки — не гипотеза, а форвард-обязательство, накопленное тремя предыдущими сториями.

**Пересмотр скоупа при create-story (декомпозиция по CLAUDE.md §Story Size Rules):** буква эпика бандлит регистрацию задач (gate-тест, без брокера) И smoke ЧЕРЕЗ БРОКЕР (test-full, требует живой worker+Redis) — два разных теста, разная инфраструктура, разная ответственность. Разбито:
- **12.6 (эта стори)** — Celery-инфраструктура: зависимость, `config/celery.py`, `@shared_task`-обёртки трёх команд, beat-расписание, gate-тест «задача существует/импортируется» (СТАТИЧЕСКИЙ — без запуска брокера).
- **12.6a (заведена в `sprint-status.yaml`)** — worker/beat-КОНТЕЙНЕРЫ в `deploy/docker-compose.yml` + smoke ЧЕРЕЗ БРОКЕР в test-full (нужен живой Redis+worker — другая инфраструктура, другой тестовый tier).

1. **AC-1 (Celery — зависимость, `config/celery.py`, тот же Redis, что уже используют Channels).** `pyproject.toml`: `celery>=5.4,<6` в `[project.dependencies]` (обычные зависимости, не dev-extra — задачи должны исполняться в прод-образе). `redis`-python-клиент УЖЕ приходит транзитивно через `channels-redis` (11.1) — не дублируется явной зависимостью, задокументировано комментарием. `config/celery.py` — стандартная Django+Celery интеграция (`Celery('vaps')`, `config_from_object('django.conf:settings', namespace='CELERY')`, `autodiscover_tasks()`), `config/__init__.py` экспортирует `celery_app`. Брокер — `VAPS_REDIS_URL` (та же переменная, тот же Redis-инстанс, что `CHANNEL_LAYERS`, 11.1 — architecture.md#L311 «Redis — только брокер, кэш не вводится», один инстанс на обе роли).
2. **AC-2 (три `@shared_task`, каждая в `tasks.py` своего приложения — Celery autodiscover-конвенция).** `apps/operations/statuses/tasks.py`, `apps/operations/submissions/tasks.py`, `apps/parallel_run/tasks.py` — каждая ОБОРАЧИВАЕТ уже существующий СЕРВИС (не `call_command`, НАПРЯМУЮ вызывает `materialize_status_effects`/`check_lagging_submissions`/`run_parallel_run_diff` из уже готовых сервисных модулей — команды и так уже «beat-ready», их докстринги явно это обещают), передаёт `Clock.today_local()` как `today` (реальный прогон, не `--today`-тестовый флаг).
3. **AC-3 (beat-расписание — `CELERY_BEAT_SCHEDULE`, `config/settings.py`).** Три записи, ночные часы, разнесённые во времени между собой (не одновременно — все три трогают БД/внешние ресурсы) и НЕ пересекающиеся с уже существующими systemd-таймерами (`vaps-parallel-run-diff.timer`, 02:15; `vaps-backup.timer`, 03:00, 12.4) — эта стори НЕ трогает `parallel_run_diff`'s существующий systemd-таймер (он уже работает, минимальный churn — см. Dev Notes), beat-расписание регистрирует ТОЛЬКО две ранее НЕ запланированные задачи (`materialize_status_effects`, `check_lagging_submissions`) + `parallel_run_diff` ТОЖЕ регистрируется в beat (буква эпика явно называет её в докстринге «Story 12.6 wraps run_parallel_run_diff» — обещание распространяется на все три), но её systemd-таймер НЕ отключается в этой стори (явное, задокументированное решение — отключение потребовало бы координации с уже развёрнутым контуром, не в скоупе; дублирующий запуск безопасен — идемпотентность через advisory lock уже гарантирована каждым сервисом, catch_up.py/lagging_check.py/parallel_run_diff все idempotent-safe по своим сторям).
4. **AC-4 (gate-тест — задача существует И импортируется, СТАТИЧЕСКИЙ, без брокера).** `Backend/VAPS/apps/core/tests/test_celery_tasks.py` (NEW): для каждой записи `CELERY_BEAT_SCHEDULE` — резолвит `task`-имя через Celery's `app.tasks`-реестр (после `app.autodiscover_tasks()` + `app.loader.import_default_modules()` внутри теста), утверждает найденную задачу РЕАЛЬНО импортируется и вызываема (`callable(task.run)` или эквивалент) — НЕ просто «строка присутствует в файле». Мутационная проба (АНТИ-вакуум, урок сессии): переименовать задачу в расписании на несуществующую — тест обязан покраснеть.
5. **AC-5 (регресс нулевой).** `make gate` зелёный. Существующий `test_no_disallowed_server_or_worker_stack_is_introduced` (11.1/12.1's guard) — ИНВЕРТИРОВАН для `celery` (та же логика, что 12.1's аналогичный переворот для `uvicorn`, 11.6→12.1): теперь celery ОБЯЗАН быть в зависимостях, докстринг объясняет переворот. `daphne` остаётся запрещённым (без изменений).

## Tasks / Subtasks

- [x] Task 1 — Celery-зависимость + `config/celery.py` (AC: 1)
  - [x] `pyproject.toml`: `celery>=5.4,<6`.
  - [x] `config/celery.py` (NEW): `Celery('vaps')`, `config_from_object`, `autodiscover_tasks()`.
  - [x] `config/__init__.py`: экспорт `celery_app`.
  - [x] `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND` в `settings.py`, из `VAPS_REDIS_URL` (та же переменная, что `channel_layers_from_env`).
- [x] Task 2 — `@shared_task`-обёртки (AC: 2)
  - [x] `apps/operations/statuses/tasks.py`, `apps/operations/submissions/tasks.py`, `apps/parallel_run/tasks.py` — каждая вызывает существующий сервис напрямую с `Clock.today_local()`.
- [x] Task 3 — `CELERY_BEAT_SCHEDULE` (AC: 3)
  - [x] Три записи в `settings.py`, разнесённые ночные часы, не пересекающиеся с существующими systemd-таймерами.
- [x] Task 4 — Gate-тест (`test_celery_tasks.py`, NEW) (AC: 4)
  - [x] Резолвит каждую запись расписания через Celery-реестр, реально импортирует.
  - [x] Мутационная проба (переименовать → тест красный) — проверено вручную, не автоматизирована постоянно (зафиксировано в Completion Notes).
- [x] Task 5 — Инверсия существующего гварда (AC: 5)
  - [x] `test_ws_guards.py`'s `test_no_disallowed_server_or_worker_stack_is_introduced` — `celery` убран из запрещённого множества, докстринг объясняет переворот (зеркало 12.1's uvicorn-переворота).
- [x] Task 6 — Реальный прогон (AC: 5)
  - [x] `make gate` зелёный.
  - [x] Живая мутационная проба гейт-теста (AC-4) — красная на переименованной задаче.

## Dev Notes

- **Скоуп-декомпозиция — buквa эпика бандлит два теста, разная инфраструктура.** «тест ... (gate)» — статический импорт-чек, ни брокера, ни воркера не требует. «smoke исполнения через брокер (test-full)» — требует ЖИВОЙ Redis+worker, другой тестовый tier (`make test-full`, не `make gate`). Разделено на 12.6 (эта, gate-тест) и 12.6a (worker/beat-контейнеры + брокер-smoke, заведена в sprint-status.yaml).
- **`parallel_run_diff`'s existующий systemd-таймер НЕ отключается.** Уже развёрнут и работает (7.0). Регистрация в Celery beat — ДОПОЛНИТЕЛЬНАЯ (буква эпика называет её в списке трёх), не замена; дублирующий запуск безопасен (idempotent-by-design, advisory lock). Отключение systemd-таймера — отдельное решение с координацией по уже настроенным серверам, вне скоупа.
- **Три команды УЖЕ «beat-ready» — обёртка тонкая.** Каждая уже вызывает готовый сервис (`materialize_status_effects`/`check_lagging_submissions`/`run_parallel_run_diff`), Celery-таск — прямой вызов сервиса с `Clock.today_local()`, не `call_command` (избегает stdout/argparse-накладных расходов, прямее).
- **Redis — один инстанс, две роли, уже установленное архитектурное решение.** `architecture.md#L311`: «Redis — только брокер, кэш не вводится» — Celery переиспользует `VAPS_REDIS_URL`, НЕ отдельный инстанс. DB-индекс/namespace-разделение между Channels и Celery — проверить при реализации (Celery по умолчанию использует Redis DB 0, как и channel_layers_from_env — возможная коллизия ключей, требует явного разделения DB-индекса при реализации, не молчаливого совпадения).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1318-1324] — буква стори.
- [Source: _bmad-output/planning-artifacts/architecture.md#L117,301,311,337,471] — целевой стек (Celery+Beat+Redis), Redis-единственная-роль, идемпотентность через `cache.add`.
- [Source: apps/operations/statuses/management/commands/materialize_status_effects.py, apps/operations/submissions/management/commands/check_lagging_submissions.py, apps/parallel_run/management/commands/parallel_run_diff.py] — три докстринга, явно называющие 12.6 адресом обёртки, «Celery is NOT imported here» (пока).
- [Source: apps/notifications/tests/test_ws_guards.py::test_no_disallowed_server_or_worker_stack_is_introduced] — существующий гвард, требующий инверсии для celery (тот же приём, что 12.1's uvicorn-переворот).
- [Source: deploy/contour-stand/systemd/vaps-parallel-run-diff.timer, deploy/systemd/vaps-backup.timer] — существующие systemd-расписания, с которыми beat-расписание не должно пересекаться по времени.
- [Source: Backend/VAPS/config/settings.py::channel_layers_from_env] — `VAPS_REDIS_URL`-паттерн, переиспользуемый для Celery-брокера.

## Dev Agent Record

### Context Reference

- Собрано делегированным research-агентом при create-story: полный текст трёх command-докстрингов (явное обещание 12.6), `test_ws_guards.py`'s текущий гвард (инверсия нужна), `architecture.md`'s целевая Celery+Beat+Redis-связка, отсутствие существующего job-реестра (строить с нуля), подтверждение — `celery` реально отсутствует в `pyproject.toml` на момент старта, Redis уже переиспользуется Channels (`VAPS_REDIS_URL`).

### Completion Notes

Реализовано по плану. `make gate` — 2875 passed, 0 failed, schema drift не обнаружен.

**Живая проверка (не продекларирована):**
1. `autodiscover_tasks()` реально резолвит все 3 задачи из соответствующих `tasks.py`: `python -c "... celery_app.autodiscover_tasks(); print(sorted(celery_app.tasks))"` — все три полных dotted-имени присутствуют.
2. Мутационная проба AC-4: `CELERY_BEAT_SCHEDULE`'s `parallel_run_diff_task` временно переименован на несуществующее имя — `test_every_beat_task_exists_and_imports` И `test_all_three_expected_catch_up_jobs_are_registered` реально покраснели, вернулось после revert — оба зелёные.
3. **Синхронный прогон ВСЕХ ТРЁХ задач против реальной БД (`.apply()` — без брокера, в рамках скоупа этой стори, не 12.6a's brokered-smoke):** гейт-харнесс (`db`/`redis`, порты 5433/6380) поднят, все три `@shared_task` реально выполнены — `SUCCESS`, без исключений, против настоящей Postgres. Убрано после (`docker compose down`).

**Ревью (3 агента, cross-model, реальный прогон каждого).**

- **Blind Hunter** (diff-only) нашёл 1 реальную дыру, исправлена:
  1. **MED — `CELERY_RESULT_BACKEND` включён, но результат НИКЕМ не читается** (все три beat-задачи — fire-and-forget, `.get()`/`AsyncResult()` нигде не вызываются) — без явного `CELERY_RESULT_EXPIRES` это бесконечное накопление `celery-task-meta-*`-ключей в ТОМ ЖЕ Redis, что уже держит Channels. Исправлено: `CELERY_RESULT_BACKEND = None` + `CELERY_TASK_IGNORE_RESULT = True` (не полагаться на дефолтный TTL, а вообще не писать результат, раз его никто не читает). Живая проверка: `.apply()` на всех трёх задачах — `SUCCESS`, `CELERY_TASK_IGNORE_RESULT=True` подтверждён в рантайме.
  2. Дополнительно усилен anti-vacuum гейт-теста (`test_every_beat_task_exists_and_imports`): явная проверка, что после `autodiscover_tasks()`+`import_default_modules()` реестр содержит НЕ-builtin-задачи (не просто «непустой список» — ловит гипотетическую будущую регрессию порядка вызовов, которая оставила бы реестр из ТОЛЬКО `celery.*`-встроенных задач).
  - Остальное (нет retry/alerting на уровне задачи, фиксированные, не general-purpose, часы в anti-overlap-тесте) — рассмотрено и ОТКЛОНЕНО: retry/alerting-инфраструктуры в проекте сознательно нет (тот же принцип, что уже принят 12.4 — «громкий exit + структурный лог», GlitchTip явно DEFERRED); отсутствие retry на Celery-уровне не проблема — все три сервиса УЖЕ идемпотентны/catch-up-safe по своей архитектуре (следующий тик расписания сам подберёт пропущенное), добавление Celery-level retry дублировало бы уже существующую catch-up-семантику без пользы.
- **Edge Case Hunter** (полный доступ к проекту, живое чтение) нашёл 1 РЕАЛЬНУЮ находку, исправлена:
  1. **HIGH — `deploy/docker-compose.yml`'s комментарий (12.1) буквально называл «12.6» адресом worker/beat-КОНТЕЙНЕРОВ**, без знания о decomposition-решении «12.6 vs 12.6a», принятом ПОСЛЕ того, как этот комментарий был написан. Формально это создавало путаницу: контейнеры действительно НЕ добавлены этой стори (буква 12.6 — только регистрация задач), но старый комментарий не объяснял, ПОЧЕМУ — читатель мог решить, что это упущение, не сознательное решение. Исправлено: комментарий переписан, явно называет 12.6a, объясняет расщепление буквы эпика на два теста разной инфраструктуры, честно называет `CELERY_BEAT_SCHEDULE` «мёртвой конфигурацией до 12.6a».
  - Ложная тревога (проверено и опровергнуто напрямую): «celery не установлен в окружении» — `celery==5.6.3` реально установлен в `.venv`, подтверждено `python -c "import celery; print(celery.__version__)"`; агент, видимо, смотрел на `pyproject.toml`, не запуская собственный `pip install`.
  - Подтверждены БЕЗ находки: `autodiscover_tasks()` без `packages=` реально работает (все три app'а в `INSTALLED_APPS`), нет circular-import риска между `config/__init__.py` и `asgi.py`/`manage.py` (`setdefault`, не `set`), `CELERY_TIMEZONE` — достаточная настройка для Celery 5.x (не нужен отдельный `CELERY_ENABLE_UTC`), исключения из сервисов корректно долетают до Celery как `FAILURE` (не проглатываются).
- **Acceptance Auditor**: реально прогнал `pytest test_celery_tasks.py test_ws_guards.py` (29 passed), `make gate` (2875 passed), **независимо повторил мутационную пробу с нуля** (сам сломал/починил `CELERY_BEAT_SCHEDULE`, сверил байт-в-байт свой diff с оригиналом при откате), **независимо повторил синхронный `.apply()`-прогон против реальной Postgres** (свежий `docker compose up`, миграции, все три задачи — `SUCCESS`) — подтвердил ВСЕ заявления Completion Notes без единого расхождения. `manage.py check` — 0 issues, `config/asgi.py`/`manage.py` не задеты этой стори.

**После review-патчей — гейт и тесты перепрогнаны.** `make gate` — 2875 passed, 0 failed (тот же счёт — патчи усилили существующий тест, не добавили новый). `.apply()`-прогон подтверждён Acceptance Auditor'ом независимо уже ПОСЛЕ фикса `CELERY_RESULT_BACKEND`.

2 decision (оба реальных фикса приняты) · 0 defer · 2 dismiss-с-обоснованием (retry/alerting — сознательный принцип проекта; ложная тревога про неустановленный celery — опровергнута).

### File List

- `Backend/VAPS/pyproject.toml` (MOD) — `celery>=5.4,<6` в основных зависимостях.
- `Backend/VAPS/config/celery.py` (NEW) — Celery app instance, autodiscover.
- `Backend/VAPS/config/__init__.py` (MOD, было пусто) — экспорт `celery_app`.
- `Backend/VAPS/config/settings.py` (MOD) — `CELERY_BROKER_URL`/`CELERY_BEAT_SCHEDULE`, импорт `crontab`; `CELERY_RESULT_BACKEND=None`+`CELERY_TASK_IGNORE_RESULT=True` (review-фикс).
- `Backend/VAPS/apps/operations/statuses/tasks.py` (NEW) — `materialize_status_effects_task`.
- `Backend/VAPS/apps/operations/submissions/tasks.py` (NEW) — `check_lagging_submissions_task`.
- `Backend/VAPS/apps/parallel_run/tasks.py` (NEW) — `parallel_run_diff_task`.
- `Backend/VAPS/apps/core/tests/test_celery_tasks.py` (NEW) — gate-тест «задача существует/импортируется» (AC-4) + усиленный anti-vacuum-гвард (review-фикс).
- `Backend/VAPS/apps/notifications/tests/test_ws_guards.py` (MOD) — гвард инвертирован для `celery` (тот же приём, что uvicorn, 12.1).
- `deploy/docker-compose.yml` (MOD) — комментарий (12.1) переписан, называет 12.6a явно, честно фиксирует «мёртвую» конфигурацию до неё (review-фикс).

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
| 2026-07-29 | dev-story: реализация (Celery впервые в проекте — зависимость, config/celery.py, 3 @shared_task, beat-расписание, gate-тест) + живой прогон (autodiscover, мутационная проба, синхронный .apply() против реальной Postgres) + 3-агентное ревью нашло 2 реальные дыры (неограниченный рост celery-task-meta-* в общем Redis, устаревший комментарий docker-compose.yml про адрес worker/beat) — обе исправлены, независимо перепроверены Acceptance Auditor'ом → done |
