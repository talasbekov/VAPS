"""Story 16.6d (FR-27) — ASSIGNMENT_SUBMITTED (recipients: assignment.approve
holders) and ASSIGNMENT_RETURNED (recipients: created_by + event senior)
notification tests."""

import uuid

import pytest
from django.core.management import call_command

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    Organization,
    UserEmployeeBinding,
)
from apps.notifications.models import Notification
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
    SecurityEventDirectAssignment,
)
from apps.operations.events.services import (
    form_draft_placement,
    return_assignment_version,
    submit_assignment_version,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="AAN-NOTIFY", code="AAN-NOTIFY")
    dtp = DivisionType.objects.create(code="notify-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="AAN-NOTIFY", code="AAN-NOTIFY"
    )


def make_employee(division, iin):
    return Employee.objects.create(
        iin=iin,
        full_name="Иванов",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )


def make_event(code, senior_employee_id=None):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", senior_employee_id=senior_employee_id
    )


def make_draft_version(event, post_code="POST-1"):
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    post = Post.objects.create(object=event.object, code=post_code, name="Пост")
    PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )
    return version


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


def grant_approve_permission(user_id, code="TEST_NOTIFY_APPROVER"):
    role = Role.objects.create(code=code, name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="assignment.approve"
    )
    UserRole.objects.create(user_id=user_id, role_code=role)


# --- ASSIGNMENT_SUBMITTED ---


def test_submit_notifies_approve_holder(seeded):
    grant_approve_permission("approver-1")
    event = make_event("OBJ-SUBNOTIFY-1")
    version = make_draft_version(event)

    submit_assignment_version(version, actor="planner-1")

    notification = Notification.objects.get(
        recipient="approver-1", kind=Notification.Kind.ASSIGNMENT_SUBMITTED
    )
    assert notification.payload["event_id"] == event.pk
    assert notification.payload["version_id"] == version.pk


def test_submit_notifies_admin_wildcard_holder(seeded):
    role = Role.objects.create(code="TEST_NOTIFY_ADMIN", name="Admin")
    RolePermission.objects.create(role_code=role, permission_code_id="*")
    UserRole.objects.create(user_id="admin-1", role_code=role)
    event = make_event("OBJ-SUBNOTIFY-2")
    version = make_draft_version(event)

    submit_assignment_version(version, actor="planner-1")

    assert Notification.objects.filter(
        recipient="admin-1", kind=Notification.Kind.ASSIGNMENT_SUBMITTED
    ).exists()


def test_submit_idempotent_replay_does_not_duplicate_notification(seeded):
    grant_approve_permission("approver-2")
    event = make_event("OBJ-SUBNOTIFY-3")
    version = make_draft_version(event)
    submit_assignment_version(version, actor="planner-1")

    submit_assignment_version(version, actor="planner-1")

    assert (
        Notification.objects.filter(
            recipient="approver-2", kind=Notification.Kind.ASSIGNMENT_SUBMITTED
        ).count()
        == 1
    )


def test_submit_with_no_approve_holders_is_not_an_error():
    event = make_event("OBJ-SUBNOTIFY-4")
    version = make_draft_version(event)

    result = submit_assignment_version(version, actor="planner-1")

    assert result.status == "SUBMITTED"
    assert not Notification.objects.filter(
        kind=Notification.Kind.ASSIGNMENT_SUBMITTED
    ).exists()


def test_submit_notifies_every_distinct_approve_holder(seeded):
    grant_approve_permission("approver-3a", "TEST_NOTIFY_A")
    grant_approve_permission("approver-3b", "TEST_NOTIFY_B")
    event = make_event("OBJ-SUBNOTIFY-5")
    version = make_draft_version(event)

    submit_assignment_version(version, actor="planner-1")

    recipients = set(
        Notification.objects.filter(
            kind=Notification.Kind.ASSIGNMENT_SUBMITTED
        ).values_list("recipient", flat=True)
    )
    assert recipients == {"approver-3a", "approver-3b"}


# --- ASSIGNMENT_RETURNED ---


def make_submitted_version_via_draft(actor="creator-1", code="OBJ-RETNOTIFY"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    version, _created, _unmatched = form_draft_placement(event, actor=actor)
    submit_assignment_version(version, actor="submitter-1")
    return event, version


def test_return_notifies_creator():
    event, version = make_submitted_version_via_draft("creator-701")

    return_assignment_version(version, actor="approver-1", reason="Проверить состав")

    assert Notification.objects.filter(
        recipient="creator-701", kind=Notification.Kind.ASSIGNMENT_RETURNED
    ).exists()


def test_return_notifies_event_senior(division):
    senior = make_employee(division, "900101300801")
    UserEmployeeBinding.objects.create(user_id="user-senior-801", employee=senior)
    obj = FacilityObject.objects.create(
        code="OBJ-RETNOTIFY-2", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(
        object=obj, title="ОМ", senior_employee_id=senior.id
    )
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    version, _created, _unmatched = form_draft_placement(event, actor="creator-802")
    submit_assignment_version(version, actor="submitter-1")

    return_assignment_version(version, actor="approver-1", reason="Проверить состав")

    assert Notification.objects.filter(
        recipient="user-senior-801", kind=Notification.Kind.ASSIGNMENT_RETURNED
    ).exists()


def test_return_with_blank_created_by_skips_creator_notification_not_error():
    event = make_event("OBJ-RETNOTIFY-3")
    version = make_draft_version(event)  # direct .objects.create(), created_by blank
    submit_assignment_version(version, actor="planner-1")

    returned_version, _new_draft = return_assignment_version(
        version, actor="approver-1", reason="Проверить состав"
    )

    assert returned_version.status == "RETURNED"
    assert not Notification.objects.filter(
        kind=Notification.Kind.ASSIGNMENT_RETURNED
    ).exists()


def test_return_creator_who_is_also_senior_gets_one_notification(division):
    """Mirrors 16.6a's dedup coverage (test_senior_who_is_also_assigned_gets_
    one_notification) — creator and senior can be the SAME recipient via two
    different resolution paths (flat created_by string vs employee_id ->
    user_id bridge); the `set()` union must collapse to one notify() call."""
    employee = make_employee(division, "900101300803")
    UserEmployeeBinding.objects.create(user_id="dual-803", employee=employee)
    obj = FacilityObject.objects.create(
        code="OBJ-RETNOTIFY-4", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(
        object=obj, title="ОМ", senior_employee_id=employee.id
    )
    Post.objects.create(object=obj, code="POST-1", name="Пост")
    sector_post = event.sector_posts.create(sector="A", post="POST-1")
    SecurityEventDirectAssignment.objects.create(
        event=event, sector_post=sector_post, employee_id=uuid.uuid4()
    )
    version, _created, _unmatched = form_draft_placement(event, actor="dual-803")
    submit_assignment_version(version, actor="submitter-1")

    return_assignment_version(version, actor="approver-1", reason="Проверить состав")

    assert (
        Notification.objects.filter(
            recipient="dual-803", kind=Notification.Kind.ASSIGNMENT_RETURNED
        ).count()
        == 1
    )
