"""Story 2.5 — status truncation on dismissal + cross-context orchestrator."""

import datetime as dt

import pytest
from django.core.exceptions import ValidationError

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.core.selectors import HistoricalEmployeeSelector
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services.dismissal import (
    close_active_statuses_on,
    dismiss_employee,
)

pytestmark = pytest.mark.django_db

D = dt.date(2026, 6, 15)


def _emp(iin, division):
    return Employee.objects.create(
        iin=iin,
        full_name="T",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
    )


@pytest.fixture
def setup():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    return org, div


def test_close_truncates_spanning_status_to_d(setup):
    _, div = setup
    emp = _emp("900101300700", div)
    EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="VACATION",
        date_start=dt.date(2026, 6, 10),
        date_end=dt.date(2026, 6, 20),
    )
    assert close_active_statuses_on(emp.id, on_date=D, actor="op1") == 1
    assert EmployeeStatus.objects.get(employee_id=emp.id).date_end == D


def test_close_leaves_future_past_and_cancelled(setup):
    _, div = setup
    emp = _emp("900101300701", div)
    # future (starts on/after D) — deferred to 3.6 (cancel mechanics)
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=dt.date(2026, 6, 16), date_end=dt.date(2026, 6, 20),
    )
    # past (ended before D) — untouched
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=dt.date(2026, 6, 1), date_end=dt.date(2026, 6, 10),
    )
    # cancelled spanning D — excluded by cancelled_at filter
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="DETACHED",
        date_start=dt.date(2026, 6, 10), date_end=dt.date(2026, 6, 20),
        cancelled_at=dt.datetime(2026, 6, 12, tzinfo=dt.timezone.utc),
    )
    assert close_active_statuses_on(emp.id, on_date=D, actor="op1") == 0


def test_orchestrator_dismisses_and_truncates_statuses(setup):
    _, div = setup
    emp = _emp("900101300702", div)
    EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="VACATION",
        date_start=dt.date(2026, 6, 10),
        date_end=dt.date(2026, 6, 20),
    )
    result = dismiss_employee(emp, date=D, reason="x", actor="op1")
    assert result["statuses_closed"] == 1
    emp.refresh_from_db()
    assert emp.employment_status == Employee.EmploymentStatus.ARCHIVED
    assert emp.id not in HistoricalEmployeeSelector.roster_on(D).get(div.id, [])
    assert EmployeeStatus.objects.get(employee_id=emp.id).date_end == D


def test_close_blank_actor_rejected(setup):
    _, div = setup
    emp = _emp("900101300703", div)
    with pytest.raises(ValidationError):
        close_active_statuses_on(emp.id, on_date=D, actor="")
