"""Tests for the next-day-lock override (Story 5.6b).

A TomorrowBlockOverride legally lifts the 5.6a block for a business_date (with a
mandatory, non-blank reason AND a non-blank actor), while the laggards stay
visible (overridden=True). DB invariants (non-blank reason + actor, one override
per date), a date-scoped active_for selector, a service that records/validates/
dedupes, and the one additive consultation wired into tomorrow_block (5.6a). No
audit (5.9), no API/422 (5.8).
"""

import itertools
from datetime import date

import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from apps.core import clock
from apps.core.models import Division, DivisionType, Organization
from apps.operations.submissions.models import (
    SubmissionControlSettings,
    TomorrowBlockOverride,
)
from apps.operations.submissions.selectors import TomorrowBlockOverrideSelector
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.block_override import override_tomorrow_block
from apps.operations.submissions.tomorrow_block import tomorrow_block

pytestmark = pytest.mark.django_db

DAY = date(2026, 6, 5)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-TBO")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt):
    org, dt = org_dt
    c = f"TBO-{next(_code)}"
    return Division.objects.create(organization=org, type_code=dt, name=c, code=c)


def _submit(division, business_date=DAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def set_required(division_ids):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = list(division_ids)
    s.save(update_fields=["required_division_ids"])


# --- AC-2: reason non-blank on the DB (rejects "" AND whitespace-only) --------


@pytest.mark.parametrize("bad_reason", ["", "   ", "\t\n"])
def test_reason_must_be_non_blank_at_db(bad_reason):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            TomorrowBlockOverride.objects.create(
                business_date=DAY, reason=bad_reason, overridden_by="boss"
            )


# --- accountability: overridden_by non-blank on the DB -----------------------


@pytest.mark.parametrize("bad_actor", ["", "   "])
def test_overridden_by_must_be_non_blank_at_db(bad_actor):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            TomorrowBlockOverride.objects.create(
                business_date=DAY, reason="форс-мажор", overridden_by=bad_actor
            )


# --- AC-3: one override per date ---------------------------------------------


def test_one_override_per_date():
    TomorrowBlockOverride.objects.create(
        business_date=DAY, reason="форс-мажор", overridden_by="boss"
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            TomorrowBlockOverride.objects.create(
                business_date=DAY, reason="ещё раз", overridden_by="boss2"
            )


# --- AC-5: active_for selector -----------------------------------------------


def test_active_for_true_when_override_exists():
    assert TomorrowBlockOverrideSelector.active_for(DAY) is False
    TomorrowBlockOverride.objects.create(
        business_date=DAY, reason="x", overridden_by="boss"
    )
    assert TomorrowBlockOverrideSelector.active_for(DAY) is True


def test_active_for_is_date_scoped():
    TomorrowBlockOverride.objects.create(
        business_date=DAY, reason="x", overridden_by="boss"
    )
    assert TomorrowBlockOverrideSelector.active_for(date(2026, 6, 6)) is False


# --- AC-6: service records / validates / dedupes -----------------------------


def test_service_creates_override():
    rec = override_tomorrow_block(DAY, actor="boss", reason="форс-мажор")
    assert rec.business_date == DAY
    assert rec.overridden_by == "boss"
    assert rec.reason == "форс-мажор"
    assert rec.created_at is not None
    assert TomorrowBlockOverrideSelector.active_for(DAY) is True


def test_service_stores_stripped_reason_and_actor():
    rec = override_tomorrow_block(DAY, actor="  boss  ", reason="  форс-мажор  ")
    assert rec.overridden_by == "boss"
    assert rec.reason == "форс-мажор"


def test_service_rejects_empty_or_blank_reason():
    for bad in ("", "   "):
        with pytest.raises(ValueError):
            override_tomorrow_block(DAY, actor="boss", reason=bad)
    assert TomorrowBlockOverrideSelector.active_for(DAY) is False


def test_service_rejects_empty_or_blank_actor():
    for bad in ("", "   "):
        with pytest.raises(ValueError):
            override_tomorrow_block(DAY, actor=bad, reason="форс-мажор")
    assert TomorrowBlockOverrideSelector.active_for(DAY) is False


def test_service_rejects_duplicate_with_clean_value_error_no_poison():
    override_tomorrow_block(DAY, actor="boss", reason="первый")
    # A duplicate is a clean domain ValueError, NOT a raw IntegrityError...
    with pytest.raises(ValueError):
        override_tomorrow_block(DAY, actor="boss2", reason="второй")
    # ...and the enclosing transaction is NOT poisoned: the first override
    # survives and the connection is still usable for further ORM calls.
    assert TomorrowBlockOverrideSelector.active_for(DAY) is True
    assert TomorrowBlockOverride.objects.filter(business_date=DAY).count() == 1


# --- AC-7: derive consultation (override lifts block, laggards stay visible) --


def test_override_clears_block_but_keeps_laggards_visible(org_dt):
    a = make_division(org_dt)
    b = make_division(org_dt)
    set_required([a.id, b.id])
    _submit(a)  # b is a laggard → blocked before the override

    before = tomorrow_block(DAY)
    assert before.blocked is True
    assert before.overridden is False
    assert before.laggards == [b.id]

    override_tomorrow_block(DAY, actor="boss", reason="форс-мажор")
    after = tomorrow_block(DAY)
    assert after.blocked is False  # override lifts the block
    assert after.overridden is True  # ...visibly
    assert after.laggards == [b.id]  # laggards still reported


def test_no_override_leaves_5_6a_behavior_unchanged(org_dt):
    a = make_division(org_dt)
    set_required([a.id])  # laggard, no override
    result = tomorrow_block(DAY)
    assert result.blocked is True
    assert result.overridden is False
    assert result.laggards == [a.id]


def test_override_without_laggards_does_not_flip_overridden(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    _submit(a)
    override_tomorrow_block(DAY, actor="boss", reason="на всякий случай")
    result = tomorrow_block(DAY)
    assert result.blocked is False
    assert result.overridden is False
    assert result.laggards == []


# --- NFR-4: override consult is exactly one extra query, only when laggards ---


def test_no_active_for_query_when_no_laggards(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    _submit(a)  # no laggards
    override_tomorrow_block(DAY, actor="boss", reason="x")  # override present...
    with CaptureQueriesContext(connection) as ctx:
        tomorrow_block(DAY)
    # ...but the short-circuit means active_for is NOT consulted:
    # settings + current_for_many only.
    assert len(ctx) == 2


def test_query_count_with_override_invariant_to_required(org_dt):
    first = make_division(org_dt)
    set_required([first.id])  # laggard
    override_tomorrow_block(DAY, actor="boss", reason="x")
    with CaptureQueriesContext(connection) as ctx1:
        tomorrow_block(DAY)
    n1 = len(ctx1)

    more = [make_division(org_dt) for _ in range(5)]
    set_required([first.id] + [d.id for d in more])
    with CaptureQueriesContext(connection) as ctx6:
        tomorrow_block(DAY)
    n6 = len(ctx6)

    assert n1 == n6, f"N+1: {n1} vs {n6}"
    # settings + current_for_many + active_for, invariant to required count.
    assert n6 == 3, f"unexpected query count: {n6}"
