"""POST /api/operations/statuses/{id}/complete/ — досрочное завершение.

Сервис досрочного завершения был написан давно и покрыт своими тестами, но до
этого среза дотянуться до него мог только тест: маршрута у операции не
существовало. То есть операция, у которой есть правила, событие журнала и
поправка сдачи, для оператора не существовала вовсе.

Зона вьюхи: гейт права, область видимости, обязательная дата факта, подпись из
аутентификации и доставка отказов сервиса конвертом раздела. Правила самого
завершения (только ACTIVE, факт не в будущем, интервал непуст) живут в сервисе.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db


def url(status_id):
    return f"/api/operations/statuses/{status_id}/complete/"


def make_status(employee, **overrides):
    """По умолчанию строка ИДЁТ (ACTIVE на TODAY) — только такую и завершают."""
    fields = {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": TODAY - timedelta(days=2),
        "date_end": TODAY + timedelta(days=5),
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": "seed",
    }
    fields.update(overrides)
    return OpsEmployeeStatus.objects.create(**fields)


def complete(api, status_id, body=None, at=TODAY):
    with clock.override(at):
        return api.post(
            url(status_id),
            {"actual_end": TODAY.isoformat()} if body is None else body,
            format="json",
        )


def operator(name="complete-op", scope=None):
    return client_for(name, "ORGD", ["status.manage"], scope)


# ── Гейт права ───────────────────────────────────────────────────────────


def test_anonymous_is_refused(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))

    assert complete(APIClient(), status_row.pk).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = client_for("no-perm", "ORGD", ["status.view"])

    assert complete(api, status_row.pk).status_code == 403


def test_the_manage_permission_is_enough(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert complete(api, status_row.pk).status_code == 200


def test_a_get_is_a_method_error_not_a_denial(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert api.get(url(status_row.pk)).status_code == 405


# ── Область видимости ────────────────────────────────────────────────────


def test_a_status_of_a_foreign_division_is_refused(types, division):  # noqa: F811
    """403, а не тихое завершение чужой строки."""
    other = Division.objects.create(name="Чужое управление")
    theirs = make_status(make_employee(other))
    api, _ = operator(scope=division.id)

    response = complete(api, theirs.pk)

    theirs.refresh_from_db()
    assert response.status_code == 403
    assert theirs.date_end == TODAY + timedelta(days=5)


def test_a_status_inside_the_scope_is_completed(types, division):  # noqa: F811
    """Соседний вызов тем же клиентом проходит — иначе отказ выше объяснялся бы
    отсутствием права вообще, а не областью."""
    mine = make_status(make_employee(division))
    api, _ = operator(scope=division.id)

    assert complete(api, mine.pk).status_code == 200


# ── Что делает операция ──────────────────────────────────────────────────


def test_the_interval_closes_on_the_reported_fact(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    complete(api, status_row.pk)

    status_row.refresh_from_db()
    assert status_row.date_end == TODAY


def test_the_response_carries_the_updated_row(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    body = complete(api, status_row.pk).json()

    assert body["id"] == status_row.pk
    assert body["date_end"] == TODAY.isoformat()


def test_the_signature_comes_from_authentication_and_not_from_the_body(
    types, division  # noqa: F811
):
    """Кто завершил — факт, и присланному в теле имени здесь не верят."""
    status_row = make_status(make_employee(division))
    api, user = operator()

    complete(
        api,
        status_row.pk,
        {"actual_end": TODAY.isoformat(), "actor": "999", "updated_by": "999"},
    )

    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    entry = OpsAuditLog.objects.get(action=audit_service.STATUS_COMPLETED)
    assert entry.actor_user_id == str(user.pk)


def test_the_operation_writes_its_own_journal_event(types, division):  # noqa: F811
    """Досрочное завершение — не правка: у него своё событие, и лента строки
    обязана их различать."""
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    status_row = make_status(make_employee(division))
    api, _ = operator()

    complete(api, status_row.pk)

    assert OpsAuditLog.objects.filter(
        action=audit_service.STATUS_COMPLETED, entity_id=status_row.pk
    ).count() == 1
    assert OpsAuditLog.objects.filter(action=audit_service.STATUS_UPDATED).count() == 0


# ── Форма тела и отказы ──────────────────────────────────────────────────


def test_the_fact_date_is_required_and_has_no_default(types, division):  # noqa: F811
    """Умолчание «сегодня» молча записало бы не тот день, а исправлять его
    пришлось бы уже поправкой сдачи."""
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert complete(api, status_row.pk, {}).status_code == 400


def test_an_unreadable_date_is_a_form_error(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert complete(api, status_row.pk, {"actual_end": "вчера"}).status_code == 400


def test_a_status_that_has_not_started_cannot_be_completed(types, division):  # noqa: F811
    """Не начавшийся статус не случился — его отменяют, а не завершают."""
    planned = make_status(
        make_employee(division),
        date_start=TODAY + timedelta(days=3),
        date_end=TODAY + timedelta(days=5),
    )
    api, _ = operator()

    response = complete(api, planned.pk)

    assert response.status_code == 422
    assert response.json()["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_a_fact_in_the_future_is_refused(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    response = complete(
        api, status_row.pk, {"actual_end": (TODAY + timedelta(days=1)).isoformat()}
    )

    assert response.status_code == 422


def test_a_missing_status_is_not_found(types, division):  # noqa: F811
    api, _ = operator()

    assert complete(api, 10**9).status_code == 404


def test_a_junk_id_answers_the_same_way_as_a_missing_one(types, division):  # noqa: F811
    api, _ = operator()

    assert complete(api, "abc").status_code == 404
