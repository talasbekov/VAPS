"""Malformed route replacement is a 400 and preserves both configuration and audit."""
import pytest
from django.contrib.auth import get_user_model

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.audit_service import APPROVAL_ROUTE_REPLACED
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_settings import OpsApprovalRouteStep
from organization_management.apps.ops import approval_route
from organization_management.apps.ops.tests.test_ops_approval_route_settings import admin_api

pytestmark = pytest.mark.django_db
URL = "/api/ops/approval-route/"


@pytest.fixture
def existing_route(admin_api):
    response = admin_api.put(URL, {"steps": [{"roleLabel": "Существующий подписант"}]}, format="json")
    assert response.status_code == 200
    admin_api.raise_request_exception = False
    return snapshot()


def snapshot():
    return (
        list(OpsApprovalRouteStep.objects.order_by("pk").values()),
        list(OpsAuditLog.objects.filter(action=APPROVAL_ROUTE_REPLACED).order_by("pk").values()),
    )


def assert_invalid(admin_api, existing_route, body):
    response = admin_api.put(URL, body, format="json")
    assert response.status_code == 400, response.content[:300]
    assert response.json()["error_code"] == "VALIDATION_ERROR"
    assert response.json()["details"]
    assert snapshot() == existing_route


@pytest.mark.parametrize("body", [["not-an-object"], "not-an-object", 1, True])
def test_nonobject_request_body_is_rejected(admin_api, existing_route, body):
    assert_invalid(admin_api, existing_route, body)


@pytest.mark.parametrize("row", ["wrong", [1], 1, True, None, [], 0])
def test_nonobject_step_after_valid_step_does_not_replace_route(admin_api, existing_route, row):
    assert_invalid(admin_api, existing_route, {"steps": [{"roleLabel": "Новая первая строка"}, row]})


@pytest.mark.parametrize("field", ["roleLabel", "unit", "username", "fullName"])
@pytest.mark.parametrize("value", [{"nested": "value"}, ["value"], 123, False])
def test_text_fields_do_not_coerce_nonstring_values(admin_api, existing_route, field, value):
    assert_invalid(admin_api, existing_route, {"steps": [{"roleLabel": "Подписант", field: value}]})


@pytest.mark.parametrize("field,limit", [("roleLabel", 200), ("unit", 200), ("username", 150), ("fullName", 200)])
def test_text_fields_reject_overlong_values_before_replacing_route(admin_api, existing_route, field, limit):
    assert_invalid(admin_api, existing_route, {"steps": [{"roleLabel": "Подписант", field: "я" * (limit + 1)}]})


def test_derived_employee_name_is_validated_without_truncation(admin_api, existing_route):
    user = get_user_model().objects.create_user(username="long-route-signer")
    employee = Employee.objects.create(user=user, personnel_number="ROUTE-LONG-NAME",
                                       last_name="А" * 100, first_name="Б" * 100, middle_name="В" * 100)
    assert_invalid(admin_api, existing_route, {"steps": [{"roleLabel": "Подписант", "username": user.username}]})
    employee.refresh_from_db()
    assert employee.last_name == "А" * 100
    assert employee.first_name == "Б" * 100
    assert employee.middle_name == "В" * 100


@pytest.mark.parametrize("row", ["wrong", {"roleLabel": "я" * 201}])
def test_direct_service_validates_before_any_write(existing_route, row):
    with pytest.raises(DomainError) as caught:
        approval_route.replace_steps([{"roleLabel": "Новая первая строка"}, row], actor="route-admin")
    assert caught.value.http_status == 400
    assert snapshot() == existing_route


def test_valid_maximum_fields_optional_null_and_empty_route_remain_supported(admin_api, existing_route):
    username = "s" * 150
    get_user_model().objects.create_user(username=username)
    response = admin_api.put(URL, {"steps": [
        {"roleLabel": "р" * 200, "unit": "у" * 200, "username": username, "fullName": "ф" * 200},
        {"roleLabel": "  Роль без учётки  ", "unit": None, "username": None, "fullName": None},
    ]}, format="json")
    assert response.status_code == 200, response.content[:300]
    rows = response.json()["results"]
    assert rows[0]["position"] == 1
    assert rows[0]["roleLabel"] == "р" * 200
    assert rows[0]["unit"] == "у" * 200
    assert rows[0]["username"] == username
    assert rows[0]["fullName"] == "ф" * 200
    assert rows[1]["position"] == 2
    assert rows[1]["roleLabel"] == "Роль без учётки"
    assert all(rows[1][field] == "" for field in ("unit", "username", "fullName"))
    assert OpsAuditLog.objects.filter(action=APPROVAL_ROUTE_REPLACED).count() == len(existing_route[1]) + 1
    cleared = admin_api.put(URL, {"steps": []}, format="json")
    assert cleared.status_code == 200
    assert cleared.json() == {"results": []}
    assert not OpsApprovalRouteStep.objects.exists()
    assert OpsAuditLog.objects.filter(action=APPROVAL_ROUTE_REPLACED).count() == len(existing_route[1]) + 2
