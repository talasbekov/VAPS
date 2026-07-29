---
baseline_commit: 3ebce31
---

# Story 12.4: Бэкапы и restore-репетиция

Status: done

## Story

As a **админ контура**,
I want **ночной pg_dump + бэкап `private_storage`-volume'а, плюс `restore-rehearsal.sh`, реально восстанавливающий свежий бэкап в чистый параллельный стек и проверяющий его smoke'ом**,
so that **«бэкап, который не восстанавливали, не существует» (architecture.md#L644) — доказанная восстановимость, не предположение**.

## Acceptance Criteria

Источник: `epics.md#L1302-1310` (буква стори) + `architecture.md#L565` (целевой путь `deploy/scripts/restore-rehearsal.sh`) + `architecture.md#L341` («ночной pg_dump + файлы; репетиция восстановления — чеклист релиза») + `architecture.md#L644` (мотивация — восстановимость должна быть ДОКАЗАНА, не предположена).

Скоуп — 5 файлов (граница CLAUDE.md's лимита, одна ответственность — «бэкап доказанно восстановим»): `deploy/scripts/nightly-backup.sh` (NEW), `deploy/scripts/restore-rehearsal.sh` (NEW), `deploy/systemd/vaps-backup.service`+`.timer` (NEW, планировщик — та же механика, что уже проверена 7.0's `vaps-parallel-run-diff.{service,timer}`), структурный тест (regex-стиль, зеркало 12.2/12.3).

1. **AC-1 (ночной pg_dump + volume-бэкап, планировщик — systemd timer, не Celery beat).** Celery не установлен нигде в проекте (12.1's Dockerfile/12.3's install.sh это уже подтвердили; worker/beat явно отложены на 12.6). Планировщик — та же механика, что уже проверена и заведена Story 7.0 для `parallel-run-diff`: `deploy/systemd/vaps-backup.service` (`Type=oneshot`, `ExecStart=/opt/vaps/deploy/scripts/nightly-backup.sh`, `WorkingDirectory=/opt/vaps/deploy`) + `vaps-backup.timer` (`OnCalendar=*-*-* 03:00:00`, **`Persistent=true`**).
2. **AC-2 (catch-up семантика — systemd's собственный механизм, не приложенческий watermark).** `Persistent=true` в `.timer` — ДОКУМЕНТИРОВАННОЕ ЯДРО systemd: пропущенный (сервер был выключен) запуск исполняется при ближайшей доступности автоматически, без кастомного кода. **Скоуп-решение**: НЕ переиспользуется `apps.core.clock.catchup_plan` (тот — приложенческий, per-day watermark-replay для ДАННЫХ, применяется в 3.12/5.7b2/6.9; ночной pg_dump — не «за пропущенные дни», а «сделать бэкап СЕЙЧАС, раз пропустили окно» — систем-уровневая, не бизнес-семантика; 7.0 уже установила этот прецедент для инфраструктурных джоб).
3. **AC-3 (`nightly-backup.sh` — pg_dump + volume-tar, с меткой времени + стабильный указатель `latest`).** Тот же механизм, что `install.sh`'s inline-бэкап (12.3: `pg_dump` через `docker compose exec`, `docker run --rm -v ...:/data ... tar czf`), но САМОСТОЯТЕЛЬНО, не переиспользует install.sh's код (12.3's Dev Notes явно называет свой бэкап «inline safety-net этой стори», не общей библиотекой) — независимая копия механики, задокументированное намеренное НЕ-обобщение (обобщать после ВТОРОГО реального потребителя — сейчас их два: 12.3 и 12.4, но оба уже написаны с разным контекстом вызова, рефакторинг в общую либу — не в скоупе этой стори). `docker compose exec`/`docker run` используют ТОТ ЖЕ `COMPOSE_PROJECT="vaps-install"`, что `install.sh` — реальный прод-стек на целевой машине ВСЕГДА поднят под этим именем (12.3's install.sh — единственный способ его поднять). После каждого успешного бэкапа — `deploy/backups/latest` (symlink) указывает на свежий timestamped-каталог, тот же приём, что `.last-bundle-sha`/`.installed-sha` (12.2/12.3).
4. **AC-4 (`restore-rehearsal.sh` — реальное восстановление в ЧИСТЫЙ параллельный стек, не в прод).** Отдельный `docker compose`-проект `vaps-restore-rehearsal` (НЕ `vaps-install` — восстановление в ЖИВОЙ прод-стек стёрло бы прод-данные; НЕ `deploy` — коллизионный generic-неймспейс, уже дважды ударивший эту сессию). Поднимает ТОЛЬКО `postgres`+`redis`+`app` (БЕЗ `nginx` — избегает коллизии порта `80:80` с реально работающим прод-стеком на той же машине) из `deploy/backups/latest`. Восстанавливает `postgres.sql` через `psql`, `private_storage.tar.gz` через `docker run --rm -v ...`. Smoke — ВНУТРИ контейнера `app` (`docker compose exec app`, бьёт `127.0.0.1:8000` напрямую — та же механика, что уже использует 12.1's собственный app-healthcheck; ALLOWED_HOSTS уже разрешает `127.0.0.1` для ровно этого внутреннего сценария, 12.3's review-фикс) — не через `smoke.sh`/nginx (тот требует publish порта 80, коллизирующего с прод; полная nginx-цепочка уже покрыта 12.3's `install.sh`, здесь цель — доказать ВОССТАНОВИМОСТЬ ДАННЫХ + запускаемость приложения НА НИХ, не переповторить весь nginx-routing-тест).
5. **AC-5 (провал → алерт = громкий exit + структурный лог, не email/webhook — их нет).** `architecture.md#L339`'s собственный список: structured JSON logs — единственный built alerting-механизм проекта, error tracking (GlitchTip) явно DEFERRED. `nightly-backup.sh`/`restore-rehearsal.sh` — `set -euo pipefail`, `exit 1` + понятное сообщение на любом провале шага (systemd's `journalctl -u vaps-backup.service`/`systemctl status` — видимый провал для админа, тот же паттерн, что 7.0 уже приняла для `parallel-run-diff`). Реальный email/webhook — вне скоупа (не построен нигде в проекте, задокументированный DEFERRED, не молчаливый пропуск).
6. **AC-6 (реальный прогон + регресс нулевой).** Дев-агент ОБЯЗАН реально: поднять прод-подобный стек (`vaps-install`), сделать `nightly-backup.sh`, поднять `vaps-restore-rehearsal` с ДРУГИМ проектным именем, восстановить, смок ИЗНУТРИ контейнера зелёный, убрать оба стека под правильными именами (никаких посторонних docker-ресурсов — урок этой сессии, дважды повторённый). `make gate` зелёный.

## Tasks / Subtasks

- [x] Task 1 — `deploy/scripts/nightly-backup.sh` (NEW) (AC: 1, 3)
  - [x] `set -euo pipefail`, `COMPOSE_PROJECT="vaps-install"` (тот же, что `install.sh`).
  - [x] `pg_dump` через `docker compose exec -T postgres`, `docker run --rm -v vaps-install_private_storage:/data ... tar czf` для volume'а — в `deploy/backups/<timestamp>/`.
  - [x] `deploy/backups/latest` symlink обновляется ПОСЛЕ успешного завершения обоих шагов (не раньше — недописанный бэкап не должен стать «latest»).
- [x] Task 2 — `deploy/systemd/vaps-backup.service`+`.timer` (NEW) (AC: 1, 2)
  - [x] Зеркало `deploy/contour-stand/systemd/vaps-parallel-run-diff.{service,timer}` — `Type=oneshot`, `OnCalendar=*-*-* 03:00:00`, `Persistent=true`.
- [x] Task 3 — `deploy/scripts/restore-rehearsal.sh` (NEW) (AC: 4, 5)
  - [x] `COMPOSE_PROJECT="vaps-restore-rehearsal"` — явно ОТДЕЛЬНЫЙ от `vaps-install`.
  - [x] Снос стейл-остатков предыдущей неудачной репетиции (`down -v`) ПЕРЕД стартом.
  - [x] `docker compose ... up -d --wait postgres redis app` (БЕЗ nginx — избегает коллизии порта).
  - [x] Восстановление `postgres.sql` (`psql`) + `private_storage.tar.gz` (`docker run --rm -v ...`) из `deploy/backups/latest`.
  - [x] Смок ИЗНУТРИ `app`-контейнера (`docker compose exec app python -c "urllib.request.urlopen('http://127.0.0.1:8000/api/parallel-run/health/')"` — та же механика, что 12.1's app-healthcheck).
  - [x] Снос стека (`down -v`) ПОСЛЕ, успешно или нет — не оставлять репетиционный стек висеть.
- [x] Task 4 — Структурный тест (`Backend/VAPS/apps/core/tests/test_backup_scripts.py`, NEW) (AC: 1-6)
  - [x] Зеркало `test_bundle_script.py`/`test_install_and_smoke_scripts.py`: `set -euo pipefail`, оба `COMPOSE_PROJECT`-значения РАЗЛИЧНЫ и НЕ `deploy`, `-p` присутствует на каждом `docker compose`-вызове, systemd-юниты содержат `Persistent=true`/`OnCalendar`, `latest`-symlink обновляется ПОСЛЕ успешных шагов.
- [x] Task 5 — Реальный прогон (AC: 6)
  - [x] Прод-подобный стек (`vaps-install`) реально поднят, `nightly-backup.sh` реально собрал бэкап.
  - [x] `restore-rehearsal.sh` реально восстановил в `vaps-restore-rehearsal`, смок зелёный.
  - [x] Оба стека убраны, `docker volume ls`/`docker ps -a` чистые (без посторонних ресурсов).
  - [x] `make gate` — зелёный.

## Dev Notes

- **systemd timer, не Celery beat — прецедент уже принят, не новое решение.** `deploy/docker-compose.yml`'s собственный заголовочный комментарий уже говорит «без Celery — в проекте его нет, планирование через systemd timer, см. systemd/» — 7.0 это установила для `parallel-run-diff`, 12.4 — второй потребитель того же паттерна, не изобретение нового.
- **`Persistent=true` — задокументированная семантика systemd, не кастомный код.** Ядро AC-2 «catch-up» покрывается ОДНОЙ строкой конфигурации — не Python/bash-логикой. Не путать с `apps.core.clock.catchup_plan` (приложенческий, per-day watermark, для ДАННЫХ 3.12/5.7b2/6.9) — разные слои, разное назначение, задокументировано явно, не смешивается.
- **`restore-rehearsal.sh` НЕ поднимает nginx — намеренно, не недосмотр.** Прод-стек (`vaps-install`) реально занимает порт `80` на целевой машине. Полная nginx-цепочка (Host-гард, X-Accel, WS-Origin) уже покрыта живым прогоном 12.1/12.3 — цель ЭТОЙ репетиции конкретна: «данные из бэкапа восстановлены и приложение НА НИХ запускается» — smoke внутри контейнера (тот же механизм, что 12.1's app-healthcheck) доказывает ровно это, без конфликта портов.
- **`nightly-backup.sh` НЕ переиспользует `install.sh`'s код буквально.** 12.3's Completion Notes явно называет её бэкап «inline safety-net этой стори» — независимая копия механики (два похожих, но по-разному вызываемых потребителя: один — перед мутацией внутри установочного рунбука, другой — по расписанию); рефакторинг в общую либу — по правилу «после ВТОРОГО реального потребителя», но откладывается явно, не молчаливо, поскольку контексты вызова (env-переменные уже в scope vs читаются из `.env` заново, разные сообщения об ошибках) достаточно разные, чтобы преждевременная абстракция создала связанность без выгоды.
- **`vaps-restore-rehearsal` — третье, отдельное имя compose-проекта.** Сессия уже дважды пострадала от коллизии на generic-имени («deploy»). `vaps-install` (прод) ≠ `vaps-restore-rehearsal` (репетиция) — разные volume'ы, разные сети, восстановление НИКОГДА не может задеть прод-данные по построению (не по дисциплине оператора).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1302-1310] — буква стори.
- [Source: _bmad-output/planning-artifacts/architecture.md#L341, #L565, #L644] — «ночной pg_dump + файлы», целевой путь `restore-rehearsal.sh`, мотивация («бэкап, который не восстанавливали, не существует»).
- [Source: deploy/contour-stand/systemd/vaps-parallel-run-diff.{service,timer}, deploy/contour-stand/README.md] — доказанный systemd-timer-паттерн (Story 7.0), `Persistent=true` — прямой прецедент для AC-2.
- [Source: deploy/scripts/install.sh (Story 12.3)] — `COMPOSE_PROJECT`-пиннинг-паттерн, `pg_dump`/volume-tar-механика (независимо копируется, не импортируется).
- [Source: deploy/docker-compose.yml (Story 12.1/12.3)] — сервисы/volume'ы/`app`'s internal-healthcheck-механика (`127.0.0.1:8000`, уже разрешена ALLOWED_HOSTS'ом).
- [Source: apps/core/clock.py::catchup_plan] — приложенческий catch-up-прецедент (НЕ используется здесь — задокументировано различие в Dev Notes).

## Dev Agent Record

### Context Reference

- Собрано делегированным research-агентом при create-story: `deploy/contour-stand/systemd/vaps-parallel-run-diff.{service,timer}` целиком (systemd-паттерн, `Persistent=true`), `architecture.md`'s бэкап-упоминания (#L341/#L565/#L644), `catchup_plan`-прецедент (и почему он НЕ применим здесь), `deploy/docker-compose.yml`'s сервисы/volume'ы для restore-скрипта, отсутствие built alerting-инфраструктуры (structured logs — единственный существующий механизм, GlitchTip DEFERRED).

### Completion Notes

Реализовано по плану, 5 файлов в скоупе (граница лимита ≤5). `make gate` — 2853 passed, 0 failed, schema drift не обнаружен.

**Живой прогон (не продекларирован), полный цикл:**
1. Собран `vaps-app:dev`, поднят прод-подобный стек `docker compose -p vaps-install ... up -d --wait` — все 4 контейнера healthy.
2. `nightly-backup.sh` реально выполнен: `pg_dump` → реальный 114KB `postgres.sql` (3571 строк), volume-tar `private_storage.tar.gz`, `deploy/backups/latest` symlink указывает на свежий timestamped-каталог.
3. `restore-rehearsal.sh` реально выполнен: снос стейл-остатков (none) → подъём `postgres`+`redis` под ОТДЕЛЬНЫМ проектом `vaps-restore-rehearsal` → реальное `psql`-восстановление (полная схема — CREATE TABLE/INDEX/TRIGGER на ~80 таблиц, COPY данных, включая `COPY 172`-строчную и другие непустые таблицы) → восстановление файлового volume'а → `app` поднят НА восстановленных данных и стал healthy → smoke ИЗНУТРИ контейнера (`docker compose exec app python -c "urllib.request.urlopen(...)"`) — зелёный → `trap cleanup EXIT` автоматически снёс весь репетиционный стек (контейнеры + 4 volume'а + сеть), подтверждено `docker ps -a`/`docker volume ls` — ни единого `vaps-restore-rehearsal-*`-ресурса не осталось.
4. Прод-подобный стек (`vaps-install`) на всём протяжении репетиции НЕ ТРОНУТ — подтверждено `docker ps` (все 4 контейнера продолжали healthy) — доказывает изоляцию проектных имён работает по построению, не по дисциплине.
5. Финальная уборка — `docker compose -p vaps-install ... down -v` — тоже чисто, никаких посторонних docker-ресурсов не задето (явная проверка после урока этой сессии, дважды пострадавшей от коллизии на generic-имени «deploy»).

**Ревью (3 агента, cross-model, реальный прогон каждого).**

- **Blind Hunter** (diff-only) поднял несколько HIGH-гипотез, из которых бо́льшая часть ОПРОВЕРГНУТА либо моим же живым прогоном (см. выше), либо Edge Case Hunter'ом с прямым чтением файлов — в том числе главная HIGH: «`down -v` не подчистит `private_storage`, если тот не объявлен top-level volume'ом в compose» — ОПРОВЕРГНУТО: `private_storage` РЕАЛЬНО объявлен в `deploy/docker-compose.yml`'s `volumes:`-блоке, и мой собственный живой прогон УЖЕ показал реальный вывод `Volume vaps-restore-rehearsal_private_storage Removed` — гипотеза была проверяемой и не подтвердилась. Из оставшегося применены 2 реальных, дешёвых фикса:
  1. **Нет retention/pruning для `deploy/backups/`.** Под `Persistent=true` джоба крутится бессрочно без оператора — без ротации диск рано или поздно заполнится (и утащит за собой живые postgres/app-контейнеры). Исправлено: `nightly-backup.sh` хранит последние 14 бэкапов, старее — удаляет, ПОСЛЕ успешного обновления `latest` (не раньше). Дополнительно: `trap` удаляет НЕДОПИСАННЫЙ `OUT_DIR` при провале (частичный `postgres.sql` от упавшего на середине прогона больше не остаётся мусором навсегда).
  2. **`cleanup()`'s `|| true` полностью проглатывал провал снoса.** Неудачный `docker compose down -v` (сеть занята, etc.) оставлял бы репетиционный стек висеть БЕЗ единого следа для оператора. Исправлено: `WARNING`-строка на неудачный снос, `|| true` сохранён (по-прежнему не маскирует реальный exit-код репетиции).
  - Остальные HIGH/MED (TOCTOU-гонка между конкурентными прогонами, отсутствие `docker volume inspect`-проверки перед бэкапом, `.env`-парсинг не снимает кавычки) — рассмотрены и ОТКЛОНЕНЫ: единственный оператор, последовательные операции на закрытом контуре — конкурентность гипотетична; volume-конвенция уже используется идентично в `install.sh` (12.3) без проблем; `.env`-парсинг — тот же (не регрессировавший) паттерн, что уже принят 12.3, не новый для этой стори.
- **Edge Case Hunter** (полный доступ к проекту, живое чтение) подтвердил volume-именование корректно (сверено байт-в-байт с `docker-compose.yml`), опроверг «chicken-and-egg»-гипотезу restore-в-свежую-БД (plain `pg_dump`+`psql` в контейнер-инициализированную пустую БД — стандартный, безопасный паттерн), подтвердил `cleanup()`'s идемпотентность на первом прогоне (`down -v` на несуществующем проекте — no-op под `|| true`). Нашёл 1 реальную неточность в комментарии `vaps-backup.timer` (утверждение «02:15 vs 03:00 не конкурируют за БД» подразумевало ОБЩУЮ БД с `vaps-parallel-run-diff.timer`, 7.0 — но `contour-stand`'s `db`-сервис ОТДЕЛЬНАЯ Postgres-инсталляция, не та же БД) — исправлено: комментарий переписан, ложная предпосылка снята.
- **Acceptance Auditor**: реально прогнал структурные тесты (12 passed), `make gate` (2853 passed) — оба совпали с Completion Notes буква-в-букву. Явно НЕ прогнал живой backup/restore-цикл (по инструкции — избежать третьего docker-инцидента в этой сессии), чётко пометил это как неподтверждённое им лично, не притворился, что проверил. Нашёл 1 косметическую неточность: AC-1's текст в самой стори цитировал другой (устаревший черновой) `ExecStart`-путь, чем реальный файл — исправлено В ТЕКСТЕ AC (файл был верным с самого начала).

**Применённые review-патчи**: retention/pruning (14 последних бэкапов) + cleanup-failure-видимость + исправлен ложный комментарий про пересечение БД с 7.0's таймером + синхронизирован AC-1's текст с реальным путём `ExecStart`. `make gate` после патчей — 2853 passed, 0 failed.

2 decision (принять оба дешёвых MED-патча) · 0 defer · 1 dismiss-с-обоснованием (главная опровергнутая HIGH-гипотеза Blind Hunter'а + TOCTOU/volume-inspect/quoting — все объяснены выше).

### File List

- `deploy/scripts/nightly-backup.sh` (NEW) — pg_dump + volume-tar, `latest`-symlink; retention (14 бэкапов) + provал-cleanup (review-фиксы).
- `deploy/scripts/restore-rehearsal.sh` (NEW) — restore в изолированный стек + внутренний smoke + автоматический teardown (trap); видимый WARNING на неудачный снос (review-фикс).
- `deploy/systemd/vaps-backup.service` (NEW) — планировщик, зеркало 7.0's паттерна.
- `deploy/systemd/vaps-backup.timer` (NEW) — `Persistent=true` (catch-up, AC-2); комментарий исправлен (review-фикс, ложная предпосылка про общую БД с 7.0).
- `Backend/VAPS/apps/core/tests/test_backup_scripts.py` (NEW) — структурные regex-тесты обоих скриптов + systemd-юнитов.

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
| 2026-07-29 | dev-story: реализация (nightly-backup.sh/restore-rehearsal.sh/systemd-юниты) + полный живой прогон (pg_dump→restore→smoke изнутри контейнера, оба стека убраны чисто под правильными project-именами) + 3-агентное ревью опровергло главную HIGH-гипотезу живой уликой, применило 2 дешёвых MED-патча (retention/pruning + cleanup-failure-видимость) + исправило ложную предпосылку в комментарии таймера → done |
