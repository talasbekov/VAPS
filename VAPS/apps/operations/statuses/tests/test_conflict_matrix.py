"""Story 3.4 — declarative conflict matrix + pure detector (no DB).

The matrix module is pure (apps.core.sorting pattern): these tests run without a
database. The property test (AC-4) sweeps the WHOLE catalog of type pairs.
"""

import itertools
from datetime import date

import pytest
from hypothesis import given
from hypothesis import strategies as st

from apps.operations.statuses.conflict_matrix import (
    HARD_STATUS_TYPE_CODES,
    ConflictSeverity,
    classify_pair,
    detect_conflicts,
)
from apps.operations.statuses.management.commands.seed_statuses import (
    STATUS_TYPES,
)

ALL_CODES = [code for code, *_rest in STATUS_TYPES]


def _row(code, start, end):
    return {"status_type_code": code, "date_start": start, "date_end": end}


# -- classify_pair: unit ------------------------------------------------------


def test_hard_if_either_side_hard():
    assert classify_pair("VACATION", "STUDY") is ConflictSeverity.HARD
    assert classify_pair("STUDY", "VACATION") is ConflictSeverity.HARD
    assert classify_pair("SICK_LEAVE", "COMMAND") is ConflictSeverity.HARD


def test_soft_when_both_sides_soft():
    assert classify_pair("STUDY", "CONFERENCE") is ConflictSeverity.SOFT
    assert classify_pair("STUDY", "STUDY") is ConflictSeverity.SOFT


def test_secondment_pair_is_compatible():
    # Story 3.10: DETACHED + ATTACHED is the reserved secondment pair — declared
    # COMPATIBLE so the two legs of one secondment don't false-conflict (409).
    assert classify_pair("DETACHED", "ATTACHED") is ConflictSeverity.COMPATIBLE
    assert classify_pair("ATTACHED", "DETACHED") is ConflictSeverity.COMPATIBLE


def test_detect_compatible_pair_is_not_a_conflict():
    # detect_conflicts skips a COMPATIBLE overlap: an ATTACHED status overlapping
    # the employee's own DETACHED leg yields no hard/soft/warning.
    report = detect_conflicts(
        new_type="ATTACHED",
        existing_rows=[_row("DETACHED", date(2026, 6, 1), date(2026, 6, 10))],
        business_date=date(2026, 6, 5),
    )
    assert not report.hard and not report.soft and not report.warnings
    assert not report.has_blocking()


# -- property: totality + symmetry + hard-consistency (AC-4, AC-6) ------------


@pytest.mark.property
@given(a=st.sampled_from(ALL_CODES), b=st.sampled_from(ALL_CODES))
def test_classify_total_symmetric_hard_consistent(a, b):
    severity = classify_pair(a, b)
    assert severity in ConflictSeverity  # totality
    assert classify_pair(a, b) == classify_pair(b, a)  # symmetry
    either_hard = a in HARD_STATUS_TYPE_CODES or b in HARD_STATUS_TYPE_CODES
    # hard-consistency with the GiST constraint's tuple (AC-6 / D3 resolution)
    assert (severity is ConflictSeverity.HARD) == either_hard


@pytest.mark.parametrize(
    "a,b", list(itertools.product(ALL_CODES, repeat=2))
)
def test_classify_exhaustive_over_whole_catalog(a, b):
    # AC-4 «property-тест прогоняет всю матрицу пар» — exhaustive over EVERY
    # ordered pair of the catalog (runs in the gate, deterministic), so no pair
    # is left unverified the way randomized sampling could.
    severity = classify_pair(a, b)
    assert severity in ConflictSeverity
    assert classify_pair(a, b) == classify_pair(b, a)
    either_hard = a in HARD_STATUS_TYPE_CODES or b in HARD_STATUS_TYPE_CODES
    assert (severity is ConflictSeverity.HARD) == either_hard


# -- detect_conflicts: severity routing + PLANNED downgrade -------------------


def test_detect_hard_overlap():
    report = detect_conflicts(
        new_type="STUDY",
        existing_rows=[_row("VACATION", date(2026, 6, 1), date(2026, 6, 10))],
        business_date=date(2026, 6, 5),
    )
    assert len(report.hard) == 1
    assert not report.soft and not report.warnings
    assert report.has_blocking()


def test_detect_soft_overlap_active_blocks():
    report = detect_conflicts(
        new_type="STUDY",
        existing_rows=[_row("CONFERENCE", date(2026, 6, 1), date(2026, 6, 10))],
        business_date=date(2026, 6, 5),  # existing ACTIVE
    )
    assert len(report.soft) == 1
    assert not report.hard and not report.warnings
    assert report.has_blocking()


def test_detect_soft_overlap_planned_is_warning():
    report = detect_conflicts(
        new_type="STUDY",
        existing_rows=[_row("CONFERENCE", date(2026, 6, 1), date(2026, 6, 10))],
        business_date=date(2026, 5, 1),  # existing not yet started → PLANNED
    )
    assert len(report.warnings) == 1
    assert not report.hard and not report.soft
    assert not report.has_blocking()


def test_detect_soft_overlap_at_active_boundary_blocks():
    # date_start == business_date → ACTIVE (not PLANNED), so it blocks (409),
    # mirroring derive_state's strict `business_date < date_start` for PLANNED.
    report = detect_conflicts(
        new_type="STUDY",
        existing_rows=[_row("CONFERENCE", date(2026, 6, 5), date(2026, 6, 10))],
        business_date=date(2026, 6, 5),
    )
    assert len(report.soft) == 1
    assert not report.warnings


def test_detect_hard_overlap_with_planned_stays_hard():
    # HARD stays 422 regardless of the other's lifecycle — consistent with the
    # GiST constraint, which ignores state (AC-3 note).
    report = detect_conflicts(
        new_type="VACATION",
        existing_rows=[_row("SICK_LEAVE", date(2026, 6, 1), date(2026, 6, 10))],
        business_date=date(2026, 5, 1),  # existing PLANNED
    )
    assert len(report.hard) == 1
    assert not report.warnings and not report.soft


def test_detect_no_rows_is_empty():
    report = detect_conflicts(
        new_type="STUDY", existing_rows=[], business_date=date(2026, 6, 5)
    )
    assert not report.has_blocking()
