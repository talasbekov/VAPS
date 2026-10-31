"""Identity-safe §24 transitions for the dated combat planning aggregate."""
from datetime import timedelta
from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_combat import OpsCombatDutyMember, OpsCombatGroup
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.ops import combat_access as access, combat_planning as planning, combat_projection as projection


def _reason(data):
    value = data.get("reason", data.get("returnReason", ""))
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 2000:
        access.fail("REASON_REQUIRED", "Укажите причину действия.")
    return value.strip()


def _raw_members(shift):
    return [{"employeeId": m.employee_id, "isLeader": m.is_leader, "isDriver": m.is_driver, "isReserve": m.is_reserve} for m in shift.members.all()]


def _validate_roster(actor, shift, raw, *, execution=False):
    options = dict(shift=shift, execution=execution, capacity=shift.assignment_snapshot.get("capacity"))
    checked = planning._members(actor, shift.group, shift.business_date, raw, **options)
    if shift.assignment_snapshot.get("restDayAfter"):
        planning._members(actor, shift.group, shift.business_date + timedelta(days=1), raw, **options)
    return checked


def _execution(shift):
    result = (shift.submission or {}).get("execution")
    if shift.state_code != "ACCEPTED" or result is None:
        access.fail("INVALID_STATE_TRANSITION", "Действие доступно после приёма состава штабом.")
    return result


@transaction.atomic
def perform(actor, pk, action, data, *, user_id=None):
    if not isinstance(data, dict):
        access.fail()
    codes = access.REVIEW if action == "review" else access.ROSTER
    options = dict(user_id=user_id, allow_self=action in {"acknowledge", "check_in", "handover", "complete"})
    initial = planning.get_shift(actor, pk, codes, **options)
    OpsCombatGroup.objects.select_for_update().get(pk=initial.group_id)
    event_ids = {initial.event_id} if initial.event_id else set()
    if action == "resubmit" and data.get("eventId") not in (None, ""):
        event_id = access.identifier(data["eventId"], "eventId")
        if not access.event_choices(actor, initial.business_date, initial.division_id).filter(pk=event_id).exists():
            access.fail("PERMISSION_DENIED", "ОМ недоступно подразделению.", status=403)
        event_ids.add(event_id)
    # Event deletion owns event → roster → personnel. Lock both old/new
    # references before the roster when a returned group changes its event.
    list(OpsSecurityEvent.objects.select_for_update().filter(pk__in=event_ids).order_by("pk"))
    shift = planning.lock_shift(actor, pk, codes, **options)
    if shift.group_id != initial.group_id or shift.event_id and shift.event_id not in event_ids:
        access.fail("INVALID_STATE_TRANSITION", "Группа изменилась. Обновите состав и повторите действие.")
    if shift.cancelled_at is not None:
        if action == "cancel":
            return shift
        access.fail("INVALID_STATE_TRANSITION", "Группа отменена.")
    if action == "resubmit":
        if shift.state_code != "RETURNED":
            access.fail("INVALID_STATE_TRANSITION", "Повторно подать можно возвращённый состав.")
        # form takes new location locks before locking the proposed personnel.
        return planning.form(actor, data, existing=shift)
    if action == "check_in" or action == "review" and data.get("decision") == "ACCEPT":
        planning.lock_existing_place(shift)
    employee_ids = set(shift.members.values_list("employee_id", flat=True))
    if action == "replace":
        employee_ids.add(access.identifier(data.get("incomingEmployeeId"), "incomingEmployeeId"))
    list(Employee.objects.select_for_update().filter(pk__in=employee_ids).order_by("pk"))
    old = planning.serialize(shift)
    reason = ""
    doc = dict(shift.submission or {})
    execution = dict(doc.get("execution") or {})
    if action == "review":
        if shift.state_code != "SUBMITTED" or data.get("decision") not in {"ACCEPT", "RETURN"}:
            access.fail("INVALID_STATE_TRANSITION", "Рассмотреть можно поданный состав; выберите принять или вернуть.")
        if data["decision"] == "RETURN":
            reason = _reason(data)
            shift.state_code = "RETURNED"
            doc.update(stateCode="RETURNED", returnReason=reason)
            shift.members.update(active=False)
        else:
            _validate_roster(actor, shift, _raw_members(shift))
            shift.state_code = "ACCEPTED"
            doc.update(stateCode="ACCEPTED", returnReason=None, execution={"stateCode": "PENDING_ACKNOWLEDGEMENT", "acknowledgedMemberNames": [], "actualStart": None, "actualEnd": None, "actualMemberNames": None, "handover": None})
        audit_action = audit_service.COMBAT_GROUP_REVIEWED
    elif action == "cancel":
        reason = _reason(data)
        if execution.get("stateCode") in {"ACTIVE", "COMPLETED"}:
            access.fail("INVALID_STATE_TRANSITION", "Начатое дежурство нужно сдать и завершить; отмена недоступна.")
        shift.state_code, shift.cancelled_at, shift.cancelled_by = "CANCELLED", Clock.now(), actor
        shift.cancellation_reason = reason
        doc["stateCode"] = "CANCELLED"
        shift.members.update(active=False)
        audit_action = audit_service.COMBAT_GROUP_CANCELLED
    elif action == "replace":
        execution = dict(_execution(shift))
        if execution["stateCode"] not in {"PENDING_ACKNOWLEDGEMENT", "READY"}:
            access.fail("INVALID_STATE_TRANSITION", "Замена доступна до заступления группы.")
        reason = _reason(data)
        outgoing = access.identifier(data.get("outgoingEmployeeId"), "outgoingEmployeeId")
        incoming = access.identifier(data.get("incomingEmployeeId"), "incomingEmployeeId")
        member = shift.members.filter(employee_id=outgoing).first()
        if member is None:
            access.fail("NOT_IN_ROSTER", "Заменяемый сотрудник не состоит в группе.")
        if shift.members.filter(employee_id=incoming).exists():
            access.fail("ALREADY_IN_ROSTER", "Сотрудник уже входит в состав.")
        proposed = _raw_members(shift)
        for item in proposed:
            if item["employeeId"] == outgoing:
                item["employeeId"] = incoming
        checked = _validate_roster(actor, shift, proposed)
        new = next(m for m in checked if m["employeeId"] == incoming)
        old_name = member.name_snapshot
        roles = dict(is_leader=member.is_leader, is_driver=member.is_driver, is_reserve=member.is_reserve)
        member.delete()
        shift.members.create(employee_id=incoming, business_date=shift.business_date, name_snapshot=new["employeeName"], created_by=actor, **roles)
        roster = list(shift.members.all())
        leader = next(m for m in roster if m.is_leader)
        doc.update(groupLeaderEmployeeName=leader.name_snapshot, memberEmployeeNames=[m.name_snapshot for m in roster if not m.is_leader and not m.is_reserve], reserveEmployeeNames=[m.name_snapshot for m in roster if m.is_reserve])
        execution["acknowledgedMemberNames"] = [m.name_snapshot for m in roster if m.acknowledged_at and not m.is_reserve]
        execution["stateCode"] = "READY" if all(m.acknowledged_at for m in roster if not m.is_reserve) else "PENDING_ACKNOWLEDGEMENT"
        doc["execution"] = execution
        doc["replacements"] = [*doc.get("replacements", []), {"outgoingEmployeeId": str(outgoing), "outgoingEmployeeName": old_name, "incomingEmployeeId": str(incoming), "incomingEmployeeName": new["employeeName"], "reasonCode": reason, "appliedAt": Clock.now().isoformat()}]
        audit_action = audit_service.COMBAT_MEMBER_REPLACED
    else:
        execution = dict(_execution(shift))
        member = shift.members.filter(employee__user_id=user_id, is_reserve=False).first() if user_id else None
        if action == "acknowledge":
            if member is None:
                access.fail("PERMISSION_DENIED", "Ознакомиться можно только за себя в основном составе.", status=403)
            if member.acknowledged_at:
                access.fail("ALREADY_ACKNOWLEDGED", "Вы уже подтвердили ознакомление.")
            if execution["stateCode"] != "PENDING_ACKNOWLEDGEMENT":
                access.fail("INVALID_STATE_TRANSITION", "Ознакомление уже завершено.")
            member.acknowledged_at = Clock.now()
            member.save(update_fields=["acknowledged_at", "updated_at"])
            main = list(shift.members.filter(is_reserve=False))
            execution["acknowledgedMemberNames"] = [m.name_snapshot for m in main if m.acknowledged_at]
            execution["stateCode"] = "READY" if all(m.acknowledged_at for m in main) else "PENDING_ACKNOWLEDGEMENT"
            audit_action = audit_service.COMBAT_GROUP_ACKNOWLEDGED
        else:
            manager = PermissionService.effective_permissions(actor, shift.division_id)
            if not {"*", *access.REVIEW} & manager and not (member and member.is_leader):
                access.fail("PERMISSION_DENIED", "Действие доступно штабу или старшему этой группы.", status=403)
            if action == "check_in":
                if execution["stateCode"] != "READY" or shift.business_date > Clock.today_local():
                    access.fail("INVALID_STATE_TRANSITION", "Заступление доступно в день дежурства после ознакомления всего состава.")
                _validate_roster(actor, shift, _raw_members(shift), execution=True)
                execution.update(stateCode="ACTIVE", actualStart=Clock.now().isoformat())
                audit_action = audit_service.COMBAT_GROUP_CHECKED_IN
            elif action == "handover":
                if execution["stateCode"] != "ACTIVE":
                    access.fail("INVALID_STATE_TRANSITION", "Сдача доступна во время дежурства.")
                for field in ("unresolvedIncidents", "remarks"):
                    if not isinstance(data.get(field, ""), str) or len(data.get(field, "")) > 4000:
                        access.fail(message="Текст сдачи смены слишком длинный.")
                execution["handover"] = {"unresolvedIncidents": data.get("unresolvedIncidents", ""), "remarks": data.get("remarks", ""), "confirmedByEmployeeName": member.name_snapshot if member else str(actor), "confirmedAt": Clock.now().isoformat()}
                audit_action = audit_service.COMBAT_GROUP_HANDED_OVER
            elif action == "complete":
                if execution["stateCode"] != "ACTIVE" or not execution.get("handover"):
                    access.fail("MISSING_HANDOVER", "Перед завершением оформите сдачу смены.")
                actual = data.get("actualMemberIds")
                if not isinstance(actual, list) or not actual:
                    access.fail(message="Укажите фактический состав дежурства.")
                actual_ids = [access.identifier(pk, "actualMemberIds") for pk in actual]
                roster = {m.employee_id: m.name_snapshot for m in shift.members.all()}
                if len(set(actual_ids)) != len(actual_ids) or set(actual_ids) - roster.keys():
                    access.fail(message="Фактический состав должен содержать участников группы без повторов.")
                execution.update(stateCode="COMPLETED", actualEnd=Clock.now().isoformat(), actualMemberNames=[roster[pk] for pk in actual_ids], actualMemberIds=[str(pk) for pk in actual_ids])
                audit_action = audit_service.COMBAT_GROUP_COMPLETED
            else:
                access.fail(message="Неизвестное действие.")
        doc["execution"] = execution
    doc["updatedAt"] = Clock.now().isoformat()
    shift.submission = doc
    shift.save()
    projection.sync(shift, actor=actor, reason=reason or data.get("amendmentReason", ""))
    audit_service.record(actor=actor, action=audit_action, entity_type="combat_duty_shift", entity_id=shift.pk, old_value=old, new_value=planning.serialize(shift), reason=reason)
    return shift
