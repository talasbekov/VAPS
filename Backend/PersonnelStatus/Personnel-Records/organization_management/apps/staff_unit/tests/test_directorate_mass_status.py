"""Массовое обновление статусов через ручку своего подразделения.

Статусы заводились сериализатором, то есть РЯДОМ с действующим, а модель
пересечения запрещает. Обновление падало на каждом сотруднике, у которого
статус уже был — то есть почти на каждом, — и ручка отвечала 200.
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
    return get_user_model().objects.create_superuser(username="mass-admin")


@pytest.fixture
def scene(db, actor):
    root = Division.objects.create(
        name="Департамент", code="mass-root",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    division = Division.objects.create(
        name="Отдел", code="mass-div",
        division_type=Division.DivisionType.DIVISION, parent=root,
    )
    people = []
    today = timezone.now().date()
    for index in range(1, 3):
        employee = Employee.objects.create(
            personnel_number=f"mass-{index}",
            last_name=f"Массов{index}",
            first_name="Имя",
        )
        StaffUnit.objects.create(division=division, index=index, employee=employee)
        # У каждого УЖЕ есть действующий статус — на нём всё и ломалось.
        EmployeeStatus.objects.create(
            employee=employee,
            status_type=_ST.ON_DUTY,
            start_date=today - timedelta(days=2),
            end_date=today + timedelta(days=2),
            created_by=actor,
        )
        people.append(employee)
    return {"division": division, "people": people, "today": today}


def _patch(actor, payload):
    client = APIClient()
    client.force_authenticate(user=actor)
    return client.put(
        reverse("staffunit-directorate-management"), payload, format="json"
    )


@pytest.mark.django_db
def test_mass_update_replaces_the_current_status(actor, scene):
    today = scene["today"]
    response = _patch(
        actor,
        {
            "employee_statuses": [
                {
                    "employee": person.id,
                    "status_type": _ST.VACATION,
                    "start_date": str(today),
                    "end_date": str(today + timedelta(days=5)),
                }
                for person in scene["people"]
            ]
        },
    )

    assert response.status_code == 200, response.data
    assert response.data["updated"]["statuses"] == 2, response.data
    assert response.data["success"] is True
    assert not response.data.get("errors")

    for person in scene["people"]:
        active = EmployeeStatus.objects.filter(employee=person, state=_STATE.ACTIVE)
        # Ровно один активный: прежний закрыт, новый записан.
        assert active.count() == 1
        assert active.get().status_type == _ST.VACATION


@pytest.mark.django_db
def test_mass_update_reports_failures(actor, scene):
    today = scene["today"]
    response = _patch(
        actor,
        {
            "employee_statuses": [
                {
                    # Конец раньше начала — статус не пройдёт валидацию.
                    "employee": scene["people"][0].id,
                    "status_type": _ST.VACATION,
                    "start_date": str(today),
                    "end_date": str(today - timedelta(days=3)),
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.data["updated"]["statuses"] == 0
    # Ответ обязан нести причину: по нему потребитель решает, был ли успех.
    assert response.data["errors"]
    assert response.data["success"] is False
    assert (
        EmployeeStatus.objects.get(
            employee=scene["people"][0], state=_STATE.ACTIVE
        ).status_type
        == _ST.ON_DUTY
    )


@pytest.mark.django_db
def test_participation_status_is_refused_by_the_personnel_handle(actor, scene):
    """🔴 Plane №757: «Участие в ОМ» кадровой ручкой не ставится.

    Правила статуса привлечения живут в разделе ОМ
    (`status_service._assert_manual_participation`, №737/№663/№664):
    мероприятие обязательно и обязано быть тем, о котором управление просили,
    а вид наряда пишется в строку участия. Эта ручка кадровая и создаёт
    `EmployeeStatus` НАПРЯМУЮ — мимо всех правил разом. Массовая простановка
    на экране «Статусы сотрудников» шла именно сюда, и человек получал
    «привлечён неизвестно куда»: расход считает его занятым, а департамент не
    видит, куда он отдан.

    Отбивается на СЕРВЕРЕ, а не только фильтром списка на экране: проверка,
    которую можно обойти другим клиентом, проверкой не является.

    Мутация: убрать `_refuse_participation_status` из ветки — статус
    запишется, и `EmployeeStatus` с кодом `IN_EVENT` появится в базе.
    """
    today = scene["today"]
    person = scene["people"][0]

    response = _patch(
        actor,
        {
            "employee_statuses": [
                {
                    "employee": person.id,
                    "status_type": "IN_EVENT",
                    "start_date": str(today),
                    "end_date": str(today + timedelta(days=1)),
                }
            ]
        },
    )

    assert response.status_code == 400, response.data
    # 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №840, ревью №825). Здесь стерёгся адрес
    # «Сбор сил на ОМ» — и адрес был НЕВЕРНЫЙ: по решению №737 «Участие в ОМ»
    # проставляет начальник управления, и делает это на ТОМ ЖЕ экране
    # «Статусы сотрудников» — чекбоксами запроса и в окне одного сотрудника.
    # Человек, прочитав прежний отказ, уходил на другой экран искать то, что
    # лежало в соседнем окне. Текст отказа теперь общий на все входы
    # (`statuses/participation_guard.py::REFUSAL`), и пин стережёт его суть.
    assert "кадровой ручкой не ставится" in str(response.data), response.data
    assert not EmployeeStatus.objects.filter(
        employee=person, status_type="IN_EVENT"
    ).exists(), "статус привлечения записан кадровой ручкой"


@pytest.mark.django_db
def test_an_ordinary_status_still_passes_the_same_handle(actor, scene):
    """А обычный статус этой же ручкой ставится — правило не запрещает всё.

    Без этой пробы №757 можно было бы «починить», закрыв ручку целиком, и
    массовая простановка перестала бы работать вовсе.
    """
    today = scene["today"]
    person = scene["people"][0]

    response = _patch(
        actor,
        {
            "employee_statuses": [
                {
                    "employee": person.id,
                    "status_type": _ST.VACATION,
                    "start_date": str(today),
                    "end_date": str(today + timedelta(days=1)),
                }
            ]
        },
    )

    assert response.status_code == 200, response.data
    assert EmployeeStatus.objects.filter(
        employee=person, status_type=_ST.VACATION, state=_STATE.ACTIVE
    ).exists()
