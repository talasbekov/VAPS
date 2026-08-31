"""Участие не переживает своё мероприятие дольше уборки (Plane №346).

ЧТО СТЕРЕГУТ ЭТИ ПРОБЫ. Ссылка участия на ОМ плоская, каскада нет — и это
намеренно (раздел статусов не зависит от таблицы мероприятий). Плата: удалив
ОМ, мы оставляем участия ссылаться в пустоту. На стенде их накопилось 1135 при
14 живых, проба `tables-data.spec.ts:289` краснела каждым полным прогоном, а
`seed_expense_chain` отступал перед сиротой как перед живым статусом — годного
участия на стенде не появлялось вовсе.

ГРАНИЦА, которую уборка не имеет права перейти, и ради которой половина проб:
статус сносится ТОЛЬКО если он держался сиротами целиком. Статус с живым
участием и статус вовсе без участий (так заводит фикстуры
`seed_smoke_fixtures._assignments`) обязаны пережить уборку.
"""
import datetime as dt

import pytest

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.status_cleanup import (
    find_orphan_participations,
    purge_orphan_participations,
)
from organization_management.apps.operations.status_service import create_status
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.operations.tests.test_status_participation import (
    participation_catalog,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.operations.tests.test_status_participation_event_names import (
    make_event,
)

pytestmark = pytest.mark.django_db


def seed_status(employee, events, start_offset=0):
    """Статус с участиями в перечисленных ОМ; без событий — статус без участий."""
    start = TODAY + dt.timedelta(days=start_offset)
    with clock.override(TODAY):
        return create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=start,
            date_end=start + dt.timedelta(days=1),
            actor="user:probe",
            participations=[
                {"event_id": event.id, "kind_code": "PHYSICAL_SQUAD"}
                for event in events
            ],
        )


def test_the_orphan_is_found_and_the_live_one_is_not(
    types, division, participation_catalog  # noqa: F811
):
    """Сиротой считается участие на НЕСУЩЕСТВУЮЩЕМ ОМ — и только оно."""
    employee = make_employee(division)
    alive = make_event("ОМ-2026-40", "Живое")
    doomed = make_event("ОМ-2026-41", "Снесённое")
    seed_status(employee, [alive])
    seed_status(employee, [doomed], start_offset=2)
    # id запоминается ДО удаления: Django обнуляет `pk` у объекта в памяти, и
    # сравнение с `doomed.id` после `delete()` читало бы None.
    doomed_id = doomed.id
    doomed.delete()

    found = list(find_orphan_participations())

    assert [row.event_id for row in found] == [doomed_id]


def test_the_cleanup_takes_the_orphan_and_the_status_it_alone_held(
    types, division, participation_catalog  # noqa: F811
):
    """Статус, державшийся ТОЛЬКО сиротой, уходит вместе с ней.

    Это и есть половина дефекта: не строка участия мешала стенду, а статус над
    ней — он занимал день сотрудника, и сид отступал перед ним.
    """
    employee = make_employee(division)
    doomed = make_event("ОМ-2026-42", "Снесённое")
    status = seed_status(employee, [doomed])
    doomed.delete()

    result = purge_orphan_participations()

    assert (result.participations, result.statuses) == (1, 1)
    assert not OpsStatusParticipation.objects.filter(status_id=status.id).exists()
    assert not OpsEmployeeStatus.objects.filter(id=status.id).exists()


def test_a_status_with_a_live_participation_survives(
    types, division, participation_catalog  # noqa: F811
):
    """Одно участие сиротское, второе живое — статус остаётся целым.

    Мутация «сносить статус, у которого пропало хоть одно участие» краснит
    именно здесь: человек занят на живом ОМ, и стереть его день значило бы
    выдумать, что он свободен.
    """
    employee = make_employee(division)
    alive = make_event("ОМ-2026-43", "Живое")
    doomed = make_event("ОМ-2026-44", "Снесённое")
    status = seed_status(employee, [alive, doomed])
    doomed.delete()

    result = purge_orphan_participations()

    assert (result.participations, result.statuses) == (1, 0)
    assert OpsEmployeeStatus.objects.filter(id=status.id).exists()
    assert [
        row.event_id
        for row in OpsStatusParticipation.objects.filter(status_id=status.id)
    ] == [alive.id]


def test_a_status_without_participations_is_left_alone(
    types, division, participation_catalog  # noqa: F811
):
    """Статус без участий вовсе — законная строка, а не мусор.

    Так заводит привлечённых `seed_smoke_fixtures._assignments`, и уборка
    «статусов без участий» снесла бы фикстуру, которую смоук же и проверяет.
    """
    employee = make_employee(division)
    status = seed_status(employee, [])

    result = purge_orphan_participations()

    assert (result.participations, result.statuses) == (0, 0)
    assert OpsEmployeeStatus.objects.filter(id=status.id).exists()


def test_the_scope_limits_the_cleanup_to_the_named_events(
    types, division, participation_catalog  # noqa: F811
):
    """Уборка после удаления трогает СВОИ мероприятия, а не весь мусор базы.

    Иначе команда, снявшая одно пробное ОМ, попутно и молча вычистила бы
    чужое накопленное — а это решение заказчика, а не побочный эффект.
    """
    employee = make_employee(division)
    mine = make_event("ОМ-2026-45", "Моё снесённое")
    stranger = make_event("ОМ-2026-46", "Чужое снесённое")
    seed_status(employee, [mine])
    seed_status(employee, [stranger], start_offset=2)
    mine_id, stranger_id = mine.id, stranger.id
    mine.delete()
    stranger.delete()

    result = purge_orphan_participations([mine_id])

    assert (result.participations, result.statuses) == (1, 1)
    assert [row.event_id for row in OpsStatusParticipation.objects.all()] == [
        stranger_id
    ]
