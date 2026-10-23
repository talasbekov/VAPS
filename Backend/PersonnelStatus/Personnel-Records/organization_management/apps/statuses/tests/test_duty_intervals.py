"""A daily personnel status does not imply continuous attendance at a post."""
from datetime import timedelta

import pytest
from django.utils import timezone

from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.tests.test_duty_assignments import (
    URL, create, payload, roster, scene, world,
)

pytestmark = pytest.mark.django_db


def exit_at(start_day=0, start="09:00:00", end_day=0, end="11:00:00"):
    today = timezone.localdate()
    return {"start_at": f"{today + timedelta(days=start_day)}T{start}+05:00",
            "end_at": f"{today + timedelta(days=end_day)}T{end}+05:00"}


def placement(scene, intervals, **extra):
    return {**payload(scene)["duty_assignment"], "intervals": intervals, **extra}


def test_several_exits_and_overnight_are_saved_atomically_without_filling_gaps(scene):
    intervals = [exit_at(0, "23:00:00", 1, "01:00:00"), exit_at(),
                 exit_at(0, "15:00:00", 0, "17:00:00")]
    row = create(scene, duty_assignment=placement(scene, intervals))
    saved = row["duty_assignment"]
    assert saved.get("intervals") == [intervals[1], intervals[2], intervals[0]]
    assert saved["time_zone"] == "Asia/Almaty"
    result = roster(scene).data["results"]
    assert len(result) == 1
    assert result[0]["placement"] == saved
    assert "start_at" not in result[0] and "dispatch_assignment_id" not in result[0]


@pytest.mark.parametrize("intervals", [
    None, "09:00-11:00", {}, [None], [{}],
    [{"start_at": "2026-02-30T09:00:00+05:00", "end_at": "2026-03-01T11:00:00+05:00"}],
    [exit_at(start="24:00:00")], [exit_at(start="09:60:00")],
    [{"start_at": "2026-10-19T09:00:00", "end_at": "2026-10-19T11:00:00"}],
    [exit_at(end="09:00:00")], [exit_at(end="08:00:00")],
    [exit_at(-1, "23:00:00", 0, "01:00:00")],
    [exit_at(3, "23:00:00", 4, "01:00:00")],
    [exit_at(), exit_at(0, "10:59:00", 0, "12:00:00")],
    [exit_at(), exit_at()], [exit_at()] * 257,
    [exit_at(start="09:00:00.000001", end="09:00:00.000002")],
])
def test_invalid_or_overlapping_times_do_not_replace_an_existing_status(scene, intervals):
    employee = scene["people"]["own"]
    before = list(employee.statuses.values("id", "state", "actual_end_date"))
    response = scene["api"].post(URL, payload(scene, duty_assignment=placement(scene, intervals)), format="json")
    assert response.status_code == 400, response.data
    assert "duty_assignment" in response.data
    assert list(employee.statuses.values("id", "state", "actual_end_date")) == before


def test_adjacent_exits_and_next_midnight_are_valid_exclusive_endpoints(scene):
    intervals = [exit_at(), exit_at(0, "11:00:00", 0, "13:00:00"),
                 exit_at(3, "23:00:00", 4, "00:00:00")]
    assert create(scene, duty_assignment=placement(scene, intervals))["duty_assignment"].get("intervals") == intervals


def test_equivalent_instant_is_normalized_to_astana_not_server_timezone(scene):
    interval = exit_at()
    interval["start_at"] = interval["start_at"].replace("T09:00:00+05:00", "T04:00:00Z")
    row = create(scene, duty_assignment=placement(scene, [interval]))
    assert row["duty_assignment"].get("intervals") == [exit_at()]


def test_millisecond_precision_and_historical_astana_offset_are_retained(scene):
    from datetime import date
    from organization_management.apps.statuses.duty_intervals import normalize_schedule
    interval = {"start_at": "2023-10-19T03:00:00.001Z", "end_at": "2023-10-19T03:00:00.002Z"}
    result = normalize_schedule({"intervals": [interval]}, date(2023, 10, 19), date(2023, 10, 19))
    assert result["intervals"] == [{"start_at": "2023-10-19T09:00:00.001000+06:00",
                                    "end_at": "2023-10-19T09:00:00.002000+06:00"}]


def test_old_client_comment_and_placement_patch_cannot_erase_saved_hours(scene):
    intervals = [exit_at(5, "09:00:00", 5, "11:00:00")]
    row = create(scene, start=5, end=8, duty_assignment=placement(scene, intervals))
    url = f'{URL}{row["id"]}/'
    for changes in [{"comment": "Только комментарий"}, {"duty_assignment": payload(scene)["duty_assignment"]}]:
        response = scene["api"].patch(url, changes, format="json")
        assert response.status_code == 200, response.data
        assert response.data["duty_assignment"].get("intervals") == intervals
    changed = [exit_at(5, "13:00:00", 5, "15:00:00")]
    response = scene["api"].patch(url, {"duty_assignment": placement(scene, changed)}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["duty_assignment"]["intervals"] == changed


def test_shorter_planned_period_rejects_hours_outside_it_without_silent_truncation(scene):
    intervals = [exit_at(8, "09:00:00", 8, "11:00:00")]
    row = create(scene, start=5, end=8, duty_assignment=placement(scene, intervals))
    response = scene["api"].patch(f'{URL}{row["id"]}/', {
        "end_date": (timezone.localdate() + timedelta(days=7)).isoformat()}, format="json")
    assert response.status_code == 400, response.data
    assert EmployeeStatus.objects.get(pk=row["id"]).end_date.isoformat() == row["end_date"]


def test_early_termination_clips_reader_hours_but_preserves_saved_history(scene):
    intervals = [exit_at(), exit_at(0, "23:00:00", 1, "01:00:00"), exit_at(2, "09:00:00", 2, "11:00:00")]
    row = create(scene, duty_assignment=placement(scene, intervals))
    status = EmployeeStatus.objects.get(pk=row["id"])
    status.terminate_early(timezone.localdate(), "Завершено")
    status.refresh_from_db()
    assert status.duty_assignment.get("intervals") == intervals
    found = roster(scene).data["results"][0]
    assert found["placement"]["intervals"] == [intervals[0], exit_at(0, "23:00:00", 1, "00:00:00")]
    assert roster(scene, date=(timezone.localdate() + timedelta(days=1)).isoformat()).data["results"] == []


def test_extension_does_not_repeat_or_invent_exits(scene):
    row = create(scene, end=0, duty_assignment=placement(scene, [exit_at()]))
    status = EmployeeStatus.objects.get(pk=row["id"])
    status.extend(timezone.localdate() + timedelta(days=2))
    found = roster(scene, date=(timezone.localdate() + timedelta(days=2)).isoformat()).data["results"][0]
    assert found["placement"].get("intervals") == [exit_at()]


def test_legacy_unknown_and_explicit_empty_schedule_remain_distinct(scene):
    row = create(scene, duty_assignment=placement(scene, []))
    assert row["duty_assignment"].get("intervals") == []
    assert roster(scene).data["results"][0]["placement"]["intervals"] == []


def test_department_reader_preserves_exact_schedule_and_scope(scene):
    from organization_management.apps.operations.status_types import StatusType
    scene["own"].division_type = "department"
    scene["own"].save()
    StatusType.objects.get_or_create(code="IN_SERVICE", defaults={
        "name": "В строю", "priority": 10000, "report_column_code": "IN_SERVICE"})
    StatusType.objects.filter(code="DUTY").update(report_column_code="ON_DUTY")
    row = create(scene, duty_assignment=placement(scene, [exit_at()]))
    response = roster(scene, source="employee_status", department_id=str(scene["own"].pk))
    assert response.status_code == 200, response.data
    assert response.data["scope"]["source"] == "employee_status"
    assert response.data["results"][0]["placement"].get("intervals") == [exit_at()]
    assert response.data["results"][0]["status_id"] == row["id"]
