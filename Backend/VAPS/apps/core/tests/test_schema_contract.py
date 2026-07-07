"""Schema CONTENT contract (story 8.3 QA, ARCH-FE-011) — complements
test_schema_drift.py, which only proves byte-identity of the committed
schema.yaml with fresh generator output.

These tests pin what the bytes MUST contain: the handoff artifact the
frontend codegen consumes has a fixed identity (title/static version, Д4),
covers every API context, and keeps COMPONENT_SPLIT_REQUEST semantics —
plus generation determinism (Ловушка 8: generator output IS the drift-check
contract, so nondeterminism would turn the gate into a coin flip).

Content tests read the COMMITTED artifact (no generation, no DB) — the drift
test already proves it equals fresh output, so they hold for both.
"""

from pathlib import Path

import pytest
import yaml
from django.conf import settings
from django.core.management import call_command

BASE_DIR = Path(__file__).resolve().parents[3]
SCHEMA_FILE = BASE_DIR / "schema.yaml"

# One representative path per API context (config/urls.py surface): a context
# silently dropping out of the schema must go red here even though the drift
# test would stay green (drift only compares code vs artifact, not coverage).
CONTEXT_SAMPLE_PATHS = [
    "/api/audit/logs/",
    "/api/core/employees/",
    "/api/operations/roles/",
    "/api/notifications/",
]


@pytest.fixture(scope="module")
def schema():
    return yaml.safe_load(SCHEMA_FILE.read_text(encoding="utf-8"))


def test_schema_is_openapi3_with_pinned_identity(schema):
    assert str(schema["openapi"]).startswith("3."), (
        "schema.yaml is not OpenAPI 3.x — openapi-typescript input contract broken"
    )
    assert schema["info"]["title"] == "VAPS API"
    # Д4: VERSION is static — binding it to pyproject would make every release
    # bump a schema drift. A change here means someone re-wired it.
    assert schema["info"]["version"] == "0.1.0", (
        "SPECTACULAR_SETTINGS VERSION must stay static (Д4): a dynamic version "
        "turns every project-version bump into schema drift"
    )


def test_schema_covers_every_api_context(schema):
    missing = [p for p in CONTEXT_SAMPLE_PATHS if p not in schema["paths"]]
    assert not missing, (
        f"API contexts missing from schema.yaml: {missing} — an entire router "
        "dropped out of the generated contract"
    )
    # Happy path: list endpoint exposes a typed 200 — the shape the frontend
    # codegen turns into response types.
    employees_get = schema["paths"]["/api/core/employees/"]["get"]
    assert "200" in employees_get["responses"], (
        "/api/core/employees/ GET lost its 200 response schema"
    )


def test_component_split_request_active(schema):
    # Д4: COMPONENT_SPLIT_REQUEST=True → separate Request/Response components
    # (correct readOnly typing). Switching it off later would be a mass-drift
    # diff — this assert makes that an explicit decision, not an accident.
    schemas = schema["components"]["schemas"]
    assert "Employee" in schemas
    assert "EmployeeRequest" in schemas, (
        "EmployeeRequest component missing — COMPONENT_SPLIT_REQUEST no longer "
        "active (Д4); switching it off is a mass-drift decision, not a default"
    )


def test_employee_id_is_uuid_string(schema):
    # The frontend tsc contract probe (schema-check.test.mjs, канон L258)
    # relies on Employee.id being a string/uuid — pin the backend half here.
    id_field = schema["components"]["schemas"]["Employee"]["properties"]["id"]
    assert id_field["type"] == "string"
    assert id_field["format"] == "uuid"
    assert id_field["readOnly"] is True


@pytest.mark.skipif(
    settings.DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql",
    reason="schema contract is generated against Postgres (run via `make gate`)",
)
def test_schema_generation_is_deterministic(tmp_path):
    # Two back-to-back generations must be byte-identical: the drift gate
    # compares bytes, so any nondeterminism (dict ordering, timestamps)
    # would make `make gate` flaky-red right after a legitimate `make schema`.
    first_file = tmp_path / "first.yaml"
    second_file = tmp_path / "second.yaml"
    call_command("spectacular", "--file", str(first_file))
    call_command("spectacular", "--file", str(second_file))
    first, second = first_file.read_bytes(), second_file.read_bytes()
    assert first, "spectacular produced EMPTY output — schema generation is broken"
    assert first == second, (
        "spectacular output is NOT deterministic — the byte-level drift gate "
        "cannot work on top of a nondeterministic generator"
    )
