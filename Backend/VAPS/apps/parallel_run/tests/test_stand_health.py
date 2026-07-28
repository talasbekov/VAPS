"""Story 7.0 — health-маркер стенда: последнее ИСПОЛНЕНИЕ diff-джобы видимо
без auth, и error-статус джобы НЕ маскируется бланкетным "ok" (ревью-фикс:
исходная версия жёстко печатала top-level "status": "ok" независимо от
last_day.status — HTTP 200 == «эндпоинт достижим», не «джоба зелёная»)."""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.parallel_run.models import ParallelRunDay

pytestmark = pytest.mark.django_db


def test_health_no_runs_yet():
    client = APIClient()
    resp = client.get(reverse("parallel-run-health"))

    assert resp.status_code == 200
    assert resp.data == {
        "last_diff_run": None,
        "last_import_run": None,
        # Story 7.7/AC-2: default-off, 0 пилотных подразделений на пустой БД.
        # Story 7.8/AC-1: streak/deadline/exit_criterion_met на пустой БД.
        "parallel_run_mode": {
            "enabled": False,
            "pilot_division_count": 0,
            "green_streak": 0,
            "deadline": None,
            "exit_criterion_met": False,
        },
    }


def test_health_reflects_latest_run_by_date_not_insertion_order():
    ParallelRunDay.objects.create(
        run_date="2026-07-10", status="ok", blocking_count=0, total_diffs=2
    )
    latest = ParallelRunDay.objects.create(
        run_date="2026-07-20", status="error", blocking_count=1, total_diffs=5
    )

    client = APIClient()
    resp = client.get(reverse("parallel-run-health"))

    assert resp.status_code == 200
    assert resp.data["last_diff_run"]["run_date"] == "2026-07-20"
    assert resp.data["last_diff_run"]["status"] == "error"
    assert resp.data["last_diff_run"]["blocking_count"] == 1
    assert resp.data["last_diff_run"]["total_diffs"] == 5
    assert resp.data["last_diff_run"]["ran_at"] == latest.ran_at.isoformat()
    assert resp.data["last_import_run"] is None


def test_health_reflects_latest_execution_not_latest_business_date():
    """Догон/бэкфилл: джоба переисполняется за СТАРУЮ бизнес-дату ПОЗЖЕ, чем
    последний обычный прогон за более новую дату — «последний прогон» должен
    значить «последнее исполнение» (ran_at), не «максимальная run_date»."""
    newer_date_older_run = ParallelRunDay.objects.create(
        run_date="2026-07-20", status="ok", blocking_count=0, total_diffs=1
    )
    # Симулируем более позднее исполнение за более раннюю дату (backfill):
    # save() триггерит auto_now на ran_at, отодвигая его вперёд без изменения run_date.
    older_date_newer_run = ParallelRunDay.objects.create(
        run_date="2026-07-05", status="error", blocking_count=2, total_diffs=3
    )
    assert older_date_newer_run.ran_at >= newer_date_older_run.ran_at

    client = APIClient()
    resp = client.get(reverse("parallel-run-health"))

    assert resp.data["last_diff_run"]["run_date"] == "2026-07-05"
    assert resp.data["last_diff_run"]["status"] == "error"


def test_health_does_not_mask_job_error_behind_a_blanket_ok():
    """HTTP 200 (эндпоинт достижим) не должен читаться как «джоба зелёная» —
    нет top-level "status" поля, только вложенный last_diff_run.status."""
    ParallelRunDay.objects.create(
        run_date="2026-07-20", status="error", blocking_count=3, total_diffs=3
    )

    client = APIClient()
    resp = client.get(reverse("parallel-run-health"))

    assert resp.status_code == 200
    assert "status" not in resp.data
    assert resp.data["last_diff_run"]["status"] == "error"


def test_health_reflects_deadline_and_green_streak():
    """Story 7.8/AC-1: дедлайн и green_streak видны в health без похода в CLI."""
    from datetime import date

    from apps.core import parallel_run_mode

    ParallelRunDay.objects.create(
        run_date="2026-07-20", status="ok", blocking_count=0, total_diffs=0
    )
    parallel_run_mode.enable(actor="bratan", deadline=date(2030, 1, 1))

    client = APIClient()
    resp = client.get(reverse("parallel-run-health"))

    assert resp.data["parallel_run_mode"]["deadline"] == "2030-01-01"
    assert resp.data["parallel_run_mode"]["green_streak"] == 1
    assert resp.data["parallel_run_mode"]["exit_criterion_met"] is False


def test_health_requires_no_authentication():
    """Docker healthcheck has no JWT — endpoint must be reachable unauthenticated."""
    client = APIClient()
    resp = client.get(reverse("parallel-run-health"))
    assert resp.status_code == 200
