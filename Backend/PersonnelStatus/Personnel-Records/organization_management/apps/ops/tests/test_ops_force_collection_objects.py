"""Собранные → объекты → расстановка (Plane №390, `[СБС-13]`)."""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent

from .test_ops_forces_gathering import (  # noqa: F401
    allocated_event,
    make_assignment_status_type,
    make_department,
    make_directorate,
)
from .test_ops_forces_scope import employee_of, scoped_client  # noqa: F401
from .test_ops_security_events_api import manager  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _accepted_event(manager):  # noqa: F811
    """ОМ с принятым составом из двух человек одного департамента."""
    own = make_department("Департамент А")
    directorate = make_directorate(own, "Управление А-1")
    base, allocation_id = allocated_event(manager, own)
    dept_lead = scoped_client("fc-dept", "FC_DEPT", own.pk)
    dept_lead.post(f"{base}forces/allocation/{allocation_id}/notify/")
    make_assignment_status_type()
    people = [employee_of(directorate, name) for name in ("Первов", "Второв")]
    for person in people:
        manager.post(
            f"{base}forces/allocation/{allocation_id}/members/",
            {"employeeId": str(person.pk)},
            format="json",
        )
    assert dept_lead.post(f"{base}forces/allocation/{allocation_id}/submit/").status_code == 200
    assert manager.post(f"{base}forces/allocation/{allocation_id}/accept/").status_code == 200
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    visit = OpsSecurityEvent.objects.get(pk=event_id).visit_objects.first()
    return base, [str(p.pk) for p in people], str(visit.pk)


def test_the_collection_card_carries_roster_objects_and_capacity(manager):  # noqa: F811
    base, people, visit_id = _accepted_event(manager)

    body = manager.get(f"{base}force-collection/").json()

    assert {r["employeeId"] for r in body["roster"]} == set(people)
    assert body["objects"][0]["visitObjectId"] == visit_id
    assert body["objects"][0]["assigned"] == 0
    assert body["handover"] == {}


def test_people_are_given_to_an_object_and_the_capacity_counts_them(manager):  # noqa: F811
    """Красная на мутации: не пиши `visitObjectId` в строку состава — ёмкость
    объекта останется нулём."""
    base, people, visit_id = _accepted_event(manager)

    resp = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": visit_id}]},
        format="json",
    )

    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["objects"][0]["assigned"] == 1
    by_id = {r["employeeId"]: r for r in body["roster"]}
    assert by_id[people[0]]["visitObjectId"] == visit_id
    assert by_id[people[1]].get("visitObjectId") is None


def test_a_foreign_object_is_refused_by_the_field(manager):  # noqa: F811
    base, people, _visit_id = _accepted_event(manager)

    resp = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": "999999"}]},
        format="json",
    )

    assert resp.status_code == 400
    assert "rows.0.visitObjectId" in resp.json()["details"]


def test_hand_over_refuses_unassigned_and_requires_a_comment_on_shortfall(manager):  # noqa: F811
    """Нераспределённые — отказ; недобор — только с комментарием; с
    комментарием передача записана вместе с недобором по объектам."""
    base, people, visit_id = _accepted_event(manager)
    url = f"{base}force-collection/hand-over/"

    unassigned = manager.post(url, {"comment": "x"}, format="json")
    assert unassigned.status_code == 422
    assert unassigned.json()["error_code"] == "FORCE_ROSTER_UNASSIGNED"

    manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": p, "visitObjectId": visit_id} for p in people]},
        format="json",
    )
    silent = manager.post(url, {}, format="json")
    assert silent.status_code == 400
    assert "comment" in silent.json()["details"]

    done = manager.post(url, {"comment": "Двоих хватит, остальных доберём"}, format="json")
    assert done.status_code == 200, done.data
    handover = done.json()["handover"]
    assert handover["comment"] == "Двоих хватит, остальных доберём"
    assert handover["shortfall"][0]["visitObjectId"] == visit_id
    assert handover["shortfall"][0]["short"] > 0

    again = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{"employeeId": people[0], "visitObjectId": None}]},
        format="json",
    )
    assert again.status_code == 422
    assert again.json()["error_code"] == "FORCE_HANDED_OVER"
