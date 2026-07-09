# VAPS — target project

Greenfield Django project implementing VAPS per `docs/VisitX/VAPS_7.8.2.md` read
through `docs/RECONCILIATION.md`. Currently covers the `core` context plus the
`operations` context (statuses, RBAC, submissions) and the donor parallel-run
harness (`migration_legacy`).

## Setup

    python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
    docker compose up -d --wait db          # PostgreSQL 16 on :5433
    python manage.py migrate
    python manage.py seed_core              # division types, positions, ranks, policies
    python manage.py seed_statuses          # status types

## Tests

    make gate        # ruff + fast suite + makemigrations --check, 300s budget (NFR-8)
    make test-full   # everything incl. property/concurrency/slow markers

**Tests run on PostgreSQL**, not SQLite (ARCH-DATA-020). Both `make` targets set
`VAPS_DB=postgres` and bring the compose DB up on port 5433. `ops_statuses`
migrations use Postgres-only features (`ExclusionConstraint`, `GeneratedField`
over `daterange`), so a bare `pytest` against the no-env SQLite default cannot
migrate. SQLite remains only for pure ORM-free units.

Data is seeded directly in tests — there is no `factory_boy` (see
ARCH-DEFERRED-043). Time is controlled only via `core.clock.override(...)`;
never `timezone.now().date()`.

## Layout

- `apps/core/models.py` — `core_*` tables (DB-CORE-001..013), `Watermark`
- `apps/core/clock.py` — `Clock` (the only sanctioned time source) + `override(...)`
- `apps/core/watermark.py` — watermark bootstrap/advance under advisory lock
- `apps/core/selectors.py` — sanctioned cross-context reads (ARCH-004)
- `apps/core/services.py` — division history, vacancy calc, sensitive-field masking
- `apps/core/exceptions.py` + `apps/core/api/exception_handler.py` — `DomainError` and the §36 error envelope
- `apps/core/api/` — `/api/core/` REST surface
- `apps/operations/statuses/` — derived-first status engine: models, `conflict_matrix.py`, services, catch-up `tasks.py`
- `apps/operations/rbac/` — `PermissionService`, role/operation matrix
- `apps/operations/submissions/` — daily submission context (Epic 5)
- `apps/migration_legacy/` — donor diff / parallel-run tooling

## Canon

- Error codes are a closed world: `docs/registries/error-codes.yaml`. A code not
  in the registry is a STOP, not a new constant.
- Status state is **derived**, never stored (ARCH-DATA-022). Lifecycle facts
  (`cancelled_*`, `return_*`) are append-once.
- Intervals are half-open `[start, end)` (ARCH-DATA-023).
