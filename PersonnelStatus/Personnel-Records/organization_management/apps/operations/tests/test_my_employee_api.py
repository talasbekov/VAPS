"""GET /api/operations/my-employee/ — своя кадровая запись.

Зона: самообслуживание (право раздела не спрашивается) и ЧЕСТНЫЙ ответ на
отсутствие привязки `Employee.user`, которая на боевых учётках сплошь и рядом
пуста — сид её не делает.
"""
import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/operations/my-employee/"


def test_anonymous_is_denied():
    assert APIClient().get(URL).status_code == 403


def test_linked_account_gets_its_own_card():
    api, user = client_for("me-linked", "VIEWER", [])
    employee = Employee.objects.create(
        personnel_number="P-1",
        last_name="Абенов",
        first_name="Санжар",
        birth_date="1985-01-02",
        user=user,
    )
    response = api.get(URL)
    assert response.status_code == 200
    assert response.data["unlinked_reason"] is None
    assert response.data["employee"]["id"] == employee.pk
    assert response.data["employee"]["full_name"] == "Абенов Санжар"


def test_права_раздела_не_нужны():
    """Ни одного права — и всё равно своя запись видна: это самообслуживание."""
    api, user = client_for("me-no-perms", "NOBODY", [])
    Employee.objects.create(
        personnel_number="P-2",
        last_name="Ахметова",
        first_name="Сауле",
        birth_date="1990-03-04",
        user=user,
    )
    assert api.get(URL).data["employee"]["last_name"] == "Ахметова"


def test_unlinked_account_gets_a_reason_not_404():
    """Пустая привязка — 200 с причиной. 404 означал бы «нет такого адреса»."""
    api, _ = client_for("me-unlinked", "VIEWER", [])
    response = api.get(URL)
    assert response.status_code == 200
    assert response.data["employee"] is None
    assert "не связана с кадровой" in response.data["unlinked_reason"]


def test_чужая_карточка_не_подставляется_по_совпадению_фамилии():
    """Однофамилец без привязки не должен становиться «мной»."""
    api, user = client_for("me-namesake", "VIEWER", [])
    user.last_name = "Абенов"
    user.save(update_fields=["last_name"])
    Employee.objects.create(
        personnel_number="P-3",
        last_name="Абенов",
        first_name="Другой",
        birth_date="1980-05-06",
        user=None,
    )
    response = api.get(URL)
    assert response.data["employee"] is None


def test_соседняя_учётка_не_видит_чужую_запись():
    """Привязка одного не делает его записью другого."""
    api_one, user_one = client_for("me-one", "VIEWER", [])
    Employee.objects.create(
        personnel_number="P-4",
        last_name="Первый",
        first_name="Сотрудник",
        birth_date="1981-01-01",
        user=user_one,
    )
    api_two, _ = client_for("me-two", "VIEWER", [])
    assert api_two.get(URL).data["employee"] is None
    assert api_one.get(URL).data["employee"]["last_name"] == "Первый"
