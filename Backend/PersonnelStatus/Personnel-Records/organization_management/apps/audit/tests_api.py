import datetime

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from organization_management.apps.audit.domain.models import AuditLog
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)


class AuditLogAPITest(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.user1 = User.objects.create_user(username='testuser1', password='password')
        cls.user2 = User.objects.create_user(username='testuser2', password='password')

        cls.log1 = AuditLog.objects.create(user=cls.user1, action_type='CREATE', ip_address='127.0.0.1')
        cls.log2 = AuditLog.objects.create(user=cls.user2, action_type='UPDATE', ip_address='127.0.0.2')
        cls.log3 = AuditLog.objects.create(user=cls.user1, action_type='DELETE', ip_address='127.0.0.1')

        cls.ts1 = timezone.make_aware(datetime.datetime(2025, 1, 1, 12, 0, 0))
        cls.ts2 = timezone.make_aware(datetime.datetime(2025, 1, 2, 12, 0, 0))
        cls.ts3 = timezone.make_aware(datetime.datetime(2025, 1, 3, 12, 0, 0))
        AuditLog.objects.filter(id=cls.log1.id).update(timestamp=cls.ts1)
        AuditLog.objects.filter(id=cls.log2.id).update(timestamp=cls.ts2)
        AuditLog.objects.filter(id=cls.log3.id).update(timestamp=cls.ts3)

    def setUp(self):
        self.client, _ = client_for(
            f"audit-api-reader-{self._testMethodName}",
            "AUDIT_API_READER", ["audit.view"],
        )

    def test_audit_permission_is_required_before_list_or_detail_lookup(self):
        api = APIClient()
        api.force_authenticate(user=self.user1)

        list_response = api.get('/api/audit/logs/')
        existing = api.get(f'/api/audit/logs/{self.log1.pk}/')
        missing = api.get('/api/audit/logs/999999999/')

        self.assertEqual(list_response.status_code, 403)
        self.assertEqual(existing.status_code, 403)
        self.assertEqual(missing.status_code, 403)
        self.assertEqual(existing.json(), missing.json())

    def test_scoped_audit_permission_still_opens_the_flat_journal(self):
        division = Division.objects.create(
            name="Область аудитора", code="AUDIT-API-SCOPE",
            division_type=Division.DivisionType.DEPARTMENT,
        )
        api, _ = client_for(
            "audit-api-scoped-reader", "AUDIT_API_SCOPED_READER",
            ["audit.view"], division.pk,
        )

        response = api.get('/api/audit/logs/')
        detail = api.get(f'/api/audit/logs/{self.log2.pk}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 3)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['id'], self.log2.pk)

    def test_list_audit_logs(self):
        url = '/api/audit/logs/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 3)

    def test_filter_by_user(self):
        url = f'/api/audit/logs/?user={self.user2.id}'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['user'], 'testuser2')

    def test_filter_by_action_type(self):
        url = '/api/audit/logs/?action_type=DELETE'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['action_type'], 'DELETE')

    def test_filter_by_ip_address(self):
        url = '/api/audit/logs/?ip_address=127.0.0.2'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)

    def test_filter_by_timestamp_gte(self):
        url = f'/api/audit/logs/?timestamp__gte=2025-01-02T00:00:00Z'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 2)

    def test_sorting_by_timestamp_ascending(self):
        url = '/api/audit/logs/?ordering=timestamp'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['action_type'], 'CREATE')

    def test_default_sorting_is_timestamp_descending(self):
        url = '/api/audit/logs/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['action_type'], 'DELETE')
