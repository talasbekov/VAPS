"""Автоматическое завершение истекших статусов и заполнение разрыва «В строю».

Симметрична `test_apply_planned.py`: до Plane №1113 `complete_expired_statuses`
была ОДНОЙ транзакцией на весь ежедневный прогон — свалившийся на одном
сотруднике гэп-филлер откатывал завершение статусов ВСЕХ остальных. После
Plane №961 (задача больше не глотает исключение и роняется по-настоящему) это
стало бы ежедневным падением всей пачки, а не одной строки.
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

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


@pytest.fixture
def author(db):
    return get_user_model().objects.create_user(username="expire-author")


@pytest.fixture
def employee(db):
    return Employee.objects.create(
        personnel_number="expire-1", last_name="Истёков", first_name="Егор"
    )


@pytest.fixture
def today():
    return timezone.localdate()


def _expired_active(employee, author, end):
    status = EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.VACATION,
        start_date=end - timedelta(days=10),
        end_date=end,
        created_by=author,
    )
    # save() сам вывел бы COMPLETED по прошедшей дате — фикстуре нужен именно
    # истёкший, но ЕЩЁ НЕ ЗАКРЫТЫЙ статус, как его оставляет пропущенный
    # прогон задачи.
    EmployeeStatus.objects.filter(pk=status.pk).update(state=_STATE.ACTIVE)
    status.refresh_from_db()
    return status


@pytest.mark.django_db
def test_expired_status_is_completed_and_gap_filled_with_in_service(
    employee, author, today
):
    expired = _expired_active(employee, author, today - timedelta(days=1))

    completed = StatusApplicationService().complete_expired_statuses(today)

    assert [s.pk for s in completed] == [expired.pk]
    expired.refresh_from_db()
    assert expired.state == _STATE.COMPLETED

    gap_filler = EmployeeStatus.objects.get(
        employee=employee, status_type=_ST.IN_SERVICE, state=_STATE.ACTIVE
    )
    assert gap_filler.start_date == today


@pytest.mark.django_db
def test_rerun_for_the_same_date_is_idempotent(employee, author, today):
    """Повторный дневной прогон не должен плодить вторую «В строю»."""
    _expired_active(employee, author, today - timedelta(days=1))
    service = StatusApplicationService()

    first = service.complete_expired_statuses(today)
    second = service.complete_expired_statuses(today)

    assert len(first) == 1
    assert second == []  # истёкших ACTIVE больше нет — уже COMPLETED
    assert (
        EmployeeStatus.objects.filter(
            employee=employee, status_type=_ST.IN_SERVICE, state=_STATE.ACTIVE
        ).count()
        == 1
    )


@pytest.mark.django_db
def test_one_bad_row_does_not_stop_the_batch(employee, author, today):
    """Один сотрудник с противоречивыми данными не должен ронять всех
    остальных, чей статус в тот же день реально истёк."""
    other = Employee.objects.create(
        personnel_number="expire-2", last_name="Второв", first_name="Иван"
    )
    good = _expired_active(other, author, today - timedelta(days=1))

    bad = _expired_active(employee, author, today - timedelta(days=1))
    # Противоречивая запись: дата приёма сотрудника «переезжает» на завтра —
    # ПОСЛЕ даты, на которую должен встать гэп-филлер «В строю» (`create_status`
    # закрывает прежние активные статусы сам, поэтому конфликт с ними
    # недостижим — единственный проверяемый им запрет, до которого можно
    # дотянуться отсюда, это «начало статуса раньше даты приёма», Plane
    # №1113). Правка ПОСЛЕ создания `bad`: полная валидация проверяет
    # `start_date` относительно даты приёма только в момент сохранения
    # статуса, а не задним числом.
    Employee.objects.filter(pk=employee.pk).update(
        hire_date=today + timedelta(days=1)
    )

    completed = StatusApplicationService().complete_expired_statuses(today)

    assert [s.pk for s in completed] == [good.pk]
    good.refresh_from_db()
    assert good.state == _STATE.COMPLETED
    assert EmployeeStatus.objects.filter(
        employee=other, status_type=_ST.IN_SERVICE, state=_STATE.ACTIVE
    ).exists()

    # Плохая строка не завершена — и это видно, а не тихо потеряно.
    bad.refresh_from_db()
    assert bad.state == _STATE.ACTIVE
