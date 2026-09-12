"""Фото сотрудника доезжает до общего списка штатных единиц (Plane №1201).

«Обзор» (`/dashboard`, `OrgBoard`) рисует людей из `GET /api/staff_unit/
staff-units/`, а вложенный `EmployeeSerializer` этого списка фото не отдавал
вовсе — ни `photo`, ни `photo_url`. На стенде 12.09.2026 при 426 сотрудниках
с фото в базе список отвечал `photo_url: null` всем 142 строкам управления,
и «Обзор» рисовал заглушки. Заказчик прочитал это как «фотки не подтягивала»
в закрытой сети — а их не было нигде.

Правило то же, что у списка управления (`test_directorate_personnel_fields`):
адрес аватарки, а не путь файла; отсутствие — `null`, а не выдумка.
"""
import io
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


@pytest.fixture
def scene():
    root = Division.objects.create(
        name="Служба", code="lp-root", division_type=Division.DivisionType.ORGANIZATION
    )
    division = Division.objects.create(
        name="Отдел", code="lp-div", division_type=Division.DivisionType.DIVISION, parent=root
    )

    def person(index, number):
        employee = Employee.objects.create(
            personnel_number=number, last_name=f"Фамилия{index}", first_name="Имя",
            birth_date=date(1990, 1, 1), hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(division=division, index=index, employee=employee)
        return employee

    with_photo = person(1, "lp-1")
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), (1, 2, 3)).save(buffer, format="JPEG")
    with_photo.photo.save("lp-1.jpg", ContentFile(buffer.getvalue()), save=True)
    return {"with_photo": with_photo, "bare": person(2, "lp-2")}


def _rows():
    client = APIClient()
    client.force_authenticate(user=get_user_model().objects.create_superuser(username="lp-admin"))
    response = client.get(reverse("staffunit-list"), {"page_size": 50})
    assert response.status_code == 200, response.data
    payload = response.data
    return payload["results"] if isinstance(payload, dict) and "results" in payload else payload


def _employee(rows, employee):
    return next(row["employee"] for row in rows if row["employee"] and row["employee"]["id"] == employee.id)


def test_photo_url_reaches_the_staff_units_list(scene):
    rows = _rows()

    with_photo = _employee(rows, scene["with_photo"])
    assert with_photo["photo_url"] == scene["with_photo"].photo.url
    assert with_photo["photo_url"].startswith("/media/"), with_photo["photo_url"]


def test_absence_of_a_photo_is_told_as_null(scene):
    rows = _rows()

    assert _employee(rows, scene["bare"])["photo_url"] is None
