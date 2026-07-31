"""Story 14.8 — REST_AFTER_DUTY conflict (soft+override, existing 3.3/3.4/3.5).

No new conflict mechanism: proves the existing declarative matrix (3.4) and
create_status()'s override machinery (3.5) already correctly handle a manual
USER status overlapping a REAL, OM_AUTO-projected REST_AFTER_DUTY row (14.6).
"""

import datetime
from zoneinfo import ZoneInfo

import pytest

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.duties.services import project_duty_shift
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.statuses.conflict_matrix import HARD_STATUS_TYPE_CODES
from apps.operations.statuses.models import EmployeeStatus, Override, StatusType
from apps.operations.statuses.services.status_service import create_status

pytestmark = pytest.mark.django_db

LOCAL_TZ = ZoneInfo("Asia/Qyzylorda")
_IIN = iter(f"9001015{n:05d}" for n in range(1, 9999))


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
    StatusType.objects.create(
        code="STUDY",
        name="Учёба",
        is_hard_block=False,
        priority=32,
        report_column_code="TRAINING",
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


def make_object(code="OBJ-REST-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=8, **kwargs):
    return DutyPlan.objects.create(object=obj, year=year, month=month, **kwargs)


def test_rest_after_duty_is_classified_as_soft():
    # AC-1: pin — a future story must not silently move REST_AFTER_DUTY into
    # HARD without revisiting this decision.
    assert "REST_AFTER_DUTY" not in HARD_STATUS_TYPE_CODES


def test_manual_status_overlapping_live_rest_after_duty_is_soft_conflict(
    status_types, div
):
    obj = make_object("OBJ-REST-2")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift = DutyShift.objects.create(
        plan=plan,
        employee_id=emp.id,
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=LOCAL_TZ),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)
    rest = EmployeeStatus.objects.get(source_ref=f"REST_AFTER_DUTY:{shift.pk}")

    with clock.override(rest.date_start):
        with pytest.raises(DomainError) as exc_info:
            create_status(
                employee_id=emp.id,
                status_type_code="STUDY",
                date_start=rest.date_start,
                date_end=rest.date_end,
                actor="operator",
            )
    assert exc_info.value.code == "STATUS_OVERLAP_WARNING"
    assert exc_info.value.http_status == 409
    assert exc_info.value.overridable is True


def test_override_bypasses_rest_after_duty_conflict_and_records_override(
    status_types, div
):
    obj = make_object("OBJ-REST-3")
    plan = make_plan(obj)
    emp = make_employee(div)
    shift = DutyShift.objects.create(
        plan=plan,
        employee_id=emp.id,
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=LOCAL_TZ),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)
    rest = EmployeeStatus.objects.get(source_ref=f"REST_AFTER_DUTY:{shift.pk}")

    with clock.override(rest.date_start):
        status = create_status(
            employee_id=emp.id,
            status_type_code="STUDY",
            date_start=rest.date_start,
            date_end=rest.date_end,
            actor="operator",
            override=True,
            override_reason="Учёба важнее отдыха, согласовано.",
        )

    assert EmployeeStatus.objects.filter(pk=status.pk).exists()
    assert Override.objects.filter(status=status, employee_id=emp.id).exists()
