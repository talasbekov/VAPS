"""Story 7.3 — идемпотентный импорт сотрудников с identity mapping и
явной детекцией кандидатов на слияние дублей (санкция человеком, не
автослияние — донор умер именно от молчаливых дублей, см. epics.md).

Ядро write-логики (``update_or_create``+IntegrityError-safety-net)
перенесено из ``import_donor_slice.Command._import_employees`` (Story 1.6)
буквально; вокруг него — НОВАЯ логика группировки по ИИН с fallback внутри
группы (см. ``import_employees`` docstring). ``import_donor_slice`` и новая
``import_donor_employees`` (7.3) вызывают ЭТУ функцию, не свои копии.

Требует ORM — создаёт/обновляет ``Employee``.
"""

from django.db import IntegrityError, transaction

from apps.core.models import Employee
from apps.migration_legacy.transform import Skip, transform_employee


def _mask_iin(iin):
    """PII-маска (паттерн 7.1/donor_profile.py): только последние 4 символа."""
    s = "" if iin is None else str(iin)
    if len(s) <= 4:
        return f"…(скрыто, {len(s)} симв.)"
    return "…" + s[-4:]


def _well_formed_rows(rows, report):
    good = []
    for row in rows:
        is_well_formed = (
            isinstance(row, dict)
            and isinstance(row.get("fields"), dict)
            and "pk" in row
        )
        if is_well_formed:
            good.append(row)
        else:
            pk = row.get("pk") if isinstance(row, dict) else "?"
            report.skip("malformed_row", pk)
    return good


def import_employees(rows, staff_rows, division_map, rank_map, position_pks, report):
    """rows: employees.employee dumpdata rows. staff_rows: staff_unit.staffunit
    dumpdata rows (donor Employee has no division FK — the link lives here).

    Returns (employee_map: {donor_pk: Employee.id}, merge_candidates: list of
    {"iin_masked": str, "donor_pks": [sorted int]} — one entry per group of
    donor_pks sharing a valid ИИН, AC-1). A human sanctions the merge, this
    importer never does it silently: for a duplicate group, donor_pks are
    attempted in sorted order and the FIRST that actually succeeds (passes
    division resolution and the DB write) wins; once a group has a winner,
    the rest are reported "duplicate_iin" WITHOUT being attempted. If the
    lowest-pk candidate fails for an unrelated reason (no_division,
    IntegrityError), the NEXT candidate in the same group still gets a real
    attempt — a group must not silently import ZERO employees just because
    its first-sorted member happened to be otherwise broken (review fix:
    the naive "always pick pks_sorted[0]" version could do exactly that).
    """
    rows = _well_formed_rows(rows, report)
    staff_rows = _well_formed_rows(staff_rows, report)
    # Donor Employee has no division FK: the link lives in staff_unit.
    staff_by_employee = {
        r["fields"]["employee"]: r["fields"]
        for r in staff_rows
        if r["fields"].get("employee") is not None
    }

    # --- Pass 1: transform every row (parity with 7.1's profiler — same
    # function, same Skip taxonomy), group valid results by ИИН. ---
    transformed = {}  # donor_pk -> EmployeeRow
    for row in rows:
        report.read += 1
        donor_pk = row["pk"]
        result = transform_employee(row["fields"])
        if isinstance(result, Skip):
            report.skip(result.reason, donor_pk)
            continue
        transformed[donor_pk] = result

    by_iin: dict = {}
    for donor_pk, result in transformed.items():
        by_iin.setdefault(result.iin, []).append(donor_pk)

    merge_candidates = []
    group_iin_of = {}  # donor_pk -> iin, only for groups with >1 member
    for iin, pks in by_iin.items():
        if len(pks) <= 1:
            continue
        pks_sorted = sorted(pks)
        merge_candidates.append(
            {"iin_masked": _mask_iin(iin), "donor_pks": pks_sorted}
        )
        for pk in pks_sorted:
            group_iin_of[pk] = iin

    # --- Pass 2: resolve division/rank/position and write, in GLOBAL
    # donor_pk order (deterministic, matches 1.6). Within a duplicate group
    # the first pk that SUCCEEDS becomes the winner; later group-mates are
    # reported "duplicate_iin" and never attempted once a winner exists. ---
    employee_map = {}
    resolved_group_iins = set()
    for donor_pk in sorted(transformed):
        iin = group_iin_of.get(donor_pk)
        if iin is not None and iin in resolved_group_iins:
            # A group-mate already won — this one is the merge-candidate
            # loser (AC-1: reported, never auto-merged/attempted).
            report.skip("duplicate_iin", donor_pk)
            continue

        result = transformed[donor_pk]
        staff = staff_by_employee.get(donor_pk)
        division = division_map.get(staff["division"]) if staff is not None else None
        if division is None:
            # Employee.division is PROTECT NOT NULL — no slot, no import.
            # If this pk belongs to a duplicate group, the NEXT candidate
            # still gets a real attempt (fallback — see docstring).
            report.skip("no_division", donor_pk)
            continue
        rank_code, rank_index = rank_map.get(result.rank_pk, ("", 0))
        position_pk = staff.get("position")
        position_code = f"POS_{position_pk}" if position_pk in position_pks else ""
        try:
            with transaction.atomic():
                employee, created = Employee.objects.update_or_create(
                    # Identity mapping donor_pk -> uuid (AC-1): the unique
                    # external_id field exists for this.
                    external_id=str(donor_pk),
                    defaults={
                        "iin": result.iin,
                        "personnel_number": result.personnel_number,
                        "last_name": result.last_name,
                        "first_name": result.first_name,
                        "middle_name": result.middle_name,
                        "birth_date": result.birth_date,
                        "gender": result.gender,
                        "hire_date": result.hire_date,
                        "dismissal_date": result.dismissal_date,
                        "employment_status": result.employment_status,
                        "rank_code": rank_code,
                        "rank_index": rank_index,
                        "position_code": position_code,
                        "division": division,
                        "data_source": "DONOR",
                        # created_by stays NULL: no actor, honest NULL.
                    },
                )
        except IntegrityError as exc:
            # Safety net for cases the IIN pre-pass above cannot see (e.g. a
            # collision with an Employee imported by a PREVIOUS run with a
            # different external_id — the pre-pass only groups WITHIN this
            # export). If this pk belongs to a duplicate group, the NEXT
            # candidate still gets a real attempt (same fallback as above).
            message = str(exc)
            # NOT NULL violations mention the column name too — check
            # them first or a missing field masquerades as a duplicate.
            if "null value" in message:
                reason = "missing_required_field"
            elif "iin" in message:
                reason = "duplicate_iin"
            elif "personnel_number" in message:
                reason = "duplicate_personnel_number"
            else:
                reason = "integrity_error"
            report.skip(reason, donor_pk)
            continue
        report.count(created)
        employee_map[donor_pk] = employee.id
        if iin is not None:
            resolved_group_iins.add(iin)

    return employee_map, merge_candidates
