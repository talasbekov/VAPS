import pytest
from openpyxl import Workbook

from organization_management.apps.staff_unit.roster_xlsx import (
    HEADERS,
    infer_divisions,
    read_roster,
)


def workbook(tmp_path, rows):
    path = tmp_path / "roster.xlsx"
    book = Workbook()
    book.active.append(list(HEADERS))
    for row in rows:
        book.active.append(row)
    book.save(path)
    return path


def sample(person="42", slot="100", iin="000000000042"):
    return [
        iin,
        person,
        "Тестов",
        "Тест",
        None,
        "6661",
        "4 отдел 2 управления Службы охраны Примера",
        "6984",
        "P1",
        "НАЧАЛЬНИК ОТДЕЛА",
        slot,
        8,
        "C-S-5",
        "капитан",
        "R1",
    ]


def test_reads_ids_without_losing_zeroes_and_optional_middle_name(tmp_path):
    result = read_roster(workbook(tmp_path, [sample()]))
    assert result.errors == []
    assert result.rows[0]["iin"] == "000000000042"
    assert result.rows[0]["middle_name"] == ""
    assert result.rows[0]["person_id"] == "42"


def test_same_order_is_allowed_but_duplicate_slot_is_not(tmp_path):
    result = read_roster(
        workbook(tmp_path, [sample(), sample("43", "101", "000000000043")])
    )
    assert not result.errors
    result = read_roster(
        workbook(tmp_path, [sample(), sample("43", "100", "000000000043")])
    )
    assert any("штатной единицы" in e for e in result.errors)


def test_short_iin_not_silently_padded(tmp_path):
    path = workbook(tmp_path, [sample(iin=123456789)])
    assert read_roster(path).errors
    result = read_roster(path, skip_invalid_iin=True)
    assert not result.errors
    assert result.rows[0]["iin"] is None
    assert result.warnings


def test_formula_is_never_evaluated(tmp_path):
    row = sample()
    row[2] = "=1+1"
    assert any(
        "формул" in e.lower() for e in read_roster(workbook(tmp_path, [row])).errors
    )


def test_conflicting_division_parent_rejected(tmp_path):
    other = sample("43", "101", "000000000043")
    other[7] = "9999"
    assert any(
        "подразделения" in e
        for e in read_roster(workbook(tmp_path, [sample(), other])).errors
    )


def test_infers_named_hierarchy_and_preserves_known_codes(tmp_path):
    result = read_roster(workbook(tmp_path, [sample()]))
    nodes, errors, warnings = infer_divisions(result.rows)
    assert not errors
    assert nodes["6661"]["name"] == "4 отдел"
    assert nodes["6661"]["parent_code"] == "6984"
    assert nodes["6984"]["name"] == "2 управление"
    assert nodes["6984"]["division_type"] == "directorate"
    root = nodes[nodes["6984"]["parent_code"]]
    assert root["division_type"] == "organization"
    assert root["name"] == "Служба охраны Примера"
    assert warnings


def test_unstructured_name_requires_explicit_parent(tmp_path):
    row = sample()
    row[6] = "Группа специального назначения"
    nodes, errors, _ = infer_divisions(read_roster(workbook(tmp_path, [row])).rows)
    assert not errors
    assert nodes["6661"]["parent_code"] == "6984"
    assert "6984" not in nodes
    assert nodes["6661"]["division_type"] is None


def test_vacancy_without_person_is_valid(tmp_path):
    row = sample()
    row[:5] = [None] * 5
    row[13:] = [None, None]
    result = read_roster(workbook(tmp_path, [row]))
    assert not result.errors
    assert result.rows[0]["person_id"] == ""


def test_real_parent_code_replaces_inferred_code_for_full_export(tmp_path):
    row = sample("43", "101", "000000000043")
    row[5:8] = ["6984", "2 управление Службы охраны Примера", "ORG-1"]
    nodes, errors, _ = infer_divisions(
        read_roster(workbook(tmp_path, [sample(), row])).rows
    )
    assert not errors
    assert nodes["6984"]["parent_code"] == "ORG-1"
    assert nodes["ORG-1"]["name"] == "Служба охраны Примера"
    assert len(nodes) == 3


def test_full_export_with_explicit_organization_row_has_one_root(tmp_path):
    parent = sample("43", "101", "000000000043")
    parent[5:8] = ["6984", "2 управление Службы охраны Примера", "ORG-1"]
    root = sample("44", "102", "000000000044")
    root[5:8] = ["ORG-1", "Служба охраны Примера", None]
    for rows in ([sample(), parent, root], [root, parent, sample()]):
        nodes, errors, _ = infer_divisions(read_roster(workbook(tmp_path, rows)).rows)
        assert not errors
        assert len(nodes) == 3
        assert nodes["ORG-1"]["division_type"] == "organization"
        assert nodes["ORG-1"]["parent_code"] is None


@pytest.mark.parametrize("reverse", [False, True])
def test_raw_parent_conflict_is_rejected_in_either_order(tmp_path, reverse):
    other = sample("43", "101", "000000000043")
    other[5:8] = ["6984", "Несвязанное управление", "OTHER"]
    rows = [sample(), other]
    if reverse:
        rows.reverse()
    roster = read_roster(workbook(tmp_path, rows))
    assert not roster.errors
    _, errors, _ = infer_divisions(roster.rows)
    assert any("Противоречие дерева" in e for e in errors)


@pytest.mark.parametrize("reverse", [False, True])
def test_matching_raw_parent_keeps_inferred_type_in_either_order(tmp_path, reverse):
    other = sample("43", "101", "000000000043")
    other[5:8] = ["6984", "2 управление", "ORG-1"]
    root = sample("44", "102", "000000000044")
    root[5:8] = ["ORG-1", "Служба охраны Примера", None]
    rows = [sample(), other, root]
    if reverse:
        rows.reverse()
    nodes, errors, _ = infer_divisions(read_roster(workbook(tmp_path, rows)).rows)
    assert not errors
    assert nodes["6984"]["division_type"] == "directorate"
    assert nodes["6984"]["parent_code"] == "ORG-1"
    assert len(nodes) == 3


def test_invalid_zip_is_reported(tmp_path):
    path = tmp_path / "invalid.xlsx"
    path.write_bytes(b"not a zip file")
    result = read_roster(path)
    assert result.errors and not result.rows


def test_unexpected_reader_failure_is_not_hidden(tmp_path, monkeypatch):
    from organization_management.apps.staff_unit import roster_xlsx

    def broken_reader(*args, **kwargs):
        raise RuntimeError("unexpected reader bug")

    monkeypatch.setattr(roster_xlsx, "load_workbook", broken_reader)
    with pytest.raises(RuntimeError, match="unexpected reader bug"):
        read_roster(tmp_path / "input.xlsx")
