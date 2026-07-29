---
baseline_commit: 9d4bd7d
---

# Story 13.3: Патч-цикл hotfix

Status: ready-for-dev

## Story

As a **разработчик**,
I want **облегчённый `--hotfix`-режим `bundle.sh` (только `app`-образ, без переизбытка nginx/postgres/redis) + `deploy/HOTFIX-POLICY.md` (что допустимо hotfix'ом, что нет) — install проходит ТЕМ ЖЕ `install.sh`, без изменений**,
so that **мелкий баг чинится за один цикл носителя, без пересборки/пересохранения трёх образов, которые hotfix почти никогда не трогает**.

## Acceptance Criteria

Источник: `epics.md#L1364-1370` (буква стори) + research при create-story, подтвердивший: `install.sh`'s discovery-логика (`*-sha256sums.txt`/`*-manifest.json`/`*-images.tar`, glob по паттерну имени) НЕ завязана на количество образов внутри `images.tar` — облегчённый бандл проходит install.sh БЕЗ ЕГО правки, буква AC-1 буквально уже верна сегодняшним кодом, задача этой стори — произвести такой бандл.

1. **AC-1 (`bundle.sh --hotfix` — только `app`-образ).** Новый флаг `--hotfix`: пропускает `docker pull` nginx/postgres/redis (шаг [2/6]) и `docker save` этих трёх в `images.tar` (шаг [3/6]) — сохраняет ТОЛЬКО `vaps-app:<sha>`. Без флага — поведение `bundle.sh` не меняется (все 4 образа, как сегодня).
2. **AC-2 (`min_upgrade_from` ОБЯЗАТЕЛЕН для hotfix, не best-effort-null).** Обычный `bundle.sh` (12.2) допускает `min_upgrade_from: null` на первом прогоне (нет предыдущего бандла — легитимно, «первая установка»). Hotfix ПО ОПРЕДЕЛЕНИЮ патчит УЖЕ существующую установку — `--hotfix` без `.last-bundle-sha`-маркера (`LAST_SHA_FILE`) падает с понятной ошибкой («hotfix без базового релиза бессмыслен»), не производит null-бандл молча.
3. **AC-3 (`install.sh` НЕ трогается — install проходит ТЕМ ЖЕ скриптом, буква AC).** Живой прогон: hotfix-бандл (только `app`-образ) реально проходит `install.sh` без единой правки последнего — на машине, где nginx/postgres/redis УЖЕ загружены прошлым полным `install.sh`-прогоном (реалистичный сценарий: hotfix применяется ПОСЛЕ хотя бы одной полной установки, никогда не первым прогоном на чистой машине).
4. **AC-4 (`deploy/HOTFIX-POLICY.md` — что допустимо hotfix'ом, записано, не додумывается на месте).** Явный список: РАЗРЕШЕНО (правки кода приложения — Backend/VAPS и frontend/src, аддитивные не-разрушающие миграции — новая nullable-колонка/таблица, без backfill/rename/drop); ЗАПРЕЩЕНО-как-hotfix, требует планового релиза (правки `Dockerfile`/базовых образов, правки `docker-compose.yml`-топологии, новые pip/npm-зависимости, разрушающие/переименовывающие/долгие-backfill миграции, новые переменные окружения, требующие ручного действия оператора). `smoke.sh`'s 8/8 и `CHECKLIST.md`'s бэкап-шаг — БЕЗ сокращений даже для hotfix (явно записано, не подразумевается).
5. **AC-5 (регресс нулевой).** `make gate` зелёный. Живой прогон: полный бандл (без `--hotfix`) → install → 8/8 smoke (как раньше, не сломано) → отдельно, `--hotfix`-бандл на том же стеке → install → 8/8 smoke — ДВА реальных сценария, не один.

## Out of Scope

- Правка `install.sh` (research подтвердил: не требуется буквой AC-1/AC-3).
- Автоматизированная проверка соответствия diff'а политике (человеческое решение «это точно hotfix» — вне скоупа, `HOTFIX-POLICY.md` информирует решение, не заменяет его инструментом).
- Отдельный `deploy/CHECKLIST-HOTFIX.md` — research подтвердил: `CHECKLIST.md` уже общий для любого переноса, hotfix переиспользует его целиком, не нуждается в дубликате.

## Tasks / Subtasks

- [ ] Task 1 — `bundle.sh --hotfix` (AC: 1, 2)
  - [ ] Флаг парсится, без него — поведение не меняется (regression-гвард).
  - [ ] `--hotfix`: пропускает pull+save трёх базовых образов, `images.tar` содержит только `app`.
  - [ ] `--hotfix` без `LAST_SHA_FILE` → явная ошибка, не null-бандл.
  - [ ] `manifest.json` — новое поле `"hotfix": true/false`.
- [ ] Task 2 — `deploy/HOTFIX-POLICY.md` (AC: 4)
  - [ ] Разрешено/запрещено-список (конкретный, не общие слова).
  - [ ] Явно: smoke/бэкап без сокращений.
- [ ] Task 3 — Реальный двойной прогон (AC: 3, 5)
  - [ ] Полный бандл → install → smoke (baseline, не сломан).
  - [ ] `--hotfix`-бандл на том же стеке → install (ТЕМ ЖЕ install.sh, без правок) → smoke.
  - [ ] `make gate` зелёный.

## Dev Notes

- **`install.sh` НЕ трогается — подтверждено research'ем ДО реализации, не предположение.** Discovery-логика (`*-sha256sums.txt`/`*-manifest.json`/`*-images.tar`, `deploy/scripts/install.sh:74-82`) не знает и не проверяет, сколько образов внутри `images.tar` — `docker load -i` загружает что есть, `docker compose up -d --wait` использует уже загруженное/закешированное локально. Если бы это оказалось не так при живом прогоне — стори переоткрывается, не тихо патчится install.sh в обход буквы AC.
- **Hotfix НИКОГДА не первый прогон на чистой машине.** `--hotfix` предполагает: nginx/postgres/redis уже загружены ПРЕДЫДУЩИМ полным `install.sh`-прогоном на ЦЕЛЕВОЙ (не dev) машине — их локальный docker-кеш переживает `docker compose down` (без `--rmi`, который `install.sh`/`deploy-rehearsal.sh` не используют). AC-2's ошибка на отсутствующем `LAST_SHA_FILE` — тот же принцип, проверенный на dev-стороне (bundle.sh не может произвести осмысленный hotfix «из ниоткуда»).
- **Политика — не изобретена с нуля, но и не скопирована ниоткуда (research подтвердил: прецедента в репозитории нет).** Список составлен из структурных фактов: что `manifest.json` уже трекает (миграции — `bundle.sh`'s `migrations`-поле, значит ЛЮБАЯ миграция технически проходит бандл, политика должна явно решить допустимую границу, а не полагаться на код) и что реально меняется при типичном мелком багфиксе (код, не топология/зависимости).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1364-1370] — буква стори.
- [Source: deploy/scripts/bundle.sh] — база для `--hotfix`-флага.
- [Source: deploy/scripts/install.sh:74-82] — discovery-логика, подтверждающая AC-3 без правок.
- [Source: deploy/CHECKLIST.md] — переиспользуется целиком, не дублируется.
- [Source: _bmad-output/implementation-artifacts/12-2-bundle-sh-и-manifest.md] — `min_upgrade_from`'s существующая best-effort семантика (эта стори делает её ОБЯЗАТЕЛЬНОЙ для hotfix-режима специфично, не меняет обычный путь).

## Dev Agent Record

### Context Reference

- Собрано делегированным research-агентом при create-story: `bundle.sh`'s полное содержимое (что дорого/пропускаемо для hotfix), `install.sh`'s discovery-логика (подтверждение bundle-producer-agnostic), `manifest.json`'s схема (`min_upgrade_from` не валидируется install.sh сегодня), отсутствие hotfix-прецедента в репозитории (политика — с нуля, из структурных фактов), `CHECKLIST.md`'s общность (переиспользуется, не дублируется).

### Completion Notes

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
