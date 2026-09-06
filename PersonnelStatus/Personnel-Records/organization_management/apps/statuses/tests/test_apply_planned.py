"""Автоматическая активация запланированных статусов.

Активация — та же смена статуса, что и ручная, но прежний действующий статус
она не закрывала: наутро после запланированного отпуска у человека оказывалось
два активных статуса — отпуск и оставшееся «В строю».
"""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.application.services import (
    StatusApplicationService,
)
from organization_management.apps.statuses.models import (
    EmployeeStatus,
    StatusChangeHistory,
)

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


@pytest.fixture
def author(db):
    return get_user_model().objects.create_user(username="apply-author")


@pytest.fixture
def employee(db):
    return Employee.objects.create(
        personnel_number="apply-1", last_name="Планов", first_name="Пётр"
    )


@pytest.fixture
def today():
    return timezone.localdate()


def _in_service(employee, author, start):
    return EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.IN_SERVICE,
        start_date=start,
        created_by=author,
    )


def _plan(employee, author, status_type, start, end):
    return EmployeeStatus.objects.create(
        employee=employee,
        status_type=status_type,
        start_date=start,
        end_date=end,
        state=_STATE.PLANNED,
        created_by=author,
    )


@pytest.mark.django_db
def test_activation_closes_the_previous_status(employee, author, today):
    previous = _in_service(employee, author, today - timedelta(days=10))
    planned = _plan(
        employee, author, _ST.VACATION, today, today + timedelta(days=5)
    )

    applied = StatusApplicationService().apply_planned_statuses(today)

    assert [s.pk for s in applied] == [planned.pk]
    planned.refresh_from_db()
    previous.refresh_from_db()
    assert planned.state == _STATE.ACTIVE
    # Главное: активных ровно один, а не два.
    assert (
        EmployeeStatus.objects.filter(employee=employee, state=_STATE.ACTIVE).count()
        == 1
    )
    assert previous.state == _STATE.COMPLETED
    assert previous.actual_end_date == today - timedelta(days=1)


@pytest.mark.django_db
def test_activation_does_not_close_the_status_being_applied(
    employee, author, today
):
    # По дате сам активируемый статус подошёл бы под закрывающую выборку;
    # спасает то, что берутся только ACTIVE, а он на этот момент PLANNED.
    planned = _plan(
        employee, author, _ST.VACATION, today, today + timedelta(days=5)
    )
    StatusApplicationService().apply_planned_statuses(today)
    planned.refresh_from_db()
    assert planned.state == _STATE.ACTIVE
    assert planned.actual_end_date is None


@pytest.mark.django_db
def test_expired_planned_status_is_not_activated(employee, author, today):
    # Включать статус, чтобы тут же его завершить, — оставлять в истории
    # активность, которой не было.
    planned = _plan(
        employee,
        author,
        _ST.VACATION,
        today - timedelta(days=10),
        today - timedelta(days=3),
    )
    applied = StatusApplicationService().apply_planned_statuses(today)
    planned.refresh_from_db()
    assert applied == []
    assert planned.state == _STATE.PLANNED


@pytest.mark.django_db
def test_future_planned_status_is_left_alone(employee, author, today):
    planned = _plan(
        employee,
        author,
        _ST.VACATION,
        today + timedelta(days=3),
        today + timedelta(days=5),
    )
    StatusApplicationService().apply_planned_statuses(today)
    planned.refresh_from_db()
    assert planned.state == _STATE.PLANNED


@pytest.mark.django_db
def test_future_target_date_leaves_the_employee_with_a_status(
    employee, author, today
):
    """Прогон «на будущую дату» не должен обезглавить сотрудника.

    EmployeeStatus.save() выводит состояние из ФАКТИЧЕСКОЙ даты, поэтому
    статус с началом в будущем тут же возвращается в «запланирован». Прежний
    к этому моменту уже закрыт — и человек оставался без действующего статуса
    вовсе, а метод отчитывался об успехе.
    """
    previous = _in_service(employee, author, today - timedelta(days=10))
    planned = _plan(
        employee,
        author,
        _ST.VACATION,
        today + timedelta(days=2),
        today + timedelta(days=5),
    )

    applied = StatusApplicationService().apply_planned_statuses(
        today + timedelta(days=2)
    )

    assert applied == []
    previous.refresh_from_db()
    planned.refresh_from_db()
    assert previous.state == _STATE.ACTIVE  # прежний не тронут
    assert planned.state == _STATE.PLANNED
    assert (
        EmployeeStatus.objects.filter(employee=employee, state=_STATE.ACTIVE).count()
        == 1
    )


@pytest.mark.django_db
def test_activation_writes_one_history_record(employee, author, today):
    planned = _plan(
        employee, author, _ST.VACATION, today, today + timedelta(days=5)
    )
    StatusApplicationService().apply_planned_statuses(today)

    modified = StatusChangeHistory.objects.filter(
        status=planned, change_type=StatusChangeHistory.ChangeType.MODIFIED
    )
    # Сигнал log_status_change пишет свою запись на каждое сохранение —
    # без глушителя их было бы две на одно событие.
    assert modified.count() == 1


@pytest.mark.django_db
def test_one_bad_row_does_not_stop_the_batch(employee, author, today):
    """Задача ежедневная и массовая: один сотрудник не должен ронять всех."""
    other = Employee.objects.create(
        personnel_number="apply-2", last_name="Второв", first_name="Иван"
    )
    _in_service(other, author, today - timedelta(days=10))
    good = _plan(other, author, _ST.VACATION, today, today + timedelta(days=5))

    # Противоречивая строка: «В строю» с датой окончания модель запрещает,
    # активация такой строки падает на валидации.
    bad = EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.VACATION,
        start_date=today,
        end_date=today + timedelta(days=2),
        state=_STATE.PLANNED,
        created_by=author,
    )
    EmployeeStatus.objects.filter(pk=bad.pk).update(
        status_type=_ST.IN_SERVICE
    )

    applied = StatusApplicationService().apply_planned_statuses(today)

    assert [s.pk for s in applied] == [good.pk]
    bad.refresh_from_db()
    assert bad.state == _STATE.PLANNED
    good.refresh_from_db()
    assert good.state == _STATE.ACTIVE
