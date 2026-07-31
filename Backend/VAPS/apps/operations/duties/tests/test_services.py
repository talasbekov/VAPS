"""Story 14.6 — OM_AUTO projection service (project_duty_shift/approve_duty_plan)."""

import datetime

import pytest

from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.duties.services import approve_duty_plan, project_duty_shift
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.status_service import cancel_status

pytestmark = pytest.mark.django_db

UTC = datetime.timezone.utc
_IIN = iter(f"9001014{n:05d}" for n in range(1, 9999))


@pytest.fixture
def div(db):
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(organization=org, type_code=dtp, name="D", code="D")


@pytest.fixture
def status_types(db):
    StatusType.objects.create(
        code="DUTY",
        name="На дежурстве",
        is_hard_block=False,
        priority=70,
        report_column_code="ON_DUTY",
    )
    StatusType.objects.create(
        code="REST_AFTER_DUTY",
        name="После дежурства",
        is_hard_block=False,
        priority=60,
        report_column_code="AFTER_DUTY",
    )


def make_employee(division, **kw):
    return Employee.objects.create(
        iin=next(_IIN),
        full_name="T",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
        **kw,
    )


def make_object(code="OBJ-OM-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=8, **kwargs):
    return DutyPlan.objects.create(object=obj, year=year, month=month, **kwargs)


def make_shift(plan, employee_id, starts_at, ends_at, **kwargs):
    return DutyShift.objects.create(
        plan=plan,
        employee_id=employee_id,
        starts_at=starts_at,
        ends_at=ends_at,
        **kwargs,
    )


def test_project_duty_shift_creates_duty_and_rest_after_duty(status_types, div):
    obj = make_object("OBJ-OM-2")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift = make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )

    project_duty_shift(shift)

    duty = EmployeeStatus.objects.get(source_ref=f"DUTY:{shift.pk}")
    assert duty.employee_id == emp.id
    assert duty.status_type_code == "DUTY"
    assert duty.source == EmployeeStatus.Source.OM_AUTO
    assert duty.date_start == datetime.date(2026, 8, 1)
    assert duty.date_end == datetime.date(2026, 8, 2)

    rest = EmployeeStatus.objects.get(source_ref=f"REST_AFTER_DUTY:{shift.pk}")
    assert rest.employee_id == emp.id
    assert rest.status_type_code == "REST_AFTER_DUTY"
    assert rest.source == EmployeeStatus.Source.OM_AUTO
    assert rest.date_start == datetime.date(2026, 8, 1)
    assert rest.date_end == datetime.date(2026, 8, 3)


def test_project_duty_shift_is_idempotent_by_source_ref(status_types, div):
    obj = make_object("OBJ-OM-3")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift = make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )

    project_duty_shift(shift)
    project_duty_shift(shift)

    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").count() == 1
    assert (
        EmployeeStatus.objects.filter(source_ref=f"REST_AFTER_DUTY:{shift.pk}").count()
        == 1
    )


def test_approve_duty_plan_transitions_status_and_projects_shifts(status_types, div):
    obj = make_object("OBJ-OM-4")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift = make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )

    approve_duty_plan(plan)

    plan.refresh_from_db()
    assert plan.status_code == DutyPlan.StatusCode.APPROVED
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").exists()
    assert EmployeeStatus.objects.filter(
        source_ref=f"REST_AFTER_DUTY:{shift.pk}"
    ).exists()


def test_approve_duty_plan_is_idempotent(status_types, div):
    obj = make_object("OBJ-OM-5")
    plan = make_plan(obj)
    emp = make_employee(div)
    make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )

    approve_duty_plan(plan)
    approve_duty_plan(plan)

    plan.refresh_from_db()
    assert plan.status_code == DutyPlan.StatusCode.APPROVED
    assert EmployeeStatus.objects.count() == 2


def test_om_auto_row_is_not_manually_editable(status_types, div):
    # AC-7: single-writer enforcement — an existing guard (assert_user_editable),
    # exercised here against a REALLY projected row, not a new guard.
    obj = make_object("OBJ-OM-6")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift = make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )
    project_duty_shift(shift)
    duty = EmployeeStatus.objects.get(source_ref=f"DUTY:{shift.pk}")

    with pytest.raises(DomainError) as exc_info:
        cancel_status(duty, actor="operator", reason="проверка")
    assert exc_info.value.code == "AUTO_STATUS_READONLY"


def test_overlapping_shifts_both_project_without_conflict_error(status_types, div):
    # AC-8: conflict detection is explicitly out of scope (14.8's territory) —
    # two overlapping shifts for the same employee both project cleanly.
    obj = make_object("OBJ-OM-7")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift_a = make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )
    shift_b = make_shift(
        plan,
        emp.id,
        datetime.datetime(2026, 8, 1, 12, 0, tzinfo=UTC),
        datetime.datetime(2026, 8, 2, 0, 0, tzinfo=UTC),
    )

    project_duty_shift(shift_a)
    project_duty_shift(shift_b)

    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift_a.pk}").exists()
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift_b.pk}").exists()
