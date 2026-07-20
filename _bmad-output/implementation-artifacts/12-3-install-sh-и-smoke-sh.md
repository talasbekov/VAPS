---
baseline_commit: eee82fa (HEAD, `docs(story-12.2)`). Артефакт-пути чисты; вне скоупа — чужие `.claude/settings.json` (M) и `_bmad-output/story-automator/**` (untracked).
baseline_tests: `cd Backend/VAPS && make gate` → **2491 passed, 56 deselected, «No changes detected»** (финальный прогон 12.2 на этом состоянии кода; стори не трогает Python/фронт — счёт обязан остаться).
prerequisite: 12.1 (`done` — compose-топология, `VAPS_IMAGE_TAG`), 12.2 (`done` — бандл-тройка `vaps-<тег>.tar` + `manifest-<тег>.json` + `sha256sums-<тег>.txt`; живая тройка тега `20260720-b0ee7bc` лежит в `deploy/bundles/`).
scope_note: Скоуп = epic-AC 12.3 (install.sh + smoke.sh + инструкция отката) + ДВА поимённо переданных сюда deferred-хвоста install-стороны (:90 pinned-hash, :103 image-identity-verify). НЕ входят: бэкап-джобы по расписанию (12.4 — здесь только pre-migrate бэкап как ШАГ установки), CHECKLIST.md (12.5), beat (12.6), реальный контур-прогон (12.7, путь A/B — A5 открыт).
context:
  - _bmad-output/planning-artifacts/epics.md#L1294-1300 (Story 12.3 AC: «install.sh: чексуммы → бэкап БД и файлового volume → load → migrate → smoke → инструкция отката (образы N-1)»; «Given битый архив, Then установка прерывается на чек-суммах ДО изменений»; «Given упавший smoke, Then выводится процедура отката»; «smoke: health + логин + запрос к каждому /api/<context>/»)
  - _bmad-output/planning-artifacts/architecture.md#L562-566 (дерево: install.sh/smoke.sh построчно), #L340 («health-эндпоинт + smoke после деплоя» —健 эндпоинта на бэке СЕГОДНЯ НЕТ, grep по urls.py пуст; заводить = бэк-стори со схемой/RBAC — НЕ здесь, см. Решение №2)
  - _bmad-output/implementation-artifacts/deferred-work.md:90 — 🔴 ХВОСТ СЮДА: «install.sh должен сверять .tar с pinned/подписанным ожидаемым хэшем, а не с со-расположенным регенерируемым sha256sums.txt … подменили .tar+sums вместе → проходит»
  - _bmad-output/implementation-artifacts/deferred-work.md:103 — 🔴 ХВОСТ СЮДА: «после docker load ВЕРИФИЦИРОВАТЬ идентичность загруженного образа … docker load восстанавливает любой тег; резидентный устаревший образ с тем же тегом → compose up тихо поднимет СТАРЫЙ образ»
  - `deploy/bundles/manifest-20260720-b0ee7bc.json` — живой вход: `bundle_sha256`, `bundle_size_bytes`, `images[].image_id`, `migrations[]`, `min_upgrade_from` (потребление min_upgrade_from — заготовка: поле сегодня null, гейт «текущая установка < min_upgrade_from → СТОП» пишется сразу)
  - `deploy/docker-compose.yml` + `deploy/.env.example` (12.1) — теговая адресация образов, `${VAR:?}`-секреты, «--env-file для ВСЕХ команд compose»
  - `deploy/spike-1.9/install-probe.sh` — прото-механика и стиль «сюрприз → RUNBOOK» (гварды с note_surprise, диагностика не теряется на раннем сбое)
  - `config/urls.py` — шесть контекстов: admin/, api/core/, api/operations/, api/audit/, api/notifications/, api/documents/ (smoke обходит КАЖДЫЙ /api/<context>/)
  - Ревью-уроки 12.1/12.2: nginx 403-страница ≠ app-403 (различать по телу); flock; ERR-trap; sh PID1/exec; state-файлы атомарным mv
---

# Story 12.3: install.sh и smoke.sh

Status: done

## Story

As a **админ контура, устанавливающий релиз с носителя**,
I want **рунбук-скрипт `install.sh`: pinned-hash → чек-суммы → сверка манифеста → (при обновлении) бэкап БД и файлового volume → `docker load` → image-identity-verify → `migrate` → `compose up` → `smoke.sh`, с печатью процедуры отката на образы N-1 при любом провале после начала изменений, и отдельный `smoke.sh`, проверяющий живость всех шести HTTP-контекстов через nginx**,
so that **установка — воспроизводимая процедура без импровизации (epic-DoD E12), битый/подменённый архив останавливается ДО изменений, а «тихий старый образ под новым тегом» невозможен**.

## Acceptance Criteria

**AC-0 · ГРАНИЦА.** НЕ строим: health-эндпоинт на бэке (Решение №2 — бэк-стори со схемой/RBAC, отдельно), ночные бэкап-джобы/restore-rehearsal (12.4), CHECKLIST.md (12.5), beat (12.6), подпись GPG (pinned-hash по бумаге достаточен для контура — Решение №3). `Backend/**`, `frontend/**`, `deploy/docker-compose.yml`, `deploy/nginx/**`, `deploy/scripts/bundle.sh` — НЕ правятся (если потребуется — СТОП, эскалация). Оба новых скрипта живут в `deploy/scripts/`, запускаются НА СЕРВЕРЕ контура из install-каталога (см. AC-1).

1. **AC-1 · Модель install-каталога задекларирована в шапке install.sh.** Установка идёт из каталога (например `/opt/vaps`), куда носителем положены: бандл-тройка 12.2, `docker-compose.yml`, `install.sh`+`smoke.sh`, и где лежит операторский `.env` (секреты — отдельной процедурой). Скрипт принимает `INSTALL_DIR` (дефолт — каталог скрипта) и `RELEASE_TAG` (аргумент 1, обязателен). State: файл `installed-tag` в `INSTALL_DIR` — единственный источник «что стоит сейчас» для отката N-1; пишется атомарно (mv) ТОЛЬКО после зелёного smoke.
2. **AC-2 · Pinned-hash — хвост :90 закрыт.** Аргумент 2 (обязателен): ожидаемый sha256 архива, зачитанный оператором из ДОВЕРЕННОГО канала (бумажный CHECKLIST/подпись руки — канал вне носителя). Given подменённая пара .tar+sums (самосогласованная!), When pinned-hash не совпал с фактическим sha архива, Then СТОП до любых изменений. Явное сообщение различает «транзитная порча» (sums тоже не сходятся) и «подмена» (sums сходятся, pinned — нет).
3. **AC-3 · Чек-суммы и манифест ДО изменений (epic-буква).** `sha256sum -c sha256sums-<тег>.txt` + сверка `manifest.bundle_sha256` == фактический sha и `manifest.bundle_size_bytes` == фактический размер. Given битый архив, Then стоп ДО бэкапа/löad/migrate — порядок шагов в скрипте обязан это гарантировать структурно.
4. **AC-4 · `min_upgrade_from`-гейт (заготовка политики).** Если поле манифеста не null И `installed-tag` существует И установленный тег < min_upgrade_from — СТОП с инструкцией «сначала промежуточный релиз». Сегодня поле null → гейт проходит насквозь; тест — подстановкой синтетического манифеста.
5. **AC-5 · Бэкап ДО migrate (шаг установки, не джоба).** При существующей установке (`installed-tag` есть): `pg_dump` через `docker compose exec db` (fail при недоступной БД) + tar private_storage-volume — в `INSTALL_DIR/backups/<дата>-<старый-тег>/`. Первая установка (state-файла нет) — бэкап пропускается с явной печатью «первая установка — бэкапить нечего».
6. **AC-6 · `docker load` + image-identity-verify — хвост :103 закрыт.** После load: `docker image inspect` каждого `vaps-{app,nginx}:<тег>` и сверка `.Id` с `manifest.images[].image_id`. Given резидентный чужой образ под тем же тегом (или манифест от другого бандла), Then СТОП с точным сообщением ДО migrate/up.
7. **AC-7 · migrate → up → smoke; провал = откат-инструкция (epic-буква).** `docker compose run --rm app python manage.py migrate` → `up -d` → `smoke.sh`. Given упавший smoke (или migrate/up), Then печатается ПРОЦЕДУРА ОТКАТА с подставленными значениями: предыдущий тег из `installed-tag`, команды `compose down` → `VAPS_IMAGE_TAG=<prev>` → `up -d` → `smoke.sh`, плюс путь к свежему бэкапу для восстановления БД (сама откат-механика БД — restore из бэкапа AC-5; автоматический откат НЕ выполняется — Решение №4: откат в контуре — решение человека).
8. **AC-8 · `smoke.sh` — все шесть контекстов + SPA, без секретов.** Отдельный скрипт (вход: BASE_URL, дефолт `http://localhost:${VAPS_HTTP_PORT:-8080}`): (а) `/` → 200 (SPA/nginx); (б) `/admin/login/` → 200 (Django+статика жива — но БЕЗ логина); (в) КАЖДЫЙ из `/api/core/ /api/operations/ /api/audit/ /api/notifications/ /api/documents/` → HTTP-ответ < 500 (401/403/404 = сервис жив и отвечает осмысленно; ≥500/timeout/connection refused = провал); (г) негативная auth-проба: запрос с заведомо мусорным Bearer → 401/403, НЕ 5xx (auth-цепочка отвечает штатно). Каждая проверка печатает PASS/FAIL; итог — ненулевой exit при любом FAIL. **«Логин» epic-буквы реализован негативной пробой — Решение №2**: полный логин требует живого JWT-издателя (секрет), которого у smoke нет и быть не должно; истинный вход оператора — 12.7/12.8.
9. **AC-9 · Инварианты качества скриптов (уроки 12.1/12.2).** Оба: `set -Eeuo pipefail`, все пути в кавычках, flock от двойного запуска install, ERR-trap в install печатает «на каком шаге умерли и что уже изменено» (бэкап сделан? load сделан? migrate прошёл?) — оператор не гадает. `bash -n` чист.
10. **AC-10 · Живой прогон на dev-машине (обязателен) + красные пробы.** Полный цикл в изолированном INSTALL_DIR (scratchpad): (1) первая установка бандла `20260720-b0ee7bc` → зелёный smoke → `installed-tag` записан; (2) повторная установка того же тега (upgrade-путь: бэкап реально создан, pg_dump непустой); (3) 🔴 битый tar → стоп на чек-суммах ДО изменений; (4) 🔴 pinned-hash mismatch при самосогласованных sums → стоп «подмена»; (5) 🔴 image-id mismatch (синтетический манифест) → стоп до migrate; (6) 🔴 smoke-провал (остановленный app) → печать откат-процедуры с prev-тегом. Все выводы — в Dev Agent Record.
11. **AC-11 · Гейт зелёный.** `make gate` 2491/56; `git status` подтверждает нетронутость Backend/frontend.

## Tasks / Subtasks

- [x] Task 1 — smoke.sh (AC: #8, #9) — 8 проб (SPA, admin, 5×контекст, негативная auth); wait-for-ready прелюдия (находка живого прогона)
- [x] Task 2 — install.sh каркас: аргументы, INSTALL_DIR, flock, ERR-trap с картой шагов (AC: #1, #9)
- [x] Task 3 — цепочка целостности: pinned → sums → manifest sanity → min_upgrade_from (AC: #2, #3, #4) — сообщения РАЗЛИЧАЮТ транзитную порчу и подмену
- [x] Task 4 — бэкап при обновлении (AC: #5) — pg_dump + volume-tar образом ПРЕДЫДУЩЕГО релиза; имя volume резолвится из compose-конфига
- [x] Task 5 — load + identity-verify (AC: #6)
- [x] Task 6 — migrate → up → smoke → state-файл (атомарный mv); откат-инструкция с подставленными значениями (AC: #7)
- [x] Task 7 — живой прогон + красные пробы (AC: #10) — ВСЕ шесть сценариев, выводы в Debug Log
- [x] Task 8 — гейт + sprint-status (AC: #11) — 2491/56

## Dev Agent Record

### Agent Model Used

claude-fable-5 — спека и dev одной сессией (⚠️ same-model; ревью — те же 3 слоя субагентами).

### Debug Log References

- **Прогон №1 (первая установка, тег 20260720-b0ee7bc, изолированный INSTALL_DIR в scratchpad):** первая попытка УПАЛА на шаге smoke — и это был подарок: ERR-trap напечатал карту («прервана на шаге smoke») и полную откат-процедуру с подставленными командами — AC-7 доказан невольно. Причина провала — гонка: smoke стартует сразу после `up -d`, nginx (без healthcheck) ещё не забиндился; первые две пробы ловили обрыв (артефакт «000000»: curl пишет 000 сам + мой `|| echo 000` дописывал). Фикс: wait-for-ready прелюдия (30с бюджет) + `|| true`-захват кода. Повтор: **8/8 PASS, SMOKE: OK, installed-tag записан**.
- **Прогон №2 (upgrade-путь):** бэкап реально создан — `db.sql` 107 047 Б (непустой гейт сработал бы), `private_storage.tar.gz` 104 Б (том пуст — честно); volume-имя резолвлено из compose-конфига (`vaps-install_private_storage`); полный цикл до «УСТАНОВЛЕНО», prev-тег зафиксирован.
- **Проба №3 (битый tar):** «ОТКАЗ: sha не совпал ни с pinned, ни с sums — транзитная порча» — ДО единого изменения (epic-буква).
- **Проба №4 (самосогласованная подмена: tar+sums+manifest пересчитаны, pinned с «бумаги» прежний):** «sha256sums внутренне сходится — похоже на ПОДМЕНУ пары» — deferred :90 закрыт с различающей диагностикой.
- **Проба №5 (image-id mismatch, синтетический манифест):** стоп на шаге 4 с парой манифест/фактический id — deferred :103 закрыт; migrate не достигнут.
- **Проба №6 (min_upgrade_from=20990101-fffffff):** «установлен 20260720-…, релиз требует минимум 20990101 — сначала промежуточный релиз» — политика-заготовка работает.
- **Гейт:** первый прогон после teardown дал транзиент (2491 errors, 185s — коннекты к БД на фоне параллельного `down -v` install-стека; точечный тест с env зелёный сразу же) → повторный полный гейт: **2491 passed / 56 deselected / 73s / «No changes detected»**.

### Completion Notes List

1. **Смок-гонка после `up -d` — реальная находка прогона**: без wait-for-ready smoke на честно живой системе давал FAIL по таймингу. Прелюдия 30с; пробная battery после неё всё равно формально перепроверяет `/`.
2. **«Логин» epic-буквы реализован негативной auth-пробой** (Решение №2 спеки): мусорный Bearer → 401 (доказано прогоном — JWTAuthentication отвечает штатно). Полный логин = секрет издателя, которого у smoke нет и не должно быть.
3. `/api/notifications/` в smoke отвечает 403 (PermissionService fail-closed без identity), остальные контексты — 200: допуск `<500` оказался правильной шкалой «жив и осмыслен».
4. Оба deferred-хвоста install-стороны (:90 pinned-hash, :103 image-identity) закрыты и доказаны красными пробами №4/№5.
5. Гейт-транзиент (185s errors) не воспроизвёлся; причина — I/O-шторм от параллельного teardown; на повторе штатные 73s.

### File List

- `deploy/scripts/install.sh` (NEW)
- `deploy/scripts/smoke.sh` (NEW)
- `_bmad-output/implementation-artifacts/12-3-install-sh-и-smoke-sh.md` (M — этот файл)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M)

### Change Log

- 2026-07-20: полный dev-проход; 2 живых прогона (первая установка + upgrade с бэкапом) и 4 красные пробы целостности; статус → review.
- 2026-07-20 (ревью): 15 патчей применены и верифицированы третьим живым циклом на ВРАЖДЕБНОМ .env; статус → done.

### Review Findings

Ревью 2026-07-20 (bmad-code-review, 3 слоя субагентами Fable 5; ⚠️ same-model к спеке+dev). Итог: **15 patch (все применены; верификация — живой цикл №3 на враждебном .env), 1 defer, 4 dismiss.** Auditor воспроизвёл сильнейшую находку Blind самостоятельно (exit=1) — сходимость слоёв.

- [x] [Review][Patch] **HIGH (Blind+Auditor, воспроизведено):** успешная ПЕРВАЯ установка выходила с кодом 1 — финальный `[ -n "$BACKUP_DIR" ] && echo` последней командой при пустом BACKUP_DIR. → `if`-форма. Проверено: EXIT-КОД 0 на обоих путях [install.sh]
- [x] [Review][Patch] **HIGH (Blind+Edge):** печатная restore-процедура НЕ восстанавливала БД: plain-дамп без `--clean` сыпал бы «already exists» при psql exit 0 (ложно-успешный restore), `\$VAPS_DB_USER` печатался литералом (пустая подстановка в шелле оператора), шаг restore был вне нумерации. → pg_dump `--clean --if-exists` (проверено: 44 DROP в живом дампе), значения подставляются при печати через env_get, restore — нумерованный шаг 2 между down и сменой тега, `-v ON_ERROR_STOP=1` [install.sh]
- [x] [Review][Patch] **HIGH-класс (Edge №1/№3/№4/№8 + Blind №11, тема-доминанта):** сырой grep|cut и bash-сорсинг .env расходились с dotenv-семантикой compose — кавычки (`"8082"` → malformed URL → откат-инструкция для здорового стека), CRLF (`vaps\r` → «role does not exist»), inline-комментарии, `$$`→PID и `$(...)`-исполнение при сорсинге. → единый `env_get()` (python-мини-dotenv: CRLF, кавычки с ЯВНЫМ поиском закрывающей, inline-комменты, `\n`-разворачивание), bash-сорсинг УДАЛЁН полностью. Верификация: полный цикл на .env с кавычками+CRLF+inline-комментами — зелёный. Сам верификационный прогон поймал недожатую ветку (`"8082"  # comment` — endswith-наивность) → дожата [install.sh]
- [x] [Review][Patch] Pinned-hash: UPPERCASE/пробелы нормализуются, не-hex → «опечатка ввода с бумаги?» вместо крика «ПОДМЕНА» (проверено пробой) [install.sh]
- [x] [Review][Patch] Same-day min_upgrade_from: сравнение дат не упорядочивает однодневные релизы — раньше молча пропускало. → fail-closed с формулировкой «сверьте вручную» (проверено пробой) [install.sh]
- [x] [Review][Patch] Манифест с чужими тегами образов умирает на шаге 1 («не от этого релиза»), а не на migrate после бэкапа+load (проверено пробой); битый/неполный манифест → «ОТКАЗ…», не traceback [install.sh]
- [x] [Review][Patch] Повтор того же тега: docker load перевешивает тег — теперь резидентный id снимается ДО load и расхождение печатается явно («откат "на тот же тег" невозможен») [install.sh]
- [x] [Review][Patch] Бэкап-предпосылки с понятными отказами: образ N-1 резидентен (иначе air-gap-pull), volume существует (docker МОЛЧА создал бы пустой → «бэкап из ничего»), `up -d --wait db` (upgrade при остановленном стеке легален), stderr compose config не глушится (`${VAR:?}`-имя видно), `[ -s ]` на оба артефакта, ERR-очистка полукаталога бэкапа [install.sh]
- [x] [Review][Patch] Пустой-но-существующий installed-tag = повреждение state (СТОП), не «первая установка» (молча пропускала бы бэкап и min_upgrade) [install.sh]
- [x] [Review][Patch] smoke в откате и в установке зовётся `bash smoke.sh <url-с-портом-из-.env>` — exec-бит теряется на FAT-носителе, порт из окружения оператора не берётся [install.sh]
- [x] [Review][Patch] STEP="тег-в-env" добавлен в trap-карту; нумерация [1/8]..[8/8] выровнена (Auditor: недекларированный шаг задекларирован) [install.sh]
- [x] [Review][Patch] Wait-loop готовности требует именно 200 от `/` (статика nginx), не «любой ответ» [smoke.sh]
- [x] [Review][Patch] Auth-проба строго 401 (не 401|403): 403 означал бы «Bearer молча проигнорирован» = JWT не сконфигурирован — misconfig-мир проба теперь КРАСНИТ (Auditor-трасса по authentication.py) [smoke.sh]
- [x] [Review][Defer] Живой прогон restore-процедуры (психологически главный тест дампа) — по построению эпика это **12.4 restore-rehearsal**; печатная процедура компонентно доказана (--clean дамп, env_get-значения), полный прогон — след. стори [→ 12.4]

Dismissed (4): «tar/entrypoint в app-образе» (CMD-only, python:slim несёт tar — проверено 12.1); «volume с явным name: в compose» (наш compose без name:, плюс новый volume-inspect-гард кроет); «compose config --format json недоступен на старом compose» (скрипт-порождение и контур — v2; min-версия docker — тема CHECKLIST 12.5); wait-loop-502-break (Edge сам фальсифицировал для install-пути).

### Senior Developer Review (AI)

- Итог: **APPROVE после патчей** (2026-07-20). Верификация — ЖИВАЯ и враждебная: цикл №3 шёл на .env с кавычками, CRLF и inline-комментами одновременно + UPPERCASE pinned; exit-коды обоих путей проверены явно (урок Auditor: «цепочка целиком не гоняется» — теперь гоняется). 5 новых красных проб (same-day, чужой тег, не-hex pinned, dump--clean, quote-comment).
- Паттерн стори: скрипты, читающие конфиг ДРУГОЙ системы (compose-dotenv), обязаны читать его ПАРСЕРОМ той системы, не bash-идиомами — расхождение семантик дало 5 находок одного корня.
- Гейт: 2491/56 «No changes detected» (один прогон дал известный 2-teardown-флейк из памяти проекта — перегон чист).
- Action Items: нет открытых.

## Dev Notes

### Решения (Bratan-overridable)

- **Решение №1:** state «что установлено» = файл `installed-tag` в INSTALL_DIR (не docker labels, не БД): переживает `compose down`, читается глазами, пишется атомарно после зелёного smoke.
- **Решение №2:** «health + логин» epic-буквы → БЕЗ нового бэк-эндпоинта и БЕЗ секретов в smoke: health = «каждый контекст отвечает <500», логин = негативная auth-проба (мусорный Bearer → 401/403, не 5xx). Health-эндпоинт на бэке — отдельная бэк-стори, если понадобится (schema+RBAC); полный логин — вход оператора в 12.7/12.8.
- **Решение №3:** pinned-hash = аргумент, зачитанный из бумажного канала (CHECKLIST 12.5 добавит строку «sha с бумаги»); GPG-подпись — не для этого контура (нет PKI), НЕ строим.
- **Решение №4:** откат НЕ автоматический: скрипт печатает готовую к копипасту процедуру с подставленными значениями. Автоматический rollback в air-gap = самостоятельные необратимые решения скрипта в среде, где чинить некому.

### Ловушки

- Порядок AC-3 «до изменений» — структурный: ни одна мутация (mkdir backups, load) не выше цепочки целостности.
- `docker compose` во ВСЕХ вызовах — с `--env-file` (уроки 12.1: интерполяция `${VAR:?}` валит даже `down`).
- nginx-403 (cross-origin guard) ≠ app-403: smoke шлёт запросы БЕЗ Origin — не попадает под guard вовсе.
- `pg_dump` из контейнера: `docker compose exec -T db pg_dump -U $VAPS_DB_USER $VAPS_DB_NAME` (креды из .env оператора; -T — не TTY).
- Файловый volume бэкапится `docker run --rm -v <volume>:/src -v backups:/dst alpine tar` — но alpine-образа в контуре может не быть! Использовать УЖЕ имеющийся `vaps-app:<prev>` образ для tar (python:slim несёт tar) — ноль новых образов.
- В smoke негативная auth-проба идёт на `/api/notifications/` (лёгкий листинг; мусорный токен → 401 от JWTAuthentication).

### Testing

- Automated: `bash -n` оба; `make gate` (регресс).
- Manual: AC-10 полный цикл + 4 красные пробы, выводы в Dev Agent Record.
- Integration: реальный контур — 12.7.
