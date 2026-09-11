"""Roster identity and unknown employee facts must survive import (Plane #1175)."""

from datetime import date, datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.services import (
    default_status_start,
    ensure_active_status,
)

pytestmark = pytest.mark.django_db
TODAY = date(2026, 9, 11)


@pytest.fixture
def local_today():
    # UTC is still yesterday: using a UTC date would create a false history.
    with (
        timezone.override("Asia/Almaty"),
        patch(
            "django.utils.timezone.now",
            return_value=datetime(2026, 9, 10, 20, 30, tzinfo=dt_timezone.utc),
        ),
    ):
        yield


def test_external_identity_is_unique_in_database():
    Employee.objects.create(personnel_number="import-1", external_id="xlsx-001")
    with pytest.raises(IntegrityError), transaction.atomic():
        Employee.objects.create(personnel_number="import-2", external_id="xlsx-001")


def test_multiple_employees_can_have_no_external_identity():
    first = Employee.objects.create(personnel_number="import-1")
    second = Employee.objects.create(personnel_number="import-2", external_id=None)
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.external_id is None
    assert second.external_id is None


def test_unknown_import_facts_validate_and_round_trip():
    employee = Employee(
        personnel_number="import-null",
        last_name="Импорт",
        first_name="Тест",
        external_id="x" * 100,
        birth_date=None,
        hire_date=None,
        gender=None,
    )
    employee.full_clean()
    employee.save()
    employee.refresh_from_db()
    assert employee.external_id == "x" * 100
    assert (employee.birth_date, employee.hire_date, employee.gender) == (
        None,
        None,
        None,
    )
    employee.external_id = "x" * 101
    with pytest.raises(ValidationError) as error:
        employee.full_clean()
    assert "external_id" in error.value.message_dict


def test_existing_writers_keep_defaults():
    employee = Employee.objects.create(personnel_number="import-default")
    employee.refresh_from_db()
    assert employee.birth_date == date(1970, 1, 1)
    assert employee.hire_date == date(1970, 1, 1)
    assert employee.gender == Employee.Gender.MALE


def test_unknown_hire_date_gets_one_active_status_on_commit(
    local_today,
    django_capture_on_commit_callbacks,
):
    with django_capture_on_commit_callbacks(execute=True):
        employee = Employee.objects.create(
            personnel_number="import-signal", hire_date=None
        )
        assert not employee.statuses.exists()

    status = employee.statuses.get()
    assert status.status_type == EmployeeStatus.StatusType.IN_SERVICE
    assert status.start_date == TODAY
    assert status.end_date is None
    assert status.state == EmployeeStatus.StatusState.ACTIVE
    assert status.is_active
    assert ensure_active_status(employee) is None
    assert employee.statuses.count() == 1
    employee.refresh_from_db()
    assert employee.hire_date is None


@pytest.mark.parametrize(
    "end,actual_end,state,expected",
    [
        (date(2026, 9, 9), None, "completed", TODAY),
        (date(2026, 9, 20), date(2026, 9, 9), "completed", TODAY),
        (TODAY, None, "completed", date(2026, 9, 12)),
        (date(2026, 9, 20), None, "cancelled", TODAY),
    ],
)
def test_unknown_hire_date_respects_status_ends(
    local_today, end, actual_end, state, expected
):
    employee = Employee.objects.create(
        personnel_number="import-history", hire_date=None
    )
    EmployeeStatus.objects.create(
        employee=employee,
        status_type=EmployeeStatus.StatusType.VACATION,
        start_date=date(2026, 9, 1),
        end_date=end,
        actual_end_date=actual_end,
        state=state,
    )
    assert default_status_start(employee) == expected
    status = ensure_active_status(employee)
    assert status.start_date == expected
    assert status.state == ("active" if expected == TODAY else "planned")
    employee.refresh_from_db()
    assert employee.hire_date is None


def test_unknown_hire_date_allows_valid_historical_status(local_today):
    employee = Employee.objects.create(personnel_number="import-past", hire_date=None)
    status = EmployeeStatus.objects.create(
        employee=employee,
        status_type=EmployeeStatus.StatusType.VACATION,
        start_date=date(1969, 12, 1),
        end_date=date(1969, 12, 10),
    )
    assert status.state == EmployeeStatus.StatusState.COMPLETED


def test_unknown_hire_date_still_requires_absence_end(local_today):
    employee = Employee.objects.create(personnel_number="import-no-end", hire_date=None)
    status = EmployeeStatus(
        employee=employee,
        status_type=EmployeeStatus.StatusType.VACATION,
        start_date=TODAY,
    )
    with pytest.raises(ValidationError) as error:
        status.full_clean()
    assert "end_date" in error.value.message_dict


def test_unknown_hire_date_still_rejects_overlapping_absences(local_today):
    employee = Employee.objects.create(
        personnel_number="import-overlap", hire_date=None
    )
    EmployeeStatus.objects.create(
        employee=employee,
        status_type=EmployeeStatus.StatusType.VACATION,
        start_date=TODAY,
        end_date=date(2026, 9, 15),
    )
    overlapping = EmployeeStatus(
        employee=employee,
        status_type=EmployeeStatus.StatusType.SICK_LEAVE,
        start_date=date(2026, 9, 14),
        end_date=date(2026, 9, 16),
    )
    with pytest.raises(ValidationError) as error:
        overlapping.full_clean()
    assert "start_date" in error.value.message_dict


def test_known_hire_date_still_rejects_earlier_status(local_today):
    employee = Employee.objects.create(personnel_number="import-known", hire_date=TODAY)
    status = EmployeeStatus(
        employee=employee,
        status_type=EmployeeStatus.StatusType.IN_SERVICE,
        start_date=date(2026, 9, 10),
    )
    with pytest.raises(ValidationError) as error:
        status.full_clean()
    assert "start_date" in error.value.message_dict
