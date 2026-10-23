"""Additional personnel requests retain exact counts and local deadlines."""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.tests.test_ops_forces_gathering import (  # noqa: F401
    allocated_event, make_department, manager,
)


pytestmark = pytest.mark.django_db


@pytest.fixture
def request_row(manager):  # noqa: F811
    department = make_department()
    base, allocation_id = allocated_event(manager, department)
    return manager, base, allocation_id


@pytest.mark.parametrize("count", [True, 2.9, 2.0, "2.9", [], None])
def test_top_up_rejects_non_whole_counts_without_adding_a_request(request_row, count):
    api, base, allocation_id = request_row

    response = api.post(
        f"{base}forces/allocation/{allocation_id}/top-up/", {"count": count}, format="json",
    )

    assert response.status_code == 400, response.content
    assert "count" in response.json()["details"]
    assert len(api.get(base).json()["forceAllocation"]) == 1


@pytest.mark.parametrize("due_at", [None, "2026-08-08T13:45:00", "2026-08-08T08:45:00Z"])
def test_top_up_normalizes_due_date_and_supports_a_legacy_missing_deadline(request_row, due_at):
    api, base, allocation_id = request_row
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.force_allocation[0]["dueAt"] = None
    event.save(update_fields=["force_allocation", "updated_at"])
    body = {"count": "2"}
    if due_at is not None:
        body["dueAt"] = due_at

    response = api.post(f"{base}forces/allocation/{allocation_id}/top-up/", body, format="json")

    assert response.status_code == 200, response.content
    added = next(row for row in response.json()["forceAllocation"] if row["id"] != allocation_id)
    expected = {
        None: "2026-08-09T00:00:00+05:00",
        "2026-08-08T13:45:00": "2026-08-08T13:45:00+05:00",
        "2026-08-08T08:45:00Z": "2026-08-08T08:45:00+00:00",
    }
    assert added["dueAt"] == expected[due_at]
    assert added["need"] == 2
