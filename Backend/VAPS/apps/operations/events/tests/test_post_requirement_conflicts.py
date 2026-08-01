"""Story 16.3c (FR-25) — post-requirement mismatch, extending
`detect_placement_conflicts()` (16.3b) in the SAME pass, not a parallel
function."""

import datetime

import pytest
from django.utils import timezone

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeOperationalProfile,
    Organization,
)
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
)
from apps.operations.events.services import detect_placement_conflicts
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="POST-REQ", code="POST-REQ")
    dtp = DivisionType.objects.create(code="pr-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="POST-REQ", code="POST-REQ"
    )


def make_event(code="OBJ-POSTREQ-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def make_employee(division, iin, **kwargs):
    defaults = {
        "full_name": "Иванов",
        "rank_code": "CAPT",
        "rank_index": 3,
        "position_code": "GUARD",
        "gender": "M",
        "height_cm": 180,
        "division": division,
    }
    defaults.update(kwargs)
    return Employee.objects.create(iin=iin, **defaults)


def make_assignment(event, employee, post, **post_kwargs):
    for key, value in post_kwargs.items():
        setattr(post, key, value)
    post.save()
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    return version, PlacementAssignment.objects.create(
        version=version, employee_id=employee.id, post=post
    )


def make_post(event, code="POST-1", requirements=None, **kwargs):
    return Post.objects.create(
        object=event.object,
        code=code,
        name="Пост",
        requirements=requirements or {},
        **kwargs,
    )


def test_height_below_minimum_is_mismatch(division):
    event = make_event("OBJ-POSTREQ-2")
    employee = make_employee(division, "900101300601", height_cm=160)
    post = make_post(event, requirements={"min_height_cm": 175})
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "POST_REQUIREMENT_MISMATCH_CONFLICT" in assignment.conflict_codes


def test_height_meets_minimum_no_conflict(division):
    event = make_event("OBJ-POSTREQ-3")
    employee = make_employee(division, "900101300602", height_cm=180)
    post = make_post(event, requirements={"min_height_cm": 175})
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_gender_mismatch(division):
    event = make_event("OBJ-POSTREQ-4")
    employee = make_employee(division, "900101300603", gender="F")
    post = make_post(event, requirements={"gender": "M"})
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "POST_REQUIREMENT_MISMATCH_CONFLICT" in assignment.conflict_codes


def test_rank_below_minimum_is_mismatch(division):
    event = make_event("OBJ-POSTREQ-5")
    employee = make_employee(division, "900101300604", rank_index=1)
    post = make_post(event, requirements={"min_rank_index": 5})
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "POST_REQUIREMENT_MISMATCH_CONFLICT" in assignment.conflict_codes


def test_overqualification_flagged_when_explicitly_disallowed(division):
    event = make_event("OBJ-POSTREQ-6")
    employee = make_employee(division, "900101300605", rank_index=9)
    post = make_post(
        event,
        requirements={"max_rank_index": 5, "allow_overqualification": False},
    )
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "OVERQUALIFICATION_DETECTED" in assignment.conflict_codes


def test_overqualification_flagged_when_disallowed_via_int_zero(division):
    """Review finding (Edge Case Hunter, live-confirmed): unvalidated JSON
    from a client could send `0` instead of `false` — `0 is False` is
    False in Python, so an identity-only check silently ignored this and
    treated it as permissive. Must be treated the same as bool `False`."""
    event = make_event("OBJ-POSTREQ-6B")
    employee = make_employee(division, "900101300613", rank_index=9)
    post = make_post(
        event,
        requirements={"max_rank_index": 5, "allow_overqualification": 0},
    )
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "OVERQUALIFICATION_DETECTED" in assignment.conflict_codes


def test_overqualification_not_flagged_by_default(division):
    event = make_event("OBJ-POSTREQ-7")
    employee = make_employee(division, "900101300606", rank_index=9)
    post = make_post(
        event, requirements={"max_rank_index": 5}
    )  # no allow_overqualification key
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_position_code_not_in_required_list(division):
    event = make_event("OBJ-POSTREQ-8")
    employee = make_employee(division, "900101300607", position_code="DRIVER")
    post = make_post(
        event, requirements={"required_position_codes": ["GUARD", "SENIOR_GUARD"]}
    )
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "POST_REQUIREMENT_MISMATCH_CONFLICT" in assignment.conflict_codes


def test_orphan_employee_id_skips_post_requirement_check_without_crashing(division):
    """Review finding (Blind Hunter, confirmed live by Edge Case Hunter):
    a PlacementAssignment.employee_id with no matching core.Employee row
    (employee_id is a bare UUIDField, never FK'd — reachable in practice
    via form_draft_placement()'s 16.2 copy of SecurityEventDirectAssignment,
    which itself validates nothing against core.Employee, "система
    пассивна" by 15.9's own design) must not crash the whole conflict
    scan — the post-requirement check is skipped for that row entirely,
    same "absent data, no invented assumption" principle as everywhere
    else in this detector, just at row level instead of field level."""
    import uuid

    event = make_event("OBJ-POSTREQ-9B")
    post = make_post(event, requires_weapon=True)
    version = AssignmentVersion.objects.create(
        event=event, status=AssignmentVersion.Status.DRAFT
    )
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id=uuid.uuid4(), post=post
    )

    detect_placement_conflicts(version)  # must not raise

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_missing_weapon_permit_is_mismatch(division):
    event = make_event("OBJ-POSTREQ-9")
    employee = make_employee(division, "900101300608")
    EmployeeOperationalProfile.objects.create(
        employee=employee, has_weapon_permit=False
    )
    post = make_post(event, requires_weapon=True)
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert "POST_REQUIREMENT_MISMATCH_CONFLICT" in assignment.conflict_codes


def test_unknown_weapon_permit_no_operational_profile_is_not_flagged(division):
    """Missing EmployeeOperationalProfile row = unknown, not "lacks permit" —
    the check must not invent a mismatch from absent data."""
    event = make_event("OBJ-POSTREQ-10")
    employee = make_employee(division, "900101300609")
    post = make_post(event, requires_weapon=True)
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_malformed_requirements_json_does_not_crash(division):
    event = make_event("OBJ-POSTREQ-11")
    employee = make_employee(division, "900101300610", height_cm=160)
    post = make_post(
        event,
        requirements={
            "min_height_cm": "не число",
            "gender": 123,
            "required_position_codes": "не список",
        },
    )
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)  # must not raise

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_empty_requirements_dict_no_conflict(division):
    event = make_event("OBJ-POSTREQ-12")
    employee = make_employee(division, "900101300611")
    post = make_post(event, requirements={})
    version, assignment = make_assignment(event, employee, post)

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert assignment.conflict_codes == []


def test_post_mismatch_coexists_with_rest_violation(division):
    """16.3b and 16.3c write into the SAME conflict_codes list in one pass —
    both categories must survive together, not overwrite each other."""
    now = timezone.now()
    event = make_event("OBJ-POSTREQ-13")
    SecurityEvent.objects.filter(pk=event.pk).update(
        starts_at=now, ends_at=now + datetime.timedelta(hours=8)
    )
    event.refresh_from_db()
    employee = make_employee(division, "900101300612", height_cm=160)
    post = make_post(event, requirements={"min_height_cm": 175})
    version, assignment = make_assignment(event, employee, post)
    EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="REST_AFTER_DUTY",
        date_start=now.date(),
        date_end=now.date() + datetime.timedelta(days=1),
        source=EmployeeStatus.Source.OM_AUTO,
    )

    detect_placement_conflicts(version)

    assignment.refresh_from_db()
    assert set(assignment.conflict_codes) == {
        "POST_REQUIREMENT_MISMATCH_CONFLICT",
        "REST_VIOLATION_CONFLICT",
    }
    assert assignment.conflict_severity == "SOFT"
