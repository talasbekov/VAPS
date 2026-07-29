"""Story 12.6 — Celery app instance (standard Django+Celery integration).

Broker/backend are VAPS_REDIS_URL-driven (config/settings.py), the SAME
Redis instance Channels already uses (architecture.md#L311 — "Redis is
only a broker, no cache is introduced"). autodiscover_tasks() finds each
app's tasks.py — no central task registry to keep in sync by hand.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("vaps")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
