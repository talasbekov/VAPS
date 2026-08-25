"""Расстановка по прототипу (задача заказчика Plane №65).

Шаг «Р-1»: строка назначенного на пост несёт подразделение и статус дня.
Оба факта считаются НА ЧТЕНИИ — здесь проверяется именно это: изменение
статуса или перевод сотрудника видны в карточке ОМ без правки самой строки
назначения.
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"
BUSINESS_DATE = "2026-08-10"


def employee_in_division(division, last_name="Абенов"):
    """Сотрудник С подразделением: связь идёт через штатную единицу."""
    employee = make_employee(last_name=last_name)
    StaffUnit.objects.create(
        division=division, employee=employee, index=employee.pk
    )
    return employee


def event_with_assignment(manager, employee):  # noqa: F811
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj, business_date=BUSINESS_DATE).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    post_id = data["reconSectorPosts"][0]["id"]
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.json()
    return base


def test_assignment_carries_division_and_day_status(manager):  # noqa: F811
    """Подразделение и статус дня приезжают вместе с назначением."""
    division = Division.objects.create(
        name="Управление №7", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = employee_in_division(division)
    base = event_with_assignment(manager, employee)

    # Пока статуса нет — «в строю» подписывает клиент, сервер честно молчит.
    fresh = manager.get(base).json()["placementAssignments"][0]
    assert fresh["divisionName"] == "Управление №7"
    assert fresh["statusCode"] is None
    assert fresh["statusLabel"] is None

    StatusType.objects.get_or_create(
        code="VACATION",
        defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"},
    )
    OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="VACATION",
        date_start="2026-08-01",
        date_end="2026-09-01",
    )

    # Строка назначения НЕ переписывалась — статус виден потому, что считается
    # на чтении. Красная проба: сохранить статус в строке при назначении.
    after = manager.get(base).json()["placementAssignments"][0]
    assert after["id"] == fresh["id"]
    assert after["statusCode"] == "VACATION"
    assert after["statusLabel"] == "Отпуск"


def test_status_is_taken_on_the_event_date_not_today(manager):  # noqa: F811
    """Статус спрашивается на ДЕЛОВУЮ дату ОМ, а не на сегодня.

    🔴 Фикстура обязана РАЗВОДИТЬ даты: статус кладётся так, что он накрывает
    сегодняшний день и НЕ накрывает день мероприятия. Пока периоды пересекались,
    подмена даты на `date.today()` проходила зелёной — проба ничего не стерегла.
    """
    division = Division.objects.create(
        name="Управление №8", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = employee_in_division(division, last_name="Сериков")
    base = event_with_assignment(manager, employee)
    StatusType.objects.get_or_create(
        code="SICK_LEAVE",
        defaults={
            "name": "Больничный",
            "priority": 20,
            "report_column_code": "SICK_LEAVE",
        },
    )
    today = dt.date.today()
    assert today.isoformat() != BUSINESS_DATE, "день ОМ совпал с сегодня — проба вакуумна"
    OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="SICK_LEAVE",
        date_start=today - dt.timedelta(days=1),
        date_end=today + dt.timedelta(days=2),
    )

    assert manager.get(base).json()["placementAssignments"][0]["statusCode"] is None


def test_employee_without_division_does_not_break_the_row(manager):  # noqa: F811
    """У сотрудника без штатной единицы подразделение пустое, а не ошибка."""
    employee = make_employee(last_name="Безштатный")
    base = event_with_assignment(manager, employee)

    row = manager.get(base).json()["placementAssignments"][0]

    assert row["divisionName"] == ""
    assert row["employeeName"] != ""
