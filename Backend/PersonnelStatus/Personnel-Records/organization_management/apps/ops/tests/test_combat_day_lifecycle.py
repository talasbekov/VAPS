"""A department head, headquarters and linked employee exercise §24 by identity."""
from datetime import datetime, timezone

import pytest

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops.tests.test_combat_day_planning import BOARD, DAY, form, payload, scene  # noqa: F401

pytestmark = pytest.mark.django_db


def accept(s, pk):
    r = s["staff"].post(f"{BOARD}{pk}/review/", {"decision": "ACCEPT"}, format="json")
    assert r.status_code == 200, r.data
    return r.json()


def test_full_identity_walkthrough_and_personal_acknowledgement(scene, monkeypatch):
    s = scene
    monkeypatch.setattr(Clock, "today_local", staticmethod(lambda: DAY))
    monkeypatch.setattr(Clock, "now", staticmethod(lambda: datetime(2026, 11, 3, 8, tzinfo=timezone.utc)))
    person = s["people"][0]
    person.user = s["user"]
    person.save(update_fields=["user"])
    employee_api, user = client_for("day-member", "DAY_MEMBER", ["profile.view"])
    member = s["people"][1]
    member.user = user
    member.save(update_fields=["user"])
    data = form(s)
    pk = data["id"]
    path = f"{BOARD}{pk}/"
    assert accept(s, pk)["executionState"] == "PENDING_ACKNOWLEDGEMENT"
    # Headquarters cannot acknowledge on behalf of somebody else.
    assert s["staff"].post(path + "acknowledge/", {"employeeId": person.pk}, format="json").status_code == 403
    assert s["api"].post(path + "acknowledge/", {}, format="json").status_code == 200
    response = employee_api.post(path + "acknowledge/", {}, format="json")
    assert response.status_code == 200, response.data
    assert response.json()["executionState"] == "READY"
    assert employee_api.get(path).status_code == 200
    assert s["staff"].post(path + "check-in/", {}, format="json").json()["executionState"] == "ACTIVE"
    assert s["api"].post(path + "cancel/", {"reason": "Too late"}, format="json").status_code == 422
    assert s["staff"].post(path + "complete/", {"actualMemberIds": [person.pk, member.pk]}, format="json").status_code == 422
    assert s["staff"].post(path + "handover/", {"remarks": "Без замечаний"}, format="json").status_code == 200
    result = s["staff"].post(path + "complete/", {"actualMemberIds": [person.pk, member.pk]}, format="json")
    assert result.status_code == 200, result.data
    assert result.json()["executionState"] == "COMPLETED"
    assert OpsEmployeeStatus.objects.filter(source_ref=f"combat:{pk}", cancelled_at__isnull=True, status_type_code="DUTY").count() == 2


def test_replacement_moves_projection_and_new_person_must_acknowledge(scene):
    s = scene
    data = form(s)
    path = f'{BOARD}{data["id"]}/'
    accept(s, data["id"])
    outgoing, incoming = s["people"][1], s["people"][2]
    response = s["api"].post(path + "replace/", {"outgoingEmployeeId": outgoing.pk, "incomingEmployeeId": incoming.pk, "reason": "Плановая замена"}, format="json")
    assert response.status_code == 200, response.data
    rows = OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True)
    assert set(rows.values_list("employee_id", flat=True)) == {s["people"][0].pk, incoming.pk}
    replaced = next(m for m in response.json()["members"] if m["employeeId"] == str(incoming.pk))
    assert replaced["isDriver"] and not replaced["acknowledged"]
    assert response.json()["replacements"][0]["outgoingEmployeeId"] == str(outgoing.pk)


def test_foreign_manager_cannot_read_or_mutate_shift(scene):
    s = scene
    data = form(s)
    api, _ = client_for("day-foreign-manager", "DAY_FOREIGN_MANAGER", ["duty.view", "duty.manage", "duty.roster"], s["other"].pk)
    path = f'{BOARD}{data["id"]}/'
    assert api.get(path).status_code == 403
    for action, body in [("review", {"decision": "ACCEPT"}), ("cancel", {"reason": "Foreign"}), ("replace", {"outgoingEmployeeId": s["people"][0].pk, "incomingEmployeeId": s["people"][3].pk, "reason": "Foreign"})]:
        assert api.post(path + action + "/", body, format="json").status_code == 403
    assert OpsEmployeeStatus.objects.filter(source_ref=f'combat:{data["id"]}', cancelled_at__isnull=True).count() == 2


def test_cannot_check_in_on_future_date(scene):
    s = scene
    data = form(s)
    path = f'{BOARD}{data["id"]}/'
    accept(s, data["id"])
    # Force READY without asserting facts about linked employee accounts here.
    from organization_management.apps.operations.models_combat import OpsCombatDutyShift
    shift = OpsCombatDutyShift.objects.get(pk=data["id"])
    shift.submission["execution"]["stateCode"] = "READY"
    shift.save()
    assert s["staff"].post(path + "check-in/", {}, format="json").status_code == 422
