"""Объектная область рекогносцировки (`[РЕК-10]`, Plane №982)."""

import pytest

from organization_management.apps.operations.audit_service import (
    SECURITY_EVENT_PLACEMENT_BY_DEPUTY,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    URL,
    _deputy_persona,
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _employee_client(username, role):
    api, user = client_for(username, role, perms=("event.view",))
    employee = make_employee(last_name=role, first_name="Рекогносцировка")
    employee.user = user
    employee.save(update_fields=["user"])
    return api, employee


@pytest.fixture
def two_object_recon(manager):  # noqa: F811
    first_object = make_object(code="RECON-OWN-A", name="Объект A", with_passport=True)
    second_object = make_object(code="RECON-OWN-B", name="Объект B", with_passport=True)
    event_id = create_event(manager, first_object).json()["id"]
    added = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    assert added.status_code == 201, added.content
    visits = list(
        OpsSecurityEventVisitObject.objects.filter(event_id=event_id).order_by(
            "position", "pk"
        )
    )
    chief_a, employee_a = _employee_client("recon-chief-a", "RECON_CHIEF_A")
    chief_b, employee_b = _employee_client("recon-chief-b", "RECON_CHIEF_B")
    service.assign_visit_object_chief(
        event_id, visits[0].pk, employee_id=employee_a.pk, actor="tests"
    )
    service.assign_visit_object_chief(
        event_id, visits[1].pk, employee_id=employee_b.pk, actor="tests"
    )
    return event_id, visits[0], visits[1], chief_a, chief_b


def _checked(card):
    return [{**item, "state": "NORMAL"} for item in card["reconChecklist"]]


def test_object_chief_imports_only_their_visit_object(two_object_recon):
    event_id, first, second, chief_a, _chief_b = two_object_recon
    base = f"{URL}{event_id}/"

    own = chief_a.post(
        f"{base}recon/import-from-passport/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )
    foreign = chief_a.post(
        f"{base}recon/import-from-passport/",
        {"visitObjectId": str(second.pk)},
        format="json",
    )

    assert own.status_code == 200, own.content
    assert foreign.status_code == 403, foreign.content
    capabilities = {
        row["id"]: row["canManageRecon"] for row in own.json()["visitObjects"]
    }
    assert capabilities == {str(first.pk): True, str(second.pk): False}


def test_object_chief_cannot_change_posts_of_a_neighbour(two_object_recon):
    event_id, first, second, chief_a, chief_b = two_object_recon
    base = f"{URL}{event_id}/"
    for visit, api in ((first, chief_a), (second, chief_b)):
        imported = api.post(
            f"{base}recon/import-from-passport/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert imported.status_code == 200, imported.content
    card = chief_a.get(base).json()
    changed = [
        {**row, "task": "Чужая правка"}
        if row["visitObjectId"] == str(second.pk)
        else row
        for row in card["reconSectorPosts"]
    ]

    denied = chief_a.patch(
        f"{base}recon/",
        {
            "visitObjectId": str(first.pk),
            "checklist": card["reconChecklist"],
            "sectorPosts": changed,
        },
        format="json",
    )

    assert denied.status_code == 403, denied.content


def test_object_chief_cannot_clone_a_neighbours_known_post_id(two_object_recon):
    event_id, first, second, chief_a, chief_b = two_object_recon
    base = f"{URL}{event_id}/"
    for visit, api in ((first, chief_a), (second, chief_b)):
        imported = api.post(
            f"{base}recon/import-from-passport/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert imported.status_code == 200, imported.content
    card = chief_a.get(base).json()
    neighbour = next(
        row
        for row in card["reconSectorPosts"]
        if row["visitObjectId"] == str(second.pk)
    )

    denied = chief_a.patch(
        f"{base}recon/",
        {
            "visitObjectId": str(first.pk),
            "checklist": card["reconChecklist"],
            "sectorPosts": [
                {**neighbour, "visitObjectId": str(first.pk)},
                *card["reconSectorPosts"],
            ],
        },
        format="json",
    )

    assert denied.status_code == 400, denied.content
    assert "sectorPosts.0.id" in denied.json()["details"]


@pytest.mark.parametrize("mutation", ["add", "edit", "delete"])
def test_object_chief_cannot_mutate_unassigned_posts(
    two_object_recon, manager, mutation  # noqa: F811
):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    base = f"{URL}{event_id}/"
    card = manager.get(base).json()
    legacy = {
        "sector": "Legacy",
        "post": "Неразмеченный пост",
        "need": 1,
        "task": "",
        "requirements": "",
        "visitObjectId": None,
    }
    if mutation != "add":
        seeded = manager.patch(
            f"{base}recon/",
            {
                "checklist": card["reconChecklist"],
                "sectorPosts": [*card["reconSectorPosts"], legacy],
            },
            format="json",
        )
        assert seeded.status_code == 200, seeded.content
        card = seeded.json()
        legacy = next(
            row for row in card["reconSectorPosts"] if row["visitObjectId"] is None
        )

    if mutation == "add":
        posts = [*card["reconSectorPosts"], legacy]
    elif mutation == "edit":
        posts = [
            {**row, "task": "Чужая правка"} if row["id"] == legacy["id"] else row
            for row in card["reconSectorPosts"]
        ]
    else:
        posts = [row for row in card["reconSectorPosts"] if row["id"] != legacy["id"]]

    denied = chief_a.patch(
        f"{base}recon/",
        {
            "visitObjectId": str(first.pk),
            "checklist": card["reconChecklist"],
            "sectorPosts": posts,
        },
        format="json",
    )

    assert denied.status_code == 403, denied.content


def test_object_chief_updates_only_their_checklist_and_force_request(
    two_object_recon,
):
    event_id, first, second, chief_a, chief_b = two_object_recon
    base = f"{URL}{event_id}/"
    for visit, api in ((first, chief_a), (second, chief_b)):
        imported = api.post(
            f"{base}recon/import-from-passport/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert imported.status_code == 200, imported.content

    card = chief_a.get(base).json()
    saved = chief_a.patch(
        f"{base}recon/",
        {
            "visitObjectId": str(first.pk),
            "checklist": _checked(card),
            "sectorPosts": card["reconSectorPosts"],
            "forceRequest": 41,
        },
        format="json",
    )

    assert saved.status_code == 200, saved.content
    visits = {row["id"]: row for row in saved.json()["visitObjects"]}
    assert all(row["state"] == "NORMAL" for row in visits[str(first.pk)]["reconChecklist"])
    assert visits[str(first.pk)]["reconForceRequest"] == 41
    assert all(
        row["state"] == "UNCHECKED"
        for row in visits[str(second.pk)]["reconChecklist"]
    )
    assert visits[str(second.pk)]["reconForceRequest"] == 0

    blocked = chief_b.post(
        f"{base}recon/complete/",
        {"visitObjectId": str(second.pk)},
        format="json",
    )
    assert blocked.status_code == 422, blocked.content
    assert blocked.json()["error_code"] == "RECON_CHECKLIST_INCOMPLETE"


def test_stage_override_can_move_an_existing_post_between_objects(
    two_object_recon, manager  # noqa: F811
):
    event_id, first, second, chief_a, chief_b = two_object_recon
    base = f"{URL}{event_id}/"
    for visit, api in ((first, chief_a), (second, chief_b)):
        imported = api.post(
            f"{base}recon/import-from-passport/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert imported.status_code == 200, imported.content
    card = manager.get(base).json()
    own = next(
        row
        for row in card["reconSectorPosts"]
        if row["visitObjectId"] == str(first.pk)
    )
    moved = [
        {**row, "visitObjectId": str(second.pk)} if row["id"] == own["id"] else row
        for row in card["reconSectorPosts"]
    ]

    response = manager.patch(
        f"{base}recon/",
        {"checklist": card["reconChecklist"], "sectorPosts": moved},
        format="json",
    )

    assert response.status_code == 200, response.content
    stored = next(
        row for row in response.json()["reconSectorPosts"] if row["id"] == own["id"]
    )
    assert stored["visitObjectId"] == str(second.pk)


def test_placement_manager_saves_a_post_comment_through_placement_endpoint(
    manager,  # noqa: F811
):
    obj = make_object(code="PLACEMENT-COMMENT", with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    visit_id = manager.get(base).json()["visitObjects"][0]["id"]
    imported = manager.post(
        f"{base}recon/import-from-passport/",
        {"visitObjectId": visit_id},
        format="json",
    ).json()
    post_id = imported["reconSectorPosts"][0]["id"]

    # Право расстановки не должно становиться обходом объектной
    # рекогносцировки: на RECON комментарий меняет только старший объекта.
    too_early = manager.patch(
        f"{base}placement/posts/{post_id}/comment/",
        {"comment": "Обход рекогносцировки"},
        format="json",
    )
    assert too_early.status_code == 422, too_early.content
    assert too_early.json()["error_code"] == "INVALID_STAGE_TRANSITION"

    checked = [{**row, "state": "NORMAL"} for row in imported["reconChecklist"]]
    saved = manager.patch(
        f"{base}recon/",
        {
            "visitObjectId": visit_id,
            "checklist": checked,
            "sectorPosts": imported["reconSectorPosts"],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    advanced = manager.post(
        f"{base}recon/complete/", {"visitObjectId": visit_id}, format="json"
    )
    assert advanced.status_code == 200, advanced.content
    response = manager.patch(
        f"{base}placement/posts/{post_id}/comment/",
        {"comment": "Усилить пост в вечернюю смену"},
        format="json",
    )

    assert response.status_code == 200, response.content
    post = next(
        row for row in response.json()["reconSectorPosts"] if row["id"] == post_id
    )
    assert post["comment"] == "Усилить пост в вечернюю смену"


def test_deputy_post_comment_is_named_in_the_placement_audit(manager):  # noqa: F811
    obj = make_object(code="PLACEMENT-COMMENT-DEPUTY", with_passport=True)
    deputy_employee = make_employee(last_name="Замещающий", first_name="Пётр")
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    visit_id = manager.get(base).json()["visitObjects"][0]["id"]
    imported = manager.post(
        f"{base}recon/import-from-passport/",
        {"visitObjectId": visit_id},
        format="json",
    ).json()
    post_id = imported["reconSectorPosts"][0]["id"]
    checked = [{**row, "state": "NORMAL"} for row in imported["reconChecklist"]]
    saved = manager.patch(
        f"{base}recon/",
        {
            "visitObjectId": visit_id,
            "checklist": checked,
            "sectorPosts": imported["reconSectorPosts"],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    advanced = manager.post(
        f"{base}recon/complete/", {"visitObjectId": visit_id}, format="json"
    )
    assert advanced.status_code == 200, advanced.content
    assigned = manager.post(
        f"{base}visit-objects/{visit_id}/deputies/",
        {"employeeId": str(deputy_employee.pk)},
        format="json",
    )
    assert assigned.status_code == 201, assigned.content
    deputy = _deputy_persona(deputy_employee, username="recon-comment-deputy")

    response = deputy.patch(
        f"{base}placement/posts/{post_id}/comment/",
        {"comment": "Проверить связь"},
        format="json",
    )

    assert response.status_code == 200, response.content
    trace = OpsAuditLog.objects.get(action=SECURITY_EVENT_PLACEMENT_BY_DEPUTY)
    assert trace.new_value["operation"] == "UPDATE_POST_COMMENT"
    assert trace.new_value["postId"] == str(post_id)
    assert trace.new_value["comment"] == "Проверить связь"
    assert trace.new_value["deputyId"] == str(deputy_employee.pk)


def test_each_object_chief_completes_only_their_object(two_object_recon, manager):
    event_id, first, second, chief_a, chief_b = two_object_recon
    base = f"{URL}{event_id}/"
    for visit, api in ((first, chief_a), (second, chief_b)):
        imported = api.post(
            f"{base}recon/import-from-passport/",
            {"visitObjectId": str(visit.pk)},
            format="json",
        )
        assert imported.status_code == 200, imported.content
    card = chief_a.get(base).json()
    saved = chief_a.patch(
        f"{base}recon/",
        {
            "visitObjectId": str(first.pk),
            "checklist": _checked(card),
            "sectorPosts": card["reconSectorPosts"],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content

    first_done = chief_a.post(
        f"{base}recon/complete/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )

    assert first_done.status_code == 200, first_done.content
    stages = {row["id"]: row["stage"] for row in first_done.json()["visitObjects"]}
    assert stages == {str(first.pk): "PLACEMENT", str(second.pk): "RECON"}
    assert first_done.json()["stage"] == "RECON"
    published = first_done.json()["demandRows"]
    assert published and {row["visitObjectId"] for row in published} == {str(first.pk)}
    first_need = sum(row["need"] for row in published)
    assert first_done.json()["forceRequests"][0]["requestedCount"] == first_need
    # HQ can already begin collecting the completed object's need.
    from organization_management.apps.divisions.models import Division
    department = Division.objects.create(name="Департамент раннего сбора", division_type=Division.DivisionType.DEPARTMENT)
    split = manager.post(f"{base}forces/allocation/", {"rows": [{"departmentId": str(department.pk), "need": first_need}]}, format="json")
    assert split.status_code == 200, split.content
    collection = manager.get(f"{base}force-collection/")
    assert collection.status_code == 200, collection.content
    assert {row["visitObjectId"] for row in collection.json()["objects"]} == {str(first.pk)}
    assert {row["visitObjectId"] for row in collection.json()["needByObject"]} == {str(first.pk)}
    stored = OpsSecurityEvent.objects.get(pk=event_id)
    allocation_snapshot = stored.force_allocation
    request_id = stored.force_requests[0]["id"]
    stored.force_requests[0]["comment"] = "Сбор уже начат"
    stored.force_roster = [{"employeeId": "accepted-before-second", "name": "Принят ранее"}]
    stored.save(update_fields=["force_requests", "force_roster", "updated_at"])
    draft_assignment = manager.post(
        f"{base}force-collection/objects/",
        {"rows": [{
            "employeeId": "accepted-before-second",
            "visitObjectId": str(second.pk),
        }]},
        format="json",
    )
    assert draft_assignment.status_code == 400, draft_assignment.content
    early_handover = manager.post(
        f"{base}force-collection/hand-over/",
        {"comment": "Рано"},
        format="json",
    )
    assert early_handover.status_code == 422, early_handover.content
    assert early_handover.json()["error_code"] == "FORCE_OBJECTS_NOT_READY"
    assert chief_a.post(
        f"{base}recon/complete/",
        {"visitObjectId": str(second.pk)},
        format="json",
    ).status_code == 403

    second_card = chief_b.get(base).json()
    second_checklist = next(
        row["reconChecklist"]
        for row in second_card["visitObjects"]
        if row["id"] == str(second.pk)
    )
    second_saved = chief_b.patch(
        f"{base}recon/",
        {
            "visitObjectId": str(second.pk),
            "checklist": _checked({"reconChecklist": second_checklist}),
            "sectorPosts": second_card["reconSectorPosts"],
        },
        format="json",
    )
    assert second_saved.status_code == 200, second_saved.content
    second_done = chief_b.post(
        f"{base}recon/complete/",
        {"visitObjectId": str(second.pk)},
        format="json",
    )
    assert second_done.status_code == 200, second_done.content
    assert second_done.json()["stage"] == "PLACEMENT"
    stored.refresh_from_db()
    assert stored.force_allocation == allocation_snapshot
    assert stored.force_roster[0]["employeeId"] == "accepted-before-second"
    assert stored.force_requests[0]["id"] == request_id
    assert stored.force_requests[0]["comment"] == "Сбор уже начат"
    assert stored.force_requests[0]["allocatedCount"] == 1
    assert stored.force_requests[0]["requestedCount"] > first_need
    assert {row["visitObjectId"] for row in stored.demand_rows} == {str(first.pk), str(second.pk)}
    assert {row["stage"] for row in second_done.json()["visitObjects"]} == {
        "PLACEMENT"
    }


def test_event_manage_without_object_assignment_cannot_edit_recon(two_object_recon):
    event_id, first, _second, _chief_a, _chief_b = two_object_recon
    event_manager, _ = client_for(
        "recon-global-manager",
        "RECON_GLOBAL_MANAGER",
        perms=("event.view", "event.manage"),
    )

    denied = event_manager.post(
        f"{URL}{event_id}/recon/import-from-passport/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )

    assert denied.status_code == 403, denied.content


def test_stage_override_can_run_recon_without_object_assignment(two_object_recon):
    event_id, first, _second, _chief_a, _chief_b = two_object_recon
    leader, _ = client_for(
        "recon-stage-leader",
        "RECON_STAGE_LEADER",
        perms=("event.view", "event.stage_override"),
    )

    allowed = leader.post(
        f"{URL}{event_id}/recon/import-from-passport/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )

    assert allowed.status_code == 200, allowed.content


def test_draft_recon_does_not_open_force_collection(two_object_recon):
    event_id, first, second, _chief_a, _chief_b = two_object_recon
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.demand_rows = [{"visitObjectId": str(first.pk), "need": 2}]
    assert event.stage == "RECON"
    assert service.can_collect_forces(event) is False


def test_published_zero_never_uses_neighbour_draft_need(two_object_recon):
    from django.utils import timezone
    event_id, first, second, _chief_a, _chief_b = two_object_recon
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.recon_force_request = 0
    event.recon_force_requested_at = timezone.now()
    event.force_need = 5  # Unfinished neighbour's draft physical need.
    assert service.force_demand_total(event) == 0


def test_partial_publish_retains_original_requested_number(two_object_recon):
    event_id, first, second, _chief_a, _chief_b = two_object_recon
    event = OpsSecurityEvent.objects.get(pk=event_id)
    first.stage = "DEMAND"
    first.recon_force_request = 64
    first.save(update_fields=["stage", "recon_force_request"])
    event.recon_sector_posts = [{"id": "own", "visitObjectId": str(first.pk), "need": 3}]
    event.save(update_fields=["recon_sector_posts"])
    service._publish_completed_visit_demand(event, first)
    event.refresh_from_db()
    assert event.recon_force_request == 64
    assert event.force_requests[0]["requestedCount"] == 64


def test_empty_post_removal_uses_object_stage_and_keeps_drafts_unpublished(two_object_recon):
    event_id, first, second, chief_a, _chief_b = two_object_recon
    first.stage = "PLACEMENT"
    first.save(update_fields=["stage"])
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.recon_sector_posts = [
        {"id": "remove-own", "visitObjectId": str(first.pk), "need": 1},
        {"id": "keep-own", "visitObjectId": str(first.pk), "need": 1},
        {"id": "draft-neighbour", "visitObjectId": str(second.pk), "need": 5},
    ]
    event.save(update_fields=["recon_sector_posts"])
    result = service.remove_placement_post(event_id, "remove-own")
    assert result.stage == "RECON"
    assert [row["sourcePostId"] for row in result.demand_rows] == ["keep-own"]
    assert [row["id"] for row in result.recon_sector_posts] == ["keep-own", "draft-neighbour"]
