"""A future return cannot mutate personnel status, history or a return row."""
from datetime import datetime, timedelta, timezone as dt_timezone

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.models import EmployeeStatus, StatusChangeHistory
from organization_management.apps.statuses.selectors import status_on_date

pytestmark = pytest.mark.django_db


@pytest.fixture
def scene(monkeypatch):
    # 00:30 local time: the upper bound must use the local business date.
    monkeypatch.setattr(timezone, "now", lambda: datetime(2026, 10, 18, 19, 30, tzinfo=dt_timezone.utc))
    today = timezone.localdate()
    employee = Employee.objects.create(personnel_number="terminate-dates", last_name="Return", first_name="Today")
    api, user = client_for("terminate-dates", "TERMINATE_DATES", ("status.view", "status.manage"))
    status = StatusApplicationService().create_status(
        employee_id=employee.pk, status_type=EmployeeStatus.StatusType.SICK_LEAVE,
        start_date=today - timedelta(days=3), end_date=today + timedelta(days=5), user=user,
    )
    return today, status, api, user


@pytest.mark.parametrize("entry", ["model", "service", "api"])
def test_future_termination_is_rejected_without_any_persisted_or_in_memory_change(scene, entry):
    today, record, api, user = scene
    before = list(EmployeeStatus.objects.filter(employee=record.employee).order_by("pk").values())
    history = list(StatusChangeHistory.objects.filter(status=record).order_by("pk").values())
    if entry == "api":
        response = api.post(f"/api/statuses/statuses/{record.pk}/terminate/",
                            {"termination_date": (today + timedelta(days=1)).isoformat(), "reason": "Future"}, format="json")
        assert response.status_code == 400, response.data
    else:
        with pytest.raises(ValidationError):
            if entry == "model":
                record.terminate_early(today + timedelta(days=1), "Future", user)
            else:
                StatusApplicationService().terminate_status_early(record.pk, today + timedelta(days=1), "Future", user)
        assert record.state == EmployeeStatus.StatusState.ACTIVE
        assert record.actual_end_date is None
        assert record.early_termination_reason == ""
    assert list(EmployeeStatus.objects.filter(employee=record.employee).order_by("pk").values()) == before
    assert list(StatusChangeHistory.objects.filter(status=record).order_by("pk").values()) == history


@pytest.mark.parametrize("offset", [0, -1])
def test_service_return_begins_on_selected_local_date(scene, offset):
    today, record, _api, user = scene
    selected = today + timedelta(days=offset)
    original_end = record.end_date
    StatusApplicationService().terminate_status_early(record.pk, selected, "Returned", user)
    record.refresh_from_db()
    assert record.state == EmployeeStatus.StatusState.COMPLETED
    assert record.actual_end_date == selected
    assert record.end_date == original_end
    current = status_on_date(record.employee_id, today)
    assert current.status_type == EmployeeStatus.StatusType.IN_SERVICE
    assert current.start_date == selected
    assert current.end_date is None


def test_imported_open_end_also_rejects_future_return(scene):
    today, record, _api, user = scene
    EmployeeStatus.objects.filter(pk=record.pk).update(end_date=None)
    record.refresh_from_db()
    with pytest.raises(ValidationError):
        record.terminate_early(today + timedelta(days=1), "Future", user)
    record.refresh_from_db()
    assert record.actual_end_date is None
    assert record.end_date is None
    assert record.state == EmployeeStatus.StatusState.ACTIVE
