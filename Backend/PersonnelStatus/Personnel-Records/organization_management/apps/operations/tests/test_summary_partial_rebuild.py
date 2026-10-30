"""Partial correction stays explicit, scoped and versioned."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_submission import OpsDailySubmission
from organization_management.apps.operations.summary_service import summary_freshness
from organization_management.apps.operations.tests.test_service_summary_context import client
from organization_management.apps.operations.tests.test_summary_partial_freshness import (
    partial, tree, types, submit, TODAY, MORNING,  # noqa: F401
)

pytestmark = pytest.mark.django_db
URL = "/api/operations/daily-summaries/rebuild/"


@pytest.mark.parametrize("override,confirmed,expected", [
    ("own", True, 201), ("global", True, 201),
    ("own", False, 422), ("missing", True, 403), ("foreign", True, 403),
])
def test_partial_rebuild_requires_both_confirmation_and_matching_override_scope(types, tree, override, confirmed, expected):
    root, left, _ = tree
    submit(left)
    old = partial(root)
    old_snapshot = old.snapshot.copy()
    grants = [("daily_report.correct", root.pk)]
    if override != "missing":
        foreign = Division.objects.create(name="Foreign") if override == "foreign" else None
        scope = foreign.pk if foreign else None if override == "global" else root.pk
        grants.append(("daily_report.override_block", scope))
    api = client(grants)
    with clock.override(MORNING):
        response = api.post(URL, {"division_id": root.pk, "business_date": TODAY.isoformat(),
            "reason": "Explicit test correction with missing submissions", "sanction": "Test authority",
            "allow_incomplete": confirmed}, format="json")
    assert response.status_code == expected, response.data
    old.refresh_from_db()
    assert old.snapshot == old_snapshot
    if expected == 201:
        current = OpsDailySubmission.objects.get(division_id=root.pk, business_date=TODAY, is_current=True)
        assert current.version == old.version + 1
        assert current.sent_at is None
        assert current.incomplete_reason == "Explicit test correction with missing submissions"
        assert summary_freshness(root.pk, TODAY).status == "FRESH"
        assert old.is_current is False
    else:
        assert old.is_current is True
        assert OpsDailySubmission.objects.filter(division_id=root.pk).count() == 1
