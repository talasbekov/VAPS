---
baseline_commit: 9a978b1 (HEAD, `feat(story-12.5)`). Чужие `.claude/settings.json` (M) и `_bmad-output/story-automator/**` (untracked) — вне скоупа.
baseline_tests: `cd Backend/VAPS && make gate` → 2491 passed, 56 deselected (финал 12.5). Известный флейк: разовые 2 teardown-ERROR (память проекта). Стори ДОБАВЛЯЕТ gate-тесты — итоговая цифра вырастет.
prerequisite: 12.1–12.5 done. Обе beat-ready команды существуют и идемпотентны (3.12 `materialize_status_effects`, 5.7b2 `check_lagging_submissions`: catch-up от watermark, advisory lock, свой `--today`-гвард). Прецедент планировщика = 12.4 (`deploy/systemd/vaps-backup.{service,timer}`, Persistent=true как БУКВАЛЬНАЯ catch-up семантика).
scope_note: |
  ЦЕНТРАЛЬНОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ (не открывать заново): Celery в проекте НЕТ — ARCH-DEFERRED-048,
  зафиксировано в 12.1 (deploy/docker-compose.yml:11-12: «worker/beat ОТСУТСТВУЮТ намеренно; периодические
  джобы — management-команды, планировщик регистрирует 12.6»). Докстринги 3.12/5.7b2 обещают
  «12.6 wraps in Celery @shared_task» — это УСТАРЕВШЕЕ обещание, 12.6 исполняет его systemd-таймером
  (прецедент 12.4) и правит докстринги. «Регистрация beat-задач» = systemd-юнит-пара vaps-beat;
  «smoke брокера» (architecture.md:639 test-full) реинтерпретируется: Celery-брокера нет, дымится
  ИСПОЛНЕНИЕ самих периодических задач на живой инфре (PG+redis harness) — call_command по списку,
  ИЗВЛЕЧЁННОМУ ИЗ РАСПИСАНИЯ (не хардкод). Redis-транспорт как таковой уже дымится WS-тестами E11.
context:
  - _bmad-output/planning-artifacts/epics.md#L1319-1325 (Story 12.6 AC: «Given beat-расписание со ссылкой на несуществующую задачу, Then gate красный»)
  - _bmad-output/planning-artifacts/architecture.md#L634 (обязательный сквозной тест «регистрация beat-задач»), #L638-639 (gate/test-full состав), #L646 (ночная джоба), NFR-5 (идемпотентные beat-задачи + catch-up от watermark)
  - deploy/docker-compose.yml:11-12 — контракт «планировщик регистрирует 12.6»
  - deploy/systemd/vaps-backup.{service,timer} — ПРЯМОЙ ОБРАЗЕЦ: заголовок-инструкция установки, Requires=docker.service, Environment=INSTALL_DIR, Persistent=true, ALERT-семантика failed unit
  - deploy/scripts/install.sh:7-15 — модель INSTALL_DIR (compose+`.env` лежат в корне install-каталога) → форма ExecStart
  - Backend/VAPS/apps/operations/statuses/management/commands/materialize_status_effects.py + apps/operations/submissions/management/commands/check_lagging_submissions.py — обе идемпотентны, безопасны на пустой БД (no-op + watermark), `--today` только для тестов
  - deploy/CHECKLIST.md A5/B3 + deploy/scripts/deploy-rehearsal.sh A5/B3 — пары ID «правки синхронно» (AC-7 стори 12.5)
  - Память проекта: красная проба с бэкапом до мутации; ARCH-SEC-030 (докстринги сканируются); лок-ассерты по таблицам; ruff format точечно
---

# Story 12.6: Регистрация beat-задач и smoke брокера

Status: done

## Story

As a **разработчик**,
I want **периодические management-команды зарегистрированными в планировщике контура (systemd-таймер, прецедент 12.4) + gate-тест «каждая задача из расписания существует и импортируется» + test-full smoke реального исполнения каждой задачи по списку из расписания**,
so that **переименованная/забытая задача не умирает молча в проде: расписание со ссылкой на несуществующую команду краснит gate, а исполнение задач доказано на живой инфре**.

## Acceptance Criteria

**AC-0 · ГРАНИЦА.** НЕ трогаем: Celery/AsyncJob НЕ вводится (ARCH-DEFERRED-045/048 остаются deferred); `docker-compose.yml`/nginx/bundle/install/smoke/backup-скрипты — ни строкой; сервисы `catch_up.py`/`lagging_check.py` — ни строкой (только докстринги КОМАНД); доставка алертов = 13.5; `parallel_run_diff` — dev-сторонняя ночная джоба (Makefile), контурного таймера НЕ получает; полная репетиция = 12.7. `frontend/**` — ни строкой.

1. **AC-1 · `deploy/systemd/vaps-beat.service` + `vaps-beat.timer` (NEW ×2) — регистрация.** Зеркало vaps-backup: заголовок-инструкция установки (cp, daemon-reload, enable --now, проверка list-timers, журнал journalctl), `Requires=docker.service`/`After=docker.service`, `Type=oneshot`, `Environment=INSTALL_DIR=/opt/vaps` (правится в одном месте). ExecStart из INSTALL_DIR через compose: обе задачи последовательно `materialize_status_effects` → `check_lagging_submissions` (`docker compose --env-file .env -f docker-compose.yml exec -T app python manage.py <cmd>`; `exec -T` — юнит без TTY). Провал любой = failed unit (алерт-семантика 12.4). Таймер: каждые 15 минут (`OnCalendar=*:00/15`; идемпотентность+advisory lock делают частый запуск безопасным, control-hour 17:00 накрывается с запасом ≤15 мин), `Persistent=true` (catch-up NFR-5, буквальная семантика 12.4), небольшой `RandomizedDelaySec`.
2. **AC-2 · Gate-тест регистрации (epic-буква) — `Backend/VAPS/apps/core/tests/test_beat_registration.py` (NEW).** Парсер юнитов (`deploy/systemd/*.service|*.timer` от корня репо через `Path(__file__)`, без хардкода абсолютных путей): извлекает из ExecStart все токены `manage.py <команда>`. Ассерты по ЖИВЫМ файлам:
   - каждая извлечённая команда существует в `django.core.management.get_commands()` И импортируется (`load_command_class` без исключения) — «существует и импортируется» БУКВАЛЬНО;
   - обе catch-up задачи (`materialize_status_effects`, `check_lagging_submissions`) присутствуют в расписании (анти-«тихо забыли зарегистрировать»);
   - каждый `.service`, зовущий manage.py, имеет парный `.timer`, и каждый `.timer` — парный `.service`;
   - каждый `.timer` несёт `Persistent=true` (catch-up семантика — тестируемый инвариант, включая vaps-backup).
   Парсер — функция уровня модуля (реюз в AC-3). Юнит-тест парсера на inline-фикстуре с несуществующей командой: ассерт-хелпер падает → эпик-AC «расписание с несуществующей задачей → gate красный» доказан и фикстурой, и красной пробой по живому (см. AC-5).
3. **AC-3 · test-full smoke исполнения — `Backend/VAPS/apps/core/tests/test_beat_smoke.py` (NEW, `@pytest.mark.slow`).** Для КАЖДОЙ manage.py-команды из живого расписания (список — через парсер AC-2, НЕ хардкод: новая задача в юните автоматически попадает в smoke): `call_command(cmd)` на живой PG проходит без исключения; после прогона watermark-строки обеих задач существуют (исполнение реально дошло до движка, не отвалилось на импорте). Маркер `slow` ⇒ deselected в gate, гоняется в test-full (architecture.md:639).
4. **AC-4 · Докстринги-обещания исправлены + чеклист-синхрон.** (а) В докстрингах/help ДВУХ команд фраза «12.6 wraps in Celery @shared_task…» заменяется фактом: «registered in the contour scheduler as a systemd timer (deploy/systemd/vaps-beat.*, Story 12.6); Celery is NOT used (ARCH-DEFERRED-048)». Сервисы/логику НЕ трогать. (б) `deploy/CHECKLIST.md` A5 + `deploy/scripts/deploy-rehearsal.sh` A5 (пара ID, «правки синхронно» — AC-7 стори 12.5): «юниты бэкапа И beat установлены: vaps-backup.* + vaps-beat.*»; строка состава носителя B3 юниты уже покрывает словом «юниты» — расширить перечисление в CHECKLIST B3-чекбоксах, если там юниты поимённо.
5. **AC-5 · Красные пробы (обязательны, бэкап до мутации).** (1) 🔴 в копии/временной правке `vaps-beat.service` имя команды искажается (`materialize_status_effectz`) → `make gate`-подмножество (тест регистрации) красное, откат правки → зелёное; (2) 🔴 `Persistent=true` временно убран из таймера → тест красный; (3) smoke на чистой БД: обе команды no-op'ятся чисто, watermark появляется; (4) юнит-фикстура парсера с bogus-командой падает с внятным сообщением (имя команды + файл юнита).
6. **AC-6 · Гейт зелёный.** `make gate` зелёный (2491+N passed), `bash -n` не требуется (шелл-скриптов нет), `makemigrations --check` пуст, ruff чист (формат — точечно по новым файлам). `make test-full` — прогон smoke-теста подтверждён (можно точечно: `pytest apps/core/tests/test_beat_smoke.py` под test-full-env). Sprint-status 12.6 обновляется по циклу.

## Tasks / Subtasks

- [x] Task 1 — vaps-beat.service + vaps-beat.timer по образцу 12.4 (AC: #1)
- [x] Task 2 — парсер юнитов + gate-тест регистрации (существует/импортируется/пары/Persistent/полнота) (AC: #2)
- [x] Task 3 — test-full smoke: call_command по списку из расписания + watermark-ассерт (AC: #3)
- [x] Task 4 — докстринги двух команд + CHECKLIST/rehearsal A5-пара синхронно (AC: #4)
- [x] Task 5 — красные пробы 1–4, вывод в Dev Agent Record (AC: #5)
- [x] Task 6 — гейт + точечный test-full + sprint-status (AC: #6)

## Dev Notes

- **INSTALL_DIR-модель:** compose-файл и `.env` лежат в корне install-каталога (install.sh:7-15) — ExecStart зовёт compose оттуда; `--env-file` обязателен (required-переменные `:?` в compose иначе валят exec).
- **Порядок задач в service:** статус-эффекты раньше lagging-проверки (уведомления об отставании поверх материализованных эффектов дня); `&&` — прецедент 12.4, провал первой не запускает вторую и краснит юнит.
- **Парсер путей:** тесты живут в `Backend/VAPS/apps/core/tests/` → корень репо = `parents[4]` от файла теста; ассертить существование `deploy/systemd` с внятным skip/fail-сообщением (worktree-safe: каталог в git, существует всегда).
- **Smoke и on_commit:** под `django_db` on_commit-эмиссии не выполняются (память проекта) — smoke ассертит ИСПОЛНЕНИЕ команд и watermark, НЕ доставку уведомлений (доставка = WS-тесты E11).
- **`check_lagging_submissions` на пустой БД:** control-настроек/подразделений нет → чистый no-op, watermark создаётся; `materialize_status_effects` — реестр материализаторов пуст (seam 3.12), двигает watermark. Обе безопасны без сидов.
- **ARCH-SEC-030:** в докстрингах/комментариях юнитов не поминать чувствительные литералы (X-User-Id и пр.).
- **Отклонение от «≤5 файлов»:** нон-тест файлов 6, из них 3 — однострочные текст-правки (докстринги ×2, CHECKLIST/rehearsal-пара считается за 2). Дальнейший сплит дал бы стори «поправить один докстринг» — осознанно не дробим (прецедент 6.4).

## Files To Create

- `deploy/systemd/vaps-beat.service`
- `deploy/systemd/vaps-beat.timer`
- `Backend/VAPS/apps/core/tests/test_beat_registration.py`
- `Backend/VAPS/apps/core/tests/test_beat_smoke.py`

## Files To Modify

- `Backend/VAPS/apps/operations/statuses/management/commands/materialize_status_effects.py` (докстринг/help)
- `Backend/VAPS/apps/operations/submissions/management/commands/check_lagging_submissions.py` (докстринг/help)
- `deploy/CHECKLIST.md` (A5, B3-перечисление)
- `deploy/scripts/deploy-rehearsal.sh` (A5-текст, синхронно с CHECKLIST)

## Dependencies

- Depends on: 12.1 (compose-топология, контракт «регистрирует 12.6»), 12.4 (прецедент systemd-юнитов), 3.12/5.7b2 (beat-ready команды), 12.5 (CHECKLIST/rehearsal ID-пары)
- Blocks: 12.7 (полная репетиция включает установленные таймеры), 12.8

## Dev Agent Record

### Agent Model Used

claude-fable-5 (⚠️ same-model: спека+dev+ревью одной сессией).

### Debug Log References

- **Первый прогон новых тестов (живой харнес db+redis):** 7 passed за 1.4s (5 gate-регистрация + 2 smoke, включая watermark-ассерт по ключам `status_effects`/`lagging_submissions` на чистой test-БД = проба 3).
- **Проба 1 (🔴 bogus-команда в живом vaps-beat.service, `materialize_status_effectz`):** 2 failed — `test_every_scheduled_command_exists_and_imports` (сообщение несёт имя юнита и команды) И `test_required_beat_commands_are_scheduled`; откат из бэкапа → зелёное. Эпик-AC «расписание с несуществующей задачей → gate красный» доказан по живому.
- **Проба 2 (🔴 `Persistent=true` удалён из vaps-beat.timer):** `test_every_timer_is_persistent` красный с именем таймера; откат → зелёное. Оба юнита восстановлены побайтно (diff с бэкапом пуст).
- **Проба 4:** `test_parser_rejects_unknown_command_fixture` — inline-фикстура с bogus-командой, ассерт сообщения (имя команды + fixture.service) + гвард на вакуум (else-ветка).
- **Гейт:** первый прогон — 3×E501 в новом тесте (правка переносами, формат точечно); перегон: **2496 passed / 58 deselected (85s)**, «No changes detected» (makemigrations пуст). Дельта к baseline 2491/56 = +5 gate-тестов, +2 slow-smoke в deselected — smoke прогнан живьём отдельно (см. выше), test-full-критерий закрыт точечно (AC-6 это допускает).

### Completion Notes List

1. Центральное решение исполнено как в спеке: Celery НЕ введён (ARCH-DEFERRED-048), «beat» = systemd-пара `vaps-beat.{service,timer}` по образцу 12.4 (Requires=docker.service, INSTALL_DIR в одном месте, `exec -T`, `&&`-цепочка → failed unit как алерт, Persistent=true, OnCalendar=*:00/15, RandomizedDelaySec=60).
2. Список задач для smoke НЕ хардкодится: test_beat_smoke импортирует парсер из test_beat_registration и читает живые юниты — новая задача, добавленная в ExecStart, автоматически попадает и в gate-гвард, и в smoke.
3. Гвард полноты (`REQUIRED_BEAT_COMMANDS`) — анти-«тихо забыли»: удаление задачи из расписания краснит gate, не только опечатка в имени.
4. `test_every_timer_is_persistent` покрывает И vaps-backup.timer (catch-up семантика NFR-5 стала тестируемым инвариантом всех таймеров, не только нового).
5. Докстринги/help обеих команд перестали обещать Celery-обёртку; сервисы/логика не тронуты (AC-0). CHECKLIST A5 ↔ deploy-rehearsal.sh A5 правлены синхронной парой (ID-контракт 12.5); B3 не тронут — юниты там собирательным словом.
6. Smoke ассертит исполнение+watermark, НЕ доставку уведомлений (on_commit под django_db — вакуум, память проекта); redis-транспорт дымится WS-тестами E11.

### File List

- `deploy/systemd/vaps-beat.service` (NEW)
- `deploy/systemd/vaps-beat.timer` (NEW)
- `Backend/VAPS/apps/core/tests/test_beat_registration.py` (NEW)
- `Backend/VAPS/apps/core/tests/test_beat_smoke.py` (NEW)
- `Backend/VAPS/apps/operations/statuses/management/commands/materialize_status_effects.py` (M — докстринг/help)
- `Backend/VAPS/apps/operations/submissions/management/commands/check_lagging_submissions.py` (M — докстринг/help)
- `deploy/CHECKLIST.md` (M — A5)
- `deploy/scripts/deploy-rehearsal.sh` (M — A5, синхронно)
- `_bmad-output/implementation-artifacts/12-6-регистрация-beat-задач-и-smoke-брокера.md` (NEW — стори-файл)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M)

## Senior Developer Review (AI)

**Дата:** 2026-07-20 · **Ревьюер:** bmad-story-automator-review (claude-fable-5, ⚠️ same-model) · **Вердикт:** Approve → done

**Git↔File List:** сходится полностью; чужие `.claude/settings.json` (M) и `_bmad-output/story-automator/**` (untracked) — вне скоупа по фронтматтеру, не тронуты.

**AC-аудит:** AC-0…AC-6 — IMPLEMENTED (граница чиста: compose/nginx/bundle/install/smoke/backup-скрипты и сервисы catch_up/lagging_check не тронуты git-фактически; юнит-пара зеркалит 12.4; 5 gate-тестов + 2 slow-smoke; докстринги/help без Celery-обещаний; CHECKLIST A5 ↔ rehearsal A5 синхронно). Задачи [x] сверены с кодом — инфляции нет; красные пробы 1–4 в Dev Record воспроизводимо описаны.

**Находки:** 0 CRITICAL/HIGH · 1 MEDIUM patch · 1 LOW patch · 1 dismiss.
1. **MEDIUM (patch):** парсер ловил только `ExecStart=` — задача в `ExecStartPre=`/`ExecStartPost=` прошла бы мимо гварда молча. Расширен до префикса `ExecStart`; фикстурный тест переведён на `ExecStartPre` (доказывает расширение).
2. **LOW (patch):** неиспользуемая переменная цикла `unit_name` в обоих smoke-тестах → итерация по `.values()`.
3. **DISMISS (осознанно):** `exec -T` vs `run --rm` (форма install.sh:327 для migrate): периодика обязана идти в живой app — `restart: unless-stopped` поднимает стек на буте, лишний контейнер каждые 15 мин на 4ГБ-машине вреден, остановленный стек = честный failed unit. Обоснование дописано в комментарий юнита.

**Гейт после патчей:** 2496 passed / 58 deselected (77s), makemigrations пуст; живой smoke точечно: 2 passed. graphify update не требуется (app-код — только докстринги).
