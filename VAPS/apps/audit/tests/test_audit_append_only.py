"""Story 4.2 — append-only `audit_logs`: trigger rejects UPDATE/DELETE/TRUNCATE.

Enforced by a PostgreSQL ``BEFORE UPDATE/DELETE/TRUNCATE`` trigger (migration
``audit/0002``), NOT by REVOKE: the app connects as the table owner (``vaps``),
and a PostgreSQL owner bypasses REVOKE — only the trigger fires for every role.
The trigger raises with ``ERRCODE = restrict_violation`` (SQLSTATE 23001, class
23) so Django surfaces it as ``IntegrityError`` (consistent with the 3.x
exclusion-constraint tests). INSERT (append) is deliberately NOT blocked.
"""

import uuid
from datetime import datetime, timezone

import pytest
from django.db import IntegrityError, connection, transaction

from apps.audit.models import AuditLog

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(
        connection.vendor != "postgresql",
        reason="append-only is enforced by a PostgreSQL trigger (story 4.2)",
    ),
]

_TS = datetime(2026, 6, 26, 12, 0, tzinfo=timezone.utc)


def _make(**overrides):
    data = {
        "actor_user_id": "op-7",
        "action": "STATUS_CREATED",
        "entity_type": "employee_status",
        "entity_id": uuid.uuid4(),
        "new_value": {"status_type_code": "VACATION"},
        "ip_address": "10.0.0.5",
        "created_at": _TS,
    }
    data.update(overrides)
    return AuditLog.objects.create(**data)


def test_update_via_raw_sql_rejected():
    log = _make(action="STATUS_CREATED")
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    "UPDATE audit_logs SET action = %s WHERE id = %s",
                    ["HACKED", str(log.id)],
                )
    assert "append-only" in str(excinfo.value).lower()
    assert AuditLog.objects.get(pk=log.pk).action == "STATUS_CREATED"


def test_update_via_orm_rejected():
    log = _make(action="STATUS_CREATED")
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            AuditLog.objects.filter(pk=log.pk).update(action="HACKED")
    assert "append-only" in str(excinfo.value).lower()
    assert AuditLog.objects.get(pk=log.pk).action == "STATUS_CREATED"


def test_delete_via_raw_sql_rejected():
    log = _make()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("DELETE FROM audit_logs WHERE id = %s", [str(log.id)])
    assert "append-only" in str(excinfo.value).lower()
    assert AuditLog.objects.filter(pk=log.pk).exists()


def test_delete_via_orm_rejected():
    log = _make()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            AuditLog.objects.filter(pk=log.pk).delete()
    assert "append-only" in str(excinfo.value).lower()
    assert AuditLog.objects.filter(pk=log.pk).exists()


def test_insert_still_allowed():
    # append-only blocks UPDATE/DELETE/TRUNCATE, NOT INSERT (append must work).
    log = _make(action="STATUS_EXTENDED")
    assert AuditLog.objects.filter(pk=log.pk, action="STATUS_EXTENDED").exists()


def test_truncate_rejected():
    _make()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("TRUNCATE TABLE audit_logs")
    assert "append-only" in str(excinfo.value).lower()
    assert AuditLog.objects.exists()
