"""Story 5.5a — светофор ОДНОГО подразделения (drift detection).

For one ``(division_id, business_date)`` this computes a three-colour
``TrafficLightStatus``:

* **GREEN**  — there is a current ``DailySubmission`` and ``derive(снапшот)``
  equals ``derive(live)``.
* **YELLOW** — there is a current submission but the derived расход has drifted
  (``drift`` carries the per-employee details).
* **RED**    — there is no current submission.

The drift is computed at the level of DERIVED WINNERS (``resolve_status`` —
the расход winner of one employee on the date), NOT raw facts:
``drift = diff(derive(снапшот), derive(live))`` (ARCH-DATA-021, architecture.md
§ARCH-DATA-021). A rename, a delete+recreate of an identical fact, or a change
that does not move any winner therefore stays GREEN — the расход is held by the
snapshot BY DESIGN; the светофор only *surfaces* divergence, it never rewrites
the расход. This is a different question from 5.3b's ``_compute_event`` /
``_diff_key`` (a raw-fact diff that picks the ``event`` value); do not conflate
them.

Scope (5.5a): one division, own-level. The cascade up the division tree
(worst-colour roll-up + the upward tree primitive + a bulk submission selector)
is Story 5.5b. No API / RBAC scoping (mirror ``StrengthReportService`` — RBAC
narrowing arrives with the API stories 5.8/10.4); no notifications/lock/audit.

Traps honoured here:

* snapshot ``rows`` carry ``employee_id`` as ``str`` and dates as ISO strings;
  live ``overlapping_on`` carries UUID ``employee_id`` and ``date`` objects.
  Keys are normalised to ``str`` on both sides and snapshot dates are parsed via
  ``date.fromisoformat`` before ``resolve_status`` (which compares against a
  ``date``). Otherwise: a false 100 % drift, or a ``str <= date`` TypeError.
* live winners come from ONE ``overlapping_on`` over the own-level roster +
  Python grouping — never ``status_on`` in a loop (NFR-4, donor COUNT-in-loop).
* live derive is OWN-LEVEL (``roster_on(date, {division_id})``), NOT
  ``StrengthReportService.compute`` (it subtree-aggregates — that is the 5.5b
  cascade); the snapshot is own-level (5.3a), so the two sides are comparable.
"""

import uuid
from dataclasses import dataclass
from datetime import date

from django.db import models

from apps.core.selectors import CoreDivisionTreeSelector, HistoricalEmployeeSelector
from apps.operations.statuses.selectors import EmployeeStatusSelector
from apps.operations.statuses.services import resolve_status
from apps.operations.submissions.selectors import DailySubmissionSelector


class TrafficLightStatus(models.TextChoices):
    """Светофор индикатор (architecture.md §ARCH-DATA-021, table L387).

    A value object — never stored on a model; TextChoices gives value+label
    parity with the future API/front (mirror DailySubmission.Event).

    GREEN/YELLOW/RED are the per-division colours (5.5a). NEUTRAL and UNKNOWN are
    cascade-only (5.5b): ``division_traffic_light`` never returns them, but the
    tree roll-up needs a neutral element (a node with nothing to submit) and an
    isolated-error colour (a node whose derive raised ``ValueError`` — D1).
    """

    GREEN = "GREEN", "Зелёный"
    YELLOW = "YELLOW", "Жёлтый"
    RED = "RED", "Красный"
    # Cascade-only (5.5b).
    NEUTRAL = "NEUTRAL", "Нет данных"
    UNKNOWN = "UNKNOWN", "Неопределён"


@dataclass(frozen=True)
class DivisionTrafficLight:
    """Per-division светофор result.

    ``drift`` is populated only for YELLOW:
    ``{"added": [employee_id], "removed": [employee_id],
       "changed": [{"employee_id", "from", "to"}]}`` (employee_id as str —
    JSON-serialisable; deterministic order).
    """

    status: str
    late: bool
    drift: dict | None


def _live_winners(division_id, business_date) -> dict:
    """OWN-LEVEL derive(live): {str(employee_id): winner_code}.

    One ``overlapping_on`` over the roster + Python grouping (never status_on
    in a loop). An employee with no acting fact resolves to "IN_SERVICE".
    """
    roster = HistoricalEmployeeSelector.roster_on(business_date, {division_id})
    employee_ids = roster.get(division_id, [])
    rows = EmployeeStatusSelector.overlapping_on(business_date, employee_ids)
    by_employee: dict[str, list] = {}
    for row in rows:
        by_employee.setdefault(str(row["employee_id"]), []).append(row)
    return {
        str(eid): resolve_status(by_employee.get(str(eid), []), business_date)
        for eid in employee_ids
    }


def _snapshot_winners(snapshot, business_date) -> dict:
    """derive(снапшот): {str(employee_id): winner_code}, only from the snapshot.

    Roster is the denominator — every roster employee gets a winner (no acting
    fact -> "IN_SERVICE"); ISO dates are parsed to ``date`` before resolve.
    """
    by_employee: dict[str, list] = {}
    for row in snapshot.get("rows", []):
        by_employee.setdefault(row["employee_id"], []).append(
            {
                "status_type_code": row["status_type_code"],
                "date_start": date.fromisoformat(row["date_start"]),
                "date_end": date.fromisoformat(row["date_end"]),
            }
        )
    return {
        member["employee_id"]: resolve_status(
            by_employee.get(member["employee_id"], []), business_date
        )
        for member in snapshot.get("roster", [])
    }


def _diff_winners(snap: dict, live: dict) -> dict | None:
    """Per-employee winner diff; None when snapshot and live agree."""
    snap_ids, live_ids = set(snap), set(live)
    added = sorted(live_ids - snap_ids)
    removed = sorted(snap_ids - live_ids)
    changed = sorted(
        (
            {"employee_id": eid, "from": snap[eid], "to": live[eid]}
            for eid in snap_ids & live_ids
            if snap[eid] != live[eid]
        ),
        key=lambda item: item["employee_id"],
    )
    if not (added or removed or changed):
        return None
    return {"added": added, "removed": removed, "changed": changed}


_UNSET = object()  # сентинел «current не передан»: None — легитимное значение


def division_traffic_light(
    division_id, business_date, *, current=_UNSET
) -> DivisionTrafficLight:
    """Светофор of one division on ``business_date`` (own-level drift).

    RED = no current submission (the control hour does not gate RED here — it
    already fed ``late`` at submit time); otherwise GREEN/YELLOW from the
    per-employee winner diff of derive(снапшот) vs derive(live).

    ``current`` — уже загруженная current-строка (или ``None`` = «строки
    нет»), если вызывающий держит её из ``current_for_many`` (day-state
    detail, ревью 10.6): внутренний ``current_for`` тогда пропускается —
    повторное чтение того же состояния было бы лишним запросом и
    TOCTOU-рассинхроном list vs detail при конкурентном submit_day. Сентинел,
    а не None-дефолт: ``None`` легально означает «current-строки нет».
    """
    division_id = uuid.UUID(str(division_id))
    if current is _UNSET:
        current = DailySubmissionSelector.current_for(division_id, business_date)
    if current is None:
        return DivisionTrafficLight(
            status=TrafficLightStatus.RED.value, late=False, drift=None
        )
    drift = _diff_winners(
        _snapshot_winners(current.snapshot, business_date),
        _live_winners(division_id, business_date),
    )
    status = TrafficLightStatus.GREEN if drift is None else TrafficLightStatus.YELLOW
    return DivisionTrafficLight(status=status.value, late=current.late, drift=drift)


# --- Story 5.5b — cascade up the division tree -------------------------------
#
# Per-division own-state (5.5a) is rolled UP the division tree by worst-colour in
# ONE post-order fold, computed BULK (one roster_on / overlapping_on /
# current_for_many / children_map — NFR-4 forbids a query per node). A node with
# nothing to submit is NEUTRAL (closes the Q3 case 5.5a handed the cascade); a
# node whose derive raises ``ValueError`` (an unknown status_type_code) is
# isolated to UNKNOWN (D1, deferred from 5.5a code-review) so that one broken
# division never sinks the whole tree. Other exception classes are deliberately
# NOT caught: a KeyError/TypeError from a drifted snapshot schema stays fail-loud
# (STOP-on-data, like StrengthReportService) and is owned by the snapshot
# schema-v2 hardening (deferred-work.md, 5.5a defer #2).

_PRECEDENCE = {  # worst-colour: UNKNOWN > RED > YELLOW > GREEN, NEUTRAL neutral
    TrafficLightStatus.NEUTRAL.value: 0,
    TrafficLightStatus.GREEN.value: 1,
    TrafficLightStatus.YELLOW.value: 2,
    TrafficLightStatus.RED.value: 3,
    TrafficLightStatus.UNKNOWN.value: 4,
}


@dataclass(frozen=True)
class CascadeTrafficLight:
    """Rolled-up светофор of one division over its whole subtree (5.5b).

    ``status`` is the worst colour of the division's own state and every
    descendant; ``late`` is the OR of late submissions anywhere in the subtree.
    Drift details (added/removed/changed) stay per-division in
    ``division_traffic_light`` (5.5a drill-down) — the cascade carries only colour.
    """

    status: str
    late: bool


def _worst(*statuses) -> str:
    """Worst colour by precedence; empty / all-NEUTRAL → NEUTRAL.

    *Why UNKNOWN on top:* an unknown/broken node must not be masked green —
    "не знаю" is honester than "всё ок".
    """
    return max(
        statuses,
        key=lambda status: _PRECEDENCE[status],
        default=TrafficLightStatus.NEUTRAL.value,
    )


def _descendants(root, children) -> set:
    """Subtree ids (root + all descendants) folded from a ``children_map``.

    Derived in-process so the whole cascade costs ONE Division scan
    (``children_map``) — never a second ``subtree_ids`` query (AC-5). Same DFS as
    ``CoreDivisionTreeSelector.subtree_ids``; the adjacency itself still comes
    from the one sanctioned tree channel (ARCH-DATA-024).
    """
    result, stack = set(), [root]
    while stack:
        node = stack.pop()
        if node in result:
            continue
        result.add(node)
        stack.extend(children.get(node, []))
    return result


def _subtree_own_states(subtree, business_date) -> dict:
    """{division_id: (status, late)} own-state per division, computed BULK.

    One ``roster_on`` + one ``overlapping_on`` + one ``current_for_many`` over the
    whole subtree (NFR-4 — no per-division query). own-state reuses the 5.5a
    helpers so a leaf matches ``division_traffic_light`` byte-for-byte: no current
    submission + non-empty own-roster → RED, no submission + empty roster →
    NEUTRAL (the Q3 case 5.5a handed the cascade), submitted →
    GREEN/YELLOW from the per-employee winner diff.

    D1 isolation: ``resolve_status`` raises ``ValueError`` on a
    ``status_type_code`` outside ``STATUS_TYPE_PRIORITIES`` (a snapshot OR a live
    fact). The per-division derive is wrapped so that division alone becomes
    UNKNOWN and the rest of the subtree still computes. ONLY ``ValueError`` is
    caught — a KeyError/TypeError from a drifted snapshot schema is left to
    propagate (fail-loud, consistent with the deferred snapshot schema-v2
    hardening), not silently masked as UNKNOWN.
    """
    roster = HistoricalEmployeeSelector.roster_on(business_date, subtree)
    all_employees = [eid for members in roster.values() for eid in members]
    rows = EmployeeStatusSelector.overlapping_on(business_date, all_employees)
    facts_by_employee: dict[str, list] = {}
    for row in rows:
        facts_by_employee.setdefault(str(row["employee_id"]), []).append(row)
    submissions = DailySubmissionSelector.current_for_many(subtree, business_date)

    own: dict = {}
    for division_id in subtree:
        members = roster.get(division_id, [])
        submission = submissions.get(division_id)
        if submission is None:
            own[division_id] = (
                TrafficLightStatus.RED.value
                if members
                else TrafficLightStatus.NEUTRAL.value,
                False,
            )
            continue
        try:
            live = {
                str(eid): resolve_status(
                    facts_by_employee.get(str(eid), []), business_date
                )
                for eid in members
            }
            drift = _diff_winners(
                _snapshot_winners(submission.snapshot, business_date), live
            )
            status = (
                TrafficLightStatus.GREEN.value
                if drift is None
                else TrafficLightStatus.YELLOW.value
            )
            own[division_id] = (status, submission.late)
        except ValueError:
            own[division_id] = (TrafficLightStatus.UNKNOWN.value, submission.late)
    return own


def _fold_cascade(subtree, children, own) -> dict:
    """Post-order worst-colour fold over ``subtree`` → ``{id: CascadeTrafficLight}``.

    Shared by ``traffic_light_tree`` (one root, 5.5b) and
    ``traffic_light_forest`` (several roots, 10.4) — the fold itself is
    root-agnostic: it rolls every node of ``subtree`` up over its in-subtree
    children, so passing a union of subtrees folds each tree independently.
    """
    result: dict = {}
    folding: set = set()

    def fold(node) -> CascadeTrafficLight:
        if node in result:
            return result[node]
        # Mark in-progress BEFORE descending. A corrupt parent cycle (A→B→A) or
        # self-parent is storable — ``Division.parent`` has no anti-cycle CHECK —
        # and the memo ``result`` is only written POST-order, so a back-edge to a
        # node still being folded must be skipped here, else the recursion never
        # bottoms out (a RecursionError that takes down the whole call). Mirrors
        # the visited guard in ``_descendants`` / ``subtree_ids``; for a proper
        # tree this set is never hit, so the result is unchanged.
        folding.add(node)
        own_status, own_late = own[node]
        child_states = [
            fold(child)
            for child in children.get(node, [])
            if child in subtree and child not in folding
        ]
        status = _worst(own_status, *(state.status for state in child_states))
        late = own_late or any(state.late for state in child_states)
        folding.discard(node)
        result[node] = CascadeTrafficLight(status=status, late=late)
        return result[node]

    for node in subtree:
        fold(node)
    return result


def traffic_light_tree(root_division_id, business_date) -> dict:
    """Cascade светофор of a subtree → ``{division_id: CascadeTrafficLight}``.

    For every node under ``root_division_id`` (inclusive) the colour is its own
    state (5.5a, bulk) rolled UP by worst-colour over its descendants, ``late``
    OR-ed over the subtree. ONE post-order fold over the children adjacency from
    ``CoreDivisionTreeSelector`` (the single tree channel, ARCH-DATA-024) — never
    ``division_traffic_light`` / a per-node query (NFR-4).
    """
    root = uuid.UUID(str(root_division_id))
    children = CoreDivisionTreeSelector.children_map()
    subtree = _descendants(root, children)
    own = _subtree_own_states(subtree, business_date)
    return _fold_cascade(subtree, children, own)


def traffic_light_forest(
    root_division_ids, business_date, *, children_map=None
) -> dict:
    """Cascade светофор of SEVERAL roots at once (Story 10.4, traffic-tree API).

    The union of the roots' subtrees is computed with the SAME bulk invariants
    as one ``traffic_light_tree`` call: ONE ``children_map`` + ONE ``roster_on``
    + ONE ``overlapping_on`` + ONE ``current_for_many`` over the WHOLE forest
    (NFR-4). Calling ``traffic_light_tree`` per root would multiply every bulk
    query by K roots — the trap this wrapper exists to close. Consumer: the
    traffic-tree роут derives the roots from the actor's RBAC visibility
    (``visible_division_ids``) — K is unbounded input, so the query count must
    not depend on it. Returns ``{division_id: CascadeTrafficLight}`` over the
    union; an empty ``root_division_ids`` yields ``{}``.

    ``children_map`` — уже собранная смежность, если вызывающий строил её сам
    (роут 10.4 кормит ею parent_id узлов): повторный full-scan Division внутри
    был бы вторым сканом на запрос (ревью 10.6; прецедент ``subtree_ids``).
    ``None`` — собрать самостоятельно (обратная совместимость).
    """
    children = (
        CoreDivisionTreeSelector.children_map()
        if children_map is None
        else children_map
    )
    union: set = set()
    for root in root_division_ids:
        union |= _descendants(uuid.UUID(str(root)), children)
    own = _subtree_own_states(union, business_date)
    return _fold_cascade(union, children, own)
