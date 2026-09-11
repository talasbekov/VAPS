"""Server failure: unknown types and two source positions matching POS-5."""

import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_roster_xlsx import (
    sample,
    workbook,
)

pytestmark = pytest.mark.django_db


def source(tmp_path):
    child = sample()
    child[5:9] = ["6662", "Альфа", "6769", "SOURCE-1"]
    root = sample("43", "101", "000000000043")
    root[5:9] = ["6769", "Бета", "0", "SOURCE-2"]
    return workbook(tmp_path, [child, root])


def run(path, **options):
    out = StringIO()
    call_command(
        "import_staffing_xlsx",
        str(path),
        missing_parent_code="6769",
        default_division_type="division",
        root_division_code="6769",
        match_dictionary_names=True,
        stdout=out,
        **options,
    )
    return out.getvalue()


def test_unknown_types_and_same_position_names_import_then_repeat(tmp_path):
    seeded = Position.objects.create(code="POS-5", name="НАЧАЛЬНИК ОТДЕЛА", level=5)
    path = source(tmp_path)
    report = tmp_path / "preview.json"
    run(path, report=str(report))
    assert not Employee.objects.exists()
    assert not json.loads(report.read_text())["errors"]
    run(path, apply=True)
    assert dict(Division.objects.values_list("code", "division_type")) == {
        "6662": "division",
        "6769": "organization",
    }
    assert dict(Division.objects.values_list("code", "name")) == {
        "6662": "Альфа",
        "6769": "Бета",
    }
    assert Division.objects.get(code="6662").parent.code == "6769"
    assert Division.objects.get(code="6769").parent_id is None
    assert dict(StaffUnit.objects.values_list("external_id", "position__code")) == {
        "100": "POS-5",
        "101": "POS-5",
    }
    assert Employee.objects.count() == 2
    before = {
        m: list(m.objects.order_by("pk").values())
        for m in (Employee, Division, StaffUnit, Position)
    }
    assert "создать: 0; обновить: 0" in run(path, apply=True)
    assert before == {m: list(m.objects.order_by("pk").values()) for m in before}
    seeded.refresh_from_db()
    assert seeded.level == 5


def test_explicit_and_existing_division_types_override_fallback(tmp_path):
    path = source(tmp_path)
    root = Division.objects.create(
        code="6769", name="Бета", division_type="organization"
    )
    Division.objects.create(
        code="6662", name="Альфа", division_type="directorate", parent=root
    )
    run(path, apply=True)
    assert Division.objects.get(code="6662").division_type == "directorate"
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps({"divisions": {"6662": {"division_type": "department"}}})
    )
    run(path, apply=True, config=str(config))
    assert Division.objects.get(code="6662").division_type == "department"


def test_matching_still_rejects_existing_code_with_different_name(tmp_path):
    Position.objects.create(code="SOURCE-1", name="Другая должность", level=1)
    with pytest.raises(CommandError, match="название отличается"):
        run(source(tmp_path), apply=True)
    assert not Employee.objects.exists()
    assert not Division.objects.exists()


def test_check_file_shows_selected_types(tmp_path, django_assert_num_queries):
    report = tmp_path / "file.json"
    with django_assert_num_queries(0):
        run(source(tmp_path), check_file=True, report=str(report))
    assert {
        n["code"]: n["division_type"]
        for n in json.loads(report.read_text())["divisions"]
    } == {"6662": "division", "6769": "organization"}


def test_shared_position_cannot_receive_conflicting_levels(tmp_path):
    Position.objects.create(code="POS-5", name="НАЧАЛЬНИК ОТДЕЛА", level=5)
    config = tmp_path / "levels.json"
    config.write_text(json.dumps({"position_levels": {"SOURCE-1": 2, "SOURCE-2": 3}}))
    with pytest.raises(CommandError, match="Несколько кодов position"):
        run(source(tmp_path), apply=True, config=str(config))
    assert not Employee.objects.exists()
    assert Position.objects.get(code="POS-5").level == 5


def test_root_option_does_not_invent_absent_division(tmp_path):
    row = sample()
    row[5:8] = ["7000", "Организация Примера", None]
    run(workbook(tmp_path, [row]), apply=True)
    assert list(Division.objects.values_list("code", flat=True)) == ["7000"]


def test_shared_new_dictionary_target_rejected_before_write(tmp_path):
    before = list(Position.objects.order_by("pk").values())
    config = tmp_path / "aliases.json"
    config.write_text(
        json.dumps({"position_codes": {"SOURCE-1": "NEW", "SOURCE-2": "NEW"}})
    )
    with pytest.raises(CommandError, match="Несколько кодов position"):
        run(source(tmp_path), apply=True, config=str(config))
    assert list(Position.objects.order_by("pk").values()) == before
    assert not Division.objects.exists()


def test_automatic_root_type_does_not_authorize_rename(tmp_path):
    Division.objects.create(
        code="6769", name="Прежнее название", division_type="organization"
    )
    with pytest.raises(
        CommandError, match="Название существующего подразделения 6769 отличается"
    ):
        run(source(tmp_path), apply=True)
    assert Division.objects.get(code="6769").name == "Прежнее название"
    assert not Employee.objects.exists()
