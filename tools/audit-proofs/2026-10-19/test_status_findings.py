"""Opt-in audit proofs: expected-correct assertions intentionally expose bugs.

Run ONLY against a disposable test PostgreSQL, using the backend pytest.ini.
No Celery tasks are queued. Only this evidence file is added by the audit.
Sources: reports/infrastructure/data_aggregator.py:197;
statuses/models.py:333; statuses/application/services.py:788.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace

import pytest
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.reports.infrastructure.data_aggregator import DataAggregator
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.selectors import status_on_date

pytestmark = pytest.mark.django_db
URL = "/api/statuses/statuses/"
FROZEN = datetime(2026, 10, 19, 7, tzinfo=dt_timezone.utc)


@pytest.fixture
def today(monkeypatch):
    # Both halves of the application must observe the same local business date.
    monkeypatch.setattr(timezone, "now", lambda: FROZEN)
    with clock.override(FROZEN):
        assert Clock.today_local() == timezone.localdate()
        yield Clock.today_local()


@pytest.fixture
def world(today):
    division = Division.objects.create(
        name="Audit proof division", code="audit19-status-proof"
    )
    employee = Employee.objects.create(
        personnel_number="audit19-status-proof",
        last_name="Audit", first_name="Proof",
        hire_date=today - timedelta(days=365),
        employment_status=Employee.EmploymentStatus.WORKING,
    )
    StaffUnit.objects.create(division=division, employee=employee, index=1)
    api, user = client_for(
        "audit19-status-proof",
        "AUDIT19_STATUS_PROOF",
        perms=("status.view", "status.manage"),
        scope_division_id=division.pk,
    )
    # Exercise the real migration-seeded duty type, rather than inventing it.
    duty = StatusType.objects.get(code="DUTY_DAILY")
    assert duty.is_active and duty.report_column_code == "ON_DUTY"
    assert not duty.legacy_code
    return SimpleNamespace(
        division=division, employee=employee, api=api, user=user,
        service=StatusApplicationService(),
    )


def make_status(world, today, code=EmployeeStatus.StatusType.SICK_LEAVE):
    return world.service.create_status(
        employee_id=world.employee.pk,
        status_type=code,
        start_date=today - timedelta(days=5),
        end_date=today + timedelta(days=5),
        user=world.user,
    )


def dashboard(world):
    response = world.api.get(URL + "absence_statistics/")
    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["staff_count"] == 1
    return payload


def report_row(world, today):
    report = SimpleNamespace(
        division=world.division, division_id=world.division.pk,
        date_from=None, date_to=today,
    )
    data = DataAggregator().collect_data(report)
    return next(
        row for row in data["rows"]
        if row["division_id"] == world.division.pk
    )


def test_report_seeded_duty_uses_catalog_on_duty_column(world, today):
    make_status(world, today, "DUTY_DAILY")
    row = report_row(world, today)  # Existing implementation raises KeyError.
    assert row["on_duty"] == 1
    assert row["headcount"] == 1
    assert row["in_service"] == 0


def test_report_legacy_on_duty_control(world, today):
    make_status(world, today, EmployeeStatus.StatusType.ON_DUTY)
    row = report_row(world, today)
    assert row["on_duty"] == row["headcount"] == 1
    assert row["in_service"] == 0


def test_personnel_future_termination_is_refused_without_state_change(world, today):
    status = make_status(world, today)
    original_end = status.end_date
    original_count = EmployeeStatus.objects.filter(employee=world.employee).count()
    response = world.api.post(
        f"{URL}{status.pk}/terminate/",
        {"termination_date": (today + timedelta(days=2)).isoformat(),
         "reason": "Future return must not complete today's status"},
        format="json",
    )
    status.refresh_from_db()
    assert (
        response.status_code,
        status.state,
        status.actual_end_date,
        status.end_date,
        EmployeeStatus.objects.filter(employee=world.employee).count(),
    ) == (
        400, EmployeeStatus.StatusState.ACTIVE, None,
        original_end, original_count,
    ), response.content
    assert status_on_date(world.employee.pk, today).pk == status.pk


def test_personnel_same_day_termination_control(world, today):
    status = make_status(world, today)
    response = world.api.post(
        f"{URL}{status.pk}/terminate/",
        {"termination_date": today.isoformat(), "reason": "Returned today"},
        format="json",
    )
    assert response.status_code == 200, response.content
    status.refresh_from_db()
    assert status.state == EmployeeStatus.StatusState.COMPLETED
    assert status.actual_end_date == today
    current = status_on_date(world.employee.pk, today)
    assert current is not None
    assert current.status_type == EmployeeStatus.StatusType.IN_SERVICE
    assert current.start_date == today


def test_dashboard_excludes_cancelled_plan_when_scheduled_day_arrives(
    world, today, monkeypatch
):
    # Plan and cancel before the period begins, then read today's real API.
    earlier = FROZEN - timedelta(days=2)
    with monkeypatch.context() as earlier_clock:
        earlier_clock.setattr(timezone, "now", lambda: earlier)
        with clock.override(earlier):
            planned = world.service.plan_status(
                employee_id=world.employee.pk,
                status_type=EmployeeStatus.StatusType.SICK_LEAVE,
                start_date=today - timedelta(days=1),
                end_date=today + timedelta(days=5),
                user=world.user,
            )
            world.service.cancel_status(
                planned.pk, reason="Cancelled before start", user=world.user
            )
    planned.refresh_from_db()
    assert planned.state == EmployeeStatus.StatusState.CANCELLED
    result = dashboard(world)
    assert result["total_absences"] == 0, result
    assert sum(result["by_type"].values()) == 0, result


def test_dashboard_excludes_absence_that_ended_yesterday(world, today):
    status = make_status(world, today)
    world.service.terminate_status_early(
        status.pk, today - timedelta(days=1),
        reason="Returned yesterday", user=world.user,
    )
    current = status_on_date(world.employee.pk, today)
    assert current is not None
    assert current.status_type == EmployeeStatus.StatusType.IN_SERVICE
    result = dashboard(world)
    assert result["total_absences"] == 0, result
    assert sum(result["by_type"].values()) == 0, result


def test_dashboard_seeded_duty_has_consistent_dynamic_breakdown(world, today):
    make_status(world, today, "DUTY_DAILY")
    result = dashboard(world)
    # Keep the endpoint's established non-IN_SERVICE status counting contract;
    # either a dynamic code or normalized duty group must reconcile the total.
    assert result["total_absences"] == 1, result
    assert sum(result["by_type"].values()) == result["total_absences"], result


def test_dashboard_active_absence_control(world, today):
    make_status(world, today)
    result = dashboard(world)
    assert result["total_absences"] == 1, result
    assert result["by_type"][EmployeeStatus.StatusType.SICK_LEAVE] == 1, result
    assert sum(result["by_type"].values()) == 1, result
