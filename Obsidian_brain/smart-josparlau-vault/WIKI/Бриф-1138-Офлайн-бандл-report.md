# №1138 — отчёт реализации файлов офлайн-бандла

Дата: 10.09.2026. Исполнитель: Кодекс Астра 6.

Статус делегированной реализации: DONE_WITH_CONCERNS. Тяжёлая сборка, перенос/load, запуск и браузерная приёмка остаются контроллеру; готовность блока1 целиком не заявлена.

## Изменения

Коммит `90de20411082c15b2090f9e76827f7d6eaa58e7c`, ветка `codex/contour-offline-1138`; 15 файлов, +569 строк, не пушил.

- `deploy/contour/build-bundle.sh`: online prepare тянет bases Python3.12-bookworm/Node22-alpine/PostgreSQL15/Redis7-alpine/nginx1.28-alpine, полные pinned Python requirements и production base constraints, Node deps+prod deps, сохраняет prepared-images.tar.gz и wheelhouse. Offline build загружает prepared archive, все три source build используют --network=none --pull=false, сохраняет runtime-images.tar.gz, manifest ID/digest, platform, source SHA и sha256.
- `snapshot.py`: только git-tracked backend/frontend/deploy с исключением local env, node_modules/venv, БД, media/private_storage/staticfiles, тестовых каталогов, старых Dockerfiles/docker-compose и логов. Точный allowlist deployment files. Отказ при tracked symlinks. Prepare требует чистые app/deploy пути, поэтому snapshot соответствует commit.
- Compose без build и pull_policy never: новый PostgreSQL15 volume, Redis7 cache/channels, backend gunicorn+uvicorn-worker ASGI, standalone Next, nginx. Internal network, published только proxy3118, bounded logs. Никакие чужие сервисы/volumes/host network не меняются.
- Nginx: same-origin portal/API/admin/static/media, NextAuth исключение /api/auth, WebSockets, internal X-Accel private storage; CSP дословно по уточнению контроллера.
- Contour Django settings: DEBUG False, env ALLOWED_HOSTS/CORS/CSRF, UTC containers и Asia/Qyzylorda business timezone, файл django.log 10MiB×6, один gunicorn worker. Entry point migrate+collectstatic, без pip на старте.
- Install: checksum перед load, runtime env обязательный, проверка свежих разных секретов длиной32+, LAN URL, compose --pull never --no-build --wait, наблюдение времени. Не исполняет .env как shell и не печатает секреты.
- README — минимальные эксплуатационные инструкции; полноценный рунбук/clean bootstrap остаются блокам3/7. UI/бизнес-код не менялся. Фактически fonts.google/Sentry init в просматриваемых app/components/widgets/features/shared/lib не обнаружены; media в браузере относительные, DSN явно пуст.

## Синтаксические проверки

`bash -n deploy/contour/build-bundle.sh deploy/contour/install.sh` → exit0.

`sh -n deploy/contour/entrypoint.sh` → exit0.

Python ast.parse →
```text
Python syntax OK: deploy/contour/snapshot.py
Python syntax OK: Backend/PersonnelStatus/Personnel-Records/organization_management/config/settings/contour.py
Shell syntax OK (bash -n and sh -n)
```

`docker compose -f deploy/contour/docker-compose.yml config --quiet` c несекретными syntax-only env placeholders → exit0, вывод пуст.

`git diff --cached --check` → exit0, вывод пуст.

Pytest, e2e, smoke и новые тесты не запускались/не создавались по прямому запрету. Docker build/load/up и браузер этим исполнителем не запускались — не подменять эти синтаксические команды фактической приёмкой.

## Команды контроллеру

```bash
bash deploy/contour/build-bundle.sh prepare /absolute/new/contour-bundle
bash deploy/contour/build-bundle.sh build /absolute/new/contour-bundle
```

В новом output-каталоге заполнить `.env` по `.env.example` актуальным IP10.115.70.68 и новыми секретами из защищённого файла (не печатать), затем `bash install.sh`. Порт3118. `docker compose exec backend python manage.py createsuperuser` — отдельный superuser чистой БД; текущий seed_operations не запускать. Для повторения offline source build на другой машине: `bash build-bundle.sh build "$PWD"`. Полный каталог bundle переносится целиком.

## Ограничения и риски для проверки

1. Реальную разрешимость pinned wheelhouse подтверждает prepare; разрешённый набор синтаксических команд это не доказывает. Архитектура CPU должна совпадать с platform.txt, cross-platform сборка не реализована.
2. Worker/beat честно не запускаются, schedule пуст; автоматические статусы/уведомления/асинхронные отчёты недоступны. Запись добавлена в Known-Issues. Redis cache/channels включён.
3. PostgreSQL15 только новый volume; live PostgreSQL16 данные/секреты не перенесены. Clean bootstrap ролей/справочников отдельный блок3.
4. CSP требуется проверить фактическими кликами/консолью браузера, включая WebSocket same-origin; несетевые inline скрипты/стили допускаются для Next и admin.
5. HTTP LAN по умолчанию, TLS/backup/restore/update/rollback — не реализуются блоком1. Существующий volume не принимает новый POSTGRES_PASSWORD без отдельной смены пароля БД.
6. Python image включает подготовительный wheelhouse и системные build deps; размер больше минимального runtime сознательно ради повторения offline. Архивы gzip-1 экономят место, но хост должен вместить также распакованные образы.

Решения и ход работы записаны в Infrastructure/Decisions.md, Changelog.md, Known-Issues.md; полной второй копии проектной документации в repo не создано (README — необходимая часть переносимого install комплекта).

### 10.09.2026 — №1138: исправлен review blocker nginx redirect

Исполнитель: Кодекс Астра 6. По подтверждённому контроллером review найдено: server listen80 при опубликованном3118 и default absolute_redirect on строил redirect без внешнего порта. В deploy/contour/nginx.conf добавлен `absolute_redirect off;`: относительные Location сохраняют browser origin с портом. Проверка синтаксиса фактическим nginx1.28-alpine в одноразовом контейнере `docker run --rm --pull=never --network=none --add-host backend:127.0.0.1 --add-host frontend:127.0.0.1 -v <nginx.conf>:/etc/nginx/conf.d/default.conf:ro --entrypoint nginx nginx:1.28-alpine -t` → exit0: `syntax is ok`, `test is successful`. Это только синтаксическая проверка; HTTP/browser не запускались. `git diff --check` → exit0. Коммит `45d67d29782c7c158c2e4dc88be43ac6d4079f9e`; не пушил. Подготовка зависимостей контроллера продолжается из90de2041, перед source build требуется обновить snapshot до финального SHA (dependencies не изменены).

### 10.09.2026 — №1147: минимальные Suspense fixes переданы контроллеру

Исполнитель: Кодекс Астра 6. Коммиты `25e48491` (10 прямых page consumers, +93/-7) и `7ef8088ba461c3f97d78c4b9ca41cf9099ab6f33` (непрямой consumer service-summary, +10 строк). Все затронутые default pages теперь оборачивают прежнее неизменённое тело в *Screen + Suspense с текущим проектным fallback. UI-содержимое, API-режим, layout/readiness и зависимости не менялись.

Дополнительный поиск потребителей вне app выявил11-ю страницу: service-summary/page.tsx → features/service-summary/ui/ServiceSummaryScreen.tsx:30 useSearchParams, без границы в родительской странице. Sidebar имеет собственную Suspense; forces collections/workspace/department requests обслуживаются page employees с существующей границей, ForcesRequestBanner — statuses с границей, visit/approval — events/[id] с границей, service-employees — собственной page границей. Поэтому эти соседние компоненты не менялись.

Разрешённая TSX синтаксическая проверка в одноразовом prepared Node image с --network=none --pull=never, readonly mount и TypeScript createSourceFile.parseDiagnostics дала `TSX syntax OK` для всех11 путей, exit0. `git diff --check` после обоих изменений exit0. Ни pytest/e2e/smoke, ни тяжёлой сборки/браузера мной не запускалось. Контроллер повторяет реальную офлайн-сборку; на момент записи прогон из25e48491 уже запущен, а service-summary fix7ef8088b войдёт в последующее обновление snapshot. Готовность бандла пока не заявлена.

### 10.09.2026 — №1147: уточнение от успешной сборки, лишняя11-я правка отменена

Исполнитель: Кодекс Астра 6. Контроллер сообщил фактический успех offline frontend/proxy build из25e48491. Повторное полное чтение features/service-summary/ui/ServiceSummaryScreen.tsx подтвердило ошибку первоначального read-only анализа: useSearchParams находится во внутреннем `ServiceSummaryBody`, а экспортируемый `ServiceSummaryScreen` УЖЕ оборачивает это тело в Suspense (внизу файла). Permissions loading не является объяснением: hook исполняется раньше role guard; сборку защищает именно существующая внутренняя Suspense. Поэтому утверждение предыдущей записи «11-я страница без любой boundary» НЕВЕРНО.

Лишняя page boundary7ef8088b отменена отдельным `git revert --no-edit 7ef8088b`, revert commit `5848728995aef4eaa8084d32d668b85e3a6b7c02`. Другие10 исправлений25e48491 сохранены. `git diff --check` → exit0; `git diff --exit-code 25e48491 -- Backend/PersonnelStatus/PersonalRecordFront/app/security-ops/service-summary/page.tsx` → exit0, вывод пуст: страница полностью совпадает с уже собранным snapshot25e48491. Тесты и сборки этой сессией не запускались. Итог:10 исправленных страниц, НЕ11. Контроллеру передан свежий SHA для корректной привязки source-revision; dependency prepared images остаются теми же.

### 10.09.2026 — №1148: ASGI порядок исправлен, передано на фактический boot

Исполнитель: Кодекс Астра 6. Коммит `92f849df449edd324b639c99f88d33f76f66147a`: config/asgi.py теперь задаёт settings и инициализирует Django get_asgi_application до импорта channels/auth и model-importing маршрутов. HTTP использует тот же созданный ASGI объект; routing.websocket_urlpatterns + ops_routing.websocket_urlpatterns и AuthMiddlewareStack не изменены. WSGI fallback не добавлялся. Изменён1 файл, +8/-4 строки.

Разрешённые проверки: Python ast.parse → `Python syntax OK: Backend/PersonnelStatus/Personnel-Records/organization_management/config/asgi.py`, exit0; `git diff --check` exit0. Синтаксис не доказывает фактический boot, повторный offline build/install выполняет контроллер. БД/контейнеры/сеть и секреты этой сессией не трогались; тесты не запускались.

### 10.09.2026 — №1138: выделена ingress-сеть для публикации proxy

Исполнитель: Кодекс Астра 6. По фактической проверке контроллера ASGI boot92f849df прошёл и install2 вернул0, но hostIP:3118 отвечал connection refused. На Docker27/29 proxy, подключённый только к internal сети, имел HostConfig.PortBindings80→3118 при NetworkSettings.Ports={}: публикация не включилась. По указанию контроллера nginx подключён к default internal:true и отдельной стандартной bridge-сети ingress. Backend/frontend/db/redis остаются только в default internal.

README уточняет: ingress не ограничивает egress proxy на online-хосте; физическая закрытость LAN обеспечивается хостом/контуром. Приложение не требует внешних сервисов, фактическую приёмку проводят в лаборатории без внешних маршрутов/DNS с доступом из connected LAN. Прежнее описание полной изоляции всех контейнеров internal сетью заменено, его нельзя использовать как обещание no-egress proxy. Лабораторную сеть эта сессия не меняла.

Коммит `c493128915159f7696b40a9a7ad5392f63d6416c`,2 файла,+16/-2. Разрешённая проверка `docker compose -f deploy/contour/docker-compose.yml config --quiet` с несекретными syntax-only placeholders → exit0; `git diff --check` → exit0, оба без вывода. Ни tests, ни build/start/HTTP этой сессией не запускались. Фактическую проверку published-port выполняет контроллер.

### 10.09.2026 — №1138: read-only диагностика Redis WS timeout и логирования query

Исполнитель: Кодекс Астра 6. По поручению контроллера выполнены только чтения через `docker exec sj-offline-daemon-1138 docker exec smart-josparlau-contour-final-backend-1 python -c ...`, чтение nginx.conf и обезличенный подсчёт строк логов. Стек, исходники, данные и секреты не менялись. Назначение отдельных карточек для исправлений ожидается.

**Подтверждённая причина WS reconnect.** Фактически установлены redis8.1.0, channels-redis4.3.0, channels4.3.2, Django5.1.15, uvicorn0.52.4, uvicorn-worker0.4.0. Из inspect.signature shipped redis.asyncio.connection.AbstractConnection.__init__: socket_timeout=5, socket_connect_timeout=5. Из actual runtime get_channel_layer: RedisChannelLayer, brpop_timeout=5, host option keys только host/port, socket_timeout не переопределён. Channels _brpop_with_clean вызывает `await connection.bzpopmin(channel, timeout=timeout)`, receive_single передаёт brpop_timeout5 и пропускает exception наружу. Redis read_response применяет собственный self.socket_timeout и по asyncio.TimeoutError отключает соединение и выбрасывает `TimeoutError: Timeout reading from redis:6379`. В пустом канале серверный BZPOPMIN5с и клиентский socket5с гоняются; клиент рвёт ожидающее чтение. Это ошибка сочетания конфигурации с фактической версией, не отсутствие Redis и не nginx proxy_read_timeout (он3600с). Последние300 строк backend:5 Redis timeout строк,4 accepted WS строки.

**Минимальное предложение для отдельной карточки.** Только в contour CHANNEL_LAYERS.hosts использовать dict с socket_timeout=None и socket_connect_timeout=5; серверный BZPOPMIN по-прежнему завершается через5с и loop продолжает ждать, async receive остаётся отменяемым. Не менять Redis cache, auth, nginx timeouts или transport URL, не откатывать redis package. Фактическую стабильность после изменения подтверждать тем же браузерным соединением и отсутствием Redis timeout.

**Логирование query — отдельная находка, не факт текущей утечки.** Nginx shipped /etc/nginx/nginx.conf имеет log_format main с `$request` и `$http_referer`, inherited access_log main; контур не переопределяет формат. ops/ws_auth.py документирует query token и требование URI без аргументов. При запросе ops JWT endpoint полный request может попасть в access-log. Но текущий frontend lib/ops-ws.ts открывает старый `/ws/notifications/` без token; в последних300 backend и147 proxy строках количество строк с `[?&]token=` равно0. Значения токенов не выводились и в vault не записаны. Нельзя считать потенциальную возможность доказанной текущей утечкой. Минимально nginx access-log должен использовать `$request_method $uri $server_protocol` и исключить request_uri/args/request/referrer.

Дополнительно shipped Uvicorn WebSocketProtocol.asgi_send на accepted/403 пишет `get_path_with_query_string(self.scope)` в logger.info. Поэтому санитарная настройка только nginx не закрывает queryJWT в backendлогах при ops-route. Перед карточкой исправления определить scoped redaction-filter для Uvicorn либо допустимый уровень его событий; без отдельного решения logging не менялся.

### 10.09.2026 — №1150: устранена гонка Channels BZPOPMIN и Redis socket timeout

Исполнитель: Кодекс Астра 6. Карточка1150 In Progress, исправление разрешено контроллером. После read-only подтверждения redis8.1.0 socket_timeout5 против channels-redis4.3.0 brpop_timeout5 в contour settings CHANNEL_LAYERS переопределён отдельным dict: socket_timeout=None, socket_connect_timeout=5. Только channel layer; cache/auth/transport/front не менялись. Сервер Redis по-прежнему ограничивает BZPOPMIN5секундами, чтение не обрывается конкурирующим5-секундным таймером клиента.

Коммит `66360b3321e7202023ab4277e4fb6fb2178c7e82`,1 файл,+18 строк. Python ast.parse → `Python syntax OK: Backend/PersonnelStatus/Personnel-Records/organization_management/config/settings/contour.py`, exit0; git diff --check exit0. Ни тесты, ни runtime-команды, ни сборка/мутации стека при реализации не выполнялись. Реальную устойчивость idle WebSocket после сборки подтверждает контроллер браузером и логами.

### 10.09.2026 — №1151: query исключён из nginx/Uvicorn access и handshake logs

Исполнитель: Кодекс Астра 6. Карточка1151 In Progress, исправление разрешено контроллером. В deploy/contour/nginx.conf добавлен log_format contour_path с request_method/uri/server_protocol, status/bytes/user-agent; исключены request/request_uri/args/referrer. Server access_log использует этот формат для всех локаций, включая WS.

Shipped UvicornWorker.__init__ прочитан read-only: он назначает handlers uvicorn.error/uvicorn.access до Django startup, создаёт Config с log_config=None. Django contour LOGGING назначает ASGIPathOnlyFilter этим двум логгерам, выводит INFO/error события в прежние bounded console+file handlers без propagation. Фильтр изменяет ТОЛЬКО строковые positional path args, начинающиеся `/`, отсекая `?query`; record.msg, status, level, exception и traceback сохраняются, события не подавляются. uvicorn.error включён намеренно: WebSocket accepted/403 в shipped Uvicorn идут именно туда, фильтр одного access не защищает handshake. Другие логгеры, auth, frontend и протоколы не менялись.

Новый helper `organization_management/config/logging_filters.py` tracked; snapshot.py включает tracked backend/config файлы, поэтому helper попадёт в source/bundle без изменения snapshot allowlist. Коммит `301e3754da273d8af6003ae9457c6db40fd056e1`. Python ast.parse settings/contour.py и logging_filters.py дал2×`Python syntax OK`, exit0. Реальный nginx1.28-alpine `-t` в одноразовом --network=none --pull=never контейнере без published ports дал `syntax is ok`/`test is successful`, exit0. git diff --cached --check exit0. Это только синтаксис, не runtime/filter-тест; тесты, heavy builds и mutations live stack не выполнялись. Runtime redaction и повторный idle browser WS подтверждает контроллер после сборки.

Уточнение предыдущей записи1150: фактический diff66360b33 содержит+17строк (ранее ошибочно написано+18). SHA и содержимое конфигурации прежние.

### 10.09.2026 — №1151: закрыт review residual в nginx error-log

Исполнитель: Кодекс Астра 6. Независимое review подтвердило: безопасный access-log не покрывает error_log notice — nginx добавляет полный request/upstream/referrer при upstream failure. По разрешению контроллера добавлены production nginx-error-filter.awk и proxy-entrypoint.sh без новых зависимостей. BusyBox awk отсекает query-сегмент от `?` до whitespace/quote в каждой строке, оставляя отметку `?[redacted]`, error diagnostic, URI paths и остальные поля. Каждая строка flush сразу. Никакие error-события по уровню не отключаются. Server error_log явно stderr notice, master error.log в shippedimage является symlink /dev/stderr и попадает в тот же поток.

POSIX shell supervisor (PID1) запускает filter-reader FIFO и оригинальный /docker-entrypoint.sh → nginx, передаёт TERM/INT/QUIT/HUP/USR1 главному процессу, повторяет interrupted wait, дожидается завершения nginx и EOF/drain reader, возвращает nginx status (если nginx успешен, но reader упал — reader status). FIFO во временном закрытом каталоге mode600; сырые логи в обычный файл не пишутся. Идея directexec nginxPID1 отвергнута: контейнер мог бы завершиться до drain последних startup/error строк. Nginx пакет/сеть не менялись, CMD daemon off явный. Snapshot explicit allowlist дополнен обоими helperфайлами.

Коммит `5ef686a821273fb413b416c3f0391a54f189706f`,5файлов. Проверки только синтаксические: `sh -n deploy/contour/proxy-entrypoint.sh` exit0; BusyBox awk1.28-alpine `-f /filter.awk /dev/null` (пустойввод, толькоparse) exit0; фактический nginx1.28-alpine `-t` с new config в одноразовом --network=none --pull=never контейнере без published ports → `syntax is ok`/`test is successful`, exit0; Python ast.parse snapshot.py → `Python syntax OK`, exit0; git diff --cached --check exit0. Test scripts не создавались, heavybuild и live-stack mutations отсутствуют.

Контроллер подтвердит actual runtime: свой backend кратко остановить, browser запрос admin с несекретным markerquery вызывает502, затем восстановитьbackend; проверить наличие полезнойошибки и отсутствиеmarker; proxy stop/start дляsignals/drain. Это ещё не выполнено этой сессией и не заявляетсякакрезультат. Предыдущее Uvicornрешение301e3754 review признало корректным, не изменялось. Контроллер также сообщил фактическую устойчивость Redis1150 >43с без reconnect/timeout.

### 10.09.2026 — №1151: ограничен graceful shutdown nginx workers

Исполнитель: Кодекс Астра 6. Факт от контроллера: source5ef686a8 успешно собрался в build6, но `docker stop --time10` собственного offline proxy при активном browser WebSocket завершил контейнер ExitCode137, StopSignalSIGQUIT. Контроллер сразу запустил только этот proxy заново. Причина: наследуемый graceful shutdown nginx ждёт активный WS без дедлайна; Docker через10секунд убивает PID1 до гарантированного завершения/drain.

Минимальный fix: в deploy/contour/Dockerfile.proxy CMD добавлена main-context директива `worker_shutdown_timeout 5s;` через `nginx -g`, рядом с daemon off. В conf.d/http-context директива не добавлялась. Shell supervisor, FIFO/filter, frontend и остальные настройки не менялись. Пять секунд ограничивают worker lifecycle и оставляют запас до Docker10s для выхода master и drain stderr.

Коммит `089a38678dbe2f5ef6976ffd057defa7400f53d0`,1 файл,+1/-1. Разрешённая syntax-команда с фактическим nginx1.28-alpine в одноразовом --network=none --pull=never контейнере без ports: `nginx -t -g 'daemon off; worker_shutdown_timeout 5s;'` → `syntax is ok`, `test is successful`, exit0. `git diff --check` exit0. Тесты/build/runtime-stop/start этой сессией не запускались. Контроллер выполнит final build7 и повторит реальную остановку; окончательный lifecycle успех пока не заявляется.
