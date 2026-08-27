"""Разрез по подразделениям несёт путь до корня (Plane №214).

🔴 ПОЧЕМУ ЭТО НЕ КОСМЕТИКА. Имя подразделения уникально только внутри
родителя: «Первое управление» законно есть в каждом департаменте, «Первый
отдел» — в каждом управлении. Плоская таблица разреза печатала одно имя, и
девять одинаковых строк «Первый отдел» различить было нечем — а таблица нужна
ровно затем, чтобы ответить «в каком отделе недобор».

Проба заводит ДВА одноимённых отдела в разных управлениях: без этого «путь
доехал» не отличить от «путь совпал случайно».
"""
import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    root = Division.objects.create(
        name="Служба", code="st-root", division_type=Division.DivisionType.ORGANIZATION
    )
    department = Division.objects.create(
        name="Первый департамент", code="st-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=root,
    )
    first = Division.objects.create(
        name="Первое управление", code="st-dir-1",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    second = Division.objects.create(
        name="Второе управление", code="st-dir-2",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    # Два ОДНОИМЁННЫХ отдела в разных управлениях — вся суть пробы.
    Division.objects.create(
        name="Первый отдел", code="st-div-1",
        division_type=Division.DivisionType.DIVISION, parent=first,
    )
    Division.objects.create(
        name="Первый отдел", code="st-div-2",
        division_type=Division.DivisionType.DIVISION, parent=second,
    )
    return {"root": root, "department": department}


def _statistics(user):
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get(reverse("division-statistics-list"))
    assert response.status_code == 200, response.data
    return response.data


def test_the_row_of_a_division_carries_the_way_to_it(tree):
    user = get_user_model().objects.create_superuser(username="stats-ancestors")

    payload = _statistics(user)

    divisions = [row for row in payload["divisions"] if row["division_name"] == "Первый отдел"]
    assert len(divisions) == 2, "фикстура не развела одноимённые отделы — проба вакуумна"

    paths = sorted(tuple(row["ancestors"]) for row in divisions)
    assert paths == [
        ("Первый департамент", "Второе управление"),
        ("Первый департамент", "Первое управление"),
    ], paths


def test_the_root_is_not_repeated_in_every_row(tree):
    user = get_user_model().objects.create_superuser(username="stats-root")

    payload = _statistics(user)

    for row in payload["departments"] + payload["directorates"] + payload["divisions"]:
        assert "Служба" not in row["ancestors"], (
            "имя организации в каждой строке — шум, а не сведения: " + str(row["ancestors"])
        )


def test_a_department_has_no_ancestors_below_the_root(tree):
    user = get_user_model().objects.create_superuser(username="stats-dep")

    payload = _statistics(user)

    department = next(row for row in payload["departments"] if row["department_name"] == "Первый департамент")
    assert department["ancestors"] == []
