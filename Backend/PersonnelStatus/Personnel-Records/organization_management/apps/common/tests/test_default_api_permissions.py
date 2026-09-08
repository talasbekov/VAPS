"""Глобальная политика DRF закрывает новые ручки по умолчанию (Plane №976).

Дефект: при ``DEFAULT_PERMISSION_CLASSES = AllowAny`` достаточно забыть
``permission_classes`` в новом ViewSet — и он рождается публичным. Реестр
отчётов здесь служит настоящим зарегистрированным маршрутом без локального
класса прав: до исправления аноним получает 200 с пустым списком.

Публичную схему проверяем рядом, чтобы закрытие default не превратило
fail-closed в запрет инструментов контракта. Публичность token/refresh уже
проверяют ``test_jwt_carries_no_role`` и ``test_token_refresh_rotates``.
"""

import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_a_viewset_without_a_local_policy_is_closed_to_anonymous_users():
    """Мутация на ``AllowAny`` должна вернуть здесь 200 и покраснить пробу."""
    response = APIClient().get("/api/reports/reports/")

    assert response.status_code == 401, response.content


def test_the_api_schema_remains_public():
    response = APIClient().get("/api/schema/?format=json")

    assert response.status_code == 200, response.content
