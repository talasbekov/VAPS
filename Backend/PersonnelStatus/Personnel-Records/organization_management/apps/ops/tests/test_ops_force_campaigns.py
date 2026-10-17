"""Общий пул нескольких ОМ и распределение Штабом (Plane №978)."""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)
from .test_ops_forces_gathering import make_assignment_status_type

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/forces/campaigns/"


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


def test_handover_allows_explained_shortage_when_each_positive_need_visit_has_a_person(manager):
    make_assignment_status_type()
    event = OpsSecurityEvent.objects.get(pk=create_event(manager, make_object(code="PARTIAL-1106")).json()["id"])
    visit = event.visit_objects.get()
    event.visit_objects.create(security_object=make_object(code="ZERO-1106"), object_name="Объект без потребности", position=1)
    event.stage = "PLACEMENT"
    event.visit_objects.update(stage="PLACEMENT")
    event.demand_rows = [{"id": "partial-demand", "visitObjectId": str(visit.pk), "kindCode": "PHYSICAL_SQUAD", "need": 2}]
    people = [make_employee(last_name="Неполный1106", first_name=name) for name in ["Назначен", "Резерв"]]
    event.force_roster = [{"employeeId": str(person.pk), "employeeName": str(person)} for person in people]
    event.save(update_fields=["stage", "demand_rows", "force_roster", "updated_at"])
    campaign = manager.post(URL, {"title": "Объяснённый недобор", "eventIds": [str(event.pk)]}, format="json").json()
    assigned = manager.post(f"{URL}{campaign['id']}/assignments/", {
        "employeeId": str(people[0].pk), "eventId": str(event.pk),
        "visitObjectId": str(visit.pk), "demandRowId": "partial-demand",
    }, format="json")
    assert assigned.status_code == 201, assigned.json()
    missing_comment = manager.post(f"{URL}{campaign['id']}/hand-over/", {}, format="json")
    assert missing_comment.status_code == 400
    response = manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": "Второе место ожидает усиления"}, format="json")
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "HANDED_OVER"
    event.refresh_from_db()
    assert len(event.force_roster) == 1
    assert event.force_handover["comment"] == "Второе место ожидает усиления"


def test_handover_projects_assignments_to_event_rosters_and_locks_campaign(manager):  # noqa: F811
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
    target.save(update_fields=["demand_rows", "updated_at"])
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
    blocked = manager.post(
        f"{URL}{campaign['id']}/hand-over/", {"comment": "Рано"}, format="json"
    )
    assert blocked.status_code == 422, blocked.content
    assert blocked.json()["error_code"] == "FORCE_OBJECTS_NOT_READY"
    target.refresh_from_db()
    assert target.force_handover == {}
    second.stage = "PLACEMENT"
    second.save(update_fields=["stage"])
    target.stage = "PLACEMENT"
    target.save(update_fields=["stage", "updated_at"])

    response = manager.post(
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
