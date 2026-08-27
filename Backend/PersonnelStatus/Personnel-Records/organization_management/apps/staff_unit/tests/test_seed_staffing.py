"""Штатка стенда: состав по типам подразделений, границы, повтор, снос (№203).

Пробы стерегут ровно то, что заказчик назвал словами, и то, чем сид может
навредить соседям:

1. СОСТАВ ПО ТИПУ. Департамент и управление с отделами — два слота (начальник
   и заместитель); отдел и СКВОЗНОЕ управление — двенадцать (те же двое плюс
   десять исполнителей). Спутать сквозное управление с обычным легко: они
   одного типа и различаются только отсутствием детей.
2. ИТОГ. 426 слотов — число, которое заказчик увидит на плитке «Штатных
   единиц»; оно складывается из трёх разных правил и молча ломается от правки
   любого.
3. ГРАНИЦА. Чужие подразделения стенда не трогаются вовсе.
4. ЗАВИСИМОСТИ. Без структуры и без должностей команда обязана сказать, чего
   ей не хватает, а не завести половину.
5. СНОС не теряет назначения молча.
"""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

SEED = "SEED-"


@pytest.fixture
def structure():
    call_command("seed_org_structure")
    call_command("seed_positions_ranks")


def seeded_slots():
    return StaffUnit.objects.filter(division__code__startswith=SEED)


def test_slot_counts_follow_the_division_type(structure):
    call_command("seed_staffing")

    department = Division.objects.get(code=f"{SEED}D1")
    directorate_with_divisions = Division.objects.get(code=f"{SEED}D1-U1")
    cross_cutting = Division.objects.get(code=f"{SEED}D1-S1")
    division = Division.objects.get(code=f"{SEED}D1-U1-O1")

    assert department.staff_units.count() == 2
    assert directorate_with_divisions.staff_units.count() == 2
    assert cross_cutting.staff_units.count() == 12, "сквозное управление несёт исполнителей"
    assert division.staff_units.count() == 12

    names = list(
        division.staff_units.order_by("index").values_list("position__name", flat=True)
    )
    assert names[:2] == ["Начальник отдела", "Заместитель начальника отдела"]
    assert names[2:] == ["Старший инспектор"] * 2 + ["Инспектор"] * 6 + ["Дежурный"] * 2


def test_total_is_the_number_the_customer_will_see(structure):
    call_command("seed_staffing")

    assert seeded_slots().count() == 426


def test_alien_divisions_are_not_touched(structure):
    alien = Division.objects.create(
        name="Отдел охраны объектов", code="DIV-001", division_type=Division.DivisionType.DIVISION
    )
    position = Position.objects.get(name="Инспектор")
    StaffUnit.objects.create(division=alien, position=position, index=1)

    call_command("seed_staffing")

    assert alien.staff_units.count() == 1


def test_second_run_creates_nothing(structure):
    call_command("seed_staffing")
    before = seeded_slots().count()

    call_command("seed_staffing")

    assert seeded_slots().count() == before


def test_without_structure_it_says_so():
    call_command("seed_positions_ranks")

    with pytest.raises(CommandError) as error:
        call_command("seed_staffing")

    assert "seed_org_structure" in str(error.value)


def test_without_positions_it_says_what_is_missing():
    call_command("seed_org_structure")

    with pytest.raises(CommandError) as error:
        call_command("seed_staffing")

    assert "Начальник департамента" in str(error.value)
    assert StaffUnit.objects.count() == 0, "половину штатки заводить нельзя"


def test_wipe_refuses_to_drop_assignments_silently(structure):
    call_command("seed_staffing")
    employee = Employee.objects.create(
        personnel_number="900001", last_name="Сидоров", first_name="Пётр"
    )
    slot = seeded_slots().order_by("id").first()
    slot.employee = employee
    slot.save()

    with pytest.raises(CommandError) as error:
        call_command("seed_staffing", "--wipe")

    assert "сидят люди: 1" in str(error.value)
    assert seeded_slots().count() == 426

    call_command("seed_staffing", "--wipe", "--force")

    assert seeded_slots().count() == 0
    assert Employee.objects.filter(pk=employee.pk).exists(), "снос слота не удаляет человека"
