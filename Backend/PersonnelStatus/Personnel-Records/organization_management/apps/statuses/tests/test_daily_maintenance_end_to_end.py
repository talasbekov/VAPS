"""Сквозная проверка ежедневной пары `apply_planned` + `complete_expired`
(Plane №1113): для каждого активного сотрудника — ровно один текущий статус
на сегодняшнюю деловую дату, независимо от того, с чем он встретил день.

Порядок вызовов в тесте повторяет поставленное расписание
(`CELERY_BEAT_SCHEDULE`, test_celery_schedule.py): `apply_planned_statuses` в
00:01, `complete_expired_statuses` следом в 00:15 — активация сегодняшнего
планового статуса идёт ПЕРЕД закрытием вчерашнего, поэтому у сотрудника с
обоими событиями разрыва не образуется.
"""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.application.services import (
    StatusApplicationService,
)
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.selectors import status_on_date

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


@pytest.fixture
def author(db):
    return get_user_model().objects.create_user(username="e2e-author")


@pytest.fixture
def today():
    return timezone.localdate()


def _run_daily_maintenance(target_date):
    service = StatusApplicationService()
    service.apply_planned_statuses(target_date)
    service.complete_expired_statuses(target_date)


def _current_status_count(employee, on_date):
    return EmployeeStatus.objects.filter(
        employee=employee, state=_STATE.ACTIVE
    ).count(), status_on_date(employee.id, on_date)


@pytest.mark.django_db(transaction=True)
def test_employee_without_any_status_keeps_the_one_the_signal_gave(today):
    """Сотрудник без единого статуса — сигнал `give_new_employee_a_status`
    уже выдал ему «В строю» при создании; ежедневная пара его не трогает.

    `transaction=True` обязателен: сигнал вешает работу на
    `transaction.on_commit` (см. `signals.py`), а обычный `django_db` держит
    тест в незакоммиченной транзакции — колбэк тогда не выполняется вовсе.
    """
    employee = Employee.objects.create(
        personnel_number="e2e-none", last_name="Новичков", first_name="Артём"
    )
    baseline = EmployeeStatus.objects.get(employee=employee)
    assert baseline.status_type == _ST.IN_SERVICE

    _run_daily_maintenance(today)

    count, current = _current_status_count(employee, today)
    assert count == 1
    assert current is not None
    assert current.pk == baseline.pk


@pytest.mark.django_db
def test_employee_whose_status_ended_yesterday_gets_a_current_status_today(
    author, today
):
    """Токтаров Азамат: статус истёк вчера, нового планового нет — разрыв
    закрывается «В строю» на сегодня."""
    employee = Employee.objects.create(
        personnel_number="e2e-yesterday", last_name="Токтаров", first_name="Азамат"
    )
    EmployeeStatus.objects.all().filter(employee=employee).delete()
    expired = EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.BUSINESS_TRIP,
        start_date=today - timedelta(days=5),
        end_date=today - timedelta(days=1),
        created_by=author,
    )
    EmployeeStatus.objects.filter(pk=expired.pk).update(state=_STATE.ACTIVE)

    _run_daily_maintenance(today)

    count, current = _current_status_count(employee, today)
    assert count == 1, "у сотрудника должен остаться ровно один текущий статус"
    assert current is not None, "«Текущий статус» не должен быть пуст"
    assert current.status_type == _ST.IN_SERVICE
    assert current.start_date == today


@pytest.mark.django_db
def test_employee_with_a_status_planned_for_today_gets_it_activated(
    author, today
):
    employee = Employee.objects.create(
        personnel_number="e2e-planned", last_name="Плановцев", first_name="Данияр"
    )
    planned = EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.VACATION,
        start_date=today,
        end_date=today + timedelta(days=10),
        state=_STATE.PLANNED,
        created_by=author,
    )

    _run_daily_maintenance(today)

    count, current = _current_status_count(employee, today)
    assert count == 1
    assert current is not None
    assert current.pk == planned.pk
    assert current.status_type == _ST.VACATION


@pytest.mark.django_db(transaction=True)
def test_rerunning_the_daily_pair_twice_is_idempotent(author, today):
    """Повторный прогон того же дня (сбойный воркер, ручной повтор) не
    должен задваивать текущие статусы ни у одного из трёх сценариев.

    `transaction=True` — по той же причине, что и в предыдущем тесте:
    `no_status` полагается на `give_new_employee_a_status`/`on_commit`.
    """
    no_status = Employee.objects.create(
        personnel_number="e2e-idem-0", last_name="А", first_name="А"
    )
    ended_yesterday = Employee.objects.create(
        personnel_number="e2e-idem-1", last_name="Б", first_name="Б"
    )
    EmployeeStatus.objects.filter(employee=ended_yesterday).delete()
    expired = EmployeeStatus.objects.create(
        employee=ended_yesterday,
        status_type=_ST.TRAINING,
        start_date=today - timedelta(days=3),
        end_date=today - timedelta(days=1),
        created_by=author,
    )
    EmployeeStatus.objects.filter(pk=expired.pk).update(state=_STATE.ACTIVE)

    planned_today = Employee.objects.create(
        personnel_number="e2e-idem-2", last_name="В", first_name="В"
    )
    EmployeeStatus.objects.create(
        employee=planned_today,
        status_type=_ST.SICK_LEAVE,
        start_date=today,
        end_date=today + timedelta(days=4),
        state=_STATE.PLANNED,
        created_by=author,
    )

    _run_daily_maintenance(today)
    _run_daily_maintenance(today)  # тот же день, второй раз

    for employee in (no_status, ended_yesterday, planned_today):
        count, current = _current_status_count(employee, today)
        assert count == 1, f"{employee}: повтор прогона задвоил статус"
        assert current is not None, f"{employee}: повтор прогона стёр статус"
