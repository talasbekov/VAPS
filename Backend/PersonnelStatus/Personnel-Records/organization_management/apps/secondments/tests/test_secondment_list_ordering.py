"""Legacy `/api/secondments/secondment-requests/` без ordering — Plane №1037.

Источник — TDD-прогон Plane №958: DRF предупреждал `UnorderedObjectListWarning`
на `SecondmentRequest.objects.all()`. Список пагинируется, а без полного
порядка одна и та же строка может прийти дважды или не прийти вовсе, если
между страницами кто-то создал ещё одну запись — планировщик PostgreSQL волен
раскладывать неупорядоченные строки по-своему.

Проба стережёт мутацией: снять `ordering` из `Meta` красит обе — прямую
проверку модели и проверку того, что список идёт «новые сверху» стабильно.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.secondments.models import SecondmentRequest

pytestmark = pytest.mark.django_db

URL = "/api/secondments/secondment-requests/"


@pytest.fixture
def api():
    client = APIClient()
    client.force_authenticate(get_user_model().objects.create_superuser(username="sec-order-admin"))
    return client


@pytest.fixture
def divisions():
    home = Division.objects.create(name="Дом ordering", code="ORD-HOME", division_type=Division.DivisionType.DIVISION)
    host = Division.objects.create(name="Приём ordering", code="ORD-HOST", division_type=Division.DivisionType.DIVISION)
    return home, host


def test_model_declares_a_full_ordering():
    """Полный порядок — свойство МОДЕЛИ, а не удачи вызывающего кода."""
    assert list(SecondmentRequest._meta.ordering) == ["-created_at", "-id"]


def test_list_is_newest_first_and_stable_across_calls(api, divisions):
    home, host = divisions
    created = [
        SecondmentRequest.objects.create(
            from_division=home,
            to_division=host,
            start_date="2026-09-01",
            end_date="2026-09-10",
        )
        for _ in range(3)
    ]

    first_call = [row["id"] for row in api.get(URL).json()["results"]]
    second_call = [row["id"] for row in api.get(URL).json()["results"]]

    assert first_call == second_call
    assert first_call == [row.id for row in reversed(created)]
