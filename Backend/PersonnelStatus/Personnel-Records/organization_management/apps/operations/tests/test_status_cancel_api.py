"""POST /api/operations/statuses/{id}/cancel/ — маршрут отмены статуса.

Зона ответственности вьюхи: гейт права, область видимости, обязательная
причина, форма 200 и доставка отказов сервиса конвертом раздела. Правила
самой отмены (только PLANNED, append-once факты, блокировка) живут в сервисе
и покрыты test_status_service.py.

Обвязка (роль, клиент, сотрудник со штатной единицей) переиспользуется из
маршрутного теста пачки — общая для всех трёх маршрутов статусов.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest, используется по имени аргумента
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

REASON = "приказ отменён"


def url(status_id):
    return f"/api/operations/statuses/{status_id}/cancel/"


def make_status(employee, **overrides):
    """Строка по умолчанию НЕ НАЧАВШАЯСЯ (PLANNED на TODAY) — только такую и
    можно отменить."""
    fields = {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": TODAY + timedelta(days=3),
        "date_end": TODAY + timedelta(days=5),
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": "seed",
    }
    fields.update(overrides)
    return OpsEmployeeStatus.objects.create(**fields)


def cancel(api, status_id, body=None):
    with clock.override(TODAY):
        return api.post(
            url(status_id), {"reason": REASON} if body is None else body, format="json"
        )


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области видимости: оба 403, различает форма
    (гейт → {detail} DRF, область → конверт {error_code})."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    employee = make_employee(division)
    status_row = make_status(employee)
    response = cancel(APIClient(), status_row.pk)
    assert_denied_by_gate(response)
    status_row.refresh_from_db()
    assert status_row.cancelled_at is None


def test_without_status_manage_403(types, division):
    api, _ = client_for("cnl-viewer", "VIEWER", ["status.view"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = cancel(api, status_row.pk)
    assert_denied_by_gate(response)
    status_row.refresh_from_db()
    assert status_row.cancelled_at is None


# ── Успех ────────────────────────────────────────────────────────────────

def test_cancel_returns_cancelled_row(types, division):
    api, user = client_for("cnl-ok", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = cancel(api, status_row.pk)
    assert response.status_code == 200
    assert response.data["state"] == "CANCELLED"
    assert response.data["cancelled_reason"] == REASON
    # Кто отменил — из аутентификации, а не из тела запроса.
    assert response.data["cancelled_by"] == str(user.pk)
    assert response.data["cancelled_at"] is not None
    # Ответ не расходится с БД; строка НЕ удалена — отмена это факт.
    status_row.refresh_from_db()
    assert status_row.cancelled_by == str(user.pk)
    assert status_row.cancelled_reason == REASON
    assert OpsEmployeeStatus.objects.filter(pk=status_row.pk).exists()


def test_cancelled_interval_is_free_again(types, division):
    # После отмены период снова свободен: следующая строка того же жёсткого
    # типа на тот же интервал проходит и сервис, и ограничение БД.
    api, _ = client_for("cnl-free", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee, status_type_code="VACATION")
    assert cancel(api, status_row.pk).status_code == 200
    twin = make_status(employee, status_type_code="VACATION")
    assert twin.pk is not None


def test_actor_from_auth_not_from_body(types, division):
    # Присланное клиентом имя отменившего игнорируется: cancelled_by — факт
    # из контракта аутентификации.
    api, user = client_for("cnl-actor", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = cancel(
        api, status_row.pk, {"reason": REASON, "cancelled_by": "999", "actor": "999"}
    )
    assert response.status_code == 200
    status_row.refresh_from_db()
    assert status_row.cancelled_by == str(user.pk)


# ── Область видимости ────────────────────────────────────────────────────

def test_foreign_division_403_envelope(types, division):
    from organization_management.apps.divisions.models import Division

    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "cnl-scoped", "OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    status_row = make_status(make_employee(other))
    response = cancel(api, status_row.pk)
    # Конверт области, а не {detail} гейта: право у оператора ЕСТЬ.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    status_row.refresh_from_db()
    assert status_row.cancelled_at is None


def test_scoped_operator_cancels_own_division(types, division):
    # Обратная сторона: тот же оператор СВОЮ строку отменяет успешно — иначе
    # отказ выше неотличим от «этот оператор не может ничего».
    api, _ = client_for(
        "cnl-own", "OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    status_row = make_status(make_employee(division))
    assert cancel(api, status_row.pk).status_code == 200


def test_employee_without_staff_unit_403_envelope(types, division):
    api, _ = client_for(
        "cnl-noslot", "OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    status_row = make_status(make_employee(None))
    response = cancel(api, status_row.pk)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


# ── Форма запроса ────────────────────────────────────────────────────────

@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}])
def test_reason_required_400(types, division, body):
    # Причина обязательна и непуста: пробельная режется на границе HTTP.
    # Отмена без причины — потерянный след решения, поэтому 400, а не 200.
    api, _ = client_for(f"cnl-noreason-{len(body)}-{body.get('reason', 'x')}", "ADMIN", ["*"])
    status_row = make_status(make_employee(division))
    response = cancel(api, status_row.pk, body)
    assert response.status_code == 400
    assert "reason" in response.data
    status_row.refresh_from_db()
    assert status_row.cancelled_at is None


# ── Ошибки сервиса доезжают конвертом ────────────────────────────────────

def test_active_status_422_envelope(types, division):
    # Идущая строка — факт, который случился: её закрывают раньше срока, а
    # не отменяют.
    api, _ = client_for("cnl-active", "ADMIN", ["*"])
    status_row = make_status(
        make_employee(division), date_start=TODAY, date_end=TODAY + timedelta(days=2)
    )
    response = cancel(api, status_row.pk)
    assert response.status_code == 422
    assert response.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"
    status_row.refresh_from_db()
    assert status_row.cancelled_at is None


def test_double_cancel_422_and_facts_are_append_once(types, division):
    api, first_user = client_for("cnl-first", "ADMIN", ["*"])
    status_row = make_status(make_employee(division))
    assert cancel(api, status_row.pk).status_code == 200
    status_row.refresh_from_db()
    first_at = status_row.cancelled_at

    second_api, _ = client_for("cnl-second", "ADMIN", ["*"])
    response = cancel(second_api, status_row.pk, {"reason": "вторая причина"})
    assert response.status_code == 422
    assert response.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"
    # Факты первой отмены не переписаны.
    status_row.refresh_from_db()
    assert status_row.cancelled_by == str(first_user.pk)
    assert status_row.cancelled_reason == REASON
    assert status_row.cancelled_at == first_at


def test_projection_row_422_envelope(types, division):
    api, _ = client_for("cnl-auto", "ADMIN", ["*"])
    status_row = make_status(
        make_employee(division), source=OpsEmployeeStatus.Source.OM_AUTO
    )
    response = cancel(api, status_row.pk)
    assert response.status_code == 422
    assert response.data["error_code"] == "AUTO_STATUS_READONLY"
    status_row.refresh_from_db()
    assert status_row.cancelled_at is None


def test_missing_status_404_envelope(types, division):
    api, _ = client_for("cnl-404", "ADMIN", ["*"])
    response = cancel(api, 999999)
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_garbage_id_404_envelope(types, division):
    api, _ = client_for("cnl-garbage", "ADMIN", ["*"])
    response = cancel(api, "abc")
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


# ── Поверхность метода ───────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_other_methods_are_not_served(types, division, method):
    # Отмена — только POST: GET на post-only маршруте это промах поверхности
    # метода (405), а не отказ в праве (403).
    api, _ = client_for(f"cnl-method-{method}", "ADMIN", ["*"])
    status_row = make_status(make_employee(division))
    with clock.override(TODAY):
        response = getattr(api, method)(url(status_row.pk), {}, format="json")
    assert response.status_code == 405
