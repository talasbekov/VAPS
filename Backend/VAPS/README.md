# VAPS — target project (core context)

Greenfield Django project implementing the `core` bounded context of VAPS
per `docs/VisitX/VAPS_7.8.2.md` read through `docs/RECONCILIATION.md`.

## Setup

    pip install -e ".[dev]"
    python manage.py migrate
    python manage.py seed_core      # reference data: division types, positions, ranks, policies

## Tests

    python -m pytest apps

Tests run on SQLite. Production uses PostgreSQL (set `VAPS_DB=postgres` + `VAPS_DB_*` env vars).

## Layout

- `apps/core/models.py` — `core_*` tables (DB-CORE-001..013)
- `apps/core/selectors.py` — sanctioned cross-context reads (ARCH-004)
- `apps/core/services.py` — division history, vacancy calc, sensitive-field masking
- `apps/core/api/` — `/api/core/` REST surface
