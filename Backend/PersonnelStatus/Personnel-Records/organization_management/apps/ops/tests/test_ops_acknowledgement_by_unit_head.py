"""Ознакомление начальником управления за сотрудника без учётки (Plane №984)."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import documents_case
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_my_assignments import linked_client, on_acknowledgement, placed
from .test_ops_security_events_api import make_employee, manager  # noqa: F401

pytestmark = pytest.mark.django_db


def _directorate(name):
    return Division.objects.create(
        name=name, division_type=Division.DivisionType.DIRECTORATE
    )


def _head(username, division):
    employee = make_employee(f"Начальник-{username}", "Управления")
    StaffUnit.objects.create(division=division, employee=employee, index=1)
    api, user = client_for(
        username,
        "DIRECTORATE_HEAD",
        perms=("status.manage",),
        scope_division_id=division.pk,
    )
    employee.user = user
    employee.save(update_fields=["user"])
    return api, employee


def test_only_the_employees_unit_head_confirms_an_unlinked_employee(manager):  # noqa: F811
    home = _directorate("Управление без учётки")
    foreign = _directorate("Чужое управление")
    employee = make_employee("Безучётный", "Сотрудник")
    StaffUnit.objects.create(division=home, employee=employee, index=2)
    base, assignment_id = placed(manager, employee)
    event = on_acknowledgement(base)
    head, head_employee = _head("ack-home-head", home)
    foreign_head, _ = _head("ack-foreign-head", foreign)

    missing = head.post(f"{base}acknowledge/{assignment_id}/", {}, format="json")
    assert missing.status_code == 400, missing.content
    assert set(missing.json()["details"]) == {"deliveryMethod", "accountAbsenceBasis"}
    assert foreign_head.post(
        f"{base}acknowledge/{assignment_id}/",
        {"deliveryMethod": "Устно", "accountAbsenceBasis": "Учётка не заведена"},
        format="json",
    ).status_code == 403
    assert manager.post(
        f"{base}acknowledge/{assignment_id}/",
        {"deliveryMethod": "Устно", "accountAbsenceBasis": "Учётка не заведена"},
        format="json",
    ).status_code == 403

    confirmed = head.post(
        f"{base}acknowledge/{assignment_id}/",
        {
            "deliveryMethod": "Устно на построении",
            "accountAbsenceBasis": "Учётная запись ещё не заведена кадровиком",
        },
        format="json",
    )
    assert confirmed.status_code == 200, confirmed.content
    row = confirmed.json()["placementAssignments"][0]
    assert row["employeeId"] == str(employee.pk)
    assert row["acknowledgedVia"] == "personal"
    assert row["acknowledgedByEmployeeId"] == str(head_employee.pk)
    assert row["acknowledgedByUserId"]
    assert row["acknowledgementMethod"] == "Устно на построении"
    assert row["acknowledgementBasis"] == "Учётная запись ещё не заведена кадровиком"
    trace = OpsAuditLog.objects.get(action="SECURITY_EVENT_ACKNOWLEDGED_BY_UNIT_HEAD")
    assert trace.new_value["employeeId"] == str(employee.pk)
    assert trace.new_value["confirmedByEmployeeId"] == str(head_employee.pk)

    event.refresh_from_db()
    sheet_row = documents_case.acknowledgement_sheet_rows(event)[0]
    assert "Устно на построении" in sheet_row
    assert "Учётная запись ещё не заведена кадровиком" in sheet_row


def test_an_employee_with_an_account_can_only_confirm_for_themselves(manager):  # noqa: F811
    home = _directorate("Управление с учёткой")
    employee = make_employee("Связанный", "Сотрудник")
    StaffUnit.objects.create(division=home, employee=employee, index=1)
    base, assignment_id = placed(manager, employee)
    on_acknowledgement(base)
    self_api = linked_client("ack-self-984", employee)
    head, _ = _head("ack-linked-head", home)

    assert head.post(
        f"{base}acknowledge/{assignment_id}/",
        {"deliveryMethod": "Устно", "accountAbsenceBasis": "Нет основания"},
        format="json",
    ).status_code == 403
    own = self_api.post(f"{base}acknowledge/{assignment_id}/")
    assert own.status_code == 200, own.content
    row = own.json()["placementAssignments"][0]
    assert row["acknowledgedVia"] == "self"
    assert row.get("acknowledgementMethod", "") == ""
    assert row.get("acknowledgementBasis", "") == ""
