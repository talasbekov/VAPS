"""Story 3.1 — single DRF exception handler (§36 envelope).

Postgres-backed (ARCH-DATA-020): the AC-1 case drives a real
``excl_hard_status_overlap`` violation so the IntegrityError-by-constraint-name
mapping is proven against actual psycopg3 diagnostics, not a mock.
"""

import datetime
import re
from pathlib import Path

import pytest
from django.conf import settings
from django.db import IntegrityError, OperationalError, transaction
from rest_framework.exceptions import (
    MethodNotAllowed,
    NotFound,
    PermissionDenied,
    ValidationError,
)

from apps.core.api.exception_handler import (
    domain_exception_handler,
    emitted_codes,
)
from apps.core.exceptions import DomainError
from apps.operations.statuses.models.employee_status import EmployeeStatus

pytestmark = pytest.mark.django_db

CTX = {}  # the handler tolerates a minimal/empty DRF context


def _handle(exc):
    return domain_exception_handler(exc, CTX)


def _registry_codes():
    """Top-level error codes from docs/registries/error-codes.yaml (no PyYAML
    dependency — the venv has none; a tiny indent-aware parse suffices)."""
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    codes, in_codes = set(), False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line.startswith(" "):
            in_codes = stripped == "codes:"
            continue
        if in_codes:
            m = re.match(r"^  ([A-Z][A-Z0-9_]*):", line)
            if m:
                codes.add(m.group(1))
    return codes


# -- DomainError → §36 envelope (AC-3) ---------------------------------------


def test_domain_error_renders_section36_envelope():
    resp = _handle(
        DomainError("OVERLAPPING_HARD_STATUS", 422, detail={"employee_id": "x"})
    )
    assert resp.status_code == 422
    body = resp.data
    assert set(body) == {"error_code", "message", "details", "request_id", "timestamp"}
    assert body["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert body["details"] == {"employee_id": "x"}
    assert "overridable" not in body  # property of the code in the registry
    assert body["request_id"] is None  # request-id infra is story 4.3


# -- DRF ValidationError → 400 with field errors in details (AC-2) -----------


def test_drf_validation_error_maps_to_400_field_errors():
    resp = _handle(ValidationError({"starts_at": ["before end"]}))
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"
    assert resp.data["details"] == {"starts_at": ["before end"]}


def test_validation_error_on_field_named_detail_preserves_errors():
    # A serializer field literally named "detail" must not collapse to {} — its
    # errors stay in `details` (the scalar-detail message form is 403/404 only).
    resp = _handle(ValidationError({"detail": ["required"]}))
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"
    assert resp.data["details"] == {"detail": ["required"]}


# -- PermissionDenied → 403 PERMISSION_DENIED (AC-6 regression contract) ------


def test_permission_denied_keeps_403_with_error_code():
    resp = _handle(PermissionDenied("PERMISSION_DENIED"))
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


# -- 404 delegation → ENTITY_NOT_FOUND (AC-7) --------------------------------


def test_not_found_maps_to_404_entity_not_found():
    resp = _handle(NotFound())
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


# -- DRF status without a registry code keeps native shape (AC-7 boundary) ----


def test_method_not_allowed_passes_through_native():
    # 405 has no registry code → keep DRF-native, never fabricate a code.
    resp = _handle(MethodNotAllowed("POST"))
    assert resp.status_code == 405
    assert "error_code" not in resp.data


# -- unknown exception → 500, no internal leak (AC-4 safety) -----------------


def test_unknown_exception_maps_to_500_without_leaking():
    resp = _handle(ValueError("secret stacktrace detail"))
    assert resp.status_code == 500
    assert resp.data["error_code"] == "INTERNAL_ERROR"
    assert "secret" not in str(resp.data)


# -- IntegrityError, unknown constraint → 500 (AC-4) -------------------------


def test_integrity_error_unknown_constraint_is_500():
    # No psycopg diag / unmapped name → must not silently 409; 500 + logged.
    resp = _handle(IntegrityError("some unmapped db error"))
    assert resp.status_code == 500
    assert resp.data["error_code"] == "INTERNAL_ERROR"


# -- OperationalError: ONLY deadlock/serialization → conflict (AC-5) ---------
# Deterministic branch coverage (runs in gate). A real concurrent deadlock
# reproduction is deferred to story 3.14 / ARCH-DEFERRED-044. We assert the
# concrete 422/code (not a re-read of the map) AND that non-conflict
# OperationalError stays 500 — a DB outage must never masquerade as a 422.


class _PgCause(Exception):
    """Stand-in for the psycopg cause carrying a SQLSTATE."""

    def __init__(self, sqlstate):
        self.sqlstate = sqlstate


def _operational_error(sqlstate=None):
    exc = OperationalError("db error")
    if sqlstate is not None:
        exc.__cause__ = _PgCause(sqlstate)
    return exc


def test_deadlock_sqlstate_maps_to_422():
    resp = _handle(_operational_error("40P01"))  # deadlock_detected
    assert resp.status_code == 422
    assert resp.data["error_code"] == "OVERLAPPING_HARD_STATUS"


def test_serialization_failure_sqlstate_maps_to_422():
    resp = _handle(_operational_error("40001"))  # serialization_failure
    assert resp.status_code == 422
    assert resp.data["error_code"] == "OVERLAPPING_HARD_STATUS"


def test_non_conflict_operational_error_is_500_not_422():
    # connection-lost / timeout / shutdown / no-cause must NOT become a 422.
    assert _handle(_operational_error("57P01")).status_code == 500  # admin_shutdown
    assert _handle(_operational_error()).data["error_code"] == "INTERNAL_ERROR"


# -- closed world: every code the handler can emit ∈ registry (AC-8) ---------


def test_emitted_codes_subset_of_registry():
    missing = emitted_codes() - _registry_codes()
    assert not missing, f"codes not in error-codes.yaml: {missing}"


# -- real Postgres constraint violation → 422, not 500 (AC-1) ----------------


def test_real_hard_overlap_maps_to_422_overlapping_hard_status():
    eid = "11111111-1111-1111-1111-111111111111"
    base = dict(employee_id=eid, status_type_code="VACATION")  # hard type
    EmployeeStatus.objects.create(
        date_start=datetime.date(2026, 1, 1),
        date_end=datetime.date(2026, 1, 10),
        **base,
    )
    with pytest.raises(IntegrityError) as ei:
        with transaction.atomic():
            EmployeeStatus.objects.create(
                date_start=datetime.date(2026, 1, 5),
                date_end=datetime.date(2026, 1, 15),
                **base,
            )
    resp = _handle(ei.value)
    assert resp.status_code == 422
    assert resp.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    # Reached via the constraint-name path (not a fallback): details stay empty.
    assert resp.data["details"] == {}
