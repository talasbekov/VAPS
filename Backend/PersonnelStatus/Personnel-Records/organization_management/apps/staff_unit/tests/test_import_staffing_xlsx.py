import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from openpyxl import Workbook

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_roster_xlsx import sample

pytestmark = pytest.mark.django_db
HEADERS = [
    "ИИН (табельный номер)",
    "personId",
    "Фамилия",
    "Имя",
    "Отчество",
    "Код подразделения",
    "Подразделение",
    "Код вышестоящего подразделения",
    "Код должности",
    "Должность",
    "Номер штатной единицы",
    "Порядок ШЕ в подразделении",
    "Категория должности",
    "Личное звание",
    "Код звания",
]


@pytest.fixture
def xlsx(tmp_path):
    def make(rows=None):
        w = Workbook()
        w.active.append(HEADERS)
        for row in rows or [sample()]:
            w.active.append(row)
        p = tmp_path / "staff.xlsx"
        w.save(p)
        return str(p)

    return make


def run(path, **options):
    output = StringIO()
    call_command("import_staffing_xlsx", path, stdout=output, **options)
    return output.getvalue()


def test_preview_never_writes(xlsx):
    counts = [
        m.objects.count() for m in (Division, Position, Rank, Employee, StaffUnit)
    ]
    out = run(xlsx())
    assert "ПРОВЕРКА" in out
    assert counts == [
        m.objects.count() for m in (Division, Position, Rank, Employee, StaffUnit)
    ]


def test_apply_creates_hierarchy_identity_and_unknown_dates(xlsx):
    run(xlsx(), apply=True)
    e = Employee.objects.get(external_id="42")
    slot = StaffUnit.objects.get(external_id="100")
    assert slot.employee == e
    assert (
        slot.index == 100
        and slot.import_order == 8
        and slot.position_category == "C-S-5"
    )
    assert slot.division.code == "6661"
    assert slot.division.parent.code == "6984"
    assert slot.division.parent.parent.division_type == "organization"
    assert e.iin == "000000000042"
    assert e.birth_date is None and e.hire_date is None and e.gender is None
    assert e.rank.code == "R1" and slot.position.code == "P1"


def test_repeat_is_noop_and_keeps_unrelated_data(xlsx):
    path = xlsx()
    run(path, apply=True)
    e = Employee.objects.get(external_id="42")
    e.work_phone = "+70000000000"
    e.save()
    before = (
        e.pk,
        e.updated_at,
        list(StaffUnit.objects.values_list("pk", "employee_id")),
    )
    out = run(path, apply=True)
    e.refresh_from_db()
    assert (
        e.pk,
        e.updated_at,
        list(StaffUnit.objects.values_list("pk", "employee_id")),
    ) == before
    assert e.work_phone == "+70000000000"
    assert "создать: 0" in out


def test_error_on_later_row_does_not_partially_import(xlsx):
    bad = sample("43", "101", "123")
    before = Division.objects.count()
    with pytest.raises(CommandError):
        run(xlsx([sample(), bad]), apply=True)
    assert Division.objects.count() == before
    assert not Employee.objects.filter(external_id="42").exists()


def test_short_iin_requires_explicit_skip(xlsx):
    path = xlsx([sample(iin=123456789)])
    with pytest.raises(CommandError, match="ИИН"):
        run(path, apply=True)
    run(path, apply=True, skip_invalid_iin=True)
    assert Employee.objects.get(external_id="42").iin is None


def test_unknown_parent_is_an_error_for_unstructured_name(xlsx):
    row = sample()
    row[6] = "Специальная группа"
    with pytest.raises(CommandError, match="6984"):
        run(xlsx([row]), apply=True)
    assert not StaffUnit.objects.filter(external_id="100").exists()


def test_json_supplies_missing_nodes_and_types(xlsx, tmp_path):
    row = sample()
    row[6] = "Специальная группа"
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps(
            {
                "divisions": {
                    "6984": {
                        "name": "Управление А",
                        "division_type": "directorate",
                        "parent_code": "ORG",
                    },
                    "ORG": {
                        "name": "Организация А",
                        "division_type": "organization",
                        "parent_code": None,
                    },
                    "6661": {"division_type": "division"},
                }
            }
        )
    )
    run(xlsx([row]), apply=True, config=str(config))
    assert Division.objects.get(code="6661").parent.code == "6984"


def test_cycle_in_config_is_rejected(xlsx, tmp_path):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"divisions": {"6984": {"parent_code": "6661"}}}))
    with pytest.raises(CommandError, match="[Цц]икл"):
        run(xlsx(), apply=True, config=str(config))


def test_existing_employee_adopted_by_iin_without_duplicates(xlsx):
    e = Employee.objects.create(
        personnel_number="REAL-42",
        iin="000000000042",
        last_name="Тестов",
        first_name="Тест",
    )
    run(xlsx(), apply=True)
    e.refresh_from_db()
    assert e.external_id == "42" and e.personnel_number == "REAL-42"
    assert StaffUnit.objects.get(external_id="100").employee == e


def test_existing_person_with_same_iin_updates_in_place(xlsx):
    e = Employee.objects.create(
        personnel_number="REAL-42",
        external_id="other",
        iin="000000000042",
        last_name="Прежняя",
        first_name="Старое",
        work_phone="retain-me",
    )
    run(xlsx(), apply=True)
    e.refresh_from_db()
    assert (e.external_id, e.last_name, e.first_name) == ("42", "Тестов", "Тест")
    assert e.personnel_number == "REAL-42" and e.work_phone == "retain-me"
    assert Employee.objects.count() == 1
    assert StaffUnit.objects.get(external_id="100").employee_id == e.pk
    run(xlsx(), apply=True)
    assert Employee.objects.count() == 1


def test_distinct_iin_and_external_id_matches_are_not_merged(xlsx):
    a = Employee.objects.create(
        personnel_number="A", external_id="42", iin="000000000041"
    )
    b = Employee.objects.create(personnel_number="B", iin="000000000042")
    with pytest.raises(CommandError, match="ИИН"):
        run(xlsx(), apply=True)
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.iin == "000000000041" and b.external_id is None
    assert not StaffUnit.objects.exists()


def test_existing_external_id_cannot_change_known_iin(xlsx):
    e = Employee.objects.create(
        personnel_number="A", external_id="42", iin="000000000041"
    )
    with pytest.raises(CommandError, match="ИИН"):
        run(xlsx(), apply=True)
    e.refresh_from_db()
    assert e.iin == "000000000041"


def test_does_not_steal_employee_from_an_existing_slot(xlsx):
    run(xlsx(), apply=True)
    with pytest.raises(CommandError, match="назначен"):
        run(xlsx([sample(slot="101")]), apply=True)
    assert StaffUnit.objects.get(external_id="100").employee.external_id == "42"
    assert not StaffUnit.objects.filter(external_id="101").exists()


def test_vacant_slot_created_without_employee(xlsx):
    row = sample()
    row[:5] = [None] * 5
    row[13:] = [None, None]
    run(xlsx([row]), apply=True)
    assert StaffUnit.objects.get(external_id="100").employee is None


def test_ambiguous_dictionary_name_requires_mapping(xlsx):
    Position.objects.create(code="OTHER", name="НАЧАЛЬНИК ОТДЕЛА", level=5)
    with pytest.raises(CommandError, match="position_codes"):
        run(xlsx(), apply=True)


def test_file_only_check_does_not_query_database(xlsx, django_assert_num_queries):
    with django_assert_num_queries(0):
        out = run(xlsx(), check_file=True)
    assert "6661" in out and "6984" in out


@pytest.mark.parametrize("missing_context", [False, True])
@pytest.mark.parametrize("context", ["division", "position"])
@pytest.mark.parametrize("existing_target", [False, True])
def test_occupied_slot_context_change_requires_transfer(
    xlsx, context, existing_target, missing_context
):
    from organization_management.apps.staff_unit.roster_import import (
        apply_import,
        prepare_import,
    )
    from organization_management.apps.staff_unit.roster_xlsx import read_roster

    run(xlsx(), apply=True)
    slot = StaffUnit.objects.get(external_id="100")
    changed = sample()
    if context == "division":
        changed[5:7] = ["NEW-D", "5 отдел 2 управления Службы охраны Примера"]
        if existing_target:
            Division.objects.create(
                code="NEW-D",
                name="5 отдел",
                division_type="division",
                parent=slot.division.parent,
            )
    else:
        changed[8:10] = ["NEW-P", "ДРУГАЯ ДОЛЖНОСТЬ"]
        if existing_target:
            Position.objects.create(code="NEW-P", name="ДРУГАЯ ДОЛЖНОСТЬ", level=10)
    if missing_context:
        StaffUnit.objects.filter(pk=slot.pk).update(**{f"{context}_id": None})
        slot.refresh_from_db()
    before = (slot.division_id, slot.position_id, slot.employee_id)
    roster = read_roster(xlsx([changed]))
    assert any("перевод" in e for e in prepare_import(roster).errors)
    assert apply_import(roster).errors
    slot.refresh_from_db()
    assert (slot.division_id, slot.position_id, slot.employee_id) == before


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("existing_parent", [False, True])
def test_root_reparent_requires_confirmation_and_preview_matches_apply(
    xlsx, explicit, existing_parent
):
    from organization_management.apps.staff_unit.roster_import import (
        apply_import,
        prepare_import,
    )
    from organization_management.apps.staff_unit.roster_xlsx import read_roster

    root = Division.objects.create(
        code="6984", name="2 управление", division_type="directorate"
    )
    if existing_parent:
        Division.objects.create(
            code="ORG", name="Служба охраны Примера", division_type="organization"
        )
    roster = read_roster(xlsx())
    config = {"divisions": {"6984": {}}} if explicit else {}
    plan = prepare_import(roster, config)
    if not explicit:
        assert any("Родитель" in e for e in plan.errors)
        assert apply_import(roster, config).errors
        root.refresh_from_db()
        assert root.parent_id is None
        return
    assert not plan.errors
    action = next(
        a for a in plan.actions if a["entity"] == "division" and a["key"] == "6984"
    )
    assert action["operation"] == "update"
    assert "parent" in action["changed_fields"]
    assert not apply_import(roster, config).errors
    root.refresh_from_db()
    assert root.parent.code == action["parent_code"]
    assert not prepare_import(roster, config).errors


@pytest.mark.parametrize("second_name", ["капитан", "КАПИТАН"])
def test_planned_rank_name_collision_rejected_before_writes(xlsx, second_name):
    from organization_management.apps.staff_unit.roster_import import (
        apply_import,
        prepare_import,
    )
    from organization_management.apps.staff_unit.roster_xlsx import read_roster

    other = sample("43", "101", "000000000043")
    other[13:] = [second_name, "R2"]
    roster = read_roster(xlsx([sample(), other]))
    assert not roster.errors
    assert any("rank" in e for e in prepare_import(roster).errors)
    assert apply_import(roster).errors
    assert not Employee.objects.filter(external_id__in=["42", "43"]).exists()
    assert not Rank.objects.filter(code__in=["R1", "R2"]).exists()


def test_literal_person_id_and_hash_have_distinct_personnel_numbers(xlsx):
    from organization_management.apps.staff_unit.roster_import import (
        apply_import,
        prepare_import,
    )
    from organization_management.apps.staff_unit.roster_xlsx import read_roster

    roster = read_roster(
        xlsx(
            [
                sample("1234567890123456", "100", None),
                sample("7a51d064a1a216a", "101", None),
            ]
        )
    )
    plan = prepare_import(roster)
    assert not plan.errors
    numbers = [
        a["data"]["personnel_number"] for a in plan.actions if a["entity"] == "employee"
    ]
    assert len(set(numbers)) == 2
    assert all(len(n) <= 20 for n in numbers)
    assert not apply_import(roster).errors
    before = list(Employee.objects.values_list("external_id", "personnel_number"))
    assert not apply_import(roster).errors
    assert (
        list(Employee.objects.values_list("external_id", "personnel_number")) == before
    )


def test_planned_hashed_personnel_number_collision_rejected(xlsx, monkeypatch):
    from types import SimpleNamespace

    from organization_management.apps.staff_unit import roster_import
    from organization_management.apps.staff_unit.roster_xlsx import read_roster

    # Force a truncated-digest collision without changing reconciliation or writes.
    monkeypatch.setattr(
        roster_import,
        "sha256",
        lambda value: SimpleNamespace(hexdigest=lambda: "a" * 64),
    )
    roster = read_roster(
        xlsx(
            [
                sample("1234567890123456", "100", None),
                sample("1234567890123457", "101", None),
            ]
        )
    )
    assert any(
        "табельного номера" in e for e in roster_import.prepare_import(roster).errors
    )
    assert roster_import.apply_import(roster).errors
    assert not Employee.objects.filter(
        external_id__in=["1234567890123456", "1234567890123457"]
    ).exists()


@pytest.mark.parametrize(
    "entity,model,name",
    [
        ("position", Position, "НАЧАЛЬНИК ОТДЕЛА"),
        ("rank", Rank, "капитан"),
    ],
)
def test_dictionary_name_conflict_lists_candidate_codes(xlsx, entity, model, name):
    model.objects.create(code="EXISTING-B", name=name, level=5)
    model.objects.create(code="EXISTING-A", name=name.swapcase(), level=6)
    with pytest.raises(CommandError) as error:
        run(xlsx())
    diagnostic = str(error.value)
    assert f"{entity}_codes" in diagnostic
    assert "EXISTING-A" in diagnostic and "EXISTING-B" in diagnostic
    assert "000000000042" not in diagnostic and "Тестов" not in diagnostic


def test_rank_save_failure_rolls_back_already_created_divisions(xlsx, monkeypatch):
    from django.core.exceptions import ValidationError

    from organization_management.apps.staff_unit.roster_import import (
        apply_import,
        prepare_import,
    )
    from organization_management.apps.staff_unit.roster_xlsx import read_roster
    from organization_management.apps.statuses.models import EmployeeStatus

    # Include an existing tree so the snapshot also detects unrolled MPTT updates.
    baseline = Division.objects.create(
        code="BASELINE", name="Я — исходная организация", division_type="organization"
    )
    Division.objects.create(
        code="BASELINE-CHILD",
        name="Исходный отдел",
        division_type="division",
        parent=baseline,
    )
    models = (Division, Position, Rank, Employee, StaffUnit, EmployeeStatus)
    before = {model: list(model.objects.order_by("pk").values()) for model in models}
    roster = read_roster(xlsx())
    assert not prepare_import(roster).errors
    reached_write = []

    def fail_rank_save(self, *args, **kwargs):
        assert self.code == "R1"
        assert Division.objects.filter(code="6661", parent__code="6984").exists()
        assert Division.objects.count() == len(before[Division]) + 3
        assert Position.objects.filter(code="P1").exists()
        reached_write.append(True)
        raise ValidationError("injected rank save failure")

    monkeypatch.setattr(Rank, "save", fail_rank_save)
    with pytest.raises(ValidationError, match="injected rank save failure"):
        apply_import(roster)
    assert reached_write == [True]
    assert {
        model: list(model.objects.order_by("pk").values()) for model in models
    } == before


def test_explicit_name_matching_reuses_existing_dictionary_codes(xlsx):
    position = Position.objects.create(code="SAVED-P", name="Начальник отдела", level=6)
    rank = Rank.objects.create(code="SAVED-R", name="Капитан", level=7)
    before = {
        model: list(model.objects.order_by("pk").values()) for model in (Position, Rank)
    }
    with pytest.raises(CommandError):
        run(xlsx())
    out = run(xlsx(), apply=True, match_dictionary_names=True)
    employee = Employee.objects.get(external_id="42")
    unit = StaffUnit.objects.get(external_id="100")
    assert unit.position == position and employee.rank == rank
    assert {
        model: list(model.objects.order_by("pk").values()) for model in (Position, Rank)
    } == before
    assert "SAVED-P" in out and "SAVED-R" in out
    again = run(xlsx(), apply=True, match_dictionary_names=True)
    assert "создать: 0; обновить: 0" in again
    position.refresh_from_db()
    rank.refresh_from_db()
    assert position.level == 6 and rank.level == 7


def test_name_matching_rejects_ambiguous_names_and_conflicting_code(xlsx):
    Position.objects.create(code="SAVED-A", name="Начальник отдела", level=1)
    Position.objects.create(code="SAVED-B", name="НАЧАЛЬНИК ОТДЕЛА", level=2)
    with pytest.raises(CommandError):
        run(xlsx(), apply=True, match_dictionary_names=True)
    assert Employee.objects.count() == 0
    Position.objects.filter(code="SAVED-B").delete()
    Position.objects.create(code="P1", name="Другая должность", level=3)
    with pytest.raises(CommandError):
        run(xlsx(), apply=True, match_dictionary_names=True)
    assert Employee.objects.count() == 0


def test_name_matching_reuses_identical_positions_from_distinct_source_codes(xlsx):
    Position.objects.create(code="SAVED-P", name="Начальник отдела", level=1)
    before = list(Position.objects.order_by("pk").values())
    rows = [sample(), sample("43", "101", "000000000043")]
    rows[1][8] = "P2"
    run(xlsx(rows), apply=True, match_dictionary_names=True)
    assert Employee.objects.count() == 2
    assert StaffUnit.objects.filter(position__code="SAVED-P").count() == 2
    assert list(Position.objects.order_by("pk").values()) == before


@pytest.mark.parametrize("cycle", [False, True])
def test_organization_parent_from_later_row_is_applied_or_cycle_rejected(xlsx, cycle):
    child = sample()
    child[5:8] = ["6935", "Служба охраны Примера", "9000"]
    root = sample("43", "101", "000000000043")
    root[5:8] = ["9000", "Организация Примера", "6935" if cycle else None]
    path = xlsx([child, root])
    if cycle:
        before = [m.objects.count() for m in (Division, Employee, StaffUnit)]
        with pytest.raises(CommandError, match="[Цц]икл"):
            run(path, apply=True)
        assert [m.objects.count() for m in (Division, Employee, StaffUnit)] == before
    else:
        run(path, apply=True)
        division = Division.objects.get(code="6935")
        assert division.parent.code == "9000"
        assert division.parent.parent is None
        assert StaffUnit.objects.get(external_id="100").division == division
        run(path, apply=True)
        assert Division.objects.filter(code__in=["6935", "9000"]).count() == 2


def test_same_names_with_distinct_identifiers_are_distinct_employees(xlsx):
    run(xlsx([sample(), sample("43", "101", "000000000043")]), apply=True)
    assert Employee.objects.count() == 2
    assert StaffUnit.objects.values("employee_id").distinct().count() == 2
