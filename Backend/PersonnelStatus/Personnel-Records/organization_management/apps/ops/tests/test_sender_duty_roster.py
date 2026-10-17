"""Sender heads read every current placement without dispatch authority."""
from datetime import timedelta

import pytest
from django.contrib.auth.models import User

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import RolePermission, UserRole
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import PermissionService, RoleAdminService
from organization_management.apps.statuses.tests.test_status_writes_require_status_manage import _client
from .test_duty_dispatch import DAY, client, configure, create, fixed_clock, scene

pytestmark = pytest.mark.django_db
ROSTER = "/api/statuses/statuses/duty-assignments/"


@pytest.fixture
def sender(scene):
    return _client("sender-roster", ("status.view",), scene["departments"][1].pk)


def test_canonical_directorate_head_reads_own_shifts_without_object_catalog_access(scene):
    own = Division.objects.create(name="Sender directorate", division_type="directorate", parent=scene["departments"][1])
    unit = scene["people"][0].staff_unit
    unit.division = own
    unit.save(update_fields=["division"])
    head = client("canonical-sender-head", "DIRECTORATE_HEAD", own.pk)
    actor = str(User.objects.get(username="canonical-sender-head").pk)
    assert PermissionService.visible_division_ids(actor, "status.view") == {own.pk}
    assert PermissionService.visible_division_ids(actor, "object.view") == set()
    assert PermissionService.visible_division_ids(actor, "duty.dispatch") == set()
    configure(scene)
    first = create(scene)
    second = create(scene, start_time="20:00", end_time="23:00")
    foreign = create(scene, employee_id=scene["people"][1].pk, status_id=scene["sources"][1].pk)
    assert first.status_code == second.status_code == foreign.status_code == 201
    assert {row["dispatch_assignment_id"] for row in read(head, scene)} == {first.data["id"], second.data["id"]}
    assert len(read(head, scene, object_id=scene["obj"].pk)) == 2
    assert read(head, scene, object_id=999999999) == []
    assert read(head, scene, employee=1) == []
    assert read(head, scene, employee=1, object_id=scene["obj"].pk) == []
    assert head.get(ROSTER, {"object_id": scene["obj"].pk, "date": DAY.isoformat()}).status_code == 403
    assert head.get("/api/ops/objects/").status_code == 403


def read(api, scene, *, employee=0, day=DAY, **filters):
    response = api.get(ROSTER, {
        "employee_id": scene["people"][employee].pk, "date": day.isoformat(), **filters,
    })
    assert response.status_code == 200, response.data
    return response.data["results"]


def test_sender_reads_all_shifts_across_objects_without_dispatch_permission(scene, sender):
    configure(scene)
    first = create(scene)
    assert first.status_code == 201
    other = OpsSecurityObject.objects.create(name="Second", code="sender-second", object_type="building", region="R", address="A", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    second = create(scene, start_time="20:00", end_time="23:00", placement={"kind": "GROUP", "object_id": str(other.pk), "group_id": "duty-group-2"})
    assert second.status_code == 201
    actor = str(User.objects.get(username="sender-roster").pk)
    assert PermissionService.visible_division_ids(actor, "duty.dispatch") == set()
    rows = read(sender, scene)
    assert {row["dispatch_assignment_id"] for row in rows} == {first.data["id"], second.data["id"]}
    assert {row["placement"]["object_id"] for row in rows} == {str(scene["obj"].pk), str(other.pk)}
    assert all(row["employee_id"] == scene["people"][0].pk and row["source"] == "dispatch" and row["time_zone"] for row in rows)
    assert {row["start_at"][11:16] for row in rows} == {"08:00", "20:00"}
    assert len(read(sender, scene, object_id=scene["obj"].pk)) == 1
    assert read(sender, scene, object_id=999999999) == []
    assert read(sender, scene, day=DAY - timedelta(days=1)) == []
    assert read(sender, scene, day=DAY + timedelta(days=1)) == []


def test_sender_sees_own_employee_but_not_foreign_employee(scene, sender):
    configure(scene)
    assert create(scene).status_code == 201
    assert create(scene, employee_id=scene["people"][1].pk, status_id=scene["sources"][1].pk).status_code == 201
    assert len(read(sender, scene)) == 1
    assert read(sender, scene, employee=1) == []
    assert read(sender, scene, employee=1, object_id=scene["obj"].pk) == []


def test_receiver_dispatch_scope_does_not_expand_employee_status_scope(scene):
    configure(scene)
    assert create(scene).status_code == 201
    response = scene["api"].get(ROSTER, {"object_id": scene["obj"].pk, "date": DAY.isoformat()})
    assert len(response.data["results"]) == 1
    assert read(scene["api"], scene) == []
    assert read(scene["api"], scene, object_id=scene["obj"].pk) == []


def test_revoked_own_scope_is_not_replaced_by_a_foreign_scope(scene, sender):
    configure(scene)
    assert create(scene).status_code == 201
    assert len(read(sender, scene)) == 1
    actor = str(User.objects.get(username="sender-roster").pk)
    RoleAdminService.assign_role(actor, "ROLE_sender-roster", scene["departments"][2].pk, actor="test")
    UserRole.objects.filter(user_id=actor, scope_division_id=scene["departments"][1].pk).update(is_active=False)
    assert read(sender, scene) == []


def test_revoked_status_read_permission_denies_placements(scene, sender):
    configure(scene)
    assert create(scene).status_code == 201
    assert len(read(sender, scene)) == 1
    RolePermission.objects.filter(role_code_id="ROLE_sender-roster", permission_code_id="status.view").delete()
    response = sender.get(ROSTER, {"employee_id": scene["people"][0].pk, "date": DAY.isoformat()})
    assert response.status_code == 403


def test_revoked_object_permission_does_not_remove_scoped_employee_read(scene):
    configure(scene)
    assert create(scene).status_code == 201
    reader = _client("sender-object-revoked", ("status.view", "object.view"), scene["departments"][1].pk)
    assert len(read(reader, scene)) == 1
    RolePermission.objects.filter(role_code_id="ROLE_sender-object-revoked", permission_code_id="object.view").delete()
    assert len(read(reader, scene)) == 1
    assert reader.get(ROSTER, {"object_id": scene["obj"].pk, "date": DAY.isoformat()}).status_code == 403


@pytest.mark.parametrize("invalid", ["cancelled_assignment", "cancelled_source", "inactive_employee"])
def test_sender_hides_cancelled_or_invalid_assignments(scene, sender, invalid):
    configure(scene)
    created = create(scene)
    assert created.status_code == 201
    assert len(read(sender, scene)) == 1
    if invalid == "cancelled_assignment":
        OpsDutyDispatchAssignment.objects.filter(pk=created.data["id"]).update(cancelled_at=Clock.now())
    elif invalid == "cancelled_source":
        OpsEmployeeStatus.objects.filter(pk=scene["sources"][0].pk).update(cancelled_at=Clock.now())
    else:
        person = scene["people"][0]
        person.is_active = False
        person.save(update_fields=["is_active"])
    assert read(sender, scene) == []


@pytest.mark.parametrize("end_time,next_day_count", [("08:00", 1), ("00:00", 0)])
def test_sender_calendar_query_includes_overnight_but_excludes_end_boundary(scene, sender, end_time, next_day_count):
    configure(scene)
    assert create(scene, start_time="20:00", end_time=end_time).status_code == 201
    assert len(read(sender, scene)) == 1
    assert len(read(sender, scene, day=DAY + timedelta(days=1))) == next_day_count
    assert read(sender, scene, day=DAY + timedelta(days=2)) == []
