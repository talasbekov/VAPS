"""Story 12.6 — Celery wrapper for the status-effects catch-up engine (3.12).

Bare call, no ``today`` argument: the service already defaults to
``Clock.today_local()`` internally, which is the only legitimate wall-clock
read in a real beat run (its own docstring — ``clock.override`` is a
ContextVar that does not cross into the worker process).
"""

from celery import shared_task

from apps.operations.statuses.services.catch_up import materialize_status_effects


@shared_task(name="apps.operations.statuses.tasks.materialize_status_effects_task")
def materialize_status_effects_task():
    materialize_status_effects()
