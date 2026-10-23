import pytest


def project(event):
    from organization_management.apps.ops.assistant.progress import assignment_progress
    return assignment_progress(event)


def test_progress_uses_published_demand_and_roster_not_promised_counts():
    event = {"reconForceRequestedAt": "2026-10-23T10:00:00Z", "forceDemandTotal": 5,
             "forceRoster": [{"employeeId": "1"}, {"employeeId": "2"}],
             "forceAllocation": [{"id": "r1", "departmentId": "9", "departmentName": "Department", "need": 5,
                                  "allocating": 100, "status": "NOTIFIED", "sentAt": "now", "overdue": True}]}
    result = project(event)
    assert (result["need"], result["collected"], result["remaining"]) == (5, 2, 3)
    assert result["departments"] == [{"id": "r1", "name": "Department", "requested": 5,
                                       "responded": 100, "status": "NOTIFIED", "overdue": True}]


@pytest.mark.parametrize("value", [None, 0, 12])
def test_unpublished_demand_never_becomes_a_known_target(value):
    result = project({"forceDemandTotal": value, "forceRoster": []})
    assert result["need"] is None and result["remaining"] is None


def test_zero_answer_unanswered_topups_and_drafts_remain_distinct():
    base = {"departmentName": "Same", "need": 4, "status": "NOTIFIED", "sentAt": "now"}
    result = project({"reconForceRequestedAt": "now", "forceDemandTotal": 0,
                      "forceRoster": [{"employeeId": "1"}], "forceAllocation": [
                          {**base, "id": "first", "allocating": 0},
                          {**base, "id": "topup", "allocating": None, "topUpOf": "first"},
                          {**base, "id": "draft", "sentAt": None}]})
    assert (result["need"], result["collected"], result["remaining"]) == (0, 1, 0)
    assert [(row["id"], row["responded"]) for row in result["departments"]] == [("first", 0), ("topup", None)]


def test_handover_closes_collection_while_placement_alone_does_not():
    from organization_management.apps.ops.assistant.progress import assignment_progress
    event = {"stage": "PLACEMENT", "reconForceRequestedAt": "now", "forceDemandTotal": 5}
    assert assignment_progress(event, handed_over=True)["collectionClosed"] is True
    assert assignment_progress(event, handed_over=False)["collectionClosed"] is False


@pytest.mark.django_db
def test_task_api_exposes_progress_only_after_existing_event_authorization():
    from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor, create_task, bulletin_fields, URL
    from organization_management.apps.operations.models import RolePermission
    api, _ = jwt_actor("progresschief", ("event.create", "event.view", "event.bulletin"))
    created = create_task(api, fields=bulletin_fields()).json()
    assert created["event"]["progress"] == {"collectionClosed": False, "need": None, "collected": 0, "remaining": None, "departments": []}
    RolePermission.objects.filter(role_code_id="AI_PROGRESSCHIEF", permission_code_id="event.view").delete()
    denied_event = api.get(URL + created["id"] + "/").json()
    assert denied_event["status"] == "event_unavailable"
    assert denied_event["event"] is None
