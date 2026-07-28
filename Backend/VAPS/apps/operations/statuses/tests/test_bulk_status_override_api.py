"""Story 10.2a — bulk-override: обходит ТОЛЬКО soft, с непустой причиной,
аудируемо (Override + OVERRIDE_APPLIED). Hard НИКОГДА не обходится."""

import itertools
from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, Override, StatusType
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

URL = reverse("ops-status-bulk")
_iin = itertools.count(960001)


@pytest.fixture
def env():
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-102a")
    dtp = DivisionType.objects.create(code="mgmt102a", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-102a"
    )
    StatusType.objects.create(
        code="VACATION",
        name="Отпуск",
        is_hard_block=True,
        priority=20,
        report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY",
        name="Учёба",
        is_hard_block=False,
        priority=32,
        report_column_code="TRAINING",
    )
    UserRole.objects.create(user_id="integ", role_code_id="INTEGRATION_USER")
    return org, dtp, div


def _emp(div):
    return Employee.objects.create(
        iin=f"{next(_iin):012d}",
        full_name="T",
        rank_code="",
        position_code="",
        division=div,
    )


def _client(actor="integ"):
    c = APIClient()
    c.raise_request_exception = False
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _row(emp, code="STUDY", start="2026-06-04", end="2026-06-10"):
    return {
        "employee_id": str(emp.id),
        "status_type_code": code,
        "date_start": start,
        "date_end": end,
    }


def _post(
    client, rows, override=None, override_reason=None, business_date="2026-06-05"
):
    body = {"business_date": business_date, "rows": rows}
    if override is not None:
        body["override"] = override
    if override_reason is not None:
        body["override_reason"] = override_reason
    return client.post(URL, body, format="json")


def test_pure_soft_override_creates_all_and_override_records(env):
    _org, _dtp, div = env
    e1, e2 = _emp(div), _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e1.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )
    EmployeeStatus.objects.create(
        employee_id=e2.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )

    resp = _post(
        _client(),
        [
            _row(e1, start="2026-06-05", end="2026-06-15"),
            _row(e2, start="2026-06-05", end="2026-06-15"),
        ],
        override=True,
        override_reason="Согласовано с начальником",
    )

    assert resp.status_code == 201, resp.content
    assert resp.data == {"created": 2}  # 2 new rows (pre-existing untouched)
    assert EmployeeStatus.objects.count() == 4  # 2 pre-existing + 2 new
    new_statuses = EmployeeStatus.objects.filter(date_start=date(2026, 6, 5))
    assert new_statuses.count() == 2
    assert Override.objects.count() == 2
    for override in Override.objects.all():
        assert override.reason == "Согласовано с начальником"
        assert override.conflicts != []
        assert override.created_by == "integ"


def test_hard_conflict_never_bypassed_even_with_override(env):
    _org, _dtp, div = env
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="VACATION",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()

    resp = _post(
        _client(),
        [_row(e, code="VACATION")],
        override=True,
        override_reason="Пытаюсь обойти hard",
    )

    assert resp.status_code == 422, resp.content
    assert resp.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert EmployeeStatus.objects.count() == before
    assert Override.objects.count() == 0


def test_mixed_hard_and_soft_with_override_still_rejects_everything(env):
    _org, _dtp, div = env
    hard_emp, soft_emp = _emp(div), _emp(div)
    EmployeeStatus.objects.create(
        employee_id=hard_emp.id,
        status_type_code="VACATION",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )
    EmployeeStatus.objects.create(
        employee_id=soft_emp.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()

    resp = _post(
        _client(),
        [
            _row(hard_emp, code="VACATION"),
            _row(soft_emp, start="2026-06-05", end="2026-06-15"),
        ],
        override=True,
        override_reason="Обход всего пакета",
    )

    assert resp.status_code == 422, resp.content
    assert EmployeeStatus.objects.count() == before
    assert Override.objects.count() == 0


def test_override_true_without_reason_400_nothing_written(env):
    _org, _dtp, div = env
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()

    resp = _post(
        _client(),
        [_row(e, start="2026-06-05", end="2026-06-15")],
        override=True,
        override_reason="",
    )

    assert resp.status_code == 400, resp.content
    assert resp.data["details"]["field"] == "override_reason"
    assert EmployeeStatus.objects.count() == before


def test_backend_accepts_short_reason_length_is_frontend_only(env):
    """AC-4: 10-500 — граница фронта, НЕ бэка. 1-символьная причина проходит."""
    _org, _dtp, div = env
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )

    resp = _post(
        _client(),
        [_row(e, start="2026-06-05", end="2026-06-15")],
        override=True,
        override_reason="x",
    )

    assert resp.status_code == 201, resp.content


def test_override_applied_audit_recorded(env):
    _org, _dtp, div = env
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )

    resp = _post(
        _client(),
        [_row(e, start="2026-06-05", end="2026-06-15")],
        override=True,
        override_reason="Reason enough",
    )

    assert resp.status_code == 201, resp.content
    audit_rows = AuditLog.objects.filter(action="OVERRIDE_APPLIED")
    assert audit_rows.count() == 1
    assert audit_rows.first().entity_type == "override"


def test_override_absent_is_identical_to_pre_10_2a_behavior(env):
    """AC-6: без override в теле — тот же 409-агрегат, 0 записей (regression pin)."""
    _org, _dtp, div = env
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id,
        status_type_code="STUDY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()

    resp = _post(_client(), [_row(e, start="2026-06-05", end="2026-06-15")])

    assert resp.status_code == 409, resp.content
    assert resp.data["error_code"] == "STATUS_OVERLAP_WARNING"
    assert EmployeeStatus.objects.count() == before
    assert Override.objects.count() == 0
