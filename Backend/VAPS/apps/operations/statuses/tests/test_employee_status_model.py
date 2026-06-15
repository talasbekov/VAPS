import uuid
from datetime import date, datetime, timezone

import pytest
from django.db import DataError, IntegrityError, transaction

from apps.operations.statuses.models import EmployeeStatus


def _create(**kwargs):
    defaults = {
        "employee_id": uuid.uuid4(),
        "status_type_code": "VACATION",
        "date_start": date(2026, 6, 1),
        "date_end": date(2026, 6, 15),
    }
    defaults.update(kwargs)
    return EmployeeStatus.objects.create(**defaults)


@pytest.mark.django_db
def test_hard_overlap_sequential_raises_named_constraint():
    employee = uuid.uuid4()
    _create(employee_id=employee, status_type_code="VACATION")
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _create(
                employee_id=employee,
                status_type_code="SICK_LEAVE",
                date_start=date(2026, 6, 10),
                date_end=date(2026, 6, 20),
            )
    assert "excl_hard_status_overlap" in str(excinfo.value)


@pytest.mark.django_db
def test_adjacent_hard_intervals_pass():
    # AC-2: [a,b) + [b,c) are adjacent, not overlapping.
    employee = uuid.uuid4()
    _create(
        employee_id=employee,
        status_type_code="VACATION",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 15),
    )
    _create(
        employee_id=employee,
        status_type_code="COMMAND",
        date_start=date(2026, 6, 15),
        date_end=date(2026, 6, 20),
    )
    assert EmployeeStatus.objects.filter(employee_id=employee).count() == 2


@pytest.mark.django_db
def test_soft_over_hard_overlap_passes():
    # Constraint is a hard×hard backstop only; soft conflicts are 3.4's job.
    employee = uuid.uuid4()
    _create(employee_id=employee, status_type_code="VACATION")
    _create(
        employee_id=employee,
        status_type_code="STUDY",
        date_start=date(2026, 6, 5),
        date_end=date(2026, 6, 10),
    )
    assert EmployeeStatus.objects.filter(employee_id=employee).count() == 2


@pytest.mark.django_db
def test_cancelled_hard_excluded_from_constraint():
    employee = uuid.uuid4()
    _create(
        employee_id=employee,
        status_type_code="VACATION",
        cancelled_at=datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
    )
    _create(
        employee_id=employee,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 6, 5),
        date_end=date(2026, 6, 10),
    )
    assert EmployeeStatus.objects.filter(employee_id=employee).count() == 2


@pytest.mark.django_db
def test_same_hard_interval_other_employee_passes():
    _create(status_type_code="VACATION")
    _create(status_type_code="VACATION")  # fresh employee_id per call
    assert EmployeeStatus.objects.count() == 2


@pytest.mark.django_db
def test_empty_interval_rejected_by_chk_status_dates():
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _create(date_start=date(2026, 6, 1), date_end=date(2026, 6, 1))
    assert "chk_status_dates" in str(excinfo.value)


@pytest.mark.django_db
def test_reversed_interval_fails_in_generated_period_not_chk():
    # start > end blows up while computing the persisted daterange column,
    # BEFORE chk_status_dates runs: DataError (22000), not IntegrityError —
    # 3.1's IntegrityError-name mapping will not see this path (deferred).
    with pytest.raises(DataError) as excinfo:
        with transaction.atomic():
            _create(date_start=date(2026, 6, 15), date_end=date(2026, 6, 1))
    assert "chk_status_dates" not in str(excinfo.value)


@pytest.mark.django_db
def test_update_dates_into_overlap_rejected():
    # Postgres re-checks the exclusion constraint on UPDATE as well.
    employee = uuid.uuid4()
    _create(employee_id=employee, status_type_code="VACATION")
    second = _create(
        employee_id=employee,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 6, 20),
        date_end=date(2026, 6, 25),
    )
    second.date_start = date(2026, 6, 10)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            second.save()
    assert "excl_hard_status_overlap" in str(excinfo.value)


@pytest.mark.django_db
def test_uncancel_into_overlap_rejected():
    employee = uuid.uuid4()
    cancelled = _create(
        employee_id=employee,
        status_type_code="VACATION",
        cancelled_at=datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc),
    )
    _create(
        employee_id=employee,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 6, 5),
        date_end=date(2026, 6, 10),
    )
    cancelled.cancelled_at = None
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            cancelled.save()
    assert "excl_hard_status_overlap" in str(excinfo.value)


@pytest.mark.django_db
def test_soft_to_hard_over_overlap_rejected():
    employee = uuid.uuid4()
    _create(employee_id=employee, status_type_code="VACATION")
    soft = _create(
        employee_id=employee,
        status_type_code="STUDY",
        date_start=date(2026, 6, 5),
        date_end=date(2026, 6, 10),
    )
    soft.status_type_code = "SICK_LEAVE"
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            soft.save()
    assert "excl_hard_status_overlap" in str(excinfo.value)


@pytest.mark.django_db
def test_one_day_interval_is_valid():
    status = _create(date_start=date(2026, 6, 1), date_end=date(2026, 6, 2))
    assert status.pk is not None


@pytest.mark.django_db
def test_period_is_half_open_and_created_by_inherited():
    status = _create(created_by="user-42")
    status.refresh_from_db()
    assert status.period.lower == date(2026, 6, 1)
    assert status.period.upper == date(2026, 6, 15)
    assert status.period.lower_inc
    assert not status.period.upper_inc
    assert status.created_by == "user-42"
