"""Story 17.5 (FR-31) — cascade_replace_departed(): auto-search within
управление, fallback to департамент, manual override, escalation on
no-candidate."""

import datetime

import pytest

from apps.audit.models import AuditLog
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import cascade_replace_departed
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db


def make_division(code, organization=None, parent=None):
    org = organization or Organization.objects.create(name=code, code=code)
    dtype = DivisionType.objects.get_or_create(code="dept", defaults={"name": "Отдел"})[
        0
    ]
    return Division.objects.create(
        organization=org, type_code=dtype, name=code, code=code, parent=parent
    )


def make_employee(division, iin, position_code="GUARD"):
    return Employee.objects.create(
        iin=iin,
        full_name="Иванов",
        rank_code="CAPT",
        position_code=position_code,
        division=division,
    )


def make_event(code):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(
        object=obj, title="ОМ", status_code=SecurityEvent.StatusCode.IN_PROGRESS
    )


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def make_approved_version(event):
    return AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.APPROVED, version=1
    )


def assign(version, employee_id, post):
    return PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post
    )


def test_auto_replaces_within_own_division():
    division = make_division("DIV-1")
    departed = make_employee(division, "900101300001")
    candidate = make_employee(division, "900101300002")
    event = make_event("OBJ-CASC-1")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    new_version = cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="Выбыл по болезни",
        sanction="Приказ №1",
    )

    row = new_version.assignments.get()
    assert row.employee_id == candidate.id
    assert row.is_unplanned is True
    assert row.source_division_id == division.id


def test_falls_back_to_parent_division_when_own_is_empty():
    parent = make_division("DIV-PARENT")
    child = make_division("DIV-CHILD", organization=parent.organization, parent=parent)
    departed = make_employee(child, "900101300003")
    candidate = make_employee(parent, "900101300004")
    event = make_event("OBJ-CASC-2")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    new_version = cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="x",
        sanction="y",
    )

    row = new_version.assignments.get()
    assert row.employee_id == candidate.id
    assert row.source_division_id == parent.id


def test_manual_replacement_skips_auto_search():
    division = make_division("DIV-3")
    departed = make_employee(division, "900101300005")
    auto_candidate = make_employee(division, "900101300006")
    other_division = make_division("DIV-3-OTHER", organization=division.organization)
    manual_pick = make_employee(other_division, "900101300007")
    event = make_event("OBJ-CASC-3")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    new_version = cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="x",
        sanction="y",
        manual_replacement_employee_id=manual_pick.id,
    )

    row = new_version.assignments.get()
    assert row.employee_id == manual_pick.id
    assert row.employee_id != auto_candidate.id
    assert row.source_division_id == other_division.id


def test_escalates_when_no_candidate_anywhere():
    division = make_division("DIV-4")
    departed = make_employee(division, "900101300008")
    event = make_event("OBJ-CASC-4")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    with pytest.raises(DomainError):
        cascade_replace_departed(
            version,
            actor="staff-1",
            departed_employee_id=departed.id,
            reason="x",
            sanction="y",
        )

    audit = AuditLog.objects.get(action="ASSIGNMENT_REPLACEMENT_ESCALATED")
    assert audit.new_value["departed_employee_id"] == str(departed.id)
    assert audit.new_value["post_id"] == post.pk
    # No new version created — escalation rolls back cleanly.
    assert AssignmentVersion.objects.filter(event=event).count() == 1


def test_replaces_all_posts_independently_when_departed_holds_several():
    division = make_division("DIV-5")
    departed = make_employee(division, "900101300009")
    candidate_a = make_employee(division, "900101300010")
    candidate_b = make_employee(division, "900101300011")
    event = make_event("OBJ-CASC-5")
    post_a = make_post(event.object, "POST-A")
    post_b = make_post(event.object, "POST-B")
    version = make_approved_version(event)
    assign(version, departed.id, post_a)
    assign(version, departed.id, post_b)

    new_version = cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="x",
        sanction="y",
    )

    employee_ids = set(new_version.assignments.values_list("employee_id", flat=True))
    assert employee_ids == {candidate_a.id, candidate_b.id}


def test_rejects_when_departed_holds_no_post():
    division = make_division("DIV-6")
    departed = make_employee(division, "900101300012")
    event = make_event("OBJ-CASC-6")
    version = make_approved_version(event)

    with pytest.raises(DomainError):
        cascade_replace_departed(
            version,
            actor="staff-1",
            departed_employee_id=departed.id,
            reason="x",
            sanction="y",
        )


def test_excludes_candidate_already_assigned_in_same_version():
    division = make_division("DIV-7")
    departed = make_employee(division, "900101300013")
    already_busy = make_employee(division, "900101300014")
    free_candidate = make_employee(division, "900101300015")
    event = make_event("OBJ-CASC-7")
    post_departed = make_post(event.object, "POST-DEP")
    post_busy = make_post(event.object, "POST-BUSY")
    version = make_approved_version(event)
    assign(version, departed.id, post_departed)
    assign(version, already_busy.id, post_busy)

    new_version = cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="x",
        sanction="y",
    )

    replaced_row = new_version.assignments.get(post=post_departed)
    assert replaced_row.employee_id == free_candidate.id
    assert replaced_row.employee_id != already_busy.id


def test_excludes_hard_block_status_candidate():
    division = make_division("DIV-8")
    departed = make_employee(division, "900101300016")
    blocked = make_employee(division, "900101300017")
    free_candidate = make_employee(division, "900101300018")
    StatusType.objects.get_or_create(
        code="SICK",
        defaults={
            "name": "Болен",
            "is_hard_block": True,
            "priority": 1,
            "report_column_code": "SICK",
        },
    )
    today = Clock.today_local()
    EmployeeStatus.objects.create(
        employee_id=blocked.id,
        status_type_code="SICK",
        date_start=today,
        date_end=today + datetime.timedelta(days=3),
    )
    event = make_event("OBJ-CASC-8")
    post = make_post(event.object)
    version = make_approved_version(event)
    assign(version, departed.id, post)

    new_version = cascade_replace_departed(
        version,
        actor="staff-1",
        departed_employee_id=departed.id,
        reason="x",
        sanction="y",
    )

    row = new_version.assignments.get()
    assert row.employee_id == free_candidate.id
    assert row.employee_id != blocked.id
