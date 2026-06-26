"""Story 4.1 — AuditLog model: every field round-trips, db_table, UUID pk, JSONB."""

import uuid
from datetime import datetime, timezone

import pytest
from django.db import IntegrityError, transaction

from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db

_AFTER = {"status_type_code": "VACATION", "date_start": "2026-07-01"}
_TS = datetime(2026, 6, 26, 12, 0, tzinfo=timezone.utc)


def _make(**overrides):
    data = {
        "actor_user_id": "op-7",
        "action": "STATUS_CREATED",
        "entity_type": "employee_status",
        "entity_id": uuid.uuid4(),
        "old_value": None,
        "new_value": _AFTER,
        "reason": "приказ №7",
        "request_id": "req-abc-123",
        "ip_address": "10.0.0.5",
        "user_agent": "Mozilla/5.0",
        # created_at is required (no auto_now_add) — the write service (4.3)
        # injects Clock.now(); here we pass it explicitly.
        "created_at": _TS,
    }
    data.update(overrides)
    return AuditLog.objects.create(**data)


def test_all_fields_round_trip():
    log = _make()
    fetched = AuditLog.objects.get(pk=log.pk)
    assert isinstance(fetched.id, uuid.UUID)
    assert fetched.actor_user_id == "op-7"
    assert fetched.action == "STATUS_CREATED"
    assert fetched.entity_type == "employee_status"
    assert fetched.entity_id == log.entity_id
    assert fetched.old_value is None
    assert fetched.new_value == _AFTER  # JSONB round-trip
    assert fetched.reason == "приказ №7"
    assert fetched.request_id == "req-abc-123"
    assert fetched.ip_address == "10.0.0.5"
    assert fetched.user_agent == "Mozilla/5.0"
    assert fetched.created_at == _TS


def test_db_table_is_audit_logs():
    assert AuditLog._meta.db_table == "audit_logs"


def test_jsonb_values_are_nullable():
    log = _make(old_value=None, new_value=None)
    fetched = AuditLog.objects.get(pk=log.pk)
    assert fetched.old_value is None
    assert fetched.new_value is None


def test_created_at_required_no_auto_default():
    """created_at carries NO auto_now_add / DB default (ARCH-DATA-022): omitting
    it must fail loudly so the write service (4.3) is forced to inject Clock.now().
    Pins the invariant — a future auto_now_add/default would pass the other tests
    while silently breaking the Clock-enforced audit time (models.py docstring)."""
    data = {
        "actor_user_id": "op-7",
        "action": "STATUS_CREATED",
        "entity_type": "employee_status",
        "entity_id": uuid.uuid4(),
        "new_value": _AFTER,
        "ip_address": "10.0.0.5",
        # created_at deliberately omitted — there is no auto_now_add / default.
    }
    with pytest.raises(IntegrityError), transaction.atomic():
        AuditLog.objects.create(**data)
