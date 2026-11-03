"""Combat HQ decisions require the dedicated grant, on both API generations."""
from importlib import import_module

import pytest
from django.apps import apps

from organization_management.apps.operations.models import Permission, Role, RolePermission
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, seed_role
from organization_management.apps.ops.tests.test_combat_day_planning import BOARD, DAY, form, scene  # noqa: F401
from organization_management.apps.ops.tests.test_ops_combat_scope_validation import shift

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("global_grant", [False, True])
def test_ordinary_duty_manager_cannot_review_combat_or_advertise_review(scene, global_grant):
    s = scene
    row = form(s)
    api, _ = client_for("ordinary-manager", "ORDINARY_MANAGER", ["duty.manage"], None if global_grant else s["own"].pk)
    choices = api.get(BOARD + "choices/", {"date": DAY.isoformat(), "division_id": s["own"].pk})
    assert choices.status_code == 200
    assert choices.json()["permissions"]["review"] is False
    response = api.post(f'{BOARD}{row["id"]}/review/', {"decision": "RETURN", "reason": "Not authorized"}, format="json")
    assert response.status_code == 403
    assert OpsCombatDutyShift.objects.get(pk=row["id"]).state_code == "SUBMITTED"


def test_unrelated_global_duty_grant_does_not_expand_scoped_combat_review(scene):
    s = scene
    row = form(s)
    api, user = client_for("foreign-hq", "FOREIGN_HQ", ["duty.combat.manage"], s["other"].pk)
    seed_role("GLOBAL_ORDINARY_DUTY", ["duty.manage"])
    RoleAdminService.assign_role(str(user.pk), "GLOBAL_ORDINARY_DUTY", actor="test")
    response = api.post(f'{BOARD}{row["id"]}/review/', {"decision": "RETURN", "reason": "Wrong department"}, format="json")
    assert response.status_code == 403
    assert OpsCombatDutyShift.objects.get(pk=row["id"]).state_code == "SUBMITTED"


@pytest.mark.parametrize("permission,foreign,expected", [
    ("duty.manage", False, 403),
    ("duty.combat.manage", False, 200),
    ("duty.combat.manage", True, 403),
])
def test_legacy_review_uses_the_same_dedicated_scoped_grant(scene, permission, foreign, expected):
    s = scene
    row = shift(s["own"].pk, state="SUBMITTED")
    api, _ = client_for("legacy-hq", "LEGACY_HQ", [permission], s["other"].pk if foreign else s["own"].pk)
    response = api.post(f'/api/ops/combat-duty-shifts/{row.pk}/review/', {"decision": "RETURN", "returnReason": "Change roster"}, format="json")
    assert response.status_code == expected, response.data
    row.refresh_from_db()
    assert row.submission["stateCode"] == ("RETURNED" if expected == 200 else "SUBMITTED")


def test_permission_migration_is_additive_and_catalog_can_be_administered(scene):
    role, _ = Role.objects.get_or_create(code="DUTY_OFFICER", defaults={"name": "Existing duty officer"})
    ordinary, _ = Permission.objects.get_or_create(code="duty.manage", defaults={"name": "Existing ordinary right"})
    link, _ = RolePermission.objects.get_or_create(role_code=role, permission_code=ordinary)
    existing = set(RolePermission.objects.values_list("pk", "role_code_id", "permission_code_id"))
    seed = import_module("organization_management.apps.operations.migrations.0152_combat_day_permissions").seed
    seed(apps, None)
    after = set(RolePermission.objects.values_list("pk", "role_code_id", "permission_code_id"))
    assert existing <= after
    assert RolePermission.objects.filter(pk=link.pk, permission_code_id="duty.manage").exists()
    assert RolePermission.objects.filter(role_code=role, permission_code_id="duty.combat.manage").exists()
    seed(apps, None)
    assert set(RolePermission.objects.values_list("pk", "role_code_id", "permission_code_id")) == after
    api, _ = client_for("catalog-admin", "CATALOG_ADMIN", ["admin.roles"])
    response = api.get("/api/operations/permissions/")
    assert response.status_code == 200
    rows = response.json()
    if isinstance(rows, dict):
        rows = rows.get("results", rows.get("data", []))
    assert any(row["code"] == "duty.combat.manage" and row["name"] for row in rows)


@pytest.mark.parametrize("action", ["check-in", "handover", "complete"])
@pytest.mark.parametrize("permission,foreign,expected", [
    ("duty.manage", False, 403),
    ("duty.combat.manage", False, 200),
    ("duty.combat.manage", True, 403),
])
def test_legacy_execution_requires_dedicated_combat_scope(scene, action, permission, foreign, expected):
    s = scene
    row = shift(s["own"].pk)
    row.submission["execution"] = {
        "stateCode": "READY" if action == "check-in" else "ACTIVE",
        "acknowledgedMemberNames": ["Leader", "Member"],
        "handover": {"confirmedByEmployeeName": "Leader"} if action == "complete" else None,
    }
    row.save(update_fields=["submission"])
    before = row.submission
    api, _ = client_for("legacy-execution", "LEGACY_EXECUTION", [permission], s["other"].pk if foreign else s["own"].pk)
    payload = {"confirmedByEmployeeName": "Leader", "actualMemberNames": ["Leader", "Member"]}
    response = api.post(f'/api/ops/combat-duty-shifts/{row.pk}/{action}/', payload, format="json")
    assert response.status_code == expected, response.data
    row.refresh_from_db()
    if expected == 403:
        assert row.submission == before
    else:
        assert row.submission != before
