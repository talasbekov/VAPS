"""Story 10.5b — журнал выпусков подразделения (GET /expense-reports/journal/).

HTTP-контракт только: цепочка выпусков (issue → amend → issue) идёт от
РЕАЛЬНЫХ ``submit_day``/``amend_day``/``issue_expense_document`` (снапшот
руками не лепим — тот же урок, что test_document_release.py). Прямой
прецедент фикстур — test_expense_report_api.py (HTTP) + test_document_release
.py (amend/issue-цепочка).
"""

import itertools
from datetime import date

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.services import (
    amend_day,
    issue_expense_document,
    submit_day,
)

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
_iin = itertools.count(9400)


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def org_type():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-JRN")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dtp


def _division(org, dtp, code="JRN-A"):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {code}", code=code
    )


def _employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def _status(emp, code, start, end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
        source="USER",
    )


def _slot(division, slots):
    DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 7, 1)),
    )


def _populate(division):
    emp = _employee(division)
    _status(emp, "VACATION", date(2026, 7, 1), date(2026, 7, 15))
    _slot(division, 2)
    return emp


def _grant(user_id, division):
    UserRole.objects.create(
        user_id=user_id, role_code_id="ORGD", scope_division_id=division.id
    )


def _client(actor=None):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _submit(division):
    with clock.override(D):
        return submit_day(division_id=division.id, business_date=D, actor="op-1")


def _amend(division, reason="ретро-правка"):
    return amend_day(
        division_id=division.id,
        business_date=D,
        actor="op-2",
        reason=reason,
        sanction="приказ №1",
    )


def _issue(division, actor="issuer-1"):
    return issue_expense_document(division_id=division.id, business_date=D, actor=actor)


def url():
    return reverse("ops-expense-report-journal")


def test_chain_both_documents_with_supersedes_number_and_reason(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp)
    _populate(div)
    _grant("orgd", div)
    _submit(div)
    first = _issue(div)
    _amend(div, reason="правка ростера")
    second = _issue(div)

    response = _client("orgd").get(url(), {"division_id": str(div.id)})
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 2
    results = body["results"]
    # Новые сверху: второй (действующий) документ — первая строка.
    assert results[0]["id"] == str(second.id)
    assert results[0]["status"] == "ISSUED"
    assert results[0]["supersedes_number"] == first.number
    assert results[0]["supersedes_year"] == first.year
    assert results[0]["reason"] == "правка ростера"

    assert results[1]["id"] == str(first.id)
    assert results[1]["status"] == "SUPERSEDED"
    assert results[1]["supersedes_number"] is None
    assert results[1]["supersedes_year"] is None
    assert results[1]["reason"] == ""


def test_pagination_next_and_count(org_type, storage, settings):
    org, dtp = org_type
    div = _division(org, dtp)
    _populate(div)
    _grant("orgd", div)

    # 3 отдельные даты → 3 независимых документа (без amend-цепочки, дешевле).
    dates = [date(2026, 7, 1), date(2026, 7, 2), date(2026, 7, 3)]
    for business_date in dates:
        with clock.override(business_date):
            submit_day(division_id=div.id, business_date=business_date, actor="op-1")
        issue_expense_document(
            division_id=div.id, business_date=business_date, actor="issuer-1"
        )

    response = _client("orgd").get(url(), {"division_id": str(div.id), "limit": 2})
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 3
    assert len(body["results"]) == 2
    assert body["next"] is not None
    # Новые сверху: 07-03 первой строкой.
    assert body["results"][0]["business_date"] == "2026-07-03"


def test_no_documents_yet_returns_empty_page_not_404(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp)
    _grant("orgd", div)

    response = _client("orgd").get(url(), {"division_id": str(div.id)})
    assert response.status_code == 200, response.content
    assert response.json() == {
        "count": 0,
        "next": None,
        "previous": None,
        "results": [],
    }


def test_foreign_scope_is_403(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp)
    other = _division(org, dtp, "JRN-B")
    _grant("orgd", div)

    response = _client("orgd").get(url(), {"division_id": str(other.id)})
    assert response.status_code == 403


def test_phantom_division_is_404_for_a_global_actor(org_type, storage):
    import uuid

    org, dtp = org_type
    UserRole.objects.create(
        user_id="admin", role_code_id="ADMIN", scope_division_id=None
    )

    response = _client("admin").get(url(), {"division_id": str(uuid.uuid4())})
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_missing_division_id_is_400(org_type, storage):
    # ADMIN (wildcard) — грубый гейт проходит без гранта на конкретное
    # подразделение, чтобы 400 сериализатора не спутать с 403 гейта.
    UserRole.objects.create(
        user_id="admin", role_code_id="ADMIN", scope_division_id=None
    )
    response = _client("admin").get(url())
    assert response.status_code == 400


def test_anonymous_is_403(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp)

    response = _client(None).get(url(), {"division_id": str(div.id)})
    assert response.status_code == 403


def test_no_n_plus_one_across_multiple_documents(org_type, storage):
    org, dtp = org_type
    div = _division(org, dtp)
    _populate(div)
    _grant("orgd", div)

    dates = [date(2026, 7, 1), date(2026, 7, 2), date(2026, 7, 3), date(2026, 7, 4)]
    for business_date in dates:
        with clock.override(business_date):
            submit_day(division_id=div.id, business_date=business_date, actor="op-1")
        issue_expense_document(
            division_id=div.id, business_date=business_date, actor="issuer-1"
        )

    client = _client("orgd")
    with CaptureQueriesContext(connection) as one_doc:
        client.get(url(), {"division_id": str(div.id), "limit": 1})
    with CaptureQueriesContext(connection) as four_docs:
        client.get(url(), {"division_id": str(div.id), "limit": 4})

    # Константное число запросов независимо от числа строк на странице —
    # select_related закрывает и supersedes, и attachment.sha256.
    assert len(four_docs.captured_queries) == len(one_doc.captured_queries)
