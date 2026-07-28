"""Story 10.6a — свежесть сводки (GET /daily-submissions/freshness/).

HTTP-контракт только: доменная логика (FRESH/STALE/None, три оси) уже
покрыта `test_summary_service.py` — этот файл проверяет ТОЛЬКО обёртку
(гейты, форму ответа, `NOT_SUMMARY`-литерал, 400/403/404). Фикстуры —
прямой прецедент `test_summary_service.py` (`_family`/`_assemble`) +
`test_expense_journal_api.py` (`_client`/`_grant`, APIClient-стиль).
"""

import itertools
import uuid
from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.summary_service import assemble_summary

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 9)
ACTOR = "op-freshness"
_iin = itertools.count(9500)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-FRESH")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt, parent=None):
    org, dt = org_dt
    c = f"FRESH-{next(_code)}"
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


def _submit(division, business_date=TODAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def _assemble(division, business_date=TODAY, actor=ACTOR):
    with clock.override(business_date):
        return assemble_summary(
            division_id=division.id, business_date=business_date, actor=actor
        )


def _family(org_dt, children=2):
    """Родитель со own-штабом + ``children`` детей со штатом и сдачей."""
    parent = make_division(org_dt)
    make_employee(parent)
    kids = []
    for _ in range(children):
        child = make_division(org_dt, parent=parent)
        make_employee(child)
        kids.append((child, _submit(child)))
    return parent, kids


def _grant(user_id, division):
    # freshness gates on READ_PERMISSION (daily_report.mark_update) — the same
    # code as list/retrieve — DIVISION_OPERATOR carries it, ORGD does not
    # (ORGD carries daily_report.generate, a different code entirely).
    UserRole.objects.create(
        user_id=user_id, role_code_id="DIVISION_OPERATOR", scope_division_id=division.id
    )


def _client(actor=None):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def url():
    return reverse("ops-daily-submission-freshness")


def _get(actor, division, business_date=TODAY):
    return _client(actor).get(
        url(),
        {"division_id": str(division.id), "business_date": business_date.isoformat()},
    )


# --- AC-2: три исхода различимы -----------------------------------------------


def test_not_summary_when_no_submission_at_all(org_dt):
    parent, _ = _family(org_dt, children=1)
    _grant("orgd", parent)

    response = _get("orgd", parent)
    assert response.status_code == 200, response.content
    assert response.json() == {
        "status": "NOT_SUMMARY",
        "superseded": [],
        "missing": [],
        "unpinned": [],
    }


def test_not_summary_when_ordinary_submission_without_sources(org_dt):
    parent, _ = _family(org_dt, children=1)
    _grant("orgd", parent)
    _submit(parent)

    response = _get("orgd", parent)
    assert response.status_code == 200, response.content
    assert response.json()["status"] == "NOT_SUMMARY"


def test_fresh_right_after_assemble(org_dt):
    parent, _ = _family(org_dt, children=2)
    _grant("orgd", parent)
    _assemble(parent)

    response = _get("orgd", parent)
    assert response.status_code == 200, response.content
    assert response.json() == {
        "status": "FRESH",
        "superseded": [],
        "missing": [],
        "unpinned": [],
    }


def test_stale_superseded_axis_after_child_amend(org_dt):
    from apps.operations.submissions.services import amend_day

    parent, kids = _family(org_dt, children=2)
    child, _ = kids[0]
    _grant("orgd", parent)
    _assemble(parent)

    with clock.override(TODAY):
        amend_day(
            division_id=child.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ретро-правка",
            sanction="указание",
        )

    response = _get("orgd", parent)
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "STALE"
    assert body["superseded"] == [
        {"division_id": str(child.id), "pinned_version": 1, "current_version": 2}
    ]
    assert body["missing"] == [] and body["unpinned"] == []


def test_stale_missing_axis_when_pinned_child_loses_current(org_dt):
    parent, kids = _family(org_dt, children=1)
    child, child_sub = kids[0]
    _grant("orgd", parent)
    _assemble(parent)

    # Сим отзыва §82.1 («ноль текущих») ORM-сбросом — та же техника, что
    # test_summary_service.py::test_freshness_missing_when_pinned_child_has_no_current.
    DailySubmission.objects.filter(pk=child_sub.pk).update(is_current=False)

    response = _get("orgd", parent)
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "STALE"
    assert body["missing"] == [{"division_id": str(child.id), "pinned_version": 1}]
    assert body["superseded"] == [] and body["unpinned"] == []


def test_stale_unpinned_axis_when_new_required_child_appears(org_dt):
    parent, _ = _family(org_dt, children=1)
    _grant("orgd", parent)
    _assemble(parent)

    newcomer = make_division(org_dt, parent=parent)
    make_employee(newcomer)
    _submit(newcomer)

    response = _get("orgd", parent)
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "STALE"
    assert body["unpinned"] == [str(newcomer.id)]
    assert body["superseded"] == [] and body["missing"] == []


# --- AC-4/AC-5: гейты и мусорные параметры ------------------------------------


def test_foreign_scope_is_403(org_dt):
    parent, _ = _family(org_dt, children=1)
    other = make_division(org_dt)
    _grant("orgd", other)

    response = _get("orgd", parent)
    assert response.status_code == 403


def test_phantom_division_is_404_for_a_global_actor(org_dt):
    UserRole.objects.create(
        user_id="admin", role_code_id="ADMIN", scope_division_id=None
    )
    response = _client("admin").get(
        url(),
        {"division_id": str(uuid.uuid4()), "business_date": TODAY.isoformat()},
    )
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_anonymous_is_403(org_dt):
    parent, _ = _family(org_dt, children=1)
    response = _client(None).get(
        url(),
        {"division_id": str(parent.id), "business_date": TODAY.isoformat()},
    )
    assert response.status_code == 403


def test_missing_business_date_is_400(org_dt):
    parent, _ = _family(org_dt, children=1)
    _grant("orgd", parent)
    response = _client("orgd").get(url(), {"division_id": str(parent.id)})
    assert response.status_code == 400


def test_missing_division_id_is_400(org_dt):
    UserRole.objects.create(
        user_id="admin", role_code_id="ADMIN", scope_division_id=None
    )
    response = _client("admin").get(url(), {"business_date": TODAY.isoformat()})
    assert response.status_code == 400


def test_non_uuid_division_id_is_400(org_dt):
    UserRole.objects.create(
        user_id="admin", role_code_id="ADMIN", scope_division_id=None
    )
    response = _client("admin").get(
        url(), {"division_id": "not-a-uuid", "business_date": TODAY.isoformat()}
    )
    assert response.status_code == 400


def test_non_iso_business_date_is_400(org_dt):
    parent, _ = _family(org_dt, children=1)
    _grant("orgd", parent)
    response = _client("orgd").get(
        url(), {"division_id": str(parent.id), "business_date": "not-a-date"}
    )
    assert response.status_code == 400


def test_future_date_returns_not_summary_not_a_gate(org_dt):
    """Dev Notes: будущая дата НЕ гейтится 422 — summary_freshness детерминированно
    отдаёт None (нет current-строки для несуществующей ещё сдачи), не ошибку."""
    parent, _ = _family(org_dt, children=1)
    _grant("orgd", parent)

    response = _get("orgd", parent, business_date=date(2026, 12, 31))
    assert response.status_code == 200, response.content
    assert response.json()["status"] == "NOT_SUMMARY"
