"""Выбор первого согласующего старшим объекта (Plane №983)."""
import pytest

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

from .test_ops_security_events_api import make_employee, manager  # noqa: F401
from .test_ops_visit_object_approval import two_objects_on_approval  # noqa: F401

pytestmark = pytest.mark.django_db


def _linked_persona(username, role_code, employee, *, perms=()):
    api, user = client_for(username, role_code, perms=perms)
    employee.user = user
    employee.save(update_fields=["user"])
    return api, user


def test_object_chief_selects_the_first_of_exactly_two_approvers(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, visit, _second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старший", first_name="Объекта")
    chief, _chief_user = _linked_persona(
        "object-chief-route", "HEAD_OPS_UNIT", chief_employee, perms=("event.view",)
    )
    candidate_employee = make_employee(last_name="Выбранный", first_name="Руководитель")
    _candidate, candidate_user = _linked_persona(
        "selected-d2-head", "HEAD_OPS_UNIT", candidate_employee,
        perms=("assignment.approve",),
    )
    deputy_employee = make_employee(last_name="Заместитель", first_name="Организации")
    _deputy, deputy_user = _linked_persona(
        "organization-deputy", "EVENT_APPROVER", deputy_employee,
        perms=("assignment.approve",),
    )
    visit.chief_employee_id = chief_employee.pk
    visit.chief_name = "Старший Объекта"
    visit.approval_route = [
        {
            "id": "approver-1", "name": "Старый шаблон", "unit": "",
            "position": "Руководитель второго департамента", "username": "",
            "status": "NOT_SENT", "decidedAt": None, "comment": "",
        },
        {
            "id": "approver-2", "name": "Заместитель Организации",
            "unit": "Руководство", "position": "Заместитель руководителя организации",
            "username": deputy_user.username, "status": "NOT_SENT",
            "decidedAt": None, "comment": "",
        },
    ]
    visit.save(update_fields=[
        "chief_employee_id", "chief_name", "approval_route", "updated_at"
    ])

    candidates = chief.get(
        f"{base}approval/candidates/", {"visitObjectId": str(visit.pk)}
    )
    assert candidates.status_code == 200, candidates.content
    assert candidates.json()["results"] == [
        {
            "userId": str(candidate_user.pk),
            "employeeId": str(candidate_employee.pk),
            "name": "Выбранный Руководитель",
            "username": "selected-d2-head",
        }
    ]

    self_selected = chief.post(
        f"{base}approval/route/select/",
        {
            "visitObjectId": str(visit.pk),
            "approverUserId": str(_chief_user.pk),
        },
        format="json",
    )
    assert self_selected.status_code == 400
    assert self_selected.json()["error_code"] == "VALIDATION_ERROR"
    assert self_selected.json()["details"]["approverUserId"] == [
        "Выберите руководителя второго департамента."
    ]

    selected = chief.post(
        f"{base}approval/route/select/",
        {
            "visitObjectId": str(visit.pk),
            "approverUserId": str(candidate_user.pk),
        },
        format="json",
    )
    assert selected.status_code == 200, selected.content
    row = next(
        item for item in selected.json()["visitObjects"]
        if item["id"] == str(visit.pk)
    )
    assert len(row["approvalRoute"]) == 2
    assert row["approvalRoute"][0]["username"] == "selected-d2-head"
    assert row["approvalRoute"][1]["username"] == "organization-deputy"
    trace = OpsAuditLog.objects.get(action="SECURITY_EVENT_APPROVAL_ROUTE_SELECTED")
    assert trace.new_value["approverUserId"] == str(candidate_user.pk)

    sent = chief.post(
        f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    locked = chief.post(
        f"{base}approval/route/select/",
        {
            "visitObjectId": str(visit.pk),
            "approverUserId": str(candidate_user.pk),
        },
        format="json",
    )
    assert locked.status_code == 422
    assert locked.json()["error_code"] == "APPROVAL_ROUTE_LOCKED"
