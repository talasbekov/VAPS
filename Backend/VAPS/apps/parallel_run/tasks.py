"""Story 12.6 — Celery wrapper for the parallel-run diff catch-up job (6.9).

Bare call, no ``today`` argument — see apps/operations/statuses/tasks.py's
docstring for the same reasoning (both services default identically).
Additive alongside the existing systemd timer (deploy/contour-stand/
systemd/vaps-parallel-run-diff.timer, 7.0): registering the same idempotent,
advisory-locked service here is not a replacement for it — a dual trigger
is safe by construction, not by operator discipline.
"""

from celery import shared_task

from apps.parallel_run.services import run_parallel_run_diff


@shared_task(name="apps.parallel_run.tasks.parallel_run_diff_task")
def parallel_run_diff_task():
    run_parallel_run_diff()
