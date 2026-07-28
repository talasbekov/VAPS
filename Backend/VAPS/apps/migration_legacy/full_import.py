"""Story 7.6 — orchestration extracted from ``import_donor_slice.Command``
(Story 1.6) so it can be called TWICE in one process by ``migrate_rehearsal``
(Story 7.6) without shelling out / re-parsing stdout — the caller gets the
real ``EntityReport`` objects (``.created`` etc.), not text.

Literal move of ``Command.handle``'s body, not a rewrite: ``import_donor_slice``
now calls this function too — same behavior, same 28 pre-existing tests,
zero duplication (same parity-through-reuse pattern as 7.2/7.3/7.4).
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from django.db import transaction

from apps.migration_legacy.import_employees import import_employees
from apps.migration_legacy.import_orgstructure import (
    EntityReport,
    import_divisions,
    import_positions,
    import_ranks,
    import_staffing_slots,
)
from apps.migration_legacy.import_statuses import import_statuses


class FullImportError(Exception):
    """Raised for input errors — the caller decides how to surface it
    (``CommandError`` in a management command, a plain exception in a
    programmatic caller like ``migrate_rehearsal``)."""


@dataclass
class FullImportResult:
    reports: dict
    window_start: date
    until: date
    clamped: int
    slot_divisions_covered: int
    merge_candidates: list
    derived_mismatches: list


def resolve_until(until_option, status_rows):
    if until_option:
        try:
            return date.fromisoformat(until_option)
        except ValueError as exc:
            raise FullImportError(f"--until is not a date: {until_option!r}") from exc
    # Deterministic from data, never from the wall clock: the donor died in
    # prod, "today" would yield an empty window. Malformed date values are
    # ignored here — transform skips those rows anyway.
    all_dates = []
    for row in status_rows:
        for key in ("start_date", "end_date", "actual_end_date"):
            value = row["fields"].get(key)
            if not value:
                continue
            try:
                all_dates.append(date.fromisoformat(value))
            except (TypeError, ValueError):
                continue
    if not all_dates:
        raise FullImportError("export has no status dates; pass --until")
    return max(all_dates)


def run_full_import(rows, days, until_option=None):
    """rows: the full parsed dumpdata JSON (list of {model, pk, fields}).
    days/until_option: same semantics as ``import_donor_slice --days/--until``.
    """
    by_model = defaultdict(list)
    for row in rows:
        # Unknown model keys are silently ignored: real exports carry extra
        # apps (auth, contenttypes, ...).
        by_model[row["model"]].append(row)

    if days < 1:
        raise FullImportError("--days must be >= 1")

    status_rows = by_model["statuses.employeestatus"]
    until = resolve_until(until_option, status_rows)
    window_start = until - timedelta(days=days - 1)

    reports = {
        name: EntityReport()
        for name in (
            "organizations",
            "divisions",
            "staffing_slots",
            "ranks",
            "positions",
            "employees",
            "statuses",
        )
    }

    with transaction.atomic():
        division_map = import_divisions(
            by_model["divisions.division"],
            reports["organizations"],
            reports["divisions"],
        )
        slot_divisions_covered = import_staffing_slots(
            by_model["staff_unit.staffunit"],
            division_map,
            window_start,
            reports["staffing_slots"],
        )
        rank_map = import_ranks(by_model["dictionaries.rank"], reports["ranks"])
        position_pks = import_positions(
            by_model["dictionaries.position"], reports["positions"]
        )
        employee_map, merge_candidates = import_employees(
            by_model["employees.employee"],
            by_model["staff_unit.staffunit"],
            division_map,
            rank_map,
            position_pks,
            reports["employees"],
        )
        clamped, derived_mismatches = import_statuses(
            status_rows,
            employee_map,
            window_start,
            until,
            reports["statuses"],
        )

    return FullImportResult(
        reports=reports,
        window_start=window_start,
        until=until,
        clamped=clamped,
        slot_divisions_covered=slot_divisions_covered,
        merge_candidates=merge_candidates,
        derived_mismatches=derived_mismatches,
    )
