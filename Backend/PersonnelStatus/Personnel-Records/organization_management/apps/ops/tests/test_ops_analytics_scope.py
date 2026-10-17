"""Analytics grants constrain aggregates and every disclosed identity alike."""
import datetime as dt
import json

import pytest
from django.core.management import call_command

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock, override
from organization_management.apps.operations.models import Role, RolePermission, UserRole
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops import analytics
from organization_management.apps.ops.tests.test_ops_analytics_api import _shift
from organization_management.apps.staff_unit.models import StaffUnit


pytestmark = pytest.mark.django_db
SNAPSHOT = "/api/ops/service-analytics/"
DRILLDOWN = "/api/ops/service-analytics-drilldown/"
ATTENTION = "/api/ops/service-analytics-attention/"
LOAD = "/api/ops/load-analytics/"
OPERATIONS = "/api/ops/operations-analytics/"


@pytest.fixture
def scene():
    call_command("seed_operations", verbosity=0)
    own = Division.objects.create(name="Analytics department A", division_type="department")
    child = Division.objects.create(name="Analytics child A", parent=own, division_type="directorate")
    foreign = Division.objects.create(name="Analytics department B", division_type="department")
    people, shifts = [], []
    for index, division in enumerate((own, child, foreign), 1):
        person = Employee.objects.create(
            personnel_number=f"analytics-scope-{index}", last_name=f"SecretPerson{index}",
            first_name="Analytics", birth_date=None, hire_date=None,
        )
        StaffUnit.objects.create(index=index, division=division, employee=person)
        people.append(person)
        shifts.append(_shift(f"SecretPerson{index} Analytics", 0, "PLANNED", employee_id=str(person.pk)))
    # A familiar name is never proof of a stable employee/division link.
    unlinked = _shift(shifts[0].employee_name, 0, "PLANNED")
    return {"own": own, "child": child, "foreign": foreign,
            "people": people, "shifts": shifts, "unlinked": unlinked}


def reader(scene, *, global_grant=False, personal=True, drill=True):
    permissions = ["analytics.view", "analytics.operations"]
    if personal:
        permissions.append("analytics.personal_detail")
    if drill:
        permissions.append("analytics.drilldown")
    return client_for("scope-analyst", "SCOPE_ANALYST", permissions,
                      None if global_grant else scene["own"].pk)


def snapshot(api):
    response = api.get(SNAPSHOT, {"preset": "TODAY"})
    assert response.status_code == 200, response.data
    return response.data


def planned(data):
    return next(row["value"] for row in data["data"]["metrics"] if row["metricCode"] == "DUTY_PLANNED")


def drilldown(api, data):
    return api.get(DRILLDOWN, {"preset": "TODAY", "snapshot_id": data["snapshotId"],
                               "metric_code": "DUTY_PLANNED"})


@pytest.mark.parametrize("global_grant, expected", [(False, 2), (True, 4)])
def test_summary_and_drilldown_share_view_scope(scene, global_grant, expected):
    api, _ = reader(scene, global_grant=global_grant)
    summary = snapshot(api)
    assert planned(summary) == expected
    response = drilldown(api, summary)
    assert response.status_code == 200, response.data
    assert response.data["data"]["totalCount"] == expected
    ids = {row["rowId"] for row in response.data["data"]["rows"]}
    assert str(scene["shifts"][0].pk) in ids
    assert str(scene["shifts"][1].pk) in ids
    assert (str(scene["shifts"][2].pk) in ids) is global_grant
    assert (str(scene["unlinked"].pk) in ids) is global_grant


@pytest.mark.parametrize("global_grant, expected", [(False, 2), (True, 4)])
def test_attention_uses_same_view_scope(scene, global_grant, expected):
    api, _ = reader(scene, global_grant=global_grant)
    response = api.get(ATTENTION, {"preset": "TODAY"})
    assert response.status_code == 200, response.data
    item = next(row for row in response.data["data"]["items"] if row["categoryCode"] == "ACKNOWLEDGEMENT_MISSING")
    assert item["count"] == expected
    assert response.data["scope"] == snapshot(api)["scope"]


@pytest.mark.parametrize("global_grant, count, minutes", [(False, 2, 2880), (True, 3, 4320)])
def test_load_without_personal_right_keeps_only_scoped_unit_totals(scene, global_grant, count, minutes):
    api, _ = reader(scene, global_grant=global_grant, personal=False)
    response = api.get(LOAD)
    assert response.status_code == 200, response.data
    view = response.data["view"]
    assert view["employees"] == []
    assert len(view["units"]) == count
    assert sum(row["plannedMinutes"] for row in view["units"]) == minutes
    assert view["unlinkedShiftsCount"] == (1 if global_grant else 0)
    assert view["personalDetailSuppressed"] is True
    assert view["personalDetailReason"]
    payload = json.dumps(response.data)
    assert "SecretPerson" not in payload
    assert all(row["employeeId"] is None for row in view["units"])


@pytest.mark.parametrize("global_grant, count", [(False, 2), (True, 3)])
def test_load_personal_rows_respect_view_scope(scene, global_grant, count):
    api, _ = reader(scene, global_grant=global_grant)
    view = api.get(LOAD).data["view"]
    assert len(view["employees"]) == count
    ids = {row["employeeId"] for row in view["employees"]}
    assert (str(scene["people"][2].pk) in ids) is global_grant


def add_scoped_permission(user, code, division):
    role = Role.objects.create(code="SCOPED_EXTENSION", name="Scoped extension")
    RolePermission.objects.create(role_code=role, permission_code_id=code)
    UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=division.pk,
                            is_active=True, created_by="test")


def test_personal_grant_in_another_scope_does_not_disclose_identity(scene):
    api, user = reader(scene, global_grant=True, personal=False)
    add_scoped_permission(user, "analytics.personal_detail", scene["own"])
    view = api.get(LOAD).data["view"]
    assert {row["employeeId"] for row in view["employees"]} == {
        str(scene["people"][0].pk), str(scene["people"][1].pk),
    }
    assert len(view["units"]) == 3
    assert "SecretPerson3" not in json.dumps(view)
    response = drilldown(api, snapshot(api))
    assert response.status_code == 200, response.data
    rows = {row["rowId"]: row for row in response.data["data"]["rows"]}
    assert rows[str(scene["shifts"][0].pk)]["employeeLabel"] == "SecretPerson1 Analytics"
    assert rows[str(scene["shifts"][2].pk)]["employeeLabel"] is None
    assert response.data["data"]["personalDetailSuppressed"] is True


def test_narrow_drilldown_grant_does_not_open_wider_summary_rows(scene):
    api, user = reader(scene, global_grant=True, drill=False)
    add_scoped_permission(user, "analytics.drilldown", scene["own"])
    summary = snapshot(api)
    assert planned(summary) == 4
    assert summary["drilldownAllowed"] is False
    assert drilldown(api, summary).status_code == 403


def test_snapshot_cannot_be_reused_across_different_grant_scopes(scene):
    own_api, _ = reader(scene)
    other_api, _ = client_for("foreign-analyst", "FOREIGN_ANALYST",
                              ("analytics.view", "analytics.drilldown"), scene["foreign"].pk)
    summary = snapshot(own_api)
    foreign_summary = snapshot(other_api)
    assert foreign_summary["snapshotId"] != summary["snapshotId"]
    assert drilldown(other_api, summary).status_code == 422


def test_staff_transfer_invalidates_snapshot_and_excludes_moved_employee(scene):
    api, _ = reader(scene)
    summary = snapshot(api)
    StaffUnit.objects.filter(employee=scene["people"][0]).update(division=scene["foreign"])
    assert drilldown(api, summary).status_code == 422
    assert planned(snapshot(api)) == 1


@pytest.mark.parametrize("bad_id", ["0", "-1", "9223372036854775808", "9" * 50, "١", "1.0"])
def test_malformed_employee_ids_are_unlinked_and_cannot_establish_scope(scene, bad_id):
    _shift("SecretPerson1 Analytics", 0, "PLANNED", employee_id=bad_id)
    api, _ = reader(scene)
    assert planned(snapshot(api)) == 2
    assert api.get(LOAD).data["view"]["unlinkedShiftsCount"] == 0


def test_noncanonical_employee_id_does_not_inherit_named_employee_scope(scene):
    _shift("SecretPerson1 Analytics", 0, "PLANNED", employee_id="0" + str(scene["people"][0].pk))
    api, _ = reader(scene)
    assert planned(snapshot(api)) == 2


def test_scoped_operations_analytics_refuses_unverifiable_event_ownership(scene):
    api, _ = reader(scene)
    response = api.get(OPERATIONS)
    assert response.status_code == 403, response.data
    assert response.data["error_code"] == "ANALYTICS_SCOPE_UNAVAILABLE"


def test_missing_actor_cannot_read_global_source(scene):
    assert analytics.read_source(actor=None)["shifts"] == []


@pytest.mark.parametrize("state, metric", [
    ("PLANNED", "UNFINISHED_PAST_DUTIES"),
    ("COMPLETED", "REST_AFTER_DUTY"),
])
def test_business_date_rollover_invalidates_fixed_period_snapshot(scene, state, metric):
    api, _ = reader(scene)
    first_day = scene["shifts"][0].business_date
    OpsDutyShift.objects.filter(pk__in=[shift.pk for shift in scene["shifts"][:2]]).update(state_code=state)
    params = {"from": first_day.isoformat(), "to": first_day.isoformat()}
    with override(first_day):
        before = api.get(SNAPSHOT, params).data
    with override(first_day + dt.timedelta(days=1)):
        after = api.get(SNAPSHOT, params).data
        stale = api.get(DRILLDOWN, {**params, "snapshot_id": before["snapshotId"], "metric_code": metric})
    values_before = {row["metricCode"]: row["value"] for row in before["data"]["metrics"]}
    values_after = {row["metricCode"]: row["value"] for row in after["data"]["metrics"]}
    assert values_before[metric] == 0
    assert values_after[metric] == 2
    assert stale.status_code == 422, stale.data
    assert stale.data["error_code"] == "SNAPSHOT_OUTDATED"
    assert before["snapshotId"] != after["snapshotId"]


def test_single_request_uses_one_business_date_when_clock_crosses_midnight(scene, monkeypatch):
    _, user = reader(scene)
    first_day = scene["shifts"][0].business_date
    first_moment = Clock.to_local(Clock.now()).replace(hour=23, minute=59, second=59, microsecond=0)
    moments = iter([first_moment.astimezone(dt.timezone.utc)])
    next_moment = (first_moment + dt.timedelta(seconds=2)).astimezone(dt.timezone.utc)
    monkeypatch.setattr(Clock, "now", staticmethod(lambda: next(moments, next_moment)))
    result = analytics.service_analytics(
        {"analytics.view", "analytics.drilldown", "analytics.personal_detail"},
        {"presetCode": "TODAY"}, actor=str(user.pk),
    )
    assert result["period"]["from"] == first_day.isoformat()
    assert result["businessDate"] == first_day.isoformat()
    metrics = {row["metricCode"]: row["value"] for row in result["data"]["metrics"]}
    assert metrics["UNFINISHED_PAST_DUTIES"] == 0
    assert Clock.to_local(dt.datetime.fromisoformat(result["generatedAt"])).date() == first_day
