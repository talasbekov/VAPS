"""Story 3.10 — initiate_secondment: paired DETACHED + ATTACHED statuses (FR-14).

Postgres-backed. Covers atomic pair creation + Secondment link (AC-2), the
validations/conflict-before-write (AC-3: same-division 400, receiving-not-found
404, hard overlap 422), and that the pair does NOT self-conflict thanks to
COMPATIBLE_PAIRS (AC-4) — the happy path would 409 on the ATTACHED leg without it.
"""

from datetime import date
from uuid import uuid4

import pytest

from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, Secondment, StatusType
from apps.operations.statuses.services import initiate_secondment

pytestmark = pytest.mark.django_db

START = date(2026, 6, 1)
END = date(2026, 6, 10)

_iin = iter(f"9201013{n:05d}" for n in range(1, 9999))


@pytest.fixture
def env():
    org = Organization.objects.create(name="HQ", code="HQ-310")
    dtp = DivisionType.objects.create(code="mgmt310", name="Управление")
    home = Division.objects.create(
        organization=org, type_code=dtp, name="Home", code="HOME-310"
    )
    recv = Division.objects.create(
        organization=org, type_code=dtp, name="Recv", code="RECV-310"
    )
    StatusType.objects.create(
        code="DETACHED", name="Откомандирован", is_hard_block=False,
        priority=40, report_column_code="DETACHED",
    )
    StatusType.objects.create(
        code="ATTACHED", name="Прикомандирован", is_hard_block=False,
        priority=50, report_column_code="ATTACHED",
    )
    StatusType.objects.create(
        code="VACATION", name="В отпуске", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    return org, home, recv


def _emp(div, **kw):
    return Employee.objects.create(
        iin=next(_iin), full_name="T", rank_code="",
        position_code="", division=div, **kw,
    )


# --- AC-2 + AC-4: atomic linked pair (pair does not self-conflict) -----------


def test_initiate_creates_linked_pair(env):
    _org, home, recv = env
    e = _emp(home)
    sec = initiate_secondment(
        e.id, to_division_id=recv.id,
        date_start=START, date_end=END, actor="op",
    )
    assert isinstance(sec, Secondment)
    assert sec.from_division_id == home.id
    assert sec.to_division_id == recv.id
    assert sec.employee_id == e.id
    # Two linked legs on the same employee, same interval, both USER-sourced.
    assert sec.out_status.status_type_code == "DETACHED"
    assert sec.in_status.status_type_code == "ATTACHED"
    assert sec.out_status.source == EmployeeStatus.Source.USER
    assert sec.in_status.source == EmployeeStatus.Source.USER
    assert sec.out_status.employee_id == e.id
    assert sec.in_status.employee_id == e.id
    assert (sec.out_status.date_start, sec.out_status.date_end) == (START, END)
    # AC-4: pair created without a self-409 (COMPATIBLE_PAIRS load-bearing —
    # the ATTACHED leg is checked against the just-created DETACHED).
    assert EmployeeStatus.objects.filter(employee_id=e.id).count() == 2
    assert Secondment.objects.count() == 1


# --- AC-3: validations / conflict before write -------------------------------


def test_initiate_same_division_400(env):
    _org, home, _recv = env
    e = _emp(home)
    with pytest.raises(DomainError) as ei:
        initiate_secondment(
            e.id, to_division_id=home.id,  # same as from
            date_start=START, date_end=END, actor="op",
        )
    assert ei.value.http_status == 400
    assert ei.value.code == "VALIDATION_ERROR"
    assert EmployeeStatus.objects.count() == 0
    assert Secondment.objects.count() == 0


def test_initiate_unknown_receiving_division_404(env):
    _org, home, _recv = env
    e = _emp(home)
    with pytest.raises(DomainError) as ei:
        initiate_secondment(
            e.id, to_division_id=uuid4(),  # does not exist
            date_start=START, date_end=END, actor="op",
        )
    assert ei.value.http_status == 404
    assert ei.value.code == "ENTITY_NOT_FOUND"
    assert EmployeeStatus.objects.count() == 0


def test_initiate_missing_employee_404(env):
    _org, _home, recv = env
    with pytest.raises(DomainError) as ei:
        initiate_secondment(
            uuid4(), to_division_id=recv.id,
            date_start=START, date_end=END, actor="op",
        )
    assert ei.value.http_status == 404


def test_initiate_empty_actor_400(env):
    _org, home, recv = env
    e = _emp(home)
    with pytest.raises(DomainError) as ei:
        initiate_secondment(
            e.id, to_division_id=recv.id,
            date_start=START, date_end=END, actor="",
        )
    assert ei.value.http_status == 400


def test_initiate_hard_conflict_422_nothing_written(env):
    _org, home, recv = env
    e = _emp(home)
    EmployeeStatus.objects.create(
        employee_id=e.id, status_type_code="VACATION",
        date_start=START, date_end=END,
    )
    with pytest.raises(DomainError) as ei:
        initiate_secondment(
            e.id, to_division_id=recv.id,
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
        )
    assert ei.value.http_status == 422
    assert ei.value.code == "OVERLAPPING_HARD_STATUS"
    # Only the pre-existing VACATION; no legs, no Secondment.
    assert EmployeeStatus.objects.filter(employee_id=e.id).count() == 1
    assert Secondment.objects.count() == 0


def test_initiate_soft_conflict_409_nothing_written(env):
    _org, home, recv = env
    e = _emp(home)
    EmployeeStatus.objects.create(
        employee_id=e.id, status_type_code="STUDY",
        date_start=START, date_end=END,
    )
    with pytest.raises(DomainError) as ei:
        initiate_secondment(
            e.id, to_division_id=recv.id,
            date_start=date(2026, 6, 5), date_end=date(2026, 6, 15), actor="op",
        )
    assert ei.value.http_status == 409
    assert ei.value.code == "STATUS_OVERLAP_WARNING"
    assert Secondment.objects.count() == 0
