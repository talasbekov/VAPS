---
baseline_commit: 2389629 (HEAD, `feat(story-12.3)`). Артефакт-пути чисты; чужие `.claude/settings.json` (M) и `_bmad-output/story-automator/**` (untracked) — вне скоупа.
baseline_tests: `cd Backend/VAPS && make gate` → **2491 passed, 56 deselected** (финальный прогон 12.3 на этом коде; стори не трогает Python/фронт). Известный флейк: разовые 2 teardown-ERROR (память проекта) — перегон чист.
prerequisite: 12.1 (compose), 12.2 (бандл — живая тройка `20260720-b0ee7bc`), 12.3 (`done`: install.sh/smoke.sh, env_get-парсер, модель INSTALL_DIR, печатная restore-процедура).
scope_note: Скоуп = epic-AC 12.4 (ночной pg_dump + volume-бэкап, restore-rehearsal в чистый контейнер → смок, провал=алерт, catch-up семантика) + закрытие defer 12.3 (живой прогон restore-процедуры). НЕ входят: Celery/beat (12.6 — планировщик здесь = host-таймер systemd), алерты-уведомления людям (13.5 — здесь алерт = exit-код + ALERT-маркер + журнал), CHECKLIST (12.5).
context:
  - _bmad-output/planning-artifacts/epics.md#L1302-1308 (Story 12.4 AC: «ночной pg_dump + бэкап volume и restore-rehearsal.sh в ночной джобе (restore в чистый контейнер → смок)»; «Given ночная джоба, Then свежий бэкап восстановлен в контейнер и смок зелёный; провал = алерт»; «catch-up семантика: при выключенном ночью сервере джоба исполняется при ближайшей доступности»)
  - _bmad-output/planning-artifacts/architecture.md#L341 («Бэкапы: ночной pg_dump + файлы; репетиция восстановления — чеклист релиза»), #L565 (дерево: restore-rehearsal.sh «pg_dump → restore в чистый контейнер → smoke»), #L338 (жизнь без интернета/CI)
  - _bmad-output/implementation-artifacts/deferred-work.md (хвост 12.3): «Живой прогон restore-процедуры БД … закрыть в 12.4 ПЕРВЫМ ЖЕ сценарием»
  - `deploy/scripts/install.sh` (12.3) — образцы: env_get-парсер (НЕ дублировать логику чтения .env — переиспользовать копией функции с пометкой источника), модель INSTALL_DIR, COMPOSE-массив с --env-file, pg_dump --clean --if-exists, volume-tar образом vaps-app:<tag>, гарды предпосылок (volume существует, образ резидентен), ERR-trap, flock
  - `deploy/scripts/smoke.sh` — НЕ трогается; настоящий полный смок = против живого стека, здесь смок восстановленной БД = SQL-уровень (Решение №2)
  - `deploy/docker-compose.yml` — postgres:16 (чистый rehearsal-контейнер обязан быть ТОГО ЖЕ мажора)
  - Память проекта: ARCH-SEC-030 (не писать чувствительные литералы), канон «конфиг — env»
---

# Story 12.4: Бэкапы и restore-репетиция

Status: done

## Story

As a **админ контура**,
I want **`backup-nightly.sh` (pg_dump --clean + tar private_storage с ротацией, catch-up через systemd-timer Persistent=true) и `restore-rehearsal.sh` (свежайший дамп → ЧИСТЫЙ одноразовый postgres:16-контейнер → SQL-смок → уборка; провал = ненулевой exit + ALERT-маркер)**,
so that **бэкап существует не «наверное», а доказанно восстановим каждую ночь, и провал репетиции виден утром без внешних сервисов**.

## Acceptance Criteria

**AC-0 · ГРАНИЦА.** НЕ строим: Celery/beat (12.6), доставку алертов людям (13.5 — здесь маркер+exit+журнал), правки `install.sh`/`smoke.sh`/compose/образов, восстановление private_storage-тарбола в rehearsal (Решение №3: смок файлового бэкапа = целостность архива `tar -tzf`, содержимое некому валидировать без стека). `Backend/**`, `frontend/**` — ни строкой.

1. **AC-1 · `deploy/scripts/backup-nightly.sh` (NEW).** Модель 12.3: работает из INSTALL_DIR (дефолт — каталог скрипта), читает `.env` через env_get (копия функции из install.sh с пометкой источника — НЕ bash-сорсинг), flock. Снимает с ЖИВОГО стека: `pg_dump --clean --if-exists` + `tar private_storage` (образом `vaps-app:<installed-tag>`; volume-гард 12.3) → `INSTALL_DIR/backups/nightly/<UTC-ts>/`. Гарды: `installed-tag` существует и непуст (нет установки — нечего бэкапить, exit 0 с печатью), оба артефакта непусты. Ротация: держит `VAPS_BACKUP_KEEP` (дефолт 14) последних nightly-каталогов, старшие удаляет с печатью.
2. **AC-2 · `deploy/scripts/restore-rehearsal.sh` (NEW): восстановление ДОКАЗЫВАЕТСЯ.** Берёт свежайший `backups/nightly/*/db.sql` (или путь аргументом), поднимает ОДНОРАЗОВЫЙ чистый `postgres:16`-контейнер (уникальное имя, tmpfs/анонимный volume, БЕЗ публикации портов), льёт дамп `psql -v ON_ERROR_STOP=1`, гоняет SQL-смок (AC-3), сносит контейнер в `trap ... EXIT` (уборка гарантирована и при провале). Файловый бэкап: `tar -tzf` целостность.
3. **AC-3 · SQL-смок восстановленной БД — дискриминирующий.** Минимум: (а) `django_migrations` непуста и содержит `ops_submissions`/`ops_statuses`-записи; (б) ключевые таблицы живы запросом COUNT: `core_employees`, `employee_statuses`, `daily_submissions`, `audit_logs`, `notifications`; (в) счётчики печатаются в вывод (журналу видно ЧТО восстановлено). Пустая/чужая БД в контейнере обязана дать FAIL — не «0 строк = зелёно» по всем осям сразу: гейт (а) этим и занимается.
4. **AC-4 · Провал = алерт (epic-буква, air-gap-реализация).** Любой провал rehearsal: ненулевой exit + файл-маркер `backups/ALERT-restore-rehearsal` (содержимое: UTC-ts, шаг, причина; перезаписывается) + строка в `backups/rehearsal.log`. Успех: маркер УДАЛЯЕТСЯ (существование маркера = «последняя репетиция провалена»), в журнал — строка OK с ts и счётчиками. Утренняя проверка оператора = «есть ли ALERT-файл» (одна строка в будущем CHECKLIST 12.5).
5. **AC-5 · Ночная джоба + catch-up семантика (epic-буква).** `deploy/systemd/vaps-backup.service` + `vaps-backup.timer` (NEW): oneshot-сервис зовёт `backup-nightly.sh && restore-rehearsal.sh`; таймер `OnCalendar=*-*-* 02:30`, **`Persistent=true`** — выключенный ночью сервер исполняет джобу при ближайшей загрузке (ровно epic-фраза), `RandomizedDelaySec` малый. Установка юнитов — инструкция в шапке (cp + systemctl enable --now), НЕ автоматизируется скриптом (root-действие админа).
6. **AC-6 · Закрытие defer 12.3 — живой прогон ПОЛНОЙ restore-процедуры.** Дев-верификация (не скрипт): на живом стеке с данными — снять nightly-бэкап → испортить БД контролируемо (DROP одной таблицы + вставка мусорной строки в другую) → восстановить дамп ПЕЧАТНОЙ ПРОЦЕДУРОЙ 12.3 (те же команды: psql ON_ERROR_STOP через compose exec) → доказать: дропнутая таблица вернулась, мусорная строка исчезла → `smoke.sh` зелёный. Вывод в Dev Agent Record; deferred-work-строка 12.3 помечается закрытой.
7. **AC-7 · Инварианты качества + красные пробы.** Оба скрипта: `set -Eeuo pipefail`, кавычки, `bash -n` чист. Пробы: (1) 🔴 битый дамп (обрезанный db.sql) → rehearsal FAIL + ALERT-маркер создан; (2) успех после провала → маркер удалён; (3) ротация: искусственные N+2 каталогов → старшие удалены; (4) rehearsal при отсутствии бэкапов → внятный FAIL+ALERT (не «зелёно на пустоте»).
8. **AC-8 · Гейт зелёный.** `make gate` 2491/56; Backend/frontend не тронуты.

## Tasks / Subtasks

- [x] Task 1 — backup-nightly.sh (AC: #1)
- [x] Task 2 — restore-rehearsal.sh + SQL-смок + ALERT/журнал (AC: #2, #3, #4)
- [x] Task 3 — systemd-юниты с Persistent=true + инструкция (AC: #5)
- [x] Task 4 — живые прогоны: nightly (127KB дамп + volume-tar) → rehearsal зелёный (AC: #1-#4)
- [x] Task 5 — закрытие defer 12.3: порча БД → restore печатной процедурой → smoke (AC: #6)
- [x] Task 6 — красные пробы 1-4 (AC: #7)
- [x] Task 7 — гейт 2491/56 + sprint-status (AC: #8)

## Dev Agent Record

### Agent Model Used

claude-fable-5 (⚠️ same-model: спека+dev+ревью одной сессией).

### Debug Log References

- **Живой цикл ловил реальные баги трижды (дискриминирующая сила смока доказана естественно):**
  1. Первый rehearsal-прогон: «role "vaps" does not exist» — дамп несёт `OWNER TO vaps`, а чистый контейнер поднимался с ролью `rehearsal`. Фикс: контейнер несёт ПРОД-имена роли/БД из .env (это и есть честная репетиция). ALERT-механика отработала штатно с первого раза.
  2. Второй прогон: SQL-смок уронил УГАДАННЫЕ имена таблиц (`employee_statuses` вместо живого `ops_employee_statuses`) — урок памяти «сверять с raise-сайтами» повторён на db_table; имена сверены grep'ом по моделям.
  3. Третий прогон: **REHEARSAL OK** — 64 миграции, migrations_ops=13, core_employees=1 (посеянный «Бэкапов Тест» восстановлен), маркер снят, rehearsal-контейнер убран trap'ом (docker ps пуст).
- **nightly:** 127 281 Б db.sql (--clean) + volume-tar; ротация KEEP=2 удалила 3 синтетически старших каталога, свежие целы.
- **Красные пробы:** (1) обрезанный дамп → FAIL+ALERT (step=sql-смок: срез на 5000Б синтаксически валиден до среза — ловит смок, не psql; честно записано); (2) успех снял маркер; (3) ротация — выше; (4) пустой nightly → внятный FAIL «репетировать нечего»+ALERT, честный exit=1 (первый замер exit был артефактом `$?` от tail — перемерено через PIPESTATUS; попутный фикс `|| true` на find, чтобы отказ шёл через _fail, а не ERR-«неожиданный сбой»).
- **AC-6 (закрытие defer 12.3), полный сценарий:** DROP `ops_tomorrow_block_overrides` CASCADE + INSERT мусорной строки (GARBAGE=1 ДО) → restore ДОСЛОВНО печатной процедурой 12.3 (`cat dump | compose exec -T db psql -v ON_ERROR_STOP=1`) → таблица вернулась (=1), **GARBAGE=0 ПОСЛЕ** (строка исчезла рестором — вакуумная половина первой пробы «не вставилась из-за NOT NULL» была ДОЖАТА валидной вставкой), сотрудник на месте, `smoke.sh` OK. Дефер-строка 12.3 в deferred-work помечена закрытой.
- **Гейт:** 2491 passed / 56 deselected / «No changes detected».

### Completion Notes List

1. Рабочая цепочка «джоба ловит правду»: три первых прогона провалились по НАСТОЯЩИМ причинам (роль, имена таблиц) — ровно то, ради чего репетиция существует; каждый провал оставлял корректный ALERT.
2. `Persistent=true` — буквальная catch-up семантика epic-AC, задокументирована в таймере с 🔴-комментарием.
3. env_get скопирован в оба скрипта с пометкой «источник install.sh 12.3, правки синхронно» (три копии — кандидат на вынос в lib при следующем касании, НЕ сейчас).
4. Битый-дамп-проба: обрезка ловится SQL-смоком, не psql (валидный префикс) — семантика «FAIL любым слоем» достаточна, задекларировано.

### File List

- `deploy/scripts/backup-nightly.sh` (NEW)
- `deploy/scripts/restore-rehearsal.sh` (NEW)
- `deploy/systemd/vaps-backup.service` (NEW)
- `deploy/systemd/vaps-backup.timer` (NEW)
- `_bmad-output/implementation-artifacts/12-4-бэкапы-и-restore-репетиция.md` (M)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M)
- `_bmad-output/implementation-artifacts/deferred-work.md` (M — дефер 12.3 закрыт)

### Change Log

- 2026-07-20: полный dev-проход; 3 итерации живого rehearsal до зелёного + 4 красные пробы + AC-6-сценарий целиком; статус → review.
- 2026-07-20 (ревью): 16 патчей применены, верификация свежим полным циклом (тома не текут, KEEP-пробы, оба ALERT-канала); статус → done.

### Review Findings

Ревью 2026-07-20 (bmad-code-review, 3 слоя субагентами Fable 5; ⚠️ same-model). Итог: **16 patch (все применены и верифицированы живым циклом), 3 defer, 3 dismiss.** Сходимость слоёв: volume-утечку нашли Blind и Auditor независимо; KEEP=0 — Blind и Edge.

- [x] [Review][Patch] **HIGH (Blind+Auditor):** `docker rm -f` без `-v` — postgres:16 декларирует VOLUME на PGDATA → каждая ночь оставляла анонимный том с ПОЛНОЙ копией прод-БД (диск бэкап-хоста растёт до отказа). → `rm -f -v` + GC осиротевших `vaps-rehearsal-*` на старте под локом. Верифицировано: docker volume count до=после [restore-rehearsal.sh]
- [x] [Review][Patch] **HIGH (Blind):** очистка частичного каталога держалась на ERR-trap, который НЕ покрывает `[ -s ] || exit` и сигналы (systemctl stop / reboot посреди pg_dump → усечённый db.sql остаётся, rehearsal выбирает его как свежайший). → EXIT-trap с флагом успеха + `trap 'exit 143' TERM INT` [backup-nightly.sh]
- [x] [Review][Patch] **Med (Blind+Edge, воспроизведено):** `VAPS_BACKUP_KEEP=0` проходил валидацию и удалял ТОЛЬКО ЧТО снятый бэкап после «OK»; `014` — октал (тихое пере-удаление); `08` — арифметическая ошибка при exit 0 (ротация молча отключена навсегда). → строгий regex `^[1-9][0-9]{0,3}$`; валидация перенесена FAIL-FAST до снятия (ревью-проба поймала: отказ в хвосте триггерил EXIT-cleanup и уносил свежий бэкап) [backup-nightly.sh]
- [x] [Review][Patch] **Med (Blind+Auditor):** провал БЭКАП-половины ночной джобы не оставлял ни маркера, ни строки журнала (утренний ритуал показывал зелёное после провальной ночи) — ALERT-машина добавлена в nightly (`ALERT-backup-nightly` + `backup.log`), комментарий сервиса переписан честно («ls backups/ALERT-*») [backup-nightly.sh, vaps-backup.service]
- [x] [Review][Patch] **Med (Blind):** `_fail` при полном/read-only диске сам умирал на записи маркера, глуша диагноз — записи под `|| true`, stderr и exit 1 неубиваемы [restore-rehearsal.sh, backup-nightly.sh]
- [x] [Review][Patch] **Med (Edge, РЕАЛЬНАЯ дыра):** residency-гард образа БД — в air-gap отсутствие `postgres:16` означало зависший pull, не понятную ошибку; образ теперь читается ИЗ COMPOSE (дрейф мажора исчезает конструктивно — закрыт и Auditor F5) + `docker image inspect`-гард [restore-rehearsal.sh]
- [x] [Review][Patch] **Med (Blind+Edge):** tar живого тома — GNU exit 1 («file changed as we read it») теперь warning, не провал ночи; benign-направление скоса дамп↔tar задокументировано [backup-nightly.sh]
- [x] [Review][Patch] Разные лок-файлы не исключали ручной rehearsal во время бэкапа (ложный ALERT по недописанному каталогу; ротация могла удалить читаемый дамп) — ЕДИНЫЙ `.backup.lock` [restore-rehearsal.sh]
- [x] [Review][Patch] Имя контейнера `$$`→`$$-TS` (PID-reuse коллизия leftover'а после SIGKILL) [restore-rehearsal.sh]
- [x] [Review][Patch] Смок += `documents_attachments` (БД-половина файлового бэкапа) и `ops_user_roles` (система без RBAC-строк непригодна) — имена сверены с db_table [restore-rehearsal.sh]
- [x] [Review][Patch] `mkdir` листа без `-p` (same-second коллизия падает громко; родитель — идемпотентно; первый прогон патча поймал голый mkdir на свежем nightly/) [backup-nightly.sh]
- [x] [Review][Patch] systemd: `Environment=INSTALL_DIR` — путь правится в одном месте, с кавычками; строка о доставке скриптов носителем (чек-лист 12.5) [vaps-backup.service]
- [x] [Review][Patch] `VAPS_BACKUP_KEEP` задокументирован с диапазоном [.env.example]
- [x] [Review][Patch] Формулировка закрытия дефера 12.3 сужена честно: restore-половина; откат образов N-1 — 12.7 (Auditor F3) [deferred-work.md]
- [x] [Review][Defer] Однодоменный pg_dump не несёт globals (CREATE ROLE): станет актуально при выделенной app-роли (deferred-work:394) — `pg_dumpall --globals-only` добавить ТОЙ ЖЕ работой [→ будущая роль-работа :394]
- [x] [Review][Defer] Доставка БАЗОВЫХ образов (postgres:16, redis:7-alpine) в контур не покрыта бандлом 12.2 (docker save берёт только vaps-*) — РЕАЛЬНАЯ дыра деплой-пути [→ 12.5 CHECKLIST + расширение bundle.sh]
- [x] [Review][Defer] Консистентность файл↔строка (sha256 вложений из БД vs tar) не проверяется — existence-only смок [→ hardening 13.x]

Dismissed (3): «USER не-root в образе» (образ 12.1 — root, проверено); «postgres:16 ≠ compose» (закрыто конструктивно P-образом-из-compose); дубль FAIL-строк в rehearsal.log при наследовании ERR в substitution (косметика, итоговый маркер корректен — known).

### Senior Developer Review (AI)

- Итог: **APPROVE после патчей** (2026-07-20). Верификация — свежий полный цикл: nightly OK → rehearsal OK (расширенный смок 9 таблиц), тома docker: до=после (утечка закрыта), оба ALERT-канала (nightly-ALERT прошлого прерванного прогона снят успехом), KEEP-пробы 0/014 бьются fail-fast БЕЗ уничтожения снятых бэкапов, гейт 2491/56.
- Паттерн стори: ревизор-инфраструктура сама источник рисков — утечка томов КАЖДУЮ ночь, KEEP=0 как «отключить ротацию» уничтожал данные, валидация в хвосте убивала свежий бэкап. Все три — класс «джоба вредит тому, что охраняет».
- Action Items: нет открытых.

## Dev Notes

### Решения (Bratan-overridable)

- **Решение №1:** планировщик = host systemd-timer с `Persistent=true` (буквальная catch-up семантика epic-AC), НЕ Celery beat (его нет — ARCH-DEFERRED-048; beat-регистрация приложенческих задач — 12.6) и НЕ cron (нет catch-up из коробки).
- **Решение №2:** смок восстановленной БД = SQL-уровень в чистом контейнере (счётчики+migrations), НЕ подъём приложения на восстановленной БД: полный app-смок требует второго стека (порты/volume-коллизии на том же хосте) — цена не оправдана для ночной джобы; app-уровень доказан отдельно сценарием AC-6.
- **Решение №3:** rehearsal НЕ распаковывает private_storage-тарбол: `tar -tzf`-целостность достаточна (байты вложений валидировать некому без стека; sha-цепочка вложений — забота приложения).
- **Решение №4:** ALERT = файл-маркер + exit + журнал; существование маркера = состояние «провалено», успех его снимает. Доставка человеку — 13.5.
- **Решение №5:** nightly-бэкапы живут ОТДЕЛЬНО от install-бэкапов 12.3 (`backups/nightly/` vs `backups/<ts>-<tag>/`): ротация не имеет права съесть pre-migrate бэкап установки.

### Ловушки

- env_get копируется из install.sh С ПОМЕТКОЙ «источник — install.sh 12.3; правки синхронно» (не sourcing install.sh — он исполняется).
- Чистый контейнер: `docker run -d --rm --name vaps-rehearsal-$$ -e POSTGRES_PASSWORD=rehearsal postgres:16` + ожидание pg_isready循环; psql/pg_isready — ВНУТРИ контейнера (docker exec), хостовых клиентов нет.
- Мажор postgres в rehearsal обязан совпадать с compose (16) — дамп новее сервера не льётся.
- `trap ... EXIT` для сноса контейнера — до первой точки провала.
- Timer-юнит: `WantedBy=timers.target`; сервис From= абсолютные пути INSTALL_DIR — в юнитах плейсхолдер `/opt/vaps` с комментарием «поправить под фактический INSTALL_DIR».

### Testing

- Automated: `bash -n`; `make gate`.
- Manual: AC-6 полный сценарий + 4 красные пробы; все выводы в Dev Agent Record.
