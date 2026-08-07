import pytest
from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division


@pytest.mark.django_db
class TestDivisionViewSetAPI:
    def test_get_division_list_unauthenticated(self):
        """Тест получения списка подразделений без аутентификации"""
        client = APIClient()
        url = reverse('division-list')
        response = client.get(url)
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_get_division_list_authenticated(self):
        """Список подразделений читается под аутентификацией.

        Кейс переписан, а не удалён вместе с остальным донорским легаси:
        падал он только на заведении пользователя — звал
        `create_user(role=1, division_assignment=...)`, поля донорской модели
        User, которых в стоковой auth.User нет. Сама проверка живая, и другого
        теста на чтение `division-list` под аутентификацией в наборе нет —
        удалив его, мы потеряли бы единственное покрытие ручки.
        """
        Division.objects.create(name="Test Division", division_type='OFFICE')
        user = User.objects.create_user(username='testuser', password='password')
        client = APIClient()
        client.force_authenticate(user=user)

        response = client.get(reverse('division-list'))

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) > 0
