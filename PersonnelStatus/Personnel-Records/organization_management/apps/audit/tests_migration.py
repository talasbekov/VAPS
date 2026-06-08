"""Story 1.1 verification: the AuditLog table exists and accepts rows.

Scope is intentionally narrow — it exercises only the AuditLog model and its
own migration (audit_auditlog), not the wider audit stack (middleware/API),
which depends on migrations for other apps that are out of scope here.
"""
from django.db import connection
from django.test import TestCase

from organization_management.apps.audit.domain.models import AuditLog


class AuditLogMigrationTest(TestCase):
    def test_audit_auditlog_table_created(self):
        assert "audit_auditlog" in connection.introspection.table_names()

    def test_auditlog_row_persists(self):
        log = AuditLog.objects.create(
            action_type="CREATE",
            ip_address="127.0.0.1",
            payload={"field": "value"},
        )
        assert log.pk is not None
        assert AuditLog.objects.count() == 1
        assert AuditLog.objects.get(pk=log.pk).payload == {"field": "value"}
