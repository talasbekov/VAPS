"""Story 16.2 (FR-26) — `form_draft_placement()` behavioral tests.

Service-level only (no HTTP layer yet — API is Story 16.8, matching
15.10's own "no HTTP route yet" pattern for a not-yet-wired service)."""

import pytest
from django.core.management import call_command

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
    SecurityEventDirectAssignment,
    SecurityEventSectorPost,
)
from apps.operations.events.services import form_draft_placement
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


def make_event(code="OBJ-DRAFT-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def make_sector_post(event, post_text="POST-A", **kwargs):
    return SecurityEventSectorPost.objects.create(
        event=event, sector="A", post=post_text, **kwargs
    )


def make_direct_assignment(event, sector_post, employee_id=None):
    import uuid

    return SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=employee_id or uuid.uuid4()
    )


def test_forms_draft_from_matched_direct_assignment(seeded):
    event = make_event()
    sector_post = make_sector_post(event, "POST-A")
    Post.objects.create(object=event.object, code="POST-A", name="Пост А")
    direct = make_direct_assignment(event, sector_post)

    version, created, unmatched = form_draft_placement(event, actor="planner-1")

    assert version.status == AssignmentVersion.Status.DRAFT
    assert version.is_current is True
    assert len(created) == 1
    assert created[0].employee_id == direct.employee_id
    assert unmatched == []


def test_unresolved_post_lands_in_unmatched_not_blocking(seeded):
    event = make_event("OBJ-DRAFT-2")
    sector_post = make_sector_post(event, "POST-UNKNOWN")
    # No matching facilities.Post created.
    direct = make_direct_assignment(event, sector_post)

    version, created, unmatched = form_draft_placement(event, actor="planner-1")

    assert created == []
    assert len(unmatched) == 1
    assert unmatched[0]["employee_id"] == str(direct.employee_id)
    assert unmatched[0]["post_text"] == "POST-UNKNOWN"
    assert PlacementAssignment.objects.count() == 0


def test_mixed_matched_and_unmatched(seeded):
    event = make_event("OBJ-DRAFT-3")
    matched_post = make_sector_post(event, "POST-A")
    Post.objects.create(object=event.object, code="POST-A", name="Пост А")
    unmatched_post = make_sector_post(event, "POST-B")
    make_direct_assignment(event, matched_post)
    make_direct_assignment(event, unmatched_post)

    version, created, unmatched = form_draft_placement(event, actor="planner-1")

    assert len(created) == 1
    assert len(unmatched) == 1


def test_event_without_direct_assignments_forms_empty_draft(seeded):
    event = make_event("OBJ-DRAFT-4")
    version, created, unmatched = form_draft_placement(event, actor="planner-1")
    assert version.status == AssignmentVersion.Status.DRAFT
    assert created == []
    assert unmatched == []


def test_second_call_with_existing_current_version_is_rejected(seeded):
    event = make_event("OBJ-DRAFT-5")
    form_draft_placement(event, actor="planner-1")
    with pytest.raises(DomainError) as exc_info:
        form_draft_placement(event, actor="planner-1")
    assert exc_info.value.code == "PLACEMENT_DRAFT_ALREADY_EXISTS"
    assert exc_info.value.http_status == 409
    assert AssignmentVersion.objects.filter(event=event).count() == 1


def test_form_draft_placement_emits_audit_row(seeded):
    event = make_event("OBJ-DRAFT-6")
    sector_post = make_sector_post(event, "POST-A")
    Post.objects.create(object=event.object, code="POST-A", name="Пост А")
    make_direct_assignment(event, sector_post)

    version, created, unmatched = form_draft_placement(event, actor="planner-1")

    log = AuditLog.objects.get(action="PLACEMENT_DRAFT_FORMED")
    assert log.actor_user_id == "planner-1"
    assert log.new_value["matched_count"] == 1
    assert log.new_value["unmatched_count"] == 0


def test_form_draft_placement_requires_actor(seeded):
    event = make_event("OBJ-DRAFT-7")
    with pytest.raises(DomainError) as exc_info:
        form_draft_placement(event, actor="")
    assert exc_info.value.code == "VALIDATION_ERROR"
