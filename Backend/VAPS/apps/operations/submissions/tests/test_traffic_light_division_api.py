"""Story 10.3c — API per-division светофора с drift (GET /api/operations/
traffic-light/division/).

Проверяет ТОЛЬКО HTTP-контракт: домен (`division_traffic_light`) уже доказан
на уровне сервиса (5.5a, test_traffic_light.py). Порядок гвардов (scope →
exists → будущая дата → горизонт-422) — буквальное зеркало `tree` (10.3a).
"""

import itertools
import uuid
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.services import submit_day

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 19)
TOMORROW = TODAY + timedelta(days=1)
BEFORE_HORIZON = date(2026, 4, 1)

_iin = itertools.count(8000)
_code = itertools.count(1)


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def org_dt():
    call_command("seed_operations")
    org = Organization.objects.create(name="Организация", code="ORG-TLD")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "Отдел"}
    )[0]
    return org, dt


def make_division(org_dt, name):
    org, dt = org_dt
    return Division.objects.create(
        organization=org, type_code=dt, name=name, code=f"TLD-{next(_code)}"
    )


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_status(employee, code="DUTY", date_start=date(2026, 5, 1)):
    return EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date(2026, 9, 1),
        source="USER",
    )


def _submit(division, business_date=TODAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def _client(user_id=None):
    client = APIClient()
    if user_id is not None:
        client.credentials(HTTP_X_USER_ID=user_id)
    return client


def _grant(user_id, role="DIVISION_OPERATOR", scope=None):
    UserRole.objects.create(
        user_id=user_id,
        role_code_id=role,
        scope_division_id=scope.id if scope is not None else None,
    )
    return user_id


def url():
    return reverse("ops-traffic-light-division")


@pytest.fixture
def divisions(org_dt):
    green = make_division(org_dt, "Зелёный")
    make_status(make_employee(green))
    _submit(green)

    yellow = make_division(org_dt, "Жёлтый")
    make_employee(yellow)
    _submit(yellow)  # snapshot roster = [emp]
    newcomer = make_employee(yellow)  # live roster grows after submit → YELLOW

    red = make_division(org_dt, "Красный")
    make_employee(red)  # ростер есть, сдачи нет → RED

    other = make_division(org_dt, "Чужое")
    make_status(make_employee(other))

    return {
        "green": green,
        "yellow": yellow,
        "newcomer": newcomer,
        "red": red,
        "other": other,
    }


@pytest.fixture
def scoped_actor(divisions):
    """DIVISION_OPERATOR со scope на yellow (единственная, которую тест
    гарантированно смотрит без 403)."""
    return _grant("op-yellow", scope=divisions["yellow"])


@pytest.fixture
def global_actor(org_dt):
    return _grant("admin-global", role="ADMIN")


def test_happy_path_yellow_returns_drift(divisions, global_actor):
    response = _client(global_actor).get(
        url(), {"division_id": str(divisions["yellow"].id)}
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "YELLOW"
    assert body["late"] is False
    assert body["drift"]["added"] == [str(divisions["newcomer"].id)]
    assert body["drift"]["removed"] == []
    assert body["drift"]["changed"] == []


def test_green_has_null_drift(divisions, global_actor):
    response = _client(global_actor).get(
        url(), {"division_id": str(divisions["green"].id)}
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "GREEN"
    assert body["drift"] is None


def test_red_has_null_drift(divisions, global_actor):
    response = _client(global_actor).get(
        url(), {"division_id": str(divisions["red"].id)}
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "RED"
    assert body["drift"] is None


def test_foreign_scope_is_403(divisions, scoped_actor):
    response = _client(scoped_actor).get(
        url(), {"division_id": str(divisions["other"].id)}
    )
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_phantom_division_is_404_for_a_global_actor(global_actor):
    phantom = uuid.uuid4()
    response = _client(global_actor).get(url(), {"division_id": str(phantom)})
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_phantom_division_is_403_not_404_for_a_stranger(divisions, scoped_actor):
    """404 не должен быть оракулом существования для чужака."""
    response = _client(scoped_actor).get(url(), {"division_id": str(uuid.uuid4())})
    assert response.status_code == 403


def test_scope_guard_wins_over_the_data_horizon(divisions, scoped_actor):
    response = _client(scoped_actor).get(
        url(),
        {
            "division_id": str(divisions["other"].id),
            "business_date": BEFORE_HORIZON.isoformat(),
        },
    )
    assert response.status_code == 403


def test_date_before_the_data_horizon_is_422(divisions, scoped_actor):
    response = _client(scoped_actor).get(
        url(),
        {
            "division_id": str(divisions["yellow"].id),
            "business_date": BEFORE_HORIZON.isoformat(),
        },
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "REPORT_NO_DATA_FOR_DATE"


def test_future_date_is_400(divisions, scoped_actor):
    response = _client(scoped_actor).get(
        url(),
        {
            "division_id": str(divisions["yellow"].id),
            "business_date": TOMORROW.isoformat(),
        },
    )
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_missing_division_id_is_400(scoped_actor):
    response = _client(scoped_actor).get(url())
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_non_uuid_division_id_is_400(scoped_actor):
    response = _client(scoped_actor).get(url(), {"division_id": "не-uuid"})
    assert response.status_code == 400


def test_anonymous_is_403(divisions):
    response = _client(None).get(url(), {"division_id": str(divisions["yellow"].id)})
    assert response.status_code == 403


def test_actor_without_status_view_is_403(divisions):
    stranger = _grant("no-view", role="INTEGRATION_USER")  # holds status.manage only
    response = _client(stranger).get(
        url(), {"division_id": str(divisions["yellow"].id)}
    )
    assert response.status_code == 403


def test_omitted_date_echoes_the_server_today(divisions, global_actor):
    response = _client(global_actor).get(
        url(), {"division_id": str(divisions["green"].id)}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "GREEN"  # today's submission, not future/past


def test_colours_match_service_byte_for_byte(divisions, global_actor):
    from apps.operations.submissions.traffic_light import division_traffic_light

    expected = division_traffic_light(divisions["yellow"].id, TODAY)
    response = _client(global_actor).get(
        url(), {"division_id": str(divisions["yellow"].id)}
    )
    body = response.json()
    assert body["status"] == expected.status
    assert body["late"] == expected.late
    assert body["drift"] == expected.drift
