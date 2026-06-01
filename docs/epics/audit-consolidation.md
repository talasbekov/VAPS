# Epic: Consolidate Audit Logging onto the `AuditLog` (domain) Implementation

**Goal:** Remove the duplicated `AuditEntry` stack, wire the richer `AuditLog` (DDD) stack as the single active audit implementation, create its migration, and restore working audit logging + API.

**Context:** `apps/audit/` currently has two parallel stacks. Stack A (`AuditEntry`) has the active middleware but a commented-out API and no migration. Stack B (`AuditLog`/`domain/`) is the deliberate target design but is fully orphaned. Audit logging is dead at runtime (active middleware writes to a non-existent table).

App root: `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/audit/`

---

## Story 1.1: Create migration for the `AuditLog` model

### Goal
Establish the database table for `AuditLog` so audit records can persist.

### Scope
Generate and commit the initial migration for `apps/audit/domain/models.py::AuditLog`.

### Out of Scope
- Any change to `AuditEntry`
- Middleware, API, serializers, filters

### Acceptance Criteria
- [ ] Given the `AuditLog` model, when `makemigrations audit` runs, then a migration file is created under `apps/audit/migrations/`.
- [ ] Given the new migration, when `migrate` runs on a clean DB, then the `audit_auditlog` table is created without errors.
- [ ] Given `migrate`, when run twice, then the second run reports no pending migrations.

### Technical Tasks
- [ ] Confirm `AuditLog` fields (generic FK, IP, user agent, JSON diff, timestamp, user, action_type).
- [ ] Run `python manage.py makemigrations audit`.
- [ ] Run `python manage.py migrate` and verify table creation.

### Files To Create
- `apps/audit/migrations/0001_initial.py`

### Files To Modify
- _none_

### Dependencies
- Blocks Story 1.2, 1.3, 1.6

### Tests
- Unit: migration applies cleanly (CI `migrate --check`)
- Integration: `AuditLog.objects.create(...)` succeeds in a test DB
- Manual: inspect generated migration for correct fields

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Story 1.2: Switch active middleware to the `AuditLog` diff-aware middleware

### Goal
Make the registered middleware write `AuditLog` rows (with PUT/PATCH diffs) instead of `AuditEntry`.

### Scope
Repoint `MIDDLEWARE` in settings from `middleware/audit_middleware.py::AuditMiddleware` (Stack A) to the flat `middleware.py::AuditMiddleware` (Stack B).

### Out of Scope
- Deleting the old middleware file (Story 1.5)
- API/URL changes

### Acceptance Criteria
- [ ] Given a POST/PUT/PATCH/DELETE to an API endpoint, when the request completes, then an `AuditLog` row is created.
- [ ] Given a PUT/PATCH, when an object is updated, then the log captures a field-level diff.
- [ ] Given a GET request, when processed, then no audit row is created (matches existing test expectations).

### Technical Tasks
- [ ] Change `config/settings/base.py:59` to `'organization_management.apps.audit.middleware.AuditMiddleware'`.
- [ ] Verify import path resolves (flat `middleware.py`, not the `middleware/` package).
- [ ] Resolve the name collision between `middleware.py` and the `middleware/` package (see Risks).

### Files To Modify
- `config/settings/base.py`

### Dependencies
- Depends on Story 1.1
- Blocks Story 1.5

### Tests
- Unit: `tests_middleware.py` passes (already targets `domain.models.AuditLog`)
- Integration: end-to-end request -> `AuditLog` row with diff
- Manual: hit an endpoint, confirm DB row

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Story 1.3: Repoint the audit API serializer + ViewSet to `AuditLog`

### Goal
Expose `AuditLog` (not `AuditEntry`) through the read-only audit API with filtering and ordering.

### Scope
Consolidate onto Stack B's `views.py`, `serializers.py`, `filters.py` (already `AuditLog`-based). Retire the `api/` Stack A variants from the routing path.

### Out of Scope
- Uncommenting the root URL include (Story 1.4)
- Deleting Stack A files (Story 1.5)

### Acceptance Criteria
- [ ] Given the audit router, when registered, then it uses `AuditLogViewSet` from `views.py`.
- [ ] Given a list request, when filters (`user`, `action_type`, `ip_address`) are applied, then results are filtered via `AuditLogFilter`.
- [ ] Given a list request, when `ordering=timestamp` is passed, then results sort accordingly (default `-timestamp`).

### Technical Tasks
- [ ] Decide canonical URL module: keep `urls.py` (`logs/`) and deprecate `api/urls.py`, OR move `AuditLogViewSet` into `api/`. Recommend keeping `urls.py`.
- [ ] Ensure `AuditLogViewSet` is read-only and permission-guarded (`IsAuthenticated`).
- [ ] Align endpoint prefix decision with Story 1.4.

### Files To Modify
- `apps/audit/urls.py` (confirm router registration)
- `apps/audit/views.py` (confirm permissions)

### Dependencies
- Depends on Story 1.1
- Blocks Story 1.4

### Tests
- Unit: serializer serializes `AuditLog` correctly
- Integration: `tests_api.py` passes against `AuditLogViewSet`
- Manual: query `logs/` endpoint, verify shape

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Story 1.4: Restore audit API routing in root URL conf

### Goal
Make the audit API reachable over HTTP again.

### Scope
Uncomment/restore the audit include in `config/urls.py` pointing at the canonical audit `urls.py` chosen in Story 1.3.

### Out of Scope
- Any view/serializer logic
- Auth/permission policy changes

### Acceptance Criteria
- [ ] Given the server is running, when `GET /api/audit/logs/` is called by an authenticated user, then a 200 with the log list is returned.
- [ ] Given an unauthenticated request, when the endpoint is hit, then a 401/403 is returned.
- [ ] Given the URL conf, when loaded, then no `ImproperlyConfigured`/import errors occur.

### Technical Tasks
- [ ] Update `config/urls.py:34` include to the canonical module (`apps.audit.urls`).
- [ ] Confirm the prefix (`api/audit/`) matches frontend/API expectations.

### Files To Modify
- `config/urls.py`

### Dependencies
- Depends on Story 1.3
- Blocks Story 1.6

### Tests
- Integration: route resolves and returns data
- Manual: curl the endpoint authenticated + unauthenticated

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Story 1.5: Delete the legacy `AuditEntry` stack

### Goal
Remove the dead Stack A code so only one audit implementation remains.

### Scope
Delete `AuditEntry` model, its serializer, ViewSet, the `api/` URL module (if deprecated in 1.3), and the `middleware/audit_middleware.py` package middleware.

### Out of Scope
- `AuditLog` / domain files
- Migration changes beyond removing `AuditEntry` (it has no table/migration, so no data migration needed)

### Acceptance Criteria
- [ ] Given the codebase, when grepping for `AuditEntry`, then zero references remain outside git history.
- [ ] Given the app loads, when Django starts, then no import errors from removed modules.
- [ ] Given `makemigrations`, when run, then no new migration is generated (model removal leaves no orphaned table since none existed).

### Technical Tasks
- [ ] Remove `AuditEntry` from `models.py` (delete file if empty after).
- [ ] Delete `api/serializers.py`, `api/views.py`, and `api/urls.py` (if superseded).
- [ ] Delete `middleware/audit_middleware.py` and the `middleware/` package `__init__.py` if no longer needed.
- [ ] Resolve the `middleware.py` vs `middleware/` naming collision (keep exactly one).

### Files To Delete
- `apps/audit/api/serializers.py`
- `apps/audit/api/views.py`
- `apps/audit/api/urls.py`
- `apps/audit/middleware/audit_middleware.py`

### Files To Modify
- `apps/audit/models.py` (remove `AuditEntry`)

### Dependencies
- Depends on Story 1.2, 1.3, 1.4
- Blocks Story 1.6 (test consolidation references)

### Tests
- Unit: app boots, no dangling imports
- Integration: full test suite green after deletion
- Manual: `python manage.py check`

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Story 1.6: Consolidate audit tests onto `AuditLog`

### Goal
Single, coherent test suite covering the `AuditLog` model, middleware, and API.

### Scope
Fix `tests.py` (currently `AuditEntry as AuditLog` alias), keep `tests_api.py` and `tests_middleware.py` (already `AuditLog`-based), remove duplicate/obsolete cases.

### Out of Scope
- New feature tests beyond current coverage
- Non-audit apps

### Acceptance Criteria
- [ ] Given the test suite, when run, then all audit tests import only `domain.models.AuditLog`.
- [ ] Given the suite, when run, then there are no duplicate test names across files for the same behavior.
- [ ] Given CI, when the audit tests run, then they pass green.

### Technical Tasks
- [ ] Rewrite `tests.py` to target `AuditLog` (remove the alias hack).
- [ ] De-duplicate overlapping cases between `tests.py` and `tests_api.py`/`tests_middleware.py`.
- [ ] Update `apps/audit/__init__.py` docstring (it still says `audit.middleware.AuditMiddleware`).

### Files To Modify
- `apps/audit/tests.py`
- `apps/audit/__init__.py`

### Dependencies
- Depends on Story 1.5
- Final story in epic

### Tests
- Unit: all rewritten tests pass
- Integration: full suite green
- Manual: `pytest apps/audit`

### Definition of Done
- [ ] Code implemented
- [ ] Tests added
- [ ] Tests passing
- [ ] Lint passing
- [ ] No hardcoded secrets
- [ ] Documentation updated if needed

---

## Dependency Map

```
1.1 -+-> 1.2 -+
     |        |
     +-> 1.3 -+-> 1.4 -+
     |                 +-> 1.5 -> 1.6
     +-----------------+
```

## Recommended Execution Order
1.1 -> 1.2 -> 1.3 -> 1.4 -> 1.5 -> 1.6 (1.2 and 1.3 may run in parallel after 1.1)

## Risks & Edge Cases
- **Name collision:** `middleware.py` (module) and `middleware/` (package) coexist; Python import resolution is ambiguous. Must collapse to one before/with Story 1.2.
- **No existing migration for either model** -> no data migration needed, but confirm no production table exists under a legacy name.
- **Frontend coupling:** clients calling the old `api/audit/` shape will see a changed response schema (`AuditEntry` -> `AuditLog`); coordinate the prefix in 1.4.
- **Generic FK / ContentType:** `AuditLog` requires `django.contrib.contenttypes` in INSTALLED_APPS.

## Blockers
- Confirm `AuditLog` (Stack B) is the intended keeper. If `AuditEntry` is preferred, the epic inverts.

## Next BMAD Command
- `create story 1.1` (or run `bmad-sprint-planning` to generate the sprint tracker for Epic 1).
