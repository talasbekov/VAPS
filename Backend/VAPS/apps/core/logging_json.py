"""Story 13.6 — structured JSON log formatter for the errors journal.

Stdlib only (``json`` + ``logging``) — no ``python-json-logger``/``structlog``
dependency added (research at create-story confirmed neither is installed).

``request_id`` is read from ``apps.core.middleware.get_request_id()`` — the
SAME contextvar ``apps/core/api/exception_handler.py``'s ``_request_id()``
already uses for the §36 HTTP error envelope, not from the ``LogRecord``
itself (a log call can happen outside any HTTP request — e.g. a management
command or Celery task — where the contextvar correctly returns ``""``,
mirroring ``RequestContextMiddleware``'s own empty-context default).
"""

import json
import logging
from zoneinfo import ZoneInfo

from django.conf import settings

from apps.core.clock import Clock
from apps.core.middleware import get_request_id


class RequestJsonFormatter(logging.Formatter):
    """Renders each ``LogRecord`` as one JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": Clock.now()
            .astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
            .isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": get_request_id() or None,
            "exception": (
                self.formatException(record.exc_info) if record.exc_info else None
            ),
        }
        return json.dumps(payload, ensure_ascii=False)
