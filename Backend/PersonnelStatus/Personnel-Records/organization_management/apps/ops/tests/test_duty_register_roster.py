"""The unified roster reads saved duty without inventing execution facts."""
from datetime import date, datetime, timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment, OpsDutyDispatchConfig
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_object import OpsSecurityObject, OpsObjectSector, OpsSecurityPost
from organization_management.apps.operations.models_status import OpsEmployeeStatus, Secondment
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.statuses.duty_assignments import normalize_assignment
from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
DAY = date(2026, 10, 7)
URL = "/api/ops/duty-register/roster/"


@pytest.fixture(autouse=True)
def roster_catalog():
    call_command("seed_status_types", verbosity=0)
    for code, name, priority, column in [
        ("DUTY", "На дежурстве", 70, "ON_DUTY"),
        ("GEV", "Группа экстренного выезда", 75, "ON_DUTY"),
        ("SICK_LEAVE", "Больничный", 10, "SICK"),
        ("ATTACHED", "Прикомандирован", 90, "ATTACHED"),
        ("DETACHED", "Откомандирован", 100, "DETACHED"),
    ]:
        StatusType.objects.update_or_create(code=code, defaults={
            "name": name, "priority": priority, "report_column_code": column,
        })
    with clock.override(DAY):
        yield


@pytest.fixture
def roster_scene():
    departments, people = [], []
    for name in ("Первый", "Второй", "Принимающий"):
        department = Division.objects.create(name=name, division_type="department")
        departments.append(department)
        people.append(make_employee(department))
    obj = OpsSecurityObject.objects.create(name="Сохранённый объект", code="roster-object", object_type="building",
        region="Регион", address="Адрес", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Сектор", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Сохранённый пост", position=1)
    placement = normalize_assignment({"kind": "POST", "object_id": str(obj.pk), "post_id": str(post.pk)},
        status_type="on_duty", start_date=DAY, end_date=DAY + timedelta(days=1))
    return {"departments": departments, "people": people, "obj": obj, "post": post, "placement": placement}


def reader(scope=None, permission="duty.view", name="unified-reader"):
    return client_for(name, "ROLE_" + name, (permission,), scope)[0]


def duty(person, code="DUTY", **extra):
    return OpsEmployeeStatus.objects.create(employee_id=person.pk, status_type_code=code,
        **{"date_start": DAY, "date_end": DAY + timedelta(days=2), **extra})


def status_placement(scene, person=None, **extra):
    return StatusApplicationService().create_status(employee_id=(person or scene["people"][0]).pk, status_type="on_duty",
        **{"start_date": DAY, "end_date": DAY + timedelta(days=1), "duty_assignment": scene["placement"], **extra})


def dispatch(scene, person=None, source=None, **extra):
    person = person or scene["people"][0]
    source = source or duty(person)
    return OpsDutyDispatchAssignment.objects.create(employee_id=person.pk, employee_name="Имя сохранённой смены",
        source_status=source, receiver_department_id=scene["departments"][2].pk, placement=scene["placement"],
        **{"start_at": datetime.fromisoformat("2026-10-07T08:00:00+05:00"),
           "end_at": datetime.fromisoformat("2026-10-07T20:00:00+05:00"), "created_by": "test", **extra})


def read(api, **query):
    return api.get(URL, {"business_date": DAY.isoformat(), **query})


def people(response):
    assert response.status_code == 200, response.data
    return [person for group in response.data["departments"] for person in group["employees"]]


def test_saved_status_is_the_placement_and_read_creates_no_shift_or_execution(roster_scene):
    scene = roster_scene
    saved = status_placement(scene)
    scene["post"].delete()
    scene["obj"].name = "Изменённый объект"
    scene["obj"].object_state = "ARCHIVED"
    scene["obj"].save(update_fields=["name", "object_state"])
    models = (EmployeeStatus, OpsEmployeeStatus, OpsDutyDispatchAssignment, OpsDutyRecordSupplement, OpsDutyLogEntry, OpsDutyShift)
    before = [list(model.objects.values()) for model in models]
    response = read(reader(scene["departments"][0].pk))
    assert people(response) == [{
        "employee_id": scene["people"][0].pk, "full_name": "Иванов Иван", "position_name": "",
        "status_label": "На дежурстве", "date_start": "2026-10-07", "date_end": "2026-10-09",
        "destination": "Сохранённый объект · Сохранённый пост", "placements": [{
            "source": "STATUS", "source_id": saved.pk, "label": "Сохранённый объект · Сохранённый пост",
            "start_at": None, "end_at": None, "record_id": None,
        }],
    }]
    assert response.data["time_zone"] == "Asia/Almaty"
    assert datetime.fromisoformat(response.data["generated_at"]) == clock.Clock.now()
    assert [list(model.objects.values()) for model in models] == before


def test_allocated_person_without_a_saved_place_has_an_empty_placements_array(roster_scene):
    source = duty(roster_scene["people"][0], "GEV", comment="Дежурный состав")
    result = people(read(reader()))
    assert len(result) == 1
    assert result[0]["status_label"] == "Группа экстренного выезда"
    assert result[0]["destination"] == "Дежурный состав"
    assert result[0]["placements"] == []
    assert source.cancelled_at is None


@pytest.mark.parametrize("permission", ["duty.view", "analytics.view", "duty.manage", "status.manage"])
def test_register_read_permissions_keep_their_own_division_scope(roster_scene, permission):
    scene = roster_scene
    for person in scene["people"]:
        duty(person)
    allowed = reader(scene["departments"][0].pk, permission)
    assert [p["employee_id"] for p in people(read(allowed))] == [scene["people"][0].pk]
    assert [p["employee_id"] for p in people(read(allowed, division_id=scene["departments"][1].pk))] == []


@pytest.mark.parametrize("permission", ["status.view", "admin.roles"])
def test_status_view_or_configuration_alone_does_not_read_the_journal(permission):
    assert read(reader(permission=permission)).status_code == 403


def test_anonymous_cannot_read_the_roster():
    assert read(APIClient()).status_code in (401, 403)


def test_cancelled_inactive_and_nonwinning_duty_never_appear(roster_scene):
    department = roster_scene["departments"][0]
    cancelled, inactive, sick, past, future = [make_employee(department) for _ in range(5)]
    duty(cancelled, cancelled_at=clock.Clock.now())
    duty(inactive)
    inactive.is_active = False
    inactive.save(update_fields=["is_active"])
    status_placement(roster_scene, sick)
    duty(sick, "SICK_LEAVE")
    duty(past, date_start=DAY - timedelta(days=1), date_end=DAY)
    duty(future, date_start=DAY + timedelta(days=1))
    assert people(read(reader())) == []


def test_live_attachment_admits_the_same_employee_only_and_keeps_host_group(roster_scene):
    scene = roster_scene
    host, outside = scene["departments"][:2]
    person = scene["people"][1]
    outgoing, incoming = duty(person, "DETACHED"), duty(person, "ATTACHED")
    Secondment.objects.create(employee_id=person.pk, from_division_id=outside.pk, to_division_id=host.pk,
        out_status=outgoing, in_status=incoming, created_by="test")
    duty(person)
    api = reader(host.pk)
    response = read(api)
    assert response.data["departments"][0]["id"] == host.pk
    assert [p["employee_id"] for p in people(response)] == [person.pk]
    incoming.cancelled_at = clock.Clock.now()
    incoming.save(update_fields=["cancelled_at"])
    assert people(read(api)) == []


def test_foreign_or_out_of_range_personnel_ref_cannot_borrow_saved_placement(roster_scene):
    scene = roster_scene
    saved = status_placement(scene, scene["people"][1])
    own = scene["people"][0]
    own_status = duty(own, source_ref=f"personnel:{saved.pk}")
    api = reader(scene["departments"][0].pk)
    assert people(read(api))[0]["placements"] == []
    OpsEmployeeStatus.objects.filter(pk=own_status.pk).update(source_ref="personnel:9999999999999999999999999999")
    assert people(read(api))[0]["placements"] == []


def test_mismatched_secondment_legs_do_not_expand_roster_scope(roster_scene):
    scene = roster_scene
    own, outside = scene["people"][:2]
    outgoing, incoming = duty(own, "DETACHED"), duty(own, "ATTACHED")
    Secondment.objects.create(employee_id=outside.pk, from_division_id=scene["departments"][1].pk,
        to_division_id=scene["departments"][0].pk, out_status=outgoing, in_status=incoming, created_by="test")
    duty(outside)
    assert people(read(reader(scene["departments"][0].pk))) == []


def test_nullable_personnel_end_never_becomes_a_made_up_shift_time(roster_scene):
    scene = roster_scene
    saved = status_placement(scene)
    EmployeeStatus.objects.filter(pk=saved.pk).update(end_date=None, actual_end_date=None)
    placement = people(read(reader()))[0]["placements"][0]
    assert placement["start_at"] is placement["end_at"] is None
    saved.refresh_from_db()
    assert saved.end_date is None


def test_multiple_dispatch_shifts_share_one_person_and_keep_existing_record_links(roster_scene):
    scene = roster_scene
    OpsDutyDispatchConfig.objects.create(receiver_department_id=scene["departments"][2].pk)
    source = duty(scene["people"][0])
    first = dispatch(scene, source=source)
    second = dispatch(scene, source=source, start_at=datetime.fromisoformat("2026-10-07T20:00:00+05:00"),
        end_at=datetime.fromisoformat("2026-10-08T08:00:00+05:00"))
    api = reader(scene["departments"][0].pk)
    result = people(read(api))
    assert len(result) == 1
    assert result[0]["placements"] == [{
        "source": "DISPATCH", "source_id": row.pk, "label": "Сохранённый объект · Сохранённый пост",
        "start_at": row.start_at.isoformat(), "end_at": row.end_at.isoformat(), "record_id": f"DISPATCH:{row.pk}",
    } for row in (first, second)]
    tomorrow = people(read(api, business_date="2026-10-08"))
    assert [p["source_id"] for p in tomorrow[0]["placements"]] == [second.pk]
    assert people(read(api, business_date="2026-10-09")) == []


@pytest.mark.parametrize("invalid", ["cancelled", "source_cancelled", "source_loses", "archived_object", "missing_post", "receiver_changed"])
def test_invalid_dispatch_stays_in_control_history_and_is_not_current_placement(roster_scene, invalid):
    scene = roster_scene
    config = OpsDutyDispatchConfig.objects.create(receiver_department_id=scene["departments"][2].pk)
    source = duty(scene["people"][0])
    row = dispatch(scene, source=source)
    api = reader(scene["departments"][0].pk)
    assert len(people(read(api))[0]["placements"]) == 1
    if invalid == "cancelled":
        OpsDutyDispatchAssignment.objects.filter(pk=row.pk).update(cancelled_at=clock.Clock.now())
    elif invalid == "source_cancelled":
        OpsEmployeeStatus.objects.filter(pk=source.pk).update(cancelled_at=clock.Clock.now())
    elif invalid == "source_loses":
        duty(scene["people"][0], "SICK_LEAVE")
    elif invalid == "archived_object":
        OpsSecurityObject.objects.filter(pk=scene["obj"].pk).update(object_state="ARCHIVED")
    elif invalid == "missing_post":
        scene["post"].delete()
    else:
        config.receiver_department_id = scene["departments"][1].pk
        config.save(update_fields=["receiver_department_id"])
    assert all(not p["placements"] for p in people(read(api)))
    assert api.get(f"/api/ops/duty-register/DISPATCH:{row.pk}/").status_code == 200


def test_receiver_queue_expands_only_for_the_configured_active_receiver(roster_scene):
    scene = roster_scene
    for person in scene["people"][:2]:
        duty(person)
    api = reader(scene["departments"][2].pk, "duty.dispatch")
    assert people(read(api)) == []
    config = OpsDutyDispatchConfig.objects.create(receiver_department_id=scene["departments"][2].pk)
    assert {p["employee_id"] for p in people(read(api))} == {p.pk for p in scene["people"][:2]}
    wrong = reader(scene["departments"][1].pk, "duty.dispatch", name="wrong-receiver")
    assert people(read(wrong)) == []
    Division.objects.filter(pk=config.receiver_department_id).update(is_active=False)
    assert people(read(api)) == []


def test_frozen_dispatch_history_scope_does_not_expose_live_roster_after_staff_transfer(roster_scene):
    scene = roster_scene
    OpsDutyDispatchConfig.objects.create(receiver_department_id=scene["departments"][2].pk)
    row = dispatch(scene)
    OpsDutyRecordSupplement.objects.create(source_type="DISPATCH", source_id=row.pk,
        employee_id=row.employee_id, employee_name=row.employee_name,
        division_id=scene["departments"][0].pk, division_name=scene["departments"][0].name)
    staff = scene["people"][0].staff_unit
    staff.division = scene["departments"][1]
    staff.save(update_fields=["division"])
    original_api = reader(scene["departments"][0].pk)
    history = original_api.get(f"/api/ops/duty-register/DISPATCH:{row.pk}/")
    assert history.status_code == 200
    assert history.data["division_id"] == scene["departments"][0].pk
    assert people(read(original_api)) == []
    current = people(read(reader(scene["departments"][1].pk, name="current-unit")))
    assert [p["employee_id"] for p in current] == [row.employee_id]
    assert current[0]["placements"] == []


def test_revoked_register_scope_does_not_retain_earlier_people(roster_scene):
    from organization_management.apps.operations.models import UserRole
    scene = roster_scene
    duty(scene["people"][0])
    api, user = client_for("revoked-roster", "REVOKED_ROSTER", ("analytics.view",), scene["departments"][0].pk)
    assert len(people(read(api))) == 1
    UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
    assert read(api).status_code == 403


@pytest.mark.parametrize("identifier_value", [2147483648, 9007199254740993])
def test_imported_big_department_and_status_ids_stay_exact(roster_scene, identifier_value):
    scene = roster_scene
    root = Division.objects.create(name="Импортная организация", division_type="organization")
    department = Division.objects.create(id=identifier_value, name="Импортный департамент", division_type="department", parent=root)
    person = make_employee(department)
    EmployeeStatus.objects.create(id=identifier_value, employee=person, status_type="on_duty", start_date=DAY,
        end_date=DAY + timedelta(days=1), duty_assignment=scene["placement"])
    wire_id = str(identifier_value) if identifier_value > 9007199254740991 else identifier_value
    response = read(reader(root.pk))
    assert response.data["departments"][0]["id"] == wire_id
    assert people(response)[0]["employee_id"] == person.pk
    assert people(response)[0]["placements"][0]["source_id"] == wire_id
    assert people(read(reader(scene["departments"][0].pk, name="foreign-big"))) == []


def test_big_dispatch_id_keeps_exact_source_and_record_key(roster_scene):
    scene = roster_scene
    OpsDutyDispatchConfig.objects.create(receiver_department_id=scene["departments"][2].pk)
    row = dispatch(scene, id=9007199254740993)
    result = people(read(reader(scene["departments"][0].pk)))[0]["placements"][0]
    assert result["source_id"] == "9007199254740993"
    assert result["record_id"] == "DISPATCH:9007199254740993"
    assert row.pk == 9007199254740993


@pytest.mark.parametrize("value", ["", "bad", "2026-02-30", "0001-01-01", "9999-12-31"])
def test_invalid_or_boundary_date_is_a_controlled_validation_error(value):
    assert read(reader(), business_date=value).status_code == 400


@pytest.mark.parametrize("value", ["-1", "0", "9223372036854775808", "foreign", ""])
def test_invalid_division_filter_is_rejected_without_scope_expansion(value):
    assert read(reader(), division_id=value).status_code == 400


def test_omitted_date_uses_business_clock():
    response = reader().get(URL)
    assert response.status_code == 200, response.data
    assert response.data["business_date"] == "2026-10-07"


def test_combat_groups_use_duty_view_scope_instead_of_the_broader_register_scope(roster_scene):
    scene = roster_scene
    own = OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="BG", group_name="Своя группа", route_set={},
        submission={"stateCode": "ACCEPTED", "submittedByDivisionId": scene["departments"][0].pk})
    OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="BG", group_name="Чужая группа", route_set={},
        submission={"stateCode": "ACCEPTED", "submittedByDivisionId": scene["departments"][1].pk})
    api, user = client_for("mixed-roster", "ROSTER_DUTY_READER", ("duty.view",), scene["departments"][0].pk)
    from organization_management.apps.operations.tests.test_bulk_status_api import seed_role
    from organization_management.apps.operations.services import RoleAdminService
    seed_role("ROSTER_GLOBAL_ANALYST", ("analytics.view",))
    RoleAdminService.assign_role(str(user.pk), "ROSTER_GLOBAL_ANALYST", None, actor="test")
    response = read(api)
    assert [group["shift_id"] for group in response.data["combat_groups"]] == [own.pk]
    assert read(reader(permission="analytics.view", name="analyst-only")).data["combat_groups"] == []
    assert read(reader(scene["departments"][2].pk, "duty.dispatch", name="dispatch-only")).data["combat_groups"] == []


def test_roster_queries_do_not_grow_per_saved_assignment(roster_scene):
    scene = roster_scene
    OpsDutyDispatchConfig.objects.create(receiver_department_id=scene["departments"][2].pk)
    dispatch(scene)
    api = reader()
    with CaptureQueriesContext(connection) as small:
        first = read(api)
    for _ in range(15):
        dispatch(scene, person=make_employee(scene["departments"][0]))
    with CaptureQueriesContext(connection) as large:
        result = read(api)
    assert len(people(first)) == 1
    assert len(people(result)) == 16
    assert len(large) <= len(small) + 1
