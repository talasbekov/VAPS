"""Story 2.7 — CSV import of positions/ranks (FR-39).

Idempotent upsert on ``code`` with a per-row error report (CSV line + reason);
a bad row never aborts the import of the others.
"""

from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.models import Position, Rank

pytestmark = pytest.mark.django_db


def _run(**kwargs):
    out = StringIO()
    call_command("import_references", stdout=out, **kwargs)
    return out.getvalue()


def _write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return str(path)


# -- positions: happy path + idempotency -------------------------------------


def test_imports_valid_positions(tmp_path):
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\n"
        "OPER,Оперуполномоченный,4,40\n"
        "NACH_OTD,Начальник отдела,3,30\n",
    )
    report = _run(positions=csv_path)

    assert Position.objects.count() == 2
    oper = Position.objects.get(code="OPER")
    assert oper.name == "Оперуполномоченный"
    assert oper.level == 4 and oper.sort_order == 40
    assert oper.is_active is True  # default preserved (not in CSV)
    assert "positions: read 2, created 2, updated 0, skipped 0" in report


def test_rerun_is_idempotent(tmp_path):
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\nOPER,Опер,4,40\nNACH,Начальник,1,5\n",
    )
    _run(positions=csv_path)
    second = _run(positions=csv_path)

    assert Position.objects.count() == 2
    assert "positions: read 2, created 0, updated 2, skipped 0" in second


def test_blank_int_columns_default_to_zero(tmp_path):
    csv_path = _write(
        tmp_path, "pos.csv", "code,name,level,sort_order\nX,Икс,,\n"
    )
    _run(positions=csv_path)
    x = Position.objects.get(code="X")
    assert x.level == 0 and x.sort_order == 0


# -- positions: bad rows are reported with line + reason, others still import -


def test_invalid_level_skipped_with_line_number(tmp_path):
    # header=line1, OPER=line2, BAD=line3 (invalid level), NACH=line4
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\n"
        "OPER,Опер,4,40\n"
        "BAD,Плохой,abc,10\n"
        "NACH,Начальник,1,5\n",
    )
    report = _run(positions=csv_path)

    assert set(Position.objects.values_list("code", flat=True)) == {"OPER", "NACH"}
    assert not Position.objects.filter(code="BAD").exists()
    assert "read 3, created 2, updated 0, skipped 1" in report
    assert "invalid_level: 1" in report
    assert "3:BAD" in report  # the CSV line number is in the report


def test_empty_code_skipped(tmp_path):
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\n,Безкода,1,1\nOK,Норм,1,1\n",
    )
    report = _run(positions=csv_path)
    assert set(Position.objects.values_list("code", flat=True)) == {"OK"}
    assert "empty_code: 1" in report


def test_duplicate_code_in_file_reported(tmp_path):
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\nDUP,Первый,1,1\nDUP,Второй,2,2\n",
    )
    report = _run(positions=csv_path)

    assert Position.objects.count() == 1
    # first occurrence wins; second is reported, not applied
    assert Position.objects.get(code="DUP").name == "Первый"
    assert "duplicate_in_file: 1" in report


def test_empty_name_skipped(tmp_path):
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\nNONAME,,1,1\nOK,Норм,1,1\n",
    )
    report = _run(positions=csv_path)
    assert set(Position.objects.values_list("code", flat=True)) == {"OK"}
    assert "empty_name: 1" in report


def test_short_row_reported_as_malformed(tmp_path):
    # SHORT row carries only 2 of the 4 header columns; OK row is complete.
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\nOK,Норм,1,1\nSHORT,Обрезок\n",
    )
    report = _run(positions=csv_path)
    assert set(Position.objects.values_list("code", flat=True)) == {"OK"}
    assert not Position.objects.filter(code="SHORT").exists()
    assert "malformed_row: 1" in report


def test_long_row_reported_as_malformed(tmp_path):
    # LONG row carries an extra trailing field beyond the 4 header columns.
    csv_path = _write(
        tmp_path,
        "pos.csv",
        "code,name,level,sort_order\nOK,Норм,1,1\nLONG,Длинный,2,2,extra\n",
    )
    report = _run(positions=csv_path)
    assert set(Position.objects.values_list("code", flat=True)) == {"OK"}
    assert not Position.objects.filter(code="LONG").exists()
    assert "malformed_row: 1" in report


# -- ranks --------------------------------------------------------------------


def test_imports_ranks_with_nullable_category(tmp_path):
    csv_path = _write(
        tmp_path,
        "ranks.csv",
        "code,name,category,rank_index\n"
        "MAJOR,Майор,officer,30\n"
        "NOCAT,Безкатегории,,5\n",
    )
    report = _run(ranks=csv_path)

    assert Rank.objects.get(code="MAJOR").category == "officer"
    assert Rank.objects.get(code="NOCAT").category is None
    assert Rank.objects.get(code="NOCAT").rank_index == 5
    assert "ranks: read 2, created 2, updated 0, skipped 0" in report


def test_invalid_rank_index_reported(tmp_path):
    csv_path = _write(
        tmp_path,
        "ranks.csv",
        "code,name,category,rank_index\nBAD,Плохой,officer,xx\n",
    )
    report = _run(ranks=csv_path)
    assert not Rank.objects.filter(code="BAD").exists()
    assert "invalid_rank_index: 1" in report


# -- one run, two sub-reports -------------------------------------------------


def test_both_files_one_run_two_subreports(tmp_path):
    pos = _write(tmp_path, "pos.csv", "code,name,level,sort_order\nP,П,1,1\n")
    ranks = _write(
        tmp_path, "ranks.csv", "code,name,category,rank_index\nR,Р,officer,1\n"
    )
    report = _run(positions=pos, ranks=ranks)

    assert Position.objects.filter(code="P").exists()
    assert Rank.objects.filter(code="R").exists()
    assert "positions: read 1, created 1" in report
    assert "ranks: read 1, created 1" in report


# -- guard rails --------------------------------------------------------------


def test_no_flags_raises():
    with pytest.raises(CommandError, match="nothing to import"):
        call_command("import_references")


def test_missing_file_raises(tmp_path):
    missing = str(tmp_path / "nope.csv")
    with pytest.raises(CommandError) as excinfo:
        call_command("import_references", positions=missing)
    # AC-5: the error message carries the offending path.
    assert "file not found" in str(excinfo.value)
    assert missing in str(excinfo.value)


def test_missing_required_column_raises(tmp_path):
    csv_path = _write(tmp_path, "pos.csv", "code,name\nX,Икс\n")  # no level/sort_order
    with pytest.raises(CommandError):
        call_command("import_references", positions=csv_path)
