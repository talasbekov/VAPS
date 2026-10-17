"""План дежурств — серверная реализация контракта клиента (entities/duty-shift).

Правила, тексты и производные (конфликты, action policy шапки, отпечаток
плана) — порт чистой модели клиента (conflicts.ts, plan-lifecycle.ts) и его
мок-слоя (duties-handlers.ts) ДОСЛОВНО. Права шапки — настоящие (RBAC
актора), а не хардкод «всё можно» мока: причина недоступности кнопки называет
недостающее право.
"""
import datetime as dt
import hashlib

from django.db import connection, transaction
from django.db.models import CharField
from django.db.models.functions import Cast

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy,
    OpsDutyMonthlyPlan,
    OpsDutyShift,
    OpsDutyType,
)
from organization_management.apps.operations.models_object import (
    OpsSecurityObject,
)
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.ops.security_events import (
    personnel_display_name,
    resolve_applicable_version,
)


# Older internal callers supply an audit actor, not an authorization identity.
# Every HTTP caller must pass scope_actor explicitly; None denies access.
_TRUSTED_SCOPE = object()
_MAX_IDENTIFIER = 9223372036854775807


def _actor_scope(actor, permission):
    if actor is _TRUSTED_SCOPE:
        return None
    if actor is None:
        return set()
    return PermissionService.visible_division_ids(actor, permission)


def _permission_denied():
    return DomainError(
        "PERMISSION_DENIED", 403,
        message="Запись находится вне доступной области подразделений.",
    )


def _identifier(value):
    raw = str(value or "")
    if (not raw.isascii() or not raw.isdigit() or len(raw) > 19
            or raw.startswith("0") or int(raw) > _MAX_IDENTIFIER):
        return None
    return int(raw)


def visible_shifts(actor, permission="duty.view"):
    """Live legacy payloads follow the current canonical employee placement.

    A frozen journal supplement authorizes its historical journal projection,
    not the live planner payload. Names and malformed IDs never imply scope.
    """
    from organization_management.apps.employees.models import Employee

    rows = OpsDutyShift.objects.all()
    scope = _actor_scope(actor, permission)
    if scope is None:
        return rows
    people = Employee.objects.filter(pk__gt=0, staff_unit__division_id__in=scope)
    keys = people.annotate(legacy_id=Cast("pk", output_field=CharField())).values("legacy_id")
    return rows.filter(employee_id__in=keys)


def _require_row_access(actor, row, permission):
    if actor is not _TRUSTED_SCOPE and not visible_shifts(actor, permission).filter(pk=row.pk).exists():
        raise _permission_denied()


def require_shift_access(actor, shift_id, permission="duty.view"):
    key = _identifier(shift_id)
    row = OpsDutyShift.objects.filter(pk=key).first() if key else None
    if row is None:
        raise _shift_not_found(shift_id)
    _require_row_access(actor, row, permission)
    return row


def _require_global_scope(actor, permission):
    if _actor_scope(actor, permission) is not None:
        raise DomainError(
            "PERMISSION_DENIED", 403,
            message="Общий месячный план требует права без ограничения подразделением.",
        )


def _require_object_catalog(actor):
    # Security objects have no division owner. Their shared catalog has its
    # own permission; employee scope must never be guessed from object names.
    if _actor_scope(actor, "duty.manage") is not None and (
            actor is None or not PermissionService.has_permission(actor, "object.view")):
        raise DomainError(
            "PERMISSION_DENIED", 403,
            message="Для общего каталога объектов нужно право просмотра объектов.",
        )


def _now_iso():
    return Clock.now().isoformat()


def _validation(field_errors):
    return DomainError(
        "VALIDATION_ERROR", 400, detail=field_errors,
        message="Проверьте заполнение формы.",
    )


def _shift_not_found(shift_id):
    return DomainError(
        "ENTITY_NOT_FOUND", 404, detail={"id": str(shift_id)},
        message="Смена не найдена.",
    )


def read_conflict_policy():
    """Политика — обязана быть настроена (мерка read_policy паспортов)."""
    policy = OpsDutyConflictPolicy.objects.filter(singleton_key=1).first()
    if policy is None:
        raise DomainError(
            "VALIDATION_ERROR", 422,
            detail={"policy": ["Политика конфликтов дежурств не настроена."]},
            message="Политика конфликтов дежурств не настроена.",
        )
    return {
        "restAfterDutyMode": policy.rest_after_duty_mode,
        "conflictPolicyVersion": policy.version,
    }


def serialize_duty_type(duty_type):
    return {
        "dutyTypeCode": duty_type.duty_type_code,
        "safeLabel": duty_type.safe_label,
        "targetType": duty_type.target_type,
        "defaultDurationMinutes": duty_type.default_duration_minutes,
        "requiresSenior": duty_type.requires_senior,
        "restAfterMinutes": duty_type.rest_after_minutes,
        "requiresCurrentPassport": duty_type.requires_current_passport,
    }


def serialize_shift(shift):
    return {
        "id": str(shift.pk),
        "businessDate": shift.business_date.isoformat(),
        "dutyTypeCode": shift.duty_type_code,
        "target": shift.target,
        "employeeName": shift.employee_name,
        "employeeId": shift.employee_id,
        "stateCode": shift.state_code,
        "acknowledgedAt": (
            shift.acknowledged_at.isoformat() if shift.acknowledged_at else None
        ),
        "actualStart": (
            shift.actual_start.isoformat() if shift.actual_start else None
        ),
        "actualEnd": shift.actual_end.isoformat() if shift.actual_end else None,
        "updatedAt": shift.updated_at.isoformat(),
        "passportBinding": shift.passport_binding,
        "note": shift.note,
        "cancellation": shift.cancellation,
        "overrideReason": shift.override_reason,
    }


def passport_status_of(shift):
    """Производный взгляд «какая версия действует сейчас» — на каждом чтении."""
    object_id = (shift.target or {}).get("objectId", "")
    security_object = (
        OpsSecurityObject.objects.filter(pk=object_id).first()
        if str(object_id).isdigit()
        else None
    )
    applicable = (
        resolve_applicable_version(security_object, shift.business_date)
        if security_object is not None
        else None
    )
    binding = shift.passport_binding
    return {
        "shiftId": str(shift.pk),
        "objectKnown": security_object is not None,
        "applicableVersionId": str(applicable.pk) if applicable else None,
        "applicableVersionNumber": (
            applicable.version_number if applicable else None
        ),
        "stale": (
            binding is not None
            and applicable is not None
            and applicable.version_number > binding.get("versionNumber", 0)
        ),
    }


# ── Конфликты (порт conflicts.ts) ───────────────────────────────────────────


def _overlap_message(employee_name, date, count):
    return (
        f"{employee_name}: {count} дежурства на {date} — пересечение "
        "недопустимо."
    )


def _rest_message(employee_name, previous_date, next_date, rest_minutes):
    hours = round(rest_minutes / 60)
    return (
        f"{employee_name}: дежурство {next_date} нарушает отдых {hours} ч "
        f"после дежурства {previous_date}."
    )


def detect_conflicts(shifts, duty_types, policy):
    """Пересечение дня — HARD; нарушение отдыха — severity из политики.
    Отменённая смена не занимает. Порт detectDutyConflicts дословно."""
    type_by_code = {t.duty_type_code: t for t in duty_types}
    by_employee = {}
    for shift in shifts:
        if shift.state_code == "CANCELLED":
            continue
        by_employee.setdefault(shift.employee_name, []).append(shift)

    conflicts = []
    for employee_name in sorted(by_employee):
        by_date = {}
        for shift in by_employee[employee_name]:
            by_date.setdefault(shift.business_date, []).append(shift)
        dates = sorted(by_date)
        for date in dates:
            same_day = by_date[date]
            if len(same_day) > 1:
                conflicts.append(
                    {
                        "conflictId": f"overlap:{employee_name}:{date}",
                        "code": "DUTY_OVERLAP",
                        "severity": "HARD",
                        "employeeName": employee_name,
                        "businessDate": date.isoformat(),
                        "message": _overlap_message(
                            employee_name, date.isoformat(), len(same_day)
                        ),
                        "policyVersion": policy["conflictPolicyVersion"],
                    }
                )
        for index in range(1, len(dates)):
            previous_date, next_date = dates[index - 1], dates[index]
            # отдых — от конца предыдущего дня; между днями ровно
            # (Δсуток − 1) полных суток
            free_minutes = ((next_date - previous_date).days - 1) * 24 * 60
            for previous in by_date[previous_date]:
                duty_type = type_by_code.get(previous.duty_type_code)
                if duty_type is None or duty_type.rest_after_minutes <= 0:
                    continue
                if free_minutes >= duty_type.rest_after_minutes:
                    continue
                conflicts.append(
                    {
                        "conflictId": (
                            f"rest:{employee_name}:{previous_date}:{next_date}"
                        ),
                        "code": "REST_AFTER_DUTY",
                        "severity": (
                            "HARD"
                            if policy["restAfterDutyMode"] == "HARD_BLOCK"
                            else "SOFT"
                        ),
                        "employeeName": employee_name,
                        "businessDate": next_date.isoformat(),
                        "message": _rest_message(
                            employee_name,
                            previous_date.isoformat(),
                            next_date.isoformat(),
                            duty_type.rest_after_minutes,
                        ),
                        "policyVersion": policy["conflictPolicyVersion"],
                    }
                )
                break
    return sorted(
        conflicts, key=lambda c: (c["businessDate"], c["conflictId"])
    )


# ── Месячный план (порт plan-lifecycle.ts) ──────────────────────────────────

_NO_MANAGE_REASON = "Нужно право планирования дежурств (ops.duty.manage)."
_NO_APPROVE_REASON = "Нужно право утверждения плана (ops.duty.approve_plan)."
_PLAN_STATE_LABEL = {"DRAFT": "черновик", "APPROVED": "утверждён"}


def month_shifts(month, *, scope_actor=_TRUSTED_SCOPE):
    month = _require_month(month)
    year, month_number = int(month[:4]), int(month[5:7])
    return list(
        visible_shifts(scope_actor).filter(
            business_date__year=year, business_date__month=month_number
        )
    )


def plan_fingerprint(shifts):
    """Активные смены месяца + их updatedAt; отменённая выпадает."""
    return "|".join(
        sorted(
            f"{shift.pk}@{shift.updated_at.isoformat()}"
            for shift in shifts
            if shift.state_code != "CANCELLED"
        )
    )


def serialize_plan(record):
    if record is None:
        return None
    return {
        "month": record.month,
        "stateCode": record.state_code,
        "revision": record.revision,
        "createdAt": record.created_at.isoformat(),
        "lastValidation": record.last_validation,
        "approvedAt": (
            record.approved_at.isoformat() if record.approved_at else None
        ),
        "approvedBy": record.approved_by or None,
        "history": record.history,
    }


def _validation_current(record, fingerprint):
    return (
        record is not None
        and record.last_validation is not None
        and record.last_validation.get("planFingerprint") == fingerprint
    )


def build_plan_actions(record, rights, validation_is_current):
    """Action policy шапки: все действия всегда, недоступные — с причиной."""
    state = record.state_code if record is not None else None

    def action(code, label, enabled, reason=None):
        return {
            "code": code, "label": label,
            "enabled": enabled, "reason": reason,
        }

    def create_draft():
        label = "Сформировать черновик"
        if not rights["canManage"]:
            return action("CREATE_DRAFT", label, False, _NO_MANAGE_REASON)
        if record is not None:
            return action(
                "CREATE_DRAFT", label, False,
                f"План на этот месяц уже создан (редакция {record.revision}, "
                f"{_PLAN_STATE_LABEL[record.state_code]}).",
            )
        return action("CREATE_DRAFT", label, True)

    def check_conflicts():
        label = "Проверить конфликты"
        if not rights["canManage"]:
            return action("CHECK_CONFLICTS", label, False, _NO_MANAGE_REASON)
        if record is None:
            return action(
                "CHECK_CONFLICTS", label, False,
                "Плана на этот месяц нет — сначала сформируйте черновик.",
            )
        if state == "APPROVED":
            return action(
                "CHECK_CONFLICTS", label, False,
                "План утверждён и закрыт для изменений: проверять нечего до "
                "открытия новой редакции.",
            )
        return action("CHECK_CONFLICTS", label, True)

    def approve():
        label = "Утвердить план"
        if not rights["canApprove"]:
            return action("APPROVE", label, False, _NO_APPROVE_REASON)
        if record is None:
            return action(
                "APPROVE", label, False,
                "Плана на этот месяц нет — сначала сформируйте черновик.",
            )
        if state == "APPROVED":
            return action("APPROVE", label, False, "План уже утверждён.")
        if record.last_validation is None:
            return action(
                "APPROVE", label, False,
                "Проверка конфликтов не проводилась — она обязательна перед "
                "утверждением.",
            )
        if not validation_is_current:
            return action(
                "APPROVE", label, False,
                "Состав месяца менялся после последней проверки — проверьте "
                "конфликты заново.",
            )
        if not record.last_validation.get("passed"):
            return action(
                "APPROVE", label, False,
                "Проверка нашла жёстких конфликтов: "
                f"{record.last_validation.get('hardConflicts')}. Их нельзя "
                "обойти обоснованием.",
            )
        return action("APPROVE", label, True)

    def reopen():
        label = "Открыть новую редакцию"
        if not rights["canApprove"]:
            return action("REOPEN", label, False, _NO_APPROVE_REASON)
        if state != "APPROVED":
            return action(
                "REOPEN", label, False,
                "Новая редакция открывается только для утверждённого плана.",
            )
        return action("REOPEN", label, True)

    def add_shift():
        label = "Добавить дежурство"
        if not rights["canManage"]:
            return action("ADD_SHIFT", label, False, _NO_MANAGE_REASON)
        if state == "APPROVED":
            return action(
                "ADD_SHIFT", label, False,
                f"План месяца утверждён (редакция {record.revision}) — "
                "изменения только в новой редакции.",
            )
        return action("ADD_SHIFT", label, True)

    return [create_draft(), check_conflicts(), approve(), reopen(), add_shift()]


def monthly_plan_response(month, rights, *, scope_actor=_TRUSTED_SCOPE):
    record = OpsDutyMonthlyPlan.objects.filter(month=month).first()
    shifts = month_shifts(month, scope_actor=scope_actor)
    duty_types = list(OpsDutyType.objects.all())
    policy = read_conflict_policy()
    conflicts = detect_conflicts(shifts, duty_types, policy)
    fingerprint = plan_fingerprint(shifts)
    active = [s for s in shifts if s.state_code != "CANCELLED"]
    shifts_sorted = sorted(shifts, key=lambda s: (s.business_date, s.pk))
    serialized = serialize_plan(record)
    scoped = _actor_scope(scope_actor, "duty.view") is not None
    action_rights = dict(rights)
    if scoped and serialized is not None:
        serialized.update(lastValidation=None, history=[], approvedBy=None)
    if _actor_scope(scope_actor, "duty.manage") is not None:
        action_rights["canManage"] = False
    if _actor_scope(scope_actor, "duty.approve_plan") is not None:
        action_rights["canApprove"] = False
    actions = build_plan_actions(record, action_rights, _validation_current(record, fingerprint))
    if rights["canManage"]:
        # Adding an employee's scoped shift is independent of changing the
        # single organization-wide monthly lifecycle.
        actions[-1] = build_plan_actions(record, rights, False)[-1]
    return {
        "month": month,
        "record": serialized,
        "actions": actions,
        "shifts": [serialize_shift(s) for s in shifts_sorted],
        "passportStatuses": [passport_status_of(s) for s in shifts_sorted],
        "conflicts": conflicts,
        "conflictPolicy": policy,
        "kpi": {
            "totalShifts": len(shifts),
            "activeShifts": len(active),
            "cancelledShifts": len(shifts) - len(active),
            "hardConflicts": sum(
                1 for c in conflicts if c["severity"] == "HARD"
            ),
            "softConflicts": sum(
                1 for c in conflicts if c["severity"] == "SOFT"
            ),
        },
    }


def _require_month(month):
    if isinstance(month, str):
        try:
            first_day = dt.date.fromisoformat(month + "-01")
        except ValueError:
            pass
        else:
            if first_day.isoformat()[:7] == month:
                return month
    # A calendar alias must not acquire a different advisory lock for the
    # same shifts. Accept exactly the canonical ASCII YYYY-MM month.
    raise _validation({"month": ["Укажите месяц в формате ГГГГ-ММ."]})


@transaction.atomic
def create_draft(month, *, scope_actor=_TRUSTED_SCOPE):
    _require_global_scope(scope_actor, "duty.manage")
    month = _require_month(month)
    if _lock_month(month) is not None:
        raise DomainError(
            "PLAN_ALREADY_EXISTS", 422, message="План на этот месяц уже создан."
        )
    return OpsDutyMonthlyPlan.objects.create(
        month=month,
        state_code="DRAFT",
        revision=1,
        last_validation=None,
        approved_at=None,
        approved_by="",
        history=[
            {
                "at": _now_iso(), "revision": 1,
                "event": "DRAFT_CREATED", "note": "Черновик сформирован.",
            }
        ],
    )


def _lock_month(month):
    """One transaction lock even before a monthly plan row exists.

    All writers acquire month advisory -> monthly row -> shift row. The
    advisory key uses a fixed namespace and stable digest, never Python hash.
    """
    month = _require_month(month)
    key = int.from_bytes(hashlib.sha256(f"ops.duty.month:{month}".encode()).digest()[:8], "big", signed=True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [key])
    return (
        OpsDutyMonthlyPlan.objects.select_for_update()
        .filter(month=month)
        .first()
    )


def _lock_plan(month):
    record = _lock_month(month)
    if record is None:
        raise DomainError(
            "PLAN_NOT_FOUND", 422, message="Плана на этот месяц нет."
        )
    return record


@transaction.atomic
def check_plan(month, *, scope_actor=_TRUSTED_SCOPE):
    _require_global_scope(scope_actor, "duty.manage")
    record = _lock_plan(month)
    if record.state_code == "APPROVED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION", 422,
            message="План утверждён — проверять нечего до открытия новой "
            "редакции.",
        )
    shifts = month_shifts(month)
    conflicts = detect_conflicts(
        shifts, list(OpsDutyType.objects.all()), read_conflict_policy()
    )
    hard = sum(1 for c in conflicts if c["severity"] == "HARD")
    validation = {
        "checkedAt": _now_iso(),
        "hardConflicts": hard,
        "softConflicts": len(conflicts) - hard,
        # жёсткий конфликт — единственное, что валит проверку
        "passed": hard == 0,
        "planFingerprint": plan_fingerprint(shifts),
    }
    record.last_validation = validation
    record.history = [
        *record.history,
        {
            "at": validation["checkedAt"],
            "revision": record.revision,
            "event": "VALIDATED",
            "note": (
                "Проверка пройдена: жёстких 0, мягких "
                f"{validation['softConflicts']}."
                if validation["passed"]
                else f"Жёстких конфликтов: {hard}."
            ),
        },
    ]
    record.save(update_fields=["last_validation", "history", "updated_at"])
    return record


@transaction.atomic
def approve_plan(month, *, actor, scope_actor=_TRUSTED_SCOPE):
    _require_global_scope(scope_actor, "duty.approve_plan")
    record = _lock_plan(month)
    fingerprint = plan_fingerprint(month_shifts(month))
    if (
        record.state_code == "APPROVED"
        or record.last_validation is None
        or record.last_validation.get("planFingerprint") != fingerprint
        or not record.last_validation.get("passed")
    ):
        raise DomainError(
            "PLAN_NOT_APPROVABLE", 422,
            message="Утверждение недоступно: проверьте состояние плана и "
            "актуальность проверки конфликтов.",
        )
    record.state_code = "APPROVED"
    record.approved_at = Clock.now()
    record.approved_by = actor
    record.history = [
        *record.history,
        {
            "at": _now_iso(), "revision": record.revision,
            "event": "APPROVED",
            "note": f"Редакция {record.revision} утверждена.",
        },
    ]
    record.save(
        update_fields=[
            "state_code", "approved_at", "approved_by", "history", "updated_at",
        ]
    )
    return record


@transaction.atomic
def reopen_plan(month, *, scope_actor=_TRUSTED_SCOPE):
    _require_global_scope(scope_actor, "duty.approve_plan")
    record = _lock_month(month)
    if record is None or record.state_code != "APPROVED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION", 422,
            message="Новая редакция открывается только для утверждённого "
            "плана.",
        )
    record.state_code = "DRAFT"
    record.revision += 1
    record.last_validation = None
    record.approved_at = None
    record.approved_by = ""
    record.history = [
        *record.history,
        {
            "at": _now_iso(), "revision": record.revision,
            "event": "REOPENED",
            "note": f"Открыта редакция {record.revision}.",
        },
    ]
    record.save(
        update_fields=[
            "state_code", "revision", "last_validation", "approved_at",
            "approved_by", "history", "updated_at",
        ]
    )
    return record


# ── Создание и жизненный цикл смены ─────────────────────────────────────────


def _plan_locked(business_date):
    record = _lock_month(business_date.isoformat()[:7])
    return record is not None and record.state_code == "APPROVED"


def _find_employee(employee_id):
    from organization_management.apps.employees.models import Employee

    key = _identifier(employee_id)
    if key is None:
        return None
    return Employee.objects.filter(pk=key, is_active=True).first()


@transaction.atomic
def create_shift(*, business_date, duty_type_code, object_id, sector_id,
                 post_id, employee_id, note, override, override_reason, actor,
                 scope_actor=_TRUSTED_SCOPE):
    field_errors = {}
    try:
        parsed_date = dt.date.fromisoformat(str(business_date or ""))
    except ValueError:
        parsed_date = None
        field_errors["businessDate"] = ["Укажите дату в формате ГГГГ-ММ-ДД."]
    if not str(duty_type_code or "").strip():
        field_errors["dutyTypeCode"] = ["Выберите вид."]
    if not str(object_id or "").strip():
        field_errors["objectId"] = ["Выберите объект."]
    if not str(employee_id or "").strip():
        field_errors["employeeId"] = ["Выберите сотрудника."]
    if field_errors:
        raise _validation(field_errors)

    if _plan_locked(parsed_date):
        raise DomainError(
            "PLAN_APPROVED_LOCKED", 422,
            message="План месяца утверждён — изменения только в новой "
            "редакции.",
        )
    duty_type = OpsDutyType.objects.filter(
        duty_type_code=duty_type_code
    ).first()
    if duty_type is None:
        raise _validation({"dutyTypeCode": ["Вид дежурства не найден."]})
    employee = _find_employee(employee_id)
    if employee is None:
        raise _validation({"employeeId": ["Сотрудник не найден."]})
    scope = _actor_scope(scope_actor, "duty.manage")
    if scope is not None and not employee.__class__.objects.filter(
            pk=employee.pk, staff_unit__division_id__in=scope).exists():
        raise _permission_denied()
    _require_object_catalog(scope_actor)
    from organization_management.apps.ops.duty_dispatch import guard_legacy_placement
    guard_legacy_placement(employee.pk, parsed_date, parsed_date)
    security_object = (
        OpsSecurityObject.objects.filter(pk=_identifier(object_id)).first()
        if _identifier(object_id) is not None
        else None
    )
    if security_object is None:
        raise _validation({"objectId": ["Объект не найден в реестре."]})
    applicable = resolve_applicable_version(security_object, parsed_date)
    sector = post = None
    if applicable is not None:
        sector = next(
            (
                s
                for s in applicable.sectors_snapshot
                if s.get("id") == sector_id
            ),
            None,
        )
        post = next(
            (
                p
                for p in (sector or {}).get("posts", [])
                if p.get("id") == post_id
            ),
            None,
        )
    if duty_type.requires_current_passport and (
        applicable is None or post is None
    ):
        raise DomainError(
            "PASSPORT_REQUIRED", 422,
            message="Вид дежурства требует действующей версии паспорта и "
            "поста из неё.",
        )

    employee_key = str(employee.pk)
    employee_name = personnel_display_name(employee)
    active = list(OpsDutyShift.objects.exclude(state_code="CANCELLED"))
    # жёсткое правило: пересечение с другим дежурством в тот же день
    if any(
        s.employee_id == employee_key and s.business_date == parsed_date
        for s in active
    ):
        raise DomainError(
            "DUTY_OVERLAP", 422,
            message=f"{employee_name} уже назначен(а) на дежурство "
            f"{parsed_date.isoformat()} — пересечение недопустимо.",
        )

    # мягкое правило: отдых после дежурства (режим — из политики)
    reason = str(override_reason or "").strip() if override is True else ""
    policy = read_conflict_policy()
    probe = OpsDutyShift(
        business_date=parsed_date,
        duty_type_code=duty_type_code,
        target={},
        employee_name=employee_name,
        employee_id=employee_key,
        state_code="PLANNED",
    )
    probe.updated_at = Clock.now()
    rest_conflicts = [
        c
        for c in detect_conflicts(
            [s for s in active if s.employee_id == employee_key] + [probe],
            list(OpsDutyType.objects.all()),
            policy,
        )
        if c["code"] == "REST_AFTER_DUTY"
    ]
    if rest_conflicts:
        if any(c["severity"] == "HARD" for c in rest_conflicts):
            raise DomainError(
                "REST_AFTER_DUTY", 422, message=rest_conflicts[0]["message"]
            )
        if reason == "":
            raise DomainError(
                "DUTY_CONFLICT_DETECTED", 409,
                detail={
                    "conflicts": [
                        {
                            "conflict_code": c["code"],
                            "severity": c["severity"],
                            "employee_id": employee_key,
                            "message": c["message"],
                        }
                        for c in rest_conflicts
                    ]
                },
                overridable=True,
                message=rest_conflicts[0]["message"],
            )

    now = _now_iso()
    binding = None
    if applicable is not None and sector is not None and post is not None:
        binding = {
            "objectId": str(security_object.pk),
            "objectName": security_object.name,
            "versionId": str(applicable.pk),
            "versionNumber": applicable.version_number,
            "effectiveFrom": applicable.effective_from.isoformat(),
            "sectorId": sector.get("id"),
            "sectorName": sector.get("name"),
            "postId": post.get("id"),
            "postName": post.get("name"),
            "boundAt": now,
        }
    shift = OpsDutyShift.objects.create(
        business_date=parsed_date,
        duty_type_code=duty_type_code,
        target={
            "targetType": duty_type.target_type,
            "objectId": str(security_object.pk),
            "safeLabel": security_object.name,
        },
        employee_name=employee_name,
        employee_id=employee_key,
        state_code="PLANNED",
        acknowledged_at=None,
        actual_start=None,
        actual_end=None,
        passport_binding=binding,
        note=(str(note).strip() if note and str(note).strip() else None),
        cancellation=None,
        # обоснование хранится только при реально возникшем мягком конфликте
        override_reason=(reason if rest_conflicts and reason != "" else None),
    )
    audit_service.record(
        actor=actor,
        action=audit_service.DUTY_SHIFT_CREATED,
        entity_type=audit_service.ENTITY_DUTY_SHIFT,
        entity_id=shift.pk,
        new_value={
            "businessDate": shift.business_date.isoformat(),
            "employeeName": shift.employee_name,
        },
        reason=shift.override_reason or "",
    )
    return shift


def _lock_shift(shift_id):
    key = _identifier(shift_id)
    if key is None:
        raise _shift_not_found(shift_id)
    day = OpsDutyShift.objects.filter(pk=key).values_list("business_date", flat=True).first()
    if day is None:
        raise _shift_not_found(shift_id)
    # business_date is immutable through all service and API writers.
    _lock_month(day.isoformat()[:7])
    shift = (
        OpsDutyShift.objects.select_for_update().filter(pk=key).first()
    )
    if shift is None:
        raise _shift_not_found(shift_id)
    return shift


@transaction.atomic
def cancel_shift(shift_id, *, reason, actor, scope_actor=_TRUSTED_SCOPE):
    shift = _lock_shift(shift_id)
    _require_row_access(scope_actor, shift, "duty.manage")
    reason = str(reason or "").strip()
    if reason == "":
        raise _validation({"reason": ["Укажите причину отмены."]})
    if shift.state_code not in ("PLANNED", "ACKNOWLEDGED"):
        raise DomainError(
            "INVALID_STAGE_TRANSITION", 422,
            message="Отменить можно только ещё не начатую смену.",
        )
    if _plan_locked(shift.business_date):
        raise DomainError(
            "PLAN_APPROVED_LOCKED", 422,
            message="План месяца утверждён — изменения только в новой "
            "редакции.",
        )
    old_state = shift.state_code
    shift.state_code = "CANCELLED"
    shift.cancellation = {"reason": reason, "cancelledAt": _now_iso()}
    shift.save(update_fields=["state_code", "cancellation", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.DUTY_SHIFT_CANCELLED,
        entity_type=audit_service.ENTITY_DUTY_SHIFT,
        entity_id=shift.pk,
        old_value={"stateCode": old_state},
        new_value={"stateCode": "CANCELLED"},
        reason=reason,
    )
    return shift


def _transition(shift_id, from_state, to_state, message, *, scope_actor=_TRUSTED_SCOPE, **stamps):
    shift = _lock_shift(shift_id)
    _require_row_access(scope_actor, shift, "duty.manage")
    if shift.state_code != from_state:
        raise DomainError("INVALID_STAGE_TRANSITION", 422, message=message)
    shift.state_code = to_state
    update_fields = ["state_code", "updated_at"]
    for field in stamps:
        setattr(shift, field, Clock.now())
        update_fields.append(field)
    shift.save(update_fields=update_fields)
    return shift


@transaction.atomic
def acknowledge_shift(shift_id, *, scope_actor=_TRUSTED_SCOPE):
    return _transition(
        shift_id, "PLANNED", "ACKNOWLEDGED",
        "Ознакомление отмечается на запланированной смене.",
        scope_actor=scope_actor, acknowledged_at=True,
    )


@transaction.atomic
def clock_in_shift(shift_id, *, scope_actor=_TRUSTED_SCOPE):
    return _transition(
        shift_id, "ACKNOWLEDGED", "ACTIVE",
        "Заступить можно после ознакомления.",
        scope_actor=scope_actor, actual_start=True,
    )


@transaction.atomic
def clock_out_shift(shift_id, *, scope_actor=_TRUSTED_SCOPE):
    return _transition(
        shift_id, "ACTIVE", "COMPLETED",
        "Завершить можно только смену на дежурстве.",
        scope_actor=scope_actor, actual_end=True,
    )


# ── Справочные выборки формы создания ───────────────────────────────────────


def plan_objects(business_date, *, scope_actor=_TRUSTED_SCOPE):
    _require_object_catalog(scope_actor)
    results = []
    for security_object in OpsSecurityObject.objects.prefetch_related(
        "passport_versions"
    ):
        applicable = resolve_applicable_version(security_object, business_date)
        results.append(
            {
                "objectId": str(security_object.pk),
                "objectName": security_object.name,
                "objectCode": security_object.code,
                "passportState": security_object.passport_state,
                "applicableVersionId": (
                    str(applicable.pk) if applicable else None
                ),
                "applicableVersionNumber": (
                    applicable.version_number if applicable else None
                ),
                "applicableVersionEffectiveFrom": (
                    applicable.effective_from.isoformat()
                    if applicable
                    else None
                ),
                "sectors": (
                    [
                        {
                            "sectorId": sector.get("id"),
                            "sectorName": sector.get("name"),
                            "posts": [
                                {
                                    "postId": post.get("id"),
                                    "postName": post.get("name"),
                                    "task": post.get("task", ""),
                                    "requirements": post.get(
                                        "requirements", ""
                                    ),
                                }
                                for post in sector.get("posts", [])
                            ],
                        }
                        for sector in applicable.sectors_snapshot
                    ]
                    if applicable
                    else []
                ),
                "blockReason": (
                    None
                    if applicable is not None
                    else "На эту дату нет опубликованной версии паспорта — "
                    "посты взять неоткуда."
                ),
            }
        )
    return results


def duty_candidates(business_date, *, scope_actor=_TRUSTED_SCOPE):
    from organization_management.apps.employees.models import Employee

    active = list(OpsDutyShift.objects.exclude(state_code="CANCELLED"))
    employees = (
        Employee.objects.filter(is_active=True)
        .select_related("rank", "staff_unit__division")
        .order_by("last_name", "first_name", "id")
    )
    scope = _actor_scope(scope_actor, "duty.manage")
    if scope is not None:
        employees = employees.filter(staff_unit__division_id__in=scope)
    results = []
    for employee in employees:
        key = str(employee.pk)
        person_shifts = [s for s in active if s.employee_id == key]
        future = sorted(
            s.business_date
            for s in person_shifts
            if s.business_date >= business_date
        )
        try:
            staff_unit = employee.staff_unit
        except Employee.staff_unit.RelatedObjectDoesNotExist:
            staff_unit = None
        results.append(
            {
                "employeeId": key,
                "employeeName": personnel_display_name(employee),
                "unitName": (
                    staff_unit.division.name
                    if staff_unit is not None and staff_unit.division
                    else ""
                ),
                "positionName": employee.rank.name if employee.rank else "",
                "nearestDutyDate": (
                    future[0].isoformat() if future else None
                ),
                "busyOnRequestedDate": any(
                    s.business_date == business_date for s in person_shifts
                ),
            }
        )
    return results


def shift_detail(shift_id, *, scope_actor=_TRUSTED_SCOPE):
    shift = require_shift_access(scope_actor, shift_id)
    policy = read_conflict_policy()
    duty_types = list(OpsDutyType.objects.all())
    day_conflicts = [
        c
        for c in detect_conflicts(
            list(
                visible_shifts(scope_actor).filter(employee_name=shift.employee_name)
            ),
            duty_types,
            policy,
        )
        if c["businessDate"] == shift.business_date.isoformat()
    ]
    duty_type = next(
        (t for t in duty_types if t.duty_type_code == shift.duty_type_code),
        None,
    )
    return {
        "shift": serialize_shift(shift),
        "passportStatus": passport_status_of(shift),
        "dutyType": serialize_duty_type(duty_type) if duty_type else None,
        "conflicts": day_conflicts,
        "conflictPolicy": policy,
    }
