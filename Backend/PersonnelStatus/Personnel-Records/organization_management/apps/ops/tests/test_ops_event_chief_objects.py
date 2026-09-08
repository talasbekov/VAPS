"""Старший мероприятия ведёт список объектов и их старших (Plane №981)."""

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_event_bulletin_permissions import (
    URL,
    create_event,
    make_object,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    make_employee,
)
from organization_management.apps.ops.tests.test_ops_gvo_api import make_event

pytestmark = pytest.mark.django_db


def event_with_named_chief():
    manager, _ = client_for(
        "objects-admin",
        "EVENT_MANAGER",
        perms=("event.view", "event.manage", "event.create", "event.bulletin"),
    )
    first_object = make_object(code="OBJ-CHIEF-1", name="Первый объект")
    event_id = create_event(manager, object_id=first_object.pk).json()["id"]
    chief_api, chief_user = client_for(
        "objects-event-chief", "EVENT_CHIEF_DATA", perms=("event.view",)
    )
    chief = make_employee(last_name="Старший", first_name="Мероприятия")
    chief.user = chief_user
    chief.save(update_fields=["user"])
    OpsSecurityEvent.objects.filter(pk=event_id).update(
        chief_employee_id=chief.pk,
        chief_name="Старший М.",
    )
    return manager, chief_api, event_id, first_object


def test_named_event_chief_adds_objects_and_assigns_their_chiefs_without_manage():
    manager, chief_api, event_id, first_object = event_with_named_chief()
    second_object = make_object(code="OBJ-CHIEF-2", name="Второй объект")
    object_chief = make_employee(last_name="Старший", first_name="Объекта")
    base = f"{URL}{event_id}/"

    object_candidates = chief_api.get(f"{URL}bindable-objects/")
    personnel_candidates = chief_api.get(
        "/api/ops/personnel/", {"search": "Старший", "page_size": 10}
    )
    assert object_candidates.status_code == 200, object_candidates.content
    assert str(second_object.pk) in {
        row["id"] for row in object_candidates.json()["results"]
    }
    assert personnel_candidates.status_code == 200, personnel_candidates.content
    assert str(object_chief.pk) in {
        row["id"] for row in personnel_candidates.json()["results"]
    }

    added = chief_api.post(
        f"{base}visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    assert added.status_code == 201, added.content
    visits = {row["objectId"]: row for row in added.json()["visitObjects"]}
    first_visit_id = visits[str(first_object.pk)]["id"]
    second_visit_id = visits[str(second_object.pk)]["id"]

    assigned = chief_api.post(
        f"{base}visit-objects/{first_visit_id}/chief/",
        {"employeeId": str(object_chief.pk)},
        format="json",
    )
    assert assigned.status_code == 200, assigned.content
    assigned_visit = next(
        row for row in assigned.json()["visitObjects"] if row["id"] == first_visit_id
    )
    assert assigned_visit["chiefEmployeeId"] == str(object_chief.pk)

    removed_chief = chief_api.delete(
        f"{base}visit-objects/{first_visit_id}/chief/"
    )
    assert removed_chief.status_code == 200, removed_chief.content
    removed_object = chief_api.delete(
        f"{base}visit-objects/{second_visit_id}/"
    )
    assert removed_object.status_code == 200, removed_object.content
    assert {
        row["objectId"] for row in removed_object.json()["visitObjects"]
    } == {str(first_object.pk)}
    assert removed_object.json()["canManageVisitObjects"] is True

    # Административный override не потерян.
    assert manager.get(base).json()["canManageVisitObjects"] is True


def test_unassigned_employee_cannot_manage_another_events_objects():
    _, _, event_id, _ = event_with_named_chief()
    outsider, _ = client_for(
        "objects-outsider", "EVENT_OUTSIDER", perms=("event.view",)
    )
    second_object = make_object(code="OBJ-OUTSIDER", name="Чужой объект")
    base = f"{URL}{event_id}/"

    card = outsider.get(base)
    denied = outsider.post(
        f"{base}visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )

    assert card.status_code == 200, card.content
    assert outsider.get(f"{URL}bindable-objects/").status_code == 403
    assert outsider.get("/api/ops/personnel/").status_code == 403
    assert denied.status_code == 403, denied.content
    assert card.json()["canManageVisitObjects"] is False


def test_closed_event_does_not_keep_candidate_catalogs_open_for_former_chief():
    _, chief_api, event_id, _ = event_with_named_chief()
    OpsSecurityEvent.objects.filter(pk=event_id).update(
        stage=OpsSecurityEvent.Stage.CLOSED
    )

    assert chief_api.get(f"{URL}bindable-objects/").status_code == 403
    assert chief_api.get("/api/ops/personnel/").status_code == 403


def test_gvo_manager_capability_matches_object_chief_mutation():
    """Если API обещал управление объектами, назначение старшего не даёт 403."""
    api, _ = client_for(
        "objects-gvo-manager",
        "STAFF_GVO",
        perms=("event.view", "gvo.manage", "catalog.view"),
    )
    event = make_event("ОМ-981-GVO")
    visit_object = make_object(code="OBJ-981-GVO", name="Объект ГВО")
    object_chief = make_employee(last_name="ГВО", first_name="Объект")
    base = f"{URL}{event.pk}/"

    added = api.post(
        f"{base}visit-objects/",
        {"objectId": str(visit_object.pk)},
        format="json",
    )
    assert added.status_code == 201, added.content
    assert added.json()["canManageVisitObjects"] is True
    visit_id = added.json()["visitObjects"][0]["id"]

    assigned = api.post(
        f"{base}visit-objects/{visit_id}/chief/",
        {"employeeId": str(object_chief.pk)},
        format="json",
    )

    assert assigned.status_code == 200, assigned.content


def test_bulletin_creator_does_not_appoint_visit_object_chiefs():
    """`[ОМ-РШ-06]` отделяет правку бюллетеня от управления объектами."""
    creator, _ = client_for(
        "objects-bulletin-creator",
        "EMPLOYEE_OPS_D2",
        perms=("event.view", "event.create", "event.bulletin"),
    )
    visit_object = make_object(code="OBJ-CREATOR-981", name="Объект создателя")
    event_id = create_event(
        creator, title="Бюллетень без старшинства", object_id=visit_object.pk
    ).json()["id"]
    object_chief = make_employee(last_name="Чужой", first_name="Старший")
    event = OpsSecurityEvent.objects.get(pk=event_id)
    visit_id = event.visit_objects.get(security_object=visit_object).pk
    base = f"{URL}{event_id}/"

    denied = creator.post(
        f"{base}visit-objects/{visit_id}/chief/",
        {"employeeId": str(object_chief.pk)},
        format="json",
    )

    assert denied.status_code == 403, denied.content
    assert creator.get(base).json()["canManageVisitObjects"] is False


def test_foreign_bulletin_creator_does_not_bypass_visit_object_policy():
    """Старый GVO-override не должен расходиться с `[ОМ-РШ-06]`."""
    creator, _ = client_for(
        "objects-foreign-creator",
        "EMPLOYEE_OPS_D2",
        perms=("event.view", "event.create", "event.bulletin"),
    )
    first_object = make_object(code="OBJ-FOREIGN-CREATOR", name="Первый объект")
    second_object = make_object(code="OBJ-FOREIGN-EXTRA", name="Второй объект")
    event_id = create_event(
        creator, title="Иностранный бюллетень", object_id=first_object.pk
    ).json()["id"]
    OpsSecurityEvent.objects.filter(pk=event_id).update(kind="FOREIGN")
    base = f"{URL}{event_id}/"

    denied = creator.post(
        f"{base}visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )

    assert denied.status_code == 403, denied.content
    assert creator.get(base).json()["canManageVisitObjects"] is False
