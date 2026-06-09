from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from organization_management.apps.divisions.models import Division

DivisionType = Division.DivisionType


class DivisionViewSetTest(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='testuser', is_staff=True)
        self.client.force_authenticate(user=self.user)
        # `parent` is the real FK name; `code` is unique; enum values are lowercase.
        self.company = Division.objects.create(
            name='Test Company',
            division_type=DivisionType.ORGANIZATION,
            code='COMPANY',
        )
        self.division = Division.objects.create(
            name='Test Division',
            division_type=DivisionType.DEPARTMENT,
            parent=self.company,
            code='DEPT',
        )

    def test_list_divisions(self):
        # The viewset lives at /api/divisions/divisions/ and the list is paginated.
        response = self.client.get('/api/divisions/divisions/')
        self.assertEqual(response.status_code, 200)
        # setUp created two divisions (company + child).
        self.assertEqual(response.data['count'], 2)

    def test_create_division(self):
        data = {
            'name': 'New Division',
            'division_type': DivisionType.DEPARTMENT,
            'parent': self.company.id,
            'code': 'DEPT2',
        }
        response = self.client.post('/api/divisions/divisions/', data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Division.objects.count(), 3)
