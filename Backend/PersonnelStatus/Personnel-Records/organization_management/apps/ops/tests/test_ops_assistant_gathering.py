"""Factual physical-reserve preparation, separate from authenticated dispatch."""
import pytest

from organization_management.apps.operations.models import RolePermission
from organization_management.apps.operations.models_assistant import OpsAssistantReceipt, OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_forces import OpsForceCampaign
from organization_management.apps.ops.tests.test_ops_assistant_api import (
    URL, bulletin_fields, chief, create_task, jwt_actor,
)
from organization_management.apps.ops.tests.test_ops_forces_gathering import (
    event_on_demand, make_department, manager,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import create_event, make_object

pytestmark = pytest.mark.django_db


@pytest.fixture
def gathering_task(chief, manager):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department()
    task = create_task(chief[0], fields={"eventId": event_id, "intent": "send", "allocations": [{"departmentId": str(department.pk), "need": need}]}).json()
    staff, _ = jwt_actor("gathering_staff", ("event.view", "forces.command"))
    return chief[0], staff, task, OpsSecurityEvent.objects.get(pk=event_id)


def create_distribution(staff, event):
    response = staff.post("/api/ops/security-events/forces/campaigns/", {"title": "Учебное распределение", "eventIds": [str(event.pk)]}, format="json")
    assert response.status_code == 201, response.content
    return response.json()["id"]


def test_missing_distribution_is_explicit_and_read_does_not_create_one(gathering_task):
    chief_api, staff, task, event = gathering_task
    before = OpsAssistantTask.objects.get(pk=task["id"]).updated_at
    for api in (chief_api, staff):
        result = api.get(URL + task["id"] + "/").json()
        assert result["gathering"] == {"state": "missing", "campaignId": None}
    assert not OpsForceCampaign.objects.exists()
    assert not OpsAssistantReceipt.objects.filter(task_id=task["id"]).exists()
    assert OpsAssistantTask.objects.get(pk=task["id"]).updated_at == before
    # Numeric offers may proceed while headquarters prepares physical selection.
    response = staff.post(URL + task["id"] + "/continue/", {}, format="json")
    assert response.status_code == 200
    assert response.json()["status"] == "awaiting_department_responses"
    assert response.json()["gathering"]["state"] == "missing"
    event.refresh_from_db()
    assert len(event.force_allocation) == 1 and event.force_allocation[0]["sentAt"]


@pytest.mark.parametrize("status", ["DRAFT", "GATHERING", "DISTRIBUTING"])
def test_existing_unique_active_distribution_is_reused_with_id_visible_only_to_headquarters(gathering_task, status):
    chief_api, staff, task, event = gathering_task
    campaign_id = create_distribution(staff, event)
    OpsForceCampaign.objects.filter(pk=campaign_id).update(status=status)
    assert chief_api.get(URL + task["id"] + "/").json()["gathering"] == {"state": "ready", "campaignId": None}
    assert staff.get(URL + task["id"] + "/").json()["gathering"] == {"state": "ready", "campaignId": str(campaign_id)}
    assert OpsForceCampaign.objects.count() == 1


def test_two_active_distributions_are_not_silently_chosen(gathering_task):
    chief_api, staff, task, event = gathering_task
    create_distribution(staff, event)
    create_distribution(staff, event)
    for api in (chief_api, staff):
        assert api.get(URL + task["id"] + "/").json()["gathering"] == {"state": "ambiguous", "campaignId": None}
    assert OpsForceCampaign.objects.count() == 2


def test_permission_loss_never_exposes_distribution_readiness(gathering_task):
    chief_api, staff, task, event = gathering_task
    create_distribution(staff, event)
    RolePermission.objects.filter(role_code_id="AI_CHIEF", permission_code_id="event.view").delete()
    result = chief_api.get(URL + task["id"] + "/").json()
    assert result["status"] == "event_unavailable"
    assert result["gathering"] is None


def test_unpublished_and_handed_over_work_has_no_new_gathering_prerequisite(chief, gathering_task):
    unpublished = create_task(chief[0], fields=bulletin_fields()).json()
    assert unpublished["gathering"] is None
    _, staff, task, event = gathering_task
    sent = staff.post(URL + task["id"] + "/continue/", {}, format="json")
    assert sent.status_code == 200
    event.force_handover = {"at": "2027-05-31T10:00:00Z", "actor": "synthetic"}
    event.save(update_fields=["force_handover"])
    result = staff.get(URL + task["id"] + "/").json()
    assert result["status"] == "placement"
    assert result["gathering"] is None


@pytest.mark.parametrize("stage", ["APPROVAL", "ACKNOWLEDGEMENT", "CONDUCT", "CLOSED"])
def test_dispatch_affordance_honors_the_current_manual_collection_gate(gathering_task, stage):
    _, staff, task, event = gathering_task
    event.stage = stage
    event.save(update_fields=["stage"])
    result = staff.get(URL + task["id"] + "/").json()
    assert result["canContinue"] is False
    assert result.get("gathering") is None


def test_explicit_empty_send_requires_departments_before_creating_a_bulletin(chief):
    result = create_task(chief[0], fields=bulletin_fields(intent="send", allocations=[])).json()
    assert result["status"] == "needs_information"
    assert [row["field"] for row in result["questions"]] == ["allocations"]
    assert result["canContinue"] is False and result["canEdit"] is True
    assert not OpsSecurityEvent.objects.exists()
    assert not OpsAssistantReceipt.objects.exists()


@pytest.mark.parametrize("legacy", [False, True])
def test_empty_send_stays_with_initiator_across_real_recon_publication(chief, manager, legacy):
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj, business_date="2027-06-01").json()["id"]
    department = make_department()
    response = create_task(chief[0], fields={
        "eventId": str(event_id), "intent": "send",
        "allocations": [{"departmentId": str(department.pk), "need": 1}] if legacy else [],
    })
    assert response.status_code == 201, response.content
    task = OpsAssistantTask.objects.get(pk=response.json()["id"])
    if legacy:
        # Previously persisted tasks can lack the clarification. GET must project
        # it without an incidental repair write or requiring a staff POST first.
        task.plan = {**task.plan, "allocations": [], "questions": []}
        task.save(update_fields=["plan"])
    staff, _ = jwt_actor("empty_send_staff", ("event.view", "forces.command"))
    task_url = URL + str(task.pk) + "/"
    for published in (False, True):
        if published:
            base = f"/api/ops/security-events/{event_id}/"
            imported = manager.post(base + "recon/import-from-passport/").json()
            patched = manager.patch(base + "recon/", {
                "checklist": [{**row, "state": "NORMAL"} for row in imported["reconChecklist"]],
                "sectorPosts": imported["reconSectorPosts"],
            }, format="json")
            assert patched.status_code == 200, patched.content
            completed = manager.post(base + "recon/complete/")
            assert completed.status_code == 200, completed.content
            assert completed.json()["reconForceRequestedAt"]
        for api, can_edit in ((chief[0], True), (staff, False)):
            result = api.get(task_url).json()
            assert result["status"] == "needs_information"
            assert [row["field"] for row in result["questions"]] == ["allocations"]
            assert result["canContinue"] is False and result["canEdit"] is can_edit
        current = OpsAssistantTask.objects.get(pk=task.pk)
        assert current.updated_at == task.updated_at and current.plan == task.plan
        assert not OpsAssistantReceipt.objects.filter(task=task).exists()
        assert not OpsSecurityEvent.objects.get(pk=event_id).force_allocation
