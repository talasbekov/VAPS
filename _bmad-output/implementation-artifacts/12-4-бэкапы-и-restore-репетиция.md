---
baseline_commit: 3ebce31
---

# Story 12.4: Бэкапы и restore-репетиция

Status: ready-for-dev

## Story

As a **админ контура**,
I want **ночной pg_dump + бэкап `private_storage`-volume'а, плюс `restore-rehearsal.sh`, реально восстанавливающий свежий бэкап в чистый параллельный стек и проверяющий его smoke'ом**,
so that **«бэкап, который не восстанавливали, не существует» (architecture.md#L644) — доказанная восстановимость, не предположение**.

## Acceptance Criteria

Источник: `epics.md#L1302-1310` (буква стори) + `architecture.md#L565` (целевой путь `deploy/scripts/restore-rehearsal.sh`) + `architecture.md#L341` («ночной pg_dump + файлы; репетиция восстановления — чеклист релиза») + `architecture.md#L644` (мотивация — восстановимость должна быть ДОКАЗАНА, не предположена).

Скоуп — 5 файлов (граница CLAUDE.md's лимита, одна ответственность — «бэкап доказанно восстановим»): `deploy/scripts/nightly-backup.sh` (NEW), `deploy/scripts/restore-rehearsal.sh` (NEW), `deploy/systemd/vaps-backup.service`+`.timer` (NEW, планировщик — та же механика, что уже проверена 7.0's `vaps-parallel-run-diff.{service,timer}`), структурный тест (regex-стиль, зеркало 12.2/12.3).

1. **AC-1 (ночной pg_dump + volume-бэкап, планировщик — systemd timer, не Celery beat).** Celery не установлен нигде в проекте (12.1's Dockerfile/12.3's install.sh это уже подтвердили; worker/beat явно отложены на 12.6). Планировщик — та же механика, что уже проверена и заведена Story 7.0 для `parallel-run-diff`: `deploy/systemd/vaps-backup.service` (`Type=oneshot`, `ExecStart=/usr/bin/deploy/scripts/nightly-backup.sh`) + `vaps-backup.timer` (`OnCalendar=*-*-* 03:00:00`, **`Persistent=true`**).
2. **AC-2 (catch-up семантика — systemd's собственный механизм, не приложенческий watermark).** `Persistent=true` в `.timer` — ДОКУМЕНТИРОВАННОЕ ЯДРО systemd: пропущенный (сервер был выключен) запуск исполняется при ближайшей доступности автоматически, без кастомного кода. **Скоуп-решение**: НЕ переиспользуется `apps.core.clock.catchup_plan` (тот — приложенческий, per-day watermark-replay для ДАННЫХ, применяется в 3.12/5.7b2/6.9; ночной pg_dump — не «за пропущенные дни», а «сделать бэкап СЕЙЧАС, раз пропустили окно» — систем-уровневая, не бизнес-семантика; 7.0 уже установила этот прецедент для инфраструктурных джоб).
3. **AC-3 (`nightly-backup.sh` — pg_dump + volume-tar, с меткой времени + стабильный указатель `latest`).** Тот же механизм, что `install.sh`'s inline-бэкап (12.3: `pg_dump` через `docker compose exec`, `docker run --rm -v ...:/data ... tar czf`), но САМОСТОЯТЕЛЬНО, не переиспользует install.sh's код (12.3's Dev Notes явно называет свой бэкап «inline safety-net этой стори», не общей библиотекой) — независимая копия механики, задокументированное намеренное НЕ-обобщение (обобщать после ВТОРОГО реального потребителя — сейчас их два: 12.3 и 12.4, но оба уже написаны с разным контекстом вызова, рефакторинг в общую либу — не в скоупе этой стори). `docker compose exec`/`docker run` используют ТОТ ЖЕ `COMPOSE_PROJECT="vaps-install"`, что `install.sh` — реальный прод-стек на целевой машине ВСЕГДА поднят под этим именем (12.3's install.sh — единственный способ его поднять). После каждого успешного бэкапа — `deploy/backups/latest` (symlink) указывает на свежий timestamped-каталог, тот же приём, что `.last-bundle-sha`/`.installed-sha` (12.2/12.3).
4. **AC-4 (`restore-rehearsal.sh` — реальное восстановление в ЧИСТЫЙ параллельный стек, не в прод).** Отдельный `docker compose`-проект `vaps-restore-rehearsal` (НЕ `vaps-install` — восстановление в ЖИВОЙ прод-стек стёрло бы прод-данные; НЕ `deploy` — коллизионный generic-неймспейс, уже дважды ударивший эту сессию). Поднимает ТОЛЬКО `postgres`+`redis`+`app` (БЕЗ `nginx` — избегает коллизии порта `80:80` с реально работающим прод-стеком на той же машине) из `deploy/backups/latest`. Восстанавливает `postgres.sql` через `psql`, `private_storage.tar.gz` через `docker run --rm -v ...`. Smoke — ВНУТРИ контейнера `app` (`docker compose exec app`, бьёт `127.0.0.1:8000` напрямую — та же механика, что уже использует 12.1's собственный app-healthcheck; ALLOWED_HOSTS уже разрешает `127.0.0.1` для ровно этого внутреннего сценария, 12.3's review-фикс) — не через `smoke.sh`/nginx (тот требует publish порта 80, коллизирующего с прод; полная nginx-цепочка уже покрыта 12.3's `install.sh`, здесь цель — доказать ВОССТАНОВИМОСТЬ ДАННЫХ + запускаемость приложения НА НИХ, не переповторить весь nginx-routing-тест).
5. **AC-5 (провал → алерт = громкий exit + структурный лог, не email/webhook — их нет).** `architecture.md#L339`'s собственный список: structured JSON logs — единственный built alerting-механизм проекта, error tracking (GlitchTip) явно DEFERRED. `nightly-backup.sh`/`restore-rehearsal.sh` — `set -euo pipefail`, `exit 1` + понятное сообщение на любом провале шага (systemd's `journalctl -u vaps-backup.service`/`systemctl status` — видимый провал для админа, тот же паттерн, что 7.0 уже приняла для `parallel-run-diff`). Реальный email/webhook — вне скоупа (не построен нигде в проекте, задокументированный DEFERRED, не молчаливый пропуск).
6. **AC-6 (реальный прогон + регресс нулевой).** Дев-агент ОБЯЗАН реально: поднять прод-подобный стек (`vaps-install`), сделать `nightly-backup.sh`, поднять `vaps-restore-rehearsal` с ДРУГИМ проектным именем, восстановить, смок ИЗНУТРИ контейнера зелёный, убрать оба стека под правильными именами (никаких посторонних docker-ресурсов — урок этой сессии, дважды повторённый). `make gate` зелёный.

## Tasks / Subtasks

- [ ] Task 1 — `deploy/scripts/nightly-backup.sh` (NEW) (AC: 1, 3)
  - [ ] `set -euo pipefail`, `COMPOSE_PROJECT="vaps-install"` (тот же, что `install.sh`).
  - [ ] `pg_dump` через `docker compose exec -T postgres`, `docker run --rm -v vaps-install_private_storage:/data ... tar czf` для volume'а — в `deploy/backups/<timestamp>/`.
  - [ ] `deploy/backups/latest` symlink обновляется ПОСЛЕ успешного завершения обоих шагов (не раньше — недописанный бэкап не должен стать «latest»).
- [ ] Task 2 — `deploy/systemd/vaps-backup.service`+`.timer` (NEW) (AC: 1, 2)
  - [ ] Зеркало `deploy/contour-stand/systemd/vaps-parallel-run-diff.{service,timer}` — `Type=oneshot`, `OnCalendar=*-*-* 03:00:00`, `Persistent=true`.
- [ ] Task 3 — `deploy/scripts/restore-rehearsal.sh` (NEW) (AC: 4, 5)
  - [ ] `COMPOSE_PROJECT="vaps-restore-rehearsal"` — явно ОТДЕЛЬНЫЙ от `vaps-install`.
  - [ ] Снос стейл-остатков предыдущей неудачной репетиции (`down -v`) ПЕРЕД стартом.
  - [ ] `docker compose ... up -d --wait postgres redis app` (БЕЗ nginx — избегает коллизии порта).
  - [ ] Восстановление `postgres.sql` (`psql`) + `private_storage.tar.gz` (`docker run --rm -v ...`) из `deploy/backups/latest`.
  - [ ] Смок ИЗНУТРИ `app`-контейнера (`docker compose exec app python -c "urllib.request.urlopen('http://127.0.0.1:8000/api/parallel-run/health/')"` — та же механика, что 12.1's app-healthcheck).
  - [ ] Снос стека (`down -v`) ПОСЛЕ, успешно или нет — не оставлять репетиционный стек висеть.
- [ ] Task 4 — Структурный тест (`Backend/VAPS/apps/core/tests/test_backup_scripts.py`, NEW) (AC: 1-6)
  - [ ] Зеркало `test_bundle_script.py`/`test_install_and_smoke_scripts.py`: `set -euo pipefail`, оба `COMPOSE_PROJECT`-значения РАЗЛИЧНЫ и НЕ `deploy`, `-p` присутствует на каждом `docker compose`-вызове, systemd-юниты содержат `Persistent=true`/`OnCalendar`, `latest`-symlink обновляется ПОСЛЕ успешных шагов.
- [ ] Task 5 — Реальный прогон (AC: 6)
  - [ ] Прод-подобный стек (`vaps-install`) реально поднят, `nightly-backup.sh` реально собрал бэкап.
  - [ ] `restore-rehearsal.sh` реально восстановил в `vaps-restore-rehearsal`, смок зелёный.
  - [ ] Оба стека убраны, `docker volume ls`/`docker ps -a` чистые (без посторонних ресурсов).
  - [ ] `make gate` — зелёный.

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

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story) |
