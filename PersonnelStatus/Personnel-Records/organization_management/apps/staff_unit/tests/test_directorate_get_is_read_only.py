"""Список своего подразделения — ЧТЕНИЕ, которое ничего не пишет.

Ручка `_directorate_get` создавала сотруднику без статуса дефолтный «в строю»
прямо во время выдачи списка — и работала не так, как читалась.

`EmployeeStatus.save()` зовёт `full_clean()`, а `created_by` объявлен без
`blank=True` и оттуда не передавался. Поэтому ветка не создавала статус, а
роняла ВЕСЬ список: подразделение, где есть хоть один сотрудник без
действующего статуса, отвечало 500. Следов автосоздания в базе стенда нет ни
одного — 0 записей из 93.

Если бы поле передали, стало бы хуже: запись при чтении делает GET
неповторяемым, а `start_date=today` объявляет «в строю с сегодня» тем, у кого
статус был и завершён.

Здесь сторожится сам инвариант «чтение не пишет», а не конкретная строка кода:
проба считает записи ДО и ПОСЛЕ и требует 200, поэтому переживёт любую
переделку ручки.
"""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


@pytest.fixture
def actor(db):
    return get_user_model().objects.create_superuser(username="read-only-admin")


@pytest.fixture
def scene(db, actor):
    """Три случая рядом: без статуса, с действующим и с отменённым.

    🔴 Все три обязаны быть в фикстуре. На одних только «без статуса» проба
    про отменённый вырождается, а на одних действующих не проверяется ни то,
    ни другое.
    """
    root = Division.objects.create(
        name="Департамент", code="ro-root",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    division = Division.objects.create(
        name="Отдел", code="ro-div",
        division_type=Division.DivisionType.DIVISION, parent=root,
    )
    today = timezone.now().date()

    def person(index, last_name):
        employee = Employee.objects.create(
            personnel_number=f"ro-{index}", last_name=last_name, first_name="Имя",
        )
        StaffUnit.objects.create(division=division, index=index, employee=employee)
        return employee

    bare = person(1, "Безстатусов")

    active = person(2, "Действующев")
    EmployeeStatus.objects.create(
        employee=active,
        status_type=_ST.VACATION,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=5),
        state=_STATE.ACTIVE,
        created_by=actor,
    )

    cancelled = person(3, "Отменёнов")
    EmployeeStatus.objects.create(
        employee=cancelled,
        status_type=_ST.SICK_LEAVE,
        start_date=today - timedelta(days=10),
        end_date=today + timedelta(days=10),
        state=_STATE.CANCELLED,
        created_by=actor,
    )

    return {
        "division": division,
        "bare": bare,
        "active": active,
        "cancelled": cancelled,
        "today": today,
    }


def _get(actor):
    client = APIClient()
    client.force_authenticate(user=actor)
    return client.get(reverse("staffunit-directorate-management"))


def _employee_row(payload, employee):
    for unit in payload["staff_units"]:
        row = unit.get("employee")
        if row is not None and row["id"] == employee.id:
            return row
    raise AssertionError(f"сотрудника {employee.id} нет в ответе — проба вакуумна")


@pytest.mark.django_db
def test_get_does_not_write_statuses(actor, scene):
    before = EmployeeStatus.objects.count()
    assert before == 2, "фикстура изменилась — пересчитайте ожидание"

    first = _get(actor)
    assert first.status_code == 200, first.data
    assert EmployeeStatus.objects.count() == before, (
        "выдача списка создала статус: чтение пишет в базу"
    )

    # Второй запрос — тот же ответ. Прежняя ручка на первом создавала статус, и
    # второй GET возвращал уже ДРУГОЕ.
    second = _get(actor)
    assert EmployeeStatus.objects.count() == before
    assert _employee_row(second.data, scene["bare"]) == _employee_row(
        first.data, scene["bare"]
    ), "повторный GET вернул другое — выдача зависит от предыдущего чтения"


@pytest.mark.django_db
def test_employee_without_status_is_reported_as_such(actor, scene):
    response = _get(actor)

    assert _employee_row(response.data, scene["bare"])["current_status"] is None, (
        "сотруднику без статуса выдумали статус"
    )

    # Отменённый статус — не текущий. Прежняя выборка шла по `-created_at` без
    # оглядки на состояние и отдавала его как действующий.
    assert _employee_row(response.data, scene["cancelled"])["current_status"] is None, (
        "отменённый статус выдан как действующий"
    )

    # Обратная сторона: действующий статус доезжает целиком, вместе с периодом.
    current = _employee_row(response.data, scene["active"])["current_status"]
    assert current is not None, "действующий статус пропал — проба вырождена"
    assert current["status_type"] == _ST.VACATION
    assert current["state"] == _STATE.ACTIVE
    assert str(current["start_date"]) == str(scene["today"] - timedelta(days=1))
    assert str(current["end_date"]) == str(scene["today"] + timedelta(days=5))


@pytest.mark.django_db
def test_completed_status_does_not_shadow_the_active_one(actor, scene):
    """Завершённый статус не подменяет действующий, даже если СОЗДАН позже.

    Прежняя выборка шла по `-created_at` без оглядки на `state` и брала
    последнюю СОЗДАННУЮ запись. Здесь прошлогодний статус заводится после
    действующего — на старом коде списком поехала бы «Учёба».

    🔴 Двух ДЕЙСТВУЮЩИХ статусов проверить нельзя, и это не лень: `save()`
    пересчитывает состояние по датам (прошедший период → `completed`), а
    `clean()` запрещает пересечение активных. Сценарий недостижим через
    модель, и тест на него был бы вакуумным — первая версия этой пробы им и
    была: «второй активный» молча становился завершённым.
    """
    today = scene["today"]
    late = EmployeeStatus.objects.create(
        employee=scene["active"],
        status_type=_ST.TRAINING,
        start_date=today - timedelta(days=365),
        end_date=today - timedelta(days=360),
        created_by=actor,
    )
    # Гвард против вакуума: если бы запись осталась активной, проба проверяла
    # бы не фильтр по состоянию, а выбор из одного варианта.
    late.refresh_from_db()
    assert late.state == _STATE.COMPLETED, "фикстура не даёт завершённого статуса"
    assert late.created_at > scene["active"].statuses.filter(
        state=_STATE.ACTIVE
    ).get().created_at, "завершённый создан не позже действующего — проба вырождена"

    current = _employee_row(_get(actor).data, scene["active"])["current_status"]
    assert current["status_type"] == _ST.VACATION, (
        "текущим стал последний созданный, а не действующий"
    )
