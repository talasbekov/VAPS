"""Story 13.6 — RequestJsonFormatter + errors-journal wiring.

Unit tests drive the formatter directly against synthetic LogRecords;
the integration test attaches a REAL handler (this formatter, a temp file)
to the exact logger apps/core/api/exception_handler.py already logs
through on an unhandled exception, and runs the request THROUGH
RequestContextMiddleware so the contextvar RequestJsonFormatter reads is
live — proving the file's request_id matches the HTTP error envelope's,
not just that the formatter can serialize a hand-built record.
"""

import json
import logging
import sys

from django.http import HttpResponse
from django.test import RequestFactory

from apps.core.api.exception_handler import domain_exception_handler
from apps.core.logging_json import RequestJsonFormatter
from apps.core.middleware import RequestContextMiddleware


def _make_record(message="boom", exc_info=None):
    return logging.LogRecord(
        name="apps.core.api.exception_handler",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=exc_info,
    )


def test_formatter_emits_valid_json_with_expected_fields():
    record = _make_record()
    payload = json.loads(RequestJsonFormatter().format(record))
    assert set(payload) == {
        "timestamp",
        "level",
        "logger",
        "message",
        "request_id",
        "exception",
    }
    assert payload["level"] == "ERROR"
    assert payload["logger"] == "apps.core.api.exception_handler"
    assert payload["message"] == "boom"


def test_formatter_reads_request_id_from_contextvar_not_hardcoded():
    seen = {}

    def get_response(request):
        record = _make_record()
        seen["payload"] = json.loads(RequestJsonFormatter().format(record))
        return HttpResponse("ok")

    RequestContextMiddleware(get_response)(
        RequestFactory().get("/", HTTP_X_REQUEST_ID="trace-fmt-1")
    )
    assert seen["payload"]["request_id"] == "trace-fmt-1"


def test_formatter_request_id_none_outside_a_request():
    payload = json.loads(RequestJsonFormatter().format(_make_record()))
    assert payload["request_id"] is None


def test_formatter_includes_traceback_when_exc_info_present():
    try:
        raise ValueError("kaboom")
    except ValueError:
        record = _make_record(exc_info=sys.exc_info())
    payload = json.loads(RequestJsonFormatter().format(record))
    assert "ValueError: kaboom" in payload["exception"]


def test_formatter_exception_is_none_without_exc_info():
    payload = json.loads(RequestJsonFormatter().format(_make_record()))
    assert payload["exception"] is None


def test_unhandled_exception_writes_journal_entry_matching_envelope_request_id(
    tmp_path,
):
    # AC-4: a real unhandled exception through domain_exception_handler (the
    # SAME call site exception_handler.py already has, L175) writes a JSON
    # line whose request_id matches the one the §36 envelope would carry.
    log_path = tmp_path / "errors.log"
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setFormatter(RequestJsonFormatter())
    logger = logging.getLogger("apps.core.api.exception_handler")
    logger.addHandler(handler)
    logger.propagate = False
    try:
        seen = {}

        def get_response(request):
            # logger.exception() (exception_handler.py:175) reads
            # sys.exc_info() — only populated inside a real except block,
            # mirroring how DRF actually invokes the handler.
            try:
                raise RuntimeError("kaboom")
            except RuntimeError as exc:
                envelope = domain_exception_handler(exc, {"request": request})
            seen["envelope_request_id"] = envelope.data["request_id"]
            return HttpResponse("ok")

        RequestContextMiddleware(get_response)(
            RequestFactory().get("/", HTTP_X_REQUEST_ID="trace-500-1")
        )
    finally:
        logger.removeHandler(handler)
        handler.close()

    lines = [
        json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert len(lines) == 1
    assert lines[0]["request_id"] == "trace-500-1" == seen["envelope_request_id"]
    assert "RuntimeError: kaboom" in lines[0]["exception"]
