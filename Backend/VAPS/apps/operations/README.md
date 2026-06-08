# operations context — RBAC foundation

Authorization for VAPS: roles, permissions, division-scoped user-role
assignments, time-bounded temporary duty permissions, and a single
`PermissionService`. Implements spec DB-OPS-001 and DB-OPS-038.

## Setup

    ./.venv/bin/python manage.py migrate
    ./.venv/bin/python manage.py seed_operations   # roles, permissions, role->permission matrix

## Authorization

Every check goes through `PermissionService.has_permission(user_id, permission_code, division_id=None)`:
- ADMIN holds `*` and passes any check;
- a role/duty scoped to a division matches that division and its subtree
  (via `core.selectors.CoreDivisionTreeSelector`);
- temporary duty contributes its role's permissions only within `starts_at..ends_at`.

`user_id` is the external auth account id (ARCH-007), never `core_employees.id`.
At the API layer it is read from the `X-User-Id` header (MVP stub for JWT `sub`).

## API (`/api/operations/`)

- `roles/`, `permissions/` — read, guarded by `admin.roles`
- `user-roles/` — list/assign (POST)/revoke (DELETE), guarded by `admin.roles`
- `temporary-duty/` — list/grant (POST)/`{id}/expire/`, guarded by `admin.roles`
- `my-permissions/?division_id=` — caller's effective permissions

## Isolation

operations imports `apps.core.selectors` only, never `apps.core.models`
(ARCH-004). Enforced by `tests/test_isolation.py`.

## Deferred

- Audit-log writes on mutations (audit context not built).
- Real authentication (JWT `sub`); `X-User-Id` is the current stub.
- Wiring `effective_permissions` into core's masking `X-User-Permissions` stub.
- `HQ_DUTY` / `OBJECT_SENIOR_DUTY` duty roles have no seeded role yet.
