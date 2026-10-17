"""Freshness advertises rebuild authority for the requested division only."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import RolePermission, UserRole
from organization_management.apps.operations.models_submission import OpsDailySubmission
from organization_management.apps.operations.tests.test_service_summary_context import client
from organization_management.apps.operations.tests.test_summary_api import (
    FRESHNESS_URL, TODAY, assembled, submit, tree, types,  # noqa: F401
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def summary(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assembled(root)
    return root, left, right


def freshness(api, division):
    return api.get(FRESHNESS_URL, {
        "division_id": division.pk,
        "business_date": TODAY.isoformat(),
    })


@pytest.mark.parametrize("grant, expected", [
    ("missing", False), ("generate", False),
    ("global", True), ("own", True), ("child", False), ("foreign", False),
    ("global_wildcard", True), ("own_wildcard", True), ("foreign_wildcard", False),
])
def test_freshness_rebuild_capability_matches_permission_and_scope(summary, grant, expected):
    root, left, _ = summary
    foreign = Division.objects.create(name="Foreign branch")
    grants = [("status.view", None)]
    if grant != "missing":
        code = "*" if "wildcard" in grant else "daily_report.generate" if grant == "generate" else "daily_report.correct"
        scope = root.pk if grant.startswith("own") else left.pk if grant == "child" else foreign.pk if grant.startswith("foreign") else None
        grants.append((code, scope))
    api = client(grants, role="REBUILD_CAPABILITY")
    before = OpsDailySubmission.objects.count()
    response = freshness(api, root)
    assert response.status_code == 200
    assert response.data["status"] == "FRESH"
    assert response.data["can_rebuild"] is expected
    assert OpsDailySubmission.objects.count() == before


@pytest.mark.parametrize("change", ["revoke", "narrow"])
def test_freshness_rechecks_changed_rebuild_authority_without_removing_read_access(summary, change):
    root, left, _ = summary
    api = client([("status.view", None), ("daily_report.correct", root.pk)], role="REBUILD_CAPABILITY")
    assert freshness(api, root).data["can_rebuild"] is True
    if change == "revoke":
        RolePermission.objects.filter(role_code_id="REBUILD_CAPABILITY_1").delete()
    else:
        UserRole.objects.filter(role_code_id="REBUILD_CAPABILITY_1").update(scope_division_id=left.pk)
    response = freshness(api, root)
    assert response.status_code == 200
    assert response.data["can_rebuild"] is False


def test_rebuild_authority_does_not_expand_freshness_read_scope(summary):
    root, left, _ = summary
    api = client([("status.view", left.pk), ("daily_report.correct", None)], role="REBUILD_CAPABILITY")
    assert freshness(api, root).status_code == 403
