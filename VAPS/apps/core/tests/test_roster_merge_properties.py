"""Story 2.4 — pure property tests for the roster merge (no DB).

``_resolve_roster`` is the pure core of ``HistoricalEmployeeSelector.
roster_on``; testing it without a database lets the AC-3 global-convergence
invariants run everywhere (mirrors the pure ``derive_report`` property
layer). Runs via ``pytest -m property`` / ``make test-full``.
"""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from apps.core.selectors import _resolve_roster


@st.composite
def rosters(draw):
    """working {emp: current_div} + covering history rows (+ non-working
    'ghost' history that must never enter the roster)."""
    n_div = draw(st.integers(1, 4))
    divisions = list(range(n_div))
    n_emp = draw(st.integers(0, 10))
    working = {f"e{i}": draw(st.sampled_from(divisions)) for i in range(n_emp)}
    history = []
    ghosts = [f"ghost{i}" for i in range(draw(st.integers(0, 3)))]
    for emp in list(working) + ghosts:
        for _ in range(draw(st.integers(0, 3))):
            history.append(
                (emp, draw(st.sampled_from(divisions)), draw(st.integers(0, 100)))
            )
    return working, history, divisions


@pytest.mark.property
class TestResolveRosterProperties:
    @given(rosters())
    def test_every_working_employee_placed_exactly_once(self, world):
        # AC-3: nobody lost, nobody in two lists.
        working, history, _ = world
        result = _resolve_roster(working, history)
        placed = [eid for ids in result.values() for eid in ids]
        assert sorted(placed) == sorted(working)  # no loss
        assert len(placed) == len(set(placed))  # no duplicates

    @given(rosters())
    def test_sum_equals_working_headcount(self, world):
        working, history, _ = world
        result = _resolve_roster(working, history)
        assert sum(len(ids) for ids in result.values()) == len(working)

    @given(rosters())
    def test_only_working_employees_appear(self, world):
        # ghost (non-working) history never enters the roster.
        working, history, _ = world
        result = _resolve_roster(working, history)
        placed = {eid for ids in result.values() for eid in ids}
        assert placed == set(working)

    @given(rosters())
    def test_history_overrides_current_division(self, world):
        working, history, _ = world
        result = _resolve_roster(working, history)
        best_key, chosen = {}, {}
        for emp, div, start in history:
            key = (start, div)  # (starts_at, division_id) deterministic tie-break
            if emp not in best_key or key > best_key[emp]:
                best_key[emp] = key
                chosen[emp] = div
        for emp, current in working.items():
            expected_div = chosen.get(emp, current)
            assert emp in result.get(expected_div, [])

    @given(rosters())
    def test_scoping_is_a_subset(self, world):
        working, history, divisions = world
        keep = {divisions[0]}
        full = _resolve_roster(working, history)
        scoped = _resolve_roster(working, history, keep)
        assert set(scoped) <= keep
        assert scoped.get(divisions[0], []) == full.get(divisions[0], [])

    @given(rosters(), st.randoms())
    def test_order_independent(self, world, rnd):
        # Determinism: shuffling history rows must not change the roster — the
        # (starts_at, division_id) tie-break removes order dependence (this is
        # what a same-order oracle could not catch).
        working, history, _ = world
        shuffled = list(history)
        rnd.shuffle(shuffled)
        assert _resolve_roster(working, history) == _resolve_roster(working, shuffled)
