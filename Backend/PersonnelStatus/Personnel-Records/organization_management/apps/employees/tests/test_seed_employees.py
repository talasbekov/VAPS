"""Люди на слоты: согласованность записи, детерминизм, границы, снос (№204).

Пробы стерегут то, что заказчик увидит глазами, и то, чем сид может навредить:

1. КАЖДЫЙ СЛОТ ЗАНЯТ, и занят РОВНО одним человеком: пустой слот в реестре
   читается как вакансия, а два человека на слоте невозможны по модели, но
   лишний человек без слота — вполне.
2. ЗАПИСЬ СОГЛАСОВАНА САМА С СОБОЙ: женское имя при мужской фамилии и мужское
   отчество — не «тестовые данные», а строка, о которой спросят.
3. ЗВАНИЕ ИДЁТ ЗА ДОЛЖНОСТЬЮ: начальник департамента старше инспектора.
   Иначе сортировка по старшинству проверяется на данных, которые ей врут.
4. ДЕТЕРМИНИЗМ: повторный запуск обязан узнать своих, а не завести вторых.
5. ГРАНИЦА: чужие слоты стенда не занимаются.
6. СНОС не удаляет человека, у которого появилась чужая работа (статусы,
   учётная запись), — только освобождает слот.
"""
from datetime import date

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

SEED = "SEED-"
PREFIX = "SD"


@pytest.fixture
def staffing():
    call_command("seed_org_structure")
    call_command("seed_positions_ranks")
    call_command("seed_staffing")


def seeded_slots():
    return StaffUnit.objects.filter(division__code__startswith=SEED)


def test_every_seeded_slot_gets_exactly_one_person(staffing):
    call_command("seed_employees")

    assert seeded_slots().filter(employee__isnull=True).count() == 0
    assert Employee.objects.filter(personnel_number__startswith=PREFIX).count() == 426
    assert seeded_slots().count() == 426


def test_record_agrees_with_itself(staffing):
    call_command("seed_employees")

    for employee in Employee.objects.filter(personnel_number__startswith=PREFIX):
        if employee.gender == Employee.Gender.FEMALE:
            assert employee.middle_name.endswith("овна"), employee.middle_name
            assert employee.last_name.endswith("а"), employee.last_name
        else:
            assert employee.middle_name.endswith("ович"), employee.middle_name
            assert not employee.last_name.endswith("а"), employee.last_name
        assert employee.iin is not None and len(employee.iin) == 12 and employee.iin.isdigit()

    women = Employee.objects.filter(
        personnel_number__startswith=PREFIX, gender=Employee.Gender.FEMALE
    ).count()
    assert women > 0, "на стенде из одних мужчин женские формы никто не проверит"


def test_rank_follows_the_position(staffing):
    call_command("seed_employees")

    chief = StaffUnit.objects.get(
        division__code=f"{SEED}D1", position__name="Начальник департамента"
    ).employee
    inspector = (
        StaffUnit.objects.filter(
            division__code=f"{SEED}D1-U1-O1", position__name="Инспектор"
        )
        .first()
        .employee
    )

    assert chief.rank.name == "полковник"
    assert inspector.rank.name == "лейтенант"
    assert chief.rank.level < inspector.rank.level


def test_second_run_recognizes_its_own(staffing):
    call_command("seed_employees")
    before = list(Employee.objects.order_by("id").values_list("personnel_number", "iin"))

    call_command("seed_employees")

    assert list(Employee.objects.order_by("id").values_list("personnel_number", "iin")) == before


def test_alien_slots_are_left_alone(staffing):
    alien_division = Division.objects.create(
        name="Отдел охраны объектов", code="DIV-001", division_type=Division.DivisionType.DIVISION
    )
    alien_slot = StaffUnit.objects.create(
        division=alien_division, position=Position.objects.get(name="Инспектор"), index=1
    )

    call_command("seed_employees")

    alien_slot.refresh_from_db()
    assert alien_slot.employee_id is None


def test_without_staffing_it_says_so():
    call_command("seed_org_structure")
    call_command("seed_positions_ranks")

    with pytest.raises(CommandError) as error:
        call_command("seed_employees")

    assert "seed_staffing" in str(error.value)


def test_wipe_keeps_people_with_someone_elses_work(staffing):
    call_command("seed_employees")
    kept = Employee.objects.filter(personnel_number__startswith=PREFIX).order_by("id").first()
    kept.statuses.create(
        status_type="vacation", start_date=date(2026, 1, 1), end_date=date(2026, 1, 14)
    )

    call_command("seed_employees", "--wipe")

    assert seeded_slots().filter(employee__isnull=False).count() == 0
    assert Employee.objects.filter(pk=kept.pk).exists(), "человек со статусом не удаляется"
    assert Employee.objects.filter(personnel_number__startswith=PREFIX).count() == 1
