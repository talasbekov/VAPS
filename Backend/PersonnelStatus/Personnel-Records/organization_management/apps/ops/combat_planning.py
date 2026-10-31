"""Dated combat groups: identity, availability, placement and a shared day board."""
from collections import defaultdict
from datetime import timedelta
import math

from django.db import transaction
from django.db.models import Q

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_combat import OpsCombatDutyMember, OpsCombatDutyShift, OpsCombatDutyType, OpsCombatGroup, OpsCombatPlace, OpsCombatRoute
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment
from organization_management.apps.operations.models_object import OpsSecurityObject, OpsSecurityPost
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.strength_report import StatusCatalog, resolve_status_row
from organization_management.apps.ops import combat_access as access, combat_projection as projection
from organization_management.apps.ops.security_events import personnel_full_name, personnel_display_name


def serialize(shift, *, actor=None):
    roster = list(shift.members.all())
    snapshot = shift.assignment_snapshot
    submission = shift.submission or {}
    execution = submission.get("execution") or {}
    return {
        "id": str(shift.pk), "businessDate": shift.business_date.isoformat(),
        "groupId": str(shift.group_id), "groupName": shift.group_name,
        "divisionId": str(shift.division_id), "divisionName": snapshot.get("divisionName", ""),
        "maxMembers": snapshot.get("capacity", shift.required_employees),
        "dutyTypeId": str(shift.duty_type_id), "dutyTypeName": snapshot.get("dutyTypeName", ""),
        "shiftKind": snapshot.get("shiftKind", "DAY"), "restDayAfter": snapshot.get("restDayAfter", False),
        "stateCode": "CANCELLED" if shift.cancelled_at else shift.state_code,
        "executionState": execution.get("stateCode"), "location": shift.location,
        "event": {"id": str(shift.event_id), "title": snapshot.get("eventTitle", "")} if shift.event_id else None,
        "callsign": shift.callsign, "equipment": shift.equipment,
        "isReserve": snapshot.get("isReserve", False), "returnReason": submission.get("returnReason"),
        "cancellationReason": shift.cancellation_reason,
        "members": [{"employeeId": str(m.employee_id), "employeeName": m.name_snapshot, "isLeader": m.is_leader, "isDriver": m.is_driver, "isReserve": m.is_reserve, "acknowledged": m.acknowledged_at is not None} for m in roster],
        "acknowledgedCount": sum(m.acknowledged_at is not None for m in roster if not m.is_reserve),
        "execution": execution or None, "replacements": submission.get("replacements", []),
        "updatedAt": shift.updated_at.isoformat(), "assignment": projection.details(shift),
    }


def visible_shifts(actor, *, day=None, selected=None):
    rows = access.scoped_rows(OpsCombatDutyShift, actor, selected).filter(group__isnull=False)
    if day is not None:
        rows = rows.filter(business_date=day)
    return rows.select_related("group", "division", "duty_type", "event").prefetch_related("members").order_by("division_id", "group_name", "pk")


def get_shift(actor, pk, codes=access.READ, *, user_id=None, allow_self=False):
    query = OpsCombatDutyShift.objects.filter(pk=access.identifier(pk), group__isnull=False)
    return _checked_shift(actor, query, codes, user_id=user_id, allow_self=allow_self)


def lock_shift(actor, pk, codes=access.READ, *, user_id=None, allow_self=False):
    """Keep the row lock until the calling lifecycle transaction commits."""
    query = OpsCombatDutyShift.objects.filter(pk=access.identifier(pk), group__isnull=False).select_for_update(of=("self",))
    return _checked_shift(actor, query, codes, user_id=user_id, allow_self=allow_self)


def _checked_shift(actor, query, codes, *, user_id, allow_self):
    shift = query.select_related("group", "division", "duty_type").first()
    if shift is None:
        access.fail("ENTITY_NOT_FOUND", "Смена боевой группы не найдена.", status=404)
    if not (allow_self and user_id and shift.members.filter(employee__user_id=user_id).exists()):
        access.require_scope(actor, shift.division_id, codes)
    return shift


def candidates(actor, day, selected=None, *, shift=None, _validated_owner=None):
    # Execution rechecks the already authorised leader's unchanged roster.
    # This private path is never exposed as a personnel-list endpoint.
    ids = access.division_ids(actor, selected, access.ROSTER) if _validated_owner is None else set(_validated_owner.get_descendants(include_self=True).values_list("pk", flat=True))
    people = list(Employee.objects.filter(is_active=True, employment_status="working", staff_unit__division_id__in=ids).select_related("staff_unit__division").order_by("last_name", "first_name", "pk"))
    person_ids = [p.pk for p in people]
    statuses = defaultdict(list)
    query = OpsEmployeeStatus.objects.filter(employee_id__in=person_ids, cancelled_at__isnull=True, period__contains=day)
    if shift:
        query = query.exclude(source="OM_AUTO", source_ref=projection.source_ref(shift))
    for row in query.values("id", "employee_id", "status_type_code", "date_start", "date_end"):
        statuses[row["employee_id"]].append(row)
    catalog = StatusCatalog.from_rows(StatusType.objects.values("code", "priority", "report_column_code", "counts_in_staff"))
    labels = dict(StatusType.objects.values_list("code", "name"))
    status_scope = PermissionService.visible_division_ids(actor, "status.view")
    reservations = OpsCombatDutyMember.objects.filter(employee_id__in=person_ids, business_date=day, active=True)
    if shift:
        reservations = reservations.exclude(shift=shift)
    occupied = set(reservations.values_list("employee_id", flat=True))
    planned = set(OpsDutyShift.objects.filter(employee_id__in=[str(pk) for pk in person_ids], business_date=day).exclude(state_code="CANCELLED").values_list("employee_id", flat=True))
    from organization_management.apps.ops.duty_dispatch import interval
    first, last = interval(day)
    dispatched = set(OpsDutyDispatchAssignment.objects.filter(employee_id__in=person_ids, cancelled_at__isnull=True, start_at__lt=last, end_at__gt=first).values_list("employee_id", flat=True))
    legacy_names = set()
    for old in OpsCombatDutyShift.objects.filter(group__isnull=True, business_date=day, submission__stateCode__in=["SUBMITTED", "ACCEPTED"]):
        doc = old.submission or {}
        legacy_names.update([doc.get("groupLeaderEmployeeName"), *doc.get("memberEmployeeNames", []), *doc.get("reserveEmployeeNames", [])])
    result = []
    for person in people:
        winner = resolve_status_row(statuses[person.pk], day, catalog)
        code = winner["status_type_code"] if winner else "IN_SERVICE"
        busy = person.pk in occupied or person.pk in dispatched or str(person.pk) in planned or bool({personnel_full_name(person), personnel_display_name(person)} & legacy_names)
        in_service = (winner is None or catalog.column[code] == "IN_SERVICE") and not busy
        reason = "Сотрудник уже назначен на дежурство." if busy else ("" if in_service else labels.get(code, code))
        can_read_status = status_scope is None or person.staff_unit.division_id in status_scope
        if not can_read_status:
            reason = "" if in_service else "Сотрудник недоступен на выбранную дату."
        result.append({"employeeId": str(person.pk), "employeeName": personnel_full_name(person), "divisionId": str(person.staff_unit.division_id), "unitName": person.staff_unit.division.name, "inService": in_service, "blockReason": reason, "statusCode": code if can_read_status else ("IN_SERVICE" if in_service else "UNAVAILABLE"), "eventWarning": can_read_status and code == "IN_EVENT"})
    return result


def _members(actor, group, day, raw, *, shift=None, execution=False, capacity=None):
    if not isinstance(raw, list) or not raw:
        access.fail("EMPTY_GROUP", "Укажите состав и старшего группы.")
    if len(raw) > (capacity if capacity is not None else group.max_members):
        raise DomainError("GROUP_OVERFLOW", 422, message="Состав превышает предельную численность группы.")
    parsed, seen = [], set()
    for item in raw:
        if not isinstance(item, dict) or set(item) - {"employeeId", "isLeader", "isDriver", "isReserve"}:
            access.fail(message="Проверьте участника состава.")
        pk = access.identifier(item.get("employeeId"), "employeeId")
        if pk in seen:
            access.fail(message="Сотрудник повторяется в составе.")
        seen.add(pk)
        flags = {key: item.get(key, False) for key in ("isLeader", "isDriver", "isReserve")}
        if any(type(value) is not bool for value in flags.values()) or flags["isReserve"] and (flags["isLeader"] or flags["isDriver"]):
            access.fail(message="Старший и водитель должны входить в основной состав.")
        parsed.append({"employeeId": pk, **flags})
    if sum(m["isLeader"] for m in parsed) != 1 or sum(m["isDriver"] for m in parsed) > 1:
        access.fail(message="Назначьте одного старшего и не более одного водителя.")
    # Every writer that allocates personnel uses the same ordered employee locks.
    locked = list(Employee.objects.select_for_update().filter(pk__in=seen).order_by("pk"))
    if len(locked) != len(seen):
        access.fail(message="Сотрудник не найден.")
    allowed = {int(row["employeeId"]): row for row in candidates(actor, day, group.division_id, shift=shift, _validated_owner=group.division if execution else None)}
    for member in parsed:
        row = allowed.get(member["employeeId"])
        if row is None:
            access.fail("PERMISSION_DENIED", "Сотрудник не принадлежит доступному составу подразделения.", status=403)
        if not row["inService"]:
            duplicate = OpsCombatDutyMember.objects.filter(employee_id=member["employeeId"], business_date=day, active=True)
            if shift:
                duplicate = duplicate.exclude(shift=shift)
            if duplicate.exists():
                access.fail("DOUBLE_ASSIGNMENT", "Сотрудник уже назначен в другую боевую группу на эту дату.")
            raise DomainError("EMPLOYEE_NOT_IN_SERVICE", 422, message=row["blockReason"] or "Сотрудник недоступен на выбранную дату.")
        member["employeeName"] = row["employeeName"]
    return parsed


def _combat_location(actor, owner, duty_type, raw, *, reserve=False):
    if reserve:
        return {"kind": "RESERVE", "label": "Резерв"}, None, None
    if not isinstance(raw, dict):
        raise DomainError("INVALID_LOCATION", 422, message="Выберите место службы группы.")
    kind = raw.get("kind")
    if kind == "POINT":
        lat, lng = raw.get("latitude"), raw.get("longitude")
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lng)) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
            raise DomainError("INVALID_LOCATION", 422, message="Укажите корректную общую точку на карте.")
        label = raw.get("name", raw.get("label", "Общая точка"))
        if not isinstance(label, str) or len(label.strip()) > 200:
            raise DomainError("INVALID_LOCATION", 422, message="Подпись точки должна быть не длиннее 200 символов.")
        return {"kind": kind, "latitude": lat, "longitude": lng, "name": label.strip() or "Общая точка", "label": f"{label.strip() or 'Общая точка'} · {lat:.5f}, {lng:.5f}"}, None, None
    if kind == "ROUTE":
        ids = raw.get("routeIds", [raw.get("routeId")])
        if not isinstance(ids, list) or not ids or len(ids) > 20:
            raise DomainError("INVALID_LOCATION", 422, message="Выберите трассу.")
        ids = [access.identifier(pk, "routeId") for pk in ids]
        if len(set(ids)) != len(ids) or len(ids) > 1 and not duty_type.supports_multiple_routes:
            raise DomainError("INVALID_LOCATION", 422, message="Этот вид дежурства допускает одну трассу.")
        routes = list(OpsCombatRoute.objects.filter(pk__in=ids, division=owner, is_active=True).order_by("pk"))
        if len(routes) != len(ids):
            access.fail("PERMISSION_DENIED", "Трасса не принадлежит выбранному подразделению.", status=403)
        return {"kind": kind, "routeIds": [str(r.pk) for r in routes], "label": ", ".join(r.safe_label for r in routes)}, None, None
    if kind in {"OBJECT", "POST"}:
        object_id = access.identifier(raw.get("objectId"), "objectId")
        place = OpsCombatPlace.objects.select_related("security_object").select_for_update(of=("security_object",)).filter(division=owner, security_object_id=object_id, is_active=True, security_object__object_state="ACTIVE").first()
        if place is None:
            access.fail("PERMISSION_DENIED", "Объект не включён в справочник мест этого подразделения.", status=403)
        post = None
        if kind == "POST":
            post = OpsSecurityPost.objects.select_for_update(of=("self",)).filter(pk=access.identifier(raw.get("postId"), "postId"), sector__security_object_id=object_id).first()
            if post is None:
                raise DomainError("INVALID_LOCATION", 422, message="Пост не принадлежит выбранному объекту.")
        label = place.security_object.name + (f" · {post.name}" if post else "")
        return {"kind": kind, "objectId": str(object_id), "postId": str(post.pk) if post else None, "label": label}, place.security_object, post
    raise DomainError("INVALID_LOCATION", 422, message="Выберите объект, трассу, пост или общую точку.")


def _equipment(raw):
    if not isinstance(raw, list) or len(raw) > 30:
        access.fail(message="Проверьте технику группы.")
    result = []
    for item in raw:
        if not isinstance(item, dict):
            access.fail(message="Проверьте технику группы.")
        label, category, quantity = item.get("label"), item.get("category"), item.get("quantity")
        if not isinstance(label, str) or not label.strip() or len(label.strip()) > 200 or category not in {"PASSENGER", "ARMORED", "OTHER"} or type(quantity) is not int or not 1 <= quantity <= 500:
            access.fail(message="Укажите название, категорию и положительное количество техники.")
        result.append({"label": label.strip(), "category": category, "quantity": quantity})
    return result


@transaction.atomic
def form(actor, data, *, existing=None):
    if not isinstance(data, dict) or set(data) - {"businessDate", "groupId", "dutyTypeId", "members", "location", "eventId", "callsign", "equipment", "amendmentReason", "isReserve"}:
        access.fail(message="Проверьте поля формы формирования.")
    day = access.business_date(data.get("businessDate"))
    group = OpsCombatGroup.objects.select_for_update(of=("self",)).select_related("division").filter(pk=access.identifier(data.get("groupId"))).first()
    if group is None:
        access.fail("ENTITY_NOT_FOUND", "Боевая группа не найдена.", status=404)
    access.require_scope(actor, group.division_id, access.ROSTER)
    if not group.is_active or not group.division.is_active:
        access.fail(message="Группа или подразделение неактивны.")
    if existing and (existing.group_id != group.pk or existing.business_date != day):
        access.fail(message="При повторной подаче группа и дата не меняются.")
    duplicates = OpsCombatDutyShift.objects.filter(group=group, business_date=day, cancelled_at__isnull=True)
    if existing:
        duplicates = duplicates.exclude(pk=existing.pk)
    if duplicates.exists():
        raise DomainError("GROUP_ALREADY_FORMED", 422, message="Группа уже сформирована на выбранную дату.")
    duty_type = OpsCombatDutyType.objects.filter(pk=access.identifier(data.get("dutyTypeId")), division=group.division, is_active=True).first()
    if duty_type is None:
        access.fail("PERMISSION_DENIED", "Вид дежурства не принадлежит подразделению.", status=403)
    if duty_type.rest_day_after and day > day.max - timedelta(days=2):
        access.fail("INVALID_BUSINESS_DATE", "Для суточного дежурства нужна дата следующего дня.")
    reserve = data.get("isReserve", False)
    if type(reserve) is not bool:
        access.fail(message="Проверьте признак резерва.")
    event = None
    if data.get("eventId") not in (None, ""):
        event = access.event_choices(actor, day, group.division_id).select_for_update(of=("self",)).filter(pk=access.identifier(data["eventId"], "eventId")).first()
        if event is None:
            access.fail("PERMISSION_DENIED", "ОМ недоступно подразделению или не относится к выбранной дате.", status=403)
    location, obj, post = _combat_location(actor, group.division, duty_type, data.get("location"), reserve=reserve)
    members = _members(actor, group, day, data.get("members"), shift=existing)
    if duty_type.rest_day_after:
        _members(actor, group, day + timedelta(days=1), data.get("members"), shift=existing)
    callsign = data.get("callsign", "")
    if not isinstance(callsign, str) or len(callsign.strip()) > 64:
        access.fail(message="Позывной должен быть не длиннее 64 символов.")
    equipment = _equipment(data.get("equipment", []))
    shift = existing or OpsCombatDutyShift(business_date=day, group=group, division=group.division, created_by=actor)
    shift.duty_type, shift.duty_type_code = duty_type, duty_type.duty_type_code
    shift.group_name, shift.required_employees = group.name, group.max_members
    shift.location, shift.security_object, shift.security_post, shift.event = location, obj, post, event
    shift.callsign, shift.equipment, shift.state_code = callsign.strip(), equipment, "SUBMITTED"
    shift.assignment_snapshot = {"divisionName": group.division.name, "capacity": group.max_members, "dutyTypeName": duty_type.safe_label, "shiftKind": duty_type.shift_kind, "restDayAfter": duty_type.rest_day_after, "eventTitle": event.title if event else "", "isReserve": reserve}
    shift.route_set = {"safeLabel": location["label"], "routeIds": location.get("routeIds", []), "coverageMode": "RESERVE" if reserve else "ASSIGNED"}
    leader = next(m for m in members if m["isLeader"])
    shift.submission = {"stateCode": "SUBMITTED", "submittedByUnitName": group.division.name, "submittedByDivisionId": group.division_id, "groupLeaderEmployeeName": leader["employeeName"], "memberEmployeeNames": [m["employeeName"] for m in members if not m["isLeader"] and not m["isReserve"]], "reserveEmployeeNames": [m["employeeName"] for m in members if m["isReserve"]], "execution": None, "replacements": (existing.submission or {}).get("replacements", []) if existing else [], "submittedAt": Clock.now().isoformat(), "updatedAt": Clock.now().isoformat(), "returnReason": None}
    shift.save()
    shift.members.all().delete()
    OpsCombatDutyMember.objects.bulk_create([OpsCombatDutyMember(shift=shift, employee_id=m["employeeId"], business_date=day, name_snapshot=m["employeeName"], is_leader=m["isLeader"], is_driver=m["isDriver"], is_reserve=m["isReserve"], active=True, created_by=actor) for m in members])
    projection.sync(shift, actor=actor, reason=data.get("amendmentReason", ""))
    audit_service.record(actor=actor, action=audit_service.COMBAT_GROUP_FORMED, entity_type="combat_duty_shift", entity_id=shift.pk, new_value=serialize(shift))
    return shift


def lock_existing_place(shift):
    """Same object → post order as the mutable passport, before employee locks."""
    if shift.location.get("kind") not in {"OBJECT", "POST"}:
        return
    obj = OpsSecurityObject.objects.select_for_update().filter(pk=shift.security_object_id, object_state="ACTIVE").first()
    if obj is None:
        raise DomainError("INVALID_LOCATION", 422, message="Объект больше недоступен. Уточните место службы группы.")
    if shift.location["kind"] == "POST" and not OpsSecurityPost.objects.select_for_update(of=("self",)).filter(pk=shift.security_post_id, sector__security_object_id=obj.pk).exists():
        raise DomainError("INVALID_LOCATION", 422, message="Пост удалён из паспорта. Уточните место службы группы до заступления.")


def _board_warnings(shifts, day):
    pending = [s for s in shifts if s.cancelled_at is None and s.state_code in {"SUBMITTED", "ACCEPTED"} and ((s.submission or {}).get("execution") or {}).get("stateCode") != "COMPLETED"]
    ids = {m.employee_id for s in pending for m in s.members.all()}
    if not ids:
        return {}
    people = {p.pk: p for p in Employee.objects.filter(pk__in=ids).select_related("staff_unit__division")}
    objects = {s.security_object_id for s in pending if s.location.get("kind") in {"OBJECT", "POST"}}
    active_objects = set(OpsSecurityObject.objects.filter(pk__in=objects, object_state="ACTIVE").values_list("pk", flat=True)) if objects else set()
    post_ids = {s.security_post_id for s in pending if s.location.get("kind") == "POST"}
    posts = set(OpsSecurityPost.objects.filter(pk__in=post_ids).values_list("pk", "sector__security_object_id")) if post_ids else set()
    facts = defaultdict(list)
    for row in OpsEmployeeStatus.objects.filter(employee_id__in=ids, cancelled_at__isnull=True, date_start__lte=day + timedelta(days=1), date_end__gt=day).values("id", "employee_id", "status_type_code", "date_start", "date_end"):
        facts[row["employee_id"]].append(row)
    catalog = StatusCatalog.from_rows(StatusType.objects.values("code", "priority", "report_column_code", "counts_in_staff"))
    result = {}
    for shift in pending:
        warnings = []
        place_error = ""
        if shift.location.get("kind") in {"OBJECT", "POST"} and shift.security_object_id not in active_objects:
            place_error = "Объект недоступен: уточните место службы группы."
        elif shift.location.get("kind") == "POST" and (shift.security_post_id, shift.security_object_id) not in posts:
            place_error = "Пост удалён из паспорта: уточните место службы группы."
        for member in shift.members.all():
            person = people.get(member.employee_id)
            staff = getattr(person, "staff_unit", None) if person else None
            division = staff.division if staff else None
            owner = shift.division
            valid = person and person.is_active and person.employment_status == "working" and division and owner.tree_id == division.tree_id and owner.lft <= division.lft < owner.rght
            winner = resolve_status_row(facts[member.employee_id], day, catalog)
            valid = valid and winner and catalog.column[winner["status_type_code"]] == "ON_DUTY"
            if valid and shift.assignment_snapshot.get("restDayAfter"):
                rest = resolve_status_row(facts[member.employee_id], day + timedelta(days=1), catalog)
                valid = rest and catalog.column[rest["status_type_code"]] == "AFTER_DUTY"
            if not valid or place_error:
                # A duty reader can see availability without acquiring medical
                # or personnel-status details from another permission scope.
                warnings.append({"employeeId": str(member.employee_id), "employeeName": member.name_snapshot, "reason": place_error or "Доступность изменилась: проверьте состав до заступления."})
        result[shift.pk] = warnings
    return result


def board(actor, day, selected=None):
    groups = list(access.scoped_rows(OpsCombatGroup, actor, selected).filter(is_active=True).select_related("division"))
    shifts = list(visible_shifts(actor, day=day, selected=selected))
    live = [s for s in shifts if s.cancelled_at is None and s.state_code in {"SUBMITTED", "ACCEPTED"}]
    members = [m for s in live if s.state_code in {"SUBMITTED", "ACCEPTED"} for m in s.members.all()]
    warnings = _board_warnings(shifts, day)
    return {
        "businessDate": day.isoformat(), "groups": [{"id": str(g.pk), "name": g.name, "divisionId": str(g.division_id), "divisionName": g.division.name, "maxMembers": g.max_members} for g in groups],
        "shifts": [{**serialize(s, actor=actor), "warnings": warnings.get(s.pk, [])} for s in shifts],
        "summary": {"totalGroups": len(groups), "formedGroups": sum(s.state_code in {"SUBMITTED", "ACCEPTED"} for s in live), "people": len({m.employee_id for m in members}), "awaitingReview": sum(s.state_code == "SUBMITTED" for s in live), "activeGroups": sum((s.submission or {}).get("execution", {}).get("stateCode") == "ACTIVE" for s in live if (s.submission or {}).get("execution")), "reserveGroups": sum(s.assignment_snapshot.get("isReserve", False) for s in live), "vehicles": sum(item["quantity"] for s in live for item in s.equipment)},
        "generatedAt": Clock.now().isoformat(),
    }
