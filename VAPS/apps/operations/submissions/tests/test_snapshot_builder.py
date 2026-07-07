"""Tests for build_division_snapshot (Story 5.3a).

The builder is READ-ONLY: it assembles a self-contained immutable снапшот
``{schema_version, roster, rows}`` for (division, business_date) — roster is the
denominator (every employee of the date-roster, denormalized ФИО + звание), rows
are the acting interval-facts (with status_id + source). It writes nothing.
Data is built directly (no factory_boy), mirroring test_strength_report_service.
"""

import itertools
import json
from datetime import date

import pytest

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    Organization,
    Rank,
)
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.services.strength_report import resolve_status
from apps.operations.submissions.services.snapshot import build_division_snapshot

pytestmark = pytest.mark.django_db

D = date(2026, 6, 4)
_iin_seq = itertools.count(500)


@pytest.fixture
def org():
    return Organization.objects.create(name="Орг", code="ORG-SNAP")


@pytest.fixture
def division(org):
    division_type, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    return Division.objects.create(
        organization=org, type_code=division_type, name="Отдел С", code="SNAP-A"
    )


def make_employee(division, full_name="Сотрудник", rank_code=""):
    n = next(_iin_seq)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=full_name,
        rank_code=rank_code,
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_status(employee, code, date_start, date_end, source="USER", cancelled_at=None):
    return EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source=source,
        cancelled_at=cancelled_at,
    )


def test_self_contained_shape(division):
    on_duty = make_employee(division, "Иванов", "")
    make_status(on_duty, "DUTY", date(2026, 6, 1), date(2026, 6, 10))
    in_service = make_employee(division, "Петров", "")  # no status

    snap = build_division_snapshot(division.id, D)

    assert snap["schema_version"] == 1
    # roster = denominator: BOTH employees, even the status-less one.
    assert {r["employee_id"] for r in snap["roster"]} == {
        str(on_duty.id),
        str(in_service.id),
    }
    # rows = only the acting interval-fact, with status_id + source.
    assert len(snap["rows"]) == 1
    row = snap["rows"][0]
    assert row["employee_id"] == str(on_duty.id)
    assert row["status_type_code"] == "DUTY"
    assert isinstance(row["status_id"], int)
    assert row["source"] == "USER"
    assert row["date_start"] == "2026-06-01"
    assert row["date_end"] == "2026-06-10"


def test_empty_division(division):
    snap = build_division_snapshot(division.id, D)
    assert snap == {"schema_version": 1, "roster": [], "rows": []}


def test_rank_resolved_to_name_with_fallback(division):
    Rank.objects.create(code="CAPT", name="капитан")
    with_rank = make_employee(division, "Иванов", "CAPT")
    no_rank_row = make_employee(division, "Петров", "UNKNOWN")  # rank_code w/o Rank row

    snap = build_division_snapshot(division.id, D)
    by_id = {r["employee_id"]: r for r in snap["roster"]}
    assert by_id[str(with_rank.id)]["rank"] == "капитан"  # resolved Rank.name
    assert by_id[str(no_rank_row.id)]["rank"] == "UNKNOWN"  # fallback to rank_code


def test_cancelled_status_excluded_from_rows(division):
    from django.utils import timezone

    emp = make_employee(division)
    make_status(
        emp, "DUTY", date(2026, 6, 1), date(2026, 6, 10), cancelled_at=timezone.now()
    )
    snap = build_division_snapshot(division.id, D)
    assert snap["rows"] == []
    assert len(snap["roster"]) == 1  # still in the denominator


def test_multiple_acting_facts_per_employee(division):
    emp = make_employee(division)
    # one hard (VACATION) + one soft (DUTY, outside HARD_STATUS_TYPE_CODES so it
    # may overlap) both acting on D — full fidelity, both captured (the derive
    # winner is chosen at read time, not at сдача).
    make_status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
    make_status(emp, "DUTY", date(2026, 6, 3), date(2026, 6, 8))
    snap = build_division_snapshot(division.id, D)
    codes = sorted(r["status_type_code"] for r in snap["rows"])
    assert codes == ["DUTY", "VACATION"]


def test_json_serializable(division):
    emp = make_employee(division, "Иванов", "")
    make_status(emp, "DUTY", date(2026, 6, 1), date(2026, 6, 10))
    snap = build_division_snapshot(division.id, D)
    # uuid -> str, date -> "YYYY-MM-DD": json.dumps must not raise.
    assert json.loads(json.dumps(snap)) == snap


def test_deterministic_order(division):
    emps = [make_employee(division) for _ in range(3)]
    for emp in emps:
        make_status(emp, "DUTY", date(2026, 6, 1), date(2026, 6, 10))

    first = build_division_snapshot(division.id, D)
    second = build_division_snapshot(division.id, D)

    # Cross-build determinism: two independent builds are byte-identical — the
    # basis 5.3b's diff/event and 5.10's property test rely on (NOT a tautology
    # like asserting one build equals its own re-sort).
    assert first == second
    # Canonical ascending order, checked against an INDEPENDENTLY sorted view of
    # the ids (one DUTY status each → one row per employee).
    expected_ids = sorted(str(emp.id) for emp in emps)
    assert [r["employee_id"] for r in first["roster"]] == expected_ids
    assert [r["employee_id"] for r in first["rows"]] == expected_ids


def test_str_division_id_is_coerced(division):
    # Review P1: a str division_id must NOT silently yield an empty snapshot —
    # it is coerced to UUID so the roster_on lookup hits.
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 6, 1), date(2026, 6, 10))
    snap = build_division_snapshot(str(division.id), D)
    assert [r["employee_id"] for r in snap["roster"]] == [str(emp.id)]


def test_malformed_division_id_raises(division):
    # Review P1: a malformed id fails loud (ValueError), not wrong-empty.
    with pytest.raises(ValueError):
        build_division_snapshot("not-a-uuid", D)


def test_rows_are_subset_of_roster(division):
    # Review P2: every fact row maps to a roster (denominator) member.
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 6, 1), date(2026, 6, 10))
    snap = build_division_snapshot(division.id, D)
    roster_ids = {r["employee_id"] for r in snap["roster"]}
    assert {r["employee_id"] for r in snap["rows"]} <= roster_ids


def test_self_containment_derive_from_snapshot(division):
    # AC-5: derive расход from roster+rows ALONE (no roster_on re-query). The
    # status-less employee resolves to IN_SERVICE, the duty one to DUTY.
    on_duty = make_employee(division, "Иванов")
    make_status(on_duty, "DUTY", date(2026, 6, 1), date(2026, 6, 10))
    in_service = make_employee(division, "Петров")

    snap = build_division_snapshot(division.id, D)

    # Re-derive each roster member's status purely from the snapshot rows.
    def derived(employee_id):
        rows = [
            {
                "status_type_code": r["status_type_code"],
                "date_start": date.fromisoformat(r["date_start"]),
                "date_end": date.fromisoformat(r["date_end"]),
            }
            for r in snap["rows"]
            if r["employee_id"] == employee_id
        ]
        return resolve_status(rows, D)

    assert derived(str(on_duty.id)) == "DUTY"
    assert derived(str(in_service.id)) == "IN_SERVICE"
