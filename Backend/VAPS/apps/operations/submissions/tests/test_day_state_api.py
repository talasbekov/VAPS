"""Story 10.3 — GET day-state (/api/operations/daily-submissions/day-state/).

Одна read-модель панели сдачи: видимые под ``daily_report.mark_update``
подразделения (+ submitted-состояние) и, при ``division_id``, — detail
(серверный ``preview_event`` несданного дня той же ``_diff_key``-семантикой,
что submit_day, либо ``traffic_light`` 5.5a сданного). Проверяется HTTP-контракт:

- list-режим: свой присутствует И чужой отсутствует (ненулевой дискриминатор в
  одном тесте, AC-2); submission с 9 полями / null; 400 на мусорную/отсутствующую
  дату; глобальный грант → все подразделения (семантика divisions_map 10.1a);
- detail-режим: preview CONFIRMED на delete+recreate идентичного факта / CHANGED
  на изменённом интервале; сквозной preview == event submit_day (AC-3);
  GREEN/drift=null/preview=null; YELLOW+drift после увода derived-победителя;
  403 чужое/фантом у scoped ДО 404 (не оракул существования); 404 фантом у
  глобального гранта (AC-4);
- NFR-4: пин числа запросов list-режима (current_for_many, не N+1).

Auth via HTTP_X_USER_ID (канон 5.8-сюит); роли — seed_operations + прямые
UserRole; Clock запинен clock.override (окно submit_day детерминировано).
"""

import uuid
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    Organization,
)
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.day_submission_service import (
    preview_day_event,
)

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 4)
YESTERDAY = TODAY - timedelta(days=1)

PROJECTION_FIELDS = {
    "id",
    "division_id",
    "business_date",
    "version",
    "is_current",
    "event",
    "submitted_by",
    "submitted_at",
    "late",
}


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def tree():
    """seed_operations roles + a root→child subtree and an unrelated division."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-DS")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    root = Division.objects.create(
        organization=org, type_code=dt, name="root", code="R-DS"
    )
    child = Division.objects.create(
        organization=org, type_code=dt, name="child", code="C-DS", parent=root
    )
    other = Division.objects.create(
        organization=org, type_code=dt, name="other", code="O-DS"
    )
    return root, child, other


@pytest.fixture
def scoped_op(tree):
    """DIVISION_OPERATOR (держит daily_report.mark_update), scoped на root."""
    root, _, _ = tree
    UserRole.objects.create(
        user_id="op-scoped",
        role_code_id="DIVISION_OPERATOR",
        scope_division_id=root.id,
    )
    return "op-scoped"


@pytest.fixture
def global_op(tree):
    """DIVISION_OPERATOR с глобальной (безскоуповой) ролью."""
    UserRole.objects.create(
        user_id="op-global", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return "op-global"


_iin = iter(range(700_000, 800_000))


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


def make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


def _submit(division, business_date):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def _client(actor):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _get(actor, business_date=TODAY, division_id=None):
    params = {}
    if business_date is not None:
        params["business_date"] = str(business_date)
    if division_id is not None:
        params["division_id"] = str(division_id)
    return _client(actor).get(reverse("ops-daily-submission-day-state"), params)


def _by_division(payload):
    return {row["division_id"]: row for row in payload["divisions"]}


# -- AC-2: list-режим + scope --------------------------------------------------


def test_list_own_present_and_foreign_absent(scoped_op, tree):
    """Ненулевой дискриминатор: своё поддерево есть, чужое отсутствует."""
    root, child, other = tree
    response = _get(scoped_op)
    assert response.status_code == 200
    rows = _by_division(response.json())
    assert str(root.id) in rows
    assert str(child.id) in rows
    assert str(other.id) not in rows
    # name — из core-селектора divisions_map
    assert rows[str(root.id)]["name"] == "root"
    assert response.json()["detail"] is None


def test_list_submission_nine_fields_or_null(scoped_op, tree):
    root, child, _ = tree
    submission = _submit(root, TODAY)
    response = _get(scoped_op)
    rows = _by_division(response.json())
    submitted = rows[str(root.id)]["submission"]
    assert submitted is not None
    assert set(submitted) == PROJECTION_FIELDS
    assert submitted["id"] == submission.pk
    assert submitted["event"] == "CHANGED"  # первая сдача
    assert rows[str(child.id)]["submission"] is None


def test_list_missing_date_400(scoped_op):
    response = _get(scoped_op, business_date=None)
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_list_garbage_date_400(scoped_op):
    response = _get(scoped_op, business_date="не-дата")
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_list_global_grant_sees_all_divisions(global_op, tree):
    """Глобальный грант → все подразделения (семантика divisions_map, 10.1a)."""
    root, child, other = tree
    rows = _by_division(_get(global_op).json())
    assert {str(root.id), str(child.id), str(other.id)} <= set(rows)


def test_list_query_count_constant_in_division_count(global_op, tree):
    """NFR-4: list-режим не растёт по числу подразделений/сдач (current_for_many)."""
    root, _, other = tree
    _submit(root, TODAY)
    response = _get(global_op)
    assert response.status_code == 200
    with CaptureQueriesContext(connection) as ctx_small:
        _get(global_op)
    org = root.organization
    for i in range(4):
        extra = Division.objects.create(
            organization=org,
            type_code=root.type_code,
            name=f"extra{i}",
            code=f"X-DS{i}",
        )
        _submit(extra, TODAY)
    with CaptureQueriesContext(connection) as ctx_big:
        _get(global_op)
    assert len(ctx_big) == len(ctx_small)


# -- AC-3: detail несдано — серверный preview_event -----------------------------


def test_preview_confirmed_on_identical_delete_recreate(scoped_op, tree):
    """delete+recreate идентичного факта НЕ даёт CHANGED (_diff_key без status_id)."""
    root, _, _ = tree
    emp = make_employee(root)
    fact = make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root, YESTERDAY)
    fact.delete()
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    response = _get(scoped_op, division_id=root.id)
    assert response.status_code == 200
    detail = response.json()["detail"]
    assert detail["preview_event"] == "CONFIRMED_NO_CHANGES"
    assert detail["traffic_light"] is None


def test_preview_changed_on_modified_interval(scoped_op, tree):
    root, _, _ = tree
    emp = make_employee(root)
    fact = make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root, YESTERDAY)
    fact.delete()
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 8, 1))  # интервал уехал
    detail = _get(scoped_op, division_id=root.id).json()["detail"]
    assert detail["preview_event"] == "CHANGED"
    assert detail["traffic_light"] is None


@pytest.mark.parametrize("mutate", [False, True])
def test_preview_equals_subsequent_submit_event(tree, mutate):
    """Сквозной: preview_day_event == event, который запишет submit_day."""
    root, _, _ = tree
    emp = make_employee(root)
    fact = make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root, YESTERDAY)
    if mutate:
        fact.delete()
        make_status(emp, "SICK_LEAVE", date(2026, 6, 1), date(2026, 6, 20))
    preview = preview_day_event(root.id, TODAY)
    submission = submit_day(division_id=root.id, business_date=TODAY, actor="op")
    assert submission.event == preview


# -- AC-4: detail сдано + drift; 403 ДО 404 --------------------------------------


def test_detail_submitted_green_without_drift(scoped_op, tree):
    root, _, _ = tree
    emp = make_employee(root)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(root, TODAY)
    detail = _get(scoped_op, division_id=root.id).json()["detail"]
    assert detail["preview_event"] is None
    assert detail["traffic_light"]["status"] == "GREEN"
    assert detail["traffic_light"]["late"] is False
    assert detail["traffic_light"]["drift"] is None


def test_detail_submitted_yellow_with_drift_shape(scoped_op, tree):
    """После сдачи derived-победитель уехал → YELLOW + drift {added,removed,changed}."""
    root, _, _ = tree
    emp = make_employee(root)
    _submit(root, TODAY)  # снапшот-победитель IN_SERVICE (фактов нет)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))  # live → DUTY
    detail = _get(scoped_op, division_id=root.id).json()["detail"]
    light = detail["traffic_light"]
    assert light["status"] == "YELLOW"
    assert light["drift"]["changed"] == [
        {"employee_id": str(emp.id), "from": "IN_SERVICE", "to": "DUTY"}
    ]
    assert light["drift"]["added"] == []
    assert light["drift"]["removed"] == []
    assert detail["preview_event"] is None


def test_detail_foreign_division_403(scoped_op, tree):
    _, _, other = tree
    response = _get(scoped_op, division_id=other.id)
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_detail_phantom_uuid_scoped_403_not_existence_oracle(scoped_op):
    """403 ДО проверки существования: фантом у scoped-актора — тоже 403."""
    response = _get(scoped_op, division_id=uuid.uuid4())
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_detail_phantom_uuid_global_404(global_op):
    response = _get(global_op, division_id=uuid.uuid4())
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_detail_garbage_division_id_400(scoped_op):
    response = _get(scoped_op, division_id="мусор")
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"
