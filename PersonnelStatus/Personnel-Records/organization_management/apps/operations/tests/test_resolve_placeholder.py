"""Разрешение строки-заглушки («уточняется») реальным статусом.

Проверяется главное свойство операции: она ЕДИНАЯ. Заглушка не правится, а
закрывается, реальный статус создаётся рядом, и след неясности остаётся —
иначе «мы не знали» задним числом превратилось бы в «мы знали и ошиблись».
"""
from datetime import date, timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    StatusOverride,
)
from organization_management.apps.operations.status_service import resolve_placeholder
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types as _seed_status_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
FROM = TODAY + timedelta(days=10)
TO = TODAY + timedelta(days=12)
ACTOR = "7"
WHY = "Выяснено по журналу дежурств: был наряд."


@pytest.fixture
def types():
    _seed_status_types()
    StatusType.objects.create(
        code="PENDING",
        name="Уточняется",
        priority=500,
        report_column_code="PENDING",
        is_placeholder=True,
    )


@pytest.fixture
def employee():
    person = make_employee()
    StaffUnit.objects.create(
        division=Division.objects.create(name="Управление 1"),
        employee=person,
        index=person.id,
    )
    return person


def make_status(employee, code="PENDING", start=FROM, end=TO):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def resolve(placeholder, **overrides):
    kwargs = {
        "resolved_type_code": "DUTY",
        "date_start": FROM,
        "date_end": TO,
        "actor": ACTOR,
        "reason": WHY,
    }
    kwargs.update(overrides)
    with clock.override(TODAY):
        return resolve_placeholder(placeholder, **kwargs)


# ── Одна операция, две строки ────────────────────────────────────────────


def test_the_placeholder_is_closed_and_the_real_status_appears(types, employee):
    """Заглушка не правится: след того, что день был неясен, обязан остаться."""
    placeholder = make_status(employee)

    resolved = resolve(placeholder)

    placeholder.refresh_from_db()
    assert placeholder.status_type_code == "PENDING"
    assert placeholder.cancelled_at is not None
    assert placeholder.cancelled_reason == WHY
    assert (resolved.status_type_code, resolved.source) == (
        "DUTY",
        OpsEmployeeStatus.Source.USER,
    )


def test_it_is_one_event_not_two_decisions(types, employee):
    """«Отменил» плюс «создал» читались бы как два несвязанных решения."""
    placeholder = make_status(employee)

    resolved = resolve(placeholder)

    entries = list(OpsAuditLog.objects.all())
    assert [entry.action for entry in entries] == [
        audit_service.STATUS_CLARIFICATION_RESOLVED
    ]
    (entry,) = entries
    # Лента ведётся по ЗАГЛУШКЕ: её судьбу ищет разбирающий неясность.
    assert entry.entity_id == placeholder.pk
    assert entry.old_value["status_type_code"] == "PENDING"
    assert entry.new_value["status_id"] == resolved.pk
    assert entry.reason == WHY


def test_nothing_is_written_when_the_resolution_is_refused(types, employee):
    """Закрытие и вставка — одна транзакция.

    Иначе заглушка осталась бы закрытой, а замены не появилось бы: день
    потерял бы и неясность, и факт.
    """
    placeholder = make_status(employee)

    with pytest.raises(DomainError):
        resolve(placeholder, resolved_type_code="НЕТ-ТАКОГО")

    placeholder.refresh_from_db()
    assert placeholder.cancelled_at is None
    assert OpsEmployeeStatus.objects.count() == 1


# ── Что можно разрешать и во что ─────────────────────────────────────────


def test_only_a_placeholder_can_be_replaced_this_way(types, employee):
    """Иначе ретро-замена стала бы способом переписать любой факт."""
    real = make_status(employee, code="DUTY")

    with pytest.raises(DomainError) as exc:
        resolve(real, resolved_type_code="VACATION")

    assert exc.value.http_status == 422
    assert exc.value.detail["status_type_code"] == "DUTY"


def test_the_resolution_must_produce_a_real_status(types, employee):
    """Заглушка вместо заглушки не разрешает ничего — только стирает след."""
    placeholder = make_status(employee)

    with pytest.raises(DomainError) as exc:
        resolve(placeholder, resolved_type_code="PENDING")

    assert exc.value.http_status == 422
    assert exc.value.detail["resolved_type_code"] == "PENDING"


def test_the_placeholder_is_recognised_by_the_catalog_not_by_its_name(
    types, employee
):
    """Признак — свойство ТИПА.

    Сервис, знающий одно имя наизусть, не признал бы заглушку, заведённую
    администратором под другим кодом.
    """
    StatusType.objects.create(
        code="НЕЯСНО",
        name="Обстановка уточняется",
        priority=501,
        report_column_code="PENDING",
        is_placeholder=True,
    )
    placeholder = make_status(employee, code="НЕЯСНО")

    resolved = resolve(placeholder)

    assert resolved.status_type_code == "DUTY"


def test_an_already_resolved_placeholder_is_terminal(types, employee):
    """Повторное разрешение переписало бы факты закрытия и создало вторую
    замену — владелец гарда один, общая преамбула правки."""
    placeholder = make_status(employee)
    resolve(placeholder)

    with pytest.raises(DomainError) as exc:
        resolve(placeholder, date_start=FROM, date_end=TO)

    assert exc.value.http_status == 422
    assert OpsEmployeeStatus.objects.filter(status_type_code="DUTY").count() == 1


# ── Причина ──────────────────────────────────────────────────────────────


def test_the_reason_is_always_required(types, employee):
    """В отличие от обычной правки — здесь она нужна и без сданных дней.

    Разрешение утверждает правду задним числом, и утверждения без основания
    не бывает.
    """
    placeholder = make_status(employee)

    with pytest.raises(DomainError) as exc:
        resolve(placeholder, reason="   ")

    assert exc.value.http_status == 400
    assert exc.value.detail["field"] == "reason"


# ── Свой интервал ────────────────────────────────────────────────────────


def test_the_resolution_may_narrow_the_period(types, employee):
    """Выясниться может и то, что наряд был короче."""
    placeholder = make_status(employee)

    resolved = resolve(placeholder, date_end=FROM + timedelta(days=1))

    assert (resolved.date_start, resolved.date_end) == (FROM, FROM + timedelta(days=1))


def test_the_placeholder_does_not_conflict_with_its_own_replacement(
    types, employee
):
    """Без исключения себя разрешение было бы невозможно в принципе."""
    placeholder = make_status(employee, code="PENDING")

    assert resolve(placeholder, resolved_type_code="VACATION") is not None


def test_a_hard_overlap_with_someone_elses_row_is_refused(types, employee):
    placeholder = make_status(employee)
    make_status(employee, code="VACATION", start=FROM, end=TO)

    with pytest.raises(DomainError) as exc:
        resolve(placeholder, resolved_type_code="SICK_LEAVE")

    assert exc.value.http_status == 422
    placeholder.refresh_from_db()
    assert placeholder.cancelled_at is None


def test_a_soft_overlap_is_bypassable_with_a_recorded_reason(types, employee):
    """Сосед должен ИДТИ на бизнес-дату: мягкое пересечение с ещё не
    начавшимся статусом раздел понижает до предупреждения, и проба на
    будущих датах была бы вакуумной."""
    running = TODAY + timedelta(days=2)
    placeholder = make_status(employee, start=TODAY, end=running)
    make_status(employee, code="DUTY", start=TODAY, end=running)

    resolved = resolve(
        placeholder,
        resolved_type_code="STUDY",
        date_start=TODAY,
        date_end=running,
        override=True,
        override_reason="решение начальника управления",
    )

    (bypass,) = StatusOverride.objects.all()
    assert bypass.status_id == resolved.pk
    assert bypass.reason == "решение начальника управления"
    assert bypass.conflicts[0]["status_type"] == "DUTY"


def test_a_soft_overlap_without_an_override_is_refused(types, employee):
    running = TODAY + timedelta(days=2)
    placeholder = make_status(employee, start=TODAY, end=running)
    make_status(employee, code="DUTY", start=TODAY, end=running)

    with pytest.raises(DomainError) as exc:
        resolve(
            placeholder,
            resolved_type_code="STUDY",
            date_start=TODAY,
            date_end=running,
        )

    assert exc.value.http_status == 409
    placeholder.refresh_from_db()
    assert placeholder.cancelled_at is None
