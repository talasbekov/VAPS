"""Кадровая ручка статусов пишет ТОЛЬКО под `status.manage` (Plane №938).

Заказчик: «пользователь `acc_employee` с ролью сотрудник не должен изменять
статусы сотрудников в модуле Статусы сотрудников. Он должен только наблюдать».

🔴 ЧТО БЫЛО. Экран это уже держал: без `status.manage` меню строки отвечает
«Только просмотр — правка статусов закрыта», и проба `access-matrix-menu` это
стережёт. А сервер — нет: все девять действий записи `EmployeeStatusViewSet`
(`create`, `update`, `partial_update`, `destroy`, `extend`, `terminate`,
`cancel`, `upload_document`, `bulk_plan`) шли под одним `IsAuthenticated`.
Проверено на стенде: `POST /api/statuses/statuses/` под `acc_employee` отвечал
400 по валидации формы — то есть запись ПРИНИМАЛАСЬ, не хватало только полей.
Проверка, которую обходят другим клиентом, проверкой не является (№757, №840):
дверь закрывается на сервере.

ПРАВИЛО — то же, что у ручки раздела ОМ (`operations/api/views.py`,
`StatusViewSet._assert_employee_in_scope`): право `status.manage` И сотрудник
в области гранта. Чтение НЕ трогается — оно открыто как было; карточка про
правку, и сужать список читателей ею нельзя.

КРАСНАЯ ПРОБА: сними гейт права — красными станут пробы «без права»; сними
проверку области — красной станет проба «чужое управление»; закрой чтение —
красной станет проба «список читается как прежде».
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import (
    seed_role,
)
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

URL = "/api/statuses/statuses/"
VACATION = EmployeeStatus.StatusType.VACATION


@pytest.fixture
def world():
    """Два управления одного департамента и по сотруднику в каждом.

    Область считается по ШТАТНОЙ ЕДИНИЦЕ (у `Employee` своего подразделения
    нет), поэтому людям заводятся слоты, а не только записи.
    """
    StatusType.objects.create(
        code=VACATION, name="Отпуск", priority=10, report_column_code="ABSENT"
    )
    org = Division.objects.create(
        name="Служба", code="sw-org", division_type=Division.DivisionType.ORGANIZATION
    )
    department = Division.objects.create(
        name="Департамент", code="sw-dept",
        division_type=Division.DivisionType.DEPARTMENT, parent=org,
    )
    own = Division.objects.create(
        name="Своё управление", code="sw-own",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    foreign = Division.objects.create(
        name="Чужое управление", code="sw-foreign",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    position = Position.objects.create(name="Инспектор", code="sw-insp", level=8)
    people = {}
    for index, (key, division) in enumerate(
        (("own", own), ("foreign", foreign)), start=1
    ):
        employee = Employee.objects.create(
            personnel_number=f"sw-{index}", last_name=f"Сотрудник{index}",
            first_name="Имя", birth_date=date(1990, 1, 1), hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(
            division=division, position=position, index=index, employee=employee
        )
        people[key] = employee
    return {"own": own, "foreign": foreign, "people": people}


def _client(username, perms, scope_division_id):
    user = User.objects.create_user(username=username, password="x")
    seed_role(f"ROLE_{username}", perms)
    RoleAdminService.assign_role(
        str(user.pk), f"ROLE_{username}", scope_division_id, actor="test"
    )
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def viewer(world):
    """Персона заказчика «сотрудник»: `status.view` на своё управление, и
    только. Ровно то, что у роли `EMPLOYEE` в сиде."""
    return _client("viewer", ("status.view",), world["own"].id)


@pytest.fixture
def head(world):
    """Начальник управления: `status.manage` на своё управление."""
    return _client("head", ("status.view", "status.manage"), world["own"].id)


def _planned(employee, days_ahead=10):
    # «Сегодня» — `timezone.localdate()`, как у кадрового сервиса (сторож №842).
    start = timezone.localdate() + timedelta(days=days_ahead)
    return EmployeeStatus.objects.create(
        employee=employee, status_type=VACATION,
        start_date=start, end_date=start + timedelta(days=5),
        state=EmployeeStatus.StatusState.PLANNED,
    )


def _body(employee, days_ahead=10):
    start = timezone.localdate() + timedelta(days=days_ahead)
    return {
        "employee": employee.pk, "status_type": VACATION,
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=5)).isoformat(),
    }


# ── без права — закрыто на всех девяти дверях ────────────────────────────────


def test_a_viewer_cannot_create_a_status(world, viewer):
    response = viewer.post(URL, _body(world["people"]["own"]), format="json")
    assert response.status_code == 403, response.content
    assert response.json() == {"detail": "PERMISSION_DENIED"}
    assert not EmployeeStatus.objects.exists()


def test_a_viewer_cannot_plan_statuses_in_bulk(world, viewer):
    body = {**_body(world["people"]["own"]), "employee_ids": [world["people"]["own"].pk]}
    body.pop("employee")
    response = viewer.post(f"{URL}bulk_plan/", body, format="json")
    assert response.status_code == 403, response.content
    assert not EmployeeStatus.objects.exists()


@pytest.mark.parametrize(
    "method, action, body",
    [
        ("patch", "", {"comment": "правка"}),
        ("put", "", None),
        ("delete", "", None),
        ("post", "extend/", {"new_end_date": "2099-01-01"}),
        ("post", "terminate/", {"termination_date": "2099-01-01", "reason": "x"}),
        ("post", "cancel/", {"reason": "x"}),
        ("post", "upload_document/", {"title": "x"}),
    ],
)
def test_a_viewer_cannot_touch_an_existing_status(world, viewer, method, action, body):
    """Каждое действие над строкой — своя дверь; закрыты все, а не «основная».

    `delete` в `http_method_names` ручки не объявлен и отвечает 405 — это не
    гейт, а отсутствие двери; проба принимает оба отказа, чтобы не зеленеть на
    405 там, где дверь есть.
    """
    row = _planned(world["people"]["own"])
    payload = _body(world["people"]["own"]) if body is None else body
    response = getattr(viewer, method)(f"{URL}{row.pk}/{action}", payload, format="json")
    assert response.status_code in (403, 405), response.content
    if response.status_code == 403:
        assert response.json() == {"detail": "PERMISSION_DENIED"}
    row.refresh_from_db()
    assert row.state == EmployeeStatus.StatusState.PLANNED
    assert row.comment == ""


# ── с правом — открыто ровно в своей области ──────────────────────────────────


def test_the_head_creates_a_status_for_own_employee(world, head):
    response = head.post(URL, _body(world["people"]["own"]), format="json")
    assert response.status_code == 201, response.content
    assert EmployeeStatus.objects.filter(employee=world["people"]["own"]).exists()


def test_the_head_cannot_create_a_status_for_a_foreign_employee(world, head):
    """Область — часть права, а не украшение: начальник управления не ставит
    статусы людям соседнего управления, хотя право у него есть."""
    response = head.post(URL, _body(world["people"]["foreign"]), format="json")
    assert response.status_code == 403, response.content
    assert response.json()["error_code"] == "PERMISSION_DENIED"
    assert not EmployeeStatus.objects.exists()


def test_the_head_cannot_touch_a_foreign_status_row(world, head):
    row = _planned(world["people"]["foreign"])
    response = head.post(f"{URL}{row.pk}/cancel/", {"reason": "x"}, format="json")
    assert response.status_code == 403, response.content
    row.refresh_from_db()
    assert row.state == EmployeeStatus.StatusState.PLANNED


def test_bulk_plan_refuses_the_whole_batch_if_one_person_is_foreign(world, head):
    """Пачка — одно решение: чужой в списке останавливает всё ДО первой записи,
    иначе часть статусов легла бы, а ответ был бы «отказано»."""
    body = _body(world["people"]["own"])
    body.pop("employee")
    body["employee_ids"] = [world["people"]["own"].pk, world["people"]["foreign"].pk]
    response = head.post(f"{URL}bulk_plan/", body, format="json")
    assert response.status_code == 403, response.content
    assert not EmployeeStatus.objects.exists()


def test_the_head_cancels_own_status_row(world, head):
    row = _planned(world["people"]["own"])
    response = head.post(f"{URL}{row.pk}/cancel/", {"reason": "передумали"}, format="json")
    assert response.status_code == 200, response.content
    row.refresh_from_db()
    assert row.state == EmployeeStatus.StatusState.CANCELLED


# ── чтение не сужено ──────────────────────────────────────────────────────────


def test_reading_stays_open_to_the_viewer(world, viewer):
    """Карточка — про правку. Список, история и текущий статус читаются как
    прежде: «он должен только наблюдать» означает, что наблюдать он должен."""
    _planned(world["people"]["own"])
    listed = viewer.get(URL)
    assert listed.status_code == 200, listed.content
    assert listed.json()["count"] == 1
