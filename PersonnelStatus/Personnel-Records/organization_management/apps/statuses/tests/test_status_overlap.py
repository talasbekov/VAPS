"""Что и когда блокирует создание нового статуса.

Правило «один активный статус» защищает данные, но применялось и к «В строю» —
фоновому состоянию, которое ничего не утверждает. Запланированное «В строю»
без даты конца (его заводит автоматика после досрочного завершения) блокировало
сотруднику ВСЁ, начиная со дня своего начала.
"""
from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.application.services import (
    StatusApplicationService,
)
from organization_management.apps.statuses.models import EmployeeStatus

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


@pytest.fixture
def author(db):
    return get_user_model().objects.create_user(username="ovl-author")


@pytest.fixture
def employee(db):
    return Employee.objects.create(
        personnel_number="ovl-1", last_name="Овлов", first_name="Олег"
    )


@pytest.fixture
def other_division(db):
    return Division.objects.create(
        name="Соседнее", code="ovl-div", division_type=Division.DivisionType.DIVISION
    )


@pytest.fixture
def today():
    return timezone.now().date()


def _plan(employee, author, status_type, start, end):
    """Запланированный статус — заводится напрямую, минуя сервис."""
    return EmployeeStatus.objects.create(
        employee=employee,
        status_type=status_type,
        start_date=start,
        end_date=end,
        state=_STATE.PLANNED,
        created_by=author,
    )


@pytest.mark.django_db
def test_planned_in_service_does_not_block_a_new_status(
    employee, author, today, other_division
):
    # Автоматика после досрочного завершения заводит именно такую строку:
    # «В строю» без даты конца. Она блокировала сотруднику всё до конца времён.
    _plan(employee, author, _ST.IN_SERVICE, today + timedelta(days=1), None)

    status = StatusApplicationService().create_status(
        employee_id=employee.id,
        status_type=_ST.SECONDED_TO,
        start_date=today,
        end_date=today + timedelta(days=5),
        related_division_id=other_division.id,
        user=author,
    )
    assert status.state == _STATE.ACTIVE


@pytest.mark.django_db
def test_superseded_planned_in_service_is_cancelled(
    employee, author, today, other_division
):
    # Оставить её запланированной нельзя: назавтра она бы активировалась
    # поверх откомандирования и снова столкнулась с ним.
    planned = _plan(employee, author, _ST.IN_SERVICE, today + timedelta(days=1), None)

    StatusApplicationService().create_status(
        employee_id=employee.id,
        status_type=_ST.SECONDED_TO,
        start_date=today,
        end_date=today + timedelta(days=5),
        related_division_id=other_division.id,
        user=author,
    )
    planned.refresh_from_db()
    assert planned.state == _STATE.CANCELLED


@pytest.mark.django_db
def test_active_and_planned_in_service_together(
    employee, author, today, other_division
):
    # Боевая связка со стенда: действующее «В строю» и запланированное следом.
    # Закрытие действующего пересохраняет его, а full_clean гоняет ту же
    # проверку пересечений — и валит УЖЕ СУЩЕСТВУЮЩУЮ строку о запланированную.
    # Отказ при этом выглядел так, будто мешает новый статус.
    EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.IN_SERVICE,
        start_date=today,
        created_by=author,
    )
    _plan(employee, author, _ST.IN_SERVICE, today + timedelta(days=1), None)

    status = StatusApplicationService().create_status(
        employee_id=employee.id,
        status_type=_ST.SECONDED_TO,
        start_date=today,
        end_date=today + timedelta(days=3),
        related_division_id=other_division.id,
        user=author,
    )
    assert status.state == _STATE.ACTIVE
    assert (
        EmployeeStatus.objects.filter(
            employee=employee, state=_STATE.ACTIVE
        ).get().status_type
        == _ST.SECONDED_TO
    )


@pytest.mark.django_db
def test_planned_in_service_outside_the_period_survives(
    employee, author, today, other_division
):
    # «В строю» с ПОСЛЕЗАВТРА нового статуса не касается, если тот кончается
    # завтра, — отменять её не за что.
    planned = _plan(employee, author, _ST.IN_SERVICE, today + timedelta(days=10), None)

    StatusApplicationService().create_status(
        employee_id=employee.id,
        status_type=_ST.BUSINESS_TRIP,
        start_date=today,
        end_date=today + timedelta(days=2),
        user=author,
    )
    planned.refresh_from_db()
    assert planned.state == _STATE.PLANNED


@pytest.mark.django_db
def test_planned_vacation_still_blocks(employee, author, today):
    # Реальный запланированный статус — обещание, данное человеку. Затирать
    # его молча хуже отказа.
    _plan(
        employee,
        author,
        _ST.VACATION,
        today + timedelta(days=3),
        today + timedelta(days=10),
    )

    with pytest.raises(ValidationError) as excinfo:
        StatusApplicationService().create_status(
            employee_id=employee.id,
            status_type=_ST.BUSINESS_TRIP,
            start_date=today,
            end_date=today + timedelta(days=5),
            user=author,
        )
    # Отказ обязан называть, ЧТО мешает: без типа и периода спрашивающий не
    # знает, что отменить.
    message = str(excinfo.value)
    assert "Отпуск" in message
    assert str(today + timedelta(days=3)) in message


@pytest.mark.django_db
def test_non_overlapping_planned_vacation_does_not_block(employee, author, today):
    _plan(
        employee,
        author,
        _ST.VACATION,
        today + timedelta(days=30),
        today + timedelta(days=40),
    )

    status = StatusApplicationService().create_status(
        employee_id=employee.id,
        status_type=_ST.BUSINESS_TRIP,
        start_date=today,
        end_date=today + timedelta(days=5),
        user=author,
    )
    assert status.state == _STATE.ACTIVE
