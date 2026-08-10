"""Врезка раздела ОМ в увольнение: статусы закрываются по сохранению карточки.

Здесь проверяется только СШИВКА — что переход пойман, дата выбрана и сервис
позван на самом деле. Правила закрытия живут в сервисе и покрыты
test_dismissal.py.
"""
from datetime import date, timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.dismissal import DISMISSAL_REASON
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.signals import SYSTEM_ACTOR
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def employee_in(division):
    employee = make_employee()
    StaffUnit.objects.create(
        division=division, employee=employee, index=employee.id
    )
    return employee


def live_status(employee, start=None, end=None):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="DUTY",
        date_start=TODAY - timedelta(days=2) if start is None else start,
        date_end=TODAY + timedelta(days=5) if end is None else end,
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def fire(employee, **changes):
    for field, value in changes.items():
        setattr(employee, field, value)
    with clock.override(TODAY):
        employee.save()
    return employee


# ── Переход пойман ───────────────────────────────────────────────────────

def test_dismissal_closes_operations_statuses(types, division):
    employee = employee_in(division)
    row = live_status(employee)
    fire(
        employee,
        employment_status=Employee.EmploymentStatus.FIRED,
        dismissal_date=TODAY + timedelta(days=1),
    )
    row.refresh_from_db()
    # Усечено датой из карточки, а не сегодняшним числом.
    assert row.date_end == TODAY + timedelta(days=1)


def test_empty_dismissal_date_falls_back_to_today(types, division):
    # Старый путь увольнения даты не требует: без неё закрываем сегодняшним
    # числом по часам РАЗДЕЛА (подмена часов в тесте это доказывает).
    employee = employee_in(division)
    row = live_status(employee)
    fire(employee, employment_status=Employee.EmploymentStatus.FIRED)
    row.refresh_from_db()
    assert row.date_end == TODAY


def test_dismissal_date_alone_triggers_the_closing(types, division):
    # Второе плечо условия: дата появилась, а статус занятости не менялся.
    employee = employee_in(division)
    row = live_status(employee)
    fire(employee, dismissal_date=TODAY)
    row.refresh_from_db()
    assert row.date_end == TODAY


def test_future_status_is_cancelled_by_the_system_actor(types, division):
    employee = employee_in(division)
    row = live_status(
        employee, start=TODAY + timedelta(days=3), end=TODAY + timedelta(days=6)
    )
    fire(employee, employment_status=Employee.EmploymentStatus.FIRED)
    row.refresh_from_db()
    assert row.cancelled_reason == DISMISSAL_REASON
    # Метка системного закрытия НЕ числовая: её нельзя спутать с id человека.
    assert row.cancelled_by == SYSTEM_ACTOR
    assert not SYSTEM_ACTOR.isdigit()


# ── Перехода нет — раздел не трогают ─────────────────────────────────────

def test_ordinary_save_changes_nothing(types, division):
    employee = employee_in(division)
    row = live_status(employee)
    fire(employee, work_phone="+7 700 000 00 00")
    row.refresh_from_db()
    assert row.date_end == TODAY + timedelta(days=5)
    assert row.cancelled_at is None


def test_second_save_of_a_dismissed_card_is_not_a_transition(types, division):
    employee = employee_in(division)
    row = live_status(employee)
    fire(employee, employment_status=Employee.EmploymentStatus.FIRED)
    row.refresh_from_db()
    closed_at = row.date_end

    # Карточку сохранили ещё раз, уже с другой датой увольнения: перехода нет,
    # и раздел второй раз не переписывает свои факты.
    fire(employee, dismissal_date=TODAY + timedelta(days=3))
    row.refresh_from_db()
    assert row.date_end == closed_at


def test_new_dismissed_card_does_not_break_creation(types, division):
    # Карточка, созданная сразу уволенной: закрывать нечего, и приёмник не
    # должен падать на ещё не существующей строке.
    employee = Employee.objects.create(
        first_name="Пётр",
        last_name="Петров",
        personnel_number="P99999",
        iin="999999999999",
        hire_date=date(2020, 1, 1),
        employment_status=Employee.EmploymentStatus.FIRED,
        dismissal_date=TODAY,
    )
    assert employee.pk is not None
    assert not OpsEmployeeStatus.objects.filter(employee_id=employee.pk).exists()


def test_employee_without_operations_facts_is_saved_normally(types, division):
    employee = employee_in(division)
    fire(employee, employment_status=Employee.EmploymentStatus.FIRED)
    employee.refresh_from_db()
    # Старая логика не сломана: карточка записана как обычно.
    assert employee.employment_status == Employee.EmploymentStatus.FIRED


# ── Атомарность ──────────────────────────────────────────────────────────

def test_failed_closing_rolls_back_the_card_inside_a_transaction(
    types, division, monkeypatch
):
    # Гарантия ровно такая, какой она есть: сохранение, обёрнутое в
    # транзакцию, откатывается ЦЕЛИКОМ, если закрытие раздела упало —
    # карточка остаётся работающей. Ассерт именно на КАРТОЧКЕ: проверять
    # только статус было бы вакуумно, ведь до его правки дело и не дошло.
    from django.db import transaction

    from organization_management.apps.operations import signals

    employee = employee_in(division)
    row = live_status(employee)

    def boom(*args, **kwargs):
        raise RuntimeError("сбой закрытия раздела")

    monkeypatch.setattr(signals, "close_statuses_on_dismissal", boom)
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            fire(employee, employment_status=Employee.EmploymentStatus.FIRED)

    employee.refresh_from_db()
    assert employee.employment_status == Employee.EmploymentStatus.WORKING
    row.refresh_from_db()
    assert row.date_end == TODAY + timedelta(days=5)
