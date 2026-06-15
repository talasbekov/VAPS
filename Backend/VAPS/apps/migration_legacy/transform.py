"""Pure transformation of donor dumpdata rows into VAPS-shaped rows.

No ORM and no Django imports (architecture.md: migration logic stays
DB-free); the module moves into the root migration/ package in E7
without rewriting. Input dicts are the ``fields`` payload of a donor
``manage.py dumpdata`` row.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

# Donor lowercase codes -> target codes of spec DB-OPS-003.
# in_service is deliberately NOT here: derived-first (story 3.7 — a date
# without an interval IS "В строю"), its intervals are skipped as
# in_service_derived.
DONOR_STATUS_TYPE_MAP = {
    "vacation": "VACATION",
    "leave_by_report": "LEAVE_BY_REPORT",
    "sick_leave": "SICK_LEAVE",
    "business_trip": "COMMAND",
    "training": "STUDY",
    "competition": "COMPETITION",
    # OTHER_ABSENCE is absent from the DB-OPS-003 seed: deliberate literal
    # carry-over; candidate for the registry/spec — to be fixed in story
    # 1.12 (inventory) and accounted for in seed 2.2.
    "other_absence": "OTHER_ABSENCE",
    "on_duty": "DUTY",
    "after_duty": "REST_AFTER_DUTY",
    "seconded_from": "ATTACHED",
    "seconded_to": "DETACHED",
}

EMPLOYMENT_STATUS_MAP = {"working": "WORKING", "fired": "FIRED"}

# Same shape as apps.core.validators.iin_validator; duplicated here on
# purpose: update_or_create never runs model validators, so the import
# boundary check is this regex, not the model field.
IIN_RE = re.compile(r"^[0-9]{12}$")


@dataclass(frozen=True)
class Skip:
    reason: str


@dataclass(frozen=True)
class StatusRow:
    employee_pk: int
    status_type_code: str
    date_start: date
    date_end: date
    cancelled_at: datetime | None
    open_end_clamped: bool = False


@dataclass(frozen=True)
class EmployeeRow:
    iin: str
    personnel_number: str | None
    last_name: str
    first_name: str
    middle_name: str
    birth_date: date | None
    gender: str | None
    hire_date: date | None
    dismissal_date: date | None
    employment_status: str
    rank_pk: int | None


def _parse_date(value):
    return date.fromisoformat(value) if value else None


def transform_status(raw, window_start, window_end):
    """Donor employeestatus fields -> StatusRow in [start, end) or Skip.

    Donor dates are inclusive (proof: reports/data_aggregator.py treats
    active-on-date as end_date >= ref_date), so the effective donor end
    gets +1 day to become the half-open VAPS date_end (ARCH-DATA-023).
    """
    employee_pk = raw.get("employee")
    if employee_pk is None:
        # Donor FK is SET_NULL — orphaned statuses are real.
        return Skip("no_employee")

    status_type = raw.get("status_type")
    if status_type == "in_service":
        return Skip("in_service_derived")
    status_type_code = DONOR_STATUS_TYPE_MAP.get(status_type)
    if status_type_code is None:
        # STOP semantics on data: never invent a code.
        return Skip("unknown_status_type")

    state = raw.get("state")
    try:
        date_start = _parse_date(raw.get("start_date"))
        # Early termination: the fact lives in actual_end_date once completed.
        if state == "completed" and raw.get("actual_end_date"):
            eff_end = _parse_date(raw["actual_end_date"])
        else:
            eff_end = _parse_date(raw.get("end_date"))
    except (TypeError, ValueError):
        # Malformed date strings are donor dirt, not a crash: the import
        # must survive and report (same contract as the DB-level skips).
        return Skip("invalid_dates")
    if date_start is None:
        # Donor start_date is NOT NULL, so this only happens on a broken
        # export — but None > date is a TypeError that would kill the run.
        return Skip("invalid_dates")

    # Window filter in donor (inclusive) semantics.
    if date_start > window_end or (eff_end is not None and eff_end < window_start):
        return Skip("out_of_window")

    if eff_end is None:
        # Open end (secondments, PLANNED): clamp by the slice. Within the
        # window the derived answers of 1.7 are identical for any value
        # >= window_end + 1; the full open-interval policy is E7.
        date_end = window_end + timedelta(days=1)
        open_end_clamped = True
    else:
        date_end = eff_end + timedelta(days=1)
        open_end_clamped = False

    if date_start >= date_end:
        return Skip("invalid_dates")

    cancelled_at = None
    if state == "cancelled":
        # Best-effort cancellation timestamp; state itself is not carried —
        # state in VAPS is derived (ARCH-DATA-022).
        try:
            cancelled_at = datetime.fromisoformat(raw.get("updated_at") or "")
        except (TypeError, ValueError):
            cancelled_at = None

    return StatusRow(
        employee_pk=employee_pk,
        status_type_code=status_type_code,
        date_start=date_start,
        date_end=date_end,
        cancelled_at=cancelled_at,
        open_end_clamped=open_end_clamped,
    )


def count_staff_slots(staff_unit_rows):
    """Donor staff_unit dumpdata rows -> (division_pk -> slot count, skips).

    EVERY staff_unit with a division counts — including employee=NULL:
    vacant slots ARE the donor's vacancies, and Штат = count(staff_units)
    is the same source the donor aggregator uses (parity for the 1.8 diff,
    Решение №5 стори 1.7). division=NULL goes to the skip counter.
    """
    counts: dict = {}
    skips: dict = {"slot_no_division": []}
    for row in staff_unit_rows:
        division_pk = row["fields"].get("division")
        if division_pk is None:
            skips["slot_no_division"].append(row["pk"])
            continue
        counts[division_pk] = counts.get(division_pk, 0) + 1
    return counts, skips


def transform_employee(raw):
    """Donor employee fields -> EmployeeRow or Skip (with its statuses)."""
    iin = raw.get("iin")
    if not iin:
        # VAPS iin is NOT NULL unique; a fake IIN would poison master data
        # (donor's death cause #1) — skip honestly, decision in 1.11/7.1.
        return Skip("missing_iin")
    # fullmatch, not match: "$" matches before a trailing newline and would
    # let "...\n" through; non-string iin in a hand-edited export is dirt.
    if not isinstance(iin, str) or not IIN_RE.fullmatch(iin):
        return Skip("invalid_iin")

    employment_status = EMPLOYMENT_STATUS_MAP.get(raw.get("employment_status"))
    if employment_status is None:
        # STOP semantics, same as unknown status types: never carry an
        # uninvented code into master data.
        return Skip("unknown_employment_status")

    try:
        birth_date = _parse_date(raw.get("birth_date"))
        hire_date = _parse_date(raw.get("hire_date"))
        dismissal_date = _parse_date(raw.get("dismissal_date"))
    except (TypeError, ValueError):
        return Skip("invalid_dates")

    return EmployeeRow(
        iin=iin,
        personnel_number=raw.get("personnel_number"),
        last_name=raw.get("last_name") or "",
        first_name=raw.get("first_name") or "",
        middle_name=raw.get("middle_name") or "",
        birth_date=birth_date,
        gender=raw.get("gender"),
        hire_date=hire_date,
        dismissal_date=dismissal_date,
        employment_status=employment_status,
        rank_pk=raw.get("rank"),
    )
