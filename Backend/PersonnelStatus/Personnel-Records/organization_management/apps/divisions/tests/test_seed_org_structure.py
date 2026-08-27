"""Сид дерева подразделений: арифметика заказчика, повтор и снос (Plane №201).

Проверяется не «строки появились», а ровно те свойства, ради которых сид и
заводится:

1. АРИФМЕТИКА. Заказчик назвал состав словами, и слова легко потерять при
   правке: три департамента, по шесть управлений, из них четыре с отделами
   (2+2+2+3) и два сквозных. Проба держит каждое число отдельно — подмена
   любого из них красит свою строку, а не одну общую «дерево не то».
2. ПОВТОР. Сид зовут на живом стенде, и второй запуск обязан не плодить
   близнецов: подразделения уникальны по имени внутри родителя, но соседний
   департамент имеет право на своё «Первое управление» — значит уникальность
   имени всё дерево не стережёт, стережёт код.
3. ЧУЖОЕ. Сид вешается под существующий корень и не смеет присваивать чужие
   узлы: если под родителем уже сидит «Первое управление» с чужим кодом,
   команда обязана сказать это вслух, а не подобрать его молча.
4. СНОС. `--wipe` уносит только своё и отказывается осиротить штатные единицы
   без `--force`.
"""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

SEED = "SEED-"


def seeded(**kwargs):
    return Division.objects.filter(code__startswith=SEED, **kwargs)


def test_arithmetic_matches_the_customer_words():
    call_command("seed_org_structure")

    departments = seeded(division_type=Division.DivisionType.DEPARTMENT)
    assert departments.count() == 3

    for department in departments:
        directorates = department.children.all()
        assert directorates.count() == 6, f"{department.name}: управлений не шесть"

        with_divisions = [d for d in directorates if d.children.exists()]
        cross_cutting = [d for d in directorates if not d.children.exists()]
        assert len(with_divisions) == 4
        assert len(cross_cutting) == 2

        sizes = sorted(d.children.count() for d in with_divisions)
        assert sizes == [2, 2, 2, 3], f"{department.name}: отделы разложены как {sizes}"

    assert seeded(division_type=Division.DivisionType.DIRECTORATE).count() == 18
    assert seeded(division_type=Division.DivisionType.DIVISION).count() == 27


def test_names_agree_in_gender():
    """«Первое отдел» — не опечатка сида, а строка, которую увидит заказчик.

    Управление среднего рода, отдел мужского; общий ряд порядковых давал
    несогласованное название у всех 27 отделов сразу.
    """
    call_command("seed_org_structure")

    directorate = Division.objects.get(code=f"{SEED}D1-U4")
    assert directorate.name == "Четвёртое управление"
    assert list(directorate.children.order_by("order").values_list("name", flat=True)) == [
        "Первый отдел", "Второй отдел", "Третий отдел"
    ]


def test_hangs_under_the_existing_root_and_keeps_old_nodes():
    root = Division.objects.create(
        name="Служба", code="ORG-001", division_type=Division.DivisionType.ORGANIZATION
    )
    old = Division.objects.create(
        name="Департамент охраны",
        code="DEP-001",
        division_type=Division.DivisionType.DEPARTMENT,
        parent=root,
    )

    call_command("seed_org_structure")

    assert seeded(division_type=Division.DivisionType.ORGANIZATION).count() == 0
    assert set(root.children.values_list("code", flat=True)) == {
        "DEP-001", f"{SEED}D1", f"{SEED}D2", f"{SEED}D3"
    }
    old.refresh_from_db()
    assert old.parent_id == root.id


def test_second_run_creates_nothing():
    call_command("seed_org_structure")
    before = list(Division.objects.values_list("id", flat=True))

    call_command("seed_org_structure")

    assert list(Division.objects.values_list("id", flat=True)) == before


def test_renamed_node_is_recognized_by_code_and_not_renamed_back():
    call_command("seed_org_structure")
    node = Division.objects.get(code=f"{SEED}D1-U1")
    node.name = "Управление кадров"
    node.save()

    call_command("seed_org_structure")

    node.refresh_from_db()
    assert node.name == "Управление кадров"
    assert seeded(division_type=Division.DivisionType.DIRECTORATE).count() == 18


def test_alien_node_with_the_same_name_is_reported_not_taken_over():
    root = Division.objects.create(
        name="Служба", code="ORG-001", division_type=Division.DivisionType.ORGANIZATION
    )
    department = Division.objects.create(
        name="Первый департамент",
        code="ALIEN-DEP",
        division_type=Division.DivisionType.DEPARTMENT,
        parent=root,
    )

    with pytest.raises(CommandError) as error:
        call_command("seed_org_structure")

    assert "ALIEN-DEP" in str(error.value)
    assert department.children.count() == 0


def test_wipe_removes_only_seeded_nodes():
    root = Division.objects.create(
        name="Служба", code="ORG-001", division_type=Division.DivisionType.ORGANIZATION
    )
    call_command("seed_org_structure")

    call_command("seed_org_structure", "--wipe")

    assert seeded().count() == 0
    assert Division.objects.filter(pk=root.pk).exists()


def test_wipe_refuses_to_orphan_staff_units():
    call_command("seed_org_structure")
    position = Position.objects.create(name="Инспектор", code="P-INSP", level=5)
    division = Division.objects.get(code=f"{SEED}D1-U1-O1")
    StaffUnit.objects.create(division=division, position=position, index=1)

    with pytest.raises(CommandError) as error:
        call_command("seed_org_structure", "--wipe")

    assert "штатных единиц: 1" in str(error.value)
    assert Division.objects.filter(pk=division.pk).exists()

    call_command("seed_org_structure", "--wipe", "--force")

    assert seeded().count() == 0
    assert StaffUnit.objects.get(pk=StaffUnit.objects.first().pk).division_id is None


def test_the_structure_scales_by_the_number_of_departments():
    """Масштаб задаётся числом департаментов, состав каждого не меняется."""
    call_command("seed_org_structure", "--departments", "5")

    assert seeded(division_type=Division.DivisionType.DEPARTMENT).count() == 5
    assert seeded(division_type=Division.DivisionType.DIRECTORATE).count() == 30
    assert seeded(division_type=Division.DivisionType.DIVISION).count() == 45


def test_the_structure_can_be_asked_for_a_headcount():
    """«Структуру под пять тысяч» — не считая департаменты в уме.

    🔴 Округление ВВЕРХ: 5000 / 142 = 35,2, и тридцать пять департаментов дают
    4970 — меньше просимого. Проба стережёт именно это: «почти пять тысяч» на
    нагрузочной проверке означает, что мерили не то, что просили.
    """
    call_command("seed_org_structure", "--people", "5000")

    departments = seeded(division_type=Division.DivisionType.DEPARTMENT).count()
    assert departments == 36
    assert departments * 142 >= 5000


def test_names_beyond_the_third_are_numbered():
    call_command("seed_org_structure", "--departments", "4")

    names = set(
        seeded(division_type=Division.DivisionType.DEPARTMENT).values_list("name", flat=True)
    )
    assert "Первый департамент" in names
    assert "Департамент №4" in names
