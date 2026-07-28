---
baseline_commit: 2b5bd4e
---

# Story 7.10: План cutover и отката

Status: done

## Story

As a разработчик,
I want план дня X (переключение ввода на VAPS, Excel-парашют, условия и процедура отката на донора < X минут),
so that переключение — рунбук, не импровизация.

## Acceptance Criteria

1. **Given** условия exit criterion выполнены, **Then** cutover по рунбуку; откат отрепетирован и уложился в норматив.
2. **And** cutover включает обязательный шаг «инкремент-импорт ОТКЛЮЧЁН»; запуск импорта после cutover невозможен без явного флага `--force-pre-cutover` + подтверждения (тест: ночная джоба после cutover не затирает ручной ввод).
3. **And** с cutover официальный канал расхода = VAPS (до этого — прежний канал, VAPS теневой).

## Tasks / Subtasks

- [x] Task 1 — Рунбук как код: `execute_cutover` (AC: 1, 3)
  - [x] `ParallelRunModeSwitch` (Story 7.7/7.8) расширяется полем `cutover_completed_at` (nullable DateTimeField) — отличает "режим никогда не запускался" / "идёт parallel-run" / "cutover завершён" (3 разных состояния, не 2)
  - [x] `apps.core.parallel_run_mode.is_cutover_complete()` / `mark_cutover_complete(*, actor)` (гейтится exit criterion в вызывающем коде, не здесь — та же граница ответственности, что `enable()`/`disable()`) / `rollback_cutover(*, actor, deadline)` (re-enable + очистка `cutover_completed_at`)
  - [x] `apps.parallel_run.cutover.execute_cutover(*, actor, frozen_suite_green)` — переиспользует `apps.parallel_run.exit_criterion.evaluate()` (7.8); отказывает (`ValueError`), если критерий не выполнен — "по рунбуку", не "по желанию оператора"
  - [x] `apps.parallel_run.management.commands.execute_cutover` — CLI: `--actor --frozen-suite-green`
- [x] Task 2 — Откат: `rollback_cutover` (AC: 1)
  - [x] `apps.parallel_run.cutover.rollback(*, actor, deadline)` — ОДНА команда, не многошаговая импровизация; "< норматив" — операционное свойство человека/процесса, код доказывает только механическую часть: одна команда, доли секунды
  - [x] `apps.parallel_run.management.commands.rollback_cutover` — CLI: `--actor --deadline`
- [x] Task 3 — Гейт инкремента после cutover уже существует (AC: 2, форвард-совместимость 7.7)
  - [x] `nightly_increment` уже отказывается бежать при выключенном режиме без `--force-pre-cutover` (Story 7.7) — верифицируется этой стори (не переписывается), явный тест на связь именно с `is_cutover_complete()`-состоянием, не только с "режим выключен вообще"
- [x] Task 4 — Видимость официального канала (AC: 3)
  - [x] `stand_health` — `cutover_completed` (bool) в блоке `parallel_run_mode`
- [x] Task 5 — Реестры (AC: 1, 3)
  - [x] `docs/registries/audit-events.yaml` — `PARALLEL_RUN_CUTOVER_COMPLETED`, `PARALLEL_RUN_CUTOVER_ROLLED_BACK`
- [x] Task 6 — Тесты (AC: 1, 2, 3)
  - [x] `execute_cutover` отказывает, если exit criterion не выполнен (streak<10 ИЛИ frozen_suite_green=False)
  - [x] `execute_cutover` при выполненном критерии: `is_cutover_complete()==True`, `is_enabled()==False`, audit-запись
  - [x] `rollback` возвращает `is_cutover_complete()==False`, `is_enabled()==True`, требует новый `deadline`; выполняется за миллисекунды (доказательство "одна команда", не норматив по времени человека)
  - [x] `nightly_increment` после `execute_cutover` отказывается бежать без `--force-pre-cutover` (расширяет существующий 7.7-тест явной связью с cutover-состоянием)
  - [x] `stand_health` отражает `cutover_completed`

## Dev Notes

- AC-2's «инкремент-импорт ОТКЛЮЧЁН... без --force-pre-cutover» УЖЕ реализован форвард-совместимо в Story 7.7 (`apps/parallel_run/management/commands/nightly_increment.py`, докстринг explicitly ссылается на 7.10) — не переписывается, только верифицируется явным тестом, привязанным к cutover-терминологии, а не общей формулировке "режим выключен".
- «подтверждения» (AC-2) — сам факт явного `--force-pre-cutover` флага (opt-in действие оператора) И ЕСТЬ подтверждение; отдельного prompt/второго флага не вводится — тот же паттерн, что explicit `--frozen-suite-green` флаг в 7.8's дашборде (флаг = подтверждение, не декоративный toggle).
- "< норматив" по времени отката — операционное/человеческое свойство (рунбук репетируют люди), код может доказать только механическую часть: откат — ОДНА команда (не последовательность ручных шагов), выполняющаяся за миллисекунды. Тест на длительность — доказательство "нет импровизации в коде", не SLA-таймер.
- `ParallelRunModeSwitch.cutover_completed_at` — третье состояние (никогда не запускался / идёт parallel-run / cutover завершён), явно отличное от обычного `disable()` (оператор может выключить режим НЕ по cutover-причине — например, откатить пилот без формального cutover). `execute_cutover`/`rollback` — специализированные мутаторы поверх тех же `enable()`/`disable()`, не дублирование логики.
- Официальный канал = VAPS (AC-3) — это буквально `is_cutover_complete()==True`; ДО cutover — донор канал, VAPS теневой (уже сформулировано докстрингом `parallel_run_mode.disable()` из 7.7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7, Story 7.10]
- [Source: Backend/VAPS/apps/parallel_run/management/commands/nightly_increment.py] (Story 7.7, `--force-pre-cutover`, форвард-совместимость)
- [Source: Backend/VAPS/apps/parallel_run/exit_criterion.py] (Story 7.8, `evaluate()`)
- [Source: Backend/VAPS/apps/parallel_run/management/commands/parallel_run_dashboard.py] (Story 7.8, паттерн `--frozen-suite-green` = подтверждение)
- [Source: Backend/VAPS/apps/core/parallel_run_mode.py] (Story 7.7, `enable`/`disable`)

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- `ParallelRunModeSwitch.cutover_completed_at` — третье, явно отличное от `enabled`, состояние (никогда не запускался / идёт parallel-run / cutover завершён). `execute_cutover()` (`apps.parallel_run.cutover`) переиспользует `exit_criterion.evaluate()` (7.8) буквально — не переоценивает критерий своей копией.
- 3-слойное ревью (Blind Hunter / Edge Case Hunter / Acceptance Auditor) нашло 2 реальных бага, оба исправлены:
  1. **Blind Hunter + Edge Case Hunter (независимо нашли одно и то же, High)**: прямой повторный `enable()` после `mark_cutover_complete()` (в обход `rollback_cutover()`) оставлял `enabled=True` И `cutover_completed_at` не-`None` одновременно — противоречивое 4-е состояние, которого третье cutover-состояние по дизайну не должно допускать. Исправлено: `enable()` теперь явно очищает `cutover_completed_at` в своём `defaults`; тест `test_reenable_after_cutover_clears_stale_cutover_flag`.
  2. **Edge Case Hunter (High)**: `rollback_cutover()` не проверял, что cutover вообще был завершён — "откат" события, которого не было, писал ложную audit-запись `PARALLEL_RUN_CUTOVER_ROLLED_BACK` (footgun: оператор, хотевший просто продлить дедлайн активного parallel-run, случайно фабрикует несуществующий откат в audit trail). Исправлено: `rollback_cutover()` отказывает (`ValueError`), если `is_cutover_complete()==False`; тесты `test_rollback_cutover_rejected_when_cutover_never_completed` (gateway) и `test_rejects_rollback_when_cutover_never_completed` (CLI).
- Оба ревьюера независимо подтвердили: AC-2's `--force-pre-cutover` гейт уже существовал с 7.7 (не переписан, только верифицирован новым тестом, привязанным к РЕАЛЬНОМУ `execute_cutover()`-состоянию, не голому `disable()`); "< норматив" по времени отката трактуется как код доказывает механическую часть (одна команда, доли секунды), не человеческий SLA-таймер — обе интерпретации признаны защитимыми, не заметаемыми под ковёр пробелами.
- Полный регресс: `apps/parallel_run/`+`apps/core/tests/test_parallel_run_mode.py`+`apps/operations/submissions/tests/test_day_submission_parallel_run_gate.py` (90 passed); `apps/core/`+`apps/operations/`+`apps/audit/`+`apps/migration_legacy/` (2325 passed, 3 pre-existing concurrency-teardown ERROR — задокументированы в памяти, не регрессия).

### File List

- `Backend/VAPS/apps/core/models.py` (modified — `ParallelRunModeSwitch.cutover_completed_at`)
- `Backend/VAPS/apps/core/migrations/0020_parallel_run_mode_switch_cutover_completed_at.py` (new)
- `Backend/VAPS/apps/core/parallel_run_mode.py` (modified — `is_cutover_complete`, `mark_cutover_complete`, `rollback_cutover`; `enable()` очищает stale cutover-флаг)
- `Backend/VAPS/apps/core/tests/test_parallel_run_mode.py` (modified)
- `Backend/VAPS/apps/parallel_run/cutover.py` (new — `execute_cutover`, `rollback`)
- `Backend/VAPS/apps/parallel_run/tests/test_cutover.py` (new)
- `Backend/VAPS/apps/parallel_run/management/commands/execute_cutover.py` (new)
- `Backend/VAPS/apps/parallel_run/management/commands/rollback_cutover.py` (new)
- `Backend/VAPS/apps/parallel_run/tests/test_cutover_commands.py` (new)
- `Backend/VAPS/apps/parallel_run/tests/test_nightly_increment.py` (modified — cutover-state тест)
- `Backend/VAPS/apps/parallel_run/api/views.py` (modified — `cutover_completed` в health)
- `Backend/VAPS/apps/parallel_run/tests/test_stand_health.py` (modified)
- `docs/registries/audit-events.yaml` (modified — `PARALLEL_RUN_CUTOVER_COMPLETED`, `PARALLEL_RUN_CUTOVER_ROLLED_BACK`)
