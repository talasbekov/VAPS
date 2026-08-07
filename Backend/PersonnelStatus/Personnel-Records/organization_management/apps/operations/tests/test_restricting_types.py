"""Какие типы закрывают сотрудника для правки — решает СПРАВОЧНИК.

Гвард «откомандированный закрыт для правки статусов» знал код DETACHED
наизусть, а флаг `restricts_editing` из справочника читал один сериализатор.
То есть API объявлял клиенту свойство типа, которого бэк не исполнял: пометь
администратор ограничивающим ещё один тип, экран показал бы замок, а правка
прошла бы насквозь.

Довод против имени наизусть в разделе уже записан — им обосновано чтение
признака заглушки из справочника (`resolve_placeholder`): сервис, знающий одно
имя, не признаёт того, что завёл администратор. Здесь то же правило доведено до
второго места, где оно нарушалось.

Тесты ниже проверяют ручку с обеих сторон: помеченный тип закрывает, снятая
пометка отпускает, а «DETACHED» без пометки не закрывает НИЧЕГО — иначе имя
осталось бы в коде незаметно для проб.
"""
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_service import (
    assert_employee_status_editable,
    create_status,
)
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_status_service import (
    TODAY,
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def employee():
    seed_types()
    person = make_employee()
    StaffUnit.objects.create(
        division=Division.objects.create(name="Управление 1"),
        employee=person,
        index=person.id,
    )
    return person


def standing(employee, code):
    """Живая строка, накрывающая сегодня."""
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=TODAY,
        date_end=TODAY + timedelta(days=10),
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def try_edit(employee):
    with clock.override(TODAY):
        assert_employee_status_editable(employee.id)


# ── Ручка настоящая ──────────────────────────────────────────────────────


def test_a_type_marked_in_the_catalog_closes_the_employee(employee):
    """Несущий тест: помечается ДРУГОЙ тип, не DETACHED.

    На DETACHED проверка не отличила бы «читает справочник» от «знает имя
    наизусть» — а именно это и было дефектом.
    """
    StatusType.objects.filter(code="STUDY").update(restricts_editing=True)
    standing(employee, "STUDY")

    with pytest.raises(DomainError) as exc:
        try_edit(employee)

    assert (exc.value.code, exc.value.http_status) == ("PERMISSION_DENIED", 403)


def test_the_same_type_unmarked_does_not_close_anyone(employee):
    """Иначе отказ выше объяснялся бы чем угодно — хоть самим фактом наличия
    живой строки."""
    standing(employee, "STUDY")

    try_edit(employee)


def test_unmarking_detached_lets_the_employee_be_edited(employee):
    """Обратная сторона: сними пометку с «Откомандирован» — и он открыт.

    Останься имя в коде, этот тест краснел бы: замок держался бы литералом
    независимо от справочника.

    ДРУГОЙ ТИП ПОМЕЧАЕТСЯ НАРОЧНО. Первый набор снимал пометку только с
    DETACHED, и набор ограничивающих типов пустел — гвард уходил из запроса
    раньше, чем дошёл бы до литерала, и проба «вернуть имя наизусть» этот тест
    не краснила. Пока в справочнике есть хоть один помеченный тип, запрос
    выполняется по-настоящему.
    """
    StatusType.objects.filter(code="DETACHED").update(restricts_editing=False)
    StatusType.objects.filter(code="VACATION").update(restricts_editing=True)
    standing(employee, "DETACHED")

    try_edit(employee)


def test_the_seeded_catalog_still_closes_a_detached_employee(employee):
    """А по умолчанию всё как было: прод помечает «Откомандирован», и он
    закрыт. Чтение справочника не должно было ослабить прежнее правило."""
    standing(employee, "DETACHED")

    with pytest.raises(DomainError):
        try_edit(employee)


# ── Границы ──────────────────────────────────────────────────────────────


def test_an_empty_set_of_restricting_types_closes_nobody(employee):
    """Справочник без единой пометки — законное состояние, а не повод падать.

    Пустой `__in` означает «ни одна строка не подходит», и этого достаточно:
    отдельная ранняя ветка «список пуст — выйти» здесь стояла и снята, потому
    что наблюдаемого поведения у неё не было, зато она прятала от проб возврат
    имени наизусть.
    """
    StatusType.objects.update(restricts_editing=False)
    standing(employee, "DETACHED")

    try_edit(employee)


def test_a_finished_restricting_status_no_longer_closes(employee):
    """Ограничение следует за ЖИВОЙ строкой, накрывающей сегодня.

    Чтение справочника не должно было превратить его в «когда-либо был
    откомандирован».
    """
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="DETACHED",
        date_start=TODAY - timedelta(days=10),
        date_end=TODAY,  # полуинтервал: сегодня уже не действует
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )

    try_edit(employee)


def test_creating_a_status_goes_through_the_same_guard(employee):
    """Правило принадлежит сервису, а не одному вызову: создание закрыто тем
    же гвардом, что и правка."""
    StatusType.objects.filter(code="STUDY").update(restricts_editing=True)
    standing(employee, "STUDY")

    with pytest.raises(DomainError) as exc:
        with clock.override(TODAY):
            create_status(
                employee_id=employee.id,
                status_type_code="DUTY",
                date_start=TODAY,
                date_end=TODAY + timedelta(days=2),
                actor=ACTOR,
            )

    assert exc.value.http_status == 403
