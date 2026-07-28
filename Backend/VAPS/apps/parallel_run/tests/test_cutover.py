"""Story 7.10/AC-1/AC-3 — рунбук как код: execute_cutover/rollback."""

from datetime import date

import pytest

from apps.core import parallel_run_mode
from apps.parallel_run.cutover import execute_cutover, rollback
from apps.parallel_run.exit_criterion import EXIT_CRITERION_GREEN_DAYS
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


def test_execute_cutover_rejected_when_exit_criterion_not_met():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS - 1)

    with pytest.raises(ValueError, match="exit criterion не выполнен"):
        execute_cutover(actor="bratan", frozen_suite_green=True)

    assert parallel_run_mode.is_cutover_complete() is False


def test_execute_cutover_rejected_when_frozen_suite_not_green():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS)

    with pytest.raises(ValueError, match="exit criterion не выполнен"):
        execute_cutover(actor="bratan", frozen_suite_green=False)


def test_execute_cutover_succeeds_when_criterion_met():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS)

    execute_cutover(actor="bratan", frozen_suite_green=True)

    assert parallel_run_mode.is_cutover_complete() is True
    assert parallel_run_mode.is_enabled() is False


def test_rollback_reenables_mode():
    _seed_green_days(EXIT_CRITERION_GREEN_DAYS)
    execute_cutover(actor="bratan", frozen_suite_green=True)

    rollback(actor="bratan", deadline=date(2031, 1, 1))

    assert parallel_run_mode.is_cutover_complete() is False
    assert parallel_run_mode.is_enabled() is True
