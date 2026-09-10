from celery.schedules import crontab
from django.conf import settings


def test_daily_status_tasks_have_a_shipped_beat_schedule():
    schedule_by_task = {
        entry["task"]: entry
        for entry in settings.CELERY_BEAT_SCHEDULE.values()
        if entry["task"].startswith("statuses.")
    }

    assert schedule_by_task == {
        "statuses.apply_planned_statuses": {
            "task": "statuses.apply_planned_statuses",
            "schedule": crontab(hour=0, minute=1),
        },
        "statuses.complete_expired_statuses": {
            "task": "statuses.complete_expired_statuses",
            "schedule": crontab(hour=0, minute=15),
        },
        "statuses.send_upcoming_status_notifications": {
            "task": "statuses.send_upcoming_status_notifications",
            "schedule": crontab(hour=0, minute=30),
            "args": (7,),
        },
        "statuses.send_ending_status_notifications": {
            "task": "statuses.send_ending_status_notifications",
            "schedule": crontab(hour=0, minute=45),
            "args": (3,),
        },
    }
