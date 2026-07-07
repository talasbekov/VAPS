"""Story 4.3 — audit.services.record(): the single audit write point.

Proves the seam: request_id / IP / user_agent are read from the request-context
contextvar (set by the middleware), NOT passed as parameters; created_at flows
through Clock; outside a request, sentinels apply; an empty actor is rejected.
"""

import uuid
from datetime import datetime, timezone

import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from apps.audit.models import AuditLog
from apps.audit.services import record
from apps.core import clock
from apps.core.middleware import RequestContextMiddleware

pytestmark = pytest.mark.django_db

_FROZEN = datetime(2026, 6, 26, 9, 30, tzinfo=timezone.utc)


def _in_request(factory_request, fn):
    """Run fn() inside the middleware so the request-context contextvar is set."""
    holder = {}

    def get_response(req):
        holder["result"] = fn()
        return HttpResponse("ok")

    RequestContextMiddleware(get_response)(factory_request)
    return holder["result"]


def test_record_reads_request_context_and_clock():
    eid = uuid.uuid4()
    request = RequestFactory().post(
        "/x",
        HTTP_X_REQUEST_ID="req-77",
        REMOTE_ADDR="10.0.0.9",
        HTTP_USER_AGENT="agent/1.0",
    )
    with clock.override(_FROZEN):
        log = _in_request(
            request,
            lambda: record(
                actor="op-7",
                action="STATUS_CREATED",
                entity_type="employee_status",
                entity_id=eid,
                old_value=None,
                new_value={"status_type_code": "VACATION"},
                reason="приказ №7",
            ),
        )
    fetched = AuditLog.objects.get(pk=log.pk)
    assert fetched.actor_user_id == "op-7"
    assert fetched.action == "STATUS_CREATED"
    assert fetched.entity_type == "employee_status"
    assert fetched.entity_id == eid
    assert fetched.old_value is None
    assert fetched.new_value == {"status_type_code": "VACATION"}  # JSONB round-trip
    assert fetched.reason == "приказ №7"
    # request-scoped infra read from the contextvar, NOT passed as params:
    assert fetched.request_id == "req-77"
    assert fetched.ip_address == "10.0.0.9"
    assert fetched.user_agent == "agent/1.0"
    # created_at flows through the single controllable clock (ARCH-DATA-022):
    assert fetched.created_at == _FROZEN


def test_record_outside_request_uses_sentinels():
    # System / Celery path: no active request context. ip_address is NOT NULL
    # (§4.6) → sentinel "0.0.0.0"; request_id / user_agent default to "".
    with clock.override(_FROZEN):
        log = record(
            actor="SYSTEM",
            action="STATUS_COMPLETED",
            entity_type="employee_status",
            entity_id=uuid.uuid4(),
        )
    fetched = AuditLog.objects.get(pk=log.pk)
    assert fetched.request_id == ""
    assert fetched.ip_address == "0.0.0.0"
    assert fetched.user_agent == ""
    assert fetched.created_at == _FROZEN


def test_record_requires_non_empty_actor():
    with pytest.raises(ValueError):
        record(
            actor="",
            action="STATUS_CREATED",
            entity_type="employee_status",
            entity_id=uuid.uuid4(),
        )
