"""Story 7.10/AC-1 — CLI: execute_cutover, rollback_cutover."""

import io
import time
from datetime import date

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core import parallel_run_mode
from apps.parallel_run.exit_criterion import EXIT_CRITERION_GREEN_DAYS
from apps.parallel_run.models import ParallelRunDay

pytestmark = pytest.mark.django_db


def run(*args):
    out = io.StringIO()
    call_command(*args, stdout=out)
    return out.getvalue()


def _seed_green_days(n):
    for i in range(n):
        ParallelRunDay.objects.create(
            run_date=date(2026, 6, 1 + i),
            status=ParallelRunDay.STATUS_OK,
            blocking_count=0,
            total_diffs=0,
        )


class TestExecuteCutoverCommand:
    def test_refuses_when_criterion_not_met(self):
        with pytest.raises(CommandError, match="exit criterion не выполнен"):
            call_command("execute_cutover", "--actor", "bratan")

    def test_succeeds_when_criterion_met(self):
        _seed_green_days(EXIT_CRITERION_GREEN_DAYS)

        output = run("execute_cutover", "--actor", "bratan", "--frozen-suite-green")

        assert "официальный канал расхода = VAPS" in output
        assert parallel_run_mode.is_cutover_complete() is True


class TestRollbackCommand:
    def test_invalid_deadline_raises(self):
        with pytest.raises(CommandError, match="невалидный --deadline"):
            call_command(
                "rollback_cutover", "--actor", "bratan", "--deadline", "not-a-date"
            )

    def test_rollback_reenables_mode(self):
        _seed_green_days(EXIT_CRITERION_GREEN_DAYS)
        run("execute_cutover", "--actor", "bratan", "--frozen-suite-green")

        output = run(
            "rollback_cutover", "--actor", "bratan", "--deadline", "2031-01-01"
        )

        assert "откат выполнен" in output
        assert parallel_run_mode.is_enabled() is True
        assert parallel_run_mode.is_cutover_complete() is False

    def test_rejects_rollback_when_cutover_never_completed(self):
        with pytest.raises(CommandError, match="cutover ещё не был завершён"):
            call_command(
                "rollback_cutover", "--actor", "bratan", "--deadline", "2031-01-01"
            )

    def test_rollback_is_a_single_fast_command(self):
        """AC-1: "< норматив" — код доказывает механическую часть: одна
        команда, доли секунды, не многошаговая импровизация."""
        _seed_green_days(EXIT_CRITERION_GREEN_DAYS)
        run("execute_cutover", "--actor", "bratan", "--frozen-suite-green")

        started = time.monotonic()
        run("rollback_cutover", "--actor", "bratan", "--deadline", "2031-01-01")
        elapsed = time.monotonic() - started

        assert elapsed < 5.0
