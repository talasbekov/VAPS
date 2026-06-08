# Epic: Generate Initial Migrations for Personnel-Records Apps

**Goal:** Create the missing initial migrations for every local app in the
`Personnel-Records` Django project so all model tables are created in dev, test,
and prod databases.

**Context:** Today only `apps/audit` has a migration. The other nine local apps
(`common`, `dictionaries`, `divisions`, `employees`, `statuses`, `secondments`,
`reports`, `notifications`, `staff_unit`) have **zero** migrations, so their
tables are never created. Any test or runtime path that touches those models
fails with `OperationalError: no such table: <name>` (this is what blocks
`apps/audit/tests_middleware.py`). See the audit-consolidation epic.

App root: `Backend/PersonnelStatus/Personnel-Records/organization_management/`

---

## Story 1.1: Generate the initial migration set for all local apps

### Goal
Create initial migrations for the nine app(s) without them so a clean database
can be built from scratch.

### Scope
Run `makemigrations` for the project and commit the generated initial migration
files for: `common`, `dictionaries`, `divisions`, `employees`, `statuses`,
`secondments`, `reports`, `notifications`, `staff_unit`.

### Out of Scope
- Any change to model definitions (fields, indexes, constraints) — migrations
  must reflect the models exactly as they are today.
- `apps/audit` (already migrated).
- Seed/data migrations (separate story).
- Performance/index tuning beyond what the models already declare.

### Why this is one story (not one-per-app)
The apps have **circular cross-app foreign keys** (e.g. `divisions ↔ employees`,
`employees ↔ statuses`). Django's `makemigrations` resolves the cross-app
dependency graph in a single pass and emits the correct `dependencies` /
`run_before` ordering. Generating per-app in isolation would produce
inconsistent or unresolvable ordering, so the initial set is an atomic
deliverable. It is still independently reviewable and revertible as one commit.

### Acceptance Criteria
- [ ] Given the models as they exist, when `makemigrations` runs, then an
      `0001_initial.py` (or equivalent) is created under each of the nine apps'
      `migrations/` directories.
- [ ] Given a clean database, when `migrate` runs, then all tables are created
      with no errors.
- [ ] Given `migrate`, when run a second time, then it reports no pending
      migrations.
- [ ] Given `makemigrations --check --dry-run`, when run after committing, then
      it reports no changes (model state matches migrations).
- [x] Given the audit suite, when run, then the `no such table: divisions`
      blocker is gone. **Note:** 3 of the 5 `tests_middleware.py` cases still fail,
      but for a *new, distinct* reason — the divisions write API is disabled
      (`DivisionViewSet` is commented out of the router and restricted to
      `['get','head','options']`), so POST/PUT/DELETE return 405/404. That is a
      divisions-app gap, out of scope for this migrations story (see Follow-up).
      The 2 negative middleware cases (GET / non-API not logged) now pass.

### Technical Tasks
- [ ] Run `python manage.py makemigrations` (settings:
      `organization_management.config.settings.test` or `sqlite`).
- [ ] Inspect each generated migration for correct fields, FKs, and the
      auto-resolved cross-app `dependencies`.
- [ ] Run `python manage.py migrate` on a clean DB; confirm success.
- [ ] Run `python manage.py migrate` again; confirm "no migrations to apply".
- [ ] Run the full test suite; confirm previously-blocked tests now pass.

### Files To Create
- ~~`apps/common/migrations/0001_initial.py`~~ — **not created.** `common` is not
  in `INSTALLED_APPS`, so its models are unregistered and `migrate` succeeds
  without them. Adding `common` to `INSTALLED_APPS` + migrating it is a separate
  decision (see Follow-up).
- `apps/dictionaries/migrations/0001_initial.py`
- `apps/divisions/migrations/0001_initial.py`
- `apps/employees/migrations/0001_initial.py`
- `apps/statuses/migrations/0001_initial.py`
- `apps/secondments/migrations/0001_initial.py`
- `apps/reports/migrations/0001_initial.py`
- `apps/notifications/migrations/0001_initial.py`
- `apps/staff_unit/migrations/0001_initial.py`
- (additional numbered migrations if Django splits a cycle across files)

### Files To Modify
- _none_ (models must not change; if `makemigrations` wants a change, that is a
  pre-existing model/state bug — capture it as a separate story rather than
  editing models here)

### Dependencies
- Depends on: nothing (foundational).
- Blocks: any test or feature work that persists non-audit models, and the
  audit-consolidation `tests_middleware.py` going green.

### Rollback Strategy / Notes
- These are **initial** migrations against tables that do not yet exist in any
  managed database, so there is no data to migrate and no destructive change.
- Rollback = `git revert` of the commit (delete the new migration files). No
  `migrate <app> zero` data loss concern because no production table was created
  by a prior migration.
- If a circular dependency cannot be auto-resolved, Django may require a
  manually split second migration (`0002_*`) per the
  [circular FK guidance](https://docs.djangoproject.com/en/5.1/topics/migrations/#dependencies);
  document any such manual edit in the commit.

### Tests
- Unit: `makemigrations --check --dry-run` reports no changes (CI gate).
- Integration: `migrate` on a fresh `:memory:` SQLite DB succeeds; full test
  suite (incl. `apps/audit/tests_middleware.py`) runs green.
- Manual: inspect generated migrations; `python manage.py migrate --plan`.

### Definition of Done
- [ ] Code implemented (migrations generated)
- [ ] Tests added / previously-blocked tests now run
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Follow-up (separate stories, out of scope here)
- **Story 2.x:** Seed/reference data migrations for `dictionaries` and any
  lookup tables.
- **Story 3.x:** CI gate that runs `makemigrations --check` to prevent future
  model/migration drift.
- **Story 4.x:** Enable the divisions write API (register `DivisionViewSet` in
  `apps/divisions/api/urls.py` and allow write methods), which unblocks the
  remaining `apps/audit/tests_middleware.py` POST/PUT/DELETE cases.
- **Story 5.x:** Decide whether `apps/common` belongs in `INSTALLED_APPS`; if so,
  generate and apply its migration.

## Implementation Result (Story 1.1)
Generated `0001_initial.py` for 8 apps: `dictionaries`, `divisions`,
`employees`, `notifications`, `reports`, `secondments`, `staff_unit`,
`statuses`. `migrate` applies cleanly on a fresh DB, re-running reports nothing
pending, and `makemigrations --check --dry-run` reports "No changes detected".
The audit model/API/migration tests (10) pass and the previously
table-blocked middleware tests now run (2 pass, 3 deferred to the divisions
write-API follow-up).
