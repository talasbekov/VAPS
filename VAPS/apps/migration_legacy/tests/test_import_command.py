import io
import json
from datetime import date, datetime, timezone as dt_timezone
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
    Position,
    Rank,
)
from apps.core.selectors import local_midnight
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services import StrengthReportService

FIXTURE = Path(__file__).parent / "fixtures" / "donor_slice.json"

pytestmark = pytest.mark.django_db


def run_import(*extra):
    out = io.StringIO()
    call_command(
        "import_donor_slice",
        str(FIXTURE),
        "--days",
        "7",
        "--until",
        "2026-06-07",
        *extra,
        stdout=out,
    )
    return out.getvalue()


def statuses_of(external_id):
    employee = Employee.objects.get(external_id=external_id)
    return EmployeeStatus.objects.filter(employee_id=employee.id)


class TestHappyPath:
    def test_employees_created_with_identity_mapping(self):
        run_import()
        # AC-1: mapping заполнен — external_id is the donor pk.
        assert Employee.objects.exclude(external_id=None).count() == 3
        emp = Employee.objects.get(external_id="1")
        assert emp.iin == "850101300101"
        assert emp.data_source == "DONOR"
        assert emp.division.code == "DEP1"
        assert emp.full_name == "Иванов Иван Иванович"
        assert emp.personnel_number == "PN001"
        assert emp.rank_code == "RANK_1"
        assert emp.rank_index == 5
        assert emp.position_code == "POS_1"
        assert emp.employment_status == "WORKING"
        assert emp.created_by is None

    def test_employee_without_rank_and_position_gets_empty_codes(self):
        run_import()
        emp = Employee.objects.get(external_id="3")
        assert emp.rank_code == ""
        assert emp.rank_index == 0
        assert emp.position_code == ""
        assert emp.employment_status == "FIRED"

    def test_org_structure_and_dictionaries(self):
        run_import()
        org = Organization.objects.get(code="ORG1")
        assert org.name == "Донор-Орг"
        dep = Division.objects.get(code="DEP1")
        dir_ = Division.objects.get(code="DIR1")
        assert dep.organization == org
        assert dep.parent is None  # parent was the organization root
        assert dir_.parent == dep
        assert dep.type_code.code == "department"
        # Donor literal codes, no invented names (Glossary STOP).
        assert DivisionType.objects.filter(
            code="directorate", name="directorate"
        ).exists()
        assert Rank.objects.filter(code="RANK_1", name="Майор", rank_index=5).exists()
        assert Position.objects.filter(
            code="POS_2", name="Начальник отдела", level=3
        ).exists()

    def test_status_dates_converted_inclusive_to_half_open(self):
        run_import()
        vacation = statuses_of("1").get()
        # Donor 02.06–05.06 inclusive -> VAPS [2026-06-02, 2026-06-06).
        assert vacation.status_type_code == "VACATION"
        assert vacation.date_start == date(2026, 6, 2)
        assert vacation.date_end == date(2026, 6, 6)

    def test_statuses_of_employee_two(self):
        run_import()
        rows = {s.status_type_code: s for s in statuses_of("2")}
        assert set(rows) == {"DETACHED", "STUDY", "COMPETITION"}
        # Open end clamped to window_end + 1.
        assert rows["DETACHED"].date_start == date(2026, 6, 3)
        assert rows["DETACHED"].date_end == date(2026, 6, 8)
        # actual_end_date wins over end_date for completed.
        assert rows["STUDY"].date_end == date(2026, 6, 5)
        # One-day donor status -> [D, D+1).
        assert rows["COMPETITION"].date_start == date(2026, 6, 6)
        assert rows["COMPETITION"].date_end == date(2026, 6, 7)


def division_row(pk, name, code, division_type, parent):
    return {
        "model": "divisions.division",
        "pk": pk,
        "fields": {
            "name": name,
            "code": code,
            "division_type": division_type,
            "parent": parent,
        },
    }


def employee_row(pk, iin, personnel_number, employment_status="working"):
    return {
        "model": "employees.employee",
        "pk": pk,
        "fields": {
            "personnel_number": personnel_number,
            "last_name": "Тестов",
            "first_name": "Тест",
            "middle_name": "",
            "birth_date": "1990-01-01",
            "gender": "M",
            "iin": iin,
            "rank": None,
            "hire_date": "2015-01-01",
            "dismissal_date": None,
            "employment_status": employment_status,
        },
    }


def staff_unit_row(pk, employee, division=2):
    return {
        "model": "staff_unit.staffunit",
        "pk": pk,
        "fields": {"division": division, "position": None, "employee": employee},
    }


def make_export(tmp_path, extra_rows):
    """Minimal valid export (org + department + one employee) + extra rows."""
    rows = [
        division_row(1, "Орг", "ORG9", "organization", None),
        division_row(2, "Деп", "DEP9", "department", 1),
        employee_row(1, "900101300999", "PN901"),
        staff_unit_row(1, employee=1),
    ]
    rows.extend(extra_rows)
    path = tmp_path / "export.json"
    path.write_text(json.dumps(rows), encoding="utf-8")
    return path


def status_row(pk, **overrides):
    fields = {
        "employee": 1,
        "status_type": "vacation",
        "state": "active",
        "start_date": "2026-06-02",
        "end_date": "2026-06-05",
        "actual_end_date": None,
        "updated_at": "2026-05-01T00:00:00Z",
    }
    fields.update(overrides)
    return {"model": "statuses.employeestatus", "pk": pk, "fields": fields}


class TestIdempotency:
    def test_second_run_creates_nothing(self):
        run_import()
        counts = (
            Employee.objects.count(),
            EmployeeStatus.objects.count(),
            Division.objects.count(),
            Organization.objects.count(),
            Rank.objects.count(),
            Position.objects.count(),
        )
        out = run_import()
        assert (
            Employee.objects.count(),
            EmployeeStatus.objects.count(),
            Division.objects.count(),
            Organization.objects.count(),
            Rank.objects.count(),
            Position.objects.count(),
        ) == counts
        assert "employees: read 6, created 0, updated 3, skipped 3" in out
        assert "statuses: read 12, created 0" in out
        assert "already_exists" in out
        # The shortened-interval counter is window-derived, not
        # create-derived: it must not collapse to 0 on a repeat run.
        assert "open_end_clamped: 1" in out

    def test_rerun_with_wider_window_does_not_duplicate_clamped(self):
        run_import()
        counts = EmployeeStatus.objects.count()
        # Same window start, until moved by one day: the clamped DETACHED
        # row (pk 105) gets a different date_end and must still match its
        # already-imported version by (employee, type, date_start).
        out = io.StringIO()
        call_command(
            "import_donor_slice",
            str(FIXTURE),
            "--days",
            "8",
            "--until",
            "2026-06-08",
            stdout=out,
        )
        assert EmployeeStatus.objects.count() == counts
        assert statuses_of("2").filter(status_type_code="DETACHED").count() == 1
        assert "already_exists" in out.getvalue()


class TestSkips:
    def test_employee_skips(self):
        run_import()
        # Without IIN, without staff_unit, duplicate IIN: not created.
        for donor_pk in ("4", "5", "7"):
            assert not Employee.objects.filter(external_id=donor_pk).exists()
        assert Employee.objects.count() == 3

    def test_skipped_employee_statuses_not_imported(self):
        run_import()
        # Employee 4 was skipped: its in-window vacation must not appear.
        assert EmployeeStatus.objects.count() == 6

    def test_in_service_out_of_window_unknown_not_imported(self):
        run_import()
        codes = set(EmployeeStatus.objects.values_list("status_type_code", flat=True))
        assert codes == {"VACATION", "DETACHED", "STUDY", "COMPETITION"}
        assert "COMMAND" not in codes  # out-of-window business_trip

    def test_hard_overlap_survival(self):
        # Donor hard×hard overlap: first row (by date_start) wins, second
        # is skipped, the command finishes without raising.
        out = run_import()
        emp1_rows = list(statuses_of("1"))
        assert len(emp1_rows) == 1
        assert emp1_rows[0].status_type_code == "VACATION"
        assert "hard_overlap: 1" in out

    def test_cancelled_status_created_and_not_blocking(self):
        run_import()
        rows = statuses_of("3").order_by("date_start")
        cancelled, live = rows
        assert cancelled.cancelled_at == datetime(
            2026, 5, 30, 12, 0, tzinfo=dt_timezone.utc
        )
        assert cancelled.date_start == date(2026, 5, 28)
        assert cancelled.date_end == date(2026, 6, 11)
        # The live hard VACATION overlaps the cancelled one — legal.
        assert live.cancelled_at is None
        assert live.date_start == date(2026, 6, 1)


class TestReport:
    def test_report_contains_counters_and_reasons(self):
        out = run_import()
        assert "window [2026-06-01..2026-06-07]" in out
        assert "divisions: read 2, created 2" in out
        assert "organizations: read 1, created 1" in out
        assert "ranks: read 2, created 2" in out
        assert "positions: read 2, created 2" in out
        assert "employees: read 6, created 3, updated 0, skipped 3" in out
        assert "statuses: read 12, created 6" in out
        assert "missing_iin: 1 (examples: 4)" in out
        assert "no_division: 1 (examples: 5)" in out
        assert "duplicate_iin: 1 (examples: 7)" in out
        assert "in_service_derived: 1 (examples: 103)" in out
        assert "out_of_window: 1 (examples: 104)" in out
        assert "unknown_status_type: 1 (examples: 109)" in out
        assert "no_employee: 1 (examples: 110)" in out
        assert "employee_skipped: 1 (examples: 108)" in out
        assert "hard_overlap: 1 (examples: 102)" in out
        assert "open_end_clamped: 1" in out

    def test_until_defaults_to_max_date_in_export(self):
        out = io.StringIO()
        call_command("import_donor_slice", str(FIXTURE), "--days", "7", stdout=out)
        # Max of start/end/actual_end in the export is 2026-06-10 (pk 106).
        assert "window [2026-06-04..2026-06-10]" in out.getvalue()


def run_export(path, *extra):
    out = io.StringIO()
    call_command(
        "import_donor_slice",
        str(path),
        "--days",
        "7",
        "--until",
        "2026-06-07",
        *extra,
        stdout=out,
    )
    return out.getvalue()


class TestStaffingSlots:
    # Sanctioned by the 1.6 handoff: staff slots materialize in 1.7.

    def test_slots_created_from_staff_units_including_vacant(self):
        run_import()
        dep_slot = DivisionHistoricalSlot.objects.get(
            division=Division.objects.get(code="DEP1")
        )
        # DEP1 carries donor staff_units 1, 3, 4, 7 + the vacant pk 5
        # (employee=null) — vacancies of the donor count into Штат.
        assert dep_slot.allocated_slots == 5
        assert dep_slot.valid_from == local_midnight(date(2026, 6, 1))
        assert dep_slot.valid_to is None
        dir_slot = DivisionHistoricalSlot.objects.get(
            division=Division.objects.get(code="DIR1")
        )
        assert dir_slot.allocated_slots == 1

    def test_second_run_is_idempotent(self):
        run_import()
        out = run_import()
        assert DivisionHistoricalSlot.objects.count() == 2
        assert "staffing_slots: read 6, created 0, updated 2, skipped 0" in out

    def test_report_block_present(self):
        out = run_import()
        assert "staffing_slots: read 6, created 2, updated 0, skipped 0" in out
        assert "staffing divisions covered: 2" in out

    def test_slot_without_division_skipped(self, tmp_path):
        path = make_export(
            tmp_path, [staff_unit_row(99, employee=None, division=None)]
        )
        out = run_export(path)
        assert "slot_no_division: 1 (examples: 99)" in out

    def test_slot_for_unimported_division_skipped(self, tmp_path):
        path = make_export(
            tmp_path, [staff_unit_row(98, employee=None, division=777)]
        )
        out = run_export(path)
        assert "slot_division_skipped: 1 (examples: 777)" in out

    def test_collapsed_division_codes_sum_slots(self, tmp_path):
        # C2/KO-2: two donor divisions sharing (organization, code) collapse
        # into ONE Division; their staff_unit counts must SUM into Штат, not
        # overwrite with the last donor pk — and "covered" counts it once.
        path = make_export(
            tmp_path,
            [
                division_row(3, "Деп-дубль", "DEP9", "department", 1),
                staff_unit_row(10, employee=None, division=3),
            ],
        )
        out = run_export(path)
        division = Division.objects.get(code="DEP9")
        slot = DivisionHistoricalSlot.objects.get(division=division)
        # donor staff_unit 1 (division 2) + 10 (division 3) collapse onto DEP9.
        assert slot.allocated_slots == 2
        assert DivisionHistoricalSlot.objects.count() == 1
        assert "staffing divisions covered: 1" in out

    def test_changed_slot_count_updates_same_window_row(self, tmp_path):
        path = make_export(tmp_path, [])
        run_export(path)
        wider = make_export(tmp_path, [staff_unit_row(50, employee=None)])
        run_export(wider)
        # Same window -> same valid_from: the row is updated, not duplicated
        # (allocated_slots lives in defaults, not in the lookup).
        slot = DivisionHistoricalSlot.objects.get(
            division=Division.objects.get(code="DEP9")
        )
        assert slot.allocated_slots == 2
        assert DivisionHistoricalSlot.objects.count() == 1

    def test_compute_on_imported_fixture_converges(self):
        # Сквозной AC-1: Штат = Список + Вакансии and Список = Σ статусов
        # on real imported donor data.
        run_import()
        result = StrengthReportService.compute(date(2026, 6, 4))
        assert result.violations == []
        assert result.warnings == []
        for row in result.rows:
            assert row.staff_total == row.list_total + row.vacancies
            assert sum(row.columns.values()) == row.list_total
        by_code = {
            Division.objects.get(code=code).id: code for code in ("DEP1", "DIR1")
        }
        rows = {by_code[r.division_id]: r for r in result.rows}
        dep = rows["DEP1"]
        assert (dep.staff_total, dep.list_total, dep.vacancies) == (5, 1, 4)
        assert dep.columns["VACATION"] == 1  # emp 1 on vacation 02–05.06
        dir_ = rows["DIR1"]
        assert (dir_.staff_total, dir_.list_total, dir_.vacancies) == (1, 1, 0)
        # emp 2: STUDY (prio 32) beats DETACHED (40) on 04.06.
        assert dir_.columns["TRAINING"] == 1


class TestDirtyInputSurvival:
    # Review findings of 1.6: donor dirt must end up in the report, not in
    # a traceback that aborts the whole transaction.

    def test_days_zero_rejected(self):
        with pytest.raises(CommandError, match="--days"):
            run_export(FIXTURE, "--days", "0")

    def test_malformed_status_date_is_skipped_not_fatal(self, tmp_path):
        path = make_export(
            tmp_path,
            [
                status_row(201, start_date="31.05.2026"),
                status_row(202, start_date=None),
                status_row(203, start_date="2026-06-03", end_date="2026-06-04"),
            ],
        )
        out = run_export(path)
        # The clean row survives its dirty neighbours.
        assert EmployeeStatus.objects.count() == 1
        assert "invalid_dates: 2 (examples: 201, 202)" in out

    def test_unknown_employment_status_skips_employee(self, tmp_path):
        path = make_export(
            tmp_path,
            [
                employee_row(2, "910101300888", "PN902", employment_status="suspended"),
                staff_unit_row(2, employee=2),
            ],
        )
        out = run_export(path)
        assert not Employee.objects.filter(external_id="2").exists()
        assert "unknown_employment_status: 1 (examples: 2)" in out

    def test_clamped_open_end_hard_status_does_not_displace_real_one(self, tmp_path):
        # D2: the open-end SICK_LEAVE stretches over the whole window via
        # the clamp; inserted last, it loses to the real closed VACATION
        # and is reported as a clamp artifact, not as donor data quality.
        path = make_export(
            tmp_path,
            [
                status_row(
                    301,
                    status_type="sick_leave",
                    start_date="2026-06-01",
                    end_date=None,
                ),
                status_row(
                    302,
                    status_type="vacation",
                    start_date="2026-06-03",
                    end_date="2026-06-05",
                ),
            ],
        )
        out = run_export(path)
        codes = list(EmployeeStatus.objects.values_list("status_type_code", flat=True))
        assert codes == ["VACATION"]
        assert "overlap_with_clamped: 1 (examples: 301)" in out
        assert "hard_overlap: 0" in out

    def test_parent_cycle_does_not_hang(self, tmp_path):
        path = make_export(
            tmp_path,
            [
                division_row(10, "A", "CYC-A", "department", 11),
                division_row(11, "B", "CYC-B", "department", 10),
            ],
        )
        run_export(path)  # must terminate
        # Cycle members land under the fallback organization.
        fallback = Organization.objects.get(code="DONOR")
        assert (
            Division.objects.filter(
                code__in=["CYC-A", "CYC-B"], organization=fallback
            ).count()
            == 2
        )

    def test_dangling_parent_reported_as_warning(self, tmp_path):
        path = make_export(
            tmp_path,
            [division_row(20, "Сирота", "ORPH", "department", 999)],
        )
        out = run_export(path)
        orphan = Division.objects.get(code="ORPH")
        assert orphan.parent is None
        assert "dangling_parent: 1 (examples: 20)" in out
