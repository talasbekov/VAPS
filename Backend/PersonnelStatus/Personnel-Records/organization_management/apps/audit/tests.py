"""Model-level tests for the single audit implementation, ``AuditLog``.

These exercise the domain model directly (generic foreign key, payload, request
metadata). The generic target is a ``User`` row so the suite has no dependency
on app tables that lack migrations (e.g. divisions). End-to-end middleware/API
behaviour lives in tests_middleware.py and tests_api.py.
"""

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from organization_management.apps.audit.domain.models import AuditLog


class AuditLogModelTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="testuser", password="password")
        cls.target = User.objects.create_user(username="target", password="password")

    def test_create_audit_log(self):
        log_entry = AuditLog.objects.create(
            user=self.user,
            action_type="CREATE",
            target_object=self.target,
            payload={"details": "User created"},
            ip_address="127.0.0.1",
            user_agent="Test Client",
        )

        self.assertEqual(AuditLog.objects.count(), 1)
        self.assertEqual(log_entry.user, self.user)
        self.assertEqual(log_entry.action_type, "CREATE")
        self.assertEqual(log_entry.target_object, self.target)
        self.assertEqual(
            log_entry.content_type, ContentType.objects.get_for_model(self.target)
        )
        self.assertEqual(log_entry.object_id, self.target.id)
        self.assertEqual(log_entry.payload, {"details": "User created"})
        self.assertEqual(log_entry.ip_address, "127.0.0.1")
        self.assertEqual(log_entry.user_agent, "Test Client")
