"""Кадровый подбор различает однофамильцев (Plane №1247, проходка №1142).

Пробы стерегут: поиск «Фамилия Имя» (два слова) находит только того, у кого
совпали оба, а не никого; в строке есть полное имя (`fullName`) и путь
подразделения (`unitPath`) от департамента до отдела — иначе четырнадцать
«Оралбаев А. · Первый отдел» неотличимы, и старшим назначается не тот человек.
"""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_security_events_api import make_employee, manager  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/ops/personnel/"


def _tree():
    root = Division.objects.create(name="Служба", division_type=Division.DivisionType.DEPARTMENT)
    dep = Division.objects.create(name="Второй департамент", division_type=Division.DivisionType.DEPARTMENT, parent=root)
    directorate = Division.objects.create(name="Первое управление", division_type=Division.DivisionType.DIRECTORATE, parent=dep)
    section = Division.objects.create(name="Первый отдел", division_type=Division.DivisionType.DIRECTORATE, parent=directorate)
    other_dep = Division.objects.create(name="Первый департамент", division_type=Division.DivisionType.DEPARTMENT, parent=root)
    other_section = Division.objects.create(name="Первый отдел", division_type=Division.DivisionType.DIRECTORATE, parent=other_dep)
    return section, other_section


def test_two_word_search_finds_only_the_full_match(manager):  # noqa: F811
    section, other_section = _tree()
    arman = make_employee("Оралбаев", "Арман")
    arman.middle_name = "Нуржанович"
    arman.save(update_fields=["middle_name"])
    ulan = make_employee("Оралбаев", "Улан")
    StaffUnit.objects.create(division=section, employee=arman, index=1)
    StaffUnit.objects.create(division=other_section, employee=ulan, index=2)

    both = manager.get(f"{URL}?search=Оралбаев").json()["results"]
    assert {row["id"] for row in both} == {str(arman.pk), str(ulan.pk)}

    exact = manager.get(f"{URL}?search=Оралбаев Арман").json()["results"]
    assert [row["id"] for row in exact] == [str(arman.pk)], exact

    reversed_order = manager.get(f"{URL}?search=Арман Оралбаев").json()["results"]
    assert [row["id"] for row in reversed_order] == [str(arman.pk)]

    row = exact[0]
    assert row["name"] == "Оралбаев А."
    assert row["fullName"] == "Оралбаев Арман Нуржанович"
    assert row["unitPath"] == "Второй департамент / Первое управление / Первый отдел"
    assert row["unit"] == "Первый отдел"
