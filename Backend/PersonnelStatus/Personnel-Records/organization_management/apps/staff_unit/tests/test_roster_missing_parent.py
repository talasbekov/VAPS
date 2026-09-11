import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_roster_xlsx import (
    sample,
    workbook,
)

pytestmark = pytest.mark.django_db


def source(tmp_path, parent="6701", root_parent="0"):
    child = sample()
    child[5:8] = ["6950", "4 отдел 2 управления Службы Примера", parent]
    root = sample("43", "101", "000000000043")
    root[5:8] = ["6769", "Служба Примера", root_parent]
    return workbook(tmp_path, [child, root])


def run(path, **options):
    output = StringIO()
    call_command(
        "import_staffing_xlsx",
        str(path),
        missing_parent_code="6769",
        stdout=output,
        **options,
    )
    return output.getvalue()


def test_missing_parent_replaced_without_creating_inferred_phantom(tmp_path):
    path = source(tmp_path)
    output = run(path, apply=True)
    assert dict(Division.objects.values_list("code", "parent__code")) == {
        "6950": "6769",
        "6769": None,
    }
    assert "6701" in output and "6769" in output
    assert StaffUnit.objects.get(external_id="100").division.code == "6950"
    run(path, apply=True)
    assert Division.objects.count() == 2


def test_parent_in_database_is_preserved(tmp_path):
    root = Division.objects.create(
        code="6769", name="Служба Примера", division_type="organization"
    )
    Division.objects.create(
        code="6701", name="2 управление", division_type="directorate", parent=root
    )
    run(source(tmp_path), apply=True)
    assert Division.objects.get(code="6950").parent.code == "6701"


def test_parent_below_child_is_preserved(tmp_path):
    child = sample()
    child[5:8] = ["6950", "4 отдел 2 управления Службы Примера", "6701"]
    parent = sample("43", "101", "000000000043")
    parent[5:8] = ["6701", "2 управление Службы Примера", "6769"]
    root = sample("44", "102", "000000000044")
    root[5:8] = ["6769", "Служба Примера", "0"]
    run(workbook(tmp_path, [child, parent, root]), apply=True)
    assert Division.objects.get(code="6950").parent.code == "6701"


def test_preview_reports_provisional_replacement_without_database(
    tmp_path, django_assert_num_queries
):
    path = source(tmp_path)
    report = tmp_path / "report.json"
    with django_assert_num_queries(0):
        run(path, check_file=True, report=str(report))
    nodes = {n["code"]: n for n in json.loads(report.read_text())["divisions"]}
    assert nodes["6950"]["parent_code"] == "6769"
    assert nodes["6769"]["parent_code"] is None
    assert not Division.objects.exists()


def test_fallback_must_exist_and_cycles_still_fail(tmp_path):
    child = sample()
    child[5:8] = ["6950", "Служба Примера", "6701"]
    with pytest.raises(CommandError, match="6769"):
        run(workbook(tmp_path, [child]), apply=True)
    assert not Division.objects.exists()
    with pytest.raises(CommandError, match="[Цц]икл"):
        run(source(tmp_path, root_parent="6950"), apply=True)
    assert not Division.objects.exists()


def test_parent_supplied_in_config_is_not_replaced(tmp_path):
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps(
            {
                "divisions": {
                    "6701": {
                        "name": "2 управление",
                        "division_type": "directorate",
                        "parent_code": "6769",
                    }
                }
            }
        )
    )
    run(source(tmp_path), apply=True, config=str(config))
    assert Division.objects.get(code="6950").parent.code == "6701"


def test_requested_replacement_can_update_existing_division_parent(tmp_path):
    Division.objects.create(
        code="6769", name="Служба Примера", division_type="organization"
    )
    child = Division.objects.create(
        code="6950", name="4 отдел", division_type="division"
    )
    run(source(tmp_path), apply=True)
    child.refresh_from_db()
    assert child.parent.code == "6769"


def test_valid_name_inference_without_option_keeps_previous_behavior(tmp_path):
    path = workbook(tmp_path, [sample()])
    call_command("import_staffing_xlsx", str(path), apply=True, stdout=StringIO())
    assert Division.objects.get(code="6661").parent.code == "6984"
