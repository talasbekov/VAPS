"""Возврат из прикомандирования: запрос → подтверждение → закрытие пары.

Зона сервиса: рукопожатие из двух append-once фактов, закрытие каждой ноги по
её состоянию и отказ на любом нарушении порядка. Обвязка (типы, сотрудник со
штатной единицей, инициация) переиспользуется из теста откомандирования.

Инварианты БД проверяются отдельно от сервиса: зелёный сервис не доказывает,
что CHECK доехал до схемы.
"""
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.secondment_service import (
    confirm_return,
    request_return,
)
from organization_management.apps.operations.tests.test_secondment_service import (
    ACTOR,
    END,
    START,
    TODAY,
    employee_in,
    home,  # noqa: F401 — фикстура pytest, используется по имени аргумента
    host,  # noqa: F401 — фикстура pytest
    initiate,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

RETURNER = "42"


def request_(secondment, actor=RETURNER):
    with clock.override(TODAY):
        return request_return(secondment, actor=actor)


def confirm(secondment, actor=RETURNER, **kwargs):
    with clock.override(TODAY):
        return confirm_return(secondment, actor=actor, **kwargs)


def legs_of(secondment):
    return {
        row.status_type_code: row
        for row in OpsEmployeeStatus.objects.filter(
            pk__in=[secondment.out_status_id, secondment.in_status_id]
        )
    }


# ── Запрос ───────────────────────────────────────────────────────────────

def test_request_writes_the_fact(types, home, host):
    secondment = initiate(employee_in(home), host)
    requested = request_(secondment)
    assert requested.return_requested_by == RETURNER
    assert requested.return_requested_at is not None
    # Запрос сам по себе ничего не закрывает: ноги живы до подтверждения.
    for leg in legs_of(secondment).values():
        assert leg.date_end == END
        assert leg.cancelled_at is None
    from_db = Secondment.objects.get(pk=secondment.pk)
    assert from_db.return_requested_by == RETURNER
    assert from_db.return_confirmed_at is None


def test_double_request_422_and_first_fact_survives(types, home, host):
    secondment = initiate(employee_in(home), host)
    first = request_(secondment)
    with pytest.raises(DomainError) as exc:
        request_(secondment, actor="99")
    assert exc.value.http_status == 422
    assert exc.value.code == "INVALID_LIFECYCLE_TRANSITION"
    from_db = Secondment.objects.get(pk=secondment.pk)
    assert from_db.return_requested_by == RETURNER
    assert from_db.return_requested_at == first.return_requested_at


def test_request_on_stale_object_sees_canonical_facts(types, home, host):
    # Второй писатель пришёл со СВОЕЙ копией, у которой факты пусты: после
    # блокировки он видит канонические и получает отказ, а не переписывает их.
    secondment = initiate(employee_in(home), host)
    stale = Secondment.objects.get(pk=secondment.pk)
    request_(secondment)
    with pytest.raises(DomainError):
        request_(stale, actor="99")
    assert Secondment.objects.get(pk=secondment.pk).return_requested_by == RETURNER


@pytest.mark.parametrize("actor", ["", "   ", None])
def test_request_requires_actor(types, home, host, actor):
    secondment = initiate(employee_in(home), host)
    with pytest.raises(DomainError) as exc:
        request_(secondment, actor=actor)
    assert exc.value.http_status == 400
    assert Secondment.objects.get(pk=secondment.pk).return_requested_at is None


# ── Подтверждение ────────────────────────────────────────────────────────

def test_confirm_closes_both_legs(types, home, host):
    secondment = initiate(employee_in(home), host)
    request_(secondment)
    confirmed = confirm(secondment)
    assert confirmed.return_confirmed_by == RETURNER
    assert confirmed.return_confirmed_at is not None
    # Обе ноги закрыты фактической датой, а не удалены: возврат — факт.
    legs = legs_of(secondment)
    assert set(legs) == {"DETACHED", "ATTACHED"}
    for leg in legs.values():
        assert leg.date_end == TODAY + timedelta(days=1)
        assert leg.state_on(TODAY + timedelta(days=1)) == (
            OpsEmployeeStatus.LifecycleState.COMPLETED
        )


def test_confirm_closes_started_earlier_pair_by_the_same_rule(types, home, host):
    # Дата начала на правило не влияет: возврат вступает в силу со следующего
    # дня и для ноги, начавшейся раньше, — сданный за сегодня расход с
    # прикомандированным не переписывается задним числом.
    employee = employee_in(home)
    secondment = initiate(employee, host, date_start=TODAY - timedelta(days=3))
    request_(secondment)
    confirm(secondment)
    for leg in legs_of(secondment).values():
        assert leg.date_end == TODAY + timedelta(days=1)
        # Сегодня статус ещё действует, завершается он завтра.
        assert leg.state_on(TODAY) == OpsEmployeeStatus.LifecycleState.ACTIVE
        assert leg.state_on(TODAY + timedelta(days=1)) == (
            OpsEmployeeStatus.LifecycleState.COMPLETED
        )


def test_confirm_cancels_not_started_pair(types, home, host):
    # Не начавшаяся пара не случилась — её отменяют, а не «закрывают».
    employee = employee_in(home)
    secondment = initiate(
        employee,
        host,
        date_start=TODAY + timedelta(days=5),
        date_end=TODAY + timedelta(days=9),
    )
    request_(secondment)
    confirm(secondment, reason="приказ отозван")
    for leg in legs_of(secondment).values():
        assert leg.cancelled_at is not None
        assert leg.cancelled_by == RETURNER
        assert leg.cancelled_reason == "приказ отозван"
        assert leg.state_on(TODAY) == OpsEmployeeStatus.LifecycleState.CANCELLED


def test_employee_is_editable_again_after_return(types, home, host):
    # Смысл возврата: ограничение FR-16 снято, статусы сотрудника снова
    # правятся. Без этой пробы «закрытые ноги» ничего не доказывают. Замок
    # снимает РЕШЕНИЕ: нога действует до конца сегодняшнего дня, а писать
    # сотруднику статусы можно уже сейчас.
    from organization_management.apps.operations.status_service import create_status

    employee = employee_in(home)
    secondment = initiate(employee, host, date_start=TODAY - timedelta(days=3))

    def try_create():
        with clock.override(TODAY):
            return create_status(
                employee_id=employee.id,
                status_type_code="STUDY",
                date_start=TODAY + timedelta(days=20),
                date_end=TODAY + timedelta(days=21),
                actor=ACTOR,
            )

    with pytest.raises(DomainError) as exc:
        try_create()
    assert exc.value.code == "PERMISSION_DENIED"

    # Одного ЗАПРОСА мало: спор ещё не окончен, замок держится.
    request_(secondment)
    with pytest.raises(DomainError) as exc:
        try_create()
    assert exc.value.code == "PERMISSION_DENIED"

    confirm(secondment)
    # Нога всё ещё действует сегодня — замок снят подтверждением, не датой.
    assert legs_of(secondment)["DETACHED"].date_end == TODAY + timedelta(days=1)
    assert try_create().pk is not None


def test_confirm_without_request_422(types, home, host):
    secondment = initiate(employee_in(home), host)
    with pytest.raises(DomainError) as exc:
        confirm(secondment)
    assert exc.value.http_status == 422
    assert exc.value.code == "INVALID_LIFECYCLE_TRANSITION"
    # Ноги не тронуты: одностороннего рукопожатия не бывает.
    for leg in legs_of(secondment).values():
        assert leg.date_end == END
        assert leg.cancelled_at is None
    assert Secondment.objects.get(pk=secondment.pk).return_confirmed_at is None


def test_double_confirm_422_and_first_fact_survives(types, home, host):
    secondment = initiate(employee_in(home), host)
    request_(secondment)
    first = confirm(secondment)
    with pytest.raises(DomainError) as exc:
        confirm(secondment, actor="99")
    assert exc.value.http_status == 422
    from_db = Secondment.objects.get(pk=secondment.pk)
    assert from_db.return_confirmed_by == RETURNER
    assert from_db.return_confirmed_at == first.return_confirmed_at


def test_request_after_confirm_422(types, home, host):
    secondment = initiate(employee_in(home), host)
    request_(secondment)
    confirm(secondment)
    with pytest.raises(DomainError) as exc:
        request_(secondment, actor="99")
    assert exc.value.http_status == 422


@pytest.mark.parametrize("actor", ["", "   ", None])
def test_confirm_requires_actor(types, home, host, actor):
    secondment = initiate(employee_in(home), host)
    request_(secondment)
    with pytest.raises(DomainError) as exc:
        confirm(secondment, actor=actor)
    assert exc.value.http_status == 400
    assert Secondment.objects.get(pk=secondment.pk).return_confirmed_at is None
    for leg in legs_of(secondment).values():
        assert leg.date_end == END


def test_confirm_skips_already_closed_leg(types, home, host):
    # Одна нога закрыта заранее (сосед по операции): подтверждение доводит
    # вторую и не падает на первой.
    from organization_management.apps.operations.status_service import (
        complete_status_early,
    )

    employee = employee_in(home)
    secondment = initiate(employee, host, date_start=TODAY - timedelta(days=3))
    with clock.override(TODAY):
        complete_status_early(
            secondment.out_status, actor=ACTOR, actual_end=TODAY - timedelta(days=1)
        )
    request_(secondment)
    confirm(secondment)
    legs = legs_of(secondment)
    # Ранее закрытая нога сохранила СВОЮ дату — подтверждение её не переписало.
    assert legs["DETACHED"].date_end == TODAY - timedelta(days=1)
    assert legs["ATTACHED"].date_end == TODAY + timedelta(days=1)
    assert Secondment.objects.get(pk=secondment.pk).return_confirmed_at is not None


def test_missing_secondment_404(types, home, host):
    secondment = initiate(employee_in(home), host)
    Secondment.objects.filter(pk=secondment.pk).delete()
    with pytest.raises(DomainError) as exc:
        request_(secondment)
    assert exc.value.http_status == 404
    assert exc.value.code == "ENTITY_NOT_FOUND"


# ── Гарантии БД (в обход сервиса) ────────────────────────────────────────

def test_db_rejects_confirm_without_request(types, home, host):
    secondment = initiate(employee_in(home), host)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Secondment.objects.filter(pk=secondment.pk).update(
                return_confirmed_at=clock.Clock.now(), return_confirmed_by=RETURNER
            )


@pytest.mark.parametrize(
    "fields",
    [
        {"return_requested_at": None, "return_requested_by": RETURNER},
        {"return_requested_by": None},
        {"return_requested_by": ""},
    ],
)
def test_db_rejects_half_written_request_fact(types, home, host, fields):
    # «Когда» без «кто» (и наоборот) — след, по которому уже не спросить, кто
    # принял решение. Пустая строка закрыта явно: она не NULL.
    secondment = initiate(employee_in(home), host)
    request_(secondment)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Secondment.objects.filter(pk=secondment.pk).update(**fields)
