"""Глобальная политика DRF закрывает новые ручки по умолчанию (Plane №976).

Дефект: при ``DEFAULT_PERMISSION_CLASSES = AllowAny`` достаточно забыть
``permission_classes`` в новом ViewSet — и он рождается публичным. Сам
runtime-default проверяем напрямую: конкретные прикладные ViewSet обязаны
иметь возможность объявлять ту же политику локально, не делая системный пин
вакуумным.

Публичную схему проверяем рядом, чтобы закрытие default не превратило
fail-closed в запрет инструментов контракта. Публичность token/refresh уже
проверяют ``test_jwt_carries_no_role`` и ``test_token_refresh_rotates``.
"""

import pytest
from rest_framework.permissions import IsAuthenticated
from rest_framework.settings import api_settings
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_drf_runtime_default_is_fail_closed():
    """Мутация default на ``AllowAny`` должна покраснить этот прямой пин."""
    assert api_settings.DEFAULT_PERMISSION_CLASSES == [IsAuthenticated]


def test_the_api_schema_remains_public():
    response = APIClient().get("/api/schema/?format=json")

    assert response.status_code == 200, response.content


def test_drf_sensitive_api_endpoints_are_not_public():
    """Список ключевых защищённых ручек остаётся под fail-closed по умолчанию."""
    protected_paths = (
        "/api/operations/status-types/",
        "/api/core/divisions/",
        "/api/core/service-employees/",
        "/api/ops/strength-report/",
        "/api/reports/reports/",
        "/api/audit/logs/",
        "/api/statuses/",
        "/api/statuses/types/",
    )

    for path in protected_paths:
        response = APIClient().get(path)
        assert response.status_code == 401, (path, response.status_code, response.content)
