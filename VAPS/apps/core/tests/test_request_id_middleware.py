"""Story 4.3 — RequestContextMiddleware + request_id contextvar.

Unit tests drive the middleware directly (RequestFactory); the end-to-end test
runs through the FULL middleware + DRF stack and asserts the §36 error envelope
carries the request's request_id (the core AC of story 4.3).
"""

import pytest
from django.core.management import call_command
from django.http import HttpResponse
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.core.middleware import (
    RequestContextMiddleware,
    get_request_context,
    get_request_id,
)


def _run(request):
    """Invoke the middleware, capturing the context visible mid-request."""
    seen = {}

    def get_response(req):
        seen["ctx"] = get_request_context()
        seen["request_id_attr"] = req.request_id
        return HttpResponse("ok")

    response = RequestContextMiddleware(get_response)(request)
    return seen, response


def test_generates_request_id_when_header_absent():
    seen, response = _run(RequestFactory().get("/"))
    assert seen["ctx"].request_id  # non-empty generated id
    assert seen["request_id_attr"] == seen["ctx"].request_id
    assert response["X-Request-Id"] == seen["ctx"].request_id


def test_uses_incoming_x_request_id_header():
    seen, response = _run(RequestFactory().get("/", HTTP_X_REQUEST_ID="trace-42"))
    assert seen["ctx"].request_id == "trace-42"
    assert response["X-Request-Id"] == "trace-42"


def test_captures_ip_and_user_agent():
    request = RequestFactory().get(
        "/", REMOTE_ADDR="10.1.2.3", HTTP_USER_AGENT="pytest-UA"
    )
    seen, _ = _run(request)
    assert seen["ctx"].ip_address == "10.1.2.3"
    assert seen["ctx"].user_agent == "pytest-UA"


def test_context_reset_after_request():
    _run(RequestFactory().get("/"))
    # Outside the request the context is empty again — no leak across requests.
    assert get_request_context().request_id == ""
    assert get_request_id() == ""


def test_request_id_truncated_to_field_length():
    seen, _ = _run(RequestFactory().get("/", HTTP_X_REQUEST_ID="x" * 250))
    assert len(seen["ctx"].request_id) == 100  # audit_logs.request_id max_length


@pytest.mark.parametrize("raw", ["   ", "trace\r\nEvil: 1", "tab\tctl", "юникод"])
def test_unsafe_or_blank_request_id_is_replaced(raw):
    # blank/whitespace, CRLF/control, and non-ascii client ids are rejected in
    # favour of a generated one — safe to store and reflect (no BadHeaderError).
    seen, response = _run(RequestFactory().get("/", HTTP_X_REQUEST_ID=raw))
    rid = seen["ctx"].request_id
    assert rid and rid == seen["request_id_attr"]
    assert rid != raw and rid != raw.strip()
    assert rid.isascii() and rid.isprintable()
    assert response["X-Request-Id"] == rid  # set without raising BadHeaderError


@pytest.mark.django_db
def test_envelope_carries_request_id_end_to_end():
    # Full stack: middleware sets request_id → 403 from the RBAC gate → §36
    # exception handler renders it into the envelope (request_id no longer null).
    call_command("seed_operations")  # "nobody" has no role → 403
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="nobody", HTTP_X_REQUEST_ID="trace-e2e")
    response = client.get("/api/operations/roles/")
    assert response.status_code == 403
    body = response.json()
    assert body["request_id"] == "trace-e2e"  # not null; echoes the header
