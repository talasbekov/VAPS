"""Общий пул нескольких ОМ и распределение Штабом (Plane №978)."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from organization_management.apps.operations.models_event import OpsSecurityEvent

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)
from .test_ops_forces_gathering import make_assignment_status_type
from organization_management.apps.ops import security_events as event_service

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/forces/campaigns/"


@pytest.fixture
def jwt_manager(manager):  # noqa: F811
    api = APIClient()
    user = get_user_model().objects.get(username="ev-manager")
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    return api


def _auto_request(requested):
    return {
        "id": "custom-auto-request", "group": event_service.AUTO_FORCE_REQUEST_GROUP,
        "requestedCount": requested, "allocatedCount": 0, "status": "SENT",
        "comment": "Сохранённый комментарий", "custom": {"keep": True},
    }


def _event(manager, *, code, date):  # noqa: F811
    response = manager.post(
        "/api/ops/security-events/",
        {
            "title": f"Мероприятие {code}",
            "businessDate": date,
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert response.status_code == 201, getattr(response, "data", response.content)
    return OpsSecurityEvent.objects.get(pk=response.json()["id"])


def test_hq_creates_a_campaign_over_several_events_and_sees_one_pool(manager):  # noqa: F811
    first = _event(manager, code="A", date="2026-09-12")
    second = _event(manager, code="B", date="2026-09-13")
    first_person = make_employee(last_name="Первов", first_name="Пул")
    second_person = make_employee(last_name="Второв", first_name="Пул")
    first.force_roster = [{"employeeId": str(first_person.pk), "employeeName": "Первов Пул"}]
    second.force_roster = [{"employeeId": str(second_person.pk), "name": "Второв Пул"}]
    first.save(update_fields=["force_roster", "updated_at"])
    second.save(update_fields=["force_roster", "updated_at"])

    response = manager.post(
        URL,
        {
            "title": "Распределение на визиты 12–13 сентября",
            "eventIds": [str(first.pk), str(second.pk)],
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    body = response.json()
    assert body["status"] == "DRAFT"
    assert {row["eventId"] for row in body["events"]} == {str(first.pk), str(second.pk)}
    assert {row["employeeId"] for row in body["pool"]} == {
        str(first_person.pk),
        str(second_person.pk),
    }
    assert {row["employeeName"] for row in body["pool"]} == {"Первов Пул", "Второв Пул"}
    assert {row["eventId"] for row in body["warnings"]} == {str(first.pk), str(second.pk)}

    listing = manager.get(URL)
    assert listing.status_code == 200, listing.data
    assert listing.json()["results"][0]["id"] == body["id"]

    detail = manager.get(f"{URL}{body['id']}/")
    assert detail.status_code == 200, detail.data
    assert detail.json() == body

    first.force_roster = []
    second.force_roster = []
    first.save(update_fields=["force_roster", "updated_at"])
    second.save(update_fields=["force_roster", "updated_at"])
    stable_detail = manager.get(f"{URL}{body['id']}/")
    assert {row["employeeId"] for row in stable_detail.json()["pool"]} == {
        str(first_person.pk),
        str(second_person.pk),
    }


def test_campaign_requires_a_title_and_at_least_one_event(manager):  # noqa: F811
    response = manager.post(URL, {"title": " ", "eventIds": []}, format="json")

    assert response.status_code == 400
    assert "title" in response.json()["details"]


def test_hq_assigns_a_pooled_employee_to_event_object_and_demand_row(manager):  # noqa: F811
    from organization_management.apps.operations.models_status import OpsEmployeeStatus
    source = _event(manager, code="SOURCE", date="2026-09-12")
    target_object = make_object(code="OBJ-TARGET", name="Целевой объект")
    target_response = create_event(
        manager,
        target_object,
        title="Целевое мероприятие",
        business_date="2026-09-13",
    )
    assert target_response.status_code == 201, target_response.data
    target = OpsSecurityEvent.objects.get(pk=target_response.json()["id"])
    visit = target.visit_objects.get()
    target.demand_rows = [
        {
            "id": "demand-main-gate",
            "visitObjectId": str(visit.pk),
            "kindCode": "PHYSICAL_SQUAD",
            "place": "Главный вход",
            "need": 1,
        }
    ]
    target.save(update_fields=["demand_rows", "updated_at"])
    person = make_employee(last_name="Распределяемов", first_name="Сотрудник")
    make_assignment_status_type()
    source.force_roster = [
        {"employeeId": str(person.pk), "employeeName": "Распределяемов Сотрудник"}
    ]
    source.save(update_fields=["force_roster", "updated_at"])
    campaign = manager.post(
        URL,
        {"title": "Общий пул", "eventIds": [str(source.pk), str(target.pk)]},
        format="json",
    ).json()

    response = manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {
            "employeeId": str(person.pk),
            "eventId": str(target.pk),
            "visitObjectId": str(visit.pk),
            "demandRowId": "demand-main-gate",
        },
        format="json",
    )

    assert response.status_code == 201, getattr(response, "data", response.content)
    body = response.json()
    assert body["status"] == "DISTRIBUTING"
    assert body["assignments"] == [
        {
            "id": body["assignments"][0]["id"],
            "employeeId": str(person.pk),
            "employeeName": "Распределяемов Сотрудник",
            "eventId": str(target.pk),
            "visitObjectId": str(visit.pk),
            "demandRowId": "demand-main-gate",
            "kindCode": "PHYSICAL_SQUAD",
            "overrideReason": "",
        }
    ]
    final_status = OpsEmployeeStatus.objects.get(employee_id=person.pk)
    participation = final_status.participations.get()
    assert participation.event_id == target.pk
    assert participation.kind_code == "PHYSICAL_SQUAD"


def test_time_overlap_needs_an_explicit_override_reason(manager):  # noqa: F811
    make_assignment_status_type()
    source = _event(manager, code="POOL", date="2026-09-11")
    person = make_employee(last_name="Конфликтов", first_name="Сотрудник")
    source.force_roster = [{"employeeId": str(person.pk), "employeeName": "Конфликтов Сотрудник"}]
    source.save(update_fields=["force_roster", "updated_at"])
    targets = []
    for suffix in ("ONE", "TWO"):
        obj = make_object(code=f"OBJ-{suffix}", name=f"Объект {suffix}")
        response = create_event(
            manager,
            obj,
            title=f"ОМ {suffix}",
            business_date="2026-09-13",
            eventTime="10:00",
        )
        event = OpsSecurityEvent.objects.get(pk=response.json()["id"])
        visit = event.visit_objects.get()
        event.demand_rows = [
            {
                "id": f"demand-{suffix.lower()}",
                "visitObjectId": str(visit.pk),
                "kindCode": "PHYSICAL_SQUAD",
                "need": 1,
            }
        ]
        event.save(update_fields=["demand_rows", "updated_at"])
        targets.append((event, visit))
    campaign = manager.post(
        URL,
        {"title": "Перекрытие", "eventIds": [str(source.pk), *(str(row[0].pk) for row in targets)]},
        format="json",
    ).json()

    def assign(event, visit, **extra):
        return manager.post(
            f"{URL}{campaign['id']}/assignments/",
            {
                "employeeId": str(person.pk),
                "eventId": str(event.pk),
                "visitObjectId": str(visit.pk),
                "demandRowId": event.demand_rows[0]["id"],
                **extra,
            },
            format="json",
        )

    assert assign(*targets[0]).status_code == 201
    conflict = assign(*targets[1])
    assert conflict.status_code == 422
    assert conflict.json()["error_code"] == "FORCE_CAMPAIGN_TIME_CONFLICT"

    missing_reason = assign(*targets[1], overrideConflict=True)
    assert missing_reason.status_code == 400
    assert "overrideReason" in missing_reason.json()["details"]

    overridden = assign(
        *targets[1], overrideConflict=True, overrideReason="Разрешено начальником штаба"
    )
    assert overridden.status_code == 201
    assert overridden.json()["assignments"][-1]["overrideReason"] == "Разрешено начальником штаба"


@pytest.mark.parametrize("same_event", [True, False])
def test_handover_refuses_a_published_positive_need_visit_without_any_assignment(manager, same_event):
    """№1106: комментарий о недоборе не разрешает полностью пустой объект."""
    from organization_management.apps.operations.models_forces import OpsForceCampaign

    make_assignment_status_type()
    first_data = create_event(manager, make_object(code="FIRST-1106"), business_date="2026-09-14").json()
    first = OpsSecurityEvent.objects.get(pk=first_data["id"])
    first_visit = first.visit_objects.get()
    if same_event:
        missing_event = first
        missing_visit = first.visit_objects.create(
            security_object=make_object(code="MISSING-1106"),
            object_name="Неукомплектованный объект №1106", position=1,
        )
    else:
        data = create_event(manager, make_object(code="MISSING-1106", name="Неукомплектованный объект №1106"), business_date="2026-09-15").json()
        missing_event = OpsSecurityEvent.objects.get(pk=data["id"])
        missing_visit = missing_event.visit_objects.get()
    events = {first.pk: first, missing_event.pk: missing_event}
    for event in events.values():
        event.visit_objects.update(stage="PLACEMENT")
        event.stage = "PLACEMENT"
        event.demand_rows = [
            {"id": f"demand-{visit.pk}", "visitObjectId": str(visit.pk), "kindCode": "PHYSICAL_SQUAD", "need": 2}
            for visit in event.visit_objects.all()
        ]
        event.save(update_fields=["stage", "demand_rows", "updated_at"])
    person = make_employee(last_name="Проверка1106", first_name="Резерв")
    first.force_roster = [{"employeeId": str(person.pk), "employeeName": "Проверка1106 Резерв"}]
    first.save(update_fields=["force_roster", "updated_at"])
    campaign = manager.post(URL, {"title": "Проверка №1106", "eventIds": [str(pk) for pk in events]}, format="json").json()
    assigned = manager.post(f"{URL}{campaign['id']}/assignments/", {
        "employeeId": str(person.pk), "eventId": str(first.pk),
        "visitObjectId": str(first_visit.pk), "demandRowId": f"demand-{first_visit.pk}",
    }, format="json")
    assert assigned.status_code == 201, assigned.json()
    before = {pk: (event.force_roster, event.force_handover) for pk, event in events.items()}
    response = manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Недобор объяснён, но один объект совсем пуст"}, format="json")
    assert response.status_code == 422, response.json()
    assert response.json()["error_code"] == "FORCE_VISIT_UNSTAFFED"
    assert missing_event.code in response.json()["message"]
    assert missing_visit.object_name in response.json()["message"]
    for pk, event in events.items():
        event.refresh_from_db()
        assert (event.force_roster, event.force_handover) == before[pk]
    persisted_campaign = OpsForceCampaign.objects.get(pk=campaign["id"])
    assert persisted_campaign.status == "DISTRIBUTING"
    assert not persisted_campaign.handovers.exists()


def test_handover_allows_explained_shortage_when_each_positive_need_visit_has_a_person(manager, jwt_manager):
    make_assignment_status_type()
    event = OpsSecurityEvent.objects.get(pk=create_event(manager, make_object(code="PARTIAL-1106")).json()["id"])
    visit = event.visit_objects.get()
    event.visit_objects.create(security_object=make_object(code="ZERO-1106"), object_name="Объект без потребности", position=1)
    event.stage = "PLACEMENT"
    event.visit_objects.update(stage="PLACEMENT")
    event.demand_rows = [{"id": "partial-demand", "visitObjectId": str(visit.pk), "kindCode": "PHYSICAL_SQUAD", "need": 2}]
    people = [make_employee(last_name="Неполный1106", first_name=name) for name in ["Назначен", "Резерв"]]
    event.force_roster = [{"employeeId": str(person.pk), "employeeName": str(person)} for person in people]
    event.force_requests = [_auto_request(2)]
    event.save(update_fields=["stage", "demand_rows", "force_roster", "force_requests", "updated_at"])
    campaign = manager.post(URL, {"title": "Объяснённый недобор", "eventIds": [str(event.pk)]}, format="json").json()
    assigned = manager.post(f"{URL}{campaign['id']}/assignments/", {
        "employeeId": str(people[0].pk), "eventId": str(event.pk),
        "visitObjectId": str(visit.pk), "demandRowId": "partial-demand",
    }, format="json")
    assert assigned.status_code == 201, assigned.json()
    missing_comment = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {}, format="json")
    assert missing_comment.status_code == 400
    response = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Второе место ожидает усиления"}, format="json")
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "HANDED_OVER"
    event.refresh_from_db()
    assert len(event.force_roster) == 1
    assert event.force_handover["comment"] == "Второе место ожидает усиления"
    assert event.force_requests == [{**_auto_request(2), "allocatedCount": 1, "status": "PARTIALLY_ALLOCATED"}]


def test_handover_projects_assignments_to_event_rosters_and_locks_campaign(manager, jwt_manager):  # noqa: F811
    make_assignment_status_type()
    source = _event(manager, code="HANDOVER-POOL", date="2026-09-11")
    obj = make_object(code="OBJ-HANDOVER", name="Объект передачи")
    target_response = create_event(
        manager, obj, title="ОМ передачи", business_date="2026-09-14"
    )
    target = OpsSecurityEvent.objects.get(pk=target_response.json()["id"])
    visit = target.visit_objects.get()
    target.demand_rows = [
        {
            "id": "demand-handover",
            "visitObjectId": str(visit.pk),
            "kindCode": "PHYSICAL_SQUAD",
            "need": 1,
        }
    ]
    target.force_requests = [_auto_request(1)]
    target.save(update_fields=["demand_rows", "force_requests", "updated_at"])
    person = make_employee(last_name="Переданов", first_name="Сотрудник")
    source.force_roster = [{"employeeId": str(person.pk), "employeeName": "Переданов Сотрудник"}]
    source.save(update_fields=["force_roster", "updated_at"])
    campaign = manager.post(
        URL,
        {"title": "Передача", "eventIds": [str(source.pk), str(target.pk)]},
        format="json",
    ).json()
    assignment = manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {
            "employeeId": str(person.pk),
            "eventId": str(target.pk),
            "visitObjectId": str(visit.pk),
            "demandRowId": "demand-handover",
        },
        format="json",
    ).json()["assignments"][0]

    # Частично опубликованный объект можно собирать, но общую передачу ОМ
    # нельзя закрыть, пока соседний объект остаётся черновиком рекогносцировки.
    visit.stage = "PLACEMENT"
    visit.save(update_fields=["stage"])
    target.stage = "RECON"
    target.save(update_fields=["stage", "updated_at"])
    second = target.visit_objects.create(
        security_object=make_object(code="OBJ-HANDOVER-DRAFT", name="Черновой объект"),
        object_name="Черновой объект",
        position=2,
        stage="RECON",
    )
    blocked = jwt_manager.post(
        f"{URL}{campaign['id']}/hand-over/", {"comment": "Рано"}, format="json"
    )
    assert blocked.status_code == 422, blocked.content
    assert blocked.json()["error_code"] == "FORCE_OBJECTS_NOT_READY"
    target.refresh_from_db()
    assert target.force_handover == {}
    assert target.force_requests == [_auto_request(1)]
    second.stage = "PLACEMENT"
    second.save(update_fields=["stage"])
    target.stage = "PLACEMENT"
    target.save(update_fields=["stage", "updated_at"])

    response = jwt_manager.post(
        f"{URL}{campaign['id']}/hand-over/", {"comment": ""}, format="json"
    )

    assert response.status_code == 200, getattr(response, "data", response.content)
    assert response.json()["status"] == "HANDED_OVER"
    target.refresh_from_db()
    assert target.force_roster == [
        {
            "employeeId": str(person.pk),
            "employeeName": "Переданов Сотрудник",
            "visitObjectId": str(visit.pk),
            "demandRowId": "demand-handover",
            "campaignAssignmentId": assignment["id"],
            # Пин поправлен осознанно (Plane №1250): состав несёт вид участия и
            # специальность, чтобы расстановка отличала группу от физнаряда.
            "kindCode": "PHYSICAL_SQUAD",
            "roleCode": "",
        }
    ]
    assert target.force_handover["campaignId"] == campaign["id"]
    assert target.force_requests == [{**_auto_request(1), "allocatedCount": 1, "status": "ALLOCATED"}]

    # №1084: the campaign snapshot must also satisfy the placement API contract.
    detail = manager.get(f"/api/ops/security-events/{target.pk}/")
    assert detail.status_code == 200, detail.data
    member = detail.json()["forceRoster"][0]
    assert member["name"] == "Переданов Сотрудник"
    assert member["divisionName"] == ""
    assert member["departmentName"] == ""
    assert member["divisionId"] is None
    assert member["departmentId"] is None
    assert member["acceptedAt"] == target.force_handover["at"]
    assert member["visitObjectId"] == str(visit.pk)
    assert member["campaignAssignmentId"] == assignment["id"]

    locked = manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {
            "employeeId": str(person.pk),
            "eventId": str(target.pk),
            "visitObjectId": str(visit.pk),
            "demandRowId": "demand-handover",
        },
        format="json",
    )
    assert locked.status_code == 422
    assert locked.json()["error_code"] == "FORCE_CAMPAIGN_HANDED_OVER"


def _campaign_with_two_targets(manager, jwt_manager, *, extra_pool_member=False):  # noqa: F811
    make_assignment_status_type()
    people = [make_employee(last_name="Автосчёт", first_name=str(i)) for i in range(4 if extra_pool_member else 3)]
    targets = []
    for index in range(2):
        event = OpsSecurityEvent.objects.get(pk=create_event(
            manager, make_object(code=f"AUTO-COUNT-{index}"), business_date=f"2026-09-{20 + index}",
        ).json()["id"])
        visit = event.visit_objects.get()
        event.stage = "PLACEMENT"
        event.visit_objects.update(stage="PLACEMENT")
        event.demand_rows = [{"id": f"auto-demand-{index}", "visitObjectId": str(visit.pk), "kindCode": "PHYSICAL_SQUAD", "need": 2}]
        event.force_requests = [_auto_request(2)]
        event.force_roster = [{"employeeId": str(person.pk), "employeeName": str(person)} for person in people] if index == 0 else []
        event.save(update_fields=["stage", "demand_rows", "force_requests", "force_roster", "updated_at"])
        targets.append((event, visit))
    response = manager.post(URL, {"title": "Два независимых автосчёта", "eventIds": [str(event.pk) for event, _ in targets]}, format="json")
    assert response.status_code == 201, response.json()
    campaign = response.json()
    for index, person in enumerate(people[:3]):
        event, visit = targets[0 if index == 0 else 1]
        response = jwt_manager.post(f"{URL}{campaign['id']}/assignments/", {
            "employeeId": str(person.pk), "eventId": str(event.pk),
            "visitObjectId": str(visit.pk), "demandRowId": event.demand_rows[0]["id"],
        }, format="json")
        assert response.status_code == 201, response.json()
    return campaign, targets


def test_campaign_handover_counts_each_event_roster_instead_of_the_shared_pool(manager, jwt_manager):
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager)
    response = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Первому объекту выделен один человек"}, format="json")
    assert response.status_code == 200, response.json()
    for (event, _), accepted, status in zip(targets, [1, 2], ["PARTIALLY_ALLOCATED", "ALLOCATED"]):
        event.refresh_from_db()
        expected = [{**_auto_request(2), "allocatedCount": accepted, "status": status}]
        assert len(event.force_roster) == accepted
        assert event.force_requests == expected
        detail = jwt_manager.get(f"/api/ops/security-events/{event.pk}/")
        assert detail.status_code == 200, detail.json()
        assert detail.json()["forceRequests"] == expected


def test_rejected_second_event_handover_rolls_back_the_first_event_auto_count(manager, jwt_manager):
    from organization_management.apps.operations.models_forces import OpsForceCampaign, OpsForceCampaignHandover
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager)
    second = targets[1][0]
    second.force_handover = {"at": "2026-09-21T08:00:00Z", "by": "prior-writer"}
    second.save(update_fields=["force_handover", "updated_at"])
    before = list(OpsSecurityEvent.objects.filter(pk__in=[event.pk for event, _ in targets]).order_by("pk").values())
    response = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Недобор объяснён"}, format="json")
    assert response.status_code == 422, response.json()
    assert response.json()["error_code"] == "FORCE_HANDED_OVER"
    assert list(OpsSecurityEvent.objects.filter(pk__in=[event.pk for event, _ in targets]).order_by("pk").values()) == before
    assert OpsForceCampaign.objects.get(pk=campaign["id"]).status == "DISTRIBUTING"
    assert not OpsForceCampaignHandover.objects.filter(campaign_id=campaign["id"]).exists()


@pytest.mark.parametrize("requested,accepted,has_allocation,status", [
    (5, 0, False, "NOT_SENT"), (5, 0, True, "SENT"),
    (5, 2, True, "PARTIALLY_ALLOCATED"), (5, 5, True, "ALLOCATED"),
    (5, 6, True, "ALLOCATED"), (0, 1, True, "PARTIALLY_ALLOCATED"),
    (0, 0, False, "NOT_SENT"),
])
def test_existing_auto_sync_preserves_thresholds_and_unrelated_fields_without_queries(requested, accepted, has_allocation, status):
    raw = [_auto_request(requested)]
    before = deepcopy(raw)
    event = SimpleNamespace(force_requests=raw, force_roster=[{}] * accepted, force_allocation=[{}] if has_allocation else [])
    with CaptureQueriesContext(connection) as queries:
        event_service._sync_auto_force_request(event)
    assert len(queries) == 0
    assert raw == before
    assert event.force_requests == [{**before[0], "allocatedCount": accepted, "status": status}]


@pytest.mark.parametrize("requests", [
    [], [{**_auto_request(8), "group": "Ручная группа"}],
    [{**_auto_request(8), "group": event_service.AUTO_FORCE_REQUEST_GROUP + " "}],
    [_auto_request(8), _auto_request(9)],
    [_auto_request(8), {**_auto_request(9), "group": "Ручная группа"}],
])
def test_manual_multiple_or_nonexact_auto_rows_are_preserved_through_handover(manager, jwt_manager, requests):
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager)
    target = targets[0][0]
    target.force_requests = deepcopy(requests)
    target.save(update_fields=["force_requests", "updated_at"])
    response = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Частичный состав допустим"}, format="json")
    assert response.status_code == 200, response.json()
    target.refresh_from_db()
    assert target.force_requests == requests
    detail = jwt_manager.get(f"/api/ops/security-events/{target.pk}/")
    assert detail.status_code == 200, detail.json()
    assert detail.json()["forceRequests"] == requests


def _thread_jwt(api):
    client = APIClient()
    client.credentials(**api._credentials)
    return client


def _in_connection(callback):
    close_old_connections()
    try:
        return callback()
    finally:
        connections.close_all()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("automatic", [False, True])
def test_handover_preserves_a_concurrent_committed_request_update(manager, jwt_manager, automatic):
    """Pause at the old stale UPDATE or the new authoritative event SELECT.

    The ordinary JWT writer holds its event lock until handover reaches that
    point. It then commits before the statement executes. An unlocked event
    already materialized from assignment rows still contains the old values.
    """
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager)
    target = targets[0][0]
    row = {**_auto_request(8), "allocatedCount": 3, "status": "PARTIALLY_ALLOCATED", "comment": "old"}
    if not automatic:
        row["group"] = "Manual allocation"
    target.force_requests = [row]
    target.save(update_fields=["force_requests", "updated_at"])
    writer_ready, release_writer, writer_committed, handover_reached = (Event() for _ in range(4))

    def write():
        with transaction.atomic():
            response = _thread_jwt(jwt_manager).patch(
                f"/api/ops/security-events/{target.pk}/forces/{row['id']}/",
                {"allocatedCount": 4, "comment": "concurrent comment"}, format="json",
            )
            assert response.status_code == 200, response.json()
            writer_ready.set()
            assert release_writer.wait(10), "handover did not reach its controlled boundary"
        writer_committed.set()

    def handover():
        def boundary(execute, sql, params, many, context):
            upper = sql.lstrip().upper()
            event_lock = upper.startswith("SELECT") and 'FROM "OPS_SECURITY_EVENTS"' in upper and ("FOR NO KEY UPDATE" in upper or "FOR UPDATE" in upper)
            event_write = upper.startswith('UPDATE "OPS_SECURITY_EVENTS"')
            if not handover_reached.is_set() and (event_lock or event_write):
                handover_reached.set()
                assert writer_committed.wait(10), "ordinary writer did not commit"
            return execute(sql, params, many, context)
        with connection.execute_wrapper(boundary):
            response = _thread_jwt(jwt_manager).post(
                f"{URL}{campaign['id']}/hand-over/", {"comment": "Partial allocation explained"}, format="json",
            )
        assert response.status_code == 200, response.json()

    with ThreadPoolExecutor(max_workers=2) as workers:
        writer = workers.submit(_in_connection, write)
        try:
            assert writer_ready.wait(10), "ordinary request update was not reached"
            handing = workers.submit(_in_connection, handover)
            assert handover_reached.wait(10), "handover did not reach the event lock/write"
        finally:
            release_writer.set()
        writer.result(timeout=15)
        handing.result(timeout=15)
    target.refresh_from_db()
    expected = {**row, "comment": "concurrent comment", "allocatedCount": 1 if automatic else 4,
                "status": "PARTIALLY_ALLOCATED"}
    assert target.force_requests == [expected]
    assert len(target.force_roster) == 1


def test_handover_locks_all_event_rows_in_pk_order_without_key_update_before_campaign(manager, jwt_manager):
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager)
    with CaptureQueriesContext(connection) as queries:
        response = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Partial allocation explained"}, format="json")
    assert response.status_code == 200, response.json()
    locks = [(index, row["sql"]) for index, row in enumerate(queries)
             if "FOR UPDATE" in row["sql"] or "FOR NO KEY UPDATE" in row["sql"]]
    event_locks = [(index, sql) for index, sql in locks if 'FROM "ops_security_events"' in sql]
    campaign_locks = [(index, sql) for index, sql in locks if 'FROM "ops_force_campaigns"' in sql]
    assert event_locks, "campaign-only locking cannot protect a concurrent event writer"
    assert all("FOR NO KEY UPDATE" in sql for _, sql in event_locks), "plain FOR UPDATE conflicts with assignment FK KEY SHARE"
    assert all('ORDER BY "ops_security_events"."id" ASC' in sql for _, sql in event_locks)
    assert max(index for index, _ in event_locks) < min(index for index, _ in campaign_locks)
    for event, _ in targets:
        assert any(str(event.pk) in sql for _, sql in event_locks)


@pytest.mark.django_db(transaction=True)
def test_handover_event_locks_allow_an_inflight_campaign_assignment_fk_reference(manager, jwt_manager):
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager, extra_pool_member=True)
    pending = set(row["employeeId"] for row in campaign["pool"]) - set(row["employeeId"] for row in campaign["assignments"])
    # The creation response predates assignments; derive the unassigned fourth
    # person from the current authoritative campaign instead.
    current = jwt_manager.get(f"{URL}{campaign['id']}/").json()
    pending = set(row["employeeId"] for row in current["pool"]) - set(row["employeeId"] for row in current["assignments"])
    assert len(pending) == 1
    event, visit = targets[0]
    before_campaign_lock, assignment_done = Event(), Event()

    def handover():
        def boundary(execute, sql, params, many, context):
            if not before_campaign_lock.is_set() and 'FROM "ops_force_campaigns"' in sql and "FOR UPDATE" in sql:
                before_campaign_lock.set()
                assert assignment_done.wait(10), "assignment could not complete its FK reference"
            return execute(sql, params, many, context)
        with connection.execute_wrapper(boundary):
            response = _thread_jwt(jwt_manager).post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Concurrent assignment"}, format="json")
        assert response.status_code == 200, response.json()

    def assign():
        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '3s'")
                response = _thread_jwt(jwt_manager).post(f"{URL}{campaign['id']}/assignments/", {
                    "employeeId": pending.pop(), "eventId": str(event.pk),
                    "visitObjectId": str(visit.pk), "demandRowId": event.demand_rows[0]["id"],
                }, format="json")
                assert response.status_code == 201, response.json()
        finally:
            assignment_done.set()

    with ThreadPoolExecutor(max_workers=2) as workers:
        handing = workers.submit(_in_connection, handover)
        assert before_campaign_lock.wait(10)
        assigning = workers.submit(_in_connection, assign)
        assigning.result(timeout=15)
        handing.result(timeout=15)
    for target, _ in targets:
        target.refresh_from_db()
        assert len(target.force_roster) == 2
        assert target.force_requests == [{**_auto_request(2), "allocatedCount": 2, "status": "ALLOCATED"}]


@pytest.mark.django_db(transaction=True)
def test_handover_refuses_membership_changed_after_event_discovery(manager, jwt_manager):
    from organization_management.apps.operations.models_forces import OpsForceCampaign, OpsForceCampaignEvent, OpsForceCampaignHandover
    campaign, targets = _campaign_with_two_targets(manager, jwt_manager)
    extra = OpsSecurityEvent.objects.get(pk=create_event(manager, make_object(code="CAR-NEW-MEMBER")).json()["id"])
    before = list(OpsSecurityEvent.objects.filter(pk__in=[event.pk for event, _ in targets]).order_by("pk").values())
    inserted = False

    def add_member():
        OpsForceCampaignEvent.objects.create(campaign_id=campaign["id"], event=extra)

    def boundary(execute, sql, params, many, context):
        nonlocal inserted
        if not inserted and 'FROM "ops_force_campaigns"' in sql and "FOR UPDATE" in sql:
            inserted = True
            with ThreadPoolExecutor(max_workers=1) as worker:
                worker.submit(_in_connection, add_member).result(timeout=10)
        return execute(sql, params, many, context)

    with connection.execute_wrapper(boundary):
        response = jwt_manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Membership changed"}, format="json")
    assert inserted
    assert response.status_code == 400, response.json()
    assert OpsForceCampaignEvent.objects.filter(campaign_id=campaign["id"], event=extra).exists()
    assert list(OpsSecurityEvent.objects.filter(pk__in=[event.pk for event, _ in targets]).order_by("pk").values()) == before
    assert OpsForceCampaign.objects.get(pk=campaign["id"]).status == "DISTRIBUTING"
    assert not OpsForceCampaignHandover.objects.filter(campaign_id=campaign["id"]).exists()
