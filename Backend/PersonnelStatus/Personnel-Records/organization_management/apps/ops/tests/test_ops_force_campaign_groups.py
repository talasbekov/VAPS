"""Участник специальной группы в общем пуле распределения (Plane №1250,
проходка №1142, `[ОМ-РШ-10]`).

Пробы стерегут: человек, присланный департаментом ПОСЛЕ создания кампании
(в составе ОМ с видом группы), виден в пуле рядом с сохранёнными резервистами;
вид участия пула сверяется со строкой потребности — группу нельзя посадить в
физнаряд и наоборот; после передачи состав объекта несёт вид участия;
`_merge_into_roster` переносит вид и специальность присланного человека.
"""
import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_forces import OpsForceCampaignPoolMember
from organization_management.apps.ops import forces_send

from .test_ops_force_campaigns import URL, _event
from .test_ops_forces_gathering import make_assignment_status_type
from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _target_with_two_rows(manager):  # noqa: F811
    target_object = make_object(code="OBJ-GROUPS", name="Объект с группой")
    response = create_event(manager, target_object, title="ОМ с группой", business_date="2026-10-20")
    assert response.status_code == 201, response.data
    target = OpsSecurityEvent.objects.get(pk=response.json()["id"])
    visit = target.visit_objects.get()
    target.demand_rows = [
        {"id": "demand-physical", "visitObjectId": str(visit.pk), "kindCode": "PHYSICAL_SQUAD", "place": "Периметр", "need": 1},
        {"id": "demand-screening", "visitObjectId": str(visit.pk), "kindCode": "SCREENING_GROUP", "place": "КПП", "need": 1},
    ]
    target.save(update_fields=["demand_rows", "updated_at"])
    return target, visit


def test_group_member_sent_after_creation_joins_the_pool_and_lands_on_its_row(manager):  # noqa: F811
    make_assignment_status_type()
    target, visit = _target_with_two_rows(manager)
    campaign = manager.post(URL, {"title": "Пул с группой", "eventIds": [str(target.pk)]}, format="json").json()
    physical = make_employee(last_name="Резервов", first_name="Физ")
    OpsForceCampaignPoolMember.objects.create(
        campaign_id=int(campaign["id"]), employee=physical, employee_key=str(physical.pk),
        employee_name="Резервов Физ", kind_code="PHYSICAL_SQUAD", source_event_ids=[str(target.pk)],
    )
    grouped = make_employee(last_name="Досмотров", first_name="Группа")
    # Департамент прислал список уже после создания кампании: человек группы
    # лежит в составе ОМ с видом участия, а в сохранённом пуле его нет.
    target.force_roster = [
        {"employeeId": str(grouped.pk), "employeeName": "Досмотров Группа",
         "kindCode": "SCREENING_GROUP", "roleCode": "SCREENER"},
    ]
    target.save(update_fields=["force_roster", "updated_at"])

    detail = manager.get(f"{URL}{campaign['id']}/").json()
    pool = {row["employeeId"]: row for row in detail["pool"]}
    assert set(pool) == {str(physical.pk), str(grouped.pk)}, detail["pool"]
    assert pool[str(grouped.pk)]["kindCode"] == "SCREENING_GROUP"
    assert pool[str(grouped.pk)]["roleCode"] == "SCREENER"

    wrong = manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {"employeeId": str(grouped.pk), "eventId": str(target.pk), "visitObjectId": str(visit.pk), "demandRowId": "demand-physical"},
        format="json",
    )
    assert wrong.status_code == 422, wrong.content
    assert wrong.json()["error_code"] == "FORCE_CAMPAIGN_KIND_MISMATCH"

    right = manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {"employeeId": str(grouped.pk), "eventId": str(target.pk), "visitObjectId": str(visit.pk), "demandRowId": "demand-screening"},
        format="json",
    )
    assert right.status_code == 201, right.content
    assert right.json()["assignments"][0]["kindCode"] == "SCREENING_GROUP"

    physical_wrong = manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {"employeeId": str(physical.pk), "eventId": str(target.pk), "visitObjectId": str(visit.pk), "demandRowId": "demand-screening"},
        format="json",
    )
    assert physical_wrong.status_code == 422
    manager.post(
        f"{URL}{campaign['id']}/assignments/",
        {"employeeId": str(physical.pk), "eventId": str(target.pk), "visitObjectId": str(visit.pk), "demandRowId": "demand-physical"},
        format="json",
    )

    handed = manager.post(f"{URL}{campaign['id']}/hand-over/", {"comment": ""}, format="json")
    assert handed.status_code == 200, handed.content
    target.refresh_from_db()
    roster = {row["employeeId"]: row for row in target.force_roster}
    assert roster[str(grouped.pk)]["kindCode"] == "SCREENING_GROUP"
    assert roster[str(grouped.pk)]["roleCode"] == "SCREENER"
    assert roster[str(grouped.pk)]["visitObjectId"] == str(visit.pk)
    assert roster[str(physical.pk)]["kindCode"] == "PHYSICAL_SQUAD"


def test_merge_into_roster_keeps_kind_and_role(manager):  # noqa: F811
    event = _event(manager, code="MERGE", date="2026-10-21")
    member = make_employee(last_name="Кинологов", first_name="Пёс")
    target = {
        "departmentId": "631", "departmentName": "Первый департамент",
        "members": [{"employeeId": str(member.pk), "name": "Кинологов Пёс", "kindCode": "K9_GROUP", "roleCode": "HANDLER"}],
    }
    forces_send._merge_into_roster(event, target, "2026-09-12T20:00:00+00:00")
    event.refresh_from_db()
    row = event.force_roster[0]
    assert (row["kindCode"], row["roleCode"]) == ("K9_GROUP", "HANDLER")
