# VAPS — target project (backend)

Greenfield Django project implementing the `core`, `operations` (statuses,
submissions, rbac), `audit` and `notifications` contexts of VAPS
per `docs/VisitX/VAPS_7.8.2.md` read through `docs/RECONCILIATION.md`.

## Setup

    pip install -e ".[dev]"
    python manage.py migrate
    python manage.py seed_core      # reference data: division types, positions, ranks, policies

## Tests / quality gate

    make gate        # ruff + pytest + makemigrations --check (canonical quality bar)

The full suite requires PostgreSQL (`VAPS_DB=postgres` + `VAPS_DB_*` env vars;
partial-unique constraints, JSONB containment, GeneratedField daterange).
`python -m pytest apps` on SQLite runs only a subset.

## Auth

External JWT (story 5.1): `VAPS_JWT_KEY`, `VAPS_JWT_ALGORITHMS`,
`VAPS_JWT_AUDIENCE`, `VAPS_JWT_ISSUER`, `VAPS_JWT_LEEWAY`. When `VAPS_JWT`
is unset (dev), the `X-User-Id` header authenticates instead — the two are
mutually exclusive (`build_auth_classes`, fail-closed in production).

## Layout

- `apps/core/` — `core_*` tables, sanctioned cross-context selectors (ARCH-004), `/api/core/`
- `apps/operations/` — statuses, daily submissions (snapshot/amendment/traffic light/tomorrow-block), RBAC, `/api/operations/`
- `apps/audit/` — append-only audit log, single write seam `audit.services.record()`
- `apps/notifications/` — in-app notifications, `notify()` (in-txn), `GET /api/notifications/`
- `apps/migration_legacy/` — donor importers (management commands)

Registries (closed-world, enforced by gate tests): `docs/registries/*.yaml`
(error codes, audit events, WS message types). API contract: `schema.yaml`
(`make schema` regenerates; drift is a gate failure).
