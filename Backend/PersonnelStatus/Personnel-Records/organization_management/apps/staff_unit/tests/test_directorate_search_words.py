"""Поиск штатки ищет ПО СЛОВАМ, а не по строке целиком (Plane №312).

Поле на экране подписано «Поиск по ФИО, отделу, должности…», и самый
естественный ввод для него — «Фамилия Имя». Он не находил НИЧЕГО: подстрока
целиком не совпадает ни с одним полем, потому что фамилия и имя лежат в разных
колонках. Пустая таблица читается как «такого сотрудника нет в системе» —
дефект тем и опасен, что выглядит как ответ.

Пробы держат три правила:
  1) «Фамилия Имя» находит человека;
  2) слова соединяются И, а не ИЛИ: лишнее слово СУЖАЕТ выборку (иначе
     уточнение запроса возвращало бы больше строк, чем без него);
  3) слова ищутся по РАЗНЫМ полям — «фамилия + должность» тоже находит.
"""
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL_NAME = "staffunit-directorate-management"


@pytest.fixture
def people():
    """Два ОДНОФАМИЛЬЦА и третий с другой фамилией.

    Однофамильцы не украшение: без них проба «Абенов Канат» прошла бы и при
    поиске по одной лишь фамилии — выдача совпала бы с ожидаемой случайно.
    """
    root = Division.objects.create(
        name="Служба", code="sw-root",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    division = Division.objects.create(
        name="Первый отдел", code="sw-d1",
        division_type=Division.DivisionType.DIVISION, parent=root,
    )
    inspector = Position.objects.create(name="Инспектор", code="sw-insp", level=8)
    chief = Position.objects.create(name="Начальник отдела", code="sw-chief", level=5)

    seq = 0
    for last_name, first_name, position in (
        ("Абенов", "Канат", inspector),
        ("Абенов", "Серик", chief),
        ("Оспанов", "Канат", inspector),
    ):
        seq += 1
        employee = Employee.objects.create(
            personnel_number=f"sw-{seq:03d}",
            last_name=last_name,
            first_name=first_name,
            birth_date=date(1990, 1, 1),
            hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(
            division=division, position=position, index=seq, employee=employee
        )
    return division


@pytest.fixture
def admin():
    return get_user_model().objects.create_superuser(username="search-words-admin")


def found(admin, query):
    client = APIClient()
    client.force_authenticate(user=admin)
    response = client.get(reverse(URL_NAME) + f"?search={query}")
    assert response.status_code == 200, response.data
    return sorted(
        f"{unit['employee']['last_name']} {unit['employee']['first_name']}"
        for unit in response.data["staff_units"]
        if unit["employee"]
    )


def test_full_name_finds_the_person(admin, people):
    assert found(admin, "Абенов Канат") == ["Абенов Канат"]


def test_words_narrow_the_result_instead_of_widening_it(admin, people):
    """Лишнее слово СУЖАЕТ. При «ИЛИ» между словами вышло бы наоборот."""
    by_surname = found(admin, "Абенов")
    by_full_name = found(admin, "Абенов Канат")

    assert len(by_surname) == 2, by_surname
    assert len(by_full_name) == 1
    assert set(by_full_name) < set(by_surname)


def test_words_may_come_from_different_fields(admin, people):
    """«Фамилия + должность» — тот же вопрос, заданный двумя полями."""
    assert found(admin, "Абенов инспектор") == ["Абенов Канат"]


def test_a_single_word_search_is_unchanged(admin, people):
    """Прежнее поведение не тронуто: одно слово ищется как искалось."""
    assert found(admin, "Оспанов") == ["Оспанов Канат"]
