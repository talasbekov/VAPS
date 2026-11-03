"""Two real PostgreSQL sessions must not allocate the same employee twice."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from organization_management.apps.operations.models_combat import OpsCombatGroup, OpsCombatDutyShift, OpsCombatDutyMember
from organization_management.apps.ops import combat, combat_planning as planning, combat_projection as projection, combat_lifecycle as lifecycle, passport
from organization_management.apps.ops.security_events import personnel_display_name
from organization_management.apps.ops.tests.test_combat_day_planning import DAY, payload, scene  # noqa: F401
from organization_management.apps.ops.tests.test_duty_month_concurrency import run_session, waits_on

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.mark.parametrize("other_writer", ["modern", "legacy_replace"])
def test_competing_roster_waits_for_employee_lock_then_rejects(scene, monkeypatch, other_writer):
    s = scene
    actor = str(s["user"].pk)
    group = OpsCombatGroup.objects.create(name="Concurrent B", division=s["own"], max_members=3)
    old = OpsCombatDutyShift.objects.create(business_date=DAY, duty_type_code="legacy", route_set={}, required_employees=2, submission={"stateCode": "ACCEPTED", "groupLeaderEmployeeName": "Old leader", "memberEmployeeNames": ["Old member"], "reserveEmployeeNames": [], "execution": {"stateCode": "PENDING_ACKNOWLEDGEMENT", "acknowledgedMemberNames": []}, "replacements": []})
    observed, release = Event(), Event()
    original = projection.sync

    def pause(shift, **kwargs):
        original(shift, **kwargs)
        if shift.group_id == s["groups"][0].pk:
            observed.set()
            assert release.wait(10), "First allocation was not released"

    monkeypatch.setattr(projection, "sync", pause)
    first_started, second_started = Event(), Event()
    first_state, second_state = {}, {}
    if other_writer == "modern":
        second_operation = lambda: planning.form(actor, payload(s, groupId=group.pk))
    else:
        second_operation = lambda: combat.replace_member(old.pk, outgoing="Old member", incoming=personnel_display_name(s["people"][0]), reason_code="ILLNESS", safe_comment="Concurrent check")
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_session, lambda: planning.form(actor, payload(s)), first_started, first_state)
        try:
            assert observed.wait(10)
            second = executor.submit(run_session, second_operation, second_started, second_state)
            assert second_started.wait(10)
            serialized = waits_on(second, second_state["pid"], first_state["pid"])
        finally:
            release.set()
        assert first.result(timeout=15) == "ok"
        assert second.result(timeout=15) == "DOUBLE_ASSIGNMENT"
    assert serialized
    assert OpsCombatDutyMember.objects.filter(business_date=DAY, active=True).count() == 2


@pytest.mark.parametrize("action", ["resubmit", "check_in"])
def test_passport_retirement_serializes_with_existing_roster_without_deadlock(scene, monkeypatch, action):
    from organization_management.apps.operations.models_combat import OpsCombatPlace
    from organization_management.apps.operations.models_object import OpsSecurityObject, OpsObjectSector, OpsSecurityPost
    s = scene
    actor, staff = str(s["user"].pk), str(s["staff_user"].pk)
    obj = OpsSecurityObject.objects.create(code="LOCK-POST", name="Lock object", object_type="BUILDING", region="Test", address="Test", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Sector", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Post", position=1)
    OpsCombatPlace.objects.create(division=s["own"], security_object=obj)
    body = payload(s, location={"kind": "POST", "objectId": obj.pk, "postId": post.pk})
    shift = planning.form(actor, body)
    if action == "resubmit":
        lifecycle.perform(staff, shift.pk, "review", {"decision": "RETURN", "reason": "Check"})
    else:
        lifecycle.perform(staff, shift.pk, "review", {"decision": "ACCEPT"})
        shift.refresh_from_db()
        shift.submission["execution"]["stateCode"] = "READY"
        shift.save(update_fields=["submission"])
    tree = passport.snapshot_sectors(obj)
    tree[0]["posts"] = []
    observed, release = Event(), Event()
    original = passport._validate_passport_ids

    def pause(*args, **kwargs):
        original(*args, **kwargs)
        observed.set()
        assert release.wait(10)

    monkeypatch.setattr(passport, "_validate_passport_ids", pause)
    first_started, second_started = Event(), Event()
    first_state, second_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_session, lambda: passport.update_passport(obj, tree), first_started, first_state)
        try:
            assert observed.wait(10)
            operation = lambda: lifecycle.perform(actor if action == "resubmit" else staff, shift.pk, action, body if action == "resubmit" else {})
            second = executor.submit(run_session, operation, second_started, second_state)
            assert second_started.wait(10)
            serialized = waits_on(second, second_state["pid"], first_state["pid"])
        finally:
            release.set()
        assert first.result(timeout=15) == "ok"
        assert second.result(timeout=15) == "INVALID_LOCATION"
    assert serialized
    assert not OpsSecurityPost.objects.filter(pk=post.pk).exists()
    shift.refresh_from_db()
    assert shift.security_post_id == post.pk


def test_opposing_replacements_lock_union_in_the_same_order(scene, monkeypatch):
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.staff_unit.models import StaffUnit
    s = scene
    actor, staff = str(s["user"].pk), str(s["staff_user"].pk)
    extra = Employee.objects.create(personnel_number="opposing-replacement", last_name="Extra", first_name="Person")
    StaffUnit.objects.create(index=5, division=s["own"], employee=extra)
    second_group = OpsCombatGroup.objects.create(name="Opposing group", division=s["own"], max_members=3)
    first_shift = planning.form(actor, payload(s))
    second_shift = planning.form(actor, payload(s, groupId=second_group.pk, members=[{"employeeId": s["people"][2].pk, "isLeader": True}, {"employeeId": extra.pk}]))
    for shift in (first_shift, second_shift):
        lifecycle.perform(staff, shift.pk, "review", {"decision": "ACCEPT"})
    observed, release = Event(), Event()
    original = lifecycle._validate_roster

    def pause(actor_id, shift, raw, **kwargs):
        if shift.pk == first_shift.pk:
            observed.set()
            assert release.wait(10)
        return original(actor_id, shift, raw, **kwargs)

    monkeypatch.setattr(lifecycle, "_validate_roster", pause)
    first_started, second_started = Event(), Event()
    first_state, second_state = {}, {}
    def replace(shift, outgoing, incoming):
        return lifecycle.perform(actor, shift.pk, "replace", {"outgoingEmployeeId": outgoing.pk, "incomingEmployeeId": incoming.pk, "reason": "Opposing request"})
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_session, lambda: replace(first_shift, s["people"][1], s["people"][2]), first_started, first_state)
        try:
            assert observed.wait(10)
            second = executor.submit(run_session, lambda: replace(second_shift, s["people"][2], s["people"][1]), second_started, second_state)
            assert second_started.wait(10)
            serialized = waits_on(second, second_state["pid"], first_state["pid"])
        finally:
            release.set()
        assert first.result(timeout=15) == "DOUBLE_ASSIGNMENT"
        assert second.result(timeout=15) == "DOUBLE_ASSIGNMENT"
    assert serialized


@pytest.mark.parametrize("action", ["form", "resubmit", "check_in"])
def test_native_event_deletion_cannot_deadlock_daily_group(scene, monkeypatch, action):
    from datetime import datetime, timezone
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.clock import Clock
    from organization_management.apps.ops import security_events
    from organization_management.apps.ops.tests.test_combat_day_integration import combat_event
    s = scene
    actor, staff = str(s["user"].pk), str(s["staff_user"].pk)
    event = combat_event(s)
    body = payload(s, eventId=event.pk)
    shift = None
    if action != "form":
        shift = planning.form(actor, body)
        if action == "resubmit":
            lifecycle.perform(staff, shift.pk, "review", {"decision": "RETURN", "reason": "Check"})
            body["eventId"] = None
        else:
            lifecycle.perform(staff, shift.pk, "review", {"decision": "ACCEPT"})
            shift.refresh_from_db()
            shift.submission["execution"]["stateCode"] = "READY"
            shift.save(update_fields=["submission"])
    monkeypatch.setattr(Clock, "today_local", staticmethod(lambda: DAY))
    monkeypatch.setattr(Clock, "now", staticmethod(lambda: datetime(2026, 11, 3, 8, tzinfo=timezone.utc)))
    observed, release = Event(), Event()
    original = audit_service.record
    def pause(**kwargs):
        if kwargs["action"] == audit_service.SECURITY_EVENT_DELETED:
            observed.set()
            assert release.wait(10)
        return original(**kwargs)
    monkeypatch.setattr(audit_service, "record", pause)
    first_started, second_started = Event(), Event()
    first_state, second_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_session, lambda: security_events.delete_event(event.pk, actor=s["user"]), first_started, first_state)
        try:
            assert observed.wait(10)
            if action == "form":
                operation = lambda: planning.form(actor, body)
            else:
                operation = lambda: lifecycle.perform(actor if action == "resubmit" else staff, shift.pk, action, body if action == "resubmit" else {})
            second = executor.submit(run_session, operation, second_started, second_state)
            assert second_started.wait(10)
            serialized = waits_on(second, second_state["pid"], first_state["pid"])
        finally:
            release.set()
        assert first.result(timeout=15) == "ok"
        assert second.result(timeout=15) == ("PERMISSION_DENIED" if action == "form" else "ok")
    assert serialized
    if shift:
        shift.refresh_from_db()
        assert shift.event_id is None


def test_resubmit_and_new_group_share_event_without_department_deadlock(scene, monkeypatch):
    from organization_management.apps.ops.tests.test_combat_day_integration import combat_event
    s = scene
    actor, staff = str(s["user"].pk), str(s["staff_user"].pk)
    event = combat_event(s)
    body = payload(s, eventId=event.pk)
    shift = planning.form(actor, body)
    lifecycle.perform(staff, shift.pk, "review", {"decision": "RETURN", "reason": "Check"})
    group = OpsCombatGroup.objects.create(name="Same event other group", division=s["own"], max_members=3)
    other_body = payload(s, groupId=group.pk, eventId=event.pk, members=[{"employeeId": s["people"][2].pk, "isLeader": True}])
    observed, release = Event(), Event()
    original = planning.form

    def pause(actor_id, data, *, existing=None):
        if existing is not None:
            observed.set()
            assert release.wait(10)
        return original(actor_id, data, existing=existing)

    monkeypatch.setattr(planning, "form", pause)
    first_started, second_started = Event(), Event()
    first_state, second_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_session, lambda: lifecycle.perform(actor, shift.pk, "resubmit", body), first_started, first_state)
        try:
            assert observed.wait(10)
            second = executor.submit(run_session, lambda: planning.form(actor, other_body), second_started, second_state)
            assert second_started.wait(10)
            serialized = waits_on(second, second_state["pid"], first_state["pid"])
        finally:
            release.set()
        assert first.result(timeout=15) == "ok"
        assert second.result(timeout=15) == "ok"
    assert serialized
    assert OpsCombatDutyShift.objects.filter(event=event, state_code="SUBMITTED").count() == 2
