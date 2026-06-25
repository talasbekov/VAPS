"""Story 3.8 — bulk_create_statuses: atomic mass status creation, no N+1.

Postgres-backed. Covers atomicity (all-or-nothing), per-row error detail
(409/422 with detail.rows[]), payload-duplicate (400), dismissed (422/row),
cross-division scope (403), aggregate precedence (422 > 409), and the NFR-4
no-N+1 contract (constant SQL query count regardless of row count).
"""

from datetime import date
from uuid import uuid4

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.bulk_status_service import (
    bulk_create_statuses,
)

pytestmark = pytest.mark.django_db

D = date(2026, 6, 5)


@pytest.fixture
def org():
    return Organization.objects.create(name="HQ", code="HQ-38")


@pytest.fixture
def dtp():
    return DivisionType.objects.create(code="mgmt38", name="Управление")


@pytest.fixture
def div(org, dtp):
    return Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-38"
    )


@pytest.fixture
def types(db):
    StatusType.objects.create(
        code="VACATION", name="Отпуск", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    StatusType.objects.create(
        code="CONFERENCE", name="Конференция", is_hard_block=False,
        priority=36, report_column_code="TRAINING", max_duration_days=5,
    )


_iin = iter(f"9001013{n:05d}" for n in range(1, 9999))


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_iin), full_name="T", rank_code="",
        position_code="", division=div, **kw,
    )


def _row(emp, code="STUDY", start=date(2026, 6, 4), end=date(2026, 6, 10)):
    return {
        "employee_id": emp.id, "status_type_code": code,
        "date_start": start, "date_end": end,
    }


def test_bulk_creates_deviations_atomically(div, types):
    emps = [_emp(div) for _ in range(3)]
    created = bulk_create_statuses(
        [_row(e) for e in emps],
        actor="op", business_date=D, allowed_division_ids={div.id},
    )
    assert len(created) == 3
    assert EmployeeStatus.objects.count() == 3
    assert all(
        s.source == EmployeeStatus.Source.USER
        for s in EmployeeStatus.objects.all()
    )


def test_conflict_row_409_nothing_written(div, types):
    e1, e2 = _emp(div), _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e2.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e1), _row(e2, start=date(2026, 6, 5), end=date(2026, 6, 15))],
            actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 409
    assert ei.value.code == "STATUS_OVERLAP_WARNING"
    rows = ei.value.detail["rows"]
    assert any(r["employee_id"] == str(e2.id) for r in rows)
    assert EmployeeStatus.objects.count() == before  # nothing new


def test_duplicate_employee_in_payload_400(div, types):
    e = _emp(div)
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e), _row(e, code="CONFERENCE")],
            actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    assert EmployeeStatus.objects.count() == 0


def test_dismissed_employee_row_422(div, types):
    e = _emp(div, dismissal_date=date(2026, 6, 8))
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e, start=date(2026, 6, 6), end=date(2026, 6, 12))],
            actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 422
    assert ei.value.detail["rows"][0]["code"] == "DATE_OUTSIDE_EMPLOYMENT"
    assert EmployeeStatus.objects.count() == 0


def test_cross_division_row_403(org, dtp, div, types):
    other = Division.objects.create(
        organization=org, type_code=dtp, name="D2", code="D2-38"
    )
    e = _emp(other)
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e)], actor="op", business_date=D,
            allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 403
    assert ei.value.code == "PERMISSION_DENIED"
    assert EmployeeStatus.objects.count() == 0


def test_mixed_errors_aggregate_to_422(div, types):
    e1 = _emp(div, dismissal_date=date(2026, 6, 8))  # row → 422
    e2 = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e2.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )  # e2 row → soft 409
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [
                _row(e1, start=date(2026, 6, 6), end=date(2026, 6, 12)),
                _row(e2, start=date(2026, 6, 5), end=date(2026, 6, 15)),
            ],
            actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 422  # 422 dominates 409
    assert len(ei.value.detail["rows"]) == 2
    assert EmployeeStatus.objects.count() == 1  # only the pre-existing


def test_hard_overlap_row_422(div, types):
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id, status_type_code="VACATION",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e, code="VACATION", start=date(2026, 6, 5), end=date(2026, 6, 15))],
            actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 422
    assert ei.value.detail["rows"][0]["code"] == "OVERLAPPING_HARD_STATUS"


def test_max_duration_exceeded_row_422(div, types):
    # CONFERENCE caps at 5 days (fixture); a 7-day [Jun4, Jun11) row trips the
    # reused _validate_interval before any conflict check → per-row 422.
    e = _emp(div)
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e, code="CONFERENCE", start=date(2026, 6, 4), end=date(2026, 6, 11))],
            actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 422
    assert ei.value.detail["rows"][0]["code"] == "MAX_DURATION_EXCEEDED"
    assert EmployeeStatus.objects.count() == 0


def test_missing_employee_404(div, types):
    fake = type("E", (), {"id": uuid4()})()
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(fake)], actor="op", business_date=D,
            allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 404


def test_empty_payload_400(div, types):
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [], actor="op", business_date=D, allowed_division_ids={div.id}
        )
    assert ei.value.http_status == 400


def test_missing_actor_400(div, types):
    e = _emp(div)
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e)], actor="", business_date=D,
            allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 400


def test_none_business_date_400(div, types):
    # Review patch: a None business_date would reach detect_conflicts as
    # `date > None` → TypeError → 500 (not caught by the per-row except); guard
    # turns it into a clean 400 before any DB work.
    e = _emp(div)
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [_row(e)], actor="op", business_date=None,
            allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    assert EmployeeStatus.objects.count() == 0


def test_missing_required_row_key_400(div, types):
    # Review patch: a row missing a required key would raise KeyError → 500;
    # the up-front shape check surfaces it as a 400 with the offending index.
    e = _emp(div)
    row = _row(e)
    del row["date_end"]
    with pytest.raises(DomainError) as ei:
        bulk_create_statuses(
            [row], actor="op", business_date=D, allowed_division_ids={div.id},
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    assert ei.value.detail["index"] == 0
    assert "date_end" in ei.value.detail["missing"]
    assert EmployeeStatus.objects.count() == 0


def test_query_count_constant_no_n_plus_one(div, types):
    # NFR-4: query count must NOT scale with the number of rows. Assert the
    # captured count is IDENTICAL for 5 and 50 valid rows (an N+1 would make
    # the 50-row run ~45 queries heavier).
    emps5 = [_emp(div) for _ in range(5)]
    with CaptureQueriesContext(connection) as ctx5:
        bulk_create_statuses(
            [_row(e) for e in emps5], actor="op", business_date=D,
            allowed_division_ids={div.id},
        )
    emps50 = [_emp(div) for _ in range(50)]
    with CaptureQueriesContext(connection) as ctx50:
        bulk_create_statuses(
            [_row(e) for e in emps50], actor="op", business_date=D,
            allowed_division_ids={div.id},
        )
    assert len(ctx5) == len(ctx50), (
        f"N+1 detected: 5 rows used {len(ctx5)} queries, "
        f"50 rows used {len(ctx50)}"
    )
    # And the constant is small (lock + types + existing + insert ≈ a handful,
    # plus savepoints) — guards against a "constant but huge" regression.
    assert len(ctx50) <= 10
