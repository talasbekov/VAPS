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

ПРАВИЛО №938 — то же, что у ручки раздела ОМ (`operations/api/views.py`,
`StatusViewSet._assert_employee_in_scope`): право `status.manage` И сотрудник
в области гранта. На момент №938 чтение намеренно не менялось: это была
отдельная release-blocking находка, закрываемая Plane №953 ниже правом
`status.view` и его областью.

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


def test_the_head_cannot_move_own_status_to_a_foreign_employee(world, head):
    """Область проверяется и у НОВОГО сотрудника при правке (ревью №825 по
    №938, 08.09.2026). `get_object()` сверял область по текущему сотруднику
    строки, а `employee` у сериализатора записываемый: PATCH переставлял
    свой статус человеку чужого управления — дверь, которую обходят другим
    телом запроса.

    КРАСНАЯ ПРОБА: убери проверку нового `employee` в `partial_update` —
    ответ станет 200, а строка уедет в чужое управление.
    """
    row = _planned(world["people"]["own"])
    response = head.patch(
        f"{URL}{row.pk}/", {"employee": world["people"]["foreign"].pk}, format="json"
    )
    assert response.status_code == 403, response.content
    row.refresh_from_db()
    assert row.employee_id == world["people"]["own"].pk


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


# ── чтение: отдельная граница Plane №953 ─────────────────────────────────────


def test_reading_is_limited_to_the_status_view_scope(world, viewer):
    """Читатель своего управления не получает строку соседнего управления.

    КРАСНАЯ ПРОБА №953: до правки список содержит обе строки.
    """
    own = _planned(world["people"]["own"])
    _planned(world["people"]["foreign"])

    listed = viewer.get(URL)
    assert listed.status_code == 200, listed.content
    assert listed.json()["count"] == 1
    assert [row["id"] for row in listed.json()["results"]] == [own.pk]


def test_employee_filter_does_not_reveal_a_foreign_employee(world, viewer):
    """Foreign existing и nonexistent дают неразличимый ответ.

    КРАСНАЯ ПРОБА по adversarial review №953: django-filter проверял
    `employee` по глобальному Employee queryset, поэтому чужой существующий
    id давал 200/пусто, а отсутствующий — 400 и становился existence oracle.
    """
    foreign_id = world["people"]["foreign"].pk
    nonexistent_id = max(person.pk for person in world["people"].values()) + 10_000

    foreign = viewer.get(URL, {"employee": foreign_id})
    nonexistent = viewer.get(URL, {"employee": nonexistent_id})

    assert foreign.status_code == nonexistent.status_code == 400
    assert foreign.json() == nonexistent.json()


def test_a_foreign_status_cannot_be_retrieved_by_id(world, viewer):
    foreign = _planned(world["people"]["foreign"])

    response = viewer.get(f"{URL}{foreign.pk}/")

    assert response.status_code == 404, response.content


@pytest.mark.parametrize("action", ["history", "planned"])
def test_employee_reader_actions_refuse_a_foreign_employee(world, viewer, action):
    foreign_employee_id = world["people"]["foreign"].pk

    response = viewer.get(f"{URL}{action}/?employee_id={foreign_employee_id}")

    assert response.status_code == 403, response.content


@pytest.mark.parametrize("action", ["history", "planned"])
def test_employee_reader_actions_allow_an_own_employee(world, viewer, action):
    own = _planned(world["people"]["own"])
    if action == "history":
        # History по контракту содержит только завершённые/отменённые строки;
        # прямой update нужен, чтобы model.save не пересчитал будущий период
        # обратно в PLANNED и проба проверяла именно доступ, а не календарь.
        EmployeeStatus.objects.filter(pk=own.pk).update(
            state=EmployeeStatus.StatusState.COMPLETED
        )

    response = viewer.get(f"{URL}{action}/?employee_id={own.employee_id}")

    assert response.status_code == 200, response.content
    body = response.json()
    rows = body if action == "history" else body["planned"]
    assert [row["id"] for row in rows] == [own.pk]


def test_division_headcount_refuses_a_foreign_division(world, viewer):
    response = viewer.get(
        f"{URL}division_headcount/?division_id={world['foreign'].pk}"
    )

    assert response.status_code == 403, response.content


def test_division_headcount_allows_an_own_division(world, viewer):
    response = viewer.get(
        f"{URL}division_headcount/?division_id={world['own'].pk}"
    )

    assert response.status_code == 200, response.content
    assert response.json()["division_id"] == world["own"].pk


def test_absence_statistics_refuse_an_account_scoped_elsewhere(world):
    user = User.objects.create_user(username="mis-scoped-reader", password="x")
    world["people"]["own"].user = user
    world["people"]["own"].save(update_fields=["user"])
    seed_role("MIS_SCOPED_READER", ("status.view",))
    RoleAdminService.assign_role(
        str(user.pk), "MIS_SCOPED_READER", world["foreign"].pk, actor="test"
    )
    api = APIClient()
    api.force_authenticate(user)

    response = api.get(f"{URL}absence_statistics/")

    assert response.status_code == 403, response.content


def test_absence_statistics_allow_the_accounts_own_scope(world):
    user = User.objects.create_user(username="own-scope-reader", password="x")
    world["people"]["own"].user = user
    world["people"]["own"].save(update_fields=["user"])
    seed_role("OWN_SCOPE_READER", ("status.view",))
    RoleAdminService.assign_role(
        str(user.pk), "OWN_SCOPE_READER", world["own"].pk, actor="test"
    )
    api = APIClient()
    api.force_authenticate(user)

    response = api.get(f"{URL}absence_statistics/")

    assert response.status_code == 200, response.content
    assert response.json()["division_id"] == world["own"].pk


def test_own_status_detail_stays_readable(world, viewer):
    own = _planned(world["people"]["own"])

    assert viewer.get(f"{URL}{own.pk}/").status_code == 200


def test_an_authenticated_user_without_status_view_cannot_read(world):
    user = User.objects.create_user(username="no-status-view", password="x")
    api = APIClient()
    api.force_authenticate(user)

    response = api.get(URL)

    assert response.status_code == 403, response.content
    assert response.json() == {"detail": "PERMISSION_DENIED"}


def test_an_unscoped_reader_sees_the_whole_catalog(world):
    own = _planned(world["people"]["own"])
    foreign = _planned(world["people"]["foreign"])
    admin = _client("status-admin", ("*",), None)

    response = admin.get(URL)

    assert response.status_code == 200, response.content
    assert response.json()["count"] == 2
    assert {row["id"] for row in response.json()["results"]} == {own.pk, foreign.pk}
