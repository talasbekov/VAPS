"""Story 15.2a — HTTP-smoke pin for security-event create audit emission.

Same pattern as apps.operations.duties.tests.test_duty_plan_audit (14.12a):
a real HTTP call through the route, asserting the AuditLog row exists with
the correct action/actor — the behavioral test _Audited()'s own docstring
requires alongside the view-level record() call.
"""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
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
def event_manager_client(seeded):
    role = Role.objects.create(
        code="TEST_EVENT_MANAGER_AUDIT", name="Test event manager (audit)"
    )
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-audit", role_code=role)
    return _client("event-operator-audit")


def make_object(code="OBJ-EVT-AUDIT-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def test_http_smoke_create_emits_audited_row(event_manager_client):
    obj = make_object("OBJ-EVT-AUDIT-2")
    senior_id = str(uuid.uuid4())
    resp = event_manager_client.post(
        reverse("ops-security-event-list"),
        {"object": obj.pk, "title": "ОМ №1", "senior_employee_id": senior_id},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    log = AuditLog.objects.get(action="SECURITY_EVENT_CREATED")
    assert log.actor_user_id == "event-operator-audit"
    assert log.entity_id == uuid.UUID(int=resp.data["id"])
    assert log.new_value["event_id"] == resp.data["id"]
    assert log.new_value["senior_employee_id"] == senior_id
