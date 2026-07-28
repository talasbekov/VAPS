---
baseline_commit: b75e0fa
---

# Story 7.8: Формализация parallel-run

Status: done

## Story

As a разработчик,
I want exit criterion в конфиге (10 рабочих дней без unclassified + frozen-suite зелёный), дедлайн до старта, дашборд зелёных дней,
so that parallel-run — мост с краями, не болото.

## Acceptance Criteria

1. **Given** старт режима, **Then** дедлайн записан; отчёт зелёных дней доступен; превышение дедлайна = эскалация-решение (продлить осознанно/откатиться), не молчание.

## Tasks / Subtasks

- [x] Task 1 — Exit criterion в конфиге (AC: 1)
  - [x] `apps.parallel_run.exit_criterion` — `EXIT_CRITERION_GREEN_DAYS = 10` (константа модуля, "в конфиге" — не хардкод внутри функции)
  - [x] `green_streak()` — уже существующая функция `apps.parallel_run.services.parallel_run_diff` (Story 6.9, "the numeric basis for the 7.8 exit criterion" — буквально написано в её докстринге), экспортирована публично (была `_green_streak`, использовалась только внутри модуля) — переиспользуется, не переписывается
  - [x] `frozen-suite зелёный` — внешний вход (флаг команды/дашборда), не автодетект из pytest-состояния (честная граница — нет канонического хука на "статус последнего прогона suite" без похода в CI-артефакты, которых у этой команды нет)
- [x] Task 2 — Дедлайн до старта (AC: 1)
  - [x] `ParallelRunModeSwitch` (Story 7.7) расширяется полем `deadline` (DateField, nullable на уровне схемы для обратной совместимости с уже примененной 7.7-миграцией, но ОБЯЗАТЕЛЬНЫЙ параметр на уровне `enable()` — "дедлайн до старта" буквально требует записи в момент включения)
  - [x] `parallel_run_mode.enable(*, actor, deadline)` — `deadline` теперь required kwarg; существующие вызовы (7.7 CLI, тесты) обновляются
- [x] Task 3 — Дашборд зелёных дней (AC: 1)
  - [x] `apps.parallel_run.management.commands.parallel_run_dashboard` — печатает: текущий `green_streak()`, exit criterion (streak >= 10 AND --frozen-suite-green), дедлайн + дней до/после дедлайна
  - [x] Превышение дедлайна БЕЗ выполненного exit criterion → явная ЭСКАЛАЦИЯ в выводе (не молчание) — `CommandError` (ненулевой exit), тот же паттерн, что 7.5's `verify_migration_convergence` (разовый acceptance-подобный сигнал, не background-мониторинг)
- [x] Task 4 — Видимость (AC: 1)
  - [x] `stand_health` (7.0/7.7) расширяется полями `green_streak`, `deadline`, `exit_criterion_met` внутри существующего `parallel_run_mode` блока
- [x] Task 5 — Тесты (AC: 1)
  - [x] Дедлайн обязателен при `enable()` — отсутствие валится
  - [x] Дашборд: streak < 10 → не готово, без эскалации если дедлайн не превышен
  - [x] Дашборд: дедлайн превышен И критерий не выполнен → эскалация (CommandError)
  - [x] Дашборд: критерий выполнен (streak>=10 + frozen-suite-green) → зелёный вердикт, даже если дедлайн уже прошёл (не "молчание", но и не ложная тревога — критерий устраивает без досрочной эскалации)
  - [x] health отражает streak/deadline/exit_criterion_met

## Dev Notes

- `green_streak()` (было `_green_streak`, Story 6.9) — САМЫЙ прямой переиспользуемый кусок: докстринг функции уже ссылается на 7.8 как на потребителя ("the numeric basis for the 7.8 exit criterion") — это была спланированная точка расширения, не совпадение.
- Расширение `ParallelRunModeSwitch.enable()` required-параметром `deadline` — БЕЗ ЭТОГО стори 7.8's AC-1 буквально не выполним ("дедлайн ДО СТАРТА" требует записи В МОМЕНТ включения, не постфактум отдельной командой).
- "frozen-suite зелёный" — честная граница: нет автоматического хука на результат тестового прогона без похода в CI-инфраструктуру (нет доступа к CI extraction в этом репозитории/агенте) — передаётся явным флагом, оператор подтверждает вручную по факту последнего `make test-full`/CI прогона.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7, Story 7.8]
- [Source: Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py] (green_streak, докстринг ссылается на 7.8)
- [Source: Backend/VAPS/apps/core/parallel_run_mode.py] (Story 7.7)
- [Source: Backend/VAPS/apps/migration_legacy/management/commands/verify_migration_convergence.py] (Story 7.5, паттерн эскалации через CommandError)

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- `green_streak()` переиспользован буквально (переименован из `_green_streak`, экспортирован публично) — не переписан.
- `ParallelRunModeSwitch.deadline` — nullable на уровне схемы (миграция 0019, безопасна для уже существующей singleton-строки из 7.7), но `enable()` требует его явно (ValueError без него) — все существующие вызовы `enable()` (CLI, 3 тестовых файла) обновлены на `--deadline`/`deadline=...`.
- Дашборд-эскалация (`parallel_run_dashboard`) — тот же паттерн, что `verify_migration_convergence` (7.5): CommandError = ненулевой exit, разовый acceptance-сигнал. Тест на анти-вакуумность (`test_criterion_met_is_green_even_past_deadline`) явно проверяет, что эскалация НЕ срабатывает всегда после дедлайна, только когда критерий не выполнен.
- `stand_health`: `exit_criterion_met` там всегда считается с `frozen_suite_green=False` (у эндпоинта нет входа для внешнего флага) — задокументировано как неавторитетный сигнал, авторитетный вердикт только через `parallel_run_dashboard --frozen-suite-green`.
- 3-агентный ревью (Blind Hunter / Edge Case Hunter / Acceptance Auditor) не нашёл реальных багов; единственная находка — рассинхрон чекбоксов сторифайла с фактическим состоянием, исправлено этим коммитом.
- Полный регресс: `apps/parallel_run/`, `apps/core/`, `apps/operations/` — 2019+72 passed (3 pre-existing concurrency-teardown ERROR, задокументированы в памяти, не регрессия).

### File List

- `Backend/VAPS/apps/core/models.py` (modified — `ParallelRunModeSwitch.deadline`)
- `Backend/VAPS/apps/core/migrations/0019_parallel_run_mode_switch_deadline.py` (new)
- `Backend/VAPS/apps/core/parallel_run_mode.py` (modified — `enable()` requires `deadline`, new `get_deadline()`)
- `Backend/VAPS/apps/core/tests/test_parallel_run_mode.py` (modified)
- `Backend/VAPS/apps/parallel_run/exit_criterion.py` (new)
- `Backend/VAPS/apps/parallel_run/tests/test_exit_criterion.py` (new)
- `Backend/VAPS/apps/parallel_run/management/commands/parallel_run_dashboard.py` (new)
- `Backend/VAPS/apps/parallel_run/tests/test_parallel_run_dashboard.py` (new)
- `Backend/VAPS/apps/parallel_run/management/commands/parallel_run_mode.py` (modified — `--deadline` required on `enable`)
- `Backend/VAPS/apps/parallel_run/tests/test_parallel_run_mode_command.py` (modified)
- `Backend/VAPS/apps/parallel_run/api/views.py` (modified — health exposes streak/deadline/exit_criterion_met)
- `Backend/VAPS/apps/parallel_run/tests/test_stand_health.py` (modified)
- `Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py` (modified — `_green_streak` → `green_streak`)
- `Backend/VAPS/apps/parallel_run/services/__init__.py` (modified — export `green_streak`)
- `Backend/VAPS/apps/parallel_run/tests/test_nightly_increment.py` (modified — `enable()` deadline)
- `Backend/VAPS/apps/operations/submissions/tests/test_day_submission_parallel_run_gate.py` (modified — `enable()` deadline)
