"""Откомандирование: связанная пара DETACHED + ATTACHED.

Проверяется зона сервиса: обе ноги и связь пишутся как одно целое, пара не
конфликтует сама с собой, а любой отказ не оставляет ни одной строки.
Ограничения БД проверяются отдельно от сервиса: зелёный сервис не
доказывает, что CHECK доехал до схемы.
"""
from datetime import date, timedelta

import pytest
from django.db import IntegrityError, connection, transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.secondment_service import (
    initiate_secondment,
)
from organization_management.apps.operations.status_service import create_status
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"
START = TODAY
END = TODAY + timedelta(days=10)


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def home():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def host():
    return Division.objects.create(name="Управление 2")


def employee_in(division, **overrides):
    employee = make_employee(**overrides)
    if division is not None:
        StaffUnit.objects.create(
            division=division, employee=employee, index=employee.id
        )
    return employee


def initiate(employee, host_division, **overrides):
    kwargs = {
        "to_division_id": host_division.id if host_division else 999999,
        "date_start": START,
        "date_end": END,
        "actor": ACTOR,
    }
    kwargs.update(overrides)
    with clock.override(TODAY):
        return initiate_secondment(employee.id, **kwargs)


def assert_nothing_written(employee):
    """Ни ноги, ни связи: полупара — сотрудник, который нигде не числится."""
    assert not OpsEmployeeStatus.objects.filter(employee_id=employee.id).exists()
    assert not Secondment.objects.filter(employee_id=employee.id).exists()


# ── Успех ────────────────────────────────────────────────────────────────

def test_pair_and_link_are_written(types, home, host):
    employee = employee_in(home)
    secondment = initiate(employee, host, document_basis="Приказ №5")

    assert secondment.from_division_id == home.id
    assert secondment.to_division_id == host.id
    assert secondment.created_by == ACTOR
    assert secondment.document_basis == "Приказ №5"

    codes = {
        row.status_type_code: row
        for row in OpsEmployeeStatus.objects.filter(employee_id=employee.id)
    }
    assert set(codes) == {"DETACHED", "ATTACHED"}
    for row in codes.values():
        assert row.date_start == START
        assert row.date_end == END
        assert row.source == OpsEmployeeStatus.Source.USER
        assert row.created_by == ACTOR
        assert row.document_basis == "Приказ №5"
    # Связь указывает на ТЕ ЖЕ строки, а не на одноимённые сироты.
    assert secondment.out_status_id == codes["DETACHED"].pk
    assert secondment.in_status_id == codes["ATTACHED"].pk


def test_pair_does_not_conflict_with_itself(types, home, host):
    # Несущая гарантия: вторая нога проверяется, когда первая уже записана.
    # Если бы матрица не объявляла пару совместимой, здесь был бы ложный 409.
    employee = employee_in(home)
    assert initiate(employee, host) is not None


def test_home_division_is_a_snapshot(types, home, host):
    # Перевод по штату ПОСЛЕ откомандирования не переписывает, откуда
    # человека откомандировали.
    employee = employee_in(home)
    secondment = initiate(employee, host)
    third = Division.objects.create(name="Управление 3")
    StaffUnit.objects.filter(employee=employee).update(division=third)
    secondment.refresh_from_db()
    assert secondment.from_division_id == home.id


# ── Отказы: не пишется ничего ────────────────────────────────────────────

def test_same_division_400(types, home, host):
    employee = employee_in(home)
    with pytest.raises(DomainError) as exc:
        initiate(employee, home)
    assert exc.value.http_status == 400
    assert exc.value.code == "VALIDATION_ERROR"
    assert_nothing_written(employee)


def test_missing_host_division_404(types, home, host):
    employee = employee_in(home)
    with pytest.raises(DomainError) as exc:
        initiate(employee, None)
    assert exc.value.http_status == 404
    assert exc.value.code == "ENTITY_NOT_FOUND"
    assert_nothing_written(employee)


def test_employee_without_staff_unit_422(types, home, host):
    # «Откуда» неизвестно — источник пары выдумывать нельзя.
    employee = employee_in(None)
    with pytest.raises(DomainError) as exc:
        initiate(employee, host)
    assert exc.value.http_status == 422
    assert exc.value.code == "VALIDATION_ERROR"
    assert_nothing_written(employee)


def test_missing_employee_404(types, home, host):
    with pytest.raises(DomainError) as exc:
        with clock.override(TODAY):
            initiate_secondment(
                999999,
                to_division_id=host.id,
                date_start=START,
                date_end=END,
                actor=ACTOR,
            )
    assert exc.value.http_status == 404
    assert exc.value.code == "ENTITY_NOT_FOUND"


@pytest.mark.parametrize("actor", ["", "   ", None])
def test_empty_actor_400(types, home, host, actor):
    employee = employee_in(home)
    with pytest.raises(DomainError) as exc:
        initiate(employee, host, actor=actor)
    assert exc.value.http_status == 400
    assert_nothing_written(employee)


def test_already_detached_403(types, home, host):
    # FR-16: у откомандированного статусы закрыты — в том числе повторное
    # откомандирование.
    employee = employee_in(home)
    initiate(employee, host)
    third = Division.objects.create(name="Управление 3")
    before = OpsEmployeeStatus.objects.filter(employee_id=employee.id).count()
    with pytest.raises(DomainError) as exc:
        initiate(employee, third)
    assert exc.value.http_status == 403
    assert exc.value.code == "PERMISSION_DENIED"
    # Вторая пара не появилась.
    assert OpsEmployeeStatus.objects.filter(employee_id=employee.id).count() == before
    assert Secondment.objects.filter(employee_id=employee.id).count() == 1


def test_hard_overlap_422(types, home, host):
    employee = employee_in(home)
    with clock.override(TODAY):
        create_status(
            employee_id=employee.id,
            status_type_code="VACATION",
            date_start=START,
            date_end=START + timedelta(days=3),
            actor=ACTOR,
        )
    with pytest.raises(DomainError) as exc:
        initiate(employee, host)
    assert exc.value.http_status == 422
    assert exc.value.code == "OVERLAPPING_HARD_STATUS"
    # Отпуск на месте, ног пары нет.
    assert list(
        OpsEmployeeStatus.objects.filter(employee_id=employee.id).values_list(
            "status_type_code", flat=True
        )
    ) == ["VACATION"]
    assert not Secondment.objects.filter(employee_id=employee.id).exists()


def test_soft_overlap_409_without_override(types, home, host):
    # Мягкое пересечение остаётся отказом: откомандирование не продавливают
    # поверх предупреждения — обхода у этого пути нет вовсе.
    employee = employee_in(home)
    with clock.override(TODAY):
        create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=START,
            date_end=START + timedelta(days=2),
            actor=ACTOR,
        )
    with pytest.raises(DomainError) as exc:
        initiate(employee, host)
    assert exc.value.http_status == 409
    assert exc.value.code == "STATUS_OVERLAP_WARNING"
    assert not Secondment.objects.filter(employee_id=employee.id).exists()
    assert not OpsEmployeeStatus.objects.filter(
        employee_id=employee.id, status_type_code__in=["DETACHED", "ATTACHED"]
    ).exists()


@pytest.mark.parametrize(
    "start, end, code",
    [
        (END, START, "INVALID_DATE_RANGE"),
        (date(2019, 1, 1), date(2019, 6, 1), "DATE_OUTSIDE_EMPLOYMENT"),
    ],
)
def test_interval_is_validated_422(types, home, host, start, end, code):
    employee = employee_in(home)
    with pytest.raises(DomainError) as exc:
        initiate(employee, host, date_start=start, date_end=end)
    assert exc.value.http_status == 422
    assert exc.value.code == code
    assert_nothing_written(employee)


def test_failure_after_first_leg_leaves_nothing(types, home, host, monkeypatch):
    # Единственный отказ, который случается ПОСЛЕ первой записи: падение на
    # самой связи. Прочие проверки срабатывают до всякой записи, поэтому без
    # этой пробы транзакция вокруг вставок была бы ничем не подтверждена.
    employee = employee_in(home)

    def boom(*args, **kwargs):
        raise RuntimeError("сбой на записи связи")

    monkeypatch.setattr(Secondment.objects, "create", boom)
    with pytest.raises(RuntimeError):
        initiate(employee, host)
    assert_nothing_written(employee)


# ── Блокировка ───────────────────────────────────────────────────────────

def test_employee_row_is_locked(types, home, host):
    # Пара пишется под пессимистичной блокировкой СОТРУДНИКА: два оператора
    # не должны откомандировать одного человека одновременно. Ассерт по
    # ИМЕНИ таблицы: любой FOR UPDATE в трассе сделал бы проверку вакуумной.
    employee = employee_in(home)
    with connection.execute_wrapper(_collect := _QueryCollector()):
        initiate(employee, host)
    locks = [
        sql
        for sql in _collect.queries
        if "FOR UPDATE" in sql.upper() and Employee._meta.db_table in sql
    ]
    assert locks, _collect.queries


class _QueryCollector:
    def __init__(self):
        self.queries = []

    def __call__(self, execute, sql, params, many, context):
        self.queries.append(sql)
        return execute(sql, params, many, context)


# ── Гарантии БД (в обход сервиса) ────────────────────────────────────────

def test_db_rejects_self_secondment(types, home, host):
    employee = employee_in(home)
    secondment = initiate(employee, host)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Secondment.objects.create(
                employee_id=employee.id,
                out_status=secondment.out_status,
                in_status=secondment.in_status,
                from_division_id=home.id,
                to_division_id=home.id,
            )


def test_db_rejects_identical_legs(types, home, host):
    employee = employee_in(home)
    secondment = initiate(employee, host)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Secondment.objects.create(
                employee_id=employee.id,
                out_status=secondment.out_status,
                in_status=secondment.out_status,
                from_division_id=home.id,
                to_division_id=host.id,
            )


def test_leg_is_protected_from_delete(types, home, host):
    # Нога не исчезает из-под связи: удаление строки статуса запрещено, пока
    # на неё смотрит пара.
    from django.db.models import ProtectedError

    employee = employee_in(home)
    secondment = initiate(employee, host)
    with pytest.raises(ProtectedError):
        secondment.out_status.delete()
