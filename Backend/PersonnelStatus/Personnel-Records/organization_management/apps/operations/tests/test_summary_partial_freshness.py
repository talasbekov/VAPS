"""A known missing submission makes a summary incomplete, not out of date."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.summary_service import (
    assemble_summary, summary_freshness,
)
from organization_management.apps.operations.tests.test_summary_freshness import (
    tree, types, submit, amend,  # noqa: F401
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING, TODAY, in_slot,
)

pytestmark = pytest.mark.django_db


def partial(root):
    with clock.override(MORNING):
        return assemble_summary(division_id=root.pk, business_date=TODAY,
                                actor="7", allow_incomplete=True)


def test_new_partial_summary_is_current_while_known_child_has_not_submitted(types, tree):
    root, left, _ = tree
    submit(left)
    row = partial(root)
    before = row.snapshot.copy()

    state = summary_freshness(root.pk, TODAY)

    assert state.status == "FRESH"
    assert (state.superseded, state.missing, state.unpinned) == ([], [], [])
    row.refresh_from_db()
    assert row.snapshot == before


def test_previously_missing_child_submission_outdates_partial_summary(types, tree):
    root, left, right = tree
    submit(left)
    partial(root)
    submit(right)

    state = summary_freshness(root.pk, TODAY)

    assert state.status == "STALE"
    assert state.unpinned == [right.pk]


def test_new_required_branch_outdates_partial_summary_without_a_submission(types, tree):
    root, left, _ = tree
    submit(left)
    partial(root)
    newcomer = Division.objects.create(name="New branch", parent=root)
    in_slot(newcomer, iin="780000000003")

    state = summary_freshness(root.pk, TODAY)

    assert state.status == "STALE"
    assert state.unpinned == [newcomer.pk]


def test_amending_pinned_child_outdates_partial_summary(types, tree):
    root, left, _ = tree
    submit(left)
    partial(root)
    amend(left)

    state = summary_freshness(root.pk, TODAY)

    assert state.status == "STALE"
    assert state.superseded == [{"division_id": left.pk, "pinned_version": 1,
                                 "current_version": 2}]


def test_legacy_partial_snapshot_without_baseline_is_not_assumed_current(types, tree):
    root, left, right = tree
    submit(left)
    row = partial(root)
    # Recreate the legacy snapshot shape, without depending on metadata names.
    row.snapshot = {key: value for key, value in row.snapshot.items()
                    if key in {"sources", "employees", "counts", "division_id",
                               "business_date", "generated_at", "totals", "roster"}}
    row.save(update_fields=["snapshot"])

    state = summary_freshness(root.pk, TODAY)

    assert state.status == "STALE"
    assert state.unpinned == [right.pk]
