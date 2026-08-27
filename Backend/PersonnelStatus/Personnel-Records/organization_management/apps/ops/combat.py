"""Боевые группы на Трассе — серверная реализация мок-контракта клиента
(mocks/ops/combat-handlers.ts) дословно: тексты, коды и правила §24.

Все мутации — под select_for_update строки смены (документ-агрегат).
DOUBLE_ASSIGNMENT (§24.17): сотрудник не может быть ПРИНЯТ в две боевые
группы на одну дату; правило проверяется и на подаче, и на замене.
"""
import datetime as dt

from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_combat import (
    OpsCombatDutyShift,
    OpsCombatDutyType,
    OpsCombatRoute,
)


def _now_iso():
    return Clock.now().isoformat()


def _not_found(shift_id):
    return DomainError(
        "ENTITY_NOT_FOUND", 404, detail={"id": str(shift_id)},
        message="Смена не найдена.",
    )


def serialize_combat_shift(shift):
    return {
        "id": str(shift.pk),
        "businessDate": shift.business_date.isoformat(),
        "dutyTypeCode": shift.duty_type_code,
        # Имя группы («БГ-1») — пустая строка, а не null: экран печатает его
        # рядом с трассой, и «нет имени» для него то же самое, что пустое.
        "groupName": shift.group_name,
        "routeSet": shift.route_set,
        "submission": shift.submission,
        "updatedAt": shift.updated_at.isoformat(),
        "requiredEmployees": shift.required_employees,
    }


def _lock(shift_id):
    if not str(shift_id).isdigit():
        raise _not_found(shift_id)
    shift = (
        OpsCombatDutyShift.objects.select_for_update()
        .filter(pk=shift_id)
        .first()
    )
    if shift is None:
        raise _not_found(shift_id)
    return shift


def _accepted_names_elsewhere(shift):
    """Имена, уже ПРИНЯТЫЕ в другие группы на ту же дату (§24.17)."""
    names = set()
    for other in OpsCombatDutyShift.objects.filter(
        business_date=shift.business_date
    ).exclude(pk=shift.pk):
        submission = other.submission
        if submission is None or submission.get("stateCode") != "ACCEPTED":
            continue
        names.add(submission.get("groupLeaderEmployeeName"))
        names.update(submission.get("memberEmployeeNames", []))
    return names


@transaction.atomic
def create_shift(*, business_date, duty_type_code, route_ids, coverage_mode,
                 required_employees, group_name=""):
    try:
        parsed_date = dt.date.fromisoformat(str(business_date or ""))
    except ValueError:
        raise DomainError(
            "INVALID_BUSINESS_DATE", 422,
            message="Укажите дату в формате ГГГГ-ММ-ДД.",
        )
    route_ids = list(route_ids or [])
    if not route_ids:
        raise DomainError(
            "EMPTY_ROUTE_SET", 422, message="Укажите хотя бы одну Трассу."
        )
    if int(required_employees or 0) < 1:
        raise DomainError(
            "INVALID_REQUIREMENT", 422,
            message="Требуемая численность должна быть не менее 1.",
        )
    duty_type = OpsCombatDutyType.objects.filter(
        duty_type_code=duty_type_code
    ).first()
    if duty_type is None:
        raise DomainError(
            "UNKNOWN_DUTY_TYPE", 422, message="Неизвестный вид дежурства."
        )
    if not duty_type.supports_multiple_routes and len(route_ids) > 1:
        raise DomainError(
            "TOO_MANY_ROUTES", 422,
            message="Этот вид дежурства не поддерживает несколько Трасс.",
        )
    routes = {r.route_code: r for r in OpsCombatRoute.objects.all()}
    if any(route_id not in routes for route_id in route_ids):
        raise DomainError("UNKNOWN_ROUTE", 422, message="Неизвестная Трасса.")
    shift = OpsCombatDutyShift.objects.create(
        business_date=parsed_date,
        duty_type_code=duty_type_code,
        route_set={
            "routeSetId": f"route-set-{route_ids[0]}-{parsed_date.isoformat()}",
            "safeLabel": ", ".join(
                routes[route_id].safe_label for route_id in route_ids
            ),
            "coverageMode": coverage_mode,
            "routeIds": route_ids,
        },
        submission=None,
        required_employees=int(required_employees),
        group_name=str(group_name or "").strip()[:64],
    )
    return shift


@transaction.atomic
def submit_roster(shift_id, *, group_leader, members, reserve, submitted_by_unit):
    if not str(group_leader or "").strip() or not list(members or []):
        raise DomainError("EMPTY_GROUP", 422, message=
            "Укажите старшего группы и не менее одного участника.",
        )
    shift = _lock(shift_id)
    submission = shift.submission
    if submission is not None and submission.get("stateCode") != "RETURNED":
        raise DomainError("ALREADY_SUBMITTED", 422, message=
            "Состав уже подан и ожидает либо прошёл рассмотрение — повторная "
            "подача недоступна.",
        )
    proposed = {group_leader, *members, *(reserve or [])}
    if proposed & _accepted_names_elsewhere(shift):
        raise DomainError("DOUBLE_ASSIGNMENT", 422, message=
            "Один или несколько сотрудников уже приняты в другую боевую "
            "группу на эту дату.",
        )
    now = _now_iso()
    shift.submission = {
        "submittedByUnitName": submitted_by_unit,
        "groupLeaderEmployeeName": group_leader,
        "memberEmployeeNames": list(members),
        "reserveEmployeeNames": list(reserve or []),
        "stateCode": "SUBMITTED",
        "returnReason": None,
        "submittedAt": now,
        "updatedAt": now,
        "execution": None,
        "replacements": [],
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift


@transaction.atomic
def review_roster(shift_id, *, decision, return_reason):
    if decision == "RETURN" and not str(return_reason or "").strip():
        raise DomainError("REASON_REQUIRED", 422, message= "Причина возврата обязательна.")
    shift = _lock(shift_id)
    submission = shift.submission
    if submission is None or submission.get("stateCode") != "SUBMITTED":
        raise DomainError("INVALID_STATE_TRANSITION", 422, message=
            "Рассмотреть можно только поданный и ещё не рассмотренный состав.",
        )
    now = _now_iso()
    accepted = decision == "ACCEPT"
    shift.submission = {
        **submission,
        "stateCode": "ACCEPTED" if accepted else "RETURNED",
        "returnReason": None if accepted else return_reason,
        # Принятие открывает пост-lifecycle ознакомления; возврат execution
        # не трогает.
        "execution": (
            {
                "stateCode": "PENDING_ACKNOWLEDGEMENT",
                "acknowledgedMemberNames": [],
                "actualStart": None,
                "actualEnd": None,
                "actualMemberNames": None,
                "handover": None,
            }
            if accepted
            else submission.get("execution")
        ),
        "updatedAt": now,
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift


def _require_accepted_execution(shift):
    submission = shift.submission
    if (
        submission is None
        or submission.get("stateCode") != "ACCEPTED"
        or submission.get("execution") is None
    ):
        return None
    return submission


@transaction.atomic
def acknowledge(shift_id, *, employee_name):
    shift = _lock(shift_id)
    submission = _require_accepted_execution(shift)
    if submission is None:
        raise DomainError("INVALID_STATE_TRANSITION", 422, message=
            "Ознакомиться можно только с принятым составом.",
        )
    execution = submission["execution"]
    if execution.get("stateCode") != "PENDING_ACKNOWLEDGEMENT":
        raise DomainError("INVALID_STATE_TRANSITION", 422, message=
            "Ознакомление уже завершено для всего состава.",
        )
    required = [
        submission["groupLeaderEmployeeName"],
        *submission["memberEmployeeNames"],
    ]
    if employee_name not in required:
        raise DomainError("NOT_IN_ROSTER", 422, message=
            "Ознакомиться может только старший или участник основного "
            "состава.",
        )
    acknowledged = execution.get("acknowledgedMemberNames", [])
    if employee_name in acknowledged:
        raise DomainError("ALREADY_ACKNOWLEDGED", 422, message=
            "Этот сотрудник уже подтвердил ознакомление.",
        )
    acknowledged = [*acknowledged, employee_name]
    all_acknowledged = all(name in acknowledged for name in required)
    now = _now_iso()
    shift.submission = {
        **submission,
        "execution": {
            **execution,
            "acknowledgedMemberNames": acknowledged,
            "stateCode": (
                "READY" if all_acknowledged else "PENDING_ACKNOWLEDGEMENT"
            ),
        },
        "updatedAt": now,
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift


@transaction.atomic
def check_in(shift_id):
    shift = _lock(shift_id)
    submission = _require_accepted_execution(shift)
    if submission is None or submission["execution"].get("stateCode") != "READY":
        raise DomainError("INVALID_STATE_TRANSITION", 422, message=
            "Заступить можно только после ознакомления всего состава.",
        )
    now = _now_iso()
    shift.submission = {
        **submission,
        "execution": {
            **submission["execution"],
            "stateCode": "ACTIVE",
            "actualStart": now,
        },
        "updatedAt": now,
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift


@transaction.atomic
def submit_handover(shift_id, *, unresolved_incidents, remarks, confirmed_by):
    if not str(confirmed_by or "").strip():
        raise DomainError("CONFIRMER_REQUIRED", 422, message= "Укажите, кто сдаёт смену.")
    shift = _lock(shift_id)
    submission = _require_accepted_execution(shift)
    if submission is None or submission["execution"].get("stateCode") != "ACTIVE":
        raise DomainError("INVALID_STATE_TRANSITION", 422, message=
            "Сдать смену можно только во время несения службы.",
        )
    required = [
        submission["groupLeaderEmployeeName"],
        *submission["memberEmployeeNames"],
    ]
    if confirmed_by not in required:
        raise DomainError("NOT_IN_ROSTER", 422, message=
            "Сдать смену может только старший или участник основного состава.",
        )
    now = _now_iso()
    shift.submission = {
        **submission,
        "execution": {
            **submission["execution"],
            # повторная подача перезаписывает предыдущую — сдающий может
            # поправить данные до завершения
            "handover": {
                "unresolvedIncidents": str(unresolved_incidents or ""),
                "remarks": str(remarks or ""),
                "confirmedByEmployeeName": confirmed_by,
                "confirmedAt": now,
            },
        },
        "updatedAt": now,
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift


@transaction.atomic
def complete(shift_id, *, actual_member_names):
    shift = _lock(shift_id)
    submission = _require_accepted_execution(shift)
    if submission is None or submission["execution"].get("stateCode") != "ACTIVE":
        raise DomainError("INVALID_STATE_TRANSITION", 422, message= "Завершить можно только начатое дежурство."
        )
    # §24.22: сдача смены — обязательный checkpoint ДО завершения.
    if submission["execution"].get("handover") is None:
        raise DomainError("MISSING_HANDOVER", 422, message= "Перед завершением нужно оформить сдачу смены."
        )
    now = _now_iso()
    shift.submission = {
        **submission,
        "execution": {
            **submission["execution"],
            "stateCode": "COMPLETED",
            "actualEnd": now,
            # §24.23: плановое назначение ≠ фактическое участие
            "actualMemberNames": list(actual_member_names or []),
        },
        "updatedAt": now,
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift


@transaction.atomic
def replace_member(shift_id, *, outgoing, incoming, reason_code, safe_comment):
    if not str(reason_code or "").strip():
        raise DomainError("REASON_REQUIRED", 422, message= "Причина замены обязательна.")
    shift = _lock(shift_id)
    submission = _require_accepted_execution(shift)
    if submission is None or submission["execution"].get("stateCode") not in (
        "PENDING_ACKNOWLEDGEMENT",
        "READY",
    ):
        raise DomainError("INVALID_STATE_TRANSITION", 422, message=
            "Замена возможна только до заступления принятого состава.",
        )
    roster = [
        submission["groupLeaderEmployeeName"],
        *submission["memberEmployeeNames"],
    ]
    if outgoing not in roster:
        raise DomainError("NOT_IN_ROSTER", 422, message= "Заменяемый сотрудник не состоит в основном составе."
        )
    if incoming in roster:
        raise DomainError("ALREADY_IN_ROSTER", 422, message=
            "Указанный сотрудник уже состоит в основном составе.",
        )
    if incoming in _accepted_names_elsewhere(shift):
        raise DomainError("DOUBLE_ASSIGNMENT", 422, message=
            "Заменяющий сотрудник уже принят в другую боевую группу на эту "
            "дату.",
        )
    leader = (
        incoming
        if submission["groupLeaderEmployeeName"] == outgoing
        else submission["groupLeaderEmployeeName"]
    )
    members = [
        incoming if name == outgoing else name
        for name in submission["memberEmployeeNames"]
    ]
    required = [leader, *members]
    # Заменённый выбывает из ознакомившихся — новый подтверждает сам (§24.19).
    acknowledged = [
        name
        for name in submission["execution"].get("acknowledgedMemberNames", [])
        if name != outgoing
    ]
    all_acknowledged = all(name in acknowledged for name in required)
    now = _now_iso()
    record = {
        "replacementId": (
            f"{shift.pk}-replacement-{len(submission.get('replacements', [])) + 1}"
        ),
        "outgoingEmployeeName": outgoing,
        "incomingEmployeeName": incoming,
        "reasonCode": reason_code,
        "safeComment": safe_comment,
        "appliedAt": now,
    }
    shift.submission = {
        **submission,
        "groupLeaderEmployeeName": leader,
        "memberEmployeeNames": members,
        "execution": {
            **submission["execution"],
            "acknowledgedMemberNames": acknowledged,
            "stateCode": (
                "READY" if all_acknowledged else "PENDING_ACKNOWLEDGEMENT"
            ),
        },
        "replacements": [*submission.get("replacements", []), record],
        "updatedAt": now,
    }
    shift.save(update_fields=["submission", "updated_at"])
    return shift
