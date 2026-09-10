"""Единый признак увольнения для кадрового ядра и раздела ОМ."""

import pytest

from organization_management.apps.employees.models import Employee


pytestmark = pytest.mark.django_db


def test_fired_employee_is_deactivated_on_partial_card_save():
    """Админка и будущий импорт не должны оставлять уволенного активным.

    Частичное сохранение повторяет старый ``dismiss``: если модель не добавит
    ``is_active`` в ``update_fields``, присвоение в памяти не попадёт в БД.
    """
    employee = Employee.objects.create(
        personnel_number="dismiss-1032",
        last_name="Увольняемый",
        first_name="Сотрудник",
    )

    employee.employment_status = Employee.EmploymentStatus.FIRED
    employee.save(update_fields=["employment_status"])

    employee.refresh_from_db()
    assert employee.is_active is False
