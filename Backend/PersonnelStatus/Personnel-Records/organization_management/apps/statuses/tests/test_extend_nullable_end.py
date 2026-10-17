"""An imported/open-ended active status must not crash or become time-limited on extend."""
from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.models import EmployeeStatus, StatusChangeHistory
from organization_management.apps.statuses.tests.test_status_writes_require_status_manage import world, head

pytestmark = pytest.mark.django_db


def active_status(world, end_date=None):
    return EmployeeStatus.objects.create(
        employee=world["people"]["own"],
        status_type=EmployeeStatus.StatusType.IN_SERVICE if end_date is None else EmployeeStatus.StatusType.VACATION,
        start_date=timezone.localdate(), end_date=end_date,
    )


@pytest.mark.parametrize("entry", ["model", "service", "api"])
def test_open_ended_status_cannot_be_extended_or_silently_shortened(world, head, entry):
    record = active_status(world)
    before = EmployeeStatus.objects.values().get(pk=record.pk)
    history = list(StatusChangeHistory.objects.filter(status=record).order_by("pk").values())
    new_end = timezone.localdate() + timedelta(days=10)
    if entry == "api":
        head.raise_request_exception = False
        response = head.post(f"/api/statuses/statuses/{record.pk}/extend/",
                             {"new_end_date": new_end.isoformat()}, format="json")
        assert response.status_code == 400, response.content[:300]
        assert "без даты окончания" in response.data["error"]
    else:
        with pytest.raises(ValidationError, match="без даты окончания"):
            if entry == "model":
                record.extend(new_end)
            else:
                StatusApplicationService().extend_status(record.pk, new_end)
    assert EmployeeStatus.objects.values().get(pk=record.pk) == before
    assert list(StatusChangeHistory.objects.filter(status=record).order_by("pk").values()) == history


@pytest.mark.parametrize("days", [1, 5, 10])
def test_finite_extension_still_requires_later_end_and_records_history(world, head, days):
    old_end = timezone.localdate() + timedelta(days=5)
    record = active_status(world, old_end)
    before = EmployeeStatus.objects.values().get(pk=record.pk)
    history_count = StatusChangeHistory.objects.filter(status=record).count()
    new_end = timezone.localdate() + timedelta(days=days)
    response = head.post(f"/api/statuses/statuses/{record.pk}/extend/",
                         {"new_end_date": new_end.isoformat()}, format="json")
    assert response.status_code == (200 if days > 5 else 400), response.data
    record.refresh_from_db()
    if days > 5:
        assert record.end_date == new_end
        change = StatusChangeHistory.objects.filter(status=record).order_by("pk").last()
        assert change.change_type == StatusChangeHistory.ChangeType.EXTENDED
        assert change.old_value == str(old_end)
        assert change.new_value == str(new_end)
        assert StatusChangeHistory.objects.filter(status=record).count() == history_count + 1
    else:
        assert EmployeeStatus.objects.values().get(pk=record.pk) == before
        assert StatusChangeHistory.objects.filter(status=record).count() == history_count
