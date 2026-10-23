"""Today's dashboard counts people using the same winner as personnel reports."""
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace

import pytest
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
ST = EmployeeStatus.StatusType
STATE = EmployeeStatus.StatusState


@pytest.fixture
def scene(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: datetime(2026, 10, 19, 7, tzinfo=dt_timezone.utc))
    today = timezone.localdate()
    for code, legacy, priority, column in (
        ("SICK_LEAVE", ST.SICK_LEAVE, 10, "SICK"),
        ("VACATION", ST.VACATION, 20, "VACATION"),
        ("IN_SERVICE", ST.IN_SERVICE, 999, "IN_SERVICE"),
    ):
        StatusType.objects.update_or_create(code=code, defaults={
            "name": code, "legacy_code": legacy, "priority": priority,
            "report_column_code": column,
        })
    division = Division.objects.create(name="Statistics own", code="statistics-own")
    child = Division.objects.create(name="Statistics child", code="statistics-child", parent=division)
    other = Division.objects.create(name="Statistics other", code="statistics-other")
    people = []
    for index, home in enumerate((division, child, other), 1):
        person = Employee.objects.create(
            id=9_007_199_254_740_990 + index, personnel_number=f"statistics-{index}",
            last_name="Statistics", first_name=str(index), hire_date=None,
        )
        StaffUnit.objects.create(division=home, employee=person, index=index)
        people.append(person)
    api, user = client_for("statistics-reader", "STATISTICS_READER", ("status.view",), division.pk)
    return SimpleNamespace(today=today, division=division, child=child, other=other,
                           people=people, api=api, user=user, service=StatusApplicationService())


def imported(scene, code=ST.SICK_LEAVE, person=None, **changes):
    """Imports can contain overlaps, nullable ends and stale state flags."""
    values = dict(employee=person or scene.people[0], status_type=code,
                  start_date=scene.today - timedelta(days=3),
                  end_date=scene.today + timedelta(days=5), state=STATE.ACTIVE)
    values.update(changes)
    return EmployeeStatus.objects.bulk_create([EmployeeStatus(**values)])[0]


def statistics(scene, **changes):
    values = dict(start_date=scene.today, end_date=scene.today,
                  division_ids=[str(scene.division.pk), str(scene.child.pk)])
    values.update(changes)
    return scene.service.get_absence_statistics(**values)


@pytest.mark.parametrize("changes", [
    {"state": STATE.CANCELLED},
    {"actual_end_date": datetime(2026, 10, 18).date()},
    {"end_date": datetime(2026, 10, 18).date()},
    {"start_date": datetime(2026, 10, 20).date(), "state": STATE.PLANNED},
])
def test_today_excludes_cancelled_expired_and_future_statuses(scene, changes):
    imported(scene, **changes)
    result = statistics(scene)
    assert result["staff_count"] == 2
    assert result["total_absences"] == 0
    assert sum(result["by_type"].values()) == 0


def test_today_counts_one_catalog_winner_per_employee(scene):
    imported(scene, ST.VACATION)
    imported(scene, "DUTY_DAILY")
    # Catalog edits must change the winning status, even for legacy aliases.
    StatusType.objects.filter(legacy_code=ST.VACATION).update(priority=900)
    StatusType.objects.filter(code="DUTY_DAILY").update(priority=5)
    result = statistics(scene)
    assert result["total_absences"] == 1
    assert result["by_type"]["DUTY_DAILY"] == 1
    assert result["by_type"][ST.VACATION] == 0
    assert sum(result["by_type"].values()) == 1


def test_today_active_return_wins_over_completed_absence_on_same_date(scene):
    imported(scene, state=STATE.COMPLETED, actual_end_date=scene.today)
    imported(scene, ST.IN_SERVICE, start_date=scene.today, end_date=None)
    result = statistics(scene)
    assert result["total_absences"] == 0
    assert sum(result["by_type"].values()) == 0


@pytest.mark.parametrize("code", ["DUTY_COMBAT", "DUTY_DAILY", "DUTY_OPERATIONAL", "SPECIAL_WATCH"])
def test_today_dynamic_catalog_breakdown_reconciles_with_total(scene, code):
    if code == "SPECIAL_WATCH":
        StatusType.objects.create(code=code, name="Special watch", priority=40, report_column_code="ON_DUTY")
    imported(scene, code, end_date=None)
    result = statistics(scene)
    assert result["total_absences"] == result["by_type"][code] == 1
    assert sum(result["by_type"].values()) == 1


@pytest.mark.parametrize("code", [ST.IN_SERVICE, "IN_SERVICE"])
def test_today_in_service_aliases_do_not_count_as_absence(scene, code):
    imported(scene, code, end_date=None)
    assert statistics(scene)["total_absences"] == 0


def test_today_catalog_aliases_share_one_breakdown_key(scene):
    imported(scene, "SICK_LEAVE")
    result = statistics(scene)
    assert result["by_type"][ST.SICK_LEAVE] == result["total_absences"] == 1
    assert sum(result["by_type"].values()) == 1


@pytest.mark.parametrize("in_catalog", [True, False])
def test_today_keeps_inactive_or_missing_imported_type_in_the_breakdown(scene, in_catalog):
    if in_catalog:
        StatusType.objects.create(code="OLD_WATCH", name="Old watch", priority=40,
                                  report_column_code="ON_DUTY", is_active=False)
    imported(scene, "OLD_WATCH")
    result = statistics(scene)
    assert result["by_type"]["OLD_WATCH"] == result["total_absences"] == 1
    assert sum(result["by_type"].values()) == 1


def test_today_scopes_include_children_but_never_another_division(scene):
    for person in scene.people:
        imported(scene, person=person)
    assert statistics(scene)["total_absences"] == 2
    assert statistics(scene, division_ids=[])["total_absences"] == 0
    assert statistics(scene, division_ids=[], division_id=scene.other.pk)["staff_count"] == 0
    subtree = statistics(scene, division_ids=None, division_id=str(scene.division.pk))
    assert subtree["total_absences"] == subtree["staff_count"] == 2
    global_result = statistics(scene, division_ids=None)
    assert global_result["total_absences"] == global_result["staff_count"] == 3


def test_today_keeps_inclusive_end_and_ignores_detached_status_rows(scene):
    imported(scene, end_date=scene.today)
    imported(scene, employee=None)
    # An orphan is not an employee, including in the global summary.
    result = statistics(scene, division_ids=None)
    assert result["total_absences"] == 1
    assert sum(result["by_type"].values()) == 1


def test_historical_period_preserves_row_counting_and_planned_overlap_contract(scene):
    earlier = scene.today - timedelta(days=2)
    imported(scene, state=STATE.CANCELLED)
    imported(scene, actual_end_date=earlier - timedelta(days=1))
    imported(scene, "DUTY_DAILY")
    result = statistics(scene, start_date=earlier, end_date=earlier)
    assert result["period"] == {"start_date": earlier, "end_date": earlier}
    assert result["total_absences"] == 3
    assert sum(result["by_type"].values()) == 3
