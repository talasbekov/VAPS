"""Уволенному статус не заводят.

Границы найма этой дыры не закрывали: они смотрят на дату увольнения, а уволить
можно и НЕ проставив её — карточка допускает пустую дату, и приёмник увольнения
это прямо предусматривает (закрывает статусы «сегодняшним» числом). При пустой
дате граница найма открыта, и уволенному можно было завести статус чем угодно.

Вреда сразу не видно, и в этом вся неприятность: уволенный выпадает из списочного
состава, строка лежит тихо — и всплывает при ВОССТАНОВЛЕНИИ, когда человек
возвращается в списки уже со статусами, которых ему никто не ставил. Плюс она
противоречит записи журнала об увольнении, где сказано, что статусы закрыты.

Отдельная нить — гонка: увольнение и создание статуса идут одновременно. Оба пути
берут замок на строке сотрудника, значит выстраиваются в очередь; вопрос лишь в
том, что видит пришедший вторым.
"""
import threading
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.db import connections
from rest_framework.test import APIClient

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_service import create_status
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    payload,
    seed_role,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

CREATE_URL = "/api/operations/statuses/"
BULK_URL = "/api/operations/statuses/bulk/"


def fire(employee, *, with_date=False):
    """Уволить. По умолчанию БЕЗ даты увольнения — так и бывает чаще всего,
    и ровно в этом случае границы найма ничего не запрещали."""
    employee.employment_status = Employee.EmploymentStatus.FIRED
    if with_date:
        employee.dismissal_date = TODAY
    with clock.override(TODAY):
        employee.save()
    return employee


def create_body(employee, code="DUTY"):
    return {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": TODAY.isoformat(),
        "date_end": (TODAY + timedelta(days=2)).isoformat(),
    }


# ── Одиночное создание ───────────────────────────────────────────────────


def test_a_status_cannot_be_created_for_a_dismissed_employee(types, division):  # noqa: F811
    """Несущий тест: дата увольнения ПУСТА, и границы найма молчат."""
    employee = fire(make_employee(division))
    api, _ = client_for("fired-one", "ORGD", ["status.manage"])

    with clock.override(TODAY):
        response = api.post(CREATE_URL, create_body(employee), format="json")

    assert response.status_code == 422
    assert response.json()["error_code"] == "EMPLOYEE_NOT_EMPLOYED"
    assert OpsEmployeeStatus.objects.filter(employee_id=employee.id).count() == 0


def test_a_working_employee_is_unaffected(types, division):  # noqa: F811
    """Иначе отказ выше объяснялся бы чем угодно — например сломанным
    маршрутом."""
    employee = make_employee(division)
    api, _ = client_for("fired-two", "ORGD", ["status.manage"])

    with clock.override(TODAY):
        response = api.post(CREATE_URL, create_body(employee), format="json")

    assert response.status_code == 201


def test_the_service_refuses_it_too(types, division):  # noqa: F811
    """Маршрут не единственный вход: правило принадлежит сервису."""
    employee = fire(make_employee(division))

    with pytest.raises(DomainError) as exc:
        with clock.override(TODAY):
            create_status(
                employee_id=employee.id,
                status_type_code="DUTY",
                date_start=TODAY,
                date_end=TODAY + timedelta(days=2),
                actor="7",
            )

    assert exc.value.code == "EMPLOYEE_NOT_EMPLOYED"


# ── Массовый путь ────────────────────────────────────────────────────────


def test_a_batch_refuses_the_dismissed_row(types, division):  # noqa: F811
    employee = fire(make_employee(division))
    api, _ = client_for("fired-bulk", "ORGD", ["status.manage"])

    with clock.override(TODAY):
        response = api.post(BULK_URL, payload(employee), format="json")

    assert response.status_code == 422
    assert response.json()["error_code"] == "EMPLOYEE_NOT_EMPLOYED"


def test_a_batch_refuses_the_whole_thing_because_of_one_dismissed_row(
    types, division  # noqa: F811
):
    """Пачка атомарна: отказ по одному человеку не должен оставить строки по
    остальным — иначе оператор считал бы, что применилось всё."""
    working = make_employee(division)
    dismissed = fire(make_employee(division))
    api, _ = client_for("fired-mixed", "ORGD", ["status.manage"])

    with clock.override(TODAY):
        response = api.post(BULK_URL, payload(working, dismissed), format="json")

    assert response.status_code == 422
    assert OpsEmployeeStatus.objects.count() == 0


# ── Уборку старых строк это не запрещает ─────────────────────────────────


def test_the_guard_does_not_obstruct_the_dismissal_itself(types, division):  # noqa: F811
    """Гвард стоит только на СОЗДАНИИ, и увольнение он не трогает.

    Проверить это надо прямо: увольнение само ЗАКРЫВАЕТ существующие статусы, и
    запрети гвард ещё и закрытие — хвосты уволенного остались бы навсегда, а
    убирать их надо именно после увольнения.

    Первый проход этого теста пытался отменить строку РУКАМИ после увольнения и
    падал на «строка уже отменена» — увольнение успевало её закрыть само. Это и
    есть проверяемое свойство, только смотреть надо на результат увольнения, а не
    на вторую отмену.
    """
    employee = make_employee(division)
    row = OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="DUTY",
        date_start=TODAY + timedelta(days=3),
        date_end=TODAY + timedelta(days=5),
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )

    fire(employee)

    row.refresh_from_db()
    assert row.cancelled_at is not None


# ── Гонка: увольнение против создания ────────────────────────────────────


@pytest.mark.django_db(transaction=True)
def test_a_status_started_before_the_dismissal_does_not_slip_in_after_it(
    types, division  # noqa: F811
):
    """Оба пути берут замок на строке сотрудника и выстраиваются в очередь.

    Проверяется ИСХОД, а не порядок: чем бы очередь ни кончилась, у уволенного
    не должно остаться незакрытого статуса. Пришёл создающий первым — увольнение
    закроет созданное; пришёл вторым — гвард откажет.
    """
    employee = make_employee(division)
    seed_role("ORGD", ["status.manage"])
    client_for("race-op", "ORGD", ["status.manage"])
    user_id = get_user_model().objects.get(username="race-op").pk
    barrier = threading.Barrier(2, timeout=20)
    results = {}

    def creating():
        try:
            api = APIClient()
            api.force_authenticate(get_user_model().objects.get(pk=user_id))
            barrier.wait()
            with clock.override(TODAY):
                results["create"] = api.post(
                    CREATE_URL, create_body(employee), format="json"
                ).status_code
        finally:
            connections.close_all()

    def dismissing():
        try:
            barrier.wait()
            fresh = Employee.objects.get(pk=employee.pk)
            fresh.employment_status = Employee.EmploymentStatus.FIRED
            with clock.override(TODAY):
                fresh.save()
            results["fire"] = "done"
        finally:
            connections.close_all()

    threads = [threading.Thread(target=creating), threading.Thread(target=dismissing)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not t.is_alive() for t in threads), "гонка не завершилась"

    live = OpsEmployeeStatus.objects.filter(
        employee_id=employee.id, cancelled_at__isnull=True, date_end__gt=TODAY
    )
    assert results["fire"] == "done"
    assert live.count() == 0, (
        f"у уволенного остался незакрытый статус; создание ответило "
        f"{results.get('create')}"
    )
