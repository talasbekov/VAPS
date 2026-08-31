"""Токен рассказывает, КТО вошёл, и молчит о правах (Plane №352, Ш-4; №361).

Что было. В токене ехали четырнадцать полей о правах: `role`, `role_name`,
`scope_division_id/name/level`, `scope_type`, `scope_source`, `is_seconded`,
`seconded_to_id/name`, `can_edit_statuses`, `is_admin`, `is_hr_admin`,
`is_observer`, `is_manager`. Плохо не то, что они дублировали каталог, а то,
что права в них ЗАСТЫВАЛИ на срок жизни токена: выданная роль начинала
работать только после перелогина, снятая — продолжала действовать.

Пробы держат два конца:
  1) ни одного поля о правах в токене не осталось — мутация «вернуть роль в
     claims» краснит проверку списком, а не одним именем;
  2) ответ входа несёт подразделение ШТАТНОЙ ЕДИНИЦЫ: это факт о человеке, им
     подписан экран, и клиент читает его вместо снятой области роли.
"""
import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

#: Всё, что токен носил о правах. Проба перечисляет поля СПИСКОМ, а не
#: проверяет одно: вернуть в claims достаточно любое из них, и проверка «нет
#: поля role» пропустила бы возврат `scope_division_id`.
FORBIDDEN_CLAIMS = (
    "role", "role_name", "scope_division_id", "scope_division_name",
    "scope_division_level", "scope_type", "scope_source", "is_seconded",
    "seconded_to_id", "seconded_to_name", "can_edit_statuses", "is_admin",
    "is_hr_admin", "is_observer", "is_manager",
)

PASSWORD = "jwt-probe-pass-123"


@pytest.fixture
def person():
    """Человек со штатной единицей в отделе — как на живом стенде."""
    division = Division.objects.create(
        name="Первый отдел", code="jwt-div",
        division_type=Division.DivisionType.DIVISION,
    )
    position = Position.objects.create(name="Инспектор", code="jwt-pos", level=8)
    user = get_user_model().objects.create_user(
        username="jwt-probe", password=PASSWORD
    )
    employee = Employee.objects.create(
        personnel_number="jwt-001", last_name="Иванов", first_name="Иван",
        middle_name="Иванович", user=user,
    )
    StaffUnit.objects.create(
        division=division, position=position, index=1, employee=employee
    )
    return {"user": user, "division": division}


def obtain(client=None):
    client = client or APIClient()
    return client.post(
        reverse("token_obtain_pair"),
        {"username": "jwt-probe", "password": PASSWORD},
        format="json",
    )


def decode(access_token):
    from rest_framework_simplejwt.tokens import AccessToken

    return AccessToken(access_token).payload


def test_the_token_carries_no_permission_claims(person):
    response = obtain()

    assert response.status_code == 200, response.data
    payload = decode(response.data["access"])
    present = sorted(claim for claim in FORBIDDEN_CLAIMS if claim in payload)
    assert present == [], (
        f"токен снова несёт права: {present}. Права застывают на срок его "
        "жизни — спрашивать их надо у /api/operations/my-permissions/"
    )


def test_the_token_still_says_who_signed_in(person):
    """Снятие прав не должно унести опознание предъявителя."""
    payload = decode(obtain().data["access"])

    assert payload["username"] == "jwt-probe"
    assert payload["is_superuser"] is False
    assert payload["employee_full_name"] == "Иванов Иван Иванович"


def test_the_login_response_carries_the_staff_unit_division(person):
    """Подразделение штатной единицы — то, чем клиент подписывает экран."""
    response = obtain()

    division = response.data["user"]["division"]
    assert division == {
        "id": person["division"].id,
        "name": "Первый отдел",
    }


def test_a_user_without_a_staff_unit_has_no_division(person):
    """Учётка без штатной единицы не получает выдуманного подразделения:
    `null` честнее первого попавшегося узла (класс Plane №304)."""
    get_user_model().objects.create_user(username="jwt-loner", password=PASSWORD)

    response = APIClient().post(
        reverse("token_obtain_pair"),
        {"username": "jwt-loner", "password": PASSWORD},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert "division" not in response.data["user"]
