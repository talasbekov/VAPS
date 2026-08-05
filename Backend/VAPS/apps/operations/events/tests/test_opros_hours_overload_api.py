"""Story 18.6b — API behavioral tests: `actual-time`/`service-hours`/
`overload` actions on PlacementAssignmentViewSet. Thin wrapper over
record_assignment_actual_time() (18.3), compute_service_hours() (18.4),
flag_post_overload() (18.5)."""

import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
    ServiceHours,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")


def local(*args):
    return datetime.datetime(*args, tzinfo=TZ)


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def event_manager_client(seeded):
    role = Role.objects.create(code="TEST_EVENT_MANAGER_18_6B", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="event-operator-18-6b", role_code=role)
    return _client("event-operator-18-6b")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role-18-6b")


def make_assignment(
    code,
    status_code=SecurityEvent.StatusCode.CLOSED,
    is_current=True,
    max_service_minutes=480,
):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    event = SecurityEvent.objects.create(
        object=obj, title="ОМ", status_code=status_code
    )
    post = Post.objects.create(
        object=obj, code="POST-1", name="Пост", max_service_minutes=max_service_minutes
    )
    version = AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.APPROVED,
        version=1,
        is_current=is_current,
    )
    return PlacementAssignment.objects.create(
        version=version, employee_id="11111111-1111-1111-1111-111111111111", post=post
    )


def actual_time_url(assignment):
    return reverse("ops-placement-assignment-actual-time", args=[assignment.pk])


def service_hours_url(assignment):
    return reverse("ops-placement-assignment-service-hours", args=[assignment.pk])


def overload_url(assignment):
    return reverse("ops-placement-assignment-overload", args=[assignment.pk])


def post_actual_time(client, assignment, start, end):
    return client.post(
        actual_time_url(assignment),
        {"actual_start_at": start.isoformat(), "actual_end_at": end.isoformat()},
        format="json",
    )


# --- actual-time ---


def test_actual_time_success(event_manager_client):
    assignment = make_assignment("OBJ-OHO-1")

    resp = post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    assert resp.status_code == 200
    assert resp.data["assignment"] == assignment.pk
    assert PlacementAssignmentActual.objects.filter(assignment=assignment).count() == 1


def test_actual_time_without_permission_is_403(no_permission_client):
    assignment = make_assignment("OBJ-OHO-2")

    resp = post_actual_time(
        no_permission_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    assert resp.status_code == 403


def test_actual_time_rejected_when_event_not_closed(event_manager_client):
    assignment = make_assignment(
        "OBJ-OHO-3", status_code=SecurityEvent.StatusCode.IN_PROGRESS
    )

    resp = post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    assert resp.status_code == 422


def test_actual_time_rejected_when_version_not_current(event_manager_client):
    """review (Edge Case Hunter): the service's OTHER gate condition
    (is_current), distinct from the CLOSED-event gate above, was
    completely unexercised through the HTTP action."""
    assignment = make_assignment("OBJ-OHO-3b", is_current=False)

    resp = post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    assert resp.status_code == 422


def test_actual_time_rejected_when_end_before_start(event_manager_client):
    """review (Edge Case Hunter): the interval-ordering 400 path was
    never exercised through the API layer."""
    assignment = make_assignment("OBJ-OHO-3c")

    resp = post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 17, 0),
        local(2026, 8, 4, 9, 0),
    )

    assert resp.status_code == 400


def test_actual_time_upsert_corrects_not_duplicates(event_manager_client):
    """review (Edge Case Hunter/Blind Hunter): the API-level upsert round
    trip (not just the underlying service) was never exercised."""
    assignment = make_assignment("OBJ-OHO-3d")
    post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    resp = post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 21, 0),
    )

    assert resp.status_code == 200
    assert PlacementAssignmentActual.objects.filter(assignment=assignment).count() == 1
    actual = PlacementAssignmentActual.objects.get(assignment=assignment)
    assert actual.actual_end_at == local(2026, 8, 4, 21, 0)


# --- service-hours ---


def test_service_hours_success(event_manager_client):
    assignment = make_assignment("OBJ-OHO-4")
    post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    resp = event_manager_client.post(service_hours_url(assignment))

    assert resp.status_code == 200
    assert resp.data["day_hours"] == "8.00"
    assert resp.data["night_hours"] == "0.00"


def test_service_hours_without_actual_time_is_404(event_manager_client):
    assignment = make_assignment("OBJ-OHO-5")

    resp = event_manager_client.post(service_hours_url(assignment))

    assert resp.status_code == 404


def test_service_hours_without_permission_is_403(no_permission_client):
    assignment = make_assignment("OBJ-OHO-6")

    resp = no_permission_client.post(service_hours_url(assignment))

    assert resp.status_code == 403


def test_service_hours_rejected_when_version_not_current(event_manager_client):
    """review (Edge Case Hunter): compute_service_hours()'s own is_current
    gate, distinct from actual-time's, was unexercised. actual created
    directly (not via the API) — recording actual-time itself requires
    is_current=True, so this state can't be reached through the actions."""
    assignment = make_assignment("OBJ-OHO-6b", is_current=False)
    PlacementAssignmentActual.objects.create(
        assignment=assignment,
        actual_start_at=local(2026, 8, 4, 9, 0),
        actual_end_at=local(2026, 8, 4, 17, 0),
        recorded_by="staff-1",
    )

    resp = event_manager_client.post(service_hours_url(assignment))

    assert resp.status_code == 422


# --- overload ---


def test_overload_success(event_manager_client):
    assignment = make_assignment("OBJ-OHO-7", max_service_minutes=360)
    post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )
    # review (Edge Case Hunter): asserting this intermediate response
    # points a future failure at the right step instead of surfacing as
    # a confusing 404 further down.
    hours_resp = event_manager_client.post(service_hours_url(assignment))
    assert hours_resp.status_code == 200

    resp = event_manager_client.post(overload_url(assignment))

    assert resp.status_code == 200
    assert resp.data["is_overloaded"] is True
    assert resp.data["overload_minutes"] == "120.00"


def test_overload_without_actual_time_is_404(event_manager_client):
    """review (Edge Case Hunter): renamed from
    test_overload_without_service_hours_is_404 — this case never records
    actual-time at all, so the 404 comes from the INNER
    _get_actual_or_404 layer, not the "hours not computed" branch. See
    test_overload_without_service_hours_computed_is_404 below for the
    genuinely distinct case."""
    assignment = make_assignment("OBJ-OHO-8")

    resp = event_manager_client.post(overload_url(assignment))

    assert resp.status_code == 404


def test_overload_without_service_hours_computed_is_404(event_manager_client):
    """review (Edge Case Hunter): the genuinely distinct case — actual-time
    IS recorded, service-hours was never computed — was untested; the
    prior test only exercised the inner _get_actual_or_404 branch."""
    assignment = make_assignment("OBJ-OHO-8b")
    post_actual_time(
        event_manager_client,
        assignment,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
    )

    resp = event_manager_client.post(overload_url(assignment))

    assert resp.status_code == 404


def test_overload_without_permission_is_403(no_permission_client):
    assignment = make_assignment("OBJ-OHO-9")

    resp = no_permission_client.post(overload_url(assignment))

    assert resp.status_code == 403


def test_overload_rejected_when_version_not_current(event_manager_client):
    """review (Edge Case Hunter): flag_post_overload()'s own is_current
    gate was unexercised. actual+hours created directly — reaching this
    state through the actions requires is_current=True at record time."""
    assignment = make_assignment("OBJ-OHO-9b", is_current=False)
    actual = PlacementAssignmentActual.objects.create(
        assignment=assignment,
        actual_start_at=local(2026, 8, 4, 9, 0),
        actual_end_at=local(2026, 8, 4, 17, 0),
        recorded_by="staff-1",
    )
    ServiceHours.objects.create(
        actual=actual,
        day_hours=Decimal("8.00"),
        night_hours=Decimal("0.00"),
        computed_at=local(2026, 8, 4, 17, 0),
    )

    resp = event_manager_client.post(overload_url(assignment))

    assert resp.status_code == 422
