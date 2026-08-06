"""Story 20.2a (FR-38/UJ-2): compute_expense_dashboard() — тонкая композиция
УЖЕ существующих produce-функций (StrengthReportService.compute() + 5.6a's
tomorrow_block()), с stale-фильтром отстающих (тот же приём, что
tomorrow_gate.py's assert_tomorrow_not_blocked, review D1 2026-07-13) и
разрешением имён для дашборда."""

import itertools
from datetime import date

import pytest

from apps.core.models import Division, DivisionType, Organization
from apps.operations.selectors import compute_expense_dashboard
from apps.operations.submissions.models import (
    SubmissionControlSettings,
    TomorrowBlockOverride,
)
from apps.operations.submissions.services import submit_day
from apps.core import clock

pytestmark = pytest.mark.django_db

DAY = date(2026, 6, 5)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-ED")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt, is_active=True):
    org, dt = org_dt
    c = f"ED-{next(_code)}"
    return Division.objects.create(
        organization=org, type_code=dt, name=c, code=c, is_active=is_active
    )


def _submit(division, business_date=DAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def set_required(division_ids):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = list(division_ids)
    s.save(update_fields=["required_division_ids"])


def test_expense_matches_direct_strength_report_call(org_dt):
    from apps.operations.statuses.services.strength_report import StrengthReportService

    result = compute_expense_dashboard(DAY)
    direct = StrengthReportService.compute(DAY)

    assert result["expense"] == direct


def test_submitted_division_is_not_a_laggard(org_dt):
    a = make_division(org_dt)
    _submit(a)
    set_required([a.id])

    result = compute_expense_dashboard(DAY)

    assert result["laggards"] == []
    assert result["blocked"] is False


def test_unsubmitted_division_is_a_laggard_with_name(org_dt):
    a = make_division(org_dt)
    set_required([a.id])

    result = compute_expense_dashboard(DAY)

    assert result["laggards"] == [{"division_id": a.id, "name": a.name}]
    assert result["blocked"] is True


def test_inactive_division_is_not_a_laggard(org_dt):
    a = make_division(org_dt, is_active=False)
    set_required([a.id])

    result = compute_expense_dashboard(DAY)

    assert result["laggards"] == []
    assert result["blocked"] is False


def test_no_required_divisions_means_no_laggards():
    result = compute_expense_dashboard(DAY)

    assert result["laggards"] == []
    assert result["blocked"] is False


def test_ghost_only_laggards_do_not_block(org_dt):
    # required=[deactivated] -> tomorrow_block() reports blocked=True raw,
    # но после stale-фильтра laggards пуст -> итоговый blocked ДОЛЖЕН стать
    # False (тот же приём, что tomorrow_gate.py, review D1 2026-07-13).
    a = make_division(org_dt, is_active=False)
    set_required([a.id])

    result = compute_expense_dashboard(DAY)

    assert result["laggards"] == []
    assert result["blocked"] is False


def test_overridden_passes_through_with_real_laggard(org_dt):
    # Review (Blind Hunter + Edge Case Hunter, независимо совпали): AC-6
    # заявляет "overridden прокинут как есть" при непустом filtered_laggards
    # — этот путь не был покрыт ни одним тестом до ревью.
    a = make_division(org_dt)
    set_required([a.id])
    TomorrowBlockOverride.objects.create(
        business_date=DAY, reason="форс-мажор", overridden_by="boss"
    )

    result = compute_expense_dashboard(DAY)

    assert result["laggards"] == [{"division_id": a.id, "name": a.name}]
    assert result["blocked"] is False
    assert result["overridden"] is True
