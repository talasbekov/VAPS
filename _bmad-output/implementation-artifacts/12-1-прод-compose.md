---
baseline_commit: ea436aa
---

# Story 12.1: Прод-compose

Status: done

## Story

As a **разработчик, готовящий первый деплой в закрытый контур**,
I want **зафиксированную прод-топологию (nginx + uvicorn-приложение + postgres + redis) в отдельном `deploy/`-дереве, не смешанную с dev-гейт-харнессом**,
so that **перенос носителем (12.2-12.3) переносит ОДНУ проверенную топологию, а не самодеятельность каждого разработчика**.

## Acceptance Criteria

Источник: `epics.md#L1278-1284` (буква эпика) + `architecture.md#L333-340,557-574` (целевое дерево `deploy/`) + множественные форвард-ссылки, накопленные предыдущими стори (11.1 asgi.py, 6.1/6.7 X-Accel-контракт, 11.6 uvicorn dev-extra, deferred-work.md — все процитированы в Dev Notes).

**Пересмотр скоупа при create-story (декомпозиция по CLAUDE.md §Story Size Rules):**

Буква эпика бандлит nginx+uvicorn+worker+beat+postgres+redis+env в один AC. Это нарушило бы лимит «≤5 файлов, одна ответственность» и правило «не мешать инфраструктуру с прикладным кодом». Разбито:
- **12.1 (эта стори)** — топология: `deploy/docker-compose.yml` (nginx+app+postgres+redis, БЕЗ worker/beat), `deploy/nginx/vaps.conf.template`, `deploy/.env.example`, промоция `uvicorn`/`websockets` из dev-extra в прод-зависимости (`pyproject.toml`), `STATIC_ROOT`+`collectstatic`-вайринг (тесно связан с nginx static-alias — один контракт, один PR).
- **12.1a (заведена в `sprint-status.yaml`)** — прикладная безопасность: `ALLOWED_HOSTS`, `SecurityMiddleware`, `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`/HSTS (`deferred-work.md`'s явно назначенный E12-долг) — функционально независимо от того, поднимается ли стек, только его защищённость.
- **worker/beat контейнеры — ЯВНО ВНЕ скоупа, отложены на 12.6.** Celery сегодня не установлен вовсе (`pyproject.toml` не несёт `celery`), ни одной Celery-задачи/app в кодовой базе нет — весь материал по `materialize_status_effects`/`check_lagging_submissions`/`parallel_run_diff` явно и неоднократно называет 12.6 адресом обёртки в `@shared_task`. Заводить `worker`/`beat`-сервисы в compose СЕЙЧАС означало бы поднимать контейнеры, которым нечего исполнять — мёртвая топология вместо рабочей. Отклонение от буквы эпика («compose: ... worker, beat ...») — осознанное, задокументировано здесь, не молчаливое.

1. **AC-1 (`deploy/docker-compose.yml` — новое дерево, НЕ модификация гейт-харнесса).** `Backend/VAPS/docker-compose.yml` (Postgres-харнесс `make gate`, порт 5433) НЕ трогается ни строкой — прямой запрет, повторённый 1.9/6.1/11.5 (`docker-compose.yml`-запись явно исключена из скоупа каждой из них). Новый файл — `deploy/docker-compose.yml` (repo-root, зеркало целевого дерева `architecture.md#L557-574`): сервисы `nginx`, `app` (uvicorn, `--lifespan off`), `postgres`, `redis`. `app` строится из `Backend/VAPS`'s `Dockerfile` (NEW, минимальный — `pip install -e .` без dev-extra, `CMD` — uvicorn на `config.asgi:application`).
2. **AC-2 (nginx — статика + X-Accel internal + WS upgrade + SPA fallback, все четыре контракта выполнены разом).** `deploy/nginx/vaps.conf.template` (envsubst-шаблон, официальный механизм `nginx:1.27-alpine`'s `/etc/nginx/templates/*.template` → `/etc/nginx/conf.d/*.conf` на старте контейнера — не хардкод, не самодельный entrypoint):
   - `location /protected/ { internal; alias ${VAPS_PRIVATE_STORAGE_ROOT}/; }` — буквальный контракт, зафиксированный `apps/documents/services.py`'s докстрингом (6.1 Д3): `xaccel_redirect_path` отдаёт `{VAPS_XACCEL_LOCATION}/{uuid}`, `storage_path` — `{root}/{uuid}` (плоско, без расширения) — `alias` мапит 1:1.
   - `location /static/ { alias ${STATIC_ROOT}/; }` — `deferred-work.md`'s явно назначенный E12/12.1-долг («без `collectstatic`+nginx-alias admin-CSS/JS не отдаются под `DEBUG=False`»).
   - `location /ws/ { proxy_pass ...; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s; }` — буква эпика («WS upgrade + read_timeout 3600 + ping»), зеркало `PersonnelStatus/PersonalRecordFront/nginx.conf`'s Upgrade-паттерна (донор-конвенция, другой стек, но идентичный nginx-приём).
   - **Origin-фильтрация для WS — прямое обязательство `config/asgi.py`'s докстринга** («`AllowedHostsOriginValidator` отсутствует... Origin filtering belongs to nginx in 12.1»): `map $http_origin $ws_origin_ok {...}` + `if ($ws_origin_ok = 0) { return 403; }` внутри WS-локейшна, сверяет `Origin` против единственного разрешённого значения из `${VAPS_ALLOWED_ORIGIN}`.
   - `location / { try_files $uri /index.html; }` — SPA-фолбэк для `react-router`'s history-mode роутинга (`App.tsx`'s `BrowserRouter`) — задокументированный здесь ВПЕРВЫЕ, ни одна предыдущая стори этот контракт не фиксировала.
   - `client_max_body_size` — синхронизирован с `VAPS_MAX_UPLOAD_MB` (settings.py:274, дефолт 20MB) явным значением в шаблоне с комментарием-перекрёстной ссылкой (не подставляется через env — nginx's `client_max_body_size` не читает произвольные env в вавилоне версий надёжно без доп. модулей; фиксируется числом синхронно с дефолтом Django-настройки, расхождение — предмет ручной сверки при смене одного из двух).
3. **AC-3 (`uvicorn`/`websockets` — прод-зависимости, не dev-extra).** `pyproject.toml`: `uvicorn>=0.30,<1` и `websockets>=13,<16` переносятся из `[project.optional-dependencies].dev` в `[project.dependencies]` — ГОЛЫЙ `uvicorn`, НЕ `uvicorn[standard]` (сохранить обоснование 11.6: `[standard]` тянет httptools/uvloop/watchfiles/python-dotenv, 2 лишних C-расширения в офлайн-зеркало ради скорости, не нужной на закрытом LAN с низкой нагрузкой). `Dockerfile`'s `CMD` — `uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --lifespan off` (буква эпика; `--lifespan off` — Django's `get_asgi_application()` не реализует ASGI lifespan-протокол, `--lifespan auto`/`on` уходит в неудачное lifespan-рукопожатие вместо тихого пропуска).
4. **AC-4 (`STATIC_ROOT` + `collectstatic` — контракт замкнут, не только AC-2's половина).** `config/settings.py`: `STATIC_ROOT = os.environ.get("VAPS_STATIC_ROOT", BASE_DIR / "staticfiles")` (env-переопределяемо, дефолт для dev/gate не ломается — `STATIC_URL` уже есть, `STATIC_ROOT` был единственным пробелом). `Dockerfile`'s build-этап — `manage.py collectstatic --noinput` в образ (не в рантайм-энтрипоинт — детерминированный образ, не зависящий от volume на старте).
5. **AC-5 (секреты — НЕ в бандле, процедура явно описана, не молчаливое допущение).** `deploy/.env.example` — шаблон СО ВСЕМИ именами `VAPS_*`-переменных (полный список из `config/settings.py`, включая `VAPS_SECRET_KEY`/`VAPS_DB_PASSWORD`/`VAPS_JWT_KEY`), значения — плейсхолдеры (`CHANGE_ME`), не реальные секреты. `.gitignore`-паттерн подтверждён: реальный `.env` (не `.env.example`) уже в корневом `.gitignore` (`.env`/`.env.*`, кроме явного исключения `.env.mock` — sanity-проверка на конфликт паттернов включена в Task 5). Комментарий в `deploy/.env.example`'s шапке — явная процедура: «секреты копируются на целевую машину ОТДЕЛЬНЫМ каналом (не через `.tar`-бандл 12.2, не через git) — дисциплина носителя, детальный чек-лист CHECKLIST.md — 12.5».
6. **AC-6 (регресс нулевой, живая проверка «compose up на чистой машине» реально выполнена, не продекларирована).** `make gate` (Backend/VAPS) и `npm run gate` (frontend) зелёные — новый `deploy/`-код их не задевает (существующий `Backend/VAPS/docker-compose.yml`, `Makefile`, `frontend/**` НЕ тронуты). Дев-агент ОБЯЗАН реально поднять `deploy/docker-compose.yml` (`docker compose -f deploy/docker-compose.yml up -d --wait`) на этой машине, дождаться здоровых контейнеров, вручную ударить по `/admin/login/` (200), по статике (`/static/...`, 200 после `collectstatic`), и зафиксировать факт и вывод в Completion Notes — не читать `docker-compose.yml`-синтаксис глазами и не полагаться на то, что «раз файл написан по образцу, он работает» (урок 11.6a: живой прогон нашёл 2 реальных бага, которые чтение диффа не поймало бы).

## Tasks / Subtasks

- [x] Task 1 — `Dockerfile` (`Backend/VAPS/Dockerfile`, NEW) (AC: 1, 3, 4)
  - [x] Базовый образ — `python:3.12-slim` (сверить с реальной версией из `.venv`/CI, не гадать).
  - [x] `pip install -e .` (БЕЗ `[dev]`-экстры — прод-образ не тащит pytest/ruff/hypothesis).
  - [x] `RUN python manage.py collectstatic --noinput` — детерминированная статика ВНУТРИ образа (AC-4).
  - [x] `CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--lifespan", "off"]`.
- [x] Task 2 — `deploy/docker-compose.yml` (NEW) (AC: 1)
  - [x] Сервисы: `nginx` (образ `nginx:1.27-alpine`, монтирует `nginx/vaps.conf.template` в `/etc/nginx/templates/`, порт `80:80`), `app` (build из `Backend/VAPS/Dockerfile`, env из `.env` — не `.env.example`), `postgres` (`postgres:16`, volume для персистентности данных — НЕ порт 5433 гейта, дефолтный `5432` внутри compose-сети, наружу не пробрасывается), `redis` (`redis:7-alpine`, аналогично без внешнего порта).
  - [x] `VAPS_PRIVATE_STORAGE_ROOT` — именованный volume, смонтированный ОДИНАКОВО в `app` (запись) и `nginx` (чтение, `alias` в X-Accel-локейшне) — расхождение путей молча сломало бы X-Accel.
  - [x] Healthchecks — зеркало стиля `Backend/VAPS/docker-compose.yml` (`CMD-SHELL`, `interval`/`timeout`/`retries`/`start_period`), `app`'s healthcheck — HTTP-запрос на `/admin/login/` изнутри контейнера (нет отдельного `/health/`-эндпоинта в проекте — сверить перед добавлением нового, не плодить поверхность).
- [x] Task 3 — `deploy/nginx/vaps.conf.template` (NEW) (AC: 2)
  - [x] `location /protected/` — X-Accel internal, `alias` на `VAPS_PRIVATE_STORAGE_ROOT`.
  - [x] `location /static/` — alias на `STATIC_ROOT`.
  - [x] `location /ws/` — upgrade-заголовки, `proxy_read_timeout 3600s`, Origin-`map`-гард против `VAPS_ALLOWED_ORIGIN`.
  - [x] `location /api/` — обычный `proxy_pass` на `app:8000`.
  - [x] `location /` — `try_files $uri /index.html` (SPA-фолбэк), корень — смонтированный `frontend/dist` (собранный ЗАРАНЕЕ, не внутри этого контейнера — nginx не собирает фронт).
  - [x] `client_max_body_size` — синхронизировано с `VAPS_MAX_UPLOAD_MB` дефолтом (20MB → `client_max_body_size 25m;`, небольшой запас на multipart-накладные расходы; комментарий с перекрёстной ссылкой на `settings.py:274`).
- [x] Task 4 — Промоция зависимостей (`Backend/VAPS/pyproject.toml`, MOD) (AC: 3)
  - [x] `uvicorn>=0.30,<1` и `websockets>=13,<16` — из `dev`-экстры в `[project.dependencies]`.
  - [x] Комментарий в `dev`-блоке НЕ удаляется целиком — сократить до факта переноса, ссылка на 12.1, сохранить обоснование «голый uvicorn, не `[standard]`» рядом с новым местом в основных зависимостях.
  - [x] `make gate`'s `deps`-эквивалент (если есть офлайн-зеркало-гейт наподобие `deps-gate.mjs` фронта) — сверить на бэке аналог, если есть; если нет — просто подтвердить `pip install -e .` (без dev) успешно резолвит зависимости.
- [x] Task 5 — `STATIC_ROOT` (`Backend/VAPS/config/settings.py`, MOD) (AC: 4) + `deploy/.env.example` (NEW) (AC: 5)
  - [x] `STATIC_ROOT = os.environ.get("VAPS_STATIC_ROOT", BASE_DIR / "staticfiles")` рядом с существующим `STATIC_URL`.
  - [x] `deploy/.env.example` — полный список `VAPS_*` из `config/settings.py` (см. Dev Notes — таблица уже собрана research-агентом), значения `CHANGE_ME`/безопасные дефолты для несекретных (`VAPS_DEBUG=0`, `VAPS_WS_ENABLED=1`).
  - [x] Sanity-проверка: `deploy/.env.example` НЕ подпадает под `.env`/`.env.*`-паттерн корневого `.gitignore` (иначе шаблон сам не закоммитится) — если подпадает, добавить точечное `!deploy/.env.example`-исключение тем же приёмом, что уже применён к `!.env.mock`.
- [x] Task 6 — Реальный прогон (AC: 6)
  - [x] Собрать фронт (`cd frontend && npm run build`) — `dist/` для nginx-корня.
  - [x] `docker compose -f deploy/docker-compose.yml up -d --wait` — дождаться здоровых контейнеров.
  - [x] Вручную: `curl -I http://localhost/admin/login/` (200), `curl -I http://localhost/` (200, SPA-корень), проверить статику после `collectstatic` внутри образа.
  - [x] Зафиксировать в Completion Notes: реальный вывод команд, не пересказ.
  - [x] `docker compose -f deploy/docker-compose.yml down` — не оставлять контейнеры висеть после проверки (не мешают гейту, но гигиена).
  - [x] `make gate` (Backend/VAPS) и `npm run gate` (frontend) — зелёные, регресс нулевой.

## Dev Notes

- **`deploy/` — НОВОЕ дерево, `Backend/VAPS/docker-compose.yml` НЕ трогается.** Прямой, многократно повторённый запрет (1.9, 6.1, 11.5, 11.6a): тот файл — Postgres-харнесс `make gate` (порт 5433), на нём завязан `test_ws_guards.py`'s regex-проверка Makefile. Смешение убило бы гейт.
- **Полный `VAPS_*`-env-surface (для `.env.example` и `docker-compose.yml`'s `environment`/`env_file`), собран research-агентом из `config/settings.py`:** `VAPS_SECRET_KEY`, `VAPS_DEBUG`, `VAPS_REDIS_URL`, `VAPS_DB`, `VAPS_DB_NAME`, `VAPS_DB_USER`, `VAPS_DB_PASSWORD`, `VAPS_DB_HOST`, `VAPS_DB_PORT`, `VAPS_JWT_KEY`, `VAPS_JWT_ALGORITHMS`, `VAPS_JWT_LEEWAY`, `VAPS_JWT_AUDIENCE`, `VAPS_JWT_ISSUER`, `VAPS_MAX_UPLOAD_MB`, `VAPS_ATTACHMENT_CONTENT_TYPES`, `VAPS_PRIVATE_STORAGE_ROOT`, `VAPS_XACCEL_ENABLED`, `VAPS_XACCEL_LOCATION`, `VAPS_WS_ENABLED`, плюс НОВЫЙ `VAPS_STATIC_ROOT` (AC-4) и НОВЫЙ `VAPS_ALLOWED_ORIGIN` (AC-2, WS-Origin-гард — nginx-only переменная, Django её не читает).
- **`--lifespan off` — почему именно.** Ни одна стори в кодовой базе не объясняет прозой ПОЧЕМУ, только фиксирует как архитектурное решение (`architecture.md:337`, `asgi.py`'s докстринг). Причина: `django.core.asgi.get_asgi_application()` не реализует ASGI lifespan-протокол (нет `lifespan.startup`/`lifespan.shutdown` обработчиков) — `--lifespan auto` (дефолт uvicorn) пытается ASGI lifespan-рукопожатие и либо долго ждёт, либо падает в предупреждение (уже наблюдалось как `ASGI 'lifespan' protocol appears unsupported` в логе локального uvicorn `playwright.live.config.ts`, story 11.6). `--lifespan off` пропускает это рукопожатие полностью — тихо и быстро, а не «работает, но шумит в логах».
- **Worker/beat — осознанное отклонение от буквы эпика, не недосмотр.** `materialize_status_effects.py`/`catch_up.py` дважды процитировали «12.1/12.6» неоднозначно, но `check_lagging_submissions.py`/`parallel_run_diff.py` цитируют ТОЛЬКО 12.6, и Celery physически не установлен нигде в `pyproject.toml`. Заводить пустые `worker`/`beat`-контейнеры без единой `@shared_task` — театр, не топология. Явно отложено, задокументировано, не спрятано.
- **Origin-гард в nginx — не декоративный, а прямое обязательство asgi.py.** `config/asgi.py`'s докстринг (11.1, Решение №6) буквально: «`AllowedHostsOriginValidator` deliberately absent... Origin filtering belongs to nginx in 12.1». Пропустить эту часть AC-2 значило бы оставить WS-эндпоинт открытым для CSWSH (cross-site WebSocket hijacking) — обязательство названо по номеру стори, не общая формулировка.
- **`client_max_body_size` — синхронизация вручную, не через env-подстановку.** nginx официально поддерживает envsubst ТОЛЬКО для директив внутри `.template`-файлов через `NGINX_ENVSUBST_TEMPLATE_SUFFIX`-механизм (тот же, что уже используется для X-Accel/static/WS путей выше) — технически можно было бы подставить и это значение, но `client_max_body_size` — числовая директива с суффиксом (`25m`), а `VAPS_MAX_UPLOAD_MB` — голое число (`20`) на стороне Django; смешивать единицы в одной переменной — источник рассинхрона тоньше, чем два синхронизированных вручную числа с явным комментарием друг на друга.
- **AC-1.9's урок «localhost ≠ доказательство» применим и здесь.** AC-6 требует РЕАЛЬНЫЙ `docker compose up`, не чтение синтаксиса. Полный air-gap прогон (клиентская машина, Firefox ~100, антивирус/политики/NTP) — вне скоупа этой стори (это 12.7, «прогон по рунбуку 1.9») — эта стори проверяет ТОЛЬКО, что топология поднимается и отвечает локально; сюрпризы реального контура — забота 12.7.
- **12.1a (заведена отдельно) — прикладная security-hardening.** `deferred-work.md`'s явный E12-долг: `ALLOWED_HOSTS` (сейчас `["*"]`, захардкожено), `SecurityMiddleware`, `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`/HSTS (`manage.py check --deploy` сегодня даёт W001/W009/W012/W016/W018). Функционально независимо от того, поднимается ли стек — эта стори (12.1) даёт РАБОТАЮЩУЮ, но не полностью защищённую по всем DRF/Django-чеклистам топологию; 12.1a закрывает защищённость поверх неё.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1278-1284] — буква эпика Story 12.1.
- [Source: _bmad-output/planning-artifacts/architecture.md#L333-340, #L557-574, #L264, #L321, #L467] — целевая топология, целевое дерево `deploy/`, air-gap-контекст, HTTPS-отсрочка (закрытый LAN), X-Accel-принцип.
- [Source: Backend/VAPS/config/asgi.py] — `--lifespan off`, «Origin filtering belongs to nginx in 12.1» (Решение №6, буквальная ссылка на эту стори).
- [Source: Backend/VAPS/apps/documents/services.py:1-22, :196-203] — X-Accel контракт (Д2/Д3), `xaccel_redirect_path`/`storage_path`.
- [Source: _bmad-output/implementation-artifacts/6-1-app-documents-и-attachment.md, 6-7-скачивание-и-повторная-выдача.md] — nginx internal-location, зона E12/12.1 названа явно.
- [Source: Backend/VAPS/pyproject.toml] — `uvicorn`/`websockets` dev-extra, докстринг «в рантайм-зависимости переносит 12.1».
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — ALLOWED_HOSTS/SecurityMiddleware/cookie-secure/STATIC_ROOT долги, явно назначенные E12/12.1.
- [Source: _bmad-output/implementation-artifacts/1-9-спайк-контур-проба.md] — air-gap рунбук, деление труда со спайком (1.9 — прото-версии/наблюдения, 12.1-12.5 — настоящая реализация), «localhost ≠ доказательство», FF~100-ограничение.
- [Source: Backend/PersonnelStatus/PersonalRecordFront/nginx.conf, Backend/PersonnelStatus/Personnel-Records/docker/nginx.conf] — донор-конвенции nginx-стиля (upgrade-заголовки, alias-паттерн) — стиль, не копирование (другой стек).
- [Source: frontend/src/app/App.tsx] — `BrowserRouter` (history-mode), основание SPA-фолбэка.
- [Source: frontend/vite.config.ts, frontend/package.json] — `dist/`-выход сборки, `build.target: firefox100`.

## Dev Agent Record

### Context Reference

- Собрано research-агентом (полное чтение `docker-compose.yml`/`config/settings.py`/`config/asgi.py`/`pyproject.toml` целиком, X-Accel-контракта из 6.1/6.7, всех форвард-ссылок на «12.1» по implementation-artifacts, `architecture.md`'s air-gap/деплой-секций, `1-9`-спайка целиком, донор-nginx-конфигов как стилевого прецедента, `frontend`'s build/routing-контракта).

### Completion Notes

Реализовано по плану. Первая инфраструктурная стори проекта — живой прогон (AC-6) оказался незаменим и нашёл 4 реальных бага, которые чтение YAML/nginx-конфига глазами не поймало бы ни одного:

1. **`Dockerfile` забыл `COPY manage.py`** — `collectstatic` падал на build-этапе с `[Errno 2] No such file or directory`. Исправлено.
2. **nginx's стоковый `default.conf` перехватывал ВСЕ запросы с `Host: localhost`** (точное совпадение `server_name localhost;` побеждает наш `default_server` для этого конкретного заголовка) — весь наш `server`-блок был недостижим молча, симптом — 404 от `/usr/share/nginx/html`, не ошибка конфигурации. Исправлено бинд-маунтом `/dev/null` поверх `default.conf` (стандартный docker-приём).
3. **`VAPS_ALLOWED_ORIGIN` без `:?`-гварда fail-open на пустом значении** (ревью, Blind Hunter) — WS-запрос БЕЗ заголовка Origin вовсе (небраузерные клиенты могут его не слать) проходил бы Origin-проверку, если переменная не задана. Исправлено: `:?`-обязательность в `docker-compose.yml` + defense-in-depth явный `"" 0;` в самом nginx `map`-блоке. **Живым прогоном подтверждено**: подделанный Origin → 403, ОТСУТСТВУЮЩИЙ заголовок Origin → 403, правильный Origin → пропущен до `proxy_pass` (curl без реального WS-рукопожатия дальше получает Django-404 от HTTP-роутера — ожидаемый артефакт инструмента проверки, не баг конфигурации).
4. **Собственная деструктивная ошибка при верификации, задокументирована прозрачно**: `docker compose down -v --remove-orphans` (первый прогон) удалил 5 ЧУЖИХ уже остановленных контейнеров (`deploy-db-1`, `deploy-directus-1`, `deploy-api-1`, `deploy-seed-1`, `deploy-migrate-1`), совпавших по дефолтному имени compose-проекта («deploy», из имени каталога) с новым `deploy/`-деревом этой стори. Данные (именованные volume'ы, образы) не пострадали — только сами контейнеры, тривиально восстановимые `docker compose up` из их собственного проекта. Пользователю сообщено немедленно. Второй/финальный прогон — с явным `-p vaps-story-12-1`, коллизий больше не было.

**Ревью (3 агента, cross-model):**
- **Blind Hunter** (diff-only) нашёл САМУЮ значимую находку этой стори — `VAPS_ALLOWED_ORIGIN` fail-open на пустом значении (см. п.3 выше, исправлено). Остальные 9 наблюдений — либо false positive (static-volume «shadowing», опровергнуто эмпирически: Docker копирует содержимое образа в свежий именованный volume при первом монтировании — подтверждено `docker compose exec app ls /app/staticfiles` до фикса #2), либо приняты как есть с обоснованием (client_max_body_size — документированный ручной синк, не автоматизированный; отсутствие `restart:` — добавлено `unless-stopped` на все 4 сервиса).
- **Edge Case Hunter** (полный доступ к проекту) независимо подтвердил X-Accel путь корректен байт-в-байт (сверено с `apps/documents/services.py`'s `xaccel_redirect_path`/`storage_path`), `if`-блок для WS-Origin безопасен (bare `return` — одна из немногих безопасных форм `if` в nginx), Redis URL совпадает с compose. Поднял вопрос доставки JWT PEM для AC-5 — уточнён комментарий в `.env.example`, механизм явно назван нерешённым и адресован 12.5.
- **Acceptance Auditor** независимо перепрочитал код, прогнал `make gate` (2803 passed) и `npm run gate` (1007 passed), САМ поднял живой стек (с собственным `.env`), столкнулся с ТЕМ ЖЕ stale-volume-коллизией от чужого проекта, корректно определил её как несвязанную с этой стори, прогнал `down -v` для чистого старта — все 6 AC подтверждены независимо, включая реальные `curl` с проверкой содержимого (не только кода ответа).

Финальный прогон (после всех фиксов, изолированный `-p vaps-story-12-1`): 4/4 контейнера healthy, `/admin/login/` → 200 (реальный Django admin), `/static/admin/css/base.css` → 200 (реальный CSS), `/` → 200 (реальный собранный SPA), WS Origin-гард — 3/3 тестовых сценария (deny/deny/allow) прошли как задумано.

### File List

- `Backend/VAPS/Dockerfile` (NEW) — прод-образ, collectstatic на build-этапе.
- `deploy/docker-compose.yml` (NEW) — nginx+app+postgres+redis, `restart: unless-stopped`, `:?`-обязательность `VAPS_ALLOWED_ORIGIN`.
- `deploy/nginx/vaps.conf.template` (NEW) — envsubst-шаблон, `default_server`+`default.conf`-глушение, X-Accel/static/WS-Origin/SPA-fallback.
- `deploy/.env.example` (NEW) — полный `VAPS_*`-surface, плейсхолдеры секретов.
- `Backend/VAPS/config/settings.py` (MOD) — `STATIC_ROOT`.
- `Backend/VAPS/pyproject.toml` (MOD) — `uvicorn`/`websockets` из dev-extra в основные зависимости.
- `Backend/VAPS/apps/notifications/tests/test_ws_guards.py` (MOD) — гвард-тест перевёрнут (uvicorn теперь ОБЯЗАН быть в runtime, не запрещён).

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
| 2026-07-29 | dev-story: реализация + 2 бага найдены и исправлены живым прогоном (Dockerfile, nginx default.conf) + 1 баг найден ревью (WS Origin fail-open) + собственная деструктивная ошибка на чужих контейнерах, раскрыта прозрачно, данные не пострадали → done |
