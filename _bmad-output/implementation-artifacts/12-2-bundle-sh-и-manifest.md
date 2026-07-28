---
baseline_commit: 62b7f83
---

# Story 12.2: bundle.sh и manifest

Status: ready-for-dev

## Story

As a **разработчик, готовящий релиз для переноса носителем**,
I want **`bundle.sh`, собирающий ОДИН проверяемый архив-триплет (образы + фронт + `manifest.json` + `sha256sums.txt`) из 12.1's прод-топологии**,
so that **перенос в закрытый контур — сверка чек-суммой одного артефакта, а не ручной сбор образов/фронта/списка миграций по памяти**.

## Acceptance Criteria

Источник: `epics.md#L1286-1290` (буква стори) + `architecture.md#L559-561` (целевой путь `deploy/scripts/bundle.sh`) + `deploy/spike-1.9/build-bundle.sh` (доказанная прото-механика: `docker save` + `sha256sum`, докстринг которого явно называет 12.2 адресом `manifest.json`/digests/списка миграций).

Скоуп — три файла (≤5, одна ответственность — сборка бандла): `deploy/scripts/bundle.sh` (NEW), `deploy/.gitignore` (NEW, артефакты сборки не коммитятся — тот же приём, что уже применён в `deploy/spike-1.9/.gitignore`), тест структуры скрипта (regex-стиль, зеркало `test_ws_guards.py::test_gate_starts_redis_and_points_the_suite_at_it`, живой docker-прогон дороже гейта — гейт проверяет ФОРМУ скрипта, дев-агент проверяет ПОВЕДЕНИЕ живым прогоном в Completion Notes).

1. **AC-1 (все 4 образа 12.1's топологии, не только `app`).** Спайк 1.9 доказал `save`+`sha256` только для одного самодельного образа. 12.1's реальная топология — `nginx:1.27-alpine`+`app`(build)+`postgres:16`+`redis:7-alpine`. `docker save` в ОДИН `-images.tar` все четыре (docker save поддерживает несколько образов в одном архиве) — иначе перенос носителем «работающего стека» на деле переносит только четверть его.
2. **AC-2 (`manifest.json` — sha, digests, список миграций, `min_upgrade_from`).** Буква эпика перечисляет 4 поля буквально:
   - `sha` — `git rev-parse --short HEAD` (короткий, тот же формат, что уже использует `build-bundle.sh`).
   - `images` — `{name: {tag, digest}}` для всех 4 образов (`docker image inspect --format '{{index .RepoDigests 0}}'`; локально собранный `app`-образ без registry push не имеет `RepoDigest` — фиксируется как явный `<no-digest-local-build>`, не пустая строка/null, тот же приём, что уже есть в спайке).
   - `migrations` — полный список `app_label.migration_name` из `manage.py showmigrations --plan` (весь план, не diff — состояние на момент сборки, не «что нового»).
   - `min_upgrade_from` — **скоуп-решение (буква эпика не детализирует механизм).** Не существует готового артефакта «версия N-1» ДО первого бандла (это первый прогон 12.2 в проекте). Реализовано как best-effort locally-remembered указатель: `bundle.sh` пишет `.last-bundle-sha` в тот же (гитигнорённый) выходной каталог после каждой успешной сборки; следующий прогон читает его как `min_upgrade_from`, первый прогон — `null`. Не криптографический контракт (файл живёт только на dev-машине, не переносится с бандлом) — практический хинт для `install.sh` (12.3) при последовательных релизах с одной машины, задокументировано явно как таковое, не выдаётся за нечто большее.
3. **AC-3 (фронт того же sha).** `frontend/dist` (после `npm run build`) паковывается в отдельный `-frontend.tar` — НЕ внутри `-images.tar` (разные механизмы: `docker save` для образов, `tar czf` для статики). `manifest.json`'s `frontend_sha` = тот же `sha`, что и `images` — единственный источник правды: ОДИН git-коммит, ОДИН бандл, фронт и бэк собраны из одного дерева. Чистое рабочее дерево (`git diff HEAD --` пусто) — обязательное предусловие сборки, не рекомендация: бандл из грязного дерева не имеет проверяемого sha по построению.
4. **AC-4 (`sha256sums.txt` — все 3 артефакта).** `sha256sum` над `*-images.tar`, `*-frontend.tar`, `*-manifest.json` (не над самим `sha256sums.txt` — самоссылка бессмысленна). Формат — тот же, что спайк уже использует (`sha256sum -c` совместимый), 12.3's `install.sh` наследует эту же команду проверки.
5. **AC-5 (повторная сборка того же sha даёт тот же состав).** «Тот же состав» = одинаковый НАБОР и СОДЕРЖИМОЕ полей `manifest.json` (кроме `built_at` — метка времени по построению меняется) при повторной сборке БЕЗ изменения git-дерева — НЕ побайтовая идентичность `.tar` (docker-слои/tar-метаданные недетерминированы на уровне байт без спец-инструментов вроде `reproducible-containers` — вне скоупа этой стори, буква эпика говорит «состав», не «побайтово»). Дев-агент ОБЯЗАН реально собрать бандл ДВАЖДЫ подряд на одном sha и сверить `manifest.json` минус `built_at` — зафиксировать в Completion Notes, не продекларировать.
6. **AC-6 (защита от грязного дерева + регресс нулевой).** `bundle.sh` падает с понятной ошибкой на грязном рабочем дереве (`git diff HEAD --` непусто) ДО любых docker/npm-операций — не тратит время сборки на заведомо непроверяемый артефакт. `deploy/spike-1.9/build-bundle.sh` НЕ трогается (отдельный прото-скрипт, докстринг которого сам называет 12.2 преемником — не заменой на месте). `make gate` зелёный.

## Tasks / Subtasks

- [ ] Task 1 — `deploy/scripts/bundle.sh` (NEW) (AC: 1, 3, 6)
  - [ ] `set -euo pipefail`, `cd` к repo root от расположения скрипта.
  - [ ] Грязное дерево — стоп ДО docker/npm (`git diff HEAD --`, не `git status --porcelain` — последний триггерился бы на легитимные untracked-файлы типа `node_modules/`).
  - [ ] `docker build` образа `app` (тег `vaps-app:<sha>`, `Backend/VAPS/Dockerfile`, тот же `Dockerfile`, что 12.1 уже завела).
  - [ ] `docker pull` трёх базовых образов (nginx/postgres/redis — те же теги, что `deploy/docker-compose.yml`).
  - [ ] `docker save` всех 4 в один `*-images.tar`.
  - [ ] `npm run build` (frontend) + `tar czf` в `*-frontend.tar`.
- [ ] Task 2 — `manifest.json` + `sha256sums.txt` (AC: 2, 4, 5)
  - [ ] `sha`/`built_at`/`images` (tag+digest каждого)/`migrations` (`manage.py showmigrations --plan`, распарсено)/`frontend_sha`/`min_upgrade_from` (из `.last-bundle-sha`, обновляется по успешной сборке).
  - [ ] `sha256sum` над тремя артефактами → `*-sha256sums.txt`.
- [ ] Task 3 — `deploy/.gitignore` (NEW) (AC: 6)
  - [ ] `deploy/dist-bundle/` (выходной каталог bundle.sh) полностью гитигнорирован — тот же приём, что `deploy/spike-1.9/.gitignore`.
- [ ] Task 4 — Структурный тест (`Backend/VAPS/apps/core/tests/test_bundle_script.py`, NEW) (AC: 1, 2, 3, 4, 6)
  - [ ] Regex/текстовые проверки формы скрипта (не живой docker-прогон в pytest — слишком дорого для гейта): `set -euo pipefail` присутствует, грязное-дерево-гвард присутствует ДО первого `docker`/`npm`, все 4 образа перечислены в `docker save`, `manifest.json`'s HEREDOC содержит все требуемые ключи, `sha256sum` вызывается над тремя файлами (не над самим sha256sums.txt).
- [ ] Task 5 — Реальный прогон (AC: 5, 6)
  - [ ] Собрать бандл дважды подряд на одном sha, сверить `manifest.json` (кроме `built_at`) — идентичен.
  - [ ] `sha256sum -c` над результатом — проходит.
  - [ ] `make gate` — зелёный.

## Dev Notes

- **Прото-механика уже доказана, не с нуля.** `deploy/spike-1.9/build-bundle.sh` — работающий `docker save`+`sha256sum` на ОДНОМ образе, его собственный докстринг: «НЕ воспроизводить manifest.json/digests/список миграций — это E12». Эта стори — буквально названный преемник, не альтернатива. Спайк-скрипт не трогается (он документирует историю спайка 1.9, живёт своей жизнью).
- **`min_upgrade_from` — единственное поле без буквального механизма в эпике.** Явное скоуп-решение зафиксировано в AC-2 (best-effort локальный маркер, не криптографический контракт) — не молчаливое упрощение.
- **Реальные образы, не заглушки.** `nginx:1.27-alpine`/`postgres:16`/`redis:7-alpine` — те же теги, что уже пришиты в `deploy/docker-compose.yml` (12.1). Расхождение тегов между `bundle.sh` и `docker-compose.yml` — реальный риск (бандл переносит ОДНИ образы, compose на целевой машине тянет ДРУГИЕ при отсутствии интернета — `docker compose up` без `--pull never` может попытаться дотянуться в сеть, которой в контуре нет). Не в скоупе ПРОВЕРКИ этой стори (это 12.3's `install.sh`'s `docker load`+`--pull never`-дисциплина), но именно ПОЭТОМУ теги должны совпадать буква-в-букву — сверено вручную при реализации.
- **`git diff HEAD --` не `git status --porcelain`.** Последний триггерится untracked-файлами (`node_modules/`, `graphify-out/`, IDE-мусор) — легитимно присутствующими на dev-машине, не признаком «дерево грязное относительно закоммиченного sha». `git diff HEAD --` (без `--porcelain`) видит ТОЛЬКО расхождение отслеживаемых файлов с HEAD — ровно то, что имеет значение для «бандл = проверяемый sha».

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1286-1290] — буква стори.
- [Source: _bmad-output/planning-artifacts/architecture.md#L559-561] — целевой путь `deploy/scripts/bundle.sh`, состав `manifest.json`.
- [Source: deploy/spike-1.9/build-bundle.sh, deploy/spike-1.9/RUNBOOK.md] — доказанная прото-механика (save+sha256), докстринг называет 12.2 явным преемником.
- [Source: deploy/docker-compose.yml, Backend/VAPS/Dockerfile] — 12.1's итоговая топология (4 образа, теги), источник для `bundle.sh`'s образов.
- [Source: apps/notifications/tests/test_ws_guards.py::test_gate_starts_redis_and_points_the_suite_at_it] — regex-over-file тестовый паттерн для shell-артефактов, зеркалится для `bundle.sh`.

## Dev Agent Record

### Context Reference

- Собрано напрямую при create-story: `epics.md`/`architecture.md`'s буква, `deploy/spike-1.9/build-bundle.sh` целиком (прото-механика), `deploy/docker-compose.yml`/`Backend/VAPS/Dockerfile` (12.1's итоговые образы/теги), `manage.py showmigrations --plan` живой прогон (формат вывода), `test_ws_guards.py`'s regex-тестовый паттерн для shell-скриптов.

### Completion Notes

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
