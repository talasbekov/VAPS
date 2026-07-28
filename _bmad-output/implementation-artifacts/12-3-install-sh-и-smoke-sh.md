---
baseline_commit: 9178bf8
---

# Story 12.3: install.sh и smoke.sh

Status: ready-for-dev

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
4. **AC-4 (`smoke.sh` — health + login + по одному запросу на каждый `/api/<context>/`).** Источник контекстов — `Backend/VAPS/config/urls.py` (6 префиксов: `core`/`operations`/`audit`/`notifications`/`documents`/`parallel-run`). **Скоуп-сужение, задокументировано явно (буква эпика не детализирует механизм "логин" для JWT-только-верификации системы без своего token-issuer — исследовано при create-story):** «health» = `GET /api/parallel-run/health/` (единственный по-настоящему `AllowAny`-эндпоинт, 200/503 — уже используется как паттерн 12.1's healthcheck-стиля); «логин» = `GET /admin/login/` возвращает 200 (доказывает, что Django admin's auth-подсистема жива и отдаёт форму — НЕ credentialed round-trip: у VAPS нет своего token-issuing эндпоинта, внешний Auth выдаёт JWT, verify-only; настоящая логин-проба потребовала бы реального IdP-токена, недоступного install.sh — открытый вопрос, адресован будущей стори при появлении тестового IdP). По одному `GET` на каждый из 6 `/api/<context>/`-роутов (список-эндпоинт каждого приложения) — 200 ожидается (`DEFAULT_PERMISSION_CLASSES: []` на уровне DRF, конкретные 403 — ниже по стеку, не блокируют smoke).
5. **AC-5 (упавший smoke → инструкция отката, не тихий провал).** `install.sh` персистит `.installed-sha` (в `deploy/`, НЕ в переносимом бандле — аналог `bundle.sh`'s `.last-bundle-sha`, но на СТОРОНЕ контура, не dev-машины) ДО `docker compose up`, читает ПРЕДЫДУЩЕЕ значение (если было) ДО перезаписи. Провал `smoke.sh` → `install.sh` печатает конкретную процедуру: `docker compose down`, `docker tag vaps-app:<PREV_SHA> ...`, `VAPS_APP_SHA=<PREV_SHA> docker compose up -d --wait`, путь к только что сделанному бэкапу — не общие слова «откатитесь», а команды с реальными значениями подставлены.
6. **AC-6 (регресс нулевой).** `make gate` зелёный. `deploy/spike-1.9/install-probe.sh` не трогается (прото-скрипт, докстринг которого сам называет эту стори преемником).

## Tasks / Subtasks

- [ ] Task 1 — `deploy/docker-compose.yml` (MOD) (AC: 0)
  - [ ] `app`-сервис: добавить `image: vaps-app:${VAPS_APP_SHA:-dev}` рядом с существующим `build:`.
- [ ] Task 2 — `deploy/scripts/install.sh` (NEW) (AC: 1, 2, 3, 5)
  - [ ] `set -euo pipefail`, принимает `<bundle-dir>` аргументом (где лежат `*-images.tar`/`*-frontend.tar`/`*-manifest.json`/`*-sha256sums.txt` — транспортный набор, переносится ЦЕЛИКОМ вместе с `deploy/`-деревом, RUNBOOK.md's список переноса).
  - [ ] `sha256sum -c` — первым, до любых мутаций.
  - [ ] Чтение `manifest.json`'s `sha` → `VAPS_APP_SHA`.
  - [ ] Бэкап (пропущен только на первой установке): `pg_dump` + `tar czf` volume'а, в `deploy/pre-install-backups/<timestamp>-<prev-sha>/`.
  - [ ] `docker load` + `.installed-sha` (читается ДО перезаписи, пишется ПОСЛЕ успешного `docker compose up --wait`) + `docker compose -f deploy/docker-compose.yml up -d --wait`.
  - [ ] Вызов `smoke.sh`; провал → печать команд отката с реальными значениями + `exit 1`.
- [ ] Task 3 — `deploy/scripts/smoke.sh` (NEW) (AC: 4)
  - [ ] `GET /api/parallel-run/health/` (health).
  - [ ] `GET /admin/login/` == 200 (login, задокументированное сужение).
  - [ ] По одному `GET` на список-эндпоинт каждого из 6 `/api/<context>/`.
  - [ ] Ненулевой exit при любом непройденном шаге, понятное сообщение какой именно.
- [ ] Task 4 — Структурный тест (`Backend/VAPS/apps/core/tests/test_install_and_smoke_scripts.py`, NEW) (AC: 0, 1, 2, 3, 4, 5, 6)
  - [ ] Зеркало `test_bundle_script.py`: regex/текстовые проверки формы (sha-check первым, все 6 контекстов присутствуют в smoke.sh, `.installed-sha` читается ДО перезаписи, `image:` присутствует в docker-compose.yml рядом с `build:`, спайк не тронут).
- [ ] Task 5 — Реальный прогон (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Реальный `install.sh` на бандле из 12.2 (свежая сборка) — sha-check/бэкап/load/up/smoke живьём.
  - [ ] Битый архив (испорченная чек-сумма) — install.sh реально останавливается ДО docker load.
  - [ ] `make gate` — зелёный.

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

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
