import pytest
from django.core.exceptions import ValidationError

from apps.core.models import Division, DivisionType, Employee, Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="Главк", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(
        organization=org, type_code=dt, name="УВД", code="UVD"
    )


def test_full_name_generated_from_parts(division):
    emp = Employee.objects.create(
        iin="900101300123",
        last_name="Иванов",
        first_name="Иван",
        middle_name="Иванович",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
    )
    assert emp.full_name == "Иванов Иван Иванович"


def test_full_name_kept_when_no_parts(division):
    emp = Employee.objects.create(
        iin="900101300124", full_name="Только ФИО",
        rank_code="MAJOR", position_code="OPER", division=division,
    )
    assert emp.full_name == "Только ФИО"


def test_invalid_iin_rejected(division):
    emp = Employee(
        iin="12ab",
        full_name="X",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
    )
    with pytest.raises(ValidationError):
        emp.full_clean()


def test_iin_unique(division):
    Employee.objects.create(
        iin="900101300125",
        full_name="A",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
    )
    with pytest.raises(Exception):
        Employee.objects.create(
            iin="900101300125",
            full_name="B",
            rank_code="MAJOR",
            position_code="OPER",
            division=division,
        )
