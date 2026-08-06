"""Story 20.5a (FR-40): CoreStaffingSelector.compute_staffing_table() —
штатное расписание (Division x Position: allocated/filled/vacant), 2
bulk-запроса, никакой из существующих функций эту детализацию не даёт
(StrengthReportService/allocated_slots_on — только по управлению)."""

import datetime as dt
import itertools

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeStaffingAssignment,
    Organization,
    Position,
    StaffingSlot,
)
from apps.core.selectors import CoreStaffingSelector, local_midnight

pytestmark = pytest.mark.django_db

TODAY = timezone.now().date()
_iin = itertools.count(1)


def make_division(org, dtp, code):
    return Division.objects.create(
        organization=org, type_code=dtp, name=code, code=code
    )


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="HQ", code="HQ-20-5")
    dtp = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    return org, dtp


def make_position(code, name="Опер"):
    return Position.objects.get_or_create(code=code, defaults={"name": name})[0]


def make_slot(division, position, valid_from=None, valid_to=None, is_active=True):
    return StaffingSlot.objects.create(
        division=division,
        position_code=position,
        valid_from=valid_from or timezone.now() - dt.timedelta(days=30),
        valid_to=valid_to,
        is_active=is_active,
    )


def make_employee(division, position_code):
    return Employee.objects.create(
        iin=f"90010130{next(_iin):04d}",
        full_name="Сотрудник",
        rank_code="",
        position_code=position_code,
        division=division,
    )


def make_assignment(slot, employee, starts_at=None, ends_at=None):
    return EmployeeStaffingAssignment.objects.create(
        employee=employee,
        staffing_slot=slot,
        starts_at=starts_at or timezone.now() - dt.timedelta(days=30),
        ends_at=ends_at,
    )


def test_allocated_and_filled_counts(org_dt):
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-1")
    pos = make_position("OPER-1")
    slots = [make_slot(div, pos) for _ in range(3)]
    for slot in slots[:2]:
        make_assignment(slot, make_employee(div, pos.code))

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    row = next(r for r in result if r["position_code"] == "OPER-1")
    assert row == {
        "division_id": div.id,
        "position_code": "OPER-1",
        "position_name": "Опер",
        "allocated": 3,
        "filled": 2,
        "vacant": 1,
    }


def test_filled_without_allocated_is_visible_as_negative_vacant(org_dt):
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-2")
    pos = make_position("OPER-2")
    # Слот НЕ активен на дату (allocated=0), но назначение на него активно
    # (рассинхрон данных) — строка должна присутствовать явно, не молча.
    slot = make_slot(div, pos, is_active=False)
    make_assignment(slot, make_employee(div, pos.code))

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    row = next(r for r in result if r["position_code"] == "OPER-2")
    assert row["allocated"] == 0
    assert row["filled"] == 1
    assert row["vacant"] == -1


def test_expired_slot_excluded_from_allocated(org_dt):
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-3")
    pos = make_position("OPER-3")
    make_slot(
        div,
        pos,
        valid_from=timezone.now() - dt.timedelta(days=60),
        valid_to=timezone.now() - dt.timedelta(days=1),
    )

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    assert not any(r["position_code"] == "OPER-3" for r in result)


def test_slot_valid_to_exactly_at_midnight_excluded(org_dt):
    # Review (Blind Hunter): точная граница `valid_to == local_midnight(T)`
    # — исторически повторяющийся класс off-by-one багов в этом проекте
    # (memory: сравнение date/DateTimeField на границе полуночи).
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-8")
    pos = make_position("OPER-8")
    make_slot(
        div,
        pos,
        valid_from=timezone.now() - dt.timedelta(days=60),
        valid_to=local_midnight(TODAY),
    )

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    assert not any(r["position_code"] == "OPER-8" for r in result)


def test_assignment_ends_at_exactly_at_midnight_excluded(org_dt):
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-9")
    pos = make_position("OPER-9")
    slot = make_slot(div, pos)
    make_assignment(
        slot,
        make_employee(div, pos.code),
        ends_at=local_midnight(TODAY),
    )

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    row = next(r for r in result if r["position_code"] == "OPER-9")
    assert row["filled"] == 0


def test_ended_assignment_excluded_from_filled(org_dt):
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-4")
    pos = make_position("OPER-4")
    slot = make_slot(div, pos)
    make_assignment(
        slot,
        make_employee(div, pos.code),
        ends_at=timezone.now() - dt.timedelta(days=1),
    )

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    row = next(r for r in result if r["position_code"] == "OPER-4")
    assert row["filled"] == 0
    assert row["allocated"] == 1


def test_isolates_between_divisions_with_same_position(org_dt):
    org, dtp = org_dt
    div_a = make_division(org, dtp, "D20-5-5A")
    div_b = make_division(org, dtp, "D20-5-5B")
    pos = make_position("OPER-5")
    make_slot(div_a, pos)
    for _ in range(2):
        make_slot(div_b, pos)

    result = CoreStaffingSelector.compute_staffing_table(
        TODAY, division_ids=[div_a.id, div_b.id]
    )

    row_a = next(
        r
        for r in result
        if r["division_id"] == div_a.id and r["position_code"] == "OPER-5"
    )
    row_b = next(
        r
        for r in result
        if r["division_id"] == div_b.id and r["position_code"] == "OPER-5"
    )
    assert row_a["allocated"] == 1
    assert row_b["allocated"] == 2


def test_division_ids_filter_scopes_result(org_dt):
    org, dtp = org_dt
    div_a = make_division(org, dtp, "D20-5-6A")
    div_b = make_division(org, dtp, "D20-5-6B")
    pos = make_position("OPER-6")
    make_slot(div_a, pos)
    make_slot(div_b, pos)

    result = CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div_a.id])

    assert all(r["division_id"] == div_a.id for r in result)


def test_exactly_two_queries(org_dt):
    org, dtp = org_dt
    div = make_division(org, dtp, "D20-5-7")
    pos = make_position("OPER-7")
    for _ in range(5):
        slot = make_slot(div, pos)
        make_assignment(slot, make_employee(div, pos.code))

    with CaptureQueriesContext(connection) as ctx:
        CoreStaffingSelector.compute_staffing_table(TODAY, division_ids=[div.id])

    assert len(ctx.captured_queries) == 2
