"""Одобрение и возврат прикомандирования.

Оба конца пути были сломаны молча: одобрение заводило ДВЕ пересекающиеся
строки статуса, чего EmployeeStatus.clean не допускает, а возврат искал статус
с пустой end_date, которой после одобрения не бывает.
"""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
from organization_management.apps.employees.models import Employee
from organization_management.apps.secondments.models import SecondmentRequest
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

_ST = EmployeeStatus.StatusType


@pytest.fixture
def actor(db):
    return get_user_model().objects.create_superuser(
        username="sec-admin", password="x"
    )


@pytest.fixture
def api(actor):
    client = APIClient()
    client.force_authenticate(user=actor)
    return client


@pytest.fixture
def scene(db, actor):
    home = Division.objects.create(
        name="Родной отдел", code="sec-home", division_type=Division.DivisionType.DIVISION
    )
    host = Division.objects.create(
        name="Принимающий отдел",
        code="sec-host",
        division_type=Division.DivisionType.DIVISION,
    )
    employee = Employee.objects.create(
        personnel_number="sec-1", last_name="Петров", first_name="Пётр"
    )
    StaffUnit.objects.create(division=home, index=1, employee=employee)
    # 🔴 ДЕНЬ БЕРЁТСЯ ТОТ ЖЕ, ЧТО У СЕРВИСА (Plane №816). Здесь стояло
    # `timezone.now().date()` — календарный день по UTC, — а возврат штампует
    # `actual_end_date` днём РАЗДЕЛА (`Clock.today_local()`, зона +05). С
    # 19:00 до 24:00 UTC это РАЗНЫЕ даты, и две пробы файла краснели пять
    # часов в сутки: «assert date(2026, 9, 6) == date(2026, 9, 5)» и «assert
    # 0 == 1» (строка искалась не в том дне).
    #
    # Цена была не в самих пробах, а в доверии к гейту: краснота по часам
    # приучает считать, что «оно всегда такое», и настоящую поломку в это
    # время суток пропустили бы. Тот же класс, что №696 (голый `astimezone()`
    # брал зону ОС) и №581 (дата передачи печаталась в UTC): два источника
    # одного дня обязаны быть одним источником.
    today = Clock.today_local()
    # Действующий статус, поверх которого ляжет откомандирование: именно на
    # пересечении с ним падало одобрение.
    EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.IN_SERVICE,
        start_date=today - timedelta(days=10),
        created_by=actor,
    )
    request = SecondmentRequest.objects.create(
        employee=employee,
        from_division=home,
        to_division=host,
        start_date=today,
        end_date=today + timedelta(days=5),
        reason="Усиление",
        requested_by=actor,
    )
    return {
        "home": home,
        "host": host,
        "employee": employee,
        "request": request,
        "today": today,
    }


def _approve(api, request_id):
    return api.post(
        reverse("secondmentrequest-approve", args=[request_id]), {}, format="json"
    )


@pytest.mark.django_db
def test_approve_creates_single_secondment_status(api, scene):
    response = _approve(api, scene["request"].id)
    assert response.status_code == 200, response.data

    statuses = EmployeeStatus.objects.filter(
        employee=scene["employee"], state=EmployeeStatus.StatusState.ACTIVE
    )
    # Ровно один активный статус: пара строк здесь и роняла одобрение.
    assert statuses.count() == 1
    status = statuses.get()
    assert status.status_type == _ST.SECONDED_TO
    assert status.related_division_id == scene["host"].id


@pytest.mark.django_db
def test_approve_closes_the_previous_status(api, scene):
    _approve(api, scene["request"].id)
    previous = EmployeeStatus.objects.get(
        employee=scene["employee"], status_type=_ST.IN_SERVICE
    )
    assert previous.state == EmployeeStatus.StatusState.COMPLETED
    assert previous.actual_end_date == scene["today"] - timedelta(days=1)


@pytest.mark.django_db
def test_approve_marks_the_request_approved(api, scene):
    _approve(api, scene["request"].id)
    scene["request"].refresh_from_db()
    assert scene["request"].status == SecondmentRequest.ApprovalStatus.APPROVED
    assert scene["request"].approved_at is not None


@pytest.mark.django_db
def test_second_approve_is_rejected(api, scene):
    assert _approve(api, scene["request"].id).status_code == 200
    again = _approve(api, scene["request"].id)
    assert again.status_code == 409
    assert (
        EmployeeStatus.objects.filter(
            employee=scene["employee"], status_type=_ST.SECONDED_TO
        ).count()
        == 1
    )


@pytest.mark.django_db
def test_failed_status_rolls_back_the_approval(api, scene, actor):
    # Конец периода раньше начала — статус не пройдёт валидацию.
    scene["request"].end_date = scene["today"] - timedelta(days=3)
    scene["request"].save(update_fields=["end_date"])

    response = _approve(api, scene["request"].id)
    assert response.status_code == 400
    scene["request"].refresh_from_db()
    # Запрос, помеченный одобренным без статуса, врал бы обеим сторонам.
    assert scene["request"].status == SecondmentRequest.ApprovalStatus.PENDING
    assert not EmployeeStatus.objects.filter(
        employee=scene["employee"], status_type=_ST.SECONDED_TO
    ).exists()


@pytest.mark.django_db
def test_return_ends_the_secondment_and_restores_in_service(api, scene):
    _approve(api, scene["request"].id)
    response = api.post(
        reverse("secondmentrequest-return-employee", args=[scene["request"].id]),
        {"reason": "Отозван"},
        format="json",
    )
    assert response.status_code == 200, response.data

    secondment = EmployeeStatus.objects.get(
        employee=scene["employee"], status_type=_ST.SECONDED_TO
    )
    # Прежняя версия искала статус с пустой end_date и не закрывала ничего.
    assert secondment.actual_end_date == scene["today"]
    assert secondment.state == EmployeeStatus.StatusState.COMPLETED

    # «В строю» с ДНЯ возврата: со смещением на день у вернувшегося не было
    # активного статуса вовсе, и таблица показывала «Не обновлено».
    restored = EmployeeStatus.objects.get(
        employee=scene["employee"],
        status_type=_ST.IN_SERVICE,
        state=EmployeeStatus.StatusState.ACTIVE,
    )
    assert restored.start_date == scene["today"]

    scene["request"].refresh_from_db()
    assert scene["request"].status == SecondmentRequest.ApprovalStatus.CANCELLED


@pytest.mark.django_db
def test_returned_employee_is_in_service_in_the_same_day_report(api, scene):
    from organization_management.apps.reports.infrastructure.data_aggregator import (
        DataAggregator,
    )

    _approve(api, scene["request"].id)
    api.post(
        reverse("secondmentrequest-return-employee", args=[scene["request"].id]),
        {},
        format="json",
    )

    class FakeReport:
        division = None
        division_id = None
        date_from = None
        date_to = scene["today"]

    data = DataAggregator().collect_data(FakeReport())
    home_row = next(r for r in data["rows"] if r["division_id"] == scene["home"].id)
    host_row = next(r for r in data["rows"] if r["division_id"] == scene["host"].id)

    # Завершённое откомандирование закрыто СЕГОДНЯШНИМ числом и в окно даты
    # попадает — в расход человек обязан попасть по действующему статусу.
    assert home_row["in_service"] == 1
    assert home_row["seconded_out"] == 0
    assert host_row["seconded_in"] == 0


@pytest.mark.django_db
def test_approve_over_a_status_started_today(api, scene, actor):
    # Статус, заведённый сегодня, прежняя выборка не трогала (start_date__lt),
    # он оставался активным, и одобрение падало на пересечении. Случай не
    # экзотический: так выглядит любая вторая смена статуса за день.
    EmployeeStatus.objects.filter(employee=scene["employee"]).delete()
    EmployeeStatus.objects.create(
        employee=scene["employee"],
        status_type=_ST.IN_SERVICE,
        start_date=scene["today"],
        created_by=actor,
    )

    response = _approve(api, scene["request"].id)
    assert response.status_code == 200, response.data

    active = EmployeeStatus.objects.filter(
        employee=scene["employee"], state=EmployeeStatus.StatusState.ACTIVE
    )
    assert active.count() == 1
    assert active.get().status_type == _ST.SECONDED_TO
    # Однодневный предшественник отменён, а не завершён: он не продержался
    # ни одного дня, а завершить его «вчера» модель не позволяет.
    superseded = EmployeeStatus.objects.get(
        employee=scene["employee"], status_type=_ST.IN_SERVICE
    )
    assert superseded.state == EmployeeStatus.StatusState.CANCELLED


@pytest.mark.django_db
def test_return_without_active_secondment_conflicts(api, scene):
    response = api.post(
        reverse("secondmentrequest-return-employee", args=[scene["request"].id]),
        {},
        format="json",
    )
    assert response.status_code == 409


@pytest.mark.django_db
def test_host_division_sees_the_person_as_incoming(api, scene):
    from organization_management.apps.reports.infrastructure.data_aggregator import (
        DataAggregator,
    )

    _approve(api, scene["request"].id)

    class FakeReport:
        division = None
        division_id = None
        date_from = None

        def __init__(self, date_to):
            self.date_to = date_to

    data = DataAggregator().collect_data(FakeReport(scene["today"]))
    host_row = next(r for r in data["rows"] if r["division_id"] == scene["host"].id)
    home_row = next(r for r in data["rows"] if r["division_id"] == scene["home"].id)

    assert host_row["seconded_in"] == 1
    assert home_row["seconded_out"] == 1
    # И ни в коем случае не оба сразу у одной стороны.
    assert host_row["seconded_out"] == 0
    assert home_row["seconded_in"] == 0
