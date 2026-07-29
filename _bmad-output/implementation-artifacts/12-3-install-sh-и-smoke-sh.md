---
baseline_commit: 9178bf8
---

# Story 12.3: install.sh и smoke.sh

Status: done

## Story

As a **админ контура, устанавливающий/обновляющий VAPS в закрытом LAN**,
I want **`install.sh`: чек-суммы → бэкап → `docker load` → `docker compose up` (миграции — часть `app`'s собственного старта, 12.1) → `smoke.sh` → инструкция отката при провале**,
so that **установка/обновление — воспроизводимый рунбук, а не ручная последовательность команд по памяти**.

## Acceptance Criteria

Источник: `epics.md#L1292-1296` (буква стори) + `architecture.md#L559-565` (целевые пути `deploy/scripts/{install.sh,smoke.sh}`) + `deploy/spike-1.9/install-probe.sh`+`RUNBOOK.md` (прото-механика: sha-check+load+up доказаны, backup/migrate/rollback/API-smoke явно отложены СЮДА собственным докстрингом скрипта и RUNBOOK.md §4).

Скоуп — 4 файла (≤5, одна ответственность — установочный рунбук): `deploy/scripts/install.sh` (NEW), `deploy/scripts/smoke.sh` (NEW), `deploy/docker-compose.yml` (MOD — см. AC-0 ниже, находка при исследовании, не расползание скоупа), структурный тест (regex-стиль, зеркало 12.2's `test_bundle_script.py`).

0. **AC-0 (найдено при create-story — предпосылка, без которой install.sh не может работать в принципе).** `deploy/docker-compose.yml`'s `app`-сервис сегодня — ТОЛЬКО `build: {context: ../Backend/VAPS}`, без `image:`. На целевой air-gap-машине НЕТ исходников `Backend/VAPS` (переносится только `*-images.tar`, не git-дерево) — `docker compose up` без `--build` и без соответствующего `image:` либо попытается собрать из НЕсуществующего контекста, либо (если образ уже когда-то был собран под безымянным тегом) не найдёт нужный конкретно-версионированный образ. Комментарий в самом файле (уже строка 71-73, от 12.1) ЯВНО называет 12.3 адресом полного рунбука — это не новый разрыв скоупа, а недостающая часть уже анонсированного контракта. Фикс: `app`-сервис получает `image: vaps-app:${VAPS_APP_SHA:-dev}` РЯДОМ с существующим `build:` (docker compose поддерживает оба одновременно — `image:` называет тег, под которым результат используется/ищется; `docker compose up` без `--build` использует уже существующий локальный тег, не пересобирает). `install.sh` экспортирует `VAPS_APP_SHA` из `manifest.json`'s `sha` ДО `docker compose up` — оператору ничего вручную заводить не нужно.
1. **AC-1 (чек-суммы — стоп ДО любых изменений на битом архиве).** `sha256sum -c *-sha256sums.txt` — первый шаг, ДО `docker load`, ДО бэкапа. Провал → явное сообщение, `exit 1`, ничего не тронуто (ни бэкапа, ни load, ни compose up).
2. **AC-2 (бэкап БД и файлового volume — ПЕРЕД мутацией, минимальный, самодостаточный).** Не то же самое, что 12.4's ночная джоба (её ещё нет) — inline safety-net этой стори: `pg_dump` через `docker compose exec postgres` в файл + `docker run --rm -v private_storage:/data ... tar czf` для файлового volume. Пропускается ТОЛЬКО на первой установке (нет `.installed-sha`-маркера — нечего бэкапить) — не на «том же sha» (переустановка/ретрай того же бандла всё ещё мутирует состояние, бэкап нужен).
3. **AC-3 (`docker load` + `docker compose up`, миграции — не отдельный шаг).** `docker load -i *-images.tar` (все 4 образа из 12.2). `VAPS_APP_SHA` экспортирован из `manifest.json` (AC-0). `docker compose up -d --wait` — миграции уже встроены в `app`'s `command` (12.1: `migrate --noinput && uvicorn ...`) — install.sh НЕ дублирует отдельный `docker compose run ... migrate`, полагается на существующий healthcheck-gated `--wait` (провал миграции = `app` не становится healthy = `--wait` падает с понятным таймаутом, не тихим «вроде взлетело»).
4. **AC-4 (`smoke.sh` — health + login + по одному запросу на каждый `/api/<context>/`).** Источник контекстов — `Backend/VAPS/config/urls.py` (6 префиксов: `core`/`operations`/`audit`/`notifications`/`documents`/`parallel-run`). **Скоуп-сужение, задокументировано явно (буква эпика не детализирует механизм "логин" для JWT-только-верификации системы без своего token-issuer — исследовано при create-story):** «health» = `GET /api/parallel-run/health/` (единственный по-настоящему `AllowAny`-эндпоинт, 200/503 — уже используется как паттерн 12.1's healthcheck-стиля); «логин» = `GET /admin/login/` возвращает 200 (доказывает, что Django admin's auth-подсистема жива и отдаёт форму — НЕ credentialed round-trip: у VAPS нет своего token-issuing эндпоинта, внешний Auth выдаёт JWT, verify-only; настоящая логин-проба потребовала бы реального IdP-токена, недоступного install.sh — открытый вопрос, адресован будущей стори при появлении тестового IdP). По одному `GET` на каждый из 6 `/api/<context>/`-роутов (список-эндпоинт каждого приложения). **Живым прогоном (не гипотеза create-story) уточнено**: анонимный запрос к RBAC-защищённому эндпоинту — НЕ 200 (`DEFAULT_PERMISSION_CLASSES: []` на уровне DRF не значит анонимный доступ — `EffectivePermissionsResolver` всё равно гейтит ниже по стеку); реально наблюдаемые коды — `403` (5 из 6 контекстов, структурированный `PERMISSION_DENIED`-конверт) и `405` (`documents/attachments/` — только `POST`, `GET` не зарегистрирован на list-действие). Оба — доказательство «стек жив и отвечает корректно», не провал; smoke.sh ожидает ИМЕННО эти коды, не голый 200.
5. **AC-5 (упавший smoke → инструкция отката, не тихий провал).** `install.sh` персистит `.installed-sha` (в `deploy/`, НЕ в переносимом бандле — аналог `bundle.sh`'s `.last-bundle-sha`, но на СТОРОНЕ контура, не dev-машины) ДО `docker compose up`, читает ПРЕДЫДУЩЕЕ значение (если было) ДО перезаписи. Провал `smoke.sh` → `install.sh` печатает конкретную процедуру: `docker compose down`, `docker tag vaps-app:<PREV_SHA> ...`, `VAPS_APP_SHA=<PREV_SHA> docker compose up -d --wait`, путь к только что сделанному бэкапу — не общие слова «откатитесь», а команды с реальными значениями подставлены.
6. **AC-6 (регресс нулевой).** `make gate` зелёный. `deploy/spike-1.9/install-probe.sh` не трогается (прото-скрипт, докстринг которого сам называет эту стори преемником).

## Tasks / Subtasks

- [x] Task 1 — `deploy/docker-compose.yml` (MOD) (AC: 0)
  - [x] `app`-сервис: добавить `image: vaps-app:${VAPS_APP_SHA:-dev}` рядом с существующим `build:`.
- [x] Task 2 — `deploy/scripts/install.sh` (NEW) (AC: 1, 2, 3, 5)
  - [x] `set -euo pipefail`, принимает `<bundle-dir>` аргументом (где лежат `*-images.tar`/`*-frontend.tar`/`*-manifest.json`/`*-sha256sums.txt` — транспортный набор, переносится ЦЕЛИКОМ вместе с `deploy/`-деревом, RUNBOOK.md's список переноса).
  - [x] `sha256sum -c` — первым, до любых мутаций.
  - [x] Чтение `manifest.json`'s `sha` → `VAPS_APP_SHA`.
  - [x] Бэкап (пропущен только на первой установке): `pg_dump` + `tar czf` volume'а, в `deploy/pre-install-backups/<timestamp>-<prev-sha>/`.
  - [x] `docker load` + `.installed-sha` (читается ДО перезаписи, пишется ПОСЛЕ успешного `docker compose up --wait`) + `docker compose -f deploy/docker-compose.yml up -d --wait`.
  - [x] Вызов `smoke.sh`; провал → печать команд отката с реальными значениями + `exit 1`.
- [x] Task 3 — `deploy/scripts/smoke.sh` (NEW) (AC: 4)
  - [x] `GET /api/parallel-run/health/` (health).
  - [x] `GET /admin/login/` == 200 (login, задокументированное сужение).
  - [x] По одному `GET` на список-эндпоинт каждого из 6 `/api/<context>/`.
  - [x] Ненулевой exit при любом непройденном шаге, понятное сообщение какой именно.
- [x] Task 4 — Структурный тест (`Backend/VAPS/apps/core/tests/test_install_and_smoke_scripts.py`, NEW) (AC: 0, 1, 2, 3, 4, 5, 6)
  - [x] Зеркало `test_bundle_script.py`: regex/текстовые проверки формы (sha-check первым, все 6 контекстов присутствуют в smoke.sh, `.installed-sha` читается ДО перезаписи, `image:` присутствует в docker-compose.yml рядом с `build:`, спайк не тронут).
- [x] Task 5 — Реальный прогон (AC: 1, 2, 3, 4, 5, 6)
  - [x] Реальный `install.sh` на бандле из 12.2 (свежая сборка) — sha-check/бэкап/load/up/smoke живьём.
  - [x] Битый архив (испорченная чек-сумма) — install.sh реально останавливается ДО docker load.
  - [x] `make gate` — зелёный.

## Dev Notes

- **AC-0 — не расползание скоупа, а закрытие уже объявленного 12.1-комментарием пробела.** `deploy/docker-compose.yml:71-73` уже называл 12.3 адресом «полноценного рунбука» — отсутствие `image:` было буквально недостающей частью ЭТОГО контракта, не новым требованием, найденным по пути.
- **«Логин»-сужение — реальный пробел эпика, не молчаливое упрощение.** VAPS не выпускает свои JWT (verify-only, внешний Auth — issuer). Нет token-issuing эндпоинта, который smoke.sh мог бы дёрнуть для настоящего credentialed round-trip. `GET /admin/login/` (200, форма рендерится независимо от auth-состояния — тот же паттерн, что уже используют `test_admin_platform.py` и 12.1's healthcheck) — практический потолок того, что «логин»-проба может значить без реального IdP-токена в закрытом контуре. Явно задокументировано, не спрятано за общей формулировкой AC.
- **Бэкап этой стори ≠ 12.4's ночная джоба.** 12.4 (backlog, ещё не создана) — отдельная nightly-job-инфраструктура с restore-rehearsal. Эта стори не пытается предвосхитить её API/формат — самодостаточный inline safety-net, вызываемый install.sh'ом непосредственно перед мутацией. 12.4 переопределит/обобщит по мере готовности, не наоборот.
- **Rollback-маркер — на СТОРОНЕ контура (`deploy/.installed-sha`), НЕ то же самое, что `bundle.sh`'s `.last-bundle-sha` (dev-машина, 12.2).** Разные машины, разное назначение: dev-маркер — «что я последний раз собрал», контур-маркер — «что сейчас реально запущено на ЭТОЙ машине» (нужен install.sh'у, чтобы знать, на что откатываться при провале smoke).
- **Миграции — НЕ отдельный шаг install.sh.** 12.1's `app`-команда уже запускает `migrate --noinput` перед `uvicorn`; `docker compose up -d --wait` с healthcheck на `/admin/login/` (уже есть) провалится с понятным таймаутом, если миграция упала — дублировать отдельный `docker compose run ... migrate` добавило бы второй источник истины без нужды.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1292-1296] — буква стори.
- [Source: _bmad-output/planning-artifacts/architecture.md#L559-565] — целевые пути `deploy/scripts/{install.sh,smoke.sh}`.
- [Source: deploy/spike-1.9/install-probe.sh, deploy/spike-1.9/RUNBOOK.md §4] — доказанная прото-механика (sha-check+load+up), явно называет эту стори адресом backup/migrate/rollback/API-smoke.
- [Source: deploy/docker-compose.yml:66-97] — 12.1's `app`-сервис (текущий пробел `image:`, healthcheck на `/admin/login/`, встроенный `migrate` в `command`).
- [Source: Backend/VAPS/config/urls.py] — 6 `/api/<context>/`-префиксов.
- [Source: Backend/VAPS/apps/parallel_run/api/views.py::stand_health] — единственный `AllowAny`-эндпоинт, health-проба.
- [Source: Backend/VAPS/config/settings.py:206-268, apps/core/auth/authentication.py] — verify-only JWT (нет token-issuing эндпоинта) — основание «логин»-сужения.
- [Source: apps/core/tests/test_bundle_script.py] — тестовый паттерн (regex-over-file) для shell-скриптов этой пары.

## Dev Agent Record

### Context Reference

- Собрано делегированным research-агентом при create-story: полное чтение `deploy/spike-1.9/install-probe.sh`+`RUNBOOK.md` (прото-механика и явно НЕ-сделанное), `deploy/docker-compose.yml` (сервисы/volume'ы/healthchecks, найден пробел `image:`), поиск backup/restore-конвенций в репозитории (ни одной — эта стори первая), `config/urls.py` (6 API-контекстов), auth-механизм (verify-only JWT, нет token-issuing эндпоинта — основание для «логин»-сужения), `.last-bundle-sha`'s ограничения (dev-машина-only, не годится для контур-стороннего rollback-маркера).

### Completion Notes

Реализовано по плану, 4 файла в скоупе (AC-0 закрыт `docker-compose.yml`'s `image:`-добавкой). `make gate` — 2839 passed, 0 failed, schema drift не обнаружен.

**Живой прогон (не продекларирован) нашёл 3 реальных сквозных бага, ни один не поймать чтением скриптов глазами:**

1. **`security.ALLOWED_HOSTS` (12.1a) ломает 12.1's собственный app-healthcheck.** `deploy/docker-compose.yml`'s `app`-healthcheck бьёт `http://127.0.0.1:8000/admin/login/` НАПРЯМУЮ (мимо nginx) — `Host: 127.0.0.1`. С реальным `VAPS_ALLOWED_HOSTS=vaps.contour.local` (12.1a, уже done) это ВСЕГДА 400 Bad Request — `docker compose up --wait` никогда не становится healthy. Найдено первым же реальным `install.sh`-прогоном (контейнер `app` завис в `unhealthy`). Исправлено в `Backend/VAPS/config/settings.py`: `allowed_hosts_from_env` теперь ВСЕГДА добавляет `127.0.0.1`/`localhost` к прод-списку (loopback-only, недостижимо снаружи контейнера) — не отдельная env-переменная, автоматически. Тест обновлён (`test_settings.py`).
2. **`install.sh`'s `pg_dump`-шаг не мог получить `VAPS_DB_USER`/`VAPS_DB_NAME`.** `docker compose`'s `env_file: .env` пробрасывает эти переменные ВНУТРЬ контейнеров, но НЕ в шелл, из которого запущен сам `install.sh` — бэкап падал с «VAPS_DB_USER must be set». Исправлено: `install.sh` сам читает 2 конкретных значения из `deploy/.env` (НЕ полный bash `source` — `deploy/.env.example`'s задокументированная конвенция для `VAPS_JWT_KEY` — НЕзаквоченный многострочный PEM с буквальными `\n` — валидна для docker-compose's `.env`-парсера, но НЕ является валидным bash-синтаксисом; `source` целиком уронил бы скрипт на этой самой строке).
3. **AC-4's предположение «анонимный GET → 200» было неверным (см. правку AC-4 выше).** Реально — `403` (5 контекстов, RBAC жив) и `405` (`documents/attachments/`, только POST). `smoke.sh` исправлен на реально наблюдаемые коды.

**Полный пайплайн живьём, дважды (первая установка + переустановка):**
- Собран тестовый бандл вручную (тот же формат, что `bundle.sh`, 12.2) на реальном коде этого репозитория.
- `install.sh` #1 (первая установка): sha-check ЦЕЛ → бэкап пропущен (нет `.installed-sha`) → `docker load` (4 образа) → `docker compose up --wait` (все 4 контейнера healthy) → `smoke.sh` (8/8 OK) → `.installed-sha` записан.
- `install.sh` #2 (переустановка того же бандла): бэкап РЕАЛЬНО выполнен (`pg_dump` → 114KB `postgres.sql`, `tar czf` volume'а) → тот же успешный путь.
- Битый архив (`echo "corruption" >> *-images.tar`): `sha256sum -c` реально ловит порчу, `install.sh` останавливается ДО docker load, `.installed-sha` НЕ изменён (сверено побайтово diff'ом).

**Инцидент при уборке тестовых ресурсов (раскрыт пользователю немедленно, НЕ спрятан в этих заметках).** `docker compose -p deploy down -v` (уборка после теста) удалил volume `deploy_db_data`, принадлежащий НЕсвязанному проекту (`AshyqQala.kz`, тот же класс коллизии имени проекта, что уже был в 12.1, но на этот раз с `-v` — реальное удаление данных, не только контейнеров). Расследовано и восстановлено с разрешения пользователя: содержимое volume'а было полностью воспроизводимо из git-закоммиченных миграций+seed-фикстур того проекта (`docker compose --profile app up` пересоздал схему из 17 таблиц + реseed'нул демо-данные, проверено count-запросом). Урок сохранён в память (`feedback_docker_compose_p_flag_still_collides_on_generic_name.md`): явный `-p`-флаг не защищает, если имя ВСЁ ЕЩЁ generic (`-p deploy` столкнулся с ЧУЖИМ каталогом `deploy/`) — впредь `-p vaps-*`.

**Ревью (3 агента, cross-model, реальный прогон каждого).**

- **Blind Hunter** (diff-only) нашёл 2 реальные дыры, обе исправлены:
  1. **HIGH, самая значимая находка стори — loopback-добавка в `ALLOWED_HOSTS` (127.0.0.1/localhost) тихо переоткрывала Host-header-спуфинг, который 12.1a закрыла.** nginx форвардит `Host` буквально (`proxy_set_header Host $host;`) — внешний клиент МОГ бы послать `Host: 127.0.0.1` через публичный порт 80 и получить тот же пропуск, что доверенный internal-healthcheck. Исправлено в `deploy/nginx/vaps.conf.template`: гард на `/api/`/`/admin/` — `Host ∈ {127.0.0.1, localhost}` И `$remote_addr ≠ 127.0.0.1` → 403 (Docker сохраняет РЕАЛЬНЫЙ IP клиента при публикации порта — различает «healthcheck изнутри контейнера» от «внешний спуфинг через publish»). **Живая проверка** (3 сценария через опубликованный порт): подделанный `Host: 127.0.0.1` → 403; `Host: localhost` (дефолт curl без `-H`) → 403; настоящий сконфигурированный хост → 200/403(RBAC) как ожидается. Отдельно подтверждено логами nginx: его СОБСТВЕННЫЙ healthcheck (`wget http://127.0.0.1/admin/login/`, изнутри контейнера, `$remote_addr=127.0.0.1`) продолжает получать 200 — гард не сломал то, что чинил.
  2. **HIGH — `docker compose` без явного `-p` наследует generic project name «deploy» — тот же класс коллизии, что уже дважды ударил эту сессию (см. инцидент ниже).** Исправлено: `install.sh` заводит `COMPOSE_PROJECT="vaps-install"`, передаёт `-p "${COMPOSE_PROJECT}"` в КАЖДЫЙ вызов `docker compose` (включая напечатанные rollback-команды — оператор, скопировавший их, тоже не столкнётся с коллизией).
  - Остальные находки (TOCTOU-гонка грязное-дерево-гвард/docker build, отсутствие проверки размера `docker load`'а, отсутствие `--max-time` у curl, python-трейсбек при битом manifest.json) — рассмотрены: `--max-time` добавлен в `smoke.sh` (дёшево, реальная польза); остальные — LOW/теоретические, вне скоупа ручного оператор-driven скрипта, не исправлены.
- **Edge Case Hunter** (полный доступ к проекту, живые эксперименты) нашёл 1 реальную дыру, исправлена:
  1. **HIGH — бэкап файлового volume'а ссылался на `private_storage` (голое имя), но `docker compose` реально создаёт `<project>_private_storage`.** `docker run -v <несуществующее-имя>:/data` молча АВТОСОЗДАЁТ пустой volume и завершается с кодом 0 — интеграл-проверка бэкапа проходила, `private_storage.tar.gz` был пуст (**воспроизведено НА МОЁМ СОБСТВЕННОМ живом прогоне ДО этого фикса** — 87 байт, минимальный размер пустого tar.gz, я это не заметил при первом прогоне). Исправлено тем же `COMPOSE_PROJECT`-фиксом выше: `-v "${COMPOSE_PROJECT}_private_storage:/data"`.
  - Подтвердил ложность остальных гипотез: `image:`/`build:`-приоритет у `docker compose up` (без `--build` использует существующий тег, не пересобирает — эмпирически проверено), `pg_dump`-редирект корректно скопирован на нужную команду, `smoke.sh`'s `BASE_URL` согласован с nginx's портом.
- **Acceptance Auditor**: реально прогнал структурные тесты (28 passed на тот момент), `make gate` (2839 passed), сверил все 6 AC+AC-0 буква-в-букву с кодом, подтвердил, что loopback-добавка НЕ ослабляет 12.1a's fail-closed/wildcard-гварды (они выполняются РАНЬШЕ, независимо). **Сознательно НЕ прогнал живой `install.sh`** — машина усеяна чужими docker-ресурсами (та же коллизионная опасность, что уже случилась дважды в этой сессии) — явно пометил живой прогон как неподтверждённый им лично, не притворился, что проверил.

**После применения всех 3 review-патчей — живой прогон ПОВТОРЁН целиком** (я, не ревьюеры, поскольку они разумно избегали риска): `install.sh` #1 (первая установка) и #2 (переустановка, реальный `pg_dump`+volume-бэкап с ПРАВИЛЬНЫМ именем volume'а) — оба 8/8 smoke зелёные, оба через реальный `curl` с реальным сконфигурированным хостом (не `localhost` — тот теперь по дизайну блокируется nginx-гардом при внешнем доступе). Найден и исправлен ЕЩЁ один живой баг ходе этой повторной проверки: `smoke.sh`'s дефолтный `BASE_URL=http://localhost` больше не мог работать (blocked-by-design тем же новым nginx-гардом) — `install.sh` теперь передаёт `VAPS_SMOKE_BASE_URL` из `.env`'s `VAPS_ALLOWED_HOSTS`. И ещё один: `curl ... || echo "000"` в `smoke.sh` дублировал вывод в `"000000"` при полном сетевом отказе (curl сам печатает "000" через `-w` до своего non-zero exit, `|| echo` добавлял второй "000") — исправлено на `|| true` + explicit default.

Финальная проверка `docker compose -p vaps-install ... down -v` — ВСЕ volume'ы/сети корректно ушли под правильным префиксом (`vaps-install_*`), никаких посторонних ресурсов не задето (в отличие от инцидента ниже, случившегося ДО этого фикса).

### File List

- `deploy/docker-compose.yml` (MOD) — `app`-сервис получил `image: vaps-app:${VAPS_APP_SHA:-dev}`.
- `deploy/scripts/install.sh` (NEW) — sha-check → бэкап → load → up → smoke → откат-инструкции; `COMPOSE_PROJECT` явный на каждом `docker compose`; `VAPS_SMOKE_BASE_URL` из `.env`'s `VAPS_ALLOWED_HOSTS` (review-фикс).
- `deploy/scripts/smoke.sh` (NEW) — health + login + 6 API-контекстов; `--max-time` + чистый fallback-код без дублирования (review-фикс).
- `deploy/nginx/vaps.conf.template` (MOD) — loopback-Host-спуфинг-гард на `/api/`/`/admin/` (review-фикс, Blind Hunter).
- `Backend/VAPS/apps/core/tests/test_install_and_smoke_scripts.py` (NEW) — структурные regex-тесты обоих скриптов + гварды на `-p`-пиннинг и project-prefixed volume-имя (review-фиксы).
- `Backend/VAPS/config/settings.py` (MOD) — `allowed_hosts_from_env` теперь всегда добавляет `127.0.0.1`/`localhost` в проде (кросс-стори регресс с 12.1a, найден живым install.sh-прогоном).
- `Backend/VAPS/apps/core/tests/test_settings.py` (MOD) — тест на loopback-добавку, скорректирован тест на точный список (теперь префикс).

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
| 2026-07-29 | dev-story: реализация (install.sh/smoke.sh/AC-0 image-тег) + живой прогон нашёл 3 сквозных бага (ALLOWED_HOSTS ломает 12.1's healthcheck, .env не источник для host-шелла, анонимный 200≠403/405) — все исправлены + деструктивный инцидент на чужом docker-volume (раскрыт, восстановлено) + 3-агентное ревью нашло 3 реальные дыры (Host-header-спуфинг через nginx, project-name-коллизия, project-prefixed volume-имя) — все исправлены, живой прогон повторён целиком после фиксов (2/2 установки, 8/8 smoke, AC-1 битый архив, чистая уборка под правильным project name) → done |
