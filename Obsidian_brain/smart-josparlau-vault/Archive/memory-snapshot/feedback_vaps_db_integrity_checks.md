---
name: feedback_vaps_db_integrity_checks
description: "Bratan prefers DB-level CheckConstraints for integrity invariants on new tables, esp. choice fields without a model default"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4528e0ad-d3ce-4698-a732-a9ac699ef60d
---

On VAPS, Bratan prefers integrity invariants enforced at the **DB level** (CheckConstraint), not just by the service/app layer — chosen during code-review of story 5.2 (DailySubmission). Specifically he approved adding `CheckConstraint(event ∈ Event.values)` + `CheckConstraint(version ≥ 1)` even though it deviates from the existing `EmployeeStatus.source` precedent (choice fields there are NOT DB-checked).

**Why:** The lighter precedent is only safe because `EmployeeStatus.source` has a model default (`USER`), so a bad value can't silently appear. A choice/enum field with **no default** (like `event`) silently becomes `""` on the `.objects.create()` path (CharField.choices is validated only in `full_clean()`, which `.create()` skips) — so it needs a DB guard. Bratan leans toward "БД гарантирует целостность" for brand-new tables (no backfill pain).

**How to apply:** For a new model field, if it's a choice/enum with NO default, OR a numeric field whose floor matters (e.g. version ≥ 1, since `PositiveIntegerField`'s auto-CHECK is only `≥ 0`), add a `CheckConstraint` in `Meta.constraints`. Reference enum values via a literal list (Python class-scope blocks `Event.values` inside nested `Meta`) and add a drift-guard test that inserts every `Enum.values` member. Don't blindly copy the `EmployeeStatus.source` no-check pattern — check whether the field has a default first. Related: [[feedback_vaps_ruff_format_scoping]], [[project_vaps_architecture]].
