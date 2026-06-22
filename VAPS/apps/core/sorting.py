"""FR-5 — the single canon for sorting personnel lists (story 2.6).

One sort, one implementation: every list and the расход order people the
same way, so the order never drifts between screens, the расход document and
the API. The order is: own personnel by position level (``Position.level``
ascending — smaller level = more senior) then surname, followed by a block of
attached (прикомандированные) and a block of detached (откомандированные).

This module is PURE — no Django, no ORM, and (importantly) no
``apps.operations`` and no ``apps.core.models`` import. The group of each
entry is an INPUT, not something the canon computes: date-keyed attach/detach
classification lives in apps.operations.statuses (the ``ATTACHED`` / ``DETACHED``
status types) and core must not reach across that boundary (ARCH-004). Keeping
the canon model-free also lets apps.operations import it (only ``apps.core.models``
is forbidden there) and lets the invariants run as property tests without a DB
(mirrors the pure ``_resolve_roster`` / ``derive_report`` layers).
"""

from dataclasses import dataclass
from enum import IntEnum

# Sentinel position level for an employee whose ``position_code`` matched no
# ``Position`` row (Employee.position_code is a plain string, not an FK, and the
# Position table may be sparse on the pilot until the 2.7 import / 2.8 admin
# seed it). Such rows sort AFTER every known level inside their group, falling
# back to surname — graceful, never a crash (story 2.6 AC-3).
UNKNOWN_LEVEL = 10**9


class RosterGroup(IntEnum):
    """Sort block of a person. The integer value IS the block order.

    ATTACHED = прикомандированный (Secondment IN), DETACHED = откомандированный
    (Secondment OUT) — see Glossary (architecture.md). The classification is
    supplied by the caller; the canon only orders by it.
    """

    OWN = 0
    ATTACHED = 1
    DETACHED = 2


@dataclass(frozen=True)
class RosterEntry:
    """One sortable person, decoupled from any ORM model.

    ``payload`` carries the caller's original object (an Employee, a status
    row, …) through the sort so it comes back in canonical order. ``id`` is the
    stable final tie-break — equal (group, level, surname) must resolve to the
    same order on every run / input ordering, or the расход order would float.
    """

    group: RosterGroup
    position_level: int
    surname: str
    id: object
    payload: object = None


def _surname_key(surname):
    """Case-insensitive surname key; a blank surname — empty OR whitespace-only —
    sorts AFTER named people among otherwise-equal entries (it must not leapfrog
    to the top because ``"   "`` is truthy). Surrounding whitespace is stripped
    so ``"  Ров  "`` and ``"Ров"`` collate together (donor data is dirty)."""
    value = (surname or "").strip()
    return (value == "", value.casefold())


def roster_sort_key(entry):
    """The canon key: group block, then position level (asc), then surname,
    then a stable id tie-break."""
    return (
        int(entry.group),
        entry.position_level,
        _surname_key(entry.surname),
        str(entry.id),
    )


def sort_roster(entries):
    """Return ``entries`` in canonical order (pure; does not mutate input)."""
    return sorted(entries, key=roster_sort_key)
