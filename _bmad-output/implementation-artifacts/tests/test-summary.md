# Test Automation Summary — Story 3.12 (catch-up материализации эффектов)

**Дата:** 2026-07-09 · **Воркфлоу:** `bmad-qa-generate-e2e-tests` · **Модель:** claude-opus-4-8[1m]
**Baseline:** `9294d0a` + рабочее дерево 3.12 (status `review`)
**Фреймворк:** pytest 8 + pytest-django (существующий; ничего не добавлялось).
`factory_boy`/`freezegun` в проекте нет — данные сеются напрямую, время только через `clock.override()`.

## Область

У стори 3.12 **нет HTTP-поверхности и нет UI**: раннер — обычный вызываемый + management-команда
(AC-10: «раннер не поднимает `DomainError` — нет HTTP-поверхности»; AC-11: Celery/beat — предмет E12).
Поэтому «API-тесты» здесь = публичная поверхность модулей + точка входа `manage.py catchup_status_effects`,
а «E2E» = сквозной прогон раннера с **настоящим** `effects.py` (без monkeypatch) под реальным Postgres.

## Сгенерированные тесты (15 новых)

### `Backend/VAPS/apps/core/tests/test_watermark.py` (было 11 → стало 15)

- [x] `test_advisory_lock_is_refused_while_another_session_holds_it` — ветка `acquired=False` из **второй реальной сессии**
- [x] `test_lock_ids_differ_between_keys` — два watermark-ключа не сериализуются на одном локе
- [x] `test_watermark_module_never_reads_the_wall_clock` — AST-гвард (AC-1)
- [x] `test_watermark_keys_are_independent` — `advance_watermark` не тащит чужой ключ вперёд

### `Backend/VAPS/apps/operations/statuses/tests/test_catchup_materialization.py` (было 9 → стало 19)

- [x] `test_effect_seams_are_no_ops_until_e4_and_e5` — сеймы возвращают `None`
- [x] `test_materialize_day_effects_calls_both_seams` — проводка сейма (AC-9)
- [x] `test_effect_seams_touch_no_database` — ноль запросов (AC-9 «ничего не пишут»)
- [x] `test_real_run_writes_nothing_but_the_watermark` — **E2E**: настоящие эффекты; единственная запись — `core_watermarks` (ARCH-DATA-022 #L298)
- [x] `test_runner_reads_the_wall_clock_exactly_once` — AST-гвард на `tasks.py` (#L300)
- [x] `test_plan_exactly_at_the_cap_is_not_truncated_and_does_not_warn` — граница `len(plan) == CAP`
- [x] `test_capped_plan_drains_over_successive_runs_without_replaying_a_day` — чанкинг **дотекает** и не переигрывает день на стыке
- [x] `test_rival_session_holding_the_lock_makes_the_run_a_silent_noop` — AC-8 **внутри гейта**, без тредов
- [x] `test_advisory_lock_is_released_after_the_runner_raises` — лок не течёт после падения на дне K
- [x] `test_management_command_reports_the_days_left_after_a_capped_run` — `remaining=` в stdout

### `Backend/VAPS/apps/operations/tests/test_isolation.py` (было 2 → стало 3) — **tracked-файл, вне File List стори**

- [x] `test_statuses_does_not_import_sibling_contexts` — граница #L587 (`statuses` ↛ `submissions`/`audit`/`notifications`)

## Найденные пробелы (все закрыты)

| # | Пробел | Почему это дыра, а не педантизм |
|---|--------|--------------------------------|
| 1 | **`status="locked"` не покрыт гейтом** | AC-8 проверялся только тредовым тестом с маркером `concurrency`, который `make gate` **деселектит**. На каждом зелёном гейте ветка «лок занят» была непроверенной. Закрыто детерминированным тестом на второй сессии (`connections.create_connection`), без тредов. |
| 2 | **`effects.py` не исполнялся ни одним тестом (0/3 функций)** | Все тесты раннера monkeypatch'ат `tasks.materialize_day_effects`. Удаление вызова `emit_catchup_notifications` из сейма не роняло ничего. |
| 3 | **Раннер ни разу не прогонялся с настоящими эффектами** | Сквозного пути «раннер → реальный `effects.py` → БД» не существовало. Заодно закрыт запрет #L298: теперь проверяется, что единственная таблица, в которую пишет раннер, — `core_watermarks`. |
| 4 | **Граница капа `len(plan) == CAP`** | `remaining = max(0, len(plan) - CAP)`: при `>= CAP` вместо `> CAP` был бы ложный WARNING на каждом легитимном простое ровно в 400 дней. Только «500 дней» не различает эти реализации. |
| 5 | **Чанкинг не проверялся на «дотекание»** | AC-5 обещает «не hard-stop, догоняется следующим тиком» — второго запуска после капа не было ни в одном тесте, как и проверки, что день на стыке чанков не переигран. |
| 6 | **Лок мог утечь после падения раннера** | `test_failure_mid_plan...` делает второй запуск в **той же сессии**, а advisory-локи реентерабельны ⇒ утечка лока дала бы ложно-зелёный. Спрашивать надо у чужой сессии. |
| 7 | **«Дисциплина руками» без теста** | Стори сама пишет: AST-гвард `test_no_wall_clock_reads_in_domain_layers` не покрывает `tasks.py`/`watermark.py`. Два точечных AST-теста превращают дисциплину в гейт. |
| 8 | **Ключи watermark не изолированы** | `core_watermarks` — keyed store; `advance_watermark` через `.update()` без фильтра утащил бы все потоки вперёд. |
| 9 | **`statuses ↛ submissions` (AC-9, Task 3)** | Чекбокс Task 3 стоит, но теста нет — граница держалась только докстрокой в `amendment_hook.py`. |
| 10 | **`remaining=` в выводе команды** | Оператор в cron-логе не отличал усечённый прогон от полного. |

## Мутационная проверка (тесты обязаны падать)

Каждый новый тест проверен внесением дефекта в прод-код; прод-файлы восстановлены побайтово
(sha1 сверены), `grep` на остатки чист.

| Мутация | Тест | Результат |
|---------|------|-----------|
| M1 раннер игнорирует `acquired=False` | `..._rival_session_...silent_noop` | ✅ упал |
| M2 `advisory_lock` всегда отдаёт `True` | `..._refused_while_another_session_...` | ✅ упал |
| M3 безусловный `pg_advisory_unlock` в `finally` | `..._refused_while_another_session_...` | ⚠️ **сначала прошёл** → тест усилен (см. ниже) |
| M4 off-by-one в `remaining` | `..._exactly_at_the_cap_...` | ✅ упал |
| M5 выброшен вызов `emit_catchup_notifications` | `..._calls_both_seams` | ✅ упал |
| M6 лок никогда не отпускается | `..._released_after_the_runner_raises` | ✅ упал |
| M7 второй `Clock.today_local()` | `..._reads_the_wall_clock_exactly_once` | ✅ упал |
| M8a/M8b сейм пишет в БД | `..._touch_no_database` / `..._writes_nothing_but_the_watermark` | ✅ упали |
| M9 `advance_watermark` обновляет все ключи | `..._keys_are_independent` | ✅ упал |
| M10 капнутый прогон переигрывает день | `..._drains_over_successive_runs_...` | ✅ упал |
| M11 команда перестала печатать `remaining` | `..._reports_the_days_left_...` | ✅ упал |
| M12 `bootstrap` перетирает существующую строку | `..._is_idempotent_and_never_overwrites` (существующий) | ✅ упал |
| M13 `effects.py` импортирует `submissions` | `..._does_not_import_sibling_contexts` | ✅ упал |

**Находка M3.** Снятие guard'а `if acquired:` в `finally` **не наблюдаемо через состояние БД**: Postgres
отказывается отдавать лок, которым сессия не владеет (`WARNING: you don't own a lock of type ExclusiveLock`,
возврат `false`), так что чужой лок украсть нельзя в принципе. Первая версия теста была зелёной на этой мутации,
т.е. не защищала то, что декларирует комментарий в `watermark.py`. Тест переписан на утверждение о
**фактически отправленном SQL** (`CaptureQueriesContext`): при `acquired=False` `pg_advisory_unlock` не
эмитится вовсе. Мутация ловится.

## Покрытие

| Поверхность | Было | Стало |
|-------------|------|-------|
| `apps/core/watermark.py` — публичные функции | 5/5 | 5/5 (+ветка «лок занят», +AST-гвард wall clock) |
| `apps/operations/statuses/effects.py` — функции | **0/3** (только через monkeypatch) | **3/3** |
| `run_status_effects_catchup()` — статусы | 4/5 в гейте (`locked` только за маркером `concurrency`) | **5/5 в гейте** |
| `catchup_status_effects` — пути команды | 2/3 (`ok`, `halted`) | **3/3** (+`remaining` при капе) |
| Границы контекстов (ARCH-004 / #L587) | 1/2 (`operations ↛ core.models`) | **2/2** |
| AC стори | 11/11 (заявлено) | 11/11, из них 4 усилены (AC-1, AC-5, AC-8, AC-9) |

## Прогоны

- `make gate` (из `Backend/VAPS`): **1306 passed, 22 deselected, 25s** — зелёный.
  `ruff check .` чист; `makemigrations --check --dry-run` → «No changes detected».
  (baseline стори: 1291 passed ⇒ +15 тестов)
- `pytest -m concurrency` (гейт деселектит): **2 passed, 1326 deselected, 3.3s**
- Флейк-чек: три подряд прогона обоих файлов — `34 passed` каждый.
- Независимость: все 15 новых тестов прогнаны **поодиночке**, каждый зелёный ⇒ порядкозависимости нет.

## Валидация по `checklist.md`

- [x] API-тесты — N/A (нет HTTP-поверхности); эквивалент — management-команда, 3/3 пути
- [x] E2E-тесты — N/A (нет UI); эквивалент — сквозной прогон с настоящим `effects.py` под Postgres
- [x] Стандартные API фреймворка (pytest, pytest-django, `monkeypatch`, `caplog`, `CaptureQueriesContext`)
- [x] Happy path покрыт
- [x] Критические ошибки покрыты (`halted`, `locked`, падение внутри плана, откат watermark назад)
- [x] Все тесты зелёные
- [x] Локаторы — N/A (нет UI)
- [x] Внятные имена/описания тестов
- [x] Нет `sleep` и хардкод-ожиданий (новые тесты детерминированы; тредовый AC-8 использует `Event`+таймаут)
- [x] Тесты независимы (проверено поштучным прогоном)
- [x] Саммари создано, метрики покрытия внутри

## Next Steps

1. **Ревью 3.12 — другой моделью** (same-model caveat из Dev Agent Record остаётся в силе).
2. **Решение A (`pg_try_advisory_lock` vs `cache.add`)** по-прежнему кандидат на STOP-эскалацию:
   архитектура противоречива (#L299 vs #L469). Тесты фиксируют advisory-лок как реализованный контракт —
   если Bratan переопределит на `cache.add`, падут `..._refused_while_another_session_...`,
   `..._rival_session_...` и `..._released_after_the_runner_raises`.
3. **`test_isolation.py` изменён** — это tracked-файл вне File List стори 3.12. Либо принять расширение
   File List, либо вынести `test_statuses_does_not_import_sibling_contexts` отдельным `chore`-коммитом.
4. E12 (Celery/beat): когда появится `@shared_task`-обёртка, добавить тест регистрации beat-задачи
   (epics.md#L632) — сегодня сознательно не строился (AC-11).
5. E4/E5: при наполнении сеймов `test_effect_seams_touch_no_database` **обязан покраснеть** — это
   сигнал, а не регресс; заменить его на проверку реальных записей + дедуп-ключа
   `unique(сущность, business_date, версия сдачи)`.
