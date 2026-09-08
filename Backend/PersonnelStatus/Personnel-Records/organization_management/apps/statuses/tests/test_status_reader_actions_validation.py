"""Нечисловые employee_id/division_id в reader-actions статусов — Plane №1027.

`history`, `planned` и `division_headcount` передавали query-параметр прямо в
`int(...)` до какой-либо валидации. `GET .../history/?employee_id=abc` падал
`ValueError` внутри вьюхи и превращался в необработанный 500 вместо
понятного 400 — ошибочный или намеренно испорченный запрос выглядел как
серверный сбой.

Пробы стерегут именно эту границу: нечисловое значение отбивается 400 с
понятным телом ответа, а корректное числовое значение по-прежнему проходит
(мутация «убрать try/except обратно» красит `test_*_rejects_non_numeric_*`).
"""
from datetime import date

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee

pytestmark = pytest.mark.django_db

HISTORY_URL = "/api/statuses/statuses/history/"
PLANNED_URL = "/api/statuses/statuses/planned/"
DIVISION_HEADCOUNT_URL = "/api/statuses/statuses/division_headcount/"


@pytest.fixture
def api():
    client = APIClient()
    client.force_authenticate(User.objects.create_user("status-reader-actions"))
    return client


@pytest.fixture
def employee():
    return Employee.objects.create(
        first_name="Иван",
        last_name="Читаемый",
        personnel_number="RD00001",
        iin="123456789012",
        hire_date=date(2020, 1, 1),
    )


@pytest.fixture
def division():
    return Division.objects.create(name="Читаемое подразделение", code="RD-DIV-1")


def test_history_rejects_non_numeric_employee_id(api):
    response = api.get(HISTORY_URL, {"employee_id": "abc"})

    assert response.status_code == 400
    assert response.json().get("error")


def test_history_accepts_numeric_employee_id(api, employee):
    response = api.get(HISTORY_URL, {"employee_id": employee.id})

    assert response.status_code == 200


def test_planned_rejects_non_numeric_employee_id(api):
    response = api.get(PLANNED_URL, {"employee_id": "abc"})

    assert response.status_code == 400
    assert response.json().get("error")


def test_planned_accepts_numeric_employee_id(api, employee):
    response = api.get(PLANNED_URL, {"employee_id": employee.id})

    assert response.status_code == 200


def test_division_headcount_rejects_non_numeric_division_id(api):
    response = api.get(DIVISION_HEADCOUNT_URL, {"division_id": "abc"})

    assert response.status_code == 400
    assert response.json().get("error")


def test_division_headcount_accepts_numeric_division_id(api, division):
    response = api.get(DIVISION_HEADCOUNT_URL, {"division_id": division.id})

    assert response.status_code == 200
