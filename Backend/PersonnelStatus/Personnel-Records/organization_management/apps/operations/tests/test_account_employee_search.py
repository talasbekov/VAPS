"""The account registry searches the person an administrator sees, not just login fields."""
import pytest
from django.contrib.auth import get_user_model

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.support import client_for

pytestmark = pytest.mark.django_db
ROOT = "/api/operations/accounts/"


@pytest.mark.parametrize("query", ["Мусахан Улан", "улан   мусах", "  Мусахан  "])
def test_account_search_matches_words_across_login_name_fields(query):
    client, _ = client_for("search_admin", "SEARCH_ADMIN", ["admin.roles"])
    found = get_user_model().objects.create_user(username="officer_named", last_name="Мусахан", first_name="Улан")
    get_user_model().objects.create_user(username="other_named", last_name="Другой", first_name="Улан")
    response = client.get(ROOT, {"search": query})
    assert response.status_code == 200, response.content
    assert [row["id"] for row in response.json()["results"]] == [found.pk]


@pytest.mark.parametrize("query", ["Мейрам Еламан", "Еламан Мейрам", "Мейрамович", "P-83425"])
def test_account_search_matches_linked_employee_even_when_account_name_is_empty(query):
    client, _ = client_for("linked_search_admin", "LINKED_SEARCH_ADMIN", ["admin.roles"])
    found = get_user_model().objects.create_user(username="imported_83425")
    Employee.objects.create(user=found, personnel_number="P-83425", last_name="Мейрам", first_name="Еламан", middle_name="Мейрамович")
    get_user_model().objects.create_user(username="unrelated_account")
    response = client.get(ROOT, {"search": query})
    assert response.status_code == 200, response.content
    assert [row["id"] for row in response.json()["results"]] == [found.pk]
    assert response.json()["results"][0]["employee_name"]


def test_account_search_keeps_login_email_and_requires_every_word():
    client, _ = client_for("login_search_admin", "LOGIN_SEARCH_ADMIN", ["admin.roles"])
    found = get_user_model().objects.create_user(username="named.login", email="mail@example.test", first_name="Асет")
    for query in ["named.log", "mail@example.test", "named.login Асет"]:
        response = client.get(ROOT, {"search": query})
        assert response.status_code == 200
        assert [row["id"] for row in response.json()["results"]] == [found.pk]
    assert client.get(ROOT, {"search": "named.login Другой"}).json()["count"] == 0


@pytest.mark.parametrize("path", [ROOT, ROOT + "employee-options/"])
def test_employee_search_still_requires_global_account_administration(path):
    client, _ = client_for("denied_search")
    response = client.get(path, {"search": "Мусахан"})
    assert response.status_code == 403
