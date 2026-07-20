---
baseline_commit: 0905899 (HEAD, `docs(retro): epic 10/11 retrospectives`). Рабочее дерево чистое относительно `Backend/**` (`git status --short -- Backend/` → пусто); вне `Backend/` есть untracked `_bmad-output/story-automator/**` и modified `.claude/settings.json` — не пересекаются с этой стори.
baseline_tests: `cd Backend/VAPS && make gate` → **2491 passed, 56 deselected, 93s** (бюджет 300s, NFR-8). Замерено при создании стори на `0905899`. Эта стори НЕ трогает Python-бизнес-логику (кроме одной строки `STATIC_ROOT` в `settings.py`) — прирост числа тестов НЕ ожидается; гейт обязан остаться 2491/56 без изменений.
prerequisite: НЕТ внутри Epic 12 — первая стори эпика. Эпик логически предполагает функционально готовый бэк/фронт (E1–E11 done/in-progress), но 12.1 сама по себе не читает данные и не требует миграции донора (E7, backlog, заблокирован A5/A8) — контейнеризация не зависит от состояния данных.
scope_note: Первая стори Epic 12 → эпик переводится `backlog → in-progress` (конвенция sprint-status.yaml «STATUS DEFINITIONS»). **Скоуп ÓУЖЕ эпик-AC epics.md#L1279-1282**: убран `worker, beat` (Celery НЕ существует в проекте — ARCH-DEFERRED-048, см. AC-0) и добавлены находки деплой-спайка 1.9 (`deploy/spike-1.9/RUNBOOK.md` §4) + недекларированные, но прямо адресованные в код-комментариях гэпы (`STATIC_ROOT`, X-Accel internal location).
context:
  - _bmad-output/planning-artifacts/epics.md#L1279-1282 (Story 12.1 epic-AC), #L209-213 (Epic 12 обзор + DoD-гейт)
  - _bmad-output/planning-artifacts/architecture.md#L337-339 (Infrastructure & Deployment: ASGI-монопроцесс/nginx/compose-топология, деплой носителем, окружения), #L491-580 (Complete Project Directory Structure — `deploy/` дерево дословно), #L56 (закрытый контур/air-gap), #L264 (прод — статическая сборка за nginx, без Node-рантайма), #L321 (HTTPS/hardening — ОТДЕЛЬНЫЙ эпик, не блокирует первый релиз), #L466/#L624/#L773 (ARCH-DEFERRED-048 — AsyncJob/Celery worker ОТЛОЖЕН)
  - `deploy/spike-1.9/RUNBOOK.md` §1 (проверенные шаги save→transfer→load→up), §4 «Находка → стори E12» (прямая адресация в 12.1: offline-самодостаточность без `build:`, порт/firewall, версия docker), §5 (A5 открыт — реальный контур-прогон делегирован 12.7, НЕ блокирует 12.1)
  - `deploy/spike-1.9/{docker-compose.yml,Dockerfile,build-bundle.sh,install-probe.sh}` — прецедент конвенций (фикс-тег образа, GIT_SHA build-arg, НЕТ `build:` в шипуемом compose)
  - `Backend/VAPS/apps/documents/services.py:5-9` — ДОСЛОВНЫЙ контракт X-Accel: `X-Accel-Redirect: {VAPS_XACCEL_LOCATION}/{uuid}`, nginx `location {VAPS_XACCEL_LOCATION}/ { internal; alias {root}/; }`, помечено «конфиг зона E12/12.1» в самом коде
  - `Backend/VAPS/config/settings.py:250` (`STATIC_URL` с комментарием «STATIC_ROOT + collectstatic + nginx-alias — прод-статика, отложено в E12 (ARCH#L335)») — прямой адрес в 12.1
  - `_bmad-output/implementation-artifacts/deferred-work.md:223-224` (DEBUG/SecurityMiddleware/HSTS-hardening → ОТДЕЛЬНЫЙ prod-hardening эпик, НЕ 12.1; STATIC_ROOT/collectstatic → явно «в 12.1»), `:358` («Celery-обёртка 12.1, когда появятся материализаторы» — Celery СЕГОДНЯ нет), `:394` (non-superuser DB-роль для аудита — «инфра E12/deploy», без привязки к 12.1), `:400` (X-Forwarded-For — «E12/deploy», требует trusted-proxy решения в Django, вне 12.1)
  - `Backend/VAPS/Makefile:42-47` (комментарий `parallel-run-diff`: «Beat-ready manual entrypoint (12.6 регистрирует в beat)» — периодические джобы СЕГОДНЯ ручные make-цели, не Celery)
  - `Backend/VAPS/pyproject.toml:80-81` (`[tool.setuptools] packages = ["config", "apps", "apps.core"]` — неполный список пакетов; см. Dev Notes «Ловушка №1»)
  - `frontend/vite.config.ts:12-13,43-51` (прокси `/api`,`/ws` → тот же контракт путей, что и nginx.conf этой стори), `frontend/package.json:11` (`npm run build` → `frontend/dist/`, outDir по умолчанию)
  - sprint-status.yaml (epic-11 retro-хвост 11.6a: «прод-compose (после 11.5a); Celery и регистрация beat-расписания — 12.6»)
---

# Story 12.1: Прод-compose

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **разработчик, готовящий первый деплой в закрытый контур**,
I want **зафиксированную прод-топологию Docker Compose: nginx (SPA-статика + Django-static-alias + X-Accel internal + WS-апгрейд с 3600s-таймаутом) перед uvicorn-приложением (`--lifespan off`), плюс postgres и redis — все образы адресуются по тегу, БЕЗ `build:` внутри shipped-compose (offline-самодостаточность, прецедент спайка 1.9)**,
so that **«прод-топология зафиксирована» (epic-AC) — база, на которую 12.2 (bundle.sh) кладёт save/manifest, а 12.3 (install.sh/smoke.sh) — установку**.

## Acceptance Criteria

Источник: epics.md#L1279-1282 (Story 12.1 AC); architecture.md#L337-339/#L491-580; deploy/spike-1.9/RUNBOOK.md §4; apps/documents/services.py:5-9; settings.py:250; deferred-work.md:223/224/358/394/400.

**AC-0 · ГРАНИЦА — ЧТО НЕ ВХОДИТ (проверить ПЕРВЫМ; анти-фантомный гейт, читать до единой строки кода).**

**Celery `worker`/`beat` — НЕ строятся, вопреки буквальной формулировке epics.md#L1279 («compose: … worker, beat …»).**
Given рабочее дерево на `{baseline_commit}`, When выполнено `grep -ri celery Backend/VAPS/pyproject.toml Backend/VAPS/apps -r`, Then совпадений **ноль**. `AsyncJob`/Celery-инфраструктура помечена `ARCH-DEFERRED-048` (architecture.md:773, поставлена спайком 6.6: `p95` синхронной генерации `×52` под порогом — деферрал сознательный, не недосмотр). Периодические джобы сегодня — **ручные management-команды** (`materialize_status_effects`, `check_lagging_submissions`, `parallel_run_diff`) с make-целями-обёртками (`Makefile:42-47`, комментарий «Beat-ready manual entrypoint (**12.6** регистрирует в beat)»); deferred-work.md:358 прямо называет «Celery-обёртку 12.1, **когда появятся материализаторы**» — материализаторов (в Celery-смысле) сегодня нет. Контейнер `worker`/`beat` без единой задачи внутри — мёртвый груз, не топология. **Регистрация реального планировщика — Story 12.6**, не эта стори.

**Docker-образы адресуются ТОЛЬКО по тегу — `build:` в `deploy/docker-compose.yml` ЗАПРЕЩЁН.**
Прецедент — `deploy/spike-1.9/RUNBOOK.md` §4 (таблица «Находка → стори», строка «Offline-самодостаточность → **12.1** prod-compose, 12.2»): образ приходит через `docker load` (12.2/12.3), `compose up` в контуре не должен трогать реестр. Сборка образов этой стори — **явные отдельные `docker build`-команды** (см. AC-4/AC-5), не compose-driven.

**НЕ строим** (явные, ПОИМЕНОВАННЫЕ границы — не молчаливые пропуски):
- `DEBUG=False`/`SecurityMiddleware`/`SESSION_COOKIE_SECURE`/`HSTS`, реальный `ALLOWED_HOSTS` — deferred-work.md:223 и architecture.md#L321 прямо называют это **ОТДЕЛЬНЫМ эпиком production-hardening**, не блокирующим первый релиз (закрытый LAN). `.env.example` (AC-5) даёт `VAPS_DEBUG=0` как значение по умолчанию (прод обязан быть `DEBUG=False`), но `settings.py` эта стори НЕ трогает нигде, кроме `STATIC_ROOT`.
- Непривилегированная DB-роль для приложения (сегодня коннект идёт суперюзером `vaps`) — deferred-work.md:394, «инфра E12/deploy», без привязки к конкретной стори; создание роли/GRANT/смена connection string — отдельная работа, требующая своего решения (не совмещать с этой стори без явного запроса).
- Django-потребление `X-Forwarded-For` (`apps/core/middleware.py` читает `REMOTE_ADDR` сырым) — deferred-work.md:400: требует trusted-proxy allowlist-решения на стороне Django, это код-изменение вне `deploy/`. Эта стори добавляет заголовки НА СТОРОНЕ NGINX (AC-3, бесплатно при написании `vaps.conf` с нуля) — задел, не полная реализация; middleware не трогается.
- WS ping/pong heartbeat на уровне приложения (`apps/notifications/consumers.py` — проверено grep'ом, ни `ping`, ни `pong` не встречаются) — nginx даёт длинный `proxy_read_timeout 3600s` (AC-3), активный heartbeat не реализуется этой стори (Решение №4 в Dev Notes).
- `bundle.sh`/`manifest.json`/`sha256sums` (12.2), `install.sh`/`smoke.sh`-скрипт (12.3), `CHECKLIST.md` (12.5), офлайн-зеркало npm/pip-зависимостей (12.2/будущее) — соседние стори по структуре `deploy/`.
- Фронтенд source (`frontend/src/**`) не трогается вовсе — `npm run build` уже существует и достаточен (`frontend/package.json:11`).

**Если по ходу работы обнаруживается потребность собрать Celery worker/beat, тронуть `apps/core/middleware.py`, `pyproject.toml [tool.setuptools]` или что-либо во `frontend/src/**` — ОСТАНОВИТЬСЯ и эскалировать**, а не расширять скоуп молча.

1. **AC-1 · `STATIC_ROOT` — прод-статика Django (admin CSS/JS).**
   Given `Backend/VAPS/config/settings.py`, When добавлена строка после `STATIC_URL = "static/"` (`:250`), Then:
   ```python
   STATIC_ROOT = Path(os.environ.get("VAPS_STATIC_ROOT", BASE_DIR / "staticfiles"))
   ```
   — форма дословно зеркалит `VAPS_PRIVATE_STORAGE_ROOT` (`settings.py:286-288`, тот же паттерн `Path(env.get(...))`). Комментарий-канон на месте («STATIC_ROOT + collectstatic + nginx-alias — прод-статика, отложено в E12 (ARCH#L335)») **обновить**: убрать «отложено», сослаться на эту стори. Никаких других правок `settings.py` — `DEBUG`, `ALLOWED_HOSTS`, `SecurityMiddleware` не трогать (AC-0).
   `manage.py makemigrations --check --dry-run` обязан остаться «No changes detected» — `STATIC_ROOT` не модель.

2. **AC-2 · `Backend/VAPS/Dockerfile` (NEW) — прод-образ приложения.**
   Однослойный `python:3.12-slim`; **НЕ дев-образ** — `pip install` без `[dev]`-экстра (pytest/ruff/hypothesis не попадают в прод-образ).
   **🔴 Ловушка №1 — `pip install .` (не editable) молча теряет половину приложения.** `pyproject.toml:81` — `packages = ["config", "apps", "apps.core"]`, БЕЗ `apps.operations`, `apps.audit`, `apps.documents`, `apps.notifications`, `apps.migration_legacy`, `apps.parallel_run`, вложенных `apps.operations.*`. Для НЕ-editable `pip install .` setuptools строит wheel только из перечисленных пакетов — `apps.operations` (все статусы/сдачи/расход) физически не попал бы в образ, и Django упал бы на `ImproperlyConfigured`/`ModuleNotFoundError` при старте. Проект **никогда не тестировал** не-editable install — единственный документированный путь (CLAUDE.md, README) — `pip install -e ".[dev]"`. **Обязательно использовать `pip install -e .`** (editable, БЕЗ `[dev]`) — тот же режим, что и везде в проекте, безопасен в контейнере (источник уже скопирован в `/app`, редактируемая ссылка указывает туда же). Чинить `packages=` в `pyproject.toml` — ВНЕ скоупа этой стори (затрагивает пакетирование целиком, не деплой-топологию); зафиксировать находку в Dev Agent Record, не чинить молча.
   Порядок слоёв: `COPY . .` **до** `pip install -e .` (editable-install требует полное дерево источника на месте установки, не только `pyproject.toml`) — Docker-кэш здесь беднее (любое изменение любого файла инвалидирует установку зависимостей), это осознанный компромисс ради корректности, не ошибка.
   `CMD` — **collectstatic на СТАРТЕ контейнера, не на build-time** (`STATIC_ROOT` — shared-volume с nginx, на build-time он пуст и недостижим для nginx-образа): `sh -c "python manage.py collectstatic --noinput && uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --lifespan off"`. `--lifespan off` — дословно из architecture.md#L337/#L491-580 и уже задокументированное решение в `config/asgi.py` (докстрока асги-файла ссылается на «прод-сервер — задача 12.1»).
   `migrate` **НЕ входит** в `CMD` — отдельный явный шаг install.sh (12.3, epics.md: «install.sh: … → migrate → smoke.sh»); автозапуск миграции при каждом рестарте контейнера противоречит этому дизайну.

3. **AC-3 · `deploy/nginx/vaps.conf` (NEW) + `deploy/nginx/Dockerfile` (NEW).**
   `vaps.conf` — четыре класса location, дословно зеркалящие контракты кода:
   - `location /static/ { alias /data/staticfiles/; }` — Django admin-ассеты (AC-1).
   - `location /protected/ { internal; alias /data/private_storage/; }` — **скопировать буквально** из `apps/documents/services.py:7-8` (X-Accel internal location, путь = `VAPS_XACCEL_LOCATION` default `/protected`); `internal` обязателен — прямой GET клиента на этот путь обязан вернуть 404, отдача только через `X-Accel-Redirect` от Django после `PermissionService`.
   - `location /ws/ { proxy_pass http://app:8000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s; }` — WS-апгрейд + 3600s ровно по architecture.md#L337.
   - `location ~ ^/(admin|api)/ { proxy_pass http://app:8000; }` — все Django HTTP-роуты (`config/urls.py`: `admin/`, `api/core/`, `api/operations/`, `api/audit/`, `api/notifications/`, `api/documents/`).
   - `location / { root /usr/share/nginx/html; try_files $uri /index.html; }` — SPA-фолбэк (frontend/dist, запечён в образ, см. ниже).
   Каждый `proxy_pass`-location несёт `proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;` — задел под deferred-work.md:400 (Django эти заголовки сегодня НЕ читает, AC-0).
   `client_max_body_size` — зеркало `VAPS_MAX_UPLOAD_MB` (settings.py default 20MB) + запас на multipart-обвязку (25m).
   `Dockerfile` — `FROM nginx:1.27-alpine`, `COPY deploy/nginx/vaps.conf /etc/nginx/conf.d/default.conf`, `COPY frontend/dist /usr/share/nginx/html/`. **Build context = корень репозитория** (не `deploy/nginx/`) — иначе `frontend/dist` недостижим для `COPY`. Предусловие сборки — задокументировать в комментарии Dockerfile: `cd frontend && npm run build` ДО `docker build -f deploy/nginx/Dockerfile -t vaps-nginx:dev .` (сборка фронта — ручной шаг этой стори; автоматизация обоих образов одним скриптом — 12.2 bundle.sh).

4. **AC-4 · `deploy/docker-compose.yml` (NEW) — прод-топология.**
   Сервисы: `app` (image, НЕ build — AC-0), `nginx` (image, НЕ build), `db` (`postgres:16` — тот же тег, что `Backend/VAPS/docker-compose.yml`, для консистентности), `redis` (`redis:7-alpine` — тот же тег). **`worker`/`beat` ОТСУТСТВУЮТ** (AC-0).
   `db`/`redis` — healthcheck идентичной формы гейт-харнесу (`Backend/VAPS/docker-compose.yml`: `pg_isready -h 127.0.0.1`, `redis-cli ping`), `app` `depends_on` оба с `condition: service_healthy`.
   Volumes: именованные `db_data`, `redis_data`, `static_files` (`app` rw → `/data/staticfiles`, `nginx` ro → тот же путь), `private_storage` (`app` rw, `nginx` ro) — **пути внутри контейнеров ОБЯЗАНЫ совпадать буквально** с `vaps.conf`'s `alias`-директивами (AC-3) и с `VAPS_STATIC_ROOT`/`VAPS_PRIVATE_STORAGE_ROOT`, которые `app` получает через env.
   `nginx` — единственный сервис с публикуемым портом: `"${VAPS_HTTP_PORT:-8080}:80"` (порт-параметризация — прецедент `deploy/spike-1.9/docker-compose.yml:12` `${PORT:-8080}`).
   Обязательные без-дефолта переменные (`${VAR:?...}` compose-синтаксис — падает на `up`, а не тихо стартует с пустым секретом): `VAPS_SECRET_KEY`, `VAPS_DB_PASSWORD`, `VAPS_JWT_KEY`, `VAPS_JWT_AUDIENCE`. **Секреты в файл НЕ пишутся** — `.env.example` (AC-5) содержит только имена и МЕСТА для значений, реальные значения — отдельная процедура (epics.md AC 12.1: «секреты не в бандле»).

5. **AC-5 · `deploy/.env.example` (NEW).**
   Полный перечень `VAPS_*`, читаемых `settings.py` (сверено построчно с кодом, не с памятью): `VAPS_DEBUG=0`, `VAPS_SECRET_KEY=`, `VAPS_DB=postgres`, `VAPS_DB_NAME=vaps`, `VAPS_DB_USER=vaps`, `VAPS_DB_PASSWORD=`, `VAPS_JWT_KEY=`, `VAPS_JWT_ALGORITHMS=RS256`, `VAPS_JWT_AUDIENCE=`, `VAPS_JWT_ISSUER=`, `VAPS_JWT_LEEWAY=0`, `VAPS_REDIS_URL=redis://redis:6379/0`, `VAPS_XACCEL_ENABLED=1`, `VAPS_XACCEL_LOCATION=/protected`, `VAPS_MAX_UPLOAD_MB=20`, `VAPS_ATTACHMENT_CONTENT_TYPES=` (дефолт из кода, можно закомментировать), `VAPS_PRIVATE_STORAGE_ROOT=/data/private_storage`, `VAPS_STATIC_ROOT=/data/staticfiles`, `VAPS_WS_ENABLED=1`, `VAPS_HTTP_PORT=8080`. Каждая строка — `# `-комментарий с источником (файл:строка) и «required»/«default X» пометкой. Файл коммитится (пример, не секрет); `deploy/docker-compose.yml` его не читает автоматически (`docker compose --env-file deploy/.env deploy up` — ручной выбор оператора, реальный `.env` в `.gitignore`).

6. **AC-6 · Ручной smoke (12.3's `smoke.sh` ещё не существует — не полагаться на него).**
   Given `Backend/VAPS/Dockerfile`/`deploy/nginx/Dockerfile` собраны локально (`docker build`) и `deploy/docker-compose.yml` поднят (`docker compose --env-file deploy/.env.local -f deploy/docker-compose.yml up -d` с самопальным dev-`.env.local`, НЕ коммитится), When `curl -I http://localhost:8080/admin/login/`, Then `200`; `curl -I http://localhost:8080/` (SPA) → `200`; `curl -I http://localhost:8080/api/core/` → не `502`/`504` (реальный код зависит от auth, важно что nginx достучался до `app`). Зафиксировать вывод в Dev Agent Record (Debug Log References) — «прошёл»/«не прошёл» с командой и выводом, не голословно.

7. **AC-7 · Гейт зелёный, регресс нулевой.**
   `cd Backend/VAPS && make gate` → **2491 passed, 56 deselected**, `No changes detected` (миграций нет). Diff вне `Backend/VAPS/config/settings.py` (1 строка) и `Backend/VAPS/Dockerfile` (NEW) не касается `apps/**` — ни один существующий тест не должен измениться.

## Tasks / Subtasks

- [x] Task 1 — `STATIC_ROOT` (AC: #1)
  - [x] Добавить `STATIC_ROOT` в `Backend/VAPS/config/settings.py` по образцу `VAPS_PRIVATE_STORAGE_ROOT`
  - [x] Обновить комментарий-канон у `STATIC_URL` (убрать «отложено в E12», сослаться на 12.1)
  - [x] `make gate` — `makemigrations --check --dry-run` остаётся «No changes detected»
- [x] Task 2 — прод-образ приложения (AC: #2)
  - [x] `Backend/VAPS/Dockerfile`: `python:3.12-slim`, `COPY . .` → `pip install -e .` (БЕЗ `[dev]`, editable — Ловушка №1) + `Backend/VAPS/.dockerignore` (без него COPY утащил бы хостовый `.venv`, `db.sqlite3` и `private_storage` с ПДн — см. Completion Notes №2)
  - [x] `CMD`: `collectstatic --noinput && uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --lifespan off`
  - [x] Локальная сборка: `docker build -t vaps-app:dev` — образ 429MB; Ловушка №1 снята прогоном: `apps.operations.statuses/submissions`, `apps.documents`, `apps.notifications.consumers`, `apps.audit` импортируются внутри контейнера; dev-deps (pytest) в образе НЕТ (проверено)
- [x] Task 3 — nginx (AC: #3)
  - [x] `deploy/nginx/vaps.conf`: `/static/`, `/protected/` (internal, зеркало `services.py:7-8`), `/ws/` (upgrade + 3600s), `/(admin|api)/`, `/` (SPA try_files)
  - [x] `deploy/nginx/Dockerfile`: `nginx:1.27-alpine`, `COPY frontend/dist`, `COPY vaps.conf`; комментарий про build-context=корень + предусловие `npm run build`
  - [x] Локальная сборка: `npm run build` (2.33s) + `docker build -t vaps-nginx:dev` — собрано; `nginx -t` вне compose падает ТОЛЬКО на резолве upstream `app` (ожидаемо: имя живёт в compose-DNS), синтаксис конфига валиден
- [x] Task 4 — `deploy/docker-compose.yml` (AC: #4)
  - [x] Сервисы `app`, `nginx`, `db`, `redis` (образы по тегу, БЕЗ `build:`); healthcheck на `db`/`redis` зеркалит `Backend/VAPS/docker-compose.yml`
  - [x] Именованные volumes `db_data`/`redis_data`/`static_files`/`private_storage`; пути внутри контейнеров совпадают с `vaps.conf` alias'ами
  - [x] Обязательные секреты через `${VAR:?...}` (`VAPS_SECRET_KEY`, `VAPS_DB_PASSWORD`, `VAPS_JWT_KEY`, `VAPS_JWT_AUDIENCE`)
- [x] Task 5 — `deploy/.env.example` (AC: #5)
  - [x] Полный список `VAPS_*` с источником и default/required пометкой (переменные, зашитые в compose namespace-контрактом — пути volumes, hostnames — помечены «здесь не нужны»)
- [x] Task 6 — ручной smoke + запись результата (AC: #6)
  - [x] `docker compose up` (проект vaps-smoke, порт 8081), все curl зелёные — полный вывод в Debug Log References; окружение снесено `down -v`
- [x] Task 7 — регресс (AC: #7)
  - [x] `make gate` зелёный: **2491 passed, 56 deselected, «No changes detected», 89s** — счёт равен baseline (гвард uvicorn ПРАВЛЕН, не добавлен/удалён; красная проба обеих мутаций — в Debug Log)
- [x] Task 8 — sprint-status.yaml
  - [x] `epic-12: backlog → in-progress`; `12-1-прод-compose: backlog → ready-for-dev` (выполнено на create-story 2026-07-20); dev-цикл: `ready-for-dev → in-progress → review`; `last_updated=2026-07-20`

### Review Findings

Ревью 2026-07-20 (bmad-code-review, 3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor — субагенты Fable 5). ⚠️ Same-model к dev-проходу (Fable 5) — cross-model каветка цикла применима; спека создавалась Sonnet 5. Итог: 11 patch (ВСЕ применены и верифицированы живым compose-прогоном), 3 defer, 6 dismiss. Гейт после патчей: 2491/56, «No changes detected».

- [x] [Review][Patch] `$host` → `$http_host` в обоих proxy-блоках — `$host` отбрасывает порт, Django 5 реконструирует good_origin без `:8080` → «Origin checking failed» на КАЖДОМ admin-POST (логин в admin невозможен на не-80 порту). Верифицировано: POST с Origin больше не бьётся об origin-чек [deploy/nginx/vaps.conf.template]
- [x] [Review][Patch] WS-токен утекал в access.log — эстафета `apps/core/auth/ws.py:23` («cost … is paid in 12.1: nginx logs $uri without $args for /ws/») не была исполнена. Добавлен `log_format ws_noargs` + `access_log` в location /ws/. Верифицировано: маркер-токен в логе — 0 вхождений, строки без query string [deploy/nginx/vaps.conf.template]
- [x] [Review][Patch] CSWSH Origin-guard — эстафета `config/asgi.py` Решение №6 («Origin filtering belongs to nginx in 12.1») не была исполнена. map origin@host с PCRE-бэкреференсом: пусто/same-origin → пропуск, cross-origin → 403 nginx. Верифицировано тремя curl [deploy/nginx/vaps.conf.template]
- [x] [Review][Patch] `^/(admin|api)/` → `^/(admin|api)(/|$)` — голый /admin проваливался в SPA-фолбэк (200 c index.html вместо Django). Верифицировано: /admin → 301 /admin/ [deploy/nginx/vaps.conf.template]
- [x] [Review][Patch] nginx стартовал до готовности app (502/404-окно холодного старта) — добавлен healthcheck app (urllib на /api/core/) + nginx `depends_on: condition: service_healthy`. Верифицировано: «app-1 Healthy» до «nginx-1 Starting» [deploy/docker-compose.yml]
- [x] [Review][Patch] Сборка nginx-образа тарила ВЕСЬ репо в контекст (node_modules, .venv, private_storage=ПДн) — корневой `.dockerignore` allowlist (`*` + `!deploy/nginx/` + `!frontend/dist/`). Верифицировано: сборка 2.5s [.dockerignore NEW]
- [x] [Review][Patch] `client_max_body_size 25m` был запечён в образ — в контуре смена = перенос носителя. vaps.conf → template (штатный envsubst официального образа), `VAPS_NGINX_MAX_BODY` env. Верифицировано: рендер 25m, дефолтный default.conf удалён [deploy/nginx/vaps.conf.template, Dockerfile, docker-compose.yml, .env.example]
- [x] [Review][Patch] `sh` PID 1 не форвардил SIGTERM (каждый stop = grace-период + SIGKILL, WS рвались без close-фреймов) — `exec uvicorn` [Backend/VAPS/Dockerfile]
- [x] [Review][Patch] collectstatic без `--clear` копил бы удалённые апгрейдами файлы в персистентном томе вечно [Backend/VAPS/Dockerfile]
- [x] [Review][Patch] `.env.example`: отсутствовал `VAPS_REDIS_URL` (AC-5!); PEM-гайд для VAPS_JWT_KEY (наивная вставка ломается ТИХО); ротация DB-пароля ≠ existing volume; `$$`-экранирование; ISSUER помечен опциональным; «--env-file для ВСЕХ команд compose»; ловушка VAPS_ATTACHMENT_CONTENT_TYPES (проброс через `${VAR:-}` обнулил бы whitelist — задокументировано, НЕ проброшено) [deploy/.env.example]
- [x] [Review][Patch] Паттерны `.dockerignore` нерекурсивны — `**/__pycache__/`, `**/*.pyc`. Верифицировано: pycache-count=0 в образе [Backend/VAPS/.dockerignore]
- [x] [Review][Defer] X-Accel отдаёт `application/octet-stream` вместо `attachment.content_type` (nginx на internal redirect пересчитывает MIME по расширению, файлы uuid-безрасширений by design 6.1 Д2) — deferred, дизайн-следствие; Content-Disposition выживает, скачивание работает [deploy/nginx/vaps.conf.template]
- [x] [Review][Defer] App-контейнер работает root'ом, тома root-owned — deferred, семья prod-hardening (deferred-work.md:223) [Backend/VAPS/Dockerfile]
- [x] [Review][Defer] uvicorn без `--forwarded-allow-ips`: X-Forwarded-* игнорируются, REMOTE_ADDR = IP nginx — deferred, УЖЕ учтено deferred-work.md:400 (trusted-proxy решение Django-стороны, AC-0 исключил) [Backend/VAPS/Dockerfile]

Dismissed (6): «пустой ALLOWED_HOSTS 400-ит» (в settings `["*"]`); дефолт-тег `:dev` (12.2 владеет тегами, задокументировано); совместимость пина websockets (эмпирически работает в собранном образе; лочный стиль пина — канон проекта); «команды сборки в чьей-то голове» (обе — в комментариях Dockerfile'ов и compose); JWT issuer опционален (дизайн 5.1); «многострочный PEM» как отдельная блокер-находка (закрыта доком в P10).

### Senior Developer Review (AI)

- Итог: **APPROVE после патчей** (2026-07-20). Все 11 patch-находок применены и верифицированы повторным живым прогоном топологии (второй smoke: template-рендер, 301 /admin, origin-POST, 3×WS-curl, лог без токена, healthcheck-ordering). Гейт: 2491/56 зелёный, миграций нет.
- Сильнейшие находки — ДВЕ неисполненные именованные эстафеты живого кода на 12.1 (`ws.py:23` лог без токена; `asgi.py` Решение №6 Origin-фильтр) и CSRF-разлом admin за не-80 портом. Все три не ловились ни гейтом, ни первым smoke (GET-only).
- Процесс-находка: экспортированный в шелл VAPS_JWT_KEY уронил гейт на 459 тестов (dev-путь X-User-Id отключился) — подтверждение fail-closed 5.1 живьём; перегон в чистом окружении зелёный.
- Action Items: нет открытых — все patch закрыты, defer записаны в deferred-work.md.

## Dev Notes

### Решения (зафиксированы этой стори, Bratan-overridable)

- **Решение №1 (AC-0):** Celery worker/beat НЕ строятся. Обоснование — ARCH-DEFERRED-048 + `Makefile:43` комментарий + deferred-work.md:358 + grep-факт (ноль упоминаний celery в проекте). Регистрация реального планировщика — Story 12.6 по имени, не «когда-нибудь».
- **Решение №2 (AC-4):** `deploy/docker-compose.yml` без `build:` — прямая находка `deploy/spike-1.9/RUNBOOK.md` §4, не изобретение этой стори.
- **Решение №3 (AC-2):** `pip install -e .` вместо «чистого» `pip install .` в прод-образе — обходит недекларированные пакеты `pyproject.toml:81` (Ловушка №1), не чинит их. Чинка `packages=` — отдельная задача, вне скоупа.
- **Решение №4 (AC-0/AC-3):** WS ping/pong heartbeat НЕ реализуется. `proxy_read_timeout 3600s` + клиентский reconnect (11.3, уже done) — достаточная деградация-устойчивость на первый релиз; активный heartbeat откладывается до доказанной необходимости (симметрично 6.6's «Принцип отсечения»).

### Project Structure Notes — расхождения с architecture.md

- **architecture.md#L117** («Стек: … Celery + Celery Beat + Redis …») и **#L337** («Celery worker + beat — отдельные контейнеры») — УСТАРЕВШАЯ формулировка относительно **Decision Register** (#L740-775, авторитетный источник по самому документу: «Норма нормативна… Новое решение → новая строка тем же PR»), где `ARCH-DEFERRED-048` явно откладывает Celery. Эта стори следует Decision Register, не абзацу Infrastructure & Deployment. **Не чинить architecture.md** в рамках этой стори (документ вне `Backend/VAPS`/`deploy/`, правка — отдельное решение).
- **`Backend/VAPS/docker-compose.yml`** (корень Backend/VAPS) — это НЕ прод-compose. Это гейт-харнес (`db`+`redis` для `make gate`/`make test-full`), существует с 1.1 и НЕ ТРОГАЕТСЯ этой стори. Прод-топология — ИСКЛЮЧИТЕЛЬНО `deploy/docker-compose.yml` (новый файл). Два файла с похожим именем в разных каталогах — источник вероятной путаницы, называю явно.
- **`config/settings/{base,production}.py`** (architecture.md#L505) не существует и не нужен — прод/дев уже разведены через `VAPS_*`-env (канон «конфиг — env, без веток по окружению», architecture.md#L339); эта стори НЕ создаёт settings-пакет.

### Testing

- Automated: `make gate` (regression only — 2491/56 baseline, AC-7). Нет новых `.py`-тестов: `deploy/**` и `Backend/VAPS/Dockerfile` не покрываются pytest-сьютом проекта (нет прецедента Dockerfile-линтера/hadolint в гейте — не заводить).
- Manual: AC-6 (curl-smoke трёх маршрутов). Зафиксировать команды и вывод в Dev Agent Record — «сделано» без вывода не принимается (прецедент `feedback_dev_checkbox_drift`).
- Integration: нет — соседняя стори 12.3 (`smoke.sh`) формализует это в скрипт; 12.7 — реальный прогон в контуре (блокирован A5, не в этой стори).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Fable 5) — dev-проход 2026-07-20. Спека создана той же сессией (cross-model ревью — обязательный дефолт цикла, AI-2 ретро E9: ревьюеру взять ДРУГУЮ модель).

### Debug Log References

- **AC-0 (обратный гейт), уточнение формулировки.** `git status --short -- Backend/` → пусто ✓. Грep стори `grep -ri celery … apps -r` дал **25 совпадений — все докстринги** вида «Celery is NOT imported here — Story 12.6 wraps it» (лексика, не код). Точная проверка инварианта: `grep -rn "import celery\|from celery" apps config` → **0**; `grep -i celery pyproject.toml` → **0**. Суть AC-0 (Celery — не зависимость и не импортируется) подтверждена; формулировка грепа в спеке была шире инварианта.
- **Task 1 проверка:** `settings` грузится, `STATIC_ROOT` дефолт `{BASE_DIR}/staticfiles`, env-override `/data/staticfiles` работает; `collectstatic --dry-run` → «154 static files copied».
- **Task 2 проверка (Ловушка №1 прогоном):** в контейнере `import apps.operations.statuses.models, apps.operations.submissions.models, apps.documents.models, apps.notifications.consumers, apps.audit.models` + `import uvicorn (0.51.0), websockets` → OK; `import pytest` → loud fail (dev-deps не просочились); `.venv`/`private_storage` в образе отсутствуют.
- **Task 6 smoke (compose-проект `vaps-smoke`, порт 8081, `--env-file` из scratchpad, секреты в репо не писались):**
  - app-лог: «154 static files copied to '/data/staticfiles'» → «Uvicorn running on 0.0.0.0:8000» (collectstatic-на-старте + shared volume работают);
  - `curl -sI /admin/login/` → **HTTP 200** (Django через nginx);
  - `curl -sI /` → **HTTP 200** (SPA);
  - `curl -sI /api/core/` → **HTTP 200** (не 502/504 — nginx достучался);
  - `curl -sI /protected/x` → **HTTP 404** (internal-location закрыт снаружи — контракт X-Accel);
  - `curl -sI /static/admin/css/base.css` → **HTTP 200** (полный цикл collectstatic → volume → nginx alias);
  - бонус: WS-upgrade `curl /ws/notifications/` (аноним) → **HTTP 403** — ровно задокументированный close-до-accept 11.1; nginx проксирует `/ws/` до consumer'а.
  - Снос: `docker compose … down -v` → volumes/network удалены.
- **Красная проба гварда (двусторонняя):** мутация-1 «uvicorn удалён из runtime» → `test_no_server_or_worker_stack_is_introduced` **FAILED** ✓; мутация-2 «uvicorn дублирован в dev-extra» → **FAILED** ✓; восстановление из scratchpad-копии (НЕ `git checkout` — урок 9.6), честное состояние → 25/25 passed. `git diff pyproject.toml` сверен: восстановлено стори-состояние.
- **Гейт (Task 7):** `2491 passed, 56 deselected, 86s`, `makemigrations --check --dry-run` → «No changes detected». Счёт равен baseline.

### Completion Notes List

1. **Отклонение от спеки №1 (санкционировано кодом): `pyproject.toml` — uvicorn+websockets перенесены dev-extra → `[project] dependencies`.** Спека этого не таскала, но комментарий 11.6 в самом pyproject прямо записывал эстафету: «в рантайм-зависимости его переносит **12.1** вместе с прод-образом». Без переноса `pip install -e .` (без `[dev]`) дал бы прод-образ **без ASGI-сервера** — CMD упал бы на `uvicorn: not found`. Пины НЕ менялись, дубли в dev-extra убраны. Это не новая зависимость (обе уже были запинены) — HALT-условие «new dependencies» не тронуто.
2. **Отклонение от спеки №2 (следствие №1): правка гварда `test_ws_guards.py::test_no_server_or_worker_stack_is_introduced`.** Спека AC-7 утверждала «ни один существующий тест не должен измениться», но гвард 11.6 ассертил «uvicorn НЕ в runtime» — и его собственный докстринг называл срок годности: «a server in the runtime deps … **That move is 12.1**». Клауза ИНВЕРТИРОВАНА, не удалена: теперь гвард требует uvicorn+websockets В runtime (потеря любого тихо ломает прод-образ) и запрещает дубли в dev-extra; daphne/celery — по-прежнему нигде. Дискриминирующая сила доказана двусторонней красной пробой (Debug Log).
3. **Добавка к Task 2: `Backend/VAPS/.dockerignore` (NEW).** Без него `COPY . .` затащил бы в образ хостовый `.venv` (гигабайты, битые абсолютные пути), `db.sqlite3` и `private_storage` (байты вложений = ПДн). Гигиена самого Task 2, не расширение скоупа.
4. **Добавка к Task 1: `staticfiles/` в корневой `.gitignore`** — точное зеркало прецедента 6.1 (`private_storage/` добавлен туда же тем же паттерном «dev-default под BASE_DIR — не репо-артефакт»); dry-run collectstatic иначе оставляет untracked-мусор (урок 11.6a про «утверждённый, но отсутствующий» gitignore).
5. **Ловушка №1 подтверждена эмпирически, не только рассуждением:** прод-образ собран editable и импорты `apps.operations.*` прогнаны внутри контейнера (Debug Log). Находка «`[tool.setuptools] packages` неполон» НЕ чинилась (по спеке — зафиксировать, не чинить): жива в `pyproject.toml:81`.
6. Секреты нигде не хардкодились: smoke-`.env` и RSA-ключ жили в session-scratchpad вне репо; `deploy/.env.example` содержит только имена и дефолты.
7. `frontend/**` source не тронут (только `npm run build` → `dist/`, который в `.gitignore` фронта); `npm run gate` не гонялся — фронт-код не менялся.

### File List

- `Backend/VAPS/config/settings.py` (M — +`STATIC_ROOT`, обновлён комментарий-канон STATIC_URL)
- `Backend/VAPS/pyproject.toml` (M — uvicorn+websockets dev-extra → runtime; комментарии-эстафеты обновлены с обеих сторон)
- `Backend/VAPS/apps/notifications/tests/test_ws_guards.py` (M — инверсия uvicorn-клаузы гварда по его же записанной эстафете 12.1)
- `Backend/VAPS/Dockerfile` (NEW — прод-образ app: python:3.12-slim, editable install без [dev], CMD collectstatic+uvicorn --lifespan off)
- `Backend/VAPS/.dockerignore` (NEW — гигиена контекста сборки: .venv/private_storage/db.sqlite3/кэши)
- `deploy/nginx/vaps.conf` (NEW — static alias, /protected internal (X-Accel), /ws upgrade+3600s, admin|api proxy, SPA try_files)
- `deploy/nginx/Dockerfile` (NEW — nginx:1.27-alpine + vaps.conf + frontend/dist; build-context = корень)
- `deploy/docker-compose.yml` (NEW — прод-топология: nginx/app/db/redis, именованные volumes, ${VAR:?}-секреты, БЕЗ build:, БЕЗ worker/beat)
- `deploy/.env.example` (NEW — полный перечень VAPS_* с источниками)
- `.gitignore` (M — +staticfiles/, зеркало прецедента private_storage 6.1)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M — 12-1: in-progress → review)
- `_bmad-output/implementation-artifacts/12-1-прод-compose.md` (M — этот файл)

### Change Log

- 2026-07-20: dev-проход целиком (Tasks 1–8), smoke-верификация прод-топологии на живом compose, гейт 2491/56 зелёный. Статус → review.
