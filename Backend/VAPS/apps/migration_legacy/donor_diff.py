"""Pure donor-vs-VAPS diff with a fixed category catalog (no ORM, no DB).

The catalog is the prototype of the parallel-run classifier
(architecture.md:311 — three layers timing / model / unclassified; the
full version, with donor timing-replay and an owner-signed model-diff
registry, is E7 7.8). Each rule is a DETERMINISTIC predicate over a single
cell (column, signed delta) plus the division context (the IN_SERVICE
pairing and the VAPS overstaffed violations). Nothing is ever "guessed":
an unexplained discrepancy, and any VAPS data loss
(``data/skipped_employee``), stays in the gate-blocking bucket — that is
what makes "расхождение без объяснения = эпик не закрыт" mechanical (AC-5).
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date

# Donor DataAggregator columns -> the VAPS value they are compared against.
# Only these are diffed cell-by-cell. Списочный состав / Вакансии /
# present_total / presence_pct are NOT here: the donor emits no matching
# field, so comparing them would be a false unclassified flood.
DONOR_TO_VAPS = {
    "staff_unit": "staff_total",
    "sick_leave": "SICK",
    "business_trip": "COMMAND",
    "other_absence": "OTHER",
    "seconded_out": "DETACHED",
    "vacation": "VACATION",
    "training": "TRAINING",
    "seconded_in": "attached",
    "in_service": "IN_SERVICE",
}

# Deterministic iteration order of the comparable VAPS columns.
COMPARABLE_COLUMNS = (
    "staff_total",
    "SICK",
    "VACATION",
    "COMMAND",
    "TRAINING",
    "OTHER",
    "DETACHED",
    "attached",
    "IN_SERVICE",
)

# Donor-mapped columns the donor aggregator SPLITS but VAPS folds extra
# types into (VAPS VACATION also holds leave_by_report; VAPS TRAINING also
# holds competition/conference). A positive delta here paired with a donor
# IN_SERVICE surplus is the aggregator_inferred signature.
DONOR_MAPPED_FOLD_TARGETS = ("VACATION", "TRAINING")

# VAPS columns the donor aggregator has NO column for at all (on_duty /
# after_duty are not split; before_duty does not exist donor-side): their
# bearers land in the donor's inferred "В строю".
VAPS_ONLY_FOLD_COLUMNS = ("ON_DUTY", "AFTER_DUTY", "BEFORE_DUTY")

# The two type columns iterated as cells (1:1 mappings + fold targets).
_TYPE_COLUMNS = ("SICK", "VACATION", "COMMAND", "TRAINING", "OTHER", "DETACHED")

# Categories that DO NOT explain a discrepancy: both block the gate (AC-5).
# data/skipped_employee is labelled for readability but is NOT a free pass
# (Решение №11) — VAPS losing a donor row means "донор прав, VAPS потерял".
GATE_BLOCKING_CATEGORIES = frozenset({"unclassified", "data/skipped_employee"})


@dataclass(frozen=True)
class BaselineRow:
    division_code: str
    division_name: str
    staff_unit: int
    in_service: int
    vacation: int
    sick_leave: int
    business_trip: int
    training: int
    seconded_in: int
    seconded_out: int
    other_absence: int


@dataclass(frozen=True)
class DiffCell:
    division_code: str
    column: str
    vaps: int
    donor: int
    delta: int
    category: str


@dataclass(frozen=True)
class DiffResult:
    business_date: date
    cells: list
    counts: dict
    has_unclassified: bool


_BASELINE_FIELDS = (
    "division_name",
    "staff_unit",
    "in_service",
    "vacation",
    "sick_leave",
    "business_trip",
    "training",
    "seconded_in",
    "seconded_out",
    "other_absence",
)


def load_baseline(data):
    """Multi-day envelope -> ``dict[date, dict[code, BaselineRow]]``.

    The donor ``DataAggregator.collect_data`` emits ONE day per run; a
    5-7 day freeze glues the runs into ``days[]``. Outer key = date, inner
    key = division_code. A malformed envelope raises ``ValueError``; a
    duplicate division_code within one day also raises (STOP semantics —
    collapsed donor codes must be resolved pk->code at freeze time, never a
    silent last-write-wins; mirror of the C2/KO-2 import fix).
    """
    if not isinstance(data, dict) or "days" not in data:
        raise ValueError("baseline: missing 'days' envelope")
    days = data["days"]
    if not isinstance(days, list):
        raise ValueError("baseline: 'days' must be a list")
    result = {}
    for day in days:
        try:
            day_date = date.fromisoformat(day["date"])
            rows = day["rows"]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"baseline: invalid day block: {exc}")
        if not isinstance(rows, list):
            # A null/scalar 'rows' is otherwise iterated outside any guard and
            # raises a bare TypeError, escaping the command's ValueError->
            # CommandError boundary (code review 2026-06-16, findings C7/C9).
            raise ValueError(f"baseline: 'rows' must be a list on {day_date}")
        by_code = {}
        for raw in rows:
            try:
                code = raw["division_code"]
                fields = {name: raw[name] for name in _BASELINE_FIELDS}
            except (KeyError, TypeError) as exc:
                raise ValueError(f"baseline: invalid row: {exc}")
            if not isinstance(code, str):
                # An unhashable (list/dict) or non-string division_code would
                # otherwise raise TypeError at the membership test below
                # (code review 2026-06-16, finding C10).
                raise ValueError(
                    f"baseline: division_code must be a string, got {code!r}"
                )
            if not isinstance(fields["division_name"], str):
                raise ValueError(
                    f"baseline: division_name must be a string on {code!r}"
                )
            for name in _BASELINE_FIELDS[1:]:
                value = fields[name]
                # Counts must be plain ints; a null/float/str donor value
                # otherwise crashes later in diff_day or produces a fractional
                # delta (code review 2026-06-16, finding C4). bool is an int
                # subclass but never a valid head-count.
                if not isinstance(value, int) or isinstance(value, bool):
                    raise ValueError(
                        f"baseline: {name} must be an integer on {code!r}, "
                        f"got {value!r}"
                    )
                # ...and NON-NEGATIVE. A negative donor count (corrupted/typo'd
                # freeze, e.g. vacation=-1) would otherwise GREEN-LIGHT the gate:
                # it spawns a phantom fold/aggregator_inferred pairing that
                # explains away a discrepancy which must block on data loss
                # (code review 2026-06-16 пр.3 — reproduced gate-escape; the
                # earlier C4 defer was wrongly justified as fail-safe).
                # Head-counts are non-negative by construction.
                if value < 0:
                    raise ValueError(
                        f"baseline: {name} must be non-negative on {code!r}, "
                        f"got {value!r}"
                    )
            if code in by_code:
                raise ValueError(
                    f"baseline: duplicate division_code {code!r} on {day_date}"
                )
            by_code[code] = BaselineRow(division_code=code, **fields)
        if day_date in result:
            # Mirror the within-day duplicate-code STOP one level up: a 5-7 day
            # freeze must not glue the same date twice and silently drop the
            # first block (code review 2026-06-16, findings C3/C8).
            raise ValueError(f"baseline: duplicate day {day_date.isoformat()}")
        result[day_date] = by_code
    return result


def _vaps_values(row):
    if row is None:
        return {column: 0 for column in COMPARABLE_COLUMNS}
    return {
        "staff_total": row.staff_total,
        "SICK": row.columns["SICK"],
        "VACATION": row.columns["VACATION"],
        "COMMAND": row.columns["COMMAND"],
        "TRAINING": row.columns["TRAINING"],
        "OTHER": row.columns["OTHER"],
        "DETACHED": row.columns["DETACHED"],
        "attached": row.attached,
        "IN_SERVICE": row.columns["IN_SERVICE"],
    }


def _donor_values(baseline_row):
    if baseline_row is None:
        return {column: 0 for column in COMPARABLE_COLUMNS}
    return {
        "staff_total": baseline_row.staff_unit,
        "SICK": baseline_row.sick_leave,
        "VACATION": baseline_row.vacation,
        "COMMAND": baseline_row.business_trip,
        "TRAINING": baseline_row.training,
        "OTHER": baseline_row.other_absence,
        "DETACHED": baseline_row.seconded_out,
        "attached": baseline_row.seconded_in,
        "IN_SERVICE": baseline_row.in_service,
    }


def _classify_division(code, vaps_row, baseline_row, overstaffed_codes):
    """All DiffCells for one aligned division (first-match rule per cell)."""
    vaps = _vaps_values(vaps_row)
    donor = _donor_values(baseline_row)

    in_service_delta = vaps["IN_SERVICE"] - donor["IN_SERVICE"]
    vaps_in_service_higher = in_service_delta > 0
    donor_in_service_higher = in_service_delta < 0

    # VAPS people the donor folds into inferred "В строю": the donor-mapped
    # fold targets' positive surplus + every VAPS-only fold column.
    fold_surplus = 0
    for column in DONOR_MAPPED_FOLD_TARGETS:
        fold_surplus += max(0, vaps[column] - donor[column])
    if vaps_row is not None:
        for column in VAPS_ONLY_FOLD_COLUMNS:
            fold_surplus += vaps_row.columns[column]

    # Donor people VAPS dropped at the boundary (donor-inclusive end): the
    # donor's surplus across type columns it still counts.
    timing_surplus = 0
    for column in _TYPE_COLUMNS:
        timing_surplus += max(0, donor[column] - vaps[column])

    cells = []

    # The overstaffed finding is a VAPS violation, not a donor cell diff
    # ("донор неправ против документа") — emit it once for the division.
    if code in overstaffed_codes:
        cells.append(
            DiffCell(
                division_code=code,
                column="Штат<Список",
                vaps=vaps["staff_total"],
                donor=donor["staff_total"],
                delta=vaps["staff_total"] - donor["staff_total"],
                category="model/overstaffed",
            )
        )

    for column in COMPARABLE_COLUMNS:
        delta = vaps[column] - donor[column]
        if delta == 0:
            continue
        category = _classify_cell(
            column=column,
            delta=delta,
            code=code,
            overstaffed_codes=overstaffed_codes,
            donor_in_service_higher=donor_in_service_higher,
            vaps_in_service_higher=vaps_in_service_higher,
            fold_surplus=fold_surplus,
            timing_surplus=timing_surplus,
        )
        if category is None:
            # staff_total on an overstaffed division — already covered by
            # the violation-derived model/overstaffed entry above.
            continue
        cells.append(
            DiffCell(
                division_code=code,
                column=column,
                vaps=vaps[column],
                donor=donor[column],
                delta=delta,
                category=category,
            )
        )
    return cells


def _classify_cell(
    column,
    delta,
    code,
    overstaffed_codes,
    donor_in_service_higher,
    vaps_in_service_higher,
    fold_surplus,
    timing_surplus,
):
    if column == "attached":
        # Donor seconded_in (by related_division) vs VAPS ATTACHED (from
        # seconded_from): structurally different sources, always model.
        return "model/attached_source"

    if column == "staff_total":
        if code in overstaffed_codes:
            return None  # covered by the model/overstaffed violation entry
        # Штат must match by construction (Решение №5 parity) — any other
        # gap is suspicious, never auto-explained.
        return "unclassified"

    if column == "IN_SERVICE":
        if delta < 0:  # donor has MORE "В строю"
            if -delta == fold_surplus and fold_surplus > 0:
                return "model/aggregator_inferred"
            # Donor surplus VAPS cannot account for = lost donor rows.
            return "data/skipped_employee"
        # VAPS has MORE "В строю": explained only if it exactly absorbs the
        # donor's boundary-ended type counts (timing).
        if delta == timing_surplus and timing_surplus > 0:
            return "timing/half_open_end"
        return "unclassified"

    # A type column (SICK / VACATION / COMMAND / TRAINING / OTHER / DETACHED).
    if delta > 0:  # VAPS counts MORE than the donor here
        if column in DONOR_MAPPED_FOLD_TARGETS and donor_in_service_higher:
            return "model/aggregator_inferred"
        return "unclassified"
    # delta < 0: donor counts MORE in this type column than VAPS. A donor
    # type-column surplus with no IN_SERVICE compensation is AMBIGUOUS from the
    # emitted numbers alone: a donor double-count (the priority loser stays
    # only donor-side) and a donor row VAPS dropped at import produce IDENTICAL
    # figures. model/single_winner therefore cannot be auto-proven, and per
    # AC-5 / Решение №11 the gate must NOT be greened on a possible data loss,
    # so it stays gate-blocking (code review 2026-06-16, finding C1 — true
    # discrimination needs donor timing-replay, deferred to E7 7.8).
    if vaps_in_service_higher:
        return "timing/half_open_end"
    return "unclassified"


def diff_day(vaps, baseline_for_day, code_by_division_id):
    """Diff one day: VAPS ``StrengthReportResult`` vs donor baseline.

    Alignment is by ``Division.code`` over the UNION of baseline codes and
    the codes of the VAPS rows (donor pk is not persisted — Решение №5). A
    side with no row contributes zeros, so a collapsed/skipped division is
    visible, not silently swallowed. Returns a ``DiffResult`` with the list
    of classified cells, per-category counts and ``has_unclassified``.
    """
    vaps_by_code = {}
    for row in vaps.rows:
        code = code_by_division_id.get(row.division_id)
        if code is None:
            continue
        if code in vaps_by_code:
            # Division.code is unique only per (organization, code); a global
            # code_by_division_id can map two divisions to one code. Mirror the
            # donor-side load_baseline STOP — never a silent last-write-wins
            # (code review 2026-06-16, finding C2).
            raise ValueError(
                f"diff: duplicate Division.code {code!r} on "
                f"{vaps.business_date.isoformat()} — resolve the "
                f"(organization, code) collision"
            )
        vaps_by_code[code] = row

    overstaffed_codes = set()
    for violation in vaps.violations:
        if violation.get("reason") == "staff_lt_list":
            code = code_by_division_id.get(violation["division_id"])
            if code is not None:
                overstaffed_codes.add(code)

    all_codes = sorted(set(vaps_by_code) | set(baseline_for_day))
    cells = []
    for code in all_codes:
        cells.extend(
            _classify_division(
                code,
                vaps_by_code.get(code),
                baseline_for_day.get(code),
                overstaffed_codes,
            )
        )

    counts = Counter(cell.category for cell in cells)
    has_unclassified = any(
        cell.category in GATE_BLOCKING_CATEGORIES for cell in cells
    )
    return DiffResult(
        business_date=vaps.business_date,
        cells=cells,
        counts=dict(counts),
        has_unclassified=has_unclassified,
    )


def render_diff(diff):
    """Text diff report: grouped by category + an explicit UNCLASSIFIED block.

    The UNCLASSIFIED block lists every gate-blocking cell (unclassified +
    data/skipped_employee) or "нет" — this is the line the DoD gate reads.
    """
    lines = [f"Дифф с донором на {diff.business_date.isoformat()}"]
    if not diff.cells:
        lines.append("  расхождений нет — числа совпадают с эталоном")
    else:
        by_category = {}
        for cell in diff.cells:
            by_category.setdefault(cell.category, []).append(cell)
        for category in sorted(by_category):
            lines.append(f"  [{category}] ({len(by_category[category])}):")
            for cell in by_category[category]:
                lines.append(
                    f"    {cell.division_code} {cell.column}: "
                    f"VAPS {cell.vaps} vs донор {cell.donor} "
                    f"(Δ {cell.delta:+d})"
                )

    blocking = [c for c in diff.cells if c.category in GATE_BLOCKING_CATEGORIES]
    lines.append("")
    lines.append("UNCLASSIFIED (блокер DoD-гейта):")
    if not blocking:
        lines.append("  нет")
    else:
        for cell in blocking:
            lines.append(
                f"  {cell.division_code} {cell.column} [{cell.category}]: "
                f"VAPS {cell.vaps} vs донор {cell.donor} (Δ {cell.delta:+d})"
            )
    return "\n".join(lines)
