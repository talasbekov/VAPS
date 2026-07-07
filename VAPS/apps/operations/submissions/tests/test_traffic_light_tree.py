"""Tests for traffic_light_tree — the cascade up the division tree (Story 5.5b).

Per-division own-state (5.5a drift) is rolled UP the division tree by worst-colour
(UNKNOWN > RED > YELLOW > GREEN, NEUTRAL neutral) in ONE post-order fold over
``CoreDivisionTreeSelector``, ``late`` OR-ed over the subtree, a broken node
isolated to UNKNOWN. Everything is computed BULK (one roster_on / overlapping_on /
current_for_many / children_map) — NFR-4 forbids a query per node.
"""

import itertools
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.traffic_light import (
    CascadeTrafficLight,
    TrafficLightStatus,
    _worst,
    division_traffic_light,
    traffic_light_tree,
)

pytestmark = pytest.mark.django_db

TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
UTC = ZoneInfo("UTC")
DAY = date(2026, 6, 5)
_iin = itertools.count(5000)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-TLT")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt, parent=None):
    org, dt = org_dt
    c = f"TLT-{next(_code)}"
    return Division.objects.create(
        organization=org, type_code=dt, name=c, code=c, parent=parent
    )


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


def _aware(day, hour, minute):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ)


def _submit(division, business_date=DAY, override=None):
    with clock.override(override or business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def _green_leaf(org_dt, parent):
    leaf = make_division(org_dt, parent=parent)
    emp = make_employee(leaf)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(leaf)
    return leaf


# --- AC-1/AC-2: fold worst-colour up the tree --------------------------------


def test_root_red_when_one_child_not_submitted(org_dt):
    root = make_division(org_dt)
    a = _green_leaf(org_dt, root)  # GREEN
    b = make_division(org_dt, parent=root)
    make_employee(b)  # roster but no submission → RED
    tree = traffic_light_tree(root.id, DAY)
    assert tree[a.id].status == TrafficLightStatus.GREEN
    assert tree[b.id].status == TrafficLightStatus.RED
    assert tree[root.id].status == TrafficLightStatus.RED  # worst child wins


def test_root_yellow_when_worst_child_is_yellow(org_dt):
    root = make_division(org_dt)
    a = _green_leaf(org_dt, root)  # GREEN
    b = make_division(org_dt, parent=root)
    eb = make_employee(b)
    _submit(b)  # snapshot winner = IN_SERVICE
    make_status(eb, "DUTY", date(2026, 5, 1), date(2026, 7, 1))  # live drift → YELLOW
    tree = traffic_light_tree(root.id, DAY)
    assert tree[a.id].status == TrafficLightStatus.GREEN
    assert tree[b.id].status == TrafficLightStatus.YELLOW
    assert tree[root.id].status == TrafficLightStatus.YELLOW


def test_root_green_when_all_green(org_dt):
    root = make_division(org_dt)
    er = make_employee(root)
    make_status(er, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root)
    a = _green_leaf(org_dt, root)
    b = _green_leaf(org_dt, root)
    tree = traffic_light_tree(root.id, DAY)
    assert tree[root.id].status == TrafficLightStatus.GREEN
    assert tree[a.id].status == TrafficLightStatus.GREEN
    assert tree[b.id].status == TrafficLightStatus.GREEN


def test_deep_tree_folds_worst_from_a_grandchild(org_dt):
    root = make_division(org_dt)
    mid = make_division(org_dt, parent=root)
    _green_leaf(org_dt, mid)  # green grandchild
    bad = make_division(org_dt, parent=mid)
    make_employee(bad)  # roster, no submission → RED grandchild
    tree = traffic_light_tree(root.id, DAY)
    assert tree[bad.id].status == TrafficLightStatus.RED
    assert tree[mid.id].status == TrafficLightStatus.RED  # rolls up from grandchild
    assert tree[root.id].status == TrafficLightStatus.RED


# --- AC-2: worst-colour precedence (unit) ------------------------------------


def test_worst_colour_precedence_unit():
    g = TrafficLightStatus.GREEN.value
    y = TrafficLightStatus.YELLOW.value
    r = TrafficLightStatus.RED.value
    u = TrafficLightStatus.UNKNOWN.value
    n = TrafficLightStatus.NEUTRAL.value
    assert _worst(g, y) == y
    assert _worst(y, r) == r
    assert _worst(r, u) == u  # UNKNOWN beats RED
    assert _worst(g, y, r, u) == u
    assert _worst(n, g) == g  # NEUTRAL never masks a real colour
    assert _worst(n, n) == n  # all-neutral → NEUTRAL
    assert _worst(n) == n


# --- AC-2/AC-3: NEUTRAL semantics --------------------------------------------


def test_neutral_intermediate_does_not_mask_green_children(org_dt):
    root = make_division(org_dt)  # no roster / no submission → NEUTRAL own
    mid = make_division(org_dt, parent=root)  # NEUTRAL own
    leaf = _green_leaf(org_dt, mid)
    tree = traffic_light_tree(root.id, DAY)
    assert tree[leaf.id].status == TrafficLightStatus.GREEN
    assert tree[mid.id].status == TrafficLightStatus.GREEN  # NEUTRAL + GREEN child
    assert tree[root.id].status == TrafficLightStatus.GREEN


def test_empty_subtree_is_neutral(org_dt):
    root = make_division(org_dt)
    child = make_division(org_dt, parent=root)
    tree = traffic_light_tree(root.id, DAY)
    assert tree[root.id].status == TrafficLightStatus.NEUTRAL
    assert tree[child.id].status == TrafficLightStatus.NEUTRAL


def test_leaf_with_roster_no_submission_is_red_not_neutral(org_dt):
    root = make_division(org_dt)
    leaf = make_division(org_dt, parent=root)
    make_employee(leaf)  # people but no submission → RED (mirror 5.5a)
    tree = traffic_light_tree(root.id, DAY)
    assert tree[leaf.id].status == TrafficLightStatus.RED


# --- AC-3: own-state byte-for-byte matches 5.5a division_traffic_light --------


def test_leaf_own_state_matches_division_traffic_light(org_dt):
    root = make_division(org_dt)
    g = _green_leaf(org_dt, root)
    y = make_division(org_dt, parent=root)
    ey = make_employee(y)
    _submit(y)
    make_status(ey, "DUTY", date(2026, 5, 1), date(2026, 7, 1))  # drift
    r = make_division(org_dt, parent=root)
    make_employee(r)  # no submission
    tree = traffic_light_tree(root.id, DAY)
    for leaf in (g, y, r):
        assert tree[leaf.id].status == division_traffic_light(leaf.id, DAY).status
    assert tree[g.id].status == TrafficLightStatus.GREEN
    assert tree[y.id].status == TrafficLightStatus.YELLOW
    assert tree[r.id].status == TrafficLightStatus.RED


# --- AC-4: late visible in the cascade (OR up the subtree) --------------------


def test_late_propagates_up_the_cascade(org_dt):
    root = make_division(org_dt)
    leaf = make_division(org_dt, parent=root)
    emp = make_employee(leaf)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    sub = _submit(leaf, override=_aware(DAY, 17, 30))  # after 17:00 → late
    assert sub.late is True
    tree = traffic_light_tree(root.id, DAY)
    assert tree[leaf.id].status == TrafficLightStatus.GREEN
    assert tree[leaf.id].late is True
    assert tree[root.id].late is True  # OR up the subtree


def test_on_time_submission_keeps_late_false(org_dt):
    root = make_division(org_dt)
    _green_leaf(org_dt, root)  # _submit default → local-midnight clock → on time
    tree = traffic_light_tree(root.id, DAY)
    assert tree[root.id].late is False


# --- AC-6: D1 — a broken node is isolated to UNKNOWN --------------------------


def test_d1_unknown_status_code_isolates_to_unknown(org_dt):
    root = make_division(org_dt)
    good = _green_leaf(org_dt, root)
    bad = make_division(org_dt, parent=root)
    emp = make_employee(bad)
    # a current submission whose snapshot carries a status_type_code outside
    # STATUS_TYPE_PRIORITIES → resolve_status raises ValueError → UNKNOWN (D1),
    # the fold must NOT crash and the neighbour must still be computed.
    DailySubmission.objects.create(
        division_id=bad.id,
        business_date=DAY,
        version=1,
        is_current=True,
        event="CONFIRMED_NO_CHANGES",
        submitted_by="op",
        submitted_at=datetime(2026, 6, 5, 12, 0, tzinfo=UTC),
        late=False,
        snapshot={
            "schema_version": 1,
            "roster": [{"employee_id": str(emp.id), "full_name": "x", "rank": ""}],
            "rows": [
                {
                    "employee_id": str(emp.id),
                    "status_type_code": "BOGUS_CODE",
                    "status_id": 1,
                    "date_start": "2026-06-01",
                    "date_end": "2026-07-01",
                    "source": "USER",
                }
            ],
        },
    )
    tree = traffic_light_tree(root.id, DAY)
    assert tree[bad.id].status == TrafficLightStatus.UNKNOWN
    assert tree[good.id].status == TrafficLightStatus.GREEN  # neighbour survives
    assert tree[root.id].status == TrafficLightStatus.UNKNOWN  # UNKNOWN > GREEN


# --- AC-5: bulk — no N+1 (query count invariant to division count) -----------


def test_query_count_invariant_to_number_of_divisions(org_dt):
    root1 = make_division(org_dt)
    er = make_employee(root1)
    make_status(er, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root1)
    with CaptureQueriesContext(connection) as ctx1:
        traffic_light_tree(root1.id, DAY)
    n1 = len(ctx1)

    root5 = make_division(org_dt)
    e0 = make_employee(root5)
    make_status(e0, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root5)
    for _ in range(4):
        _green_leaf(org_dt, root5)
    with CaptureQueriesContext(connection) as ctx5:
        traffic_light_tree(root5.id, DAY)
    n5 = len(ctx5)

    assert n1 == n5, f"N+1: {n1} queries for 1 division vs {n5} for 5"
    assert n5 <= 6, f"unexpected query fan-out: {n5}"


# --- AC-7: current_for_many bulk selector ------------------------------------


def test_current_for_many_returns_current_per_division(org_dt):
    a = make_division(org_dt)
    b = make_division(org_dt)
    c = make_division(org_dt)  # no submission
    _submit(a)
    _submit(b)
    result = DailySubmissionSelector.current_for_many({a.id, b.id, c.id}, DAY)
    assert set(result) == {a.id, b.id}  # division without a submission is absent
    assert c.id not in result
    assert result[a.id].division_id == a.id


def test_current_for_many_excludes_non_current_versions(org_dt):
    d = make_division(org_dt)
    common = dict(
        division_id=d.id,
        business_date=DAY,
        event="CONFIRMED_NO_CHANGES",
        submitted_by="op",
        submitted_at=datetime(2026, 6, 5, 12, 0, tzinfo=UTC),
        snapshot={},
    )
    DailySubmission.objects.create(version=1, is_current=False, **common)
    current = DailySubmission.objects.create(version=2, is_current=True, **common)
    result = DailySubmissionSelector.current_for_many({d.id}, DAY)
    assert result[d.id].id == current.id
    assert result[d.id].version == 2


# --- robustness: a corrupt parent cycle must not recurse forever -------------


def test_self_parent_cycle_does_not_recurse_forever(org_dt):
    # Division.parent has no anti-cycle CHECK, so a self-parent is storable.
    # The post-order fold must break the back-edge (in-progress guard), not
    # RecursionError; the node's own-state is still computed.
    root = make_division(org_dt)
    emp = make_employee(root)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root)
    root.parent = root  # self-parent cycle
    root.save(update_fields=["parent"])
    tree = traffic_light_tree(root.id, DAY)  # must not RecursionError
    assert set(tree) == {root.id}
    assert tree[root.id].status == TrafficLightStatus.GREEN


def test_two_node_parent_cycle_is_broken_and_folds(org_dt):
    a = make_division(org_dt)
    ea = make_employee(a)
    make_status(ea, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(a)  # a own-state GREEN
    b = make_division(org_dt, parent=a)
    make_employee(b)  # roster, no submission → RED
    a.parent = b  # close the cycle: a.parent=b, b.parent=a
    a.save(update_fields=["parent"])
    tree = traffic_light_tree(a.id, DAY)  # must not RecursionError
    assert set(tree) == {a.id, b.id}  # both nodes computed
    assert tree[b.id].status == TrafficLightStatus.RED  # own-state dominates
    # `a`'s rolled-up colour over a corrupt cycle is order-dependent (the
    # back-edge is broken at whichever node the fold enters first) — undefined
    # by nature; the guarantee is only that it computes a valid colour, no crash.
    assert tree[a.id].status in {
        TrafficLightStatus.GREEN.value,
        TrafficLightStatus.RED.value,
    }


# --- robustness: a str root id is accepted -----------------------------------


def test_str_root_division_id_is_accepted(org_dt):
    root = make_division(org_dt)
    leaf = _green_leaf(org_dt, root)
    tree = traffic_light_tree(str(root.id), DAY)
    assert tree[root.id].status == TrafficLightStatus.GREEN
    assert tree[leaf.id].status == TrafficLightStatus.GREEN


# --- type: result values are CascadeTrafficLight -----------------------------


def test_result_values_are_cascade_traffic_light(org_dt):
    root = make_division(org_dt)
    _green_leaf(org_dt, root)
    tree = traffic_light_tree(root.id, DAY)
    assert all(isinstance(v, CascadeTrafficLight) for v in tree.values())
