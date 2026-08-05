"""POST /api/operations/statuses/{id}/resolve/ — маршрут разрешения заглушки.

Вьюха тонкая, поэтому проверяется её зона: гейт права, область из RBAC (а не
из тела), происхождение актора, форма ответа и то, что отказы сервиса доезжают
конвертом раздела. Правила самой операции живут в сервисе и покрыты
test_resolve_placeholder.py.
"""
from datetime import timedelta

import pytest

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

FROM = TODAY + timedelta(days=10)
TO = TODAY + timedelta(days=12)
WHY = "Выяснено по журналу дежурств: был наряд."


def url(status_id):
    return f"/api/operations/statuses/{status_id}/resolve/"


@pytest.fixture
def placeholder_type():
    return StatusType.objects.create(
        code="PENDING",
        name="Уточняется",
        priority=500,
        report_column_code="PENDING",
        is_placeholder=True,
    )


def make_status(employee, code="PENDING"):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=FROM,
        date_end=TO,
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def post(api, status_id, body=None):
    payload = {
        "resolved_type_code": "DUTY",
        "date_start": FROM.isoformat(),
        "date_end": TO.isoformat(),
        "reason": WHY,
    }
    payload.update(body or {})
    with clock.override(TODAY):
        return api.post(url(status_id), payload, format="json")


# ── Гейт и область ───────────────────────────────────────────────────────


def test_reading_the_status_is_not_enough_to_resolve_it(
    types, placeholder_type, division
):
    """Право ЧИТАТЬ расход не должно давать права переписывать его основания."""
    api, _ = client_for("res-viewer", "VIEWER", ["status.view"])
    employee = make_employee(division)

    response = post(api, make_status(employee).pk)

    assert response.status_code == 403
    assert "detail" in response.data


def test_an_employee_outside_the_scope_is_refused(types, placeholder_type, division):
    from organization_management.apps.divisions.models import Division

    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "res-scoped", "OPERATOR", ["status.manage"], scope_division_id=other.id
    )
    employee = make_employee(division)

    response = post(api, make_status(employee).pk)

    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


# ── Успех ────────────────────────────────────────────────────────────────


def test_the_response_is_the_created_status_not_the_closed_placeholder(
    types, placeholder_type, division
):
    """Спрашивали, чем кончилась неясность, а не как выглядит закрытая
    заглушка."""
    api, _ = client_for("res-ok", "ADMIN", ["*"])
    employee = make_employee(division)
    placeholder = make_status(employee)

    response = post(api, placeholder.pk)

    assert response.status_code == 200
    assert response.data["status_type_code"] == "DUTY"
    assert response.data["id"] != placeholder.pk
    placeholder.refresh_from_db()
    assert placeholder.cancelled_at is not None


def test_the_actor_comes_from_authentication_not_from_the_body(
    types, placeholder_type, division
):
    api, user = client_for("res-actor", "ADMIN", ["*"])
    employee = make_employee(division)

    response = post(api, make_status(employee).pk, {"actor": "999"})

    assert response.status_code == 200
    resolved = OpsEmployeeStatus.objects.get(pk=response.data["id"])
    assert resolved.created_by == str(user.pk)


# ── Отказы доезжают конвертом ────────────────────────────────────────────


def test_a_missing_reason_is_400(types, placeholder_type, division):
    api, _ = client_for("res-noreason", "ADMIN", ["*"])
    employee = make_employee(division)

    with clock.override(TODAY):
        response = api.post(
            url(make_status(employee).pk),
            {
                "resolved_type_code": "DUTY",
                "date_start": FROM.isoformat(),
                "date_end": TO.isoformat(),
            },
            format="json",
        )

    assert response.status_code == 400
    assert "reason" in response.data


def test_a_real_status_is_422_not_500(types, placeholder_type, division):
    api, _ = client_for("res-real", "ADMIN", ["*"])
    employee = make_employee(division)

    response = post(api, make_status(employee, code="DUTY").pk, {
        "resolved_type_code": "VACATION"
    })

    assert response.status_code == 422
    assert response.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_a_missing_status_is_404(types, placeholder_type, division):
    api, _ = client_for("res-404", "ADMIN", ["*"])

    assert post(api, 10_000).status_code == 404


def test_a_junk_id_is_404_not_500(types, placeholder_type, division):
    api, _ = client_for("res-junk", "ADMIN", ["*"])

    assert post(api, "не-число").status_code == 404
