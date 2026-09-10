from types import SimpleNamespace
from unittest.mock import patch

import pytest

from organization_management.apps.statuses.tasks import (
    apply_planned_statuses_task,
    complete_expired_statuses_task,
    send_ending_status_notifications_task,
    send_upcoming_status_notifications_task,
)


@pytest.mark.parametrize(
    ("task", "service_method"),
    [
        (apply_planned_statuses_task, "apply_planned_statuses"),
        (complete_expired_statuses_task, "complete_expired_statuses"),
    ],
)
def test_status_maintenance_task_propagates_service_failure(task, service_method):
    with patch(
        f"organization_management.apps.statuses.tasks."
        f"StatusApplicationService.{service_method}",
        side_effect=RuntimeError("status service unavailable"),
    ):
        with pytest.raises(RuntimeError, match="status service unavailable"):
            task()


@pytest.mark.parametrize(
    "task",
    [
        send_upcoming_status_notifications_task,
        send_ending_status_notifications_task,
    ],
)
def test_status_notification_scan_propagates_database_failure(task):
    with patch(
        "organization_management.apps.statuses.tasks.EmployeeStatus.objects.filter",
        side_effect=RuntimeError("statuses database unavailable"),
    ):
        with pytest.raises(RuntimeError, match="statuses database unavailable"):
            task()


@pytest.mark.parametrize(
    ("task", "notification_task"),
    [
        (
            send_upcoming_status_notifications_task,
            "send_upcoming_status_notification",
        ),
        (
            send_ending_status_notifications_task,
            "send_ending_status_notification",
        ),
    ],
)
def test_status_notification_scan_propagates_enqueue_failure(
    task,
    notification_task,
):
    status = SimpleNamespace(id=17)

    with (
        patch(
            "organization_management.apps.statuses.tasks."
            "EmployeeStatus.objects.filter"
        ) as statuses_filter,
        patch(
            f"organization_management.apps.statuses.tasks.{notification_task}.delay",
            side_effect=RuntimeError("notification broker unavailable"),
        ),
    ):
        statuses_filter.return_value.select_related.return_value = [status]

        with pytest.raises(RuntimeError, match="notification broker unavailable"):
            task()
