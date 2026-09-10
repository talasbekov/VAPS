"""Единый признак увольнения для кадрового ядра и раздела ОМ."""

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.employees.models import Employee


pytestmark = pytest.mark.django_db


def test_initial_fired_card_is_deactivated_by_normal_save():
    """Admin/import creation may receive an already dismissed employee."""
    employee = Employee.objects.create(
        personnel_number="dismiss-initial-1032",
        last_name="Уволенный",
        first_name="Сразу",
        employment_status=Employee.EmploymentStatus.FIRED,
    )

    employee.refresh_from_db()
    assert employee.is_active is False


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


def test_queryset_update_cannot_store_fired_employee_as_active():
    """Batch imports bypass ``save()``, so the database owns this invariant."""
    employee = Employee.objects.create(
        personnel_number="dismiss-q-1032",
        last_name="Пакетный",
        first_name="Импорт",
    )

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Employee.objects.filter(pk=employee.pk).update(
                employment_status=Employee.EmploymentStatus.FIRED
            )

    employee.refresh_from_db()
    assert employee.employment_status == Employee.EmploymentStatus.WORKING
    assert employee.is_active is True
