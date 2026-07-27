"""Story 10.1b — GET списка статусов на дату (GET /api/operations/statuses/).

HTTP-контракт read-роута, питающего префилл «вчера» экрана массового обновления.
Проверяет ТОЛЬКО слой поверхности: сериализатор фильтров (400), гейт права
(RequirePermissionMixin → 403), scope-гейт (403, НЕ пустой список), 404 на
фантомный дивизион ПОСЛЕ scope, и форму выборки — ростер на дату ⋈ живые
интервалы.

Два ассерта здесь — гарды против ТИХИХ дефектов, а не проверки happy path:
`test_child_division_rows_absent` (own-level, не поддерево) и
`test_empty_division_does_not_leak_other_divisions` (`employee_ids=None` в
`overlapping_on` означает «без фильтра» → статусы всей базы под видом 200).

RBAC: seed_operations + UserRole. `status.view` держат DIVISION_OPERATOR и
VIEWER; INTEGRATION_USER держит только `status.manage` — он и есть актор для
«права нет». Auth — X-User-Id header (2.13-seam).
"""

import itertools
import uuid
from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db

URL = reverse("ops-status-list")
D = date(2026, 6, 5)
_iin = itertools.count(950001)


@pytest.fixture
def env():
    """Seed RBAC + org/division + status types (форма фикстур 10.1a)."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-101b")
    dtp = DivisionType.objects.create(code="mgmt101b", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-101b"
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


def _division(org, dtp, code, parent=None):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"D-{code}", code=code, parent=parent
    )


def _emp(div, **kwargs):
    return Employee.objects.create(
        iin=f"{next(_iin):012d}", full_name="T", rank_code="",
        position_code="", division=div, **kwargs
    )


def _status(emp, code="VACATION", start=None, end=None, **kwargs):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=start or date(2026, 6, 1),
        date_end=end or date(2026, 6, 10),
        **kwargs,
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


def _get(actor, division_id, business_date=D):
    params = {}
    if business_date is not None:
        params["business_date"] = str(business_date)
    if division_id is not None:
        params["division_id"] = str(division_id)
    return _client(actor).get(URL, params)


# --- AC-1: happy path + детерминированный порядок -------------------------


def test_returns_rows_for_division_on_date(env):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)
    e1, e2 = _emp(div), _emp(div)
    # Порядок создания намеренно обратный ожидаемому — ассерт проверяет
    # сортировку, а не совпадение с порядком INSERT.
    _status(e2, "STUDY", date(2026, 6, 3), date(2026, 6, 8))
    _status(e1, "VACATION", date(2026, 6, 1), date(2026, 6, 10))
    _status(e1, "STUDY", date(2026, 6, 4), date(2026, 6, 6))

    r = _get("op-1", div.id)

    assert r.status_code == 200, r.data
    assert r.data["business_date"] == "2026-06-05"
    assert r.data["division_id"] == str(div.id)
    expected = sorted(
        [
            {
                "employee_id": str(e1.id), "status_type_code": "VACATION",
                "date_start": "2026-06-01", "date_end": "2026-06-10",
            },
            {
                "employee_id": str(e1.id), "status_type_code": "STUDY",
                "date_start": "2026-06-04", "date_end": "2026-06-06",
            },
            {
                "employee_id": str(e2.id), "status_type_code": "STUDY",
                "date_start": "2026-06-03", "date_end": "2026-06-08",
            },
        ],
        key=lambda row: (row["employee_id"], row["date_start"]),
    )
    # Сравнение СПИСКА целиком, не len() — иначе порядок не гейтится (AC-1).
    assert [dict(row) for row in r.data["rows"]] == expected


# --- AC-2: полуоткрытый интервал [date_start, date_end) -------------------


def test_interval_is_half_open_on_end_date(env):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)
    emp = _emp(div)
    _status(emp, "VACATION", date(2026, 6, 1), date(2026, 6, 5))

    assert len(_get("op-1", div.id, date(2026, 6, 4)).data["rows"]) == 1
    # date_end исключающая: на саму дату конца статуса уже нет.
    assert _get("op-1", div.id, date(2026, 6, 5)).data["rows"] == []


def test_interval_includes_start_date(env):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)
    emp = _emp(div)
    _status(emp, "VACATION", date(2026, 6, 5), date(2026, 6, 7))

    assert len(_get("op-1", div.id, date(2026, 6, 5)).data["rows"]) == 1
    assert _get("op-1", div.id, date(2026, 6, 4)).data["rows"] == []


# --- AC-3: отменённые и чужие ---------------------------------------------


def test_cancelled_status_absent(env):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)
    emp = _emp(div)
    _status(
        emp, "VACATION", date(2026, 6, 1), date(2026, 6, 10),
        cancelled_at="2026-06-02T10:00:00Z", cancelled_by="op-9",
    )

    assert _get("op-1", div.id).data["rows"] == []


def test_other_division_rows_absent_even_when_visible(env):
    org, dtp, div = env
    other = _division(org, dtp, "D2-101b")
    # Актор видит ОБА дивизиона (глобальный грант) — фильтр обязан идти по
    # запрошенному division_id, а не по всему scope.
    _grant("op-1", "DIVISION_OPERATOR")
    _status(_emp(other), "VACATION")
    mine = _emp(div)
    _status(mine, "STUDY")

    rows = _get("op-1", div.id).data["rows"]

    assert [row["employee_id"] for row in rows] == [str(mine.id)]


# --- AC-4: ростер на дату --------------------------------------------------


def test_dismissed_employee_absent(env):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)
    fired = _emp(div, employment_status=Employee.EmploymentStatus.FIRED)
    _status(fired, "VACATION")

    assert _get("op-1", div.id).data["rows"] == []


# --- AC-5: грубый гейт права ----------------------------------------------


def test_actor_without_status_view_forbidden(env):
    org, dtp, div = env
    # INTEGRATION_USER держит ТОЛЬКО status.manage — права на чтение нет.
    _grant("int-1", "INTEGRATION_USER")
    _status(_emp(div), "VACATION")

    r = _get("int-1", div.id)

    assert r.status_code == 403
    assert r.data["error_code"] == "PERMISSION_DENIED"


def test_anonymous_forbidden(env):
    org, dtp, div = env

    assert _get(None, div.id).status_code == 403


# --- AC-6: чужой scope → 403, НЕ пустой 200 --------------------------------


def test_foreign_scope_is_403_not_empty_list(env):
    org, dtp, div = env
    other = _division(org, dtp, "D3-101b")
    _grant("op-1", "DIVISION_OPERATOR", other)
    _status(_emp(div), "VACATION")

    r = _get("op-1", div.id)

    # Пустой 200 здесь = тихо неверный префилл (весь дивизион «В строю»).
    assert r.status_code == 403, r.data
    assert r.data["error_code"] == "PERMISSION_DENIED"


# --- AC-7: глобальный грант ------------------------------------------------


def test_global_grant_reads_any_division(env):
    org, dtp, div = env
    other = _division(org, dtp, "D4-101b")
    _grant("adm-1", "ADMIN")  # wildcard `*`
    emp = _emp(other)
    _status(emp, "VACATION")

    r = _get("adm-1", other.id)

    assert r.status_code == 200
    assert [row["employee_id"] for row in r.data["rows"]] == [str(emp.id)]


# --- AC-8: 404 фантомного дивизиона ПОСЛЕ scope ----------------------------


def test_phantom_division_is_404_for_global_actor(env):
    org, dtp, div = env
    _grant("adm-1", "ADMIN")

    r = _get("adm-1", uuid.uuid4())

    assert r.status_code == 404
    assert r.data["error_code"] == "ENTITY_NOT_FOUND"


def test_phantom_division_is_403_for_scoped_stranger(env):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)

    # Скоупнутый чужак НЕ должен узнать, существует ли дивизион (oracle).
    assert _get("op-1", uuid.uuid4()).status_code == 403


# --- AC-9: структурная валидация -------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {"division_id": "-"},  # business_date отсутствует
        {"business_date": "2026-06-05"},  # division_id отсутствует
        {"business_date": "не-дата", "division_id": "-"},
        {"business_date": "2026-06-05", "division_id": "не-uuid"},
    ],
)
def test_validation_errors(env, params):
    org, dtp, div = env
    _grant("op-1", "DIVISION_OPERATOR", div)
    query = {k: (str(div.id) if v == "-" else v) for k, v in params.items()}

    r = _client("op-1").get(URL, query)

    assert r.status_code == 400, r.data
    assert r.data["error_code"] == "VALIDATION_ERROR"


# --- AC-13: own-level, НЕ поддерево ----------------------------------------


def test_child_division_rows_absent(env):
    org, dtp, div = env
    child = _division(org, dtp, "D1-CHILD-101b", parent=div)
    _grant("op-1", "DIVISION_OPERATOR", div)  # scope subtree-aware → child виден
    _status(_emp(child), "VACATION")
    mine = _emp(div)
    _status(mine, "STUDY")

    rows = _get("op-1", div.id).data["rows"]

    # Дочерний (не сиблинг!) — на сиблинге own-level и subtree неразличимы.
    assert [row["employee_id"] for row in rows] == [str(mine.id)]


# --- AC-14: пустой ростер не течёт всей базой ------------------------------


def test_empty_division_does_not_leak_other_divisions(env):
    org, dtp, div = env
    empty = _division(org, dtp, "D5-EMPTY-101b")
    _grant("op-1", "DIVISION_OPERATOR")  # глобальный грант — 403 не помешает
    _status(_emp(div), "VACATION")  # живой статус в ДРУГОМ дивизионе

    r = _get("op-1", empty.id)

    assert r.status_code == 200
    # `overlapping_on(date, employee_ids=None)` не фильтрует вовсе — пустой
    # ростер обязан давать [], а не статусы всей базы.
    assert r.data["rows"] == []
