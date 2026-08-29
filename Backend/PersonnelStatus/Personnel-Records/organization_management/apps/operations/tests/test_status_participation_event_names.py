"""Участие статуса называет МЕРОПРИЯТИЕ, а не только его id (Plane №281).

С Ш-3 статус хранит связь с конкретными ОМ (`ops_status_participations`), но
наружу ехал плоский `event_id`. Клиенту этого не хватало на самый простой
вопрос — «на каком мероприятии человек занят»: чтобы назвать ОМ и увести на
его карточку, нужны код и название, и без них экран показывал общую ссылку на
разрез «Сбор сил» вместо адреса.

Пробы держат три вещи:
  1) код и название ОМ едут вместе с участием;
  2) удалённое мероприятие даёт ПУСТО, а не выдуманное имя и не 500 — ссылка
     плоская, строка участия переживает удаление ОМ;
  3) имена берутся ОДНИМ запросом на ответ, сколько бы строк в нём ни было:
     иначе страница расхода в 500 строк превратилась бы в 500 запросов.
"""
import datetime as dt

import pytest
from django.test.utils import CaptureQueriesContext
from django.db import connection

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_status import (
    OpsStatusParticipation,
)
from organization_management.apps.operations.status_service import create_status
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.operations.tests.test_status_participation import (
    participation_catalog,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

URL = "/api/operations/statuses/"


def make_event(code, title):
    """Минимальное живое ОМ.

    Списковые поля перечислены явно: у части из них `null=False` без значения
    по умолчанию, и «создать ОМ одними обязательными» падает IntegrityError —
    фикстура молчала бы о причине. Набор тот же, что у соседних проб раздела
    (`apps/ops/tests`).
    """
    return OpsSecurityEvent.objects.create(
        code=code,
        title=title,
        object_name="Резиденция",
        business_date=TODAY,
        stage=OpsSecurityEvent.Stage.BULLETIN,
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Шитов",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


def seed_status(employee, events):
    with clock.override(TODAY):
        return create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY,
            date_end=TODAY + dt.timedelta(days=1),
            actor="user:probe",
            participations=[
                {"event_id": event.id, "kind_code": "PHYSICAL_SQUAD"}
                for event in events
            ],
        )


def reader():
    api, _user = client_for("participation-reader", "ADMIN", ["*"])
    return api


def rows_of(response):
    body = response.json()
    return body["results"] if isinstance(body, dict) else body


def test_participation_carries_event_code_and_title(
    types, division, participation_catalog  # noqa: F811
):
    employee = make_employee(division)
    event = make_event("ОМ-2026-10", "Визит делегации")
    seed_status(employee, [event])

    response = reader().get(URL, {"employee_id": employee.id})

    assert response.status_code == 200, response.content
    participations = rows_of(response)[0]["participations"]
    assert [
        (row["event_id"], row["event_code"], row["event_title"])
        for row in participations
    ] == [(event.id, "ОМ-2026-10", "Визит делегации")]


def test_a_deleted_event_leaves_the_name_empty(
    types, division, participation_catalog  # noqa: F811
):
    """Мероприятия нет — участие остаётся, имя пустое, ответ не падает."""
    employee = make_employee(division)
    event = make_event("ОМ-2026-11", "Снятое мероприятие")
    seed_status(employee, [event])
    event_id = event.id
    event.delete()

    response = reader().get(URL, {"employee_id": employee.id})

    assert response.status_code == 200, response.content
    participations = rows_of(response)[0]["participations"]
    assert participations[0]["event_id"] == event_id
    assert participations[0]["event_code"] == ""
    assert participations[0]["event_title"] == ""
    assert OpsStatusParticipation.objects.count() == 1


def test_names_cost_one_query_no_matter_how_many_rows(
    types, division, participation_catalog  # noqa: F811
):
    """Три сотрудника, у каждого СВОЁ ОМ — один запрос за мероприятиями.

    Считаются ИМЕННО запросы к `ops_security_events`, а не все подряд: общее
    число запросов ответа зависит от прав, области видимости и страницы, и
    проба по нему стерегла бы что угодно, кроме своего предмета (первая
    редакция так и краснела на постороннем +1).
    """
    # У КАЖДОГО сотрудника СВОЁ мероприятие — это худший случай и он же
    # единственный честный: на общих ОМ «один запрос» держалось бы не на
    # предварительном сборе, а на том, что первая же строка вытянула все
    # имена сразу.
    for index in range(3):
        event = make_event(f"ОМ-2026-2{index}", f"Мероприятие {index}")
        seed_status(make_employee(division), [event])

    api = reader()
    with CaptureQueriesContext(connection) as queries:
        assert api.get(URL).status_code == 200

    asked_for_events = [
        query["sql"] for query in queries if "ops_security_events" in query["sql"]
    ]
    assert len(asked_for_events) == 1, (
        f"мероприятия спрошены {len(asked_for_events)} раз(а) — при трёх "
        f"разных ОМ это построчный запрос:\n" + "\n".join(asked_for_events)
    )
