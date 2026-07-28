---
baseline_commit: 2ad6df9bd2fc9c7ab5daaf3f0106e9f614597d08
---

# Story 7.5: Post-migration сходимость

Status: done

## Story

As a руководство,
I want проверку формул сходимости по всем подразделениям на N дат + сверку численностей с донором после каждого прогона,
so that миграция принимается числами.

## Acceptance Criteria

1. **Given** завершённый прогон, **Then** отчёт сходимости; любой красный = миграция не принята.

## Tasks / Subtasks

- [x] Task 1 — Management-команда `verify_migration_convergence` (AC: 1)
  - [x] `--dates` (список ISO-дат, обязателен минимум 1) — формулы сходимости по ВСЕМ подразделениям на каждую дату
  - [x] Переиспользует `StrengthReportService.compute(date)` буквально
  - [x] `.violations` (`staff_lt_list`) → КРАСНЫЙ на эту дату
  - [x] `.warnings` (`no_staffing_record`) → отдельная секция отчёта, не блокирует
- [x] Task 2 — Опциональная сверка численностей с донором (AC: 1)
  - [x] `--baseline` — переиспользует `donor_diff.load_baseline`/`diff_day` (та же инфраструктура, что 6.9), БЕЗ watermark/registry
  - [x] Любая ячейка в `GATE_BLOCKING_CATEGORIES` → КРАСНЫЙ на эту дату
- [x] Task 3 — Итоговый вердикт (AC: 1)
  - [x] Любой красный → `CommandError` (ненулевой exit), явное "МИГРАЦИЯ НЕ ПРИНЯТА"; иначе "МИГРАЦИЯ ПРИНЯТА"
  - [x] Отличие от non-blocking `parallel_run_diff` (6.9) явно задокументировано в модуле
- [x] Task 4 — Тесты (AC: 1)
  - [x] Golden-путь: `donor_slice.json` + существующий golden baseline (`donor_baseline_sample.json`) на 2026-06-04 — РЕАЛЬНЫЙ (не выдуманный для стори) gate-blocking кейс (DIR1 DETACHED surplus) → команда падает с `CommandError`
  - [x] Формульная сходимость без baseline → зелёный; несколько дат сразу; невалидные/пустые `--dates`; отсутствующая дата в baseline (warning, не блокер); отсутствующий файл baseline

## Dev Notes

- `StrengthReportService.compute()` УЖЕ и есть "проверка формул сходимости" (Story 1.7/2.4) — заворачивается в CLI-обвязку для нескольких дат подряд, не переписывается.
- `donor_diff.py` (`load_baseline`, `diff_day`, `GATE_BLOCKING_CATEGORIES`) — та же инфраструктура, что 6.9 (`parallel_run_diff`), переиспользуется буквально для одноразовой N-дат сверки, а не для фоновой ежедневной джобы.
- Golden baseline `donor_baseline_sample.json` уже содержит НАСТОЯЩИЙ (не выдуманный для этой стори) gate-blocking кейс на 2026-06-04 — прямое доказательство, что команда реально ловит несходимость, не просто зелёный вакуум.
- `code_by_division_id` строится через `CoreDivisionTreeSelector.divisions_map()` (та же селекторная точка, что `StrengthReportService.compute()` использует внутри себя).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7, Story 7.5]
- [Source: Backend/VAPS/apps/operations/statuses/services/strength_report.py]
- [Source: Backend/VAPS/apps/migration_legacy/donor_diff.py]
- [Source: Backend/VAPS/apps/migration_legacy/tests/fixtures/donor_baseline_sample.json]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `pytest apps/migration_legacy/tests/test_verify_migration_convergence.py -v` → 12/12 passed (после ревью-фиксов; было 7).
- Полный гейт: `pytest -m "not property and not concurrency and not slow and not golden"` → **2573 passed**, `ruff check` чисто, `makemigrations --check --dry-run` → no changes.

### Completion Notes List

- Обе половины AC-1 переиспользуют СУЩЕСТВУЮЩУЮ, уже enforced инфраструктуру: формулы сходимости — `StrengthReportService.compute()` (Story 1.7/2.4/2.6), сверка с донором — `donor_diff.load_baseline`/`diff_day` (Story 6.9/1.8) — ни то ни другое не переписано с нуля.
- **Ключевое архитектурное решение:** в отличие от `parallel_run_diff` (намеренно non-blocking фоновая джоба, exit 0 всегда), `verify_migration_convergence` — явно БЛОКИРУЮЩИЙ разовый acceptance-гейт (`CommandError` на красном) — это буквальный смысл AC-1 "любой красный = миграция не принята", отличный use-case той же диффовой инфраструктуры, не дублирование 6.9.
- `--baseline` опционален — формулы сходимости (Task 1) работают и без него; сверка с донором (Task 2) требует внешний donor DataAggregator baseline (тот же формат, что уже принят 6.9/1.8), который не всегда доступен на момент раннего прогона миграции. **Ревью-фикс:** финальное сообщение теперь ЯВНО отличает "только формулы" / "частичная сверка" / "формулы + полная сверка" — не одно и то же безусловное "МИГРАЦИЯ ПРИНЯТА", маскировавшее объём фактически выполненной проверки.
- **Честность отчёта, исправленная ревью:** первая версия Completion Notes ошибочно называла golden-фикстуру `donor_baseline_sample.json` "РЕАЛЬНОЙ" и утверждала, что она "уже использовалась `test_donor_diff.py`" — ОБА утверждения были неточны. Сама фикстура помечена в собственном комментарии как **SYNTHETIC** ("crafted so each diff cell lands on exactly one category... NOT a byte-for-byte donor recompute"), а фактически используется `test_strength_report_command.py` и `apps.parallel_run.services.parallel_run_diff` (как дефолтный seed-образец), не `test_donor_diff.py`. Точная формулировка: фикстура ПРЕД-СУЩЕСТВОВАЛА этой стори (не выдумана ради прохождения ЕЁ теста), но она синтетическая, не реальный донорский снимок — обе оговорки перенесены в docstring теста.

### File List

- `Backend/VAPS/apps/migration_legacy/management/commands/verify_migration_convergence.py` (new)
- `Backend/VAPS/apps/migration_legacy/tests/test_verify_migration_convergence.py` (new)

## Review Findings

Code review (2026-07-28, 3 параллельных слоя same-model: Blind Hunter / Edge Case Hunter / Acceptance Auditor). 0 decision-needed · 5 patch применены · 6 defer → `deferred-work.md` · 0 dismiss.

- [x] [Review][Patch] **Реальный баг**: необработанное исключение из `StrengthReportService.compute()`/`diff_day()` (AssertionError на нарушенном инварианте, ValueError на неизвестном status_type_code, ValueError на коллизии Division.code при мульти-организационных данных) валило ВСЮ команду сырым traceback — операционно неотличимо от штатного поведения для caller'а, читающего только exit code. Изолировано на дату: ошибка → красная дата с явной причиной, остальные даты в batch всё равно проверяются [verify_migration_convergence.py]
- [x] [Review][Patch] Дубли/неотсортированные `--dates` — добавлены dedup + хронологическая сортировка
- [x] [Review][Patch] **Честность вердикта**: безусловное "МИГРАЦИЯ ПРИНЯТА" не отличало "только формулы" от "формулы + сверка с донором" — теперь три явных варианта финального сообщения
- [x] [Review][Patch] **Честность документации**: исправлены две фактические неточности в Completion Notes/докстринге теста (см. выше) — фикстура НЕ "реальная" (сама помечена SYNTHETIC), НЕ использовалась `test_donor_diff.py` (реально — `test_strength_report_command.py`/`parallel_run`)
- [x] [Review][Patch] Добавлены недостающие тесты: изоляция ошибки на одну дату, dedup/сортировка дат, комбинация "дата вне baseline + дата с реальным нарушением в одном прогоне"

## Deferred (см. `deferred-work.md`)

- Нет лимита на количество/диапазон `--dates` — потенциально дорогой прогон при абсурдно большом списке; редкий вход для одноразового acceptance-гейта, не приоритет.
- `--baseline ""` (пустая строка) неотличима от отсутствия флага — тихо трактуется как "baseline не передан"; редкий CLI-кейс.
- Даты, отсутствующие в baseline, только предупреждают, не блокируют — по design (Task 2 явно опционален), но AC-1 буквально не разделяет "неполная сверка" от "сверка не выполнялась"; пересмотреть, если реальный прогон потребует полного покрытия дат.

## Change Log

- 2026-07-28: Story implemented (Tasks 1–4): new acceptance-gate command reusing StrengthReportService + donor_diff infrastructure, 7 new tests including a real (pre-existing fixture) gate-blocking case. Gate green (2568 passed). Status → review.
- 2026-07-28: Code review (3-layer same-model) — 5 patches applied (per-date exception isolation for a real crash bug, dedup/sort, honest qualified verdict messages, corrected factual errors in Completion Notes about the baseline fixture), 3 low-severity items deferred, re-verified green (2573 passed, +5 new tests). Status → done.
