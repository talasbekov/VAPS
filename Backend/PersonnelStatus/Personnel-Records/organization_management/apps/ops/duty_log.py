"""Explicit administrative facts; no status or personnel-allocation writes."""
import hashlib
import json
from datetime import timedelta, timezone
from uuid import UUID

from django.db import connection, transaction
from django.db.models import Q
from django.db.migrations.recorder import MigrationRecorder
from django.contrib.auth import get_user_model

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.duty_kinds import SERVICE_DUTY_KINDS
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_duty_log import OpsDutyCreationClosure, OpsDutyLogEntry, OpsDutyRecordSupplement
from organization_management.apps.operations.models_duty import OpsDutyMonthlyPlan
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.ops.duty_record_access import (
    can_read, can_write, division_scope, employee_data, in_scope, people_query, resolve_record,
    WRITE_PERMISSIONS, parse_key,
    public_identifier, public_metadata,
)


@transaction.atomic
def active_kind(code, *, lock=False):
    query = OpsDictionaryEntry.objects.select_for_update() if lock else OpsDictionaryEntry.objects.all()
    row = query.filter(dictionary_code=SERVICE_DUTY_KINDS, code=code, is_active=True).first()
    if row is None:
        raise DomainError("VALIDATION_ERROR", 422, detail={"service_duty_code": ["Выберите действующий вид дежурства."]}, message="Вид дежурства не найден или неактивен.")
    return row


def has_register_schema():
    # Existing source APIs can keep running before feature installation.
    return MigrationRecorder.Migration.objects.filter(app="operations", name="0138_service_duty_register").exists()


def kinds():
    return {"results": [{"code": row.code, "label": row.label, "label_kk": row.label_kk,
        "description": row.description, "is_active": row.is_active}
        for row in OpsDictionaryEntry.objects.filter(dictionary_code=SERVICE_DUTY_KINDS).order_by("label", "code")]}


def choices(actor, *, search="", page=1, page_size=25):
    rows = people_query(actor).filter(is_active=True, pk__gt=0)
    for word in search.split():
        rows = rows.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(middle_name__icontains=word) | Q(personnel_number__icontains=word))
    rows = rows.order_by("last_name", "first_name", "pk")
    count = rows.count()
    return {"results": [public_metadata(employee_data(person)) for person in rows[(page - 1) * page_size:page * page_size]],
        "count": count, "page": page, "page_size": page_size}


def local_stamp(value):
    return Clock.to_local(value).isoformat() if value is not None else None


def execution_state(acknowledged, start, end, cancelled):
    if cancelled:
        return "CANCELLED"
    if end is not None:
        return "COMPLETED"
    if start is not None:
        return "ACTIVE"
    return "ACKNOWLEDGED" if acknowledged is not None else "PLANNED"


def interval_minutes(start, end):
    return round((end - start).total_seconds() / 60, 2) if start is not None and end is not None and end >= start else None


def serialize_record(source, row, supplement, metadata, *, actor=None):
    facts = row if source in ("LOG", "PLAN") else supplement
    acknowledged = facts.acknowledged_at if facts is not None else None
    actual_start = facts.actual_start if facts is not None else None
    actual_end = facts.actual_end if facts is not None else None
    cancelled = row.state_code == "CANCELLED" if source == "PLAN" else row.cancelled_at is not None
    state = row.state_code if source == "PLAN" else execution_state(acknowledged, actual_start, actual_end, cancelled)
    planned_start = row.planned_start if source == "LOG" else row.start_at if source == "DISPATCH" else None
    planned_end = row.planned_end if source == "LOG" else row.end_at if source == "DISPATCH" else None
    kind = row if source == "LOG" else supplement
    code = kind.service_duty_code if kind is not None else ""
    label = kind.service_duty_label if kind is not None and code else "Вид не указан"
    now = Clock.now()
    valid_actual = state == "COMPLETED" and actual_start is not None and actual_end is not None and actual_start <= actual_end <= now
    planning_locked = source == "PLAN" and OpsDutyMonthlyPlan.objects.filter(month=row.business_date.isoformat()[:7], state_code="APPROVED").exists()
    if source == "LOG":
        location = row.location_label
    elif source == "DISPATCH":
        location = " · ".join(str(row.placement.get(key) or "") for key in ("object_name", "post_name", "group_name") if row.placement.get(key))
    else:
        location = str((row.target or {}).get("safeLabel") or "")
    result = {
        "id": f"{source}:{row.pk}", "source": source, "source_id": public_identifier(row.pk), **public_metadata(metadata),
        "service_duty_code": code or None, "service_duty_label": label,
        "business_date": row.business_date.isoformat() if source == "PLAN" else Clock.to_local(planned_start).date().isoformat(),
        "state": state, "planned_start": local_stamp(planned_start), "planned_end": local_stamp(planned_end),
        "planned_minutes": interval_minutes(planned_start, planned_end),
        "acknowledged_at": local_stamp(acknowledged), "acknowledged_by": getattr(facts, "acknowledged_by", "") or None,
        "actual_start": local_stamp(actual_start), "started_by": getattr(facts, "started_by", "") or None,
        "actual_end": local_stamp(actual_end), "completed_by": getattr(facts, "completed_by", "") or None,
        "actual_minutes": interval_minutes(actual_start, actual_end) if valid_actual else None,
        "planning_locked": planning_locked,
        "location_label": location, "document_basis": row.document_basis if source == "LOG" else "",
        "note": (row.note or "") if source in ("LOG", "PLAN") else "",
        "created_at": local_stamp(row.created_at), "created_by": getattr(row, "created_by", "") or None,
        "updated_at": local_stamp(getattr(supplement if source == "DISPATCH" and supplement else row, "updated_at", None)),
        "revision": row.revision if source == "LOG" else None,
        "cancelled_at": (row.cancellation or {}).get("cancelledAt") if source == "PLAN" else local_stamp(row.cancelled_at),
        "cancelled_reason": getattr(row, "cancelled_reason", "") or ((row.cancellation or {}).get("reason", "") if source == "PLAN" else ""),
        "execution_mode": "SERVER_TIME" if source == "PLAN" else "RECORDED_TIME",
        "time_zone": str(_local_tz()),
    }
    allowed = actor is not None and can_write(actor, source, row, metadata)
    actions = []
    execution_allowed = source != "PLAN" or row.business_date <= Clock.today_local()
    if allowed:
        if state == "PLANNED":
            actions.append("acknowledge")
        elif state == "ACKNOWLEDGED" and execution_allowed:
            actions.append("start")
        elif state == "ACTIVE" and execution_allowed and actual_start is not None and actual_start <= now:
            actions.append("complete")
        if state in ("PLANNED", "ACKNOWLEDGED"):
            if not planning_locked:
                actions.append("cancel")
            if source == "LOG":
                actions.append("edit")
        if state != "CANCELLED":
            actions.append("classify")
    result["actions"] = actions
    return result


def record_detail(actor, key):
    source, row, supplement, metadata = resolve_record(actor, key)
    result = serialize_record(source, row, supplement, metadata, actor=actor)
    query = Q(entity_type={"LOG": "duty_log", "PLAN": "duty_shift", "DISPATCH": "duty_dispatch"}[source], entity_id=row.pk)
    if supplement is not None:
        query |= Q(entity_type="duty_record_supplement", entity_id=supplement.pk)
    history = list(reversed(OpsAuditLog.objects.filter(query).order_by("-created_at", "-pk")[:100]))
    labels = {"DUTY_LOG_CREATED": "Запись создана", "DUTY_LOG_UPDATED": "Плановая запись исправлена", "DUTY_LOG_ACKNOWLEDGED": "Подтверждено",
        "DUTY_LOG_STARTED": "Начало отмечено", "DUTY_LOG_COMPLETED": "Завершено",
        "DUTY_LOG_CANCELLED": "Отменено", "DUTY_RECORD_CLASSIFIED": "Вид указан или изменён",
        "DUTY_DISPATCH_CREATED": "Назначение создано", "DUTY_DISPATCH_CANCELLED": "Назначение снято",
        "DUTY_SHIFT_CREATED": "Смена создана", "DUTY_SHIFT_CANCELLED": "Смена отменена"}
    actor_ids = {str(event.actor_user_id or "") for event in history}
    numeric_ids = {int(value) for value in actor_ids if value.isascii() and value.isdigit() and 0 < int(value) <= 9223372036854775807}
    authors = {str(user.pk): user.get_full_name().strip() or user.get_username()
        for user in get_user_model().objects.filter(pk__in=numeric_ids).only("id", "first_name", "last_name", "username")}
    result["history"] = [{"at": local_stamp(event.created_at), "action": event.action,
        "label": labels.get(event.action, "Изменение записи"), "actor": authors.get(str(event.actor_user_id), event.actor_user_id),
        "actor_id": event.actor_user_id, "reason": event.reason}
        for event in history]
    return result


def record_audit(actor, action, source, row, supplement, metadata, old=None, reason=""):
    return audit_service.record(actor=actor, action=action,
        entity_type="duty_log" if source == "LOG" else "duty_shift" if source == "PLAN" else "duty_record_supplement",
        entity_id=row.pk if source in ("LOG", "PLAN") else supplement.pk,
        old_value=old, new_value=serialize_record(source, row, supplement, metadata), reason=reason)


def normalized_creation(data):
    result = {key: (value.strip() if isinstance(value, str) else value) for key, value in data.items() if key != "client_request_id"}
    result["service_duty_code"] = result["service_duty_code"].upper()
    for key in ("planned_start", "planned_end"):
        result[key] = safe_moment(result[key], key)
    return result


def safe_moment(value, field):
    try:
        normalized = value.astimezone(timezone.utc)
        Clock.to_local(normalized)
        return normalized
    except (OverflowError, ValueError):
        raise DomainError("VALIDATION_ERROR", 422, detail={field: ["Дата выходит за поддерживаемый календарный диапазон."]}, message="Проверьте дату и время.")


def valid_interval(first, last):
    first, last = safe_moment(first, "planned_start"), safe_moment(last, "planned_end")
    if first >= last:
        raise DomainError("VALIDATION_ERROR", 422, detail={"planned_end": ["Окончание должно быть позже начала."]}, message="Проверьте время смены.")
    if last - first > timedelta(days=366):
        raise DomainError("VALIDATION_ERROR", 422, detail={"planned_end": ["Одна запись не может превышать 366 дней."]}, message="Проверьте длительность дежурства.")
    return first, last


@transaction.atomic
def _lock_creation_request(request_id):
    """Create and close call inside their outer transaction; commit releases it."""
    canonical = str(UUID(str(request_id)))
    key = int.from_bytes(hashlib.sha256(("smart-josparlau:duty-create:" + canonical).encode()).digest()[:8], "big", signed=True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [key])


@transaction.atomic
def create_record(actor, data):
    request_id = data.get("client_request_id")
    if request_id:
        _lock_creation_request(request_id)
        if OpsDutyCreationClosure.objects.filter(client_request_id=request_id, created_by=actor).exists():
            raise DomainError("DUTY_CREATION_CLOSED", 409, message="Эта попытка закрыта. Начните новую запись дежурства.")
    values = normalized_creation(data)
    person = people_query(actor).select_for_update(of=("self",)).filter(pk=values["employee_id"], is_active=True).first()
    if person is None:
        raise DomainError("PERMISSION_DENIED", 403, message="Выберите действующего сотрудника в доступном подразделении.")
    metadata = employee_data(person)
    if not in_scope(division_scope(actor, WRITE_PERMISSIONS), metadata["division_id"]):
        raise DomainError("PERMISSION_DENIED", 403, message="Нет права учёта в подразделении сотрудника.")
    fingerprint = hashlib.sha256(json.dumps(values, sort_keys=True, default=lambda v: v.isoformat(), ensure_ascii=False).encode()).hexdigest()
    existing = OpsDutyLogEntry.objects.filter(client_request_id=request_id).first() if request_id else None
    if existing:
        if existing.created_by != actor or existing.creation_fingerprint != fingerprint:
            raise DomainError("DUTY_REGISTER_CONFLICT", 409, message="Этот запрос уже сохранён с другими данными. Обновите журнал.")
        original_source, existing, extension, original_metadata = resolve_record(actor, f"LOG:{existing.pk}", write=True)
        return serialize_record(original_source, existing, extension, original_metadata, actor=actor), False
    kind = active_kind(values["service_duty_code"], lock=True)
    values["planned_start"], values["planned_end"] = valid_interval(values["planned_start"], values["planned_end"])
    values.pop("employee_id")
    values["service_duty_label"] = kind.label
    defaults = dict(values, **{key: metadata[key] for key in ("employee_id", "employee_name", "division_id", "division_name")},
        created_by=actor, creation_fingerprint=fingerprint)
    if request_id:
        row, created = OpsDutyLogEntry.objects.get_or_create(client_request_id=request_id, defaults=defaults)
        if not created:
            if row.created_by != actor or row.creation_fingerprint != fingerprint:
                raise DomainError("DUTY_REGISTER_CONFLICT", 409, message="Этот запрос уже сохранён с другими данными. Обновите журнал.")
            source, row, extension, original_metadata = resolve_record(actor, f"LOG:{row.pk}", write=True)
            return serialize_record(source, row, extension, original_metadata, actor=actor), False
    else:
        row = OpsDutyLogEntry.objects.create(**defaults)
    record_audit(actor, audit_service.DUTY_LOG_CREATED, "LOG", row, None, metadata)
    return serialize_record("LOG", row, None, metadata, actor=actor), True


def creation_result(actor, request_id):
    """Only the creator may confirm an uncertain POST; scope still hides data."""
    row = OpsDutyLogEntry.objects.filter(client_request_id=request_id, created_by=actor).first()
    if row is None:
        closed = OpsDutyCreationClosure.objects.filter(client_request_id=request_id, created_by=actor).exists()
        return {"saved": False, "closed": closed, "record": None}
    metadata = {key: getattr(row, key) for key in ("employee_id", "employee_name", "division_id", "division_name")}
    visible = can_read(actor, "LOG", row, metadata)
    return {"saved": True, "closed": False, "record": serialize_record("LOG", row, None, metadata, actor=actor) if visible else None}


@transaction.atomic
def close_creation(actor, request_id):
    _lock_creation_request(request_id)
    result = creation_result(actor, request_id)
    if result["saved"]:
        return result
    OpsDutyCreationClosure.objects.get_or_create(client_request_id=request_id, created_by=actor)
    return {"saved": False, "closed": True, "record": None}


def ensure_supplement(source, row, supplement, metadata, actor):
    if supplement is not None:
        return supplement
    return OpsDutyRecordSupplement.objects.create(source_type=source, source_id=row.pk,
        **{key: metadata[key] for key in ("employee_id", "employee_name", "division_id", "division_name")}, created_by=actor, updated_by=actor)


@transaction.atomic
def classify_record(actor, key, code, reason):
    source, row, supplement, metadata = resolve_record(actor, key, write=True, lock=True)
    old = serialize_record(source, row, supplement, metadata)
    if old["state"] == "CANCELLED":
        raise DomainError("INVALID_STATE_TRANSITION", 422, message="Отменённая запись сохраняется без изменения вида.")
    kind = active_kind(code.strip().upper(), lock=True)
    holder = row if source == "LOG" else ensure_supplement(source, row, supplement, metadata, actor)
    if holder.service_duty_code == kind.code:
        return serialize_record(source, row, holder if source != "LOG" else None, metadata, actor=actor)
    holder.service_duty_code, holder.service_duty_label = kind.code, kind.label
    holder.updated_at = Clock.now()
    fields = ["service_duty_code", "service_duty_label", "updated_at"]
    if source != "LOG":
        holder.updated_by = actor
        fields.append("updated_by")
        supplement = holder
    else:
        holder.revision += 1
        fields.append("revision")
    holder.save(update_fields=fields)
    record_audit(actor, audit_service.DUTY_RECORD_CLASSIFIED, source, row, supplement, metadata, old, reason)
    return serialize_record(source, row, supplement, metadata, actor=actor)


@transaction.atomic
def mark_execution(actor, key, operation, *, at=None):
    source, row, supplement, metadata = resolve_record(actor, key, write=True, lock=True)
    old = serialize_record(source, row, supplement, metadata)
    state = old["state"]
    reached = {"acknowledge": ("ACKNOWLEDGED", "ACTIVE", "COMPLETED"), "start": ("ACTIVE", "COMPLETED"), "complete": ("COMPLETED",)}
    if state in reached[operation]:
        return serialize_record(source, row, supplement, metadata, actor=actor)
    required = {"acknowledge": "PLANNED", "start": "ACKNOWLEDGED", "complete": "ACTIVE"}
    if state != required[operation]:
        raise DomainError("INVALID_STATE_TRANSITION", 422, message="Состояние записи изменилось. Обновите её перед отметкой.")
    action = {"acknowledge": audit_service.DUTY_LOG_ACKNOWLEDGED, "start": audit_service.DUTY_LOG_STARTED, "complete": audit_service.DUTY_LOG_COMPLETED}[operation]
    if source == "PLAN":
        if at is not None:
            raise DomainError("VALIDATION_ERROR", 422, message="Суточный план фиксирует текущее серверное время; ручная дата недоступна.")
        if operation != "acknowledge" and row.business_date > Clock.today_local():
            raise DomainError("INVALID_STATE_TRANSITION", 422, message="Начало будущего дежурства пока не отмечается.")
        if operation == "complete" and (row.actual_start is None or row.actual_start > Clock.now()):
            raise DomainError("VALIDATION_ERROR", 422, message="В источнике не указано корректное фактическое начало. Завершение не может быть раньше начала.")
        from organization_management.apps.ops import duties
        transition = {"acknowledge": duties.acknowledge_shift, "start": duties.clock_in_shift, "complete": duties.clock_out_shift}[operation]
        row = transition(row.pk, scope_actor=actor)
    else:
        holder = row if source == "LOG" else ensure_supplement(source, row, supplement, metadata, actor)
        moment = safe_moment(Clock.now() if operation == "acknowledge" or at is None else at, "at")
        if moment > Clock.now() or (operation == "complete" and moment < holder.actual_start):
            raise DomainError("VALIDATION_ERROR", 422, detail={"at": ["Время не может быть в будущем или раньше начала."]}, message="Проверьте фактическое время.")
        field, author = {"acknowledge": ("acknowledged_at", "acknowledged_by"), "start": ("actual_start", "started_by"), "complete": ("actual_end", "completed_by")}[operation]
        setattr(holder, field, moment)
        setattr(holder, author, actor)
        holder.updated_at = Clock.now()
        fields = [field, author, "updated_at"]
        if source == "LOG":
            holder.revision += 1
            fields.append("revision")
        holder.save(update_fields=fields)
        if source != "LOG":
            supplement = holder
    record_audit(actor, action, source, row, supplement, metadata, old)
    return serialize_record(source, row, supplement, metadata, actor=actor)


@transaction.atomic
def cancel_record(actor, key, reason):
    source, _ = parse_key(key)
    if source == "DISPATCH":
        # Same order as the legacy writer: config before assignment.
        from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchConfig
        OpsDutyDispatchConfig.objects.select_for_update().filter(singleton_key=1).first()
    source, row, supplement, metadata = resolve_record(actor, key, write=True, lock=True)
    old = serialize_record(source, row, supplement, metadata)
    if old["state"] == "CANCELLED":
        return serialize_record(source, row, supplement, metadata, actor=actor)
    if old["state"] not in ("PLANNED", "ACKNOWLEDGED"):
        raise DomainError("INVALID_STATE_TRANSITION", 422, message="Начатую смену завершите; отмена доступна до её начала.")
    if source == "DISPATCH":
        from organization_management.apps.ops import duty_dispatch
        duty_dispatch.cancel_assignment(actor, row.pk, reason)
        row.refresh_from_db()
    elif source == "PLAN":
        from organization_management.apps.ops import duties
        row = duties.cancel_shift(row.pk, reason=reason, actor=actor, scope_actor=actor)
    else:
        row.cancelled_at, row.cancelled_by, row.cancelled_reason, row.updated_at = Clock.now(), actor, reason, Clock.now()
        row.revision += 1
        row.save(update_fields=["cancelled_at", "cancelled_by", "cancelled_reason", "updated_at", "revision"])
        record_audit(actor, audit_service.DUTY_LOG_CANCELLED, source, row, supplement, metadata, old, reason)
    return serialize_record(source, row, supplement, metadata, actor=actor)


@transaction.atomic
def update_record(actor, key, data):
    source, row, supplement, metadata = resolve_record(actor, key, write=True, lock=True)
    old = serialize_record(source, row, supplement, metadata)
    if source != "LOG" or old["state"] not in ("PLANNED", "ACKNOWLEDGED"):
        raise DomainError("INVALID_STATE_TRANSITION", 422, message="Плановую запись можно исправить до начала самостоятельного дежурства.")
    if row.revision != data["expected_revision"]:
        raise DomainError("DUTY_REGISTER_CONFLICT", 409, message="Запись уже изменена. Обновите её и проверьте правку.")
    first, last = valid_interval(data.get("planned_start", row.planned_start), data.get("planned_end", row.planned_end))
    data = dict(data)
    if "planned_start" in data:
        data["planned_start"] = first
    if "planned_end" in data:
        data["planned_end"] = last
    fields = []
    for name in ("planned_start", "planned_end", "location_label", "document_basis", "note"):
        if name in data:
            setattr(row, name, data[name])
            fields.append(name)
    row.revision += 1
    row.updated_at = Clock.now()
    row.save(update_fields=[*fields, "revision", "updated_at"])
    record_audit(actor, audit_service.DUTY_LOG_UPDATED, source, row, supplement, metadata, old, data["reason"])
    return serialize_record(source, row, supplement, metadata, actor=actor)
