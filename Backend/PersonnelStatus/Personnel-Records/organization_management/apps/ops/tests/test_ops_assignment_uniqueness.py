"""A person cannot fill two headcount slots, including on the same post."""
import copy

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from .test_ops_acknowledgement_notify import event_with_people  # noqa: F401
from .test_ops_placement_roles import prepared
from .test_ops_security_events_api import make_employee, manager  # noqa: F401

pytestmark = pytest.mark.django_db


def test_repeated_assignment_to_same_post_does_not_inflate_headcount(manager):
    base, post_id = prepared(manager)
    employee = make_employee(last_name="Unique")
    payload = {"postId": post_id, "employeeId": str(employee.pk)}
    first = manager.post(f"{base}placement/assign/", payload, format="json")
    assert first.status_code == 200, first.data
    event = OpsSecurityEvent.objects.get(pk=first.json()["id"])
    before = copy.deepcopy(event.placement_assignments)

    # An override permits extra PEOPLE, never a duplicate of the same person.
    repeated = manager.post(
        f"{base}placement/assign/",
        {**payload, "override": True, "overrideReason": "Reinforcement"},
        format="json",
    )
    assert repeated.status_code == 422, repeated.data
    assert repeated.json()["error_code"] == "DOUBLE_ASSIGNMENT"
    event.refresh_from_db()
    assert event.placement_assignments == before


@pytest.mark.parametrize("stage", ["ACKNOWLEDGEMENT", "CONDUCT"])
@pytest.mark.parametrize("incoming_index", [0, 1], ids=["self", "same-post-colleague"])
def test_replacement_cannot_reuse_an_assigned_person(
    manager, event_with_people, stage, incoming_index,
):
    event, *_ = event_with_people
    event.stage = stage
    event.placement_assignments[0]["acknowledgedAt"] = "2026-08-20T06:00:00+00:00"
    event.save(update_fields=["stage", "placement_assignments"])
    assignments = copy.deepcopy(event.placement_assignments)
    journal = copy.deepcopy(event.journal_entries)

    response = manager.post(
        f"/api/ops/security-events/{event.pk}/conduct/replace/",
        {
            "assignmentId": assignments[0]["id"],
            "incomingEmployeeId": assignments[incoming_index]["employeeId"],
            "reasonCode": "Replacement",
        },
        format="json",
    )

    assert response.status_code == 422, response.data
    assert response.json()["error_code"] == "DOUBLE_ASSIGNMENT"
    event.refresh_from_db()
    assert event.placement_assignments == assignments
    assert event.journal_entries == journal


def test_replacement_records_incoming_callsign_for_documents(manager, event_with_people):
    event, *_ = event_with_people
    incoming = make_employee(last_name="Incoming")
    incoming.callsign = "  7-41  "
    incoming.save(update_fields=["callsign"])
    outgoing = event.placement_assignments[0]
    response = manager.post(
        f"/api/ops/security-events/{event.pk}/conduct/replace/",
        {
            "assignmentId": outgoing["id"],
            "incomingEmployeeId": str(incoming.pk),
            "reasonCode": "Illness",
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    event.refresh_from_db()
    replacement = next(
        row for row in event.placement_assignments
        if row["employeeId"] == str(incoming.pk)
    )
    assert replacement.get("callsign") == "7-41"
    assert replacement["acknowledgedAt"] is None

    # Document data is the snapshot at assignment time, not live HR data.
    incoming.callsign = "9-99"
    incoming.save(update_fields=["callsign"])
    response = manager.get(f"/api/ops/security-events/{event.pk}/")
    row = next(
        item for item in response.json()["placementAssignments"]
        if item["employeeId"] == str(incoming.pk)
    )
    assert row["callsign"] == "7-41"
