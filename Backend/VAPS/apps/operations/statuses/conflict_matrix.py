"""Story 3.4 — declarative conflict matrix + pure detector (FR-10/FR-11, AR-8).

Pure module (no Django / ORM), mirroring ``apps.core.sorting``: the conflict
RULES are data, not scattered if-s, so the matrix is property-testable without a
DB and reusable by the E14/E16 assignment adapters.

This module is the single Python source for the hard-block set: both the GiST
constraint ``excl_hard_status_overlap`` (apps/operations/statuses/models/
employee_status.py) and this detector read ``HARD_STATUS_TYPE_CODES`` from here,
so the Python detector and the constraint *definition* share one tuple
(resolves the 3.3 review D3 coupling at the source level). CAVEAT: the live DB
constraint is a migration snapshot — the SQL predicate was frozen into migration
0001. Editing this tuple therefore requires a NEW migration to keep the DB in
sync; the seed test (story 2.2) only guards ``StatusType.is_hard_block`` rows,
not the frozen migration expression (see deferred-work: drift-guard).

Severity vocabulary:
  HARD       → 422 OVERLAPPING_HARD_STATUS (not overridable). The GiST
               constraint backstops the hard×HARD race specifically; a
               hard×soft overlap is caught only by this service-side detector
               (the partial constraint covers hard×hard alone).
  SOFT       → 409 STATUS_OVERLAP_WARNING  (overridable; override entity is 3.5)
  COMPATIBLE → no conflict (reserved for secondment pairs, story 3.10)

A SOFT overlap with a status that has not yet started (PLANNED relative to the
business date) is downgraded to a non-blocking WARNING (FR-10). A HARD overlap
stays 422 regardless of the other status's lifecycle state — consistent with the
GiST constraint, which ignores state.
"""

from dataclasses import dataclass
from enum import Enum

# Single Python source for hard-block status types (Решение №3=A). Synced to
# StatusType.is_hard_block rows by the 2.2 seed test, AND frozen into the GiST
# constraint of migration 0001 — editing this tuple needs a NEW migration.
HARD_STATUS_TYPE_CODES = ("SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND")

# Declarative exceptions: unordered type pairs that may legitimately coexist.
# Reserved for secondment pairs (DETACHED/ATTACHED, story 3.10); empty until
# that story populates it. Each entry is a frozenset of two type codes.
COMPATIBLE_PAIRS: frozenset = frozenset()


class ConflictSeverity(Enum):
    HARD = "HARD"
    SOFT = "SOFT"
    COMPATIBLE = "COMPATIBLE"


def classify_pair(type_a, type_b):
    """Severity of an overlap between two status types — pure and symmetric.

    HARD if either side is a hard-block type (matches the GiST constraint and
    FR-11 «пересечение с hard-типом → 422»); COMPATIBLE for declared exception
    pairs; SOFT otherwise.
    """
    if type_a in HARD_STATUS_TYPE_CODES or type_b in HARD_STATUS_TYPE_CODES:
        return ConflictSeverity.HARD
    if frozenset((type_a, type_b)) in COMPATIBLE_PAIRS:
        return ConflictSeverity.COMPATIBLE
    return ConflictSeverity.SOFT


@dataclass(frozen=True)
class Conflict:
    severity: ConflictSeverity
    other_status_type: str
    other_date_start: object
    other_date_end: object
    other_is_planned: bool


@dataclass(frozen=True)
class ConflictReport:
    hard: tuple = ()
    soft: tuple = ()
    warnings: tuple = ()

    def has_blocking(self):
        """True if anything blocks creation (hard → 422 or soft → 409)."""
        return bool(self.hard or self.soft)


def detect_conflicts(*, new_type, existing_rows, business_date):
    """Classify each already-overlapping existing status against ``new_type``.

    ``existing_rows`` is an iterable of mappings with ``status_type_code`` /
    ``date_start`` / ``date_end`` — already filtered to live, interval-
    overlapping rows by the caller (the half-open overlap predicate stays in the
    selector/query, exactly as in story 3.3). PURE: no ORM, no DB.

    ``business_date`` decides PLANNED: a SOFT overlap with a status whose
    ``date_start`` is in the future is a non-blocking WARNING (FR-10).
    """
    hard, soft, warnings = [], [], []
    for row in existing_rows:
        other_type = row["status_type_code"]
        severity = classify_pair(new_type, other_type)
        if severity is ConflictSeverity.COMPATIBLE:
            continue
        is_planned = row["date_start"] > business_date
        conflict = Conflict(
            severity=severity,
            other_status_type=other_type,
            other_date_start=row["date_start"],
            other_date_end=row["date_end"],
            other_is_planned=is_planned,
        )
        if severity is ConflictSeverity.HARD:
            hard.append(conflict)
        elif is_planned:
            warnings.append(conflict)
        else:
            soft.append(conflict)
    return ConflictReport(
        hard=tuple(hard), soft=tuple(soft), warnings=tuple(warnings)
    )
