"""Story 10.1a — REST bulk-роут статусов (POST /api/operations/statuses/bulk/).

HTTP-контракт поверх сервиса 3.8 (bulk_create_statuses, доменно доказан на
service-уровне). Проверяет ТОЛЬКО слой поверхности: сериализатор (400/cap),
резолвинг scope из RBAC (visible_division_ids → 403 / global), грубый гейт
права (RequirePermissionMixin → 403 до сервиса), surfacing DomainError сервиса
через §36-envelope (details.rows[]), happy-path 201 {created:N}.

RBAC: seed_operations + UserRole; держатель status.manage = INTEGRATION_USER
(ADMIN держит `*`). Auth — X-User-Id header (2.13-seam). Грант операторской
роли DIVISION_OPERATOR — PROVISIONAL policy Bratan, НЕ здесь.
"""

import itertools
from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db

D = date(2026, 6, 5)
URL = reverse("ops-status-bulk")
_iin = itertools.count(940001)


@pytest.fixture
def env():
    """Seed RBAC + org/division + status types (реюз формы 3.8-фикстур)."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-101a")
    dtp = DivisionType.objects.create(code="mgmt101a", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-101a"
    )
    StatusType.objects.create(
        code="VACATION", name="Отпуск", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    return org, dtp, div


def _division(org, dtp, code):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"D-{code}", code=code
    )


def _emp(div):
    return Employee.objects.create(
        iin=f"{next(_iin):012d}", full_name="T", rank_code="",
        position_code="", division=div,
    )


def _grant(user_id, role_code, division=None):
    UserRole.objects.create(
        user_id=user_id,
        role_code_id=role_code,
        scope_division_id=division.id if division else None,
    )


def _client(actor):
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


def _post(client, rows, business_date="2026-06-05"):
    return client.post(
        URL, {"business_date": business_date, "rows": rows}, format="json"
    )


# --- AC-1 happy path --------------------------------------------------------


def test_bulk_happy_201_created_count(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER")  # unscoped → global scope (AC-7 path)
    emps = [_emp(div) for _ in range(3)]
    resp = _post(_client("integ"), [_row(e) for e in emps])
    assert resp.status_code == 201, resp.content
    assert resp.data == {"created": 3}
    assert EmployeeStatus.objects.count() == 3
    assert all(
        s.source == EmployeeStatus.Source.USER
        for s in EmployeeStatus.objects.all()
    )


# --- AC-2 per-row error surfacing (envelope details.rows[]) -----------------


def test_bulk_soft_conflict_409_rows_nothing_written(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    e1, e2 = _emp(div), _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e2.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()
    resp = _post(
        _client("integ"),
        [_row(e1), _row(e2, start="2026-06-05", end="2026-06-15")],
    )
    assert resp.status_code == 409, resp.content
    assert resp.data["error_code"] == "STATUS_OVERLAP_WARNING"
    rows = resp.data["details"]["rows"]
    assert any(r["employee_id"] == str(e2.id) for r in rows)
    assert EmployeeStatus.objects.count() == before  # ничего не записано


def test_bulk_hard_conflict_422(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    e = _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e.id, status_type_code="VACATION",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()
    resp = _post(_client("integ"), [_row(e, code="VACATION")])
    assert resp.status_code == 422, resp.content
    assert resp.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert EmployeeStatus.objects.count() == before  # ничего частично (AC-2)


def test_bulk_mixed_aggregate_422(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    e_soft, e_hard = _emp(div), _emp(div)
    EmployeeStatus.objects.create(
        employee_id=e_soft.id, status_type_code="STUDY",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )
    EmployeeStatus.objects.create(
        employee_id=e_hard.id, status_type_code="VACATION",
        date_start=date(2026, 6, 1), date_end=date(2026, 6, 10),
    )
    before = EmployeeStatus.objects.count()
    resp = _post(
        _client("integ"),
        [
            _row(e_soft, start="2026-06-05", end="2026-06-15"),
            _row(e_hard, code="VACATION"),
        ],
    )
    assert resp.status_code == 422, resp.content
    assert len(resp.data["details"]["rows"]) == 2
    assert EmployeeStatus.objects.count() == before  # ничего частично (AC-2)


# --- AC-3 structural 400 ----------------------------------------------------


def test_bulk_duplicate_employee_400(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    e = _emp(div)
    resp = _post(_client("integ"), [_row(e), _row(e)])
    assert resp.status_code == 400, resp.content


def test_bulk_missing_required_key_400(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    e = _emp(div)
    row = _row(e)
    del row["date_end"]
    resp = _post(_client("integ"), [row])
    assert resp.status_code == 400, resp.content


def test_bulk_empty_rows_400(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    resp = _post(_client("integ"), [])
    assert resp.status_code == 400, resp.content


def test_bulk_bad_uuid_400(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER", division=div)
    resp = _post(
        _client("integ"),
        [{
            "employee_id": "not-a-uuid",
            "status_type_code": "STUDY",
            "date_start": "2026-06-04",
            "date_end": "2026-06-10",
        }],
    )
    assert resp.status_code == 400, resp.content


# --- AC-4 scope 403 (резолв в вьюхе через visible_division_ids) -------------


def _seed_baseline(div):
    """Ненулевой baseline: существующий статус на отдельного сотрудника.
    Deny-тест обязан оставить count НЕИЗМЕННЫМ — `==0` при пустом старте
    зелён и когда вьюха молча ничего не делает (вакуум-паттерн, ретро E9)."""
    EmployeeStatus.objects.create(
        employee_id=_emp(div).id, status_type_code="STUDY",
        date_start=date(2026, 5, 1), date_end=date(2026, 5, 3),
    )
    return EmployeeStatus.objects.count()


def test_bulk_foreign_scope_403_nothing_written(env):
    org, dtp, div = env
    other = _division(org, dtp, "OTHER-101a")
    _grant("integ", "INTEGRATION_USER", division=other)  # scope на чужой дивизион
    e = _emp(div)
    before = _seed_baseline(div)
    resp = _post(_client("integ"), [_row(e)])
    assert resp.status_code == 403, resp.content
    # Валидная строка e БЫ записалась, будь scope-резолв дырявым → count вырос бы.
    assert EmployeeStatus.objects.count() == before


# --- AC-5 coarse permission gate 403 (до сервиса) ---------------------------


def test_bulk_without_manage_permission_403(env):
    _org, _dtp, div = env
    _grant("viewer", "VIEWER")  # держит status.view, НЕ status.manage
    e = _emp(div)
    before = _seed_baseline(div)
    resp = _post(_client("viewer"), [_row(e)])
    assert resp.status_code == 403, resp.content
    assert EmployeeStatus.objects.count() == before  # гейт ДО сервиса, запись 0


def test_bulk_anonymous_403(env):
    _org, _dtp, div = env
    e = _emp(div)
    before = _seed_baseline(div)
    resp = _post(_client(None), [_row(e)])
    assert resp.status_code == 403, resp.content
    assert EmployeeStatus.objects.count() == before


# --- AC-7 global scope (unscoped grant → все дивизионы) ----------------------


def test_bulk_global_scope_spans_divisions(env):
    org, dtp, div = env
    other = _division(org, dtp, "OTHER2-101a")
    _grant("integ", "INTEGRATION_USER")  # unscoped → visible=None → все дивизионы
    e1, e2 = _emp(div), _emp(other)
    resp = _post(_client("integ"), [_row(e1), _row(e2)])
    assert resp.status_code == 201, resp.content
    assert resp.data == {"created": 2}


# --- AC-10 payload cap ------------------------------------------------------


def test_bulk_payload_over_cap_400(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER")
    # 1001 строк-заглушек (несуществующие сотрудники ок: cap ловится ДО сервиса)
    rows = [
        {
            "employee_id": f"00000000-0000-0000-0000-{i:012d}",
            "status_type_code": "STUDY",
            "date_start": "2026-06-04",
            "date_end": "2026-06-10",
        }
        for i in range(1001)
    ]
    resp = _post(_client("integ"), rows)
    assert resp.status_code == 400, resp.content


# --- audit pin сквозь роут (AUDIT_MATRIX _Audited, паттерн 5.9) --------------


def test_bulk_emits_audit_through_route(env):
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER")
    emps = [_emp(div) for _ in range(3)]
    resp = _post(_client("integ"), [_row(e) for e in emps])
    assert resp.status_code == 201, resp.content
    # Сервис 3.8 эмитит per-row STATUS_CREATED + один summary STATUS_BULK_CREATED
    # в той же транзакции; актор — из auth-контракта (X-User-Id), не из payload.
    assert AuditLog.objects.filter(action="STATUS_CREATED").count() == 3
    summary = AuditLog.objects.get(action="STATUS_BULK_CREATED")
    assert summary.actor_user_id == "integ"
    assert summary.new_value["count"] == 3


def test_bulk_identity_from_contract_payload_ignored(env):
    """AC-6 / ARCH-SEC-030: actor из X-User-Id, НЕ из payload; source форсирован
    USER; business_date из payload реально доезжает до записи/аудита."""
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER")
    e = _emp(div)
    row = _row(e)
    # rogue-поля: подмена identity/source через payload не должна сработать.
    row["source"] = "OM_AUTO"
    row["created_by"] = "attacker"
    resp = _client("integ").post(
        URL,
        {
            "business_date": "2026-06-05",
            "actor": "attacker",  # top-level rogue actor
            "rows": [row],
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content
    created = EmployeeStatus.objects.get(employee_id=e.id)
    assert created.source == EmployeeStatus.Source.USER  # не OM_AUTO из payload
    summary = AuditLog.objects.get(action="STATUS_BULK_CREATED")
    assert summary.actor_user_id == "integ"  # из seam, не "attacker"
    assert summary.new_value["business_date"] == "2026-06-05"  # payload passthrough
