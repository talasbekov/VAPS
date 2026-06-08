# Operations Context — RBAC Foundation Design

**Date:** 2026-06-08
**Status:** Approved (brainstorming complete)
**Scope:** The RBAC slice of the `operations` bounded context only — roles, permissions, user-role assignments, temporary duty permissions, the `PermissionService`, and an admin REST API. The rest of the operations context (statuses, objects, posts, events, assignments, daily reports, brokerage, conflicts) is out of scope and will be planned separately.

**Spec basis:** `docs/VisitX/VAPS_7.8.2.md` §4.2 (DB-OPS-001), §17.20 (DB-OPS-038), §6 API conventions (§1248–1257), STORY-003 (§8087); read through `docs/RECONCILIATION.md` (R3 temporary duty permissions). Architecture rules ARCH-002/003/004/007, BR-ACCOUNT-001/002, BR-TEMP-PERM-001/002/003.

---

## 1. Goal

Build the authorization foundation for VAPS as a new Django app `apps/operations/` in the existing target project `Backend/VAPS/`. After this work:

- roles, permissions, and their mapping exist and are seeded;
- users can be assigned division-scoped roles;
- duty officers can receive time-bounded temporary permissions on their personal account;
- a single `PermissionService.has_permission(...)` answers every authorization question;
- an admin REST API manages assignments and grants;
- the context is isolated from `core` per the architecture rules, enforced by an AST test.

---

## 2. Architecture & Isolation

New greenfield Django app `apps/operations`, registered in `INSTALLED_APPS`, mounted at `/api/operations/`. Same conventions as the `core` context:

- `db_table` names exactly per spec `CREATE TABLE` statements.
- SQLite-testable: all `CHECK`-style rules (date ordering, `duty_role_code` enum) enforced with app-level validators / `clean()` rather than raw-SQL `CHECK`. Tests run on SQLite; production on PostgreSQL.
- Timezone `Asia/Qyzylorda`, `USE_TZ = True` (already set project-wide).

### Primary-key convention (decided during brainstorming)

Two distinct kinds of id, two different decisions:

1. **Cross-context reference fields** — `scope_division_id` (→ `core_divisions.id`), `employee_id` (→ `core_employees.id`), `event_id` (→ future `ops_events.id`). These **remain `UUIDField`** because the entities they reference are UUID-keyed (core is already built that way; the spec uses `gen_random_uuid()`). They are flat fields, **never `ForeignKey`** across the context boundary (ARCH-002/003).
2. **The operations tables' own surrogate PKs** — `RolePermission`, `UserRole`, `TemporaryDutyPermission` use **integer `BigAutoField`** PKs (Django default). `Role` and `Permission` use their natural VARCHAR `code` PKs and are unaffected.

A lightweight abstract base `TimeStampedModel` (provides `created_at`, `updated_at`, default integer PK) backs the three surrogate-PK tables. Operations does **not** reuse or import core's `UUIDTimeStampedModel`.

### Cross-context boundary (ARCH-004)

The only sanctioned cross-context read is division-scope resolution, which goes through `core.selectors.CoreDivisionTreeSelector.subtree_ids(...)`. Therefore:

- `apps.operations` **may** import `apps.core.selectors`.
- `apps.operations` **must NOT** import `apps.core.models`.

Enforced by a new `apps/operations/tests/test_isolation.py` (AST test): scan all non-test operations modules; fail on any import of `apps.core.models` (or `apps.core.models.*`); allow `apps.core.selectors`. The existing `apps/core/tests/test_isolation.py` already forbids the reverse direction.

### Identity (ARCH-007, BR-ACCOUNT-001/002)

Everything is keyed on the external auth account `user_id` (VARCHAR string), never `core_employees.id`. At request time `user_id` is read from an **`X-User-Id` header** as an MVP stand-in for the JWT `sub` claim (§7007); this stub is documented and replaceable by a real auth layer later.

---

## 3. Data Model (`apps/operations/models.py`)

All tables per DB-OPS-001 and DB-OPS-038.

### `Role` — `ops_roles`
- `code` = `CharField(primary_key=True, max_length=50)`
- `name` `CharField(255)`, `description` `TextField(null=True, blank=True)`, `is_active` `BooleanField(default=True)`

### `Permission` — `ops_permissions`
- `code` = `CharField(primary_key=True, max_length=100)`
- `name` `CharField(255)`, `description` `TextField(null=True, blank=True)`, `is_active` `BooleanField(default=True)`
- The wildcard `*` is stored as a literal `Permission(code="*")` row so every grant is a real row.

### `RolePermission` — `ops_role_permissions`
- integer PK; `TimeStampedModel`
- `role_code` `ForeignKey(Role, on_delete=CASCADE, db_column="role_code", to_field="code")`
- `permission_code` `ForeignKey(Permission, on_delete=CASCADE, db_column="permission_code", to_field="code")`
- `UniqueConstraint(role_code, permission_code)` → `unique_role_permission`
- (FKs are intra-context — allowed.)

### `UserRole` — `ops_user_roles`
- integer PK; `TimeStampedModel`
- `user_id` `CharField(100)` — **not** a FK
- `role_code` `ForeignKey(Role, on_delete=PROTECT, db_column="role_code", to_field="code")` (PROTECT models spec's `ON DELETE RESTRICT`)
- `scope_division_id` `UUIDField(null=True, blank=True)`
- `is_active` `BooleanField(default=True)`
- `UniqueConstraint(user_id, role_code, scope_division_id)` → `unique_user_role_scope`

### `TemporaryDutyPermission` — `ops_temporary_duty_permissions`
- integer PK; `TimeStampedModel`
- `user_id` `CharField(100)`
- `employee_id` `UUIDField(null=True, blank=True)`
- `duty_role_code` `CharField(50)` with choices validator `{OMD, ORGD, HQ_DUTY, OBJECT_SENIOR_DUTY}`
- `scope_division_id` `UUIDField(null=True, blank=True)`
- `event_id` `UUIDField(null=True, blank=True)` — flat, no FK (`ops_events` out of scope; a later migration can add the constraint)
- `starts_at`, `ends_at` `DateTimeField`
- `is_active` `BooleanField(default=True)`
- `created_by` `CharField(100)`
- `clean()` enforces `starts_at < ends_at` (BR-TEMP-PERM dates)

---

## 4. Seeds (`apps/operations/management/commands/seed_operations.py`)

Idempotent (`update_or_create`), mirroring core's `seed_core` style.

**Permissions (17 + wildcard):** `admin.roles`, `status.manage`, `status.view`, `assignment.create`, `assignment.delete`, `assignment.submit`, `assignment.return`, `assignment.approve`, `brokerage.manage`, `daily_report.generate`, `daily_report.mark_update`, `daily_report.correct`, `object.manage`, `event.manage`, `duty.manage`, `audit.view`, plus the literal `*`.

**Roles (8):** `ADMIN`, `ORGD`, `OMD`, `SENIOR_COORDINATOR`, `APPROVER`, `DIVISION_OPERATOR`, `VIEWER`, `INTEGRATION_USER`.

**Role → permission matrix (DB-OPS-001):**
- `ADMIN` → `*`
- `OMD` → assignment.create, assignment.delete, assignment.submit, daily_report.generate, brokerage.manage
- `SENIOR_COORDINATOR` → assignment.create, assignment.delete, assignment.submit
- `APPROVER` → assignment.return, assignment.approve
- `DIVISION_OPERATOR` → daily_report.mark_update, daily_report.correct, status.view
- `ORGD` → audit.view, daily_report.generate
- `VIEWER` → read-only permissions (status.view; the explicit read-only set)
- `INTEGRATION_USER` → status.manage

---

## 5. Permission Resolution (`apps/operations/services.py`)

`PermissionService.has_permission(user_id, permission_code, division_id=None) -> bool`:

1. Collect the user's active roles from `ops_user_roles` (`is_active=True`).
2. **Wildcard short-circuit:** if any of those roles grants `*` via `ops_role_permissions`, return `True` (ADMIN).
3. Gather permission codes granted by **scope-matching** roles (join through `ops_role_permissions`).
4. Add permissions from **active temporary duty** rows: `is_active=True` AND `starts_at <= now <= ends_at` (BR-TEMP-PERM-002). Each row's `duty_role_code` maps to the seeded `Role` of the same code, contributing that role's permissions for the window, scope-filtered.
5. Return `permission_code in <collected set>`.

**Scope matching:**
- `scope_division_id IS NULL` → global, always matches.
- scoped row + caller passes `division_id` → matches iff `division_id ∈ CoreDivisionTreeSelector.subtree_ids(scope_division_id)` (the one sanctioned cross-context read).
- scoped row + caller passes no `division_id` → still counts (scope only narrows division-specific actions; it does not withhold global checks).

**Helpers:**
- `effective_permissions(user_id, division_id=None) -> set[str]` — powers `GET /my-permissions/`; can later replace core's `X-User-Permissions` masking stub.
- `grant_temporary_duty(...)`, `assign_role(...)`, `revoke_role(...)`, `expire_temporary_duty(...)` — thin write wrappers used by the API.

---

## 6. HTTP Surface (`apps/operations/api/`)

- Identity helper reads `user_id` from the `X-User-Id` header (MVP stub for JWT `sub`).
- DRF permission class `HasOpsPermission(required_code)` calls `PermissionService.has_permission(user_id, required_code, division_id)`; returns **403 PERMISSION_DENIED** on failure and when `X-User-Id` is absent.
- `limit/offset` pagination (§1256). Error contract per §1255.

| Method & path | Purpose | Guard |
|---|---|---|
| `GET /api/operations/roles/` | list roles | `admin.roles` |
| `GET /api/operations/permissions/` | list permissions | `admin.roles` |
| `GET /api/operations/user-roles/?user_id=` | list assignments | `admin.roles` |
| `POST /api/operations/user-roles/` | assign role (`user_id`, `role_code`, `scope_division_id?`) | `admin.roles` |
| `DELETE /api/operations/user-roles/{id}/` | revoke assignment | `admin.roles` |
| `GET /api/operations/temporary-duty/?user_id=` | list temp-duty grants | `admin.roles` |
| `POST /api/operations/temporary-duty/` | grant temp duty | `admin.roles` |
| `POST /api/operations/temporary-duty/{id}/expire/` | deactivate a grant | `admin.roles` |
| `GET /api/operations/my-permissions/?division_id=` | caller's effective permissions | any authenticated `user_id` |

---

## 7. Testing

TDD per task, SQLite, `pytest` + `pytest-django`. Run from `Backend/VAPS/`.

- **Models/constraints:** `unique_user_role_scope`; temp-duty `starts_at < ends_at`; `duty_role_code` choices; integer PKs assigned; cross-context fields are UUID.
- **Seeds:** idempotent re-run; 8 roles, 17 permissions + `*`, full role→permission matrix, ADMIN bound to `*`.
- **PermissionService:** wildcard short-circuit; granted vs denied; scope subtree match and miss; temp-duty inside/outside window; expired/`is_active=False` excluded; `effective_permissions` set contents.
- **Isolation:** `test_isolation.py` forbids `apps.core.models`, allows `apps.core.selectors`.
- **API:** each endpoint happy path; 403 when `X-User-Id` missing; 403 when lacking `admin.roles`; `my-permissions` reflects assignments + temp duty.

---

## 8. Deferred / Out of Scope (documented, not dropped)

- **Audit-log writes on mutations (§1253):** the `audit` context / `audit_logs` schema is not built; mutation handlers will carry a clearly-marked TODO hook rather than invent the schema. A later audit-context plan wires it.
- **Real authentication:** `X-User-Id` header is an MVP stub for JWT `sub` (§7007); a real auth layer is a later plan.
- **Wiring PermissionService into core masking:** replacing core's `X-User-Permissions` stub with `effective_permissions(...)` is a separate cross-context integration step (explicitly excluded by the chosen scope).
- **Rest of operations context:** statuses, objects, posts, events, assignments, daily reports, brokerage, conflicts — separate plans.
- **Postgres `gen_random_uuid()` / SQL `CHECK`:** intentionally replaced by app-level defaults/validators for the SQLite-testable approach (consistent with core).
