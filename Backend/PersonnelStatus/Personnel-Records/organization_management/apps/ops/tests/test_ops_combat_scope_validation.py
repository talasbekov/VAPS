"""The legacy combat registry must preserve the reader's frozen unit scope."""
from datetime import date

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, seed_role


pytestmark = pytest.mark.django_db
URL = "/api/ops/combat-duty-shifts/"


@pytest.fixture
def branches():
    own = Division.objects.create(name="Own department", division_type="department")
    child = Division.objects.create(name="Same unit name", division_type="directorate", parent=own)
    foreign = Division.objects.create(name="Foreign department", division_type="department")
    outside = Division.objects.create(name=child.name, division_type="directorate", parent=foreign)
    inactive = Division.objects.create(name="Inactive unit", division_type="directorate", parent=own, is_active=False)
    return own, child, foreign, outside, inactive


def shift(owner=None, *, state="ACCEPTED", draft=False, missing_owner=False):
    submission = None if draft else {
        "stateCode": state, "submittedByUnitName": "Same unit name",
        "groupLeaderEmployeeName": "Leader", "memberEmployeeNames": ["Member"],
        "reserveEmployeeNames": [],
    }
    if submission is not None and not missing_owner:
        submission["submittedByDivisionId"] = owner
    return OpsCombatDutyShift.objects.create(
        business_date=date(2026, 10, 7), duty_type_code="TEST_COMBAT",
        route_set={"routeIds": ["route-1"], "safeLabel": "Route 1"},
        submission=submission, required_employees=2,
    )


def ids(api):
    response = api.get(URL)
    assert response.status_code == 200, response.data
    return {int(row["id"]) for row in response.json()["results"]}


@pytest.mark.parametrize("state", ["SUBMITTED", "ACCEPTED", "RETURNED"])
def test_scoped_reader_keeps_own_roster_and_shared_draft_only(branches, state):
    own, child, _, outside, _ = branches
    own_shift = shift(child.pk, state=state)
    foreign_shift = shift(outside.pk, state=state)
    legacy = shift(missing_owner=True, state=state)
    draft = shift(draft=True)
    api, _ = client_for("combat-scoped", "COMBAT_SCOPED", ["duty.view"], own.pk)
    assert ids(api) == {own_shift.pk, draft.pk}
    global_api, _ = client_for("combat-global", "COMBAT_GLOBAL", ["duty.view"])
    assert ids(global_api) == {own_shift.pk, foreign_shift.pk, legacy.pk, draft.pk}


@pytest.mark.parametrize("owner_kind", ["string", "bool", "float", "missing", "deleted", "inactive"])
def test_scoped_reader_cannot_resolve_invalid_owner_from_a_matching_name(branches, owner_kind):
    own, child, _, _, inactive = branches
    owner = {"string": str(child.pk), "bool": True, "float": float(child.pk),
             "missing": None, "deleted": child.pk + 100000, "inactive": inactive.pk}[owner_kind]
    hidden = shift(owner)
    api, _ = client_for("combat-owner", "COMBAT_OWNER", ["duty.view"], own.pk)
    assert ids(api) == set()
    global_api, _ = client_for("combat-owner-global", "COMBAT_OWNER_GLOBAL", ["duty.view"])
    assert ids(global_api) == {hidden.pk}


def test_duty_scope_is_not_expanded_by_an_unrelated_global_permission(branches):
    own, child, _, outside, _ = branches
    visible, hidden = shift(child.pk), shift(outside.pk)
    api, actor = client_for("combat-permission-scope", "COMBAT_LOCAL", ["duty.view"], own.pk)
    seed_role("COMBAT_PERSONNEL_GLOBAL", ["personnel.view"])
    RoleAdminService.assign_role(str(actor.pk), "COMBAT_PERSONNEL_GLOBAL", actor="test")
    assert ids(api) == {visible.pk}
    assert hidden.pk not in ids(api)


def test_no_supported_detail_or_action_get_can_bypass_the_registry(branches):
    own, _, _, outside, _ = branches
    hidden = shift(outside.pk)
    api, _ = client_for("combat-no-detail", "COMBAT_NO_DETAIL", ["duty.view"], own.pk)
    assert api.get(f"{URL}{hidden.pk}/").status_code == 404
    for action in ("submit", "review", "acknowledge", "check-in", "handover", "complete", "replace"):
        assert api.get(f"{URL}{hidden.pk}/{action}/").status_code == 405


def test_authenticated_actor_without_duty_view_is_denied():
    api, _ = client_for("combat-no-rights")
    assert api.get(URL).status_code == 403
