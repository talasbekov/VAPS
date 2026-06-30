"""Tests for tomorrow_block — the derive «next-day lock» (Story 5.6a).

Read-only FR-18 core: given a business_date, which «необходимые управления»
(SubmissionControlSettings.required_division_ids) have NO current submission →
{blocked, laggards}. ONE bulk query (current_for_many, reuse 5.5b) — NFR-4 forbids
a query per required division. No override (5.6b), no HTTP-422 (API 5.8/6.10).
"""

import itertools
from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.core import clock
from apps.core.models import Division, DivisionType, Organization
from apps.operations.submissions.models import SubmissionControlSettings
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.tomorrow_block import TomorrowBlock, tomorrow_block

pytestmark = pytest.mark.django_db

DAY = date(2026, 6, 5)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-TB")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt):
    org, dt = org_dt
    c = f"TB-{next(_code)}"
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


# --- AC-3: laggard = required without a current submission --------------------


def test_blocked_with_laggards_when_a_required_division_has_not_submitted(org_dt):
    a = make_division(org_dt)
    b = make_division(org_dt)
    set_required([a.id, b.id])
    _submit(a)  # a submitted; b did not
    result = tomorrow_block(DAY)
    assert result.blocked is True
    assert result.laggards == [b.id]


def test_not_blocked_when_all_required_submitted(org_dt):
    a = make_division(org_dt)
    b = make_division(org_dt)
    set_required([a.id, b.id])
    _submit(a)
    _submit(b)
    result = tomorrow_block(DAY)
    assert result.blocked is False
    assert result.laggards == []


# --- AC-4: empty config is not a block ---------------------------------------


def test_empty_config_is_not_blocked(org_dt):
    set_required([])
    result = tomorrow_block(DAY)
    assert result.blocked is False
    assert result.laggards == []


# --- AC-5: deterministic laggard order ---------------------------------------


def test_laggards_are_deterministically_ordered(org_dt):
    divs = [make_division(org_dt) for _ in range(4)]
    set_required([d.id for d in divs])  # none submitted → all laggards
    result = tomorrow_block(DAY)
    assert result.blocked is True
    assert result.laggards == sorted((d.id for d in divs), key=str)


# --- AC-2/AC-3: only required divisions count --------------------------------


def test_non_required_division_without_submission_is_ignored(org_dt):
    req = make_division(org_dt)
    make_division(org_dt)  # not required, no submission → irrelevant
    set_required([req.id])
    _submit(req)
    result = tomorrow_block(DAY)
    assert result.blocked is False
    assert result.laggards == []


# --- Q1/Д1: an empty-roster required division still blocks (required=required) -


def test_empty_roster_required_division_without_submission_is_a_laggard(org_dt):
    # Д1: a required division blocks if it has no current submission REGARDLESS of
    # roster — required = required (it can still submit an empty day, 5.3a). This
    # is the deliberate divergence from светофор-NEUTRAL. make_division creates a
    # division with no employees → empty own-roster.
    empty = make_division(org_dt)
    set_required([empty.id])
    result = tomorrow_block(DAY)
    assert result.blocked is True
    assert result.laggards == [empty.id]


def test_empty_roster_required_division_that_submitted_clears_the_block(org_dt):
    empty = make_division(org_dt)
    set_required([empty.id])
    _submit(empty)  # an empty-day submission (5.3a builds {roster:[], rows:[]})
    result = tomorrow_block(DAY)
    assert result.blocked is False
    assert result.laggards == []


# --- AC-1: bulk — query count invariant to number of required (NFR-4) --------


def test_query_count_invariant_to_number_of_required(org_dt):
    one = make_division(org_dt)
    set_required([one.id])
    with CaptureQueriesContext(connection) as ctx1:
        tomorrow_block(DAY)
    n1 = len(ctx1)

    many = [make_division(org_dt) for _ in range(5)]
    set_required([d.id for d in many])
    with CaptureQueriesContext(connection) as ctx5:
        tomorrow_block(DAY)
    n5 = len(ctx5)

    assert n1 == n5, f"N+1: {n1} queries for 1 required vs {n5} for 5"
    assert n5 <= 3, f"unexpected query fan-out: {n5}"


# --- type: result is TomorrowBlock with list laggards ------------------------


def test_result_type_and_laggards_are_uuid(org_dt):
    a = make_division(org_dt)
    set_required([a.id])  # not submitted → laggard
    result = tomorrow_block(DAY)
    assert isinstance(result, TomorrowBlock)
    assert result.laggards == [a.id]
    assert result.laggards[0] == a.id  # UUID identity (Q2 default: UUID)
