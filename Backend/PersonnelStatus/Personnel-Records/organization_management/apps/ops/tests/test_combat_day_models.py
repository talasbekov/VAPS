"""Identity and database constraints for daily combat duty planning."""
from datetime import date

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_combat import (
    OpsCombatDutyMember, OpsCombatDutyShift, OpsCombatDutyType,
    OpsCombatGroup, OpsCombatRoute,
)

pytestmark = pytest.mark.django_db
DAY = date(2026, 11, 3)


@pytest.fixture
def owner():
    return Division.objects.create(name="Combat department", division_type="department")


def shift(group, **extra):
    return OpsCombatDutyShift.objects.create(
        business_date=DAY, group=group, division=group.division,
        duty_type_code="DAY", route_set={}, **extra,
    )


def test_group_is_owned_and_capacity_is_positive(owner):
    group = OpsCombatGroup.objects.create(name="БГ-1", division=owner, max_members=4)
    assert group.division_id == owner.pk and group.is_active
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsCombatGroup.objects.create(name="БГ-0", division=owner, max_members=0)


def test_catalog_codes_are_unique_inside_owner_not_across_departments(owner):
    other = Division.objects.create(name="Other combat department", division_type="department")
    for model, code_field, extra in (
        (OpsCombatDutyType, "duty_type_code", {"supports_multiple_routes": False}),
        (OpsCombatRoute, "route_code", {}),
    ):
        for division in (owner, other):
            model.objects.create(division=division, safe_label="Local", **{code_field: "LOCAL"}, **extra)
        with pytest.raises(IntegrityError), transaction.atomic():
            model.objects.create(division=owner, safe_label="Duplicate", **{code_field: "LOCAL"}, **extra)


def test_one_live_shift_per_group_and_day(owner):
    group = OpsCombatGroup.objects.create(name="БГ-1", division=owner, max_members=4)
    original = shift(group)
    with pytest.raises(IntegrityError), transaction.atomic():
        shift(group)
    from django.utils import timezone
    original.cancelled_at = timezone.now()
    original.save(update_fields=["cancelled_at"])
    assert shift(group).pk != original.pk


def test_active_employee_reservation_spans_groups(owner):
    first = shift(OpsCombatGroup.objects.create(name="БГ-1", division=owner, max_members=4))
    second = shift(OpsCombatGroup.objects.create(name="БГ-2", division=owner, max_members=4))
    employee = Employee.objects.create(personnel_number="combat-model-1", last_name="Identity")
    member = OpsCombatDutyMember.objects.create(
        shift=first, employee=employee, business_date=DAY, name_snapshot="Identity", active=True,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsCombatDutyMember.objects.create(
            shift=second, employee=employee, business_date=DAY, name_snapshot="Identity", active=True,
        )
    member.active = False
    member.save(update_fields=["active"])
    assert OpsCombatDutyMember.objects.create(
        shift=second, employee=employee, business_date=DAY, name_snapshot="Identity", active=True,
    ).pk


def test_legacy_shift_still_has_no_group_and_no_members():
    legacy = OpsCombatDutyShift.objects.create(
        business_date=DAY, duty_type_code="LEGACY", route_set={"safeLabel": "Old route"},
        submission={"groupLeaderEmployeeName": "Legacy name", "stateCode": "ACCEPTED"},
    )
    assert legacy.group_id is None and not legacy.members.exists()
