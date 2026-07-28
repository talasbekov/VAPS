"""Story 7.8/AC-1 — дашборд зелёных дней: streak, дедлайн, эскалация.

Дедлайн превышен И критерий не выполнен -> CommandError (эскалация, не
молчание). Критерий выполнен -> зелёный вердикт даже после дедлайна.
"""

import io
from datetime import date

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core import clock, parallel_run_mode
from apps.parallel_run.exit_criterion import EXIT_CRITERION_GREEN_DAYS
from apps.parallel_run.models import ParallelRunDay

pytestmark = pytest.mark.django_db


def run(*args):
    out = io.StringIO()
    call_command("parallel_run_dashboard", *args, stdout=out)
    return out.getvalue()


def _seed_green_days(n):
    for i in range(n):
        ParallelRunDay.objects.create(
            run_date=date(2026, 6, 1 + i),
            status=ParallelRunDay.STATUS_OK,
            blocking_count=0,
            total_diffs=0,
        )


def test_requires_mode_enabled():
    with pytest.raises(CommandError, match="выключен"):
        call_command("parallel_run_dashboard")


def test_streak_below_threshold_no_escalation_before_deadline():
    parallel_run_mode.enable(actor="bratan", deadline=date(2030, 1, 1))
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS - 1)

    with clock.override(date(2026, 6, 1)):
        output = run()

    assert "пока не выполнен" in output


def test_deadline_exceeded_without_criterion_met_escalates():
    parallel_run_mode.enable(actor="bratan", deadline=date(2026, 1, 1))
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS - 1)

    with clock.override(date(2026, 6, 1)), pytest.raises(
        CommandError, match="ЭСКАЛАЦИЯ"
    ):
        run()


def test_criterion_met_is_green_even_past_deadline():
    parallel_run_mode.enable(actor="bratan", deadline=date(2026, 1, 1))
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS)

    with clock.override(date(2026, 6, 1)):
        output = run("--frozen-suite-green")

    assert "ВЫПОЛНЕН" in output
