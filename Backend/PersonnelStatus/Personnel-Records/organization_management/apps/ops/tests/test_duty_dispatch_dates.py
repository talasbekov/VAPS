"""Arithmetic-safe API dates, without changing the normal planning horizon."""
import pytest
from datetime import date

from organization_management.apps.ops.api.views_duty_dispatch import QuerySerializer, CreateSerializer


@pytest.mark.parametrize("day", ["0001-01-01", "9999-12-31"])
@pytest.mark.parametrize("serializer", [QuerySerializer, CreateSerializer])
def test_dispatch_rejects_dates_that_overflow_calendar_window(day, serializer):
    data = {"employee_id": 1, "status_id": 1, "business_date": day,
            "start_time": "08:00", "end_time": "20:00", "placement": {"kind": "GROUP"}}
    form = serializer(data=data)
    assert not form.is_valid()
    assert "business_date" in form.errors


@pytest.mark.parametrize("day", ["0001-01-02", "9999-12-30", "2026-10-10"])
def test_normal_historical_and_future_dates_remain_valid(day):
    form = QuerySerializer(data={"business_date": day})
    assert form.is_valid(), form.errors


@pytest.mark.parametrize("day", [date.min, date.max])
def test_legacy_object_roster_bounds_have_no_dispatch_rows(day):
    from organization_management.apps.ops.duty_dispatch import object_roster
    assert object_roster(1, day, actor="test") == []
