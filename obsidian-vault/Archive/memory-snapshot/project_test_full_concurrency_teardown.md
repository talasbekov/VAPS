---
name: project-test-full-concurrency-teardown
description: 2 teardown-ERROR в make test-full — свойство веток, ГДЕ ЕСТЬ apps/audit (append-only × TRUNCATE); на ветках без audit их 0. Не регрессия ни там, ни там.
metadata: 
  node_type: memory
  type: project
  originSessionId: 0309ba1d-5c80-4c70-812e-8a861223b142
---

`make test-full` (Backend/VAPS) даёт **разное число teardown-ERROR в зависимости от ветки** — сверяйся с тем, построен ли `apps/audit`, прежде чем что-то трактовать.

**Ветки С `apps/audit` (E6-мейнлайн):** ~1516 passed + **2 teardown-ERROR**. Причина: `apps/operations/statuses/tests/test_employee_status_concurrency.py` — `@pytest.mark.concurrency` + `@pytest.mark.django_db(transaction=True)` (TransactionTestCase). В teardown Django делает `TRUNCATE` всех таблиц, а append-only DB-триггер на `audit_logs` (стори 4.2, ARCH-SEC-032, `apps/audit/migrations/0002_audit_logs_append_only.py`) отбивает TRUNCATE → `psycopg.errors.RestrictViolation: audit_logs is append-only`. **Тела тестов проходят**, падает только flush.

**Ветки БЕЗ `apps/audit` (E3-ветка, напр. `claude/awesome-jemison-1319e0`):** **0 teardown-ERROR** (проверено стори 3.12 и 3.14 на 2026-07-10: `make test-full` → 1347 passed, 0 error). Это не «починилось» — audit просто ещё не построен.

**Why:** `make gate` исключает эти тесты (`-m "not property and not concurrency and not slow"`), поэтому gate зелёный на обеих ветках. Взаимодействие 4.2-триггера и TransactionTestCase-flush существует независимо от любой новой стори. См. [[feedback_bmad_worktree_divergence]] — расхождение веток объясняет разные числа.

**How to apply:** не трактовать эти teardown-ERROR как свою регрессию; проверять, что они идентичны (audit_logs TRUNCATE-rejected) и тела «passed». Реальный quality-bar = `make gate`. **Планировать заранее:** когда Epic 4 придёт на ветку без audit, стори 4.2 ВЕРНЁТ эти 2 ошибки — это ожидаемое следствие append-only, а не сюрприз (зафиксировано в ретро E3, §5.3). Настоящий фикс (flush-исключение audit_logs / `serialized_rollback` для concurrency-тестов) — отдельная test-infra задача. Связано с [[feedback_vaps_arch_guards]].
