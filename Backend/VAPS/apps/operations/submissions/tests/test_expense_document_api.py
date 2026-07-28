"""Story 10.7a — JSON-поверхность тела расхода (GET /expense-reports/document/).

HTTP-контракт над УЖЕ существующим `build_expense_document` (6.3). Happy-путь
идёт от РЕАЛЬНОГО `submit_day` (снапшот руками не лепим — урок ревью 5.4b);
прямой прецедент фикстур — `test_document_release.py` (division/employee/
status/slot, `_tampered_submission` для schema-гварда).
"""

import itertools
from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.clock import Clock
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.documents.generators.expense_docx import (
    ExpenseCell,
    ExpenseCellMember,
    ExpenseDocumentData,
    ExpenseRow,
    ExpenseTotals,
)
from apps.documents.models import IssuedDocument
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.expense_document_read_service import (
    serialize_expense_document,
)

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
_iin = itertools.count(9600)


@pytest.fixture
def org_type():
    call_command("seed_operations")
    org = Organization.objects.create(name="Орг", code="ORG-JDOC")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dtp


def _division(org, dtp, code="JDOC-A"):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {code}", code=code
    )


def _employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="лейтенант",
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
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 7, 1)),
    )


def _submit(division):
    with clock.override(D):
        return submit_day(division_id=division.id, business_date=D, actor="op-1")


def _tampered_submission(division, snapshot):
    return DailySubmission.objects.create(
        division_id=division.id,
        business_date=D,
        version=1,
        is_current=True,
        event=DailySubmission.Event.CHANGED,
        submitted_by="op-1",
        submitted_at=Clock.now(),
        snapshot=snapshot,
    )


def _grant(user_id, division):
    UserRole.objects.create(
        user_id=user_id, role_code_id="ORGD", scope_division_id=division.id
    )


def _client(actor=None):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def url():
    return reverse("ops-expense-report-document")


def _get(actor, division, business_date=D):
    return _client(actor).get(
        url(),
        {"division_id": str(division.id), "business_date": business_date.isoformat()},
    )


# --- AC-1: полное тело, члены ячеек --------------------------------------


def test_document_body_with_cell_members(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    emp = _employee(div)
    _status(emp, "VACATION", date(2026, 7, 1), date(2026, 7, 15))
    _slot(div, 1)
    _grant("orgd", div)
    _submit(div)

    response = _get("orgd", div)
    assert response.status_code == 200, response.content
    body = response.json()

    assert body["business_date"] == D.isoformat()
    assert "members" not in body["totals"]
    row = body["rows"][0]
    vacation = row["cells"]["VACATION"]
    assert vacation["count"] == 1
    member = vacation["members"][0]
    assert member["rank"] == "лейтенант"
    assert member["full_name"] == emp.full_name
    assert member["date_start"] == "2026-07-01"
    assert member["date_end"] == "2026-07-15"


# --- AC-2: read-only — ничего не выпускает ---------------------------------


def test_document_read_only_no_issuance(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    _slot(div, 0)
    _grant("orgd", div)
    _submit(div)

    response = _get("orgd", div)
    assert response.status_code == 200, response.content
    assert not IssuedDocument.objects.exists()


# --- AC-3: три гарда --------------------------------------------------------


def test_no_submission_is_409(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    _grant("orgd", div)

    response = _get("orgd", div)
    assert response.status_code == 409
    assert response.json()["error_code"] == "REPORT_NOT_READY_FOR_DATE"


def test_unsupported_schema_version_is_422(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    _tampered_submission(div, {"roster": [], "rows": []})
    _slot(div, 1)
    _grant("orgd", div)

    response = _get("orgd", div)
    assert response.status_code == 422
    assert response.json()["error_code"] == "SNAPSHOT_SCHEMA_UNSUPPORTED"


def test_non_convergent_report_is_422(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    _employee(div)
    _employee(div)
    _slot(div, 1)  # штат 1 < список 2 → violation staff_lt_list
    _grant("orgd", div)
    _submit(div)

    response = _get("orgd", div)
    assert response.status_code == 422
    assert response.json()["error_code"] == "REPORT_NOT_CONVERGENT"


# --- AC-4: гейт/scope --------------------------------------------------------


def test_foreign_scope_is_403(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    other = _division(org, dtp, "JDOC-B")
    _grant("orgd", other)

    response = _get("orgd", div)
    assert response.status_code == 403


def test_phantom_division_is_404_for_a_global_actor(org_type):
    import uuid

    UserRole.objects.create(
        user_id="admin", role_code_id="ADMIN", scope_division_id=None
    )
    response = _client("admin").get(
        url(), {"division_id": str(uuid.uuid4()), "business_date": D.isoformat()}
    )
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_missing_business_date_is_400(org_type):
    org, dtp = org_type
    div = _division(org, dtp)
    _grant("orgd", div)
    response = _client("orgd").get(url(), {"division_id": str(div.id)})
    assert response.status_code == 400


# --- AC-5: serialize_expense_document — БЕЗ cap 20 (юнит, не HTTP) ---------


def test_serialize_expense_document_does_not_cap_members():
    members = tuple(
        ExpenseCellMember(
            rank="лейтенант",
            full_name=f"Сотрудник {i}",
            date_start=date(2026, 7, 1),
            date_end=date(2026, 7, 15),
        )
        for i in range(25)
    )
    cell = ExpenseCell(count=25, members=members)
    data = ExpenseDocumentData(
        division_title="Отдел",
        business_date=D,
        rows=[
            ExpenseRow(
                name="Отдел",
                staff_total=30,
                list_total=25,
                vacancies=5,
                cells={"VACATION": cell},
                attached=ExpenseCell(count=0, members=()),
            )
        ],
        totals=ExpenseTotals(
            staff_total=30,
            list_total=25,
            vacancies=5,
            columns={"VACATION": 25},
            attached=0,
        ),
    )

    body = serialize_expense_document(data)

    assert body["rows"][0]["cells"]["VACATION"]["count"] == 25
    assert len(body["rows"][0]["cells"]["VACATION"]["members"]) == 25
