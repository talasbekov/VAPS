from rest_framework.test import APITestCase
from django.contrib.auth.models import User

from organization_management.apps.notifications.models import Notification


class NotificationAPITest(APITestCase):

    def setUp(self):
        self.user1 = User.objects.create_user(username='testuser1', password='password')
        self.user2 = User.objects.create_user(username='testuser2', password='password')

        self.notification1 = Notification.objects.create(
            recipient=self.user1,
            notification_type=Notification.NotificationType.SECONDMENT_REQUEST,
            title='Notification 1',
            message='This is for user 1'
        )
        Notification.objects.create(
            recipient=self.user2,
            notification_type=Notification.NotificationType.STATUS_CHANGED,
            title='Notification 2',
            message='This is for user 2'
        )

    def test_list_notifications_for_authenticated_user(self):
        """The list view returns only the authenticated user's notifications."""
        self.client.force_authenticate(user=self.user1)
        url = '/api/notifications/notifications/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['title'], 'Notification 1')

    def test_mark_notification_as_read(self):
        """A notification can be marked as read via the mark_read action."""
        self.client.force_authenticate(user=self.user1)
        self.assertFalse(self.notification1.is_read)

        url = f'/api/notifications/notifications/{self.notification1.id}/mark_read/'
        response = self.client.post(url)

        self.assertEqual(response.status_code, 204)
        self.notification1.refresh_from_db()
        self.assertTrue(self.notification1.is_read)

    def test_unauthenticated_user_cannot_access_api(self):
        """Unauthenticated users receive 401 Unauthorized."""
        url = '/api/notifications/notifications/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 401)
