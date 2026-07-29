# Story 12.6 — standard Django+Celery integration: importing celery_app here
# ensures the Celery app is loaded whenever Django starts, so @shared_task
# decorators registered by config/celery.py's autodiscover_tasks() are
# always picked up.
from .celery import app as celery_app

__all__ = ("celery_app",)
