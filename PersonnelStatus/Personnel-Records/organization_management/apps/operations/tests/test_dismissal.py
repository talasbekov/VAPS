"""Увольнение: закрытие статусов и пар раздела ОМ.

Проверяется зона раздела: усечение накрывающих строк, отмена ещё не
начавшихся, системное закрытие пары и то, что уже записанные факты не
переписываются. Само увольнение (карточка, штат, слот) — логика старого
проекта, и здесь она не участвует.
"""
from datetime import date, timedelta

import pytest
from django.db import connection

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.dismissal import (
    DISMISSAL_REASON,
    close_statuses_on_dismissal,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.secondment_service import (
    initiate_secondment,
    request_return,
)
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"
# Дата увольнения совпадает с «сегодня» стенда: закрытие идёт по ней, а не по
# часам — часы здесь вообще не участвуют, кроме отметки времени факта.
DISMISSED_ON = TODAY


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def home():
    return Division.objects.create(name="Управление 1")


def employee_in(division):
    employee = make_employee()
    StaffUnit.objects.create(
        division=division, employee=employee, index=employee.id
    )
    return employee


def status_of(employee, code="DUTY", start=None, end=None, **overrides):
    fields = {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": TODAY - timedelta(days=2) if start is None else start,
        "date_end": TODAY + timedelta(days=5) if end is None else end,
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": "seed",
    }
    fields.update(overrides)
    return OpsEmployeeStatus.objects.create(**fields)


def dismiss(employee, on_date=DISMISSED_ON, actor=ACTOR):
    with clock.override(TODAY):
        return close_statuses_on_dismissal(
            employee.id, dismissal_date=on_date, actor=actor
        )


# ── Усечение накрывающих строк ───────────────────────────────────────────

def test_spanning_status_is_truncated_to_the_date(types, home):
    employee = employee_in(home)
    row = status_of(employee)
    result = dismiss(employee)
    assert result["truncated"] == 1
    row.refresh_from_db()
    # Полуинтервал [начало, D): статус действовал по D-1, на саму дату
    # увольнения он уже не действует.
    assert row.date_end == DISMISSED_ON
    assert row.state_on(DISMISSED_ON) == OpsEmployeeStatus.LifecycleState.COMPLETED
    assert row.cancelled_at is None


def test_finished_status_is_left_alone(types, home):
    # Прошлое не переписывают: закончившаяся строка — факт, который случился.
    employee = employee_in(home)
    row = status_of(
        employee, start=TODAY - timedelta(days=9), end=TODAY - timedelta(days=4)
    )
    result = dismiss(employee)
    assert result["truncated"] == 0
    row.refresh_from_db()
    assert row.date_end == TODAY - timedelta(days=4)


def test_status_ending_on_the_date_is_not_touched(types, home):
    # Граница: date_end == D уже удовлетворяет правилу, усекать нечего.
    employee = employee_in(home)
    row = status_of(
        employee, start=TODAY - timedelta(days=3), end=DISMISSED_ON
    )
    result = dismiss(employee)
    assert result["truncated"] == 0
    row.refresh_from_db()
    assert row.date_end == DISMISSED_ON


# ── Отмена ещё не начавшихся ─────────────────────────────────────────────

def test_future_status_is_cancelled_with_reason(types, home):
    employee = employee_in(home)
    row = status_of(
        employee,
        start=TODAY + timedelta(days=3),
        end=TODAY + timedelta(days=6),
    )
    result = dismiss(employee)
    assert result["cancelled"] == 1
    assert result["truncated"] == 0
    row.refresh_from_db()
    assert row.cancelled_by == ACTOR
    assert row.cancelled_reason == DISMISSAL_REASON
    # Интервал не тронут: отмена это факт поверх строки, а не правка дат.
    assert row.date_start == TODAY + timedelta(days=3)


def test_status_starting_on_the_date_is_cancelled_not_truncated(types, home):
    # Граница: усечение до D дало бы пустой интервал, поэтому отмена.
    employee = employee_in(home)
    row = status_of(employee, start=DISMISSED_ON, end=TODAY + timedelta(days=4))
    result = dismiss(employee)
    assert (result["truncated"], result["cancelled"]) == (0, 1)
    row.refresh_from_db()
    assert row.cancelled_at is not None
    assert row.date_end == TODAY + timedelta(days=4)


def test_already_cancelled_status_is_not_rewritten(types, home):
    employee = employee_in(home)
    row = status_of(
        employee,
        start=TODAY + timedelta(days=3),
        end=TODAY + timedelta(days=6),
        cancelled_at=Clock.now(),
        cancelled_by="первый",
        cancelled_reason="приказ отменён",
    )
    result = dismiss(employee)
    assert result["cancelled"] == 0
    row.refresh_from_db()
    assert row.cancelled_by == "первый"
    assert row.cancelled_reason == "приказ отменён"


# ── Пара прикомандирования ───────────────────────────────────────────────

def make_pair(employee, host):
    with clock.override(TODAY):
        return initiate_secondment(
            employee.id,
            to_division_id=host.id,
            date_start=TODAY - timedelta(days=1),
            date_end=TODAY + timedelta(days=10),
            actor=ACTOR,
        )


def test_live_pair_is_closed_by_the_system(types, home):
    host = Division.objects.create(name="Управление 2")
    employee = employee_in(home)
    secondment = make_pair(employee, host)
    result = dismiss(employee)
    assert result["secondments_closed"] == 1
    secondment.refresh_from_db()
    # Оба факта рукопожатия ставит система: одинокое подтверждение не принял
    # бы CHECK базы, и такая пара была бы нечитаемой.
    assert secondment.return_requested_by == ACTOR
    assert secondment.return_confirmed_by == ACTOR
    assert secondment.state == Secondment.State.RETURNED
    # Ноги закрыты правилами выше — пара не ссылается на живой возврат.
    for leg in OpsEmployeeStatus.objects.filter(
        pk__in=[secondment.out_status_id, secondment.in_status_id]
    ):
        assert leg.date_end == DISMISSED_ON


def test_requested_pair_keeps_the_first_request(types, home):
    host = Division.objects.create(name="Управление 2")
    employee = employee_in(home)
    secondment = make_pair(employee, host)
    with clock.override(TODAY):
        request_return(secondment, actor="42")
    dismiss(employee)
    secondment.refresh_from_db()
    # Запрос живого человека не переписан системным.
    assert secondment.return_requested_by == "42"
    assert secondment.return_confirmed_by == ACTOR


def test_confirmed_pair_is_not_touched(types, home):
    from organization_management.apps.operations.secondment_service import (
        confirm_return,
    )

    host = Division.objects.create(name="Управление 2")
    employee = employee_in(home)
    secondment = make_pair(employee, host)
    with clock.override(TODAY):
        request_return(secondment, actor="42")
        confirm_return(secondment, actor="43")
    secondment.refresh_from_db()
    confirmed_at = secondment.return_confirmed_at

    result = dismiss(employee)
    assert result["secondments_closed"] == 0
    secondment.refresh_from_db()
    assert secondment.return_confirmed_by == "43"
    assert secondment.return_confirmed_at == confirmed_at


# ── Форма вызова ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("actor", ["", "   ", None])
def test_actor_is_required(types, home, actor):
    employee = employee_in(home)
    row = status_of(employee)
    with pytest.raises(DomainError) as exc:
        dismiss(employee, actor=actor)
    assert exc.value.http_status == 400
    row.refresh_from_db()
    assert row.date_end == TODAY + timedelta(days=5)


def test_missing_employee_404(types, home):
    with pytest.raises(DomainError) as exc:
        with clock.override(TODAY):
            close_statuses_on_dismissal(
                999999, dismissal_date=DISMISSED_ON, actor=ACTOR
            )
    assert exc.value.http_status == 404
    assert exc.value.code == "ENTITY_NOT_FOUND"


def test_second_call_changes_nothing(types, home):
    host = Division.objects.create(name="Управление 2")
    employee = employee_in(home)
    make_pair(employee, host)
    status_of(employee, start=TODAY + timedelta(days=3), end=TODAY + timedelta(days=6))
    first = dismiss(employee)
    assert (first["truncated"], first["cancelled"], first["secondments_closed"]) == (
        2,
        1,
        1,
    )
    snapshot = list(
        OpsEmployeeStatus.objects.filter(employee_id=employee.id)
        .order_by("pk")
        .values("pk", "date_end", "cancelled_at", "cancelled_by")
    )
    second = dismiss(employee)
    assert second == {"truncated": 0, "cancelled": 0, "secondments_closed": 0}
    assert (
        list(
            OpsEmployeeStatus.objects.filter(employee_id=employee.id)
            .order_by("pk")
            .values("pk", "date_end", "cancelled_at", "cancelled_by")
        )
        == snapshot
    )


def test_other_employees_are_not_touched(types, home):
    employee = employee_in(home)
    neighbour = employee_in(home)
    status_of(employee)
    neighbour_row = status_of(neighbour)
    dismiss(employee)
    neighbour_row.refresh_from_db()
    assert neighbour_row.date_end == TODAY + timedelta(days=5)


# ── Блокировка ───────────────────────────────────────────────────────────

class _QueryCollector:
    def __init__(self):
        self.queries = []

    def __call__(self, execute, sql, params, many, context):
        self.queries.append(sql)
        return execute(sql, params, many, context)


def test_employee_and_statuses_are_locked(types, home):
    # Закрытие идёт под блокировкой сотрудника И строк: параллельная правка
    # статуса не должна разъехаться с усечением. Ассерт по ИМЕНАМ таблиц:
    # любой FOR UPDATE в трассе сделал бы проверку вакуумной.
    employee = employee_in(home)
    status_of(employee)
    collector = _QueryCollector()
    with connection.execute_wrapper(collector):
        dismiss(employee)
    locked_tables = {
        table
        for table in (Employee._meta.db_table, OpsEmployeeStatus._meta.db_table)
        for sql in collector.queries
        if "FOR UPDATE" in sql.upper() and table in sql
    }
    assert locked_tables == {
        Employee._meta.db_table,
        OpsEmployeeStatus._meta.db_table,
    }, collector.queries
