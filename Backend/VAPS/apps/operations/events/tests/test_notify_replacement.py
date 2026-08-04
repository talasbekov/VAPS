"""Story 17.6 (FR-28/FR-31) — REPLACEMENT_CREATED: fired for every
employee removed by amend_assignment_version() (direct or via 17.5's
cascade_replace_departed()), plus the event senior."""

import uuid

import pytest

from apps.core.clock import Clock
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
)
from apps.operations.events.services import (
    amend_assignment_version,
    cascade_replace_departed,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code, senior_employee_id=None):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj,
        title="ОМ",
        status_code=SecurityEvent.StatusCode.IN_PROGRESS,
        senior_employee_id=senior_employee_id,
    )


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def make_approved_version(event):
    return AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.APPROVED, version=1
    )


_iin_counter = iter(range(100000000001, 999999999999))


def make_bound_employee(user_id):
    """UserEmployeeBinding.employee is a REAL FK (unlike
    PlacementAssignment.employee_id, ARCH-003 flat) — bridging tests need
    an actual Employee row, not a bare uuid4()."""
    org = Organization.objects.create(name=user_id, code=user_id)
    dtype = DivisionType.objects.get_or_create(code="dept", defaults={"name": "Отдел"})[
        0
    ]
    division = Division.objects.create(
        organization=org, type_code=dtype, name=user_id, code=user_id
    )
    employee = Employee.objects.create(
        iin=str(next(_iin_counter)),
        full_name="Иванов",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )
    UserEmployeeBinding.objects.create(employee=employee, user_id=user_id)
    return employee.id


def test_removed_employee_gets_notified():
    event = make_event("OBJ-NOTIFY-1")
    post = make_post(event.object)
    version = make_approved_version(event)
    removed = make_bound_employee("user-removed-1")
    PlacementAssignment.objects.create(version=version, employee_id=removed, post=post)

    amend_assignment_version(
        version,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[{"employee_id": uuid.uuid4(), "post": post}],
    )

    notification = Notification.objects.get(
        recipient="user-removed-1", kind=Notification.Kind.REPLACEMENT_CREATED
    )
    # review (Blind Hunter): payload содержимое ранее не проверялось,
    # только факт создания.
    assert notification.payload["event_id"] == event.pk
    new_version = AssignmentVersion.objects.get(event=event, is_current=True)
    assert notification.payload["version_id"] == new_version.pk
    assert notification.business_date == Clock.today_local()


def test_employee_moved_to_a_different_post_is_not_notified():
    """review (Edge Case Hunter): «снятый» — employee_id absent from the
    new version entirely (this story's Scope Decision), NOT per-post —
    an employee still present in the new version, just at a different
    post, is NOT a removal and must not be notified."""
    event = make_event("OBJ-NOTIFY-1b")
    post_a = make_post(event.object, "POST-A")
    post_b = make_post(event.object, "POST-B")
    version = make_approved_version(event)
    moved = make_bound_employee("user-moved-1b")
    PlacementAssignment.objects.create(version=version, employee_id=moved, post=post_a)

    amend_assignment_version(
        version,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[{"employee_id": moved, "post": post_b}],
    )

    assert not Notification.objects.filter(
        recipient="user-moved-1b", kind=Notification.Kind.REPLACEMENT_CREATED
    ).exists()


def test_senior_notified_when_someone_removed():
    senior = make_bound_employee("user-senior-2")
    event = make_event("OBJ-NOTIFY-2", senior_employee_id=senior)
    post = make_post(event.object)
    version = make_approved_version(event)
    removed = make_bound_employee("user-removed-2")
    PlacementAssignment.objects.create(version=version, employee_id=removed, post=post)

    amend_assignment_version(
        version,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[{"employee_id": uuid.uuid4(), "post": post}],
    )

    assert Notification.objects.filter(
        recipient="user-senior-2", kind=Notification.Kind.REPLACEMENT_CREATED
    ).exists()


def test_senior_who_is_also_removed_gets_one_notification():
    dual = make_bound_employee("user-dual-3")
    event = make_event("OBJ-NOTIFY-3", senior_employee_id=dual)
    post = make_post(event.object)
    version = make_approved_version(event)
    PlacementAssignment.objects.create(version=version, employee_id=dual, post=post)

    amend_assignment_version(
        version,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[{"employee_id": uuid.uuid4(), "post": post}],
    )

    assert (
        Notification.objects.filter(
            recipient="user-dual-3", kind=Notification.Kind.REPLACEMENT_CREATED
        ).count()
        == 1
    )


def test_no_notification_when_nobody_removed():
    event = make_event("OBJ-NOTIFY-4")
    post = make_post(event.object)
    version = make_approved_version(event)
    kept = make_bound_employee("user-kept-4")
    PlacementAssignment.objects.create(version=version, employee_id=kept, post=post)

    amend_assignment_version(
        version,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[{"employee_id": kept, "post": post}],
    )

    assert not Notification.objects.filter(
        kind=Notification.Kind.REPLACEMENT_CREATED
    ).exists()


def test_multiple_removed_employees_each_get_own_notification():
    event = make_event("OBJ-NOTIFY-5")
    post_a = make_post(event.object, "POST-A")
    post_b = make_post(event.object, "POST-B")
    version = make_approved_version(event)
    removed_a = make_bound_employee("user-removed-5a")
    removed_b = make_bound_employee("user-removed-5b")
    PlacementAssignment.objects.create(
        version=version, employee_id=removed_a, post=post_a
    )
    PlacementAssignment.objects.create(
        version=version, employee_id=removed_b, post=post_b
    )

    amend_assignment_version(
        version,
        actor="staff-1",
        reason="x",
        sanction="y",
        assignments=[
            {"employee_id": uuid.uuid4(), "post": post_a},
            {"employee_id": uuid.uuid4(), "post": post_b},
        ],
    )

    recipients = set(
        Notification.objects.filter(
            kind=Notification.Kind.REPLACEMENT_CREATED
        ).values_list("recipient", flat=True)
    )
    assert recipients == {"user-removed-5a", "user-removed-5b"}


def test_cascade_replace_departed_fires_notification_without_17_5_changes():
    """AC-6: 17.5's cascade_replace_departed() delegates its whole mutation
    to amend_assignment_version() — the departed employee gets notified
    with zero changes to 17.5's own code."""
    org = Organization.objects.create(name="ORG-CASC", code="ORG-CASC")
    dtype = DivisionType.objects.get_or_create(code="dept", defaults={"name": "Отдел"})[
        0
    ]
    division = Division.objects.create(
        organization=org, type_code=dtype, name="DIV-CASC", code="DIV-CASC"
    )
    departed = Employee.objects.create(
        iin="900101300099",
        full_name="Иванов",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )
    Employee.objects.create(
        iin="900101300098",
        full_name="Петров",
        rank_code="CAPT",
        position_code="GUARD",
        division=division,
    )
    UserEmployeeBinding.objects.create(employee=departed, user_id="user-departed-6")

    event = make_event("OBJ-NOTIFY-6")
    post = make_post(event.object)
    version = make_approved_version(event)
    PlacementAssignment.objects.create(
        version=version, employee_id=departed.id, post=post
    )

    cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="x",
        sanction="y",
    )

    assert Notification.objects.filter(
        recipient="user-departed-6", kind=Notification.Kind.REPLACEMENT_CREATED
    ).exists()
