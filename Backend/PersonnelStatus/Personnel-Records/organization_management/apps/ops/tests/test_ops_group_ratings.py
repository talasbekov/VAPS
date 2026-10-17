"""Collective evaluation is scoped to an explicit event post, never to a unit.

These checks catch missing group tasks, copying a collective score to people,
silent membership changes, history rewritten by corrections and partial writes.
"""
import json

import pytest
from django.db import connection
from django.db.models.query import QuerySet

from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.models_rating import (
    OpsEvaluationCorrection, OpsEvaluationWorkItem, OpsEventEvaluation,
    OpsRatingAuditEntry, OpsRatingIdempotencyRecord, OpsRatingNotification,
)
from organization_management.apps.ops import ratings
from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    make_employee, manager,
)
from organization_management.apps.ops.tests.test_ops_evaluation_on_close import (
    assignment, make_event,
)
from organization_management.apps.ops.tests.test_ops_ratings_api import (
    WORKSPACE, REGISTRY, evaluator, policy, correct_path, detail_path, submit_path,
    _submit_body,
)
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db


@pytest.fixture
def group_event(evaluator, policy, request):
    api, actor = evaluator
    event = make_event("GROUP-CHECK", assignments=[
        assignment(11, "Первый участник", "group-a"),
        assignment(12, "Второй участник", "group-a"),
        assignment(13, "Соседняя группа", "group-b"),
        assignment(14, "Физический наряд", "physical"),
    ])
    event.stage = "CONDUCT"
    chief = make_employee(last_name="Старший мероприятия")
    chief.user_id = int(actor)
    chief.save(update_fields=["user"])
    event.chief_employee_id = chief.pk
    first = OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Первый объект", position=0, stage="CONDUCT",
    )
    second = OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Второй объект", position=1,
        stage=getattr(request, "param", "CONDUCT"),
    )
    event.recon_sector_posts = [
        {"id": "group-a", "post": "Группа досмотра входа", "need": 2,
         "demandKindCode": "SCREENING_GROUP", "visitObjectId": str(first.pk)},
        {"id": "group-b", "post": "Кинологическая группа", "need": 1,
         "demandKindCode": "CANINE_GROUP", "visitObjectId": str(second.pk)},
        {"id": "physical", "post": "Периметр", "need": 1,
         "demandKindCode": "PHYSICAL_SQUAD", "visitObjectId": str(first.pk)},
    ]
    event.save(update_fields=["stage", "recon_sector_posts", "chief_employee_id"])
    ratings.open_evaluation_for_event(event, actor=actor)
    return api, actor, event, first, second


def group_item(api):
    pending = api.get(WORKSPACE).json()["pending"]
    groups = [row for row in pending if row["targetGroupId"] is not None]
    assert len(groups) == 2, "Explicit special posts must open collective evaluation tasks"
    return next(row for row in groups if row["postLabel"] == "Группа досмотра входа")


def body_for(item, **overrides):
    return _submit_body(groupRosterToken=item["groupRosterToken"], **overrides)


def test_opening_groups_uses_exact_post_and_preserves_original_plan(group_event):
    api, actor, event, first, _ = group_event
    item = group_item(api)
    assert item["evaluationDirection"] == "SENIOR_TO_GROUP"
    assert item["targetEmployeeId"] is None
    assert item["groupSnapshot"]["objectId"] == str(first.pk)
    assert item["groupSnapshot"]["objectLabel"] == "Первый объект"
    assert [m["safeLabel"] for m in item["groupSnapshot"]["plannedMembers"]] == [
        "Первый участник", "Второй участник",
    ]
    before = OpsEvaluationWorkItem.objects.count()
    event.placement_assignments[1] = assignment(15, "Заменяющий участник", "group-a")
    event.save(update_fields=["placement_assignments"])
    ratings.open_evaluation_for_event(event, actor=actor)
    fresh = group_item(api)
    assert OpsEvaluationWorkItem.objects.count() == before + 1  # New individual only.
    assert fresh["groupSnapshot"]["plannedMembers"] == item["groupSnapshot"]["plannedMembers"]
    assert {m["safeLabel"] for m in fresh["groupSnapshot"]["actualMembers"]} == {
        "Первый участник", "Заменяющий участник",
    }


@pytest.mark.parametrize("group_event", ["APPROVAL"], indirect=True)
def test_special_post_of_object_before_conduct_does_not_open_group_task(group_event):
    api, _, _, _, _ = group_event
    groups = [row for row in api.get(WORKSPACE).json()["pending"] if row["targetGroupId"] is not None]
    assert len(groups) == 1
    assert groups[0]["postLabel"] == "Группа досмотра входа"


def test_submit_persists_one_collective_fact_without_individual_scores(group_event):
    api, actor, _, _, _ = group_event
    item = group_item(api)
    response = api.post(submit_path(item["id"]), body_for(
        item, targetGroupId="foreign-group", targetEmployeeId="employee-13",
        groupSnapshot={"actualMembers": [{"safeLabel": "Подменённый участник"}]},
    ), format="json")
    assert response.status_code == 201, response.content
    data = response.json()
    saved = OpsEventEvaluation.objects.get(evaluation_code=data["submitted"]["evaluationId"])
    assert saved.participant_code is None
    assert saved.target_group_code == item["targetGroupId"]
    assert saved.evaluator_user_id == actor
    assert OpsEventEvaluation.objects.count() == 1
    assert OpsEventEvaluation.objects.filter(participant_code="employee-11").count() == 0
    assert data["workItem"]["revision"] == 2
    assert data["submitted"]["groupSnapshot"] == item["groupSnapshot"]
    assert OpsRatingNotification.objects.filter(code="EVALUATION_SUBMITTED").count() == 1
    again = api.post(submit_path(item["id"]), body_for(item), format="json")
    assert again.status_code == 201
    assert again.json()["submitted"]["evaluationId"] == saved.evaluation_code
    assert OpsEventEvaluation.objects.count() == 1


@pytest.mark.parametrize("score, comment, code", [
    (0, None, "SCORE_OUT_OF_SCALE"),
    (2.5, "Причина", "SCORE_NOT_INTEGER"),
    (True, "Причина", "SCORE_NOT_INTEGER"),
    (7, None, "COMMENT_REQUIRED"),
])
def test_group_score_rules_do_not_write_partial_results(group_event, score, comment, code):
    api, _, _, _, _ = group_event
    item = group_item(api)
    response = api.post(submit_path(item["id"]), body_for(item, score=score, comment=comment), format="json")
    assert response.status_code == 422
    assert response.json()["error_code"] == code
    assert OpsEventEvaluation.objects.count() == 0
    assert OpsRatingIdempotencyRecord.objects.count() == 0
    assert OpsEvaluationWorkItem.objects.get(work_item_code=item["id"]).revision == 1


def test_changed_actual_roster_rejects_open_form_and_reload_can_submit(group_event):
    api, _, event, _, _ = group_event
    item = group_item(api)
    event.placement_assignments[1] = assignment(15, "Заменяющий участник", "group-a")
    event.save(update_fields=["placement_assignments"])
    stale = api.post(submit_path(item["id"]), body_for(item), format="json")
    assert stale.status_code == 409
    assert stale.json()["error_code"] == "GROUP_ROSTER_CHANGED"
    assert OpsEventEvaluation.objects.count() == 0
    fresh = group_item(api)
    assert fresh["groupRosterToken"] != item["groupRosterToken"]
    assert api.post(submit_path(item["id"]), body_for(fresh), format="json").status_code == 201


def test_group_submission_requires_roster_token_and_nonempty_actual_members(group_event):
    api, _, event, _, _ = group_event
    item = group_item(api)
    missing = api.post(submit_path(item["id"]), _submit_body(), format="json")
    assert missing.status_code == 409
    assert missing.json()["error_code"] == "GROUP_ROSTER_CHANGED"
    event.placement_assignments = [row for row in event.placement_assignments if row["postId"] != "group-a"]
    event.save(update_fields=["placement_assignments"])
    fresh = group_item(api)
    empty = api.post(submit_path(item["id"]), body_for(fresh), format="json")
    assert empty.status_code == 422
    assert empty.json()["error_code"] == "PARTICIPATION_NOT_CONFIRMED"
    assert OpsEventEvaluation.objects.count() == 0


def test_neighbor_group_changes_do_not_change_this_groups_token(group_event):
    api, _, event, _, _ = group_event
    item = group_item(api)
    event.placement_assignments[2] = assignment(17, "Новая соседняя группа", "group-b")
    event.save(update_fields=["placement_assignments"])
    fresh = group_item(api)
    assert fresh["groupRosterToken"] == item["groupRosterToken"]
    response = api.post(submit_path(item["id"]), body_for(item), format="json")
    assert response.status_code == 201
    assert "Новая соседняя группа" not in json.dumps(response.json(), ensure_ascii=False)


@pytest.mark.parametrize("change", ["object", "kind"])
def test_group_target_does_not_follow_reassigned_post(group_event, change):
    api, _, event, _, second = group_event
    item = group_item(api)
    if change == "object":
        event.recon_sector_posts[0]["visitObjectId"] = str(second.pk)
    else:
        event.recon_sector_posts[0]["demandKindCode"] = "PHYSICAL_SQUAD"
    event.save(update_fields=["recon_sector_posts"])
    response = api.post(submit_path(item["id"]), body_for(item), format="json")
    assert response.status_code == 422
    assert response.json()["error_code"] == "GROUP_ROSTER_UNRECORDED"
    assert OpsEventEvaluation.objects.count() == 0
    assert group_item(api)["canSubmit"] is False


def test_group_correction_preserves_roster_history_and_registry_scope(group_event):
    api, _, event, first, _ = group_event
    item = group_item(api)
    original = api.post(submit_path(item["id"]), body_for(item), format="json").json()["submitted"]
    event.placement_assignments = [assignment(16, "Поздний участник", "group-a")]
    event.recon_sector_posts[0]["post"] = "Новое название поста"
    event.save(update_fields=["placement_assignments", "recon_sector_posts"])
    first.object_name = "Новое название объекта"
    first.save(update_fields=["object_name"])
    response = api.post(correct_path(item["id"]), _submit_body(
        score=10, revision=2, idempotencyKey="group-correction", reason="Уточнение результата",
    ), format="json")
    assert response.status_code == 201, response.content
    replacement = response.json()["submitted"]
    assert replacement["groupSnapshot"] == original["groupSnapshot"]
    assert OpsEvaluationCorrection.objects.count() == 1
    detail = api.get(detail_path(item["id"])).json()
    assert len(detail["chain"]) == 2
    assert detail["workItem"]["groupSnapshot"] == original["groupSnapshot"]
    viewer, _ = client_for("group-registry", "GROUP_REGISTRY", perms=("rating.view_aggregate",))
    rows = viewer.get(REGISTRY).json()["results"]
    assert len(rows) == 2
    assert all(row["employeeId"] is None and row["personnelId"] is None for row in rows)
    assert all(row["groupId"] == item["targetGroupId"] for row in rows)
    assert all(row["objectLabel"] == "Первый объект" for row in rows)
    assert all(row["postLabel"] == "Группа досмотра входа" for row in rows)
    assert all(row["employeeSafeLabel"] == item["targetSafeLabel"] for row in rows)
    assert all(row["aggregateRating"] is None for row in rows)
    payload = json.dumps(rows, ensure_ascii=False)
    assert "Уточнение результата" not in payload
    assert "Первый участник" not in payload


def test_foreign_group_is_not_readable_or_mutable(group_event):
    api, _, _, _, _ = group_event
    item = group_item(api)
    foreign, _ = client_for("other-group-rater", "OTHER_GROUP_RATER", perms=("rating.evaluate", "rating.correct"))
    response = foreign.post(submit_path(item["id"]), body_for(item), format="json")
    assert response.status_code == 404
    assert OpsEventEvaluation.objects.count() == 0
    api.post(submit_path(item["id"]), body_for(item), format="json")
    assert foreign.get(detail_path(item["id"])).status_code == 404
    assert foreign.post(correct_path(item["id"]), _submit_body(
        score=10, revision=2, reason="Чужое исправление", idempotencyKey="foreign-group",
    ), format="json").status_code == 404


def test_rating_permission_is_required_for_group_submission(group_event):
    api, _, _, _, _ = group_event
    item = group_item(api)
    denied, _ = client_for("group-reader", "GROUP_READER", perms=("rating.view_aggregate",))
    response = denied.post(submit_path(item["id"]), body_for(item), format="json")
    assert response.status_code == 403
    assert OpsEventEvaluation.objects.count() == 0
    assert denied.get(WORKSPACE).status_code == 403


def test_group_submit_rejects_stale_revision_and_closed_own_object(group_event):
    api, _, _, first, _ = group_event
    item = group_item(api)
    stale = api.post(submit_path(item["id"]), body_for(item, revision=99), format="json")
    assert stale.status_code == 409
    assert stale.json()["error_code"] == "EVALUATION_REVISION_MISMATCH"
    first.stage = "CLOSED"
    first.save(update_fields=["stage"])
    locked = group_item(api)
    assert locked["canSubmit"] is False
    assert locked["submissionUnavailableReason"]
    closed = api.post(submit_path(item["id"]), body_for(item), format="json")
    assert closed.status_code == 422
    assert closed.json()["error_code"] == "EVALUATION_ARCHIVE_LOCKED"
    assert OpsEventEvaluation.objects.count() == 0


def test_closed_group_object_cannot_be_corrected(group_event):
    api, _, _, first, _ = group_event
    item = group_item(api)
    api.post(submit_path(item["id"]), body_for(item), format="json")
    first.stage = "CLOSED"
    first.save(update_fields=["stage"])
    detail = api.get(detail_path(item["id"])).json()
    assert detail["canCorrect"] is False
    response = api.post(correct_path(item["id"]), _submit_body(
        score=10, revision=2, reason="Позднее исправление", idempotencyKey="closed-correction",
    ), format="json")
    assert response.status_code == 422
    assert response.json()["error_code"] == "EVALUATION_ARCHIVE_LOCKED"
    assert OpsEvaluationCorrection.objects.count() == 0


def test_failed_group_side_effect_rolls_back_all_success_facts(group_event, monkeypatch):
    api, actor, _, _, _ = group_event
    item = group_item(api)
    audits_before = OpsRatingAuditEntry.objects.count()

    def fail_notification(**kwargs):
        raise RuntimeError("Simulated storage failure")

    # Notification creation normally persists within the same atomic transaction.
    monkeypatch.setattr(ratings, "_notification_row", fail_notification)
    with pytest.raises(RuntimeError, match="Simulated storage failure"):
        ratings.submit_evaluation(actor, {"rating.evaluate"}, item["id"], body_for(item))
    assert OpsEventEvaluation.objects.count() == 0
    assert OpsRatingIdempotencyRecord.objects.count() == 0
    assert OpsRatingNotification.objects.count() == 0
    assert OpsRatingAuditEntry.objects.count() == audits_before
    saved = OpsEvaluationWorkItem.objects.get(work_item_code=item["id"])
    assert saved.status == "PENDING"
    assert saved.revision == 1
    assert saved.submitted_evaluation_code is None


def test_failed_group_correction_preserves_original_and_revision(group_event, monkeypatch):
    api, actor, _, _, _ = group_event
    item = group_item(api)
    original = api.post(submit_path(item["id"]), body_for(item), format="json").json()["submitted"]

    def fail_notification(**kwargs):
        raise RuntimeError("Correction storage failure")

    monkeypatch.setattr(ratings, "_notification_row", fail_notification)
    with pytest.raises(RuntimeError, match="Correction storage failure"):
        ratings.correct_evaluation(actor, {"rating.correct"}, item["id"], _submit_body(
            score=10, revision=2, reason="Уточнение", idempotencyKey="rollback-correction",
        ))
    assert OpsEventEvaluation.objects.count() == 1
    assert OpsEvaluationCorrection.objects.count() == 0
    assert OpsRatingIdempotencyRecord.objects.filter(operation="correct").count() == 0
    saved = OpsEventEvaluation.objects.get(evaluation_code=original["evaluationId"])
    assert saved.superseded_by_code is None
    task = OpsEvaluationWorkItem.objects.get(work_item_code=item["id"])
    assert task.revision == 2
    assert task.submitted_evaluation_code == saved.evaluation_code


def test_scoring_one_visit_cannot_take_another_chiefs_group(group_event):
    _, _, event, first, second = group_event
    chiefs = []
    for index, visit in enumerate((first, second)):
        api, user = client_for(f"group-chief-{index}", f"GROUP_CHIEF_{index}", perms=(
            "event.view", "rating.evaluate", "rating.correct",
        ))
        employee = make_employee(last_name=f"Старший{index}")
        employee.user = user
        employee.save(update_fields=["user"])
        visit.chief_employee_id = employee.pk
        visit.save(update_fields=["chief_employee_id"])
        item = OpsEvaluationWorkItem.objects.get(
            event_code=f"security-event-{event.pk}", target_group_code__isnull=False,
            assignment_code=f"group-{'a' if index == 0 else 'b'}",
        )
        item.evaluator_user_id = str(user.pk)
        item.save(update_fields=["evaluator_user_id"])
        chiefs.append((api, user, item))

    first_api, _, first_item = chiefs[0]
    second_api, second_user, second_item = chiefs[1]
    foreign_preview = next(row for row in second_api.get(WORKSPACE).json()["pending"]
                           if row["id"] == second_item.work_item_code)
    url = f"/api/ops/security-events/{event.pk}/visit-objects/{first.pk}/evaluations/"
    response = first_api.post(url, {
        "assignmentId": event.placement_assignments[0]["id"], "score": 9,
    }, format="json")
    assert response.status_code == 200, response.content
    second_item.refresh_from_db()
    assert second_item.evaluator_user_id == str(second_user.pk), "Scoring A stole B's pending group"
    mine = first_api.get(WORKSPACE).json()["pending"]
    assert first_item.work_item_code in {row["id"] for row in mine}
    assert second_item.work_item_code not in {row["id"] for row in mine}
    forbidden = first_api.post(submit_path(second_item.work_item_code), body_for(foreign_preview), format="json")
    assert forbidden.status_code == 404, forbidden.content
    assert OpsEventEvaluation.objects.filter(target_group_code=second_item.target_group_code).count() == 0

    # Canonical reopening/closure by an admin must keep the real visit owners.
    ratings.open_evaluation_for_event(event, actor="event-admin")
    for _, user, item in chiefs:
        item.refresh_from_db()
        assert item.evaluator_user_id == str(user.pk)


def test_production_placement_snapshots_units_and_registry_search(manager, evaluator, policy):
    api, actor = evaluator
    event = make_event("GROUP-PLACEMENT", assignments=[])
    event.stage = "PLACEMENT"
    chief = make_employee(last_name="Старший мероприятия расстановки")
    chief.user_id = int(actor)
    chief.save(update_fields=["user"])
    visit = OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Объект подразделений", position=0, stage="PLACEMENT",
    )
    event.recon_sector_posts = [{
        "id": "production-group", "post": "Группа из штатного состава", "need": 2,
        "demandKindCode": "SCREENING_GROUP", "visitObjectId": str(visit.pk),
    }]
    event.save(update_fields=["stage", "recon_sector_posts"])
    division = Division.objects.create(name="Управление досмотра", code="GROUP-UNIT", division_type="division")
    new_division = Division.objects.create(name="Новое управление", code="GROUP-NEW", division_type="division")
    slots = []
    for index in range(2):
        employee = make_employee(last_name=f"Досмотровый{index}")
        slots.append(StaffUnit.objects.create(division=division, employee=employee, index=index + 1))
        placed = manager.post(f"/api/ops/security-events/{event.pk}/placement/assign/", {
            "postId": "production-group", "employeeId": str(employee.pk),
        }, format="json")
        assert placed.status_code == 200, placed.content
    event.refresh_from_db()
    assert all("divisionName" not in row for row in event.placement_assignments)
    event.stage = "CONDUCT"
    event.chief_employee_id = chief.pk
    event.save(update_fields=["stage", "chief_employee_id"])
    visit.stage = "CONDUCT"
    visit.save(update_fields=["stage"])
    ratings.open_evaluation_for_event(event, actor=actor)
    item = next(row for row in api.get(WORKSPACE).json()["pending"] if row["targetGroupId"] is not None)
    assert item["targetSafeUnitLabel"] == division.name
    assert {row["unitSafeLabel"] for row in item["groupSnapshot"]["plannedMembers"]} == {division.name}
    assert {row["unitSafeLabel"] for row in item["groupSnapshot"]["actualMembers"]} == {division.name}
    submitted = api.post(submit_path(item["id"]), body_for(item), format="json")
    assert submitted.status_code == 201, submitted.content
    snapshot = submitted.json()["submitted"]["groupSnapshot"]
    for slot in slots:
        # Moving an earlier MPTT root also renumbers the later slot's tree.
        slot.refresh_from_db()
        slot.division = new_division
        slot.save()
    corrected = api.post(correct_path(item["id"]), _submit_body(
        score=10, revision=2, idempotencyKey="units-correction", reason="Уточнение результата",
    ), format="json")
    assert corrected.status_code == 201, corrected.content
    assert corrected.json()["submitted"]["groupSnapshot"] == snapshot
    ratings.open_evaluation_for_event(event, actor=actor)
    assert api.get(detail_path(item["id"])).json()["workItem"]["groupSnapshot"] == snapshot
    viewer, _ = client_for("units-registry", "UNITS_REGISTRY", perms=("rating.view_aggregate",))
    rows = viewer.get(REGISTRY, {"search": division.name}).json()["results"]
    assert len(rows) == 2
    assert all(row["unitSafeLabel"] == division.name for row in rows)
    assert viewer.get(REGISTRY, {"search": new_division.name}).json()["results"] == []


@pytest.mark.parametrize("existing_blank", [False, True])
def test_visit_actor_cannot_claim_unlinked_neighbor_chiefs_group(group_event, existing_blank):
    _, _, event, first, second = group_event
    own_api, own_user = client_for("linked-own-chief", "LINKED_OWN_CHIEF", perms=(
        "event.view", "rating.evaluate",
    ))
    own_chief = make_employee(last_name="Старший своего объекта")
    own_chief.user = own_user
    own_chief.save(update_fields=["user"])
    first.chief_employee_id = own_chief.pk
    first.save(update_fields=["chief_employee_id"])
    foreign_chief = make_employee(last_name="Старший без учётной записи")
    second.chief_employee_id = foreign_chief.pk
    second.save(update_fields=["chief_employee_id"])
    if existing_blank:
        foreign = OpsEvaluationWorkItem.objects.get(
            event_code=f"security-event-{event.pk}", assignment_code="group-b",
            target_group_code__isnull=False,
        )
        foreign.evaluator_user_id = ""
        foreign.save(update_fields=["evaluator_user_id"])
        foreign_post = "group-b"
    else:
        foreign_post = "unlinked-new-group"
        event.recon_sector_posts.append({
            "id": foreign_post, "post": "Новая группа чужого объекта", "need": 1,
            "demandKindCode": "SCREENING_GROUP", "visitObjectId": str(second.pk),
        })
        event.placement_assignments.append(assignment(15, "Участник чужого объекта", foreign_post))
        event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    response = own_api.post(
        f"/api/ops/security-events/{event.pk}/visit-objects/{first.pk}/evaluations/",
        {"assignmentId": event.placement_assignments[0]["id"], "score": 9}, format="json",
    )
    assert response.status_code == 200, response.content
    foreign = OpsEvaluationWorkItem.objects.get(
        event_code=f"security-event-{event.pk}", assignment_code=foreign_post,
        target_group_code__isnull=False,
    )
    assert foreign.evaluator_user_id == "", "Visit A must not claim the unlinked chief's group B"
    pending = own_api.get(WORKSPACE).json()["pending"]
    assert foreign.work_item_code not in {row["id"] for row in pending}
    denied = own_api.post(submit_path(foreign.work_item_code), _submit_body(), format="json")
    assert denied.status_code == 404, denied.content
    assert not OpsEventEvaluation.objects.filter(target_group_code=foreign.target_group_code).exists()


@pytest.mark.parametrize("scoped", [False, True])
def test_only_eventwide_management_can_fill_unowned_group_tasks(group_event, scoped):
    _, _, event, _, second = group_event
    division = Division.objects.create(name="Область управления", code="GROUP-MANAGE", division_type="division")
    _, user = client_for("group-event-manager", "GROUP_EVENT_MANAGER", perms=(
        "event.manage", "rating.evaluate",
    ), scope_division_id=division.pk if scoped else None)
    chief = make_employee(last_name="Старший без учётки для управления")
    second.chief_employee_id = chief.pk
    second.save(update_fields=["chief_employee_id"])
    item = OpsEvaluationWorkItem.objects.get(
        event_code=f"security-event-{event.pk}", assignment_code="group-b",
        target_group_code__isnull=False,
    )
    item.evaluator_user_id = ""
    item.save(update_fields=["evaluator_user_id"])
    ratings.open_evaluation_for_event(event, actor=str(user.pk))
    item.refresh_from_db()
    assert item.evaluator_user_id == ("" if scoped else str(user.pk))


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("endpoint", ["workspace", "detail"])
def test_group_get_reads_work_in_autocommit_without_row_locks(group_event, monkeypatch, endpoint):
    api, _, _, _, _ = group_event
    assert connection.get_autocommit() and not connection.in_atomic_block
    item = group_item(api)
    if endpoint == "detail":
        submitted = api.post(submit_path(item["id"]), body_for(item), format="json")
        assert submitted.status_code == 201, submitted.content
    assert connection.get_autocommit() and not connection.in_atomic_block

    def reject_read_lock(*args, **kwargs):
        raise AssertionError("A group GET must not acquire a row lock")

    monkeypatch.setattr(QuerySet, "select_for_update", reject_read_lock)
    response = api.get(WORKSPACE if endpoint == "workspace" else detail_path(item["id"]))
    assert response.status_code == 200, response.content
    if endpoint == "detail":
        assert response.json()["canCorrect"] is True
        assert response.json()["submitted"]["groupSnapshot"] == item["groupSnapshot"]
    else:
        pending = next(row for row in response.json()["pending"] if row["id"] == item["id"])
        assert pending["canSubmit"] is True
    assert connection.get_autocommit() and not connection.in_atomic_block
