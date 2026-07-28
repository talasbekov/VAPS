"""Story 7.8/AC-1 — exit criterion: green_streak (reused from Story 6.9) +
frozen-suite-green external input."""

from datetime import date

import pytest

from apps.parallel_run.exit_criterion import EXIT_CRITERION_GREEN_DAYS, evaluate
from apps.parallel_run.models import ParallelRunDay

pytestmark = pytest.mark.django_db


def _seed_green_days(n):
    for i in range(n):
        ParallelRunDay.objects.create(
            run_date=date(2026, 6, 1 + i),
            status=ParallelRunDay.STATUS_OK,
            blocking_count=0,
            total_diffs=0,
        )


def test_below_streak_threshold_not_met_even_with_frozen_suite_green():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS - 1)

    status = evaluate(frozen_suite_green=True)

    assert status.green_streak == EXIT_CRITERION_GREEN_DAYS - 1
    assert status.met is False


def test_streak_met_but_frozen_suite_not_green_not_met():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS)

    status = evaluate(frozen_suite_green=False)

    assert status.green_streak == EXIT_CRITERION_GREEN_DAYS
    assert status.met is False


def test_streak_and_frozen_suite_green_both_met():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS)

    status = evaluate(frozen_suite_green=True)

    assert status.met is True
    assert status.green_days_required == EXIT_CRITERION_GREEN_DAYS
