"""Receiver-scoped duty placement, with live canonical allocation checks."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchConfig, OpsDutyDispatchAssignment
from organization_management.apps.operations.models_forces import OpsForceRequestMember
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.status_service import PARTICIPATION_STATUS_CODES
from organization_management.apps.operations.strength_report import StatusCatalog, resolve_status_row
from organization_management.apps.ops.security_events import personnel_display_name, personnel_full_name
from organization_management.apps.statuses.duty_assignments import normalize_assignment
from organization_management.apps.statuses.models import EmployeeStatus


def interval(day, start_time=time.min, end_time=time.min):
    start = datetime.combine(day, start_time, _local_tz())
    end = datetime.combine(day, end_time, _local_tz())
    if end <= start:
        end += timedelta(days=1)
    return start, end


def touched_days(start, end):
    first = Clock.to_local(start).date()
    last = Clock.to_local(end - timedelta(microseconds=1)).date()
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def conflict(message):
    return DomainError("DUTY_DISPATCH_CONFLICT", 409, message=message)


def receiver(config):
    if config is None or config.receiver_department_id is None:
        return None
    return Division.objects.filter(pk=config.receiver_department_id, division_type="department", is_active=True).first()


def capabilities(actor, config):
    department = receiver(config)
    global_permissions = PermissionService.unscoped_permissions(actor)
    can_configure = "*" in global_permissions or "admin.roles" in global_permissions
    allowed = PermissionService.visible_division_ids(actor, "duty.dispatch")
    can_assign = department is not None and (allowed is None or department.pk in allowed)
    return department, can_configure, can_assign


def cancellation_allowed(actor, config):
    if config is None or config.receiver_department_id is None:
        return False
    allowed = PermissionService.visible_division_ids(actor, "duty.dispatch")
    return allowed is None or config.receiver_department_id in allowed


def require_dispatch(actor, config):
    department, _, allowed = capabilities(actor, config)
    if not allowed:
        raise DomainError("PERMISSION_DENIED", 403, message="Расстановка доступна диспетчеру принимающего департамента.")
    return department


class DutyContext:
    """Batch one calendar window; queue and assignment validity use the same rows."""
    def __init__(self, first, last, *, employee_ids=None):
        def scoped(query, field="employee_id"):
            return query if employee_ids is None else query.filter(**{f"{field}__in": employee_ids})

        self.people = {p.pk: p for p in scoped(Employee.objects.select_related("rank", "staff_unit__position", "staff_unit__division"), "pk")}
        catalog_rows = list(StatusType.objects.values("code", "name", "priority", "report_column_code", "counts_in_staff"))
        self.catalog = StatusCatalog.from_rows(catalog_rows)
        self.labels = {r["code"]: r["name"] for r in catalog_rows}
        self.statuses = defaultdict(list)
        for row in scoped(OpsEmployeeStatus.objects.filter(cancelled_at__isnull=True, date_start__lte=last, date_end__gt=first)).order_by("pk").values("id", "employee_id", "status_type_code", "date_start", "date_end", "source_ref", "comment"):
            self.statuses[row["employee_id"]].append(row)
        self.legacy = defaultdict(list)
        for row in scoped(EmployeeStatus.objects.filter(duty_assignment__isnull=False, start_date__lte=last).exclude(state="cancelled")):
            effective_end = row.actual_end_date or row.end_date
            if effective_end is None or effective_end >= first:
                self.legacy[row.employee_id].append(row)
        self.shifts = set(scoped(OpsDutyShift.objects.filter(business_date__range=(first, last)).exclude(state_code="CANCELLED")).values_list("employee_id", "business_date"))
        self.combat = defaultdict(set)
        combat = OpsCombatDutyShift.objects.filter(business_date__range=(first, last), submission__stateCode="ACCEPTED")
        if employee_ids is not None:
            names = {name for person in self.people.values() for name in (personnel_full_name(person), personnel_display_name(person)) if name}
            own_names = Q(submission__groupLeaderEmployeeName__in=names)
            for name in names:
                own_names |= Q(submission__memberEmployeeNames__contains=[name]) | Q(submission__reserveEmployeeNames__contains=[name])
            combat = combat.filter(own_names)
        for row in combat:
            submission = row.submission
            self.combat[row.business_date].update([submission.get("groupLeaderEmployeeName", ""), *submission.get("memberEmployeeNames", []), *submission.get("reserveEmployeeNames", [])])
        self.event_members = defaultdict(list)
        for row in scoped(OpsForceRequestMember.objects.filter(removed_at__isnull=True, event__business_date__lte=last)).select_related("event"):
            if (row.event.business_date_end or row.event.business_date) >= first:
                self.event_members[row.employee_id].append((row.event.business_date, row.event.business_date_end or row.event.business_date))
        self.divisions = {r["id"]: r for r in Division.objects.values("id", "parent_id", "name", "division_type", "tree_id", "lft")}

    def winner(self, employee_id, day):
        return resolve_status_row(self.statuses[employee_id], day, self.catalog)

    def legacy_on(self, employee_id, day):
        return next((row.duty_assignment for row in self.legacy[employee_id] if row.start_date <= day and (row.actual_end_date or row.end_date or day) >= day), None)

    def busy_reason(self, employee_id, day):
        if self.legacy_on(employee_id, day):
            return "У сотрудника уже есть наряд в кадровом статусе."
        if (str(employee_id), day) in self.shifts:
            return "Сотрудник уже назначен в суточном плане дежурств."
        if any(start <= day <= end for start, end in self.event_members[employee_id]):
            return "Сотрудник уже выделен на охранное мероприятие."
        if any(r["date_start"] <= day < r["date_end"] and (r["status_type_code"] in PARTICIPATION_STATUS_CODES or str(r["source_ref"] or "").startswith("security-event:")) for r in self.statuses[employee_id]):
            return "Сотрудник уже привлечён к охранному мероприятию."
        person = self.people.get(employee_id)
        if person and {personnel_full_name(person), personnel_display_name(person)} & self.combat[day]:
            return "Совпадение имени в принятой боевой группе: требуется проверка состава."
        return ""

    def source_reason(self, employee_id, source_id, start, end):
        person = self.people.get(employee_id)
        if person is None or not person.is_active:
            return "Сотрудник больше не работает."
        for day in touched_days(start, end):
            winner = self.winner(employee_id, day)
            if winner is None or winner["id"] != source_id or self.catalog.column[winner["status_type_code"]] != "ON_DUTY":
                return "Выделение на дежурство отменено, изменено или не покрывает всю смену."
            busy = self.busy_reason(employee_id, day)
            if busy:
                return busy
        return ""

    def person_data(self, employee_id):
        person = self.people.get(employee_id)
        if person is None:
            return {"employee_id": employee_id, "full_name": "", "position_name": "", "department_name": "", "directorate_name": "", "rank_name": ""}
        staff = getattr(person, "staff_unit", None)
        names, seen = {}, set()
        current = staff.division_id if staff else None
        while current in self.divisions and current not in seen:
            seen.add(current)
            row = self.divisions[current]
            names[row["division_type"]] = row["name"]
            current = row["parent_id"]
        return {"employee_id": person.pk, "full_name": personnel_full_name(person), "position_name": staff.position.name if staff and staff.position else "", "department_name": names.get("department", ""), "directorate_name": names.get("directorate", ""), "rank_name": person.rank.name if person.rank else ""}


def assignment_data(row, context, config):
    reason = "Назначение отменено." if row.cancelled_at else ""
    if not reason and (receiver(config) is None or row.receiver_department_id != config.receiver_department_id):
        reason = "Принимающий департамент изменён или недоступен."
    if not reason:
        reason = context.source_reason(row.employee_id, row.source_status_id, row.start_at, row.end_at)
    if not reason:
        try:
            normalize_assignment(row.placement, status_type="on_duty", start_date=Clock.to_local(row.start_at).date(), end_date=Clock.to_local(row.end_at).date())
        except ValidationError:
            reason = "Объект или пост больше недоступен: проверьте назначение."
    return {"id": row.pk, **context.person_data(row.employee_id), "full_name": row.employee_name, "source_status_id": row.source_status_id, "receiver_department_id": row.receiver_department_id, "placement": row.placement, "start_at": Clock.to_local(row.start_at).isoformat(), "end_at": Clock.to_local(row.end_at).isoformat(), "created_at": row.created_at.isoformat(), "created_by": row.created_by, "cancelled_at": row.cancelled_at.isoformat() if row.cancelled_at else None, "cancelled_by": row.cancelled_by or None, "cancelled_reason": row.cancelled_reason, "valid": not bool(reason), "invalid_reason": reason or None}


def workspace(actor, day):
    config = OpsDutyDispatchConfig.objects.filter(singleton_key=1).first()
    department, can_configure, can_assign = capabilities(actor, config)
    can_cancel = cancellation_allowed(actor, config)
    configured = Division.objects.filter(pk=config.receiver_department_id).first() if config else None
    result = {
        "business_date": day.isoformat(),
        "time_zone": str(_local_tz()),
        "receiver": {"id": configured.pk, "name": configured.name} if configured else None,
        "can_configure": can_configure,
        "can_assign": can_assign,
        "can_cancel": can_cancel,
        "access_reason": None if can_assign else (
            "Принимающий департамент не настроен или недоступен." if department is None
            else "Нужно право расстановки в принимающем департаменте."
        ),
        "people": [],
        "assignments": [],
        "receiver_options": list(Division.objects.filter(
            division_type="department", is_active=True,
        ).values("id", "name")) if can_configure else [],
    }
    if not can_assign and not can_cancel:
        return result
    start, end = interval(day)
    context = DutyContext(day - timedelta(days=1), day + timedelta(days=1))
    for employee_id, person in context.people.items():
        if not can_assign:
            break
        winner = context.winner(employee_id, day)
        if not person.is_active or winner is None or context.catalog.column[winner["status_type_code"]] != "ON_DUTY":
            continue
        result["people"].append({**context.person_data(employee_id), "status_id": winner["id"], "status_label": context.labels[winner["status_type_code"]], "date_start": winner["date_start"].isoformat(), "date_end": winner["date_end"].isoformat(), "unavailable_reason": context.busy_reason(employee_id, day) or None, "legacy_assignment": context.legacy_on(employee_id, day)})
    result["people"].sort(key=lambda p: (p["full_name"], p["employee_id"]))
    result["assignments"] = [assignment_data(row, context, config) for row in OpsDutyDispatchAssignment.objects.filter(receiver_department_id=config.receiver_department_id, start_at__lt=end, end_at__gt=start)]
    for item in result["assignments"]:
        item["execution_state"] = "CANCELLED" if item["cancelled_at"] else "PLANNED"
        item["can_cancel"] = can_cancel and not bool(item["cancelled_at"])
    from organization_management.apps.ops.duty_log import execution_state, has_register_schema
    if has_register_schema() and result["assignments"]:
        from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
        supplements = {row["source_id"]: row for row in OpsDutyRecordSupplement.objects.filter(
            source_type="DISPATCH", source_id__in=[row["id"] for row in result["assignments"]],
        ).values("source_id", "service_duty_code", "service_duty_label", "acknowledged_at", "actual_start", "actual_end")}
        for item in result["assignments"]:
            kind = supplements.get(item["id"])
            item["duty_record_id"] = f'DISPATCH:{item["id"]}'
            item["service_duty_code"] = kind["service_duty_code"] if kind and kind["service_duty_code"] else None
            item["service_duty_label"] = kind["service_duty_label"] if kind and kind["service_duty_code"] else "Вид не указан"
            item["execution_state"] = execution_state(kind.get("acknowledged_at") if kind else None,
                kind.get("actual_start") if kind else None, kind.get("actual_end") if kind else None, bool(item["cancelled_at"]))
            item["can_cancel"] = can_cancel and item["execution_state"] in ("PLANNED", "ACKNOWLEDGED")
    return result


@transaction.atomic
def configure_receiver(actor, department_id):
    permissions = PermissionService.unscoped_permissions(actor)
    if not ({"*", "admin.roles"} & permissions):
        raise DomainError("PERMISSION_DENIED", 403, message="Настройка доступна администратору доступа.")
    department = Division.objects.filter(pk=department_id, division_type="department", is_active=True).first()
    if department is None:
        raise DomainError("VALIDATION_ERROR", 400, message="Выберите действующий департамент.")
    config, _ = OpsDutyDispatchConfig.objects.get_or_create(singleton_key=1)
    config = OpsDutyDispatchConfig.objects.select_for_update().get(pk=config.pk)
    if config.receiver_department_id != department_id and OpsDutyDispatchAssignment.objects.filter(cancelled_at__isnull=True, end_at__gt=Clock.now()).exists():
        raise conflict("Сначала отмените действующие и будущие назначения прежнего получателя.")
    old = config.receiver_department_id
    config.receiver_department_id, config.updated_by, config.updated_at = department_id, actor, Clock.now()
    config.save()
    audit_service.record(actor=actor, action=audit_service.DUTY_DISPATCH_CONFIGURED, entity_type="duty_dispatch_config", entity_id=config.pk, old_value={"department_id": old}, new_value={"department_id": department_id})
    return {"receiver": {"id": department.pk, "name": department.name}}


@transaction.atomic
def create_assignment(actor, *, employee_id, status_id, business_date, start_time, end_time, placement, service_duty_code=""):
    config = OpsDutyDispatchConfig.objects.select_for_update().filter(singleton_key=1).first()
    department = require_dispatch(actor, config)
    person = Employee.objects.select_for_update().filter(pk=employee_id).first()
    if person is None:
        raise conflict("Сотрудник не найден.")
    # Same employee -> status order as status_service; source changes serialize.
    source = OpsEmployeeStatus.objects.select_for_update().filter(pk=status_id, employee_id=employee_id).first()
    if source is None:
        raise conflict("Выделение сотрудника изменилось. Обновите список.")
    start, end = interval(business_date, start_time, end_time)
    context = DutyContext(business_date, Clock.to_local(end - timedelta(microseconds=1)).date())
    reason = context.source_reason(employee_id, status_id, start, end)
    if reason:
        raise conflict(reason)
    try:
        placement = normalize_assignment(placement, status_type="on_duty", start_date=business_date, end_date=Clock.to_local(end).date())
    except ValidationError as error:
        raise DomainError("VALIDATION_ERROR", 400, detail=error.message_dict, message="Проверьте объект, пост или группу.") from error
    if placement is None:
        raise DomainError("VALIDATION_ERROR", 400, message="Укажите назначение.")
    assert_no_dispatch_overlap(employee_id, start, end)
    row = OpsDutyDispatchAssignment.objects.create(employee_id=employee_id, employee_name=personnel_full_name(person), source_status=source, receiver_department_id=department.pk, placement=placement, start_at=start, end_at=end, created_by=actor)
    data = assignment_data(row, context, config)
    audit_service.record(actor=actor, action=audit_service.DUTY_DISPATCH_CREATED, entity_type="duty_dispatch", entity_id=row.pk, new_value=data)
    if service_duty_code:
        from organization_management.apps.ops import duty_log
        if not duty_log.has_register_schema():
            raise DomainError("VALIDATION_ERROR", 422, message="Справочник видов дежурств ещё не подключён на этом сервере.")
        classified = duty_log.classify_record(actor, f"DISPATCH:{row.pk}", service_duty_code, "Вид указан при создании назначения.")
        data.update({"service_duty_code": classified["service_duty_code"], "service_duty_label": classified["service_duty_label"]})
    return data


def assert_no_dispatch_overlap(employee_id, start, end):
    """Caller locks the employee first; cancelled rows never occupy time."""
    if OpsDutyDispatchAssignment.objects.filter(employee_id=employee_id, cancelled_at__isnull=True, start_at__lt=end, end_at__gt=start).exists():
        raise conflict("У сотрудника уже есть назначение на это время. Сначала отмените пересекающуюся смену.")


@transaction.atomic
def guard_legacy_placement(employee_id, first, last):
    """Serialize every legacy placement writer with dispatch creation."""
    Employee.objects.select_for_update().filter(pk=employee_id).first()
    start, _ = interval(first)
    if last is None:
        if OpsDutyDispatchAssignment.objects.filter(employee_id=employee_id, cancelled_at__isnull=True, end_at__gt=start).exists():
            raise conflict("У сотрудника уже есть назначение на это время.")
        return
    _, end = interval(last)
    assert_no_dispatch_overlap(employee_id, start, end)


@transaction.atomic
def guard_combat_acceptance(day, submission):
    # The old roster has names only. Refuse ambiguous matching names too;
    # never manufacture a person identity from that historical document.
    names = {submission.get("groupLeaderEmployeeName"), *submission.get("memberEmployeeNames", []), *submission.get("reserveEmployeeNames", [])}
    ids = sorted(p.pk for p in Employee.objects.filter(is_active=True) if {personnel_full_name(p), personnel_display_name(p)} & names)
    list(Employee.objects.select_for_update().filter(pk__in=ids).order_by("pk"))
    start, end = interval(day)
    for employee_id in ids:
        assert_no_dispatch_overlap(employee_id, start, end)


@transaction.atomic
def cancel_assignment(actor, assignment_id, reason):
    config = OpsDutyDispatchConfig.objects.select_for_update().filter(singleton_key=1).first()
    if not cancellation_allowed(actor, config):
        raise DomainError("PERMISSION_DENIED", 403, message="Отмена доступна диспетчеру принимающего департамента.")
    row = OpsDutyDispatchAssignment.objects.select_for_update().filter(pk=assignment_id, receiver_department_id=config.receiver_department_id).first()
    if row is None:
        raise DomainError("ENTITY_NOT_FOUND", 404, message="Назначение не найдено.")
    from organization_management.apps.ops import duty_log
    if row.cancelled_at is None and duty_log.has_register_schema():
        from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
        if OpsDutyRecordSupplement.objects.filter(source_type="DISPATCH", source_id=row.pk, actual_start__isnull=False).exists():
            raise DomainError("INVALID_STATE_TRANSITION", 422, message="Начало смены уже отмечено. Завершите её в журнале дежурств; отмена доступна до начала.")
    days = touched_days(row.start_at, row.end_at)
    context = DutyContext(days[0], days[-1])
    old = assignment_data(row, context, config)
    if row.cancelled_at is None:
        row.cancelled_at, row.cancelled_by, row.cancelled_reason = Clock.now(), actor, reason
        row.save(update_fields=["cancelled_at", "cancelled_by", "cancelled_reason"])
        data = assignment_data(row, context, config)
        audit_service.record(actor=actor, action=audit_service.DUTY_DISPATCH_CANCELLED, entity_type="duty_dispatch", entity_id=row.pk, old_value=old, new_value=data, reason=reason)
        return data
    return old


def object_roster(object_id, day, *, actor):
    """Object readers retain the receiver dispatcher's cross-department roster."""
    return _roster(day, actor=actor, object_id=object_id)


def employee_roster(employee_id, day, *, actor, object_id=None):
    """Personnel placements obey status.view scope even for a dispatcher."""
    return _roster(day, actor=actor, employee_id=employee_id, object_id=object_id)


def _roster(day, *, actor, object_id=None, employee_id=None):
    # Dispatch cannot start on either boundary, nor cover the final day:
    # source allocation end dates are exclusive and bounded by date.max.
    if day in (date.min, date.max):
        return []
    start, end = interval(day)
    config = OpsDutyDispatchConfig.objects.filter(singleton_key=1).first()
    rows = OpsDutyDispatchAssignment.objects.filter(cancelled_at__isnull=True, start_at__lt=end, end_at__gt=start)
    if object_id is not None:
        rows = rows.filter(placement__object_id=str(object_id))
    if employee_id is not None:
        rows = rows.filter(employee_id=employee_id)
    allowed = PermissionService.visible_division_ids(actor, "status.view")
    if allowed is not None and (employee_id is not None or not capabilities(actor, config)[2]):
        rows = rows.filter(employee_id__in=Employee.objects.filter(staff_unit__division_id__in=allowed).values("pk"))
    rows = list(rows)
    if not rows:
        return []
    context = DutyContext(day - timedelta(days=1), day + timedelta(days=1))
    results = []
    for row in rows:
        data = assignment_data(row, context, config)
        if not data["valid"]:
            continue
        results.append({"source": "dispatch", "dispatch_assignment_id": row.pk, "status_id": None, "source_status_id": row.source_status_id, "employee_id": row.employee_id, "employee_name": row.employee_name, "rank_name": data["rank_name"], "position_name": data["position_name"], "department_name": data["department_name"], "placement": row.placement, "start_date": Clock.to_local(row.start_at).date().isoformat(), "end_date": Clock.to_local(row.end_at - timedelta(microseconds=1)).date().isoformat(), "start_at": data["start_at"], "end_at": data["end_at"], "assigned_at": row.created_at.isoformat()})
        results[-1]["time_zone"] = str(_local_tz())
    return results
