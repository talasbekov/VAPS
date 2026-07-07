"""Schema drift gate (story 8.3, ARCH-FE-011): the committed Backend/VAPS/schema.yaml
must stay byte-identical to what drf-spectacular generates from the current code.

Mechanics: regen into a TEMP file + byte comparison against the committed artifact —
NOT "regen in place + git diff --exit-code" (git diff compares against the index, so a
legitimate uncommitted-but-regenerated schema would flash a false red). This is the
locally-correct form of the ARCH-FE-011 "regenerate + diff" enforcement; the frontend
half (schema.d.ts vs schema.yaml) is guarded by frontend/scripts/schema-check.mjs.
"""

from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import call_command

BASE_DIR = Path(__file__).resolve().parents[3]
SCHEMA_FILE = BASE_DIR / "schema.yaml"

# The schema is backend-dependent (Postgres int32 IntegerField bounds vs SQLite
# int64), so the committed contract is defined against the target DB only
# (ARCH-DATA-020). `make schema` pins VAPS_DB=postgres; the gate runs pytest
# under the same env, so this guard never skips where enforcement matters.
pytestmark = pytest.mark.skipif(
    settings.DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql",
    reason="schema contract is generated against Postgres (run via `make gate`)",
)


@pytest.fixture(scope="session")
def fresh_schema_bytes(tmp_path_factory):
    # Schema generation is static DRF introspection — one run per session is
    # enough for every assertion below and keeps the gate inside its budget.
    out = tmp_path_factory.mktemp("schema_drift") / "schema-fresh.yaml"
    call_command("spectacular", "--file", str(out))
    data = out.read_bytes()
    # Vacuous-pass guard (lesson 8.1/8.2): empty generator output must never
    # "equal" anything downstream — fail loudly right here.
    assert data, "spectacular produced EMPTY output — schema generation is broken"
    return data


def test_schema_yaml_committed_and_nonempty():
    assert SCHEMA_FILE.exists(), (
        "Backend/VAPS/schema.yaml is missing — it is a committed artifact "
        "(frontend codegen handoff). run: make schema"
    )
    assert SCHEMA_FILE.stat().st_size > 0, (
        "Backend/VAPS/schema.yaml is empty. run: make schema"
    )


def test_schema_yaml_matches_fresh_generation(fresh_schema_bytes):
    committed = SCHEMA_FILE.read_bytes()
    assert committed == fresh_schema_bytes, (
        "schema drift: committed schema.yaml does not match the current API "
        "surface. run: make schema (then on the frontend: npm run generate:api)"
    )


def test_doctored_schema_detected_as_drift(fresh_schema_bytes):
    # Negative control: a single flipped byte in an otherwise-valid schema must
    # register as drift, proving the comparison above is not vacuously green.
    committed = SCHEMA_FILE.read_bytes()
    idx = len(committed) // 2
    doctored = committed[:idx] + bytes([committed[idx] ^ 0xFF]) + committed[idx + 1 :]
    assert doctored != fresh_schema_bytes, (
        "doctored schema.yaml was NOT detected as drift — comparison is vacuous"
    )
