"""Story 14.11a — POST/GET /api/operations/duty-plans (API-OPS-012).

RBAC role-binding (which role actually carries duty.manage) is 14.12's
territory — tests grant the permission directly via a throwaway test role,
proving the gate mechanism works, not any particular production binding.
"""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.duties.models import DutyPlan
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def duty_manager_client(seeded):
    role = Role.objects.create(code="TEST_DUTY_MANAGER", name="Test duty manager")
    RolePermission.objects.create(role_code=role, permission_code_id="duty.manage")
    UserRole.objects.create(user_id="duty-operator", role_code=role)
    return _client("duty-operator")


def make_object(code="OBJ-API-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def test_create_duty_plan_requires_permission(seeded):
    obj = make_object("OBJ-API-2")
    client = _client("plain-operator")
    resp = client.post(
        reverse("ops-duty-plan-list"),
        {"object": str(obj.pk), "year": 2026, "month": 8},
        format="json",
    )
    assert resp.status_code == 403


def test_create_duty_plan_happy_path(duty_manager_client):
    obj = make_object("OBJ-API-3")
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-list"),
        {"object": str(obj.pk), "year": 2026, "month": 8},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["status_code"] == "DRAFT"
    assert resp.data["year"] == 2026
    assert DutyPlan.objects.filter(object=obj, year=2026, month=8).exists()


def test_create_duty_plan_duplicate_rejected(duty_manager_client):
    obj = make_object("OBJ-API-4")
    DutyPlan.objects.create(object=obj, year=2026, month=8)
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-list"),
        {"object": str(obj.pk), "year": 2026, "month": 8},
        format="json",
    )
    assert resp.status_code == 409, resp.data
    assert resp.data["error_code"] == "DUTY_PLAN_ALREADY_EXISTS"


def test_create_duty_plan_month_out_of_range_rejected(duty_manager_client):
    obj = make_object("OBJ-API-5")
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-list"),
        {"object": str(obj.pk), "year": 2026, "month": 13},
        format="json",
    )
    assert resp.status_code == 422, resp.data
    assert resp.data["error_code"] == "DUTY_PLAN_INVALID_PERIOD"


def test_create_duty_plan_nonexistent_object_rejected(duty_manager_client):
    resp = duty_manager_client.post(
        reverse("ops-duty-plan-list"),
        {"object": "999999", "year": 2026, "month": 8},
        format="json",
    )
    assert resp.status_code == 400, resp.data


def test_list_duty_plans_malformed_object_filter_rejected_cleanly(duty_manager_client):
    # Review (Blind Hunter/Edge Case Hunter, independently confirmed): a
    # non-numeric ?object= must be a clean 400, not a bare 500 from an
    # unhandled ValueError deep in the queryset.
    resp = duty_manager_client.get(reverse("ops-duty-plan-list"), {"object": "abc"})
    assert resp.status_code == 400, resp.data


def test_list_duty_plans_requires_permission(seeded):
    client = _client("plain-operator")
    resp = client.get(reverse("ops-duty-plan-list"))
    assert resp.status_code == 403


def test_list_duty_plans_happy_path(duty_manager_client):
    obj_a = make_object("OBJ-API-6A")
    obj_b = make_object("OBJ-API-6B")
    DutyPlan.objects.create(object=obj_a, year=2026, month=8)
    DutyPlan.objects.create(object=obj_b, year=2026, month=9)

    resp = duty_manager_client.get(reverse("ops-duty-plan-list"))
    assert resp.status_code == 200
    assert resp.data["count"] == 2


def test_list_duty_plans_filters_by_object(duty_manager_client):
    obj_a = make_object("OBJ-API-7A")
    obj_b = make_object("OBJ-API-7B")
    DutyPlan.objects.create(object=obj_a, year=2026, month=8)
    DutyPlan.objects.create(object=obj_b, year=2026, month=9)

    resp = duty_manager_client.get(
        reverse("ops-duty-plan-list"), {"object": str(obj_a.pk)}
    )
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["object"] == obj_a.pk
