"""Story 3.5 — Override-сущность: bypass soft-409 with a reason + record it.

Postgres-backed (ARCH-DATA-020). Covers: soft-409 bypass creates an Override
record (AC-1), empty reason → 400 (AC-2), hard is NEVER overridable (AC-3),
no conflict → no record (AC-4), override=False unchanged (AC-5), atomicity.
"""

from datetime import date

import pytest

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, Override, StatusType
from apps.operations.statuses.services import status_service
from apps.operations.statuses.services.status_service import create_status

pytestmark = pytest.mark.django_db


@pytest.fixture
def env(db):
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D"
    )
    StatusType.objects.create(
        code="VACATION", name="В отпуске", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    return div


_IIN = iter(f"9201013{n:05d}" for n in range(1, 9999))


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_IIN), full_name="T", rank_code="MAJOR",
        position_code="OPER", division=div, **kw,
    )


def _seed_active_soft(emp):
    """A soft (STUDY) status that is ACTIVE on business date 2026-06-05."""
    with clock.override(date(2026, 6, 5)):
        create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )


# -- AC-1: soft bypass + Override record --------------------------------------


def test_override_soft_conflict_creates_record(env):
    emp = _emp(env)
    _seed_active_soft(emp)
    with clock.override(date(2026, 6, 5)):
        status = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
            override=True, override_reason="приказ командира №7",
        )
    assert status.pk is not None
    ov = Override.objects.get(status=status)
    assert ov.employee_id == emp.id
    assert ov.status_type_code == "STUDY"
    assert ov.reason == "приказ командира №7"
    assert ov.created_by == "op"
    # conflicts[] snapshots the bypassed soft conflict (the existing STUDY).
    assert len(ov.conflicts) == 1
    assert ov.conflicts[0]["status_type"] == "STUDY"
    assert ov.conflicts[0]["date_start"] == "2026-06-01"


# -- AC-2: empty / whitespace reason → 400 ------------------------------------


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_override_without_reason_is_400(env, reason):
    emp = _emp(env)
    _seed_active_soft(emp)
    with clock.override(date(2026, 6, 5)):
        with pytest.raises(DomainError) as ei:
            create_status(
                employee_id=emp.id, status_type_code="STUDY",
                date_start=date(2026, 6, 5), date_end=date(2026, 6, 15),
                actor="op", override=True, override_reason=reason,
            )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    # nothing created beyond the seeded status; no override
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1
    assert Override.objects.count() == 0


# -- AC-3: hard is NEVER overridable ------------------------------------------


def test_override_does_not_bypass_hard(env):
    emp = _emp(env)
    create_status(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
    )
    with pytest.raises(DomainError) as ei:
        create_status(
            employee_id=emp.id, status_type_code="VACATION",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15),
            actor="op", override=True, override_reason="хочу обойти",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "OVERLAPPING_HARD_STATUS"
    assert Override.objects.count() == 0


# -- AC-4: override=true but no conflict → no record --------------------------


def test_override_without_conflict_creates_no_record(env):
    emp = _emp(env)
    status = create_status(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        override=True, override_reason="на всякий случай",
    )
    assert status.pk is not None
    assert Override.objects.count() == 0  # nothing was overridden


# -- AC-5: override=False (default) leaves 3.4 behavior intact ----------------


def test_default_no_override_soft_still_409(env):
    emp = _emp(env)
    _seed_active_soft(emp)
    with clock.override(date(2026, 6, 5)):
        with pytest.raises(DomainError) as ei:
            create_status(
                employee_id=emp.id, status_type_code="STUDY",
                date_start=date(2026, 6, 5), date_end=date(2026, 6, 15),
                actor="op",
            )
    assert ei.value.http_status == 409
    assert Override.objects.count() == 0


# -- AC-1 atomicity: Override write failure rolls back the status -------------


def test_override_record_failure_rolls_back_status(env, monkeypatch):
    emp = _emp(env)
    _seed_active_soft(emp)

    class _Boom(Exception):
        pass

    def boom(*a, **kw):
        raise _Boom()

    monkeypatch.setattr(Override.objects, "create", boom)
    with clock.override(date(2026, 6, 5)):
        with pytest.raises(_Boom):
            create_status(
                employee_id=emp.id, status_type_code="STUDY",
                date_start=date(2026, 6, 5), date_end=date(2026, 6, 15),
                actor="op", override=True, override_reason="откатись",
            )
    # the new status was rolled back with the failed Override (atomic); only the
    # seeded status remains — and the specific [Jun5, …) row is gone, not just
    # "some count" (proves the new INSERT was undone, not merely unchanged).
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1
    assert not EmployeeStatus.objects.filter(
        employee_id=emp.id, date_start=date(2026, 6, 5)
    ).exists()
    assert Override.objects.count() == 0


def test_override_snapshot_records_the_conflicting_type_not_the_new(env):
    # Lock the snapshot semantics: status_type_code = the NEW status; the
    # conflicts[] snapshot carries the EXISTING (bypassed) type — a self-overlap
    # test (STUDY×STUDY) can't tell them apart, so use distinct soft types.
    emp = _emp(env)
    StatusType.objects.create(
        code="CONFERENCE", name="Конференция", is_hard_block=False,
        priority=36, report_column_code="TRAINING",
    )
    with clock.override(date(2026, 6, 5)):
        create_status(
            employee_id=emp.id, status_type_code="CONFERENCE",
            date_start=date(2026, 6, 1), date_end=date(2026, 6, 10), actor="op",
        )
        status = create_status(
            employee_id=emp.id, status_type_code="STUDY",
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
            override=True, override_reason="разрешено",
        )
    ov = Override.objects.get(status=status)
    assert ov.status_type_code == "STUDY"  # the NEW status
    assert [c["status_type"] for c in ov.conflicts] == ["CONFERENCE"]  # bypassed


def test_override_is_exported():
    # closed-world wiring: Override is importable from the models package.
    assert status_service.Override is Override
