"""Story 2.6 — pure canon of roster sorting (no DB).

``sort_roster`` is the single FR-5 sort canon: own personnel by position
level (ascending) then surname, with attached/detached blocks at the bottom.
It is pure (no ORM, no Django), so — like ``_resolve_roster`` /
``derive_report`` — its invariants run as property tests without a database.
Runs via ``pytest -m property`` / ``make test-full`` for the property layer.
"""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from apps.core.sorting import (
    UNKNOWN_LEVEL,
    RosterEntry,
    RosterGroup,
    roster_sort_key,
    sort_roster,
)


def _entry(group, level, surname, ident):
    return RosterEntry(
        group=group, position_level=level, surname=surname, id=ident, payload=ident
    )


# --- Unit: the canon order, exactly as the epic AC phrases it -----------------


def test_groups_then_level_then_surname_exact_order():
    # AC-1 + AC-2: own (by level asc, then surname) -> attached block ->
    # detached block. Build deliberately out of order; assert the canon order.
    entries = [
        _entry(RosterGroup.DETACHED, 1, "Иванов", "det"),
        _entry(RosterGroup.OWN, 5, "Яковлев", "own_l5"),
        _entry(RosterGroup.ATTACHED, 1, "Сидоров", "att"),
        _entry(RosterGroup.OWN, 1, "Бойко", "own_l1_b"),
        _entry(RosterGroup.OWN, 1, "Абрамов", "own_l1_a"),
    ]
    ordered = [e.id for e in sort_roster(entries)]
    assert ordered == ["own_l1_a", "own_l1_b", "own_l5", "att", "det"]


def test_groups_never_interleave():
    # AC-1: no ATTACHED before any OWN; no DETACHED before any ATTACHED.
    entries = [
        _entry(RosterGroup.ATTACHED, 0, "А", "a1"),
        _entry(RosterGroup.OWN, 9, "Я", "o1"),
        _entry(RosterGroup.DETACHED, 0, "А", "d1"),
        _entry(RosterGroup.OWN, 9, "Б", "o2"),
        _entry(RosterGroup.ATTACHED, 0, "Б", "a2"),
    ]
    groups = [int(e.group) for e in sort_roster(entries)]
    assert groups == sorted(groups)


def test_same_level_sorts_by_surname_case_insensitive():
    # AC-2: equal level -> surname, case-folded (lowercase 'бойко' is not
    # ordered after uppercase names just because of byte value).
    entries = [
        _entry(RosterGroup.OWN, 1, "Яcovlev", "y"),
        _entry(RosterGroup.OWN, 1, "бойко", "b"),
        _entry(RosterGroup.OWN, 1, "Абрамов", "a"),
    ]
    assert [e.id for e in sort_roster(entries)] == ["a", "b", "y"]


def test_equal_level_and_surname_tie_break_by_id_is_deterministic():
    # AC-2: a stable final tie-break (str(id)) — the order must not float
    # between runs / input orderings on otherwise-equal keys.
    a = _entry(RosterGroup.OWN, 1, "Ров", "id_1")
    b = _entry(RosterGroup.OWN, 1, "Ров", "id_2")
    assert [e.id for e in sort_roster([a, b])] == ["id_1", "id_2"]
    assert [e.id for e in sort_roster([b, a])] == ["id_1", "id_2"]


def test_unknown_level_sorts_after_known_within_group():
    # AC-3: a position_code that matched no Position row gets UNKNOWN_LEVEL
    # and sorts AFTER everyone with a real level, inside its own group.
    entries = [
        _entry(RosterGroup.OWN, UNKNOWN_LEVEL, "Абрамов", "unknown"),
        _entry(RosterGroup.OWN, 7, "Яковлев", "known"),
    ]
    assert [e.id for e in sort_roster(entries)] == ["known", "unknown"]


def test_blank_surname_sorts_after_named_within_same_group_and_level():
    # AC-2/AC-3: an empty surname (no last_name and no full_name) must not
    # leapfrog named people to the top — it sorts last among equals.
    entries = [
        _entry(RosterGroup.OWN, 1, "", "blank"),
        _entry(RosterGroup.OWN, 1, "Абрамов", "named"),
    ]
    assert [e.id for e in sort_roster(entries)] == ["named", "blank"]


def test_whitespace_only_surname_collates_as_blank_last():
    # AC-3 / Decision №3: a whitespace-only surname must sort as blank (last),
    # not leapfrog named people just because "   " is truthy (donor dirt).
    entries = [
        _entry(RosterGroup.OWN, 1, "   ", "ws"),
        _entry(RosterGroup.OWN, 1, "Абрамов", "named"),
    ]
    assert [e.id for e in sort_roster(entries)] == ["named", "ws"]


def test_surrounding_whitespace_is_normalised():
    # "  Ров  " and "Ров" collate together, then fall to the id tie-break.
    entries = [
        _entry(RosterGroup.OWN, 1, "Ров", "plain"),
        _entry(RosterGroup.OWN, 1, "  Ров  ", "padded"),
    ]
    assert [e.id for e in sort_roster(entries)] == ["padded", "plain"]


def test_payload_is_carried_through():
    # The canon sorts lightweight entries but returns them whole, so callers
    # get their original object back in canonical order.
    sentinel = object()
    entry = RosterEntry(
        group=RosterGroup.OWN, position_level=1, surname="Х", id="x", payload=sentinel
    )
    assert sort_roster([entry])[0].payload is sentinel


def test_sort_roster_does_not_mutate_input():
    entries = [
        _entry(RosterGroup.OWN, 2, "Б", "b"),
        _entry(RosterGroup.OWN, 1, "А", "a"),
    ]
    before = list(entries)
    sort_roster(entries)
    assert entries == before


# --- Property layer (hypothesis), pure — no DB --------------------------------


@st.composite
def entry_lists(draw):
    """Random rosters across all three groups, unique ids for a stable
    tie-break; ~half the levels are UNKNOWN_LEVEL to exercise AC-3."""
    n = draw(st.integers(0, 12))
    surnames = ["Абрамов", "бойко", "Бойко", "", "Яков", "сидор", "ИВАНОВ"]
    out = []
    for i in range(n):
        group = draw(st.sampled_from(list(RosterGroup)))
        level = draw(st.integers(0, 5)) if draw(st.booleans()) else UNKNOWN_LEVEL
        surname = draw(st.sampled_from(surnames))
        out.append(_entry(group, level, surname, i))
    return out


@pytest.mark.property
class TestSortRosterProperties:
    @given(entry_lists())
    def test_groups_do_not_interleave(self, entries):
        groups = [int(e.group) for e in sort_roster(entries)]
        assert groups == sorted(groups)

    @given(entry_lists())
    def test_within_group_level_then_surname_non_decreasing(self, entries):
        result = sort_roster(entries)
        for group in RosterGroup:
            block = [e for e in result if e.group == group]
            # Full within-group sub-key (level, surname, id tie-break) — the id
            # dimension is included so a descending-id ordering bug is caught.
            keys = [roster_sort_key(e)[1:] for e in block]
            assert keys == sorted(keys)

    @given(entry_lists(), st.randoms())
    def test_permutation_invariant(self, entries, rnd):
        # Determinism: any permutation of the same input yields the same order.
        shuffled = list(entries)
        rnd.shuffle(shuffled)
        assert [e.id for e in sort_roster(entries)] == [
            e.id for e in sort_roster(shuffled)
        ]

    @given(entry_lists())
    def test_idempotent(self, entries):
        once = sort_roster(entries)
        assert sort_roster(once) == once

    @given(entry_lists())
    def test_is_a_permutation_of_the_input(self, entries):
        # Nobody lost, nobody invented.
        assert sorted(e.id for e in sort_roster(entries)) == sorted(
            e.id for e in entries
        )
