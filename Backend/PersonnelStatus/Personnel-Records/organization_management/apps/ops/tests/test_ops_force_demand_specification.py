"""Сквозной контракт строк потребности и ответа сбора сил (Plane №979)."""

import pytest
from types import SimpleNamespace

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.security_events import _demand_rows_of, event_force_need

from .test_ops_forces_gathering import (
    allocated_event,
    event_on_demand,
    event_pk,
    make_department,
    make_directorate,
)
from .test_ops_security_events_api import manager  # noqa: F401


pytestmark = pytest.mark.django_db


def test_recon_posts_become_typed_demand_rows_and_groups_are_extra():
    rows = _demand_rows_of(
        [
            {
                "id": "post-1",
                "sector": "Периметр",
                "post": "Пост №1",
                "task": "Охрана",
                "need": 4,
                "shift": "08:00–20:00",
                "requirements": "Допуск №2",
                "visitObjectId": "17",
                "demandKindCode": "PHYSICAL_SQUAD",
                "demandSpecification": "Сотрудники наружных постов",
            },
            {
                "id": "post-2",
                "sector": "КПП",
                "post": "Зона досмотра",
                "task": "Досмотр",
                "need": 2,
                "shift": "09:00–18:00",
                "requirements": "Ручной металлодетектор",
                "visitObjectId": "17",
                "demandKindCode": "SCREENING_GROUP",
                "demandSpecification": "Две группы по два сотрудника",
            },
        ]
    )

    assert rows == [
        {
            "id": "demand-post-1",
            "sourcePostId": "post-1",
            "visitObjectId": "17",
            "sector": "Периметр",
            "task": "Охрана",
            "place": "Периметр · Пост №1",
            "shift": "08:00–20:00",
            "need": 4,
            "kindCode": "PHYSICAL_SQUAD",
            "specification": "Сотрудники наружных постов",
            "requirements": "Допуск №2",
            "comment": "",
        },
        {
            "id": "demand-post-2",
            "sourcePostId": "post-2",
            "visitObjectId": "17",
            "sector": "КПП",
            "task": "Досмотр",
            "place": "КПП · Зона досмотра",
            "shift": "09:00–18:00",
            "need": 2,
            "kindCode": "SCREENING_GROUP",
            "specification": "Две группы по два сотрудника",
            "requirements": "Ручной металлодетектор",
            "comment": "",
        },
    ]
    event = SimpleNamespace(
        recon_sector_posts=[
            {"need": 4, "demandKindCode": "PHYSICAL_SQUAD"},
            {"need": 2, "demandKindCode": "SCREENING_GROUP"},
        ],
        visit_objects=SimpleNamespace(all=lambda: []),
    )
    assert event_force_need(event) == 4


def test_allocation_carries_selected_group_demands_and_department_group_answer(manager):  # noqa: F811
    department = make_department("Департамент А")
    base, total = event_on_demand(manager)
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    event.demand_rows = [
        *event.demand_rows,
        {
            "id": "demand-screening",
            "sourcePostId": "post-screening",
            "visitObjectId": "17",
            "sector": "КПП",
            "task": "Досмотр",
            "place": "КПП · Зона досмотра",
            "shift": "09:00–18:00",
            "need": 2,
            "kindCode": "SCREENING_GROUP",
            "specification": "Группа досмотра",
            "requirements": "Металлодетектор",
            "comment": "",
        },
    ]
    event.save(update_fields=["demand_rows"])

    sent = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {
                    "departmentId": str(department.pk),
                    "need": total,
                    "groupDemandIds": ["demand-screening"],
                }
            ]
        },
        format="json",
    )

    assert sent.status_code == 200, sent.data
    allocation = sent.json()["forceAllocation"][0]
    allocation_id = allocation["id"]
    assert [row["id"] for row in allocation["groupDemands"]] == ["demand-screening"]

    answered = manager.post(
        f"{base}forces/allocation/{allocation_id}/respond/",
        {
            "allocating": total - 1,
            "comment": "Физнаряд меньше запроса",
            "groupOffers": [
                {
                    "demandRowId": "demand-screening",
                    "kindCode": "SCREENING_GROUP",
                    "count": 1,
                    "place": "КПП · Зона досмотра",
                    "specification": "Своя группа с металлодетектором",
                    "comment": "Вторая группа занята",
                }
            ],
        },
        format="json",
    )

    assert answered.status_code == 200, answered.data
    row = answered.json()["forceAllocation"][0]
    assert row["allocating"] == total - 1
    assert row["groupOffers"] == [
        {
            "demandRowId": "demand-screening",
            "kindCode": "SCREENING_GROUP",
            "count": 1,
            "place": "КПП · Зона досмотра",
            "specification": "Своя группа с металлодетектором",
            "comment": "Вторая группа занята",
        }
    ]


def test_group_demands_are_visible_in_department_and_directorate_projections(manager):  # noqa: F811
    from organization_management.apps.ops.forces_requests import _directorate_row_view
    from organization_management.apps.ops.security_events import department_requests_view

    department = make_department("Департамент А")
    base, _allocation_id = allocated_event(manager, department)
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    demand = {
        "id": "demand-canine",
        "kindCode": "CANINE_GROUP",
        "need": 1,
        "place": "Главный вход",
        "specification": "Кинолог с собакой",
        "requirements": "Допуск на объект",
        "shift": "08:00–18:00",
    }
    event.force_allocation = [
        {
            **event.force_allocation[0],
            "groupDemands": [demand],
            "directorates": [
                {
                    "divisionId": "71",
                    "name": "Управление А-1",
                    "need": 2,
                    "assigned": 0,
                    "notifiedAt": "2026-09-09T10:00:00+00:00",
                    "groupDemandIds": ["demand-canine"],
                }
            ],
        }
    ]
    event.save(update_fields=["force_allocation"])

    department_row = department_requests_view(None)[0]
    assert department_row["groupDemands"] == [demand]
    directorate_row = _directorate_row_view(
        event,
        event.force_allocation[0],
        event.force_allocation[0]["directorates"],
        event.force_allocation[0]["id"],
    )
    assert directorate_row["groupDemands"] == [demand]


def test_department_assigns_a_group_to_a_directorate_without_a_physical_quota(manager):  # noqa: F811
    department = make_department("Департамент А")
    directorate = make_directorate(department, "Управление спецгрупп")
    base, total = event_on_demand(manager)
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    demand = {
        "id": "demand-canine",
        "kindCode": "CANINE_GROUP",
        "need": 1,
        "place": "Главный вход",
        "specification": "Кинолог с собакой",
        "requirements": "Допуск на объект",
        "shift": "08:00–18:00",
    }
    event.demand_rows = [*event.demand_rows, demand]
    event.save(update_fields=["demand_rows"])
    allocation = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {
                    "departmentId": str(department.pk),
                    "need": total,
                    "groupDemandIds": [demand["id"]],
                }
            ]
        },
        format="json",
    ).json()["forceAllocation"][0]

    split = manager.post(
        f"{base}forces/allocation/{allocation['id']}/split/",
        {
            "rows": [
                {
                    "divisionId": str(directorate.pk),
                    "need": 0,
                    "groupDemandIds": [demand["id"]],
                }
            ]
        },
        format="json",
    )
    assert split.status_code == 200, split.data
    row = split.json()["forceAllocation"][0]["directorates"][0]
    assert row["need"] == 0
    assert row["groupDemandIds"] == [demand["id"]]

    notified = manager.post(
        f"{base}forces/allocation/{allocation['id']}/notify/", {}, format="json"
    )
    assert notified.status_code == 200, notified.data
    row = notified.json()["forceAllocation"][0]["directorates"][0]
    assert row["notifiedAt"] is not None
    assert row["groupDemandIds"] == [demand["id"]]


def test_one_group_demand_cannot_be_sent_to_two_departments(manager):  # noqa: F811
    first = make_department("Департамент А")
    second = make_department("Департамент Б")
    base, total = event_on_demand(manager)
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    demand = {
        "id": "demand-screening",
        "kindCode": "SCREENING_GROUP",
        "need": 1,
        "place": "КПП",
    }
    event.demand_rows = [*event.demand_rows, demand]
    event.save(update_fields=["demand_rows"])

    response = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {
                    "departmentId": str(first.pk),
                    "need": total,
                    "groupDemandIds": [demand["id"]],
                },
                {
                    "departmentId": str(second.pk),
                    "need": total,
                    "groupDemandIds": [demand["id"]],
                },
            ]
        },
        format="json",
    )

    assert response.status_code == 400


def test_partial_directorate_split_cannot_duplicate_a_saved_group(manager):  # noqa: F811
    department = make_department("Департамент А")
    first = make_directorate(department, "Управление А-1")
    second = make_directorate(department, "Управление А-2")
    base, total = event_on_demand(manager)
    event = OpsSecurityEvent.objects.get(pk=event_pk(base))
    demand = {
        "id": "demand-canine",
        "kindCode": "CANINE_GROUP",
        "need": 1,
        "place": "Главный вход",
    }
    event.demand_rows = [*event.demand_rows, demand]
    event.save(update_fields=["demand_rows"])
    allocation = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {
                    "departmentId": str(department.pk),
                    "need": total,
                    "groupDemandIds": [demand["id"]],
                }
            ]
        },
        format="json",
    ).json()["forceAllocation"][0]
    split_url = f"{base}forces/allocation/{allocation['id']}/split/"
    first_response = manager.post(
        split_url,
        {
            "rows": [
                {
                    "divisionId": str(first.pk),
                    "need": 0,
                    "groupDemandIds": [demand["id"]],
                }
            ]
        },
        format="json",
    )
    assert first_response.status_code == 200

    duplicate = manager.post(
        split_url,
        {
            "rows": [
                {
                    "divisionId": str(second.pk),
                    "need": 0,
                    "groupDemandIds": [demand["id"]],
                }
            ]
        },
        format="json",
    )

    assert duplicate.status_code == 400
