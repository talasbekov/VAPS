"""Story 10.5 — GET history (/api/operations/expense-reports/history/).

Журнал выпусков расхода: ``{divisions, issues}`` — видимые под
``daily_report.generate`` подразделения (источник селекта экрана) + ВСЕ
выпуски (ISSUED и SUPERSEDED) видимых подразделений с цепочкой «взамен»
(``supersedes {id, number, year} | null``). Проверяется HTTP-контракт:

- AC-1: скоуп с ненулевым дискриминатором (своё есть, чужое отсутствует —
  и в divisions, и в issues); поля строки = IssuedExpenseReportSerializer +
  reason + created_at + supersedes; сортировка (-year, -number); пагинация
  limit/offset (default 50, max 200 — канон DailySubmissionPagination);
- AC-2: 403 чужое подразделение ДО существования (не оракул); 404 фантом у
  глобального гранта; 400 мусорный division_id; пустая видимость → 200
  пустые списки (Д5-канон); без права → 403;
- AC-3: NFR-пин — число запросов константно по числу выпусков/подразделений
  (один запрос issues c select_related, никаких per-row);
- AC-4: цепочка «взамен» — обе строки, №2 несёт supersedes.number №1.

Посев выпусков — модельный канон (test_issued_document_model): писатель
issue_expense_document здесь не участвует, журнал только ЧИТАЕТ. Auth via
HTTP_X_USER_ID (канон 5.8-сюит); роли — seed_operations + прямые UserRole.
"""

import uuid
from datetime import date

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Organization
from apps.documents.models import EXPENSE_DOC_TYPE, Attachment, IssuedDocument
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)

# Поля IssuedExpenseReportSerializer (6.10a) + история (10.5).
HISTORY_ROW_FIELDS = {
    "id",
    "doc_type",
    "number",
    "year",
    "business_date",
    "division_id",
    "submission_id",
    "submission_version",
    "status",
    "attachment_id",
    "sha256",
    "reason",
    "created_at",
    "supersedes",
}


@pytest.fixture
def tree():
    """seed_operations + поддерево root→child и чужое other."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-EH")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    root = Division.objects.create(
        organization=org, type_code=dtp, name="root", code="R-EH"
    )
    child = Division.objects.create(
        organization=org, type_code=dtp, name="child", code="C-EH", parent=root
    )
    other = Division.objects.create(
        organization=org, type_code=dtp, name="other", code="O-EH"
    )
    return root, child, other


@pytest.fixture
def scoped_orgd(tree):
    """ORGD (держит daily_report.generate), scoped на root."""
    root, _, _ = tree
    UserRole.objects.create(
        user_id="orgd-scoped", role_code_id="ORGD", scope_division_id=root.id
    )
    return "orgd-scoped"


@pytest.fixture
def global_orgd(tree):
    UserRole.objects.create(
        user_id="orgd-global", role_code_id="ORGD", scope_division_id=None
    )
    return "orgd-global"


@pytest.fixture
def attachment():
    return Attachment.objects.create(
        original_name="расход.docx",
        content_type="application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document",
        size=10,
        sha256="a" * 64,
    )


_submission_id = iter(range(1, 10_000))


def _issue(division, attachment, number, **overrides):
    fields = {
        "doc_type": EXPENSE_DOC_TYPE,
        "number": number,
        "year": 2026,
        "business_date": D,
        "division_id": division.id,
        "submission_id": next(_submission_id),
        "submission_version": 1,
        "attachment": attachment,
        "status": IssuedDocument.Status.ISSUED,
    }
    fields.update(overrides)
    return IssuedDocument.objects.create(**fields)


def _client(actor):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _get(actor, **params):
    return _client(actor).get(
        reverse("ops-expense-report-history"),
        {k: str(v) for k, v in params.items()},
    )


# -- AC-1: скоуп + shape + сортировка + пагинация -------------------------------


def test_history_scope_shape_and_first_issue_null_supersedes(
    scoped_orgd, tree, attachment
):
    """Ненулевой дискриминатор: своё несёт имя, чужое отсутствует; строка
    issues несёт поля 6.10a + reason/created_at/supersedes (null у первого)."""
    root, child, other = tree
    own = _issue(root, attachment, 1)
    _issue(other, attachment, 2, business_date=date(2026, 7, 9))
    response = _get(scoped_orgd)
    assert response.status_code == 200, response.content
    payload = response.json()
    div_ids = {d["division_id"] for d in payload["divisions"]}
    assert str(root.id) in div_ids
    assert str(child.id) in div_ids
    assert str(other.id) not in div_ids
    names = {d["division_id"]: d["name"] for d in payload["divisions"]}
    assert names[str(root.id)] == "root"
    # Сортировка селекта (name, division_id) — Scope 1 (ревью 10.5, auditor F2).
    assert [d["name"] for d in payload["divisions"]] == ["child", "root"]
    issue_divisions = {row["division_id"] for row in payload["issues"]}
    assert issue_divisions == {str(root.id)}
    row = payload["issues"][0]
    assert set(row) == HISTORY_ROW_FIELDS
    assert row["id"] == str(own.id)
    assert row["number"] == 1
    assert row["sha256"] == "a" * 64
    assert row["attachment_id"] == str(attachment.id)
    assert row["supersedes"] is None
    assert row["reason"] == ""
    assert row["created_at"] is not None


def test_history_sorted_by_year_desc_then_number_desc(global_orgd, tree, attachment):
    root, _, _ = tree
    _issue(
        root,
        attachment,
        5,
        year=2025,
        business_date=date(2025, 7, 8),
        status=IssuedDocument.Status.SUPERSEDED,
    )
    _issue(root, attachment, 1, business_date=date(2026, 7, 6))
    _issue(root, attachment, 3, business_date=date(2026, 7, 7))
    payload = _get(global_orgd).json()
    ordered = [(row["year"], row["number"]) for row in payload["issues"]]
    assert ordered == [(2026, 3), (2026, 1), (2025, 5)]


def test_history_pagination_limit_offset(global_orgd, tree, attachment):
    root, _, _ = tree
    for n in range(1, 4):  # 3 выпуска разных дат — все ISSUED легальны
        _issue(root, attachment, n, business_date=date(2026, 7, 5 + n))
    first = _get(global_orgd, limit=2).json()
    assert [row["number"] for row in first["issues"]] == [3, 2]
    rest = _get(global_orgd, limit=2, offset=2).json()
    assert [row["number"] for row in rest["issues"]] == [1]


def test_history_count_total_survives_pagination(global_orgd, tree, attachment):
    """Ревью 10.6: конверт несёт count = ОБЩЕЕ число выпусков по фильтру —
    иначе default-limit 50 молча обрезал бы журнал без сигнала клиенту."""
    root, _, _ = tree
    for n in range(1, 4):  # 3 выпуска разных дат — все ISSUED легальны
        _issue(root, attachment, n, business_date=date(2026, 7, 5 + n))
    payload = _get(global_orgd, limit=2).json()
    assert len(payload["issues"]) == 2  # страница обрезана лимитом
    assert payload["count"] == 3  # но итог — по всему фильтру


def test_history_division_filter_narrows_issues_not_divisions(
    global_orgd, tree, attachment
):
    """?division_id= сужает issues, но divisions остаётся источником селекта."""
    root, child, other = tree
    _issue(root, attachment, 1)
    _issue(other, attachment, 2, business_date=date(2026, 7, 9))
    payload = _get(global_orgd, division_id=root.id).json()
    assert {row["division_id"] for row in payload["issues"]} == {str(root.id)}
    div_ids = {d["division_id"] for d in payload["divisions"]}
    assert {str(root.id), str(child.id), str(other.id)} <= div_ids


# -- AC-2: гейты -----------------------------------------------------------------


def test_history_foreign_division_403(scoped_orgd, tree):
    _, _, other = tree
    response = _get(scoped_orgd, division_id=other.id)
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_history_phantom_uuid_scoped_403_not_existence_oracle(scoped_orgd):
    response = _get(scoped_orgd, division_id=uuid.uuid4())
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_history_phantom_uuid_global_404(global_orgd):
    response = _get(global_orgd, division_id=uuid.uuid4())
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_history_garbage_division_id_400(scoped_orgd):
    response = _get(scoped_orgd, division_id="мусор")
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_history_grant_with_empty_visibility_200_empty_lists(tree, attachment):
    """Грант есть, но scope — фантомный UUID (подразделение удалено после
    выдачи роли): видимость пуста → 200 пустые списки (Д5-канон), не 403."""
    root, _, _ = tree
    _issue(root, attachment, 1)
    UserRole.objects.create(
        user_id="orgd-phantom",
        role_code_id="ORGD",
        scope_division_id=uuid.uuid4(),
    )
    response = _get("orgd-phantom")
    assert response.status_code == 200
    assert response.json() == {"divisions": [], "count": 0, "issues": []}


def test_history_without_permission_403(tree):
    UserRole.objects.create(
        user_id="operator",
        role_code_id="DIVISION_OPERATOR",
        scope_division_id=None,
    )
    assert _get("operator").status_code == 403


# -- AC-3: NFR-пин ---------------------------------------------------------------


def test_history_query_count_constant_in_rows_and_divisions(
    global_orgd, tree, attachment
):
    """Число SQL-запросов не растёт по числу выпусков/подразделений: один
    запрос issues c select_related("attachment", "supersedes")."""
    root, _, _ = tree
    _issue(root, attachment, 1)
    assert _get(global_orgd).status_code == 200
    with CaptureQueriesContext(connection) as ctx_small:
        _get(global_orgd)
    org = root.organization
    for i in range(4):
        extra = Division.objects.create(
            organization=org, type_code=root.type_code, name=f"x{i}", code=f"X-EH{i}"
        )
        prev = _issue(
            extra,
            attachment,
            10 + i * 2,
            business_date=date(2026, 7, 9),
            status=IssuedDocument.Status.SUPERSEDED,
        )
        _issue(
            extra,
            attachment,
            11 + i * 2,
            business_date=date(2026, 7, 9),
            supersedes=prev,
            reason="пересдача",
        )
    with CaptureQueriesContext(connection) as ctx_big:
        _get(global_orgd)
    assert len(ctx_big) == len(ctx_small)


# -- AC-4: цепочка «взамен» --------------------------------------------------------


def test_history_supersedes_chain_both_rows(scoped_orgd, tree, attachment):
    root, _, _ = tree
    first = _issue(root, attachment, 1, status=IssuedDocument.Status.SUPERSEDED)
    second = _issue(
        root, attachment, 2, supersedes=first, reason="взамен после amendment"
    )
    payload = _get(scoped_orgd).json()
    by_number = {row["number"]: row for row in payload["issues"]}
    assert set(by_number) == {1, 2}
    assert by_number[1]["status"] == "SUPERSEDED"
    assert by_number[1]["supersedes"] is None
    assert by_number[2]["status"] == "ISSUED"
    assert by_number[2]["id"] == str(second.id)
    assert by_number[2]["reason"] == "взамен после amendment"
    assert by_number[2]["supersedes"] == {
        "id": str(first.id),
        "number": 1,
        "year": 2026,
    }
