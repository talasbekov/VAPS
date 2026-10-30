"""Receipt-bound execution through the same authenticated manual DRF actions.

The internal request carries the ORIGINAL credentials/session. It reauthenticates
and runs the existing ViewSet.initial and action policies. No force-authentication,
body-supplied actor, service administrator or model-selected endpoint is accepted.
"""
import hashlib
import json
from io import BytesIO

from django.db import transaction
from django.http import HttpRequest
from rest_framework.exceptions import PermissionDenied

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.api.permissions import effective_permissions, resolve_actor_id
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_assistant import OpsAssistantReceipt
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_object import OpsSecurityObject
from . import access, planning
from .progress import assignment_progress


FIELD_KEYS = {"title", "businessDate", "businessDateEnd", "eventTime", "kind", "objectId", "eventId", "allocations", "intent", "personnelTotal"}


class ManualActionFailed(Exception):
    def __init__(self, response):
        self.response = response


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def invalid(message, field="fields"):
    raise DomainError("VALIDATION_ERROR", 400, detail={"field_errors": {field: [message]}}, message=message)


def conflict():
    raise DomainError("ASSISTANT_TASK_CONFLICT", 409, message="Задача уже изменилась. Обновите её и проверьте сохранённый результат.")


def _identifier(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).isdigit() or int(value) <= 0:
        invalid("Некорректный идентификатор.")
    return str(value)


def validate_fields(fields):
    if not isinstance(fields, dict) or set(fields) - FIELD_KEYS:
        invalid("Неизвестные поля задачи.")
    patch = {}
    proposal = {}
    for key in set(fields) & set(planning.TEXT_FIELDS):
        proposal[key] = fields[key]
    if "intent" in fields:
        proposal["intent"] = fields["intent"]
    if "personnelTotal" in fields:
        proposal["personnelTotal"] = fields["personnelTotal"]
    if "objectId" in fields:
        object_id = fields["objectId"]
        if object_id in (None, ""):
            proposal["objectName"] = None
            patch["objectId"] = None
        else:
            obj = OpsSecurityObject.objects.filter(pk=_identifier(object_id)).first()
            if obj is None:
                invalid("Выбранный объект не найден.", "objectId")
            proposal["objectName"] = obj.name
            patch["objectId"] = str(obj.pk)
    if "eventId" in fields:
        patch["eventId"] = _identifier(fields["eventId"]) if fields["eventId"] else None
    if "allocations" in fields:
        rows = fields["allocations"]
        if not isinstance(rows, list) or len(rows) > 50:
            invalid("Некорректный список департаментов.", "allocations")
        proposal["allocations"] = []
        explicit_rows = []
        for row in rows:
            if not isinstance(row, dict) or set(row) - {"departmentId", "need", "dueAt"}:
                invalid("Некорректная строка запроса.", "allocations")
            division = Division.objects.filter(pk=_identifier(row.get("departmentId")), is_active=True, division_type=Division.DivisionType.DEPARTMENT).first()
            if division is None:
                invalid("Выбранный департамент не найден или неактивен.", "allocations")
            proposal["allocations"].append({"departmentName": division.name, "need": row.get("need"), **({"dueAt": row["dueAt"]} if "dueAt" in row else {})})
            explicit_rows.append({"departmentId": str(division.pk), "departmentName": division.name, "need": row.get("need"), **({"dueAt": row["dueAt"]} if row.get("dueAt") else {})})
        if len({row["departmentId"] for row in explicit_rows}) != len(explicit_rows):
            invalid("Один департамент указан несколько раз.", "allocations")
        patch["allocations"] = explicit_rows
    try:
        clean = planning.validate_proposal(proposal)
    except planning.ProposalError as error:
        invalid(str(error))
    patch["proposal"] = {key: clean[key] for key in proposal}
    return patch


def make_plan(proposal, patch, *, actor_id, notice=None):
    source = {**proposal, **patch.get("proposal", {})}
    try:
        plan = planning.resolve_plan(source, actor_id=actor_id)
    except planning.ProposalError as error:
        invalid(str(error))
    for key in ("objectId", "eventId"):
        if key in patch:
            plan[key] = patch[key]
    if patch.get("eventId"):
        plan["questions"] = [q for q in plan["questions"] if q["field"] not in {"title", "businessDate", "kind"}]
    # An explicit catalog selection disambiguates identical object names.
    if "objectId" in patch:
        plan["questions"] = [q for q in plan["questions"] if q["field"] != "objectId"]
    if "allocations" in patch:
        plan["allocations"] = patch["allocations"]
        if patch["allocations"] or plan.get("intent") != "send":
            plan["questions"] = [q for q in plan["questions"] if q["field"] != "allocations"]
    plan["proposal"] = source
    plan["interpretationNotice"] = notice
    return plan


def call_manual(request, action, *, payload=None, event_id=None):
    from organization_management.apps.ops.api.views import SecurityEventViewSet
    actions = {"create": "POST", "retrieve": "GET", "forces_split": "POST"}
    if action not in actions:
        raise ValueError("Unsupported assistant operation")
    raw = HttpRequest()
    raw.method = actions[action]
    raw.path = "/api/ops/security-events/" + (f"{event_id}/" if event_id else "")
    raw.path_info = raw.path
    raw.META = request._request.META.copy()
    raw.META["REQUEST_METHOD"] = raw.method
    raw.META["PATH_INFO"] = raw.path
    raw.META["QUERY_STRING"] = ""
    raw.COOKIES = request._request.COOKIES.copy()
    if hasattr(request._request, "session"):
        raw.session = request._request.session
    raw.user = request.user
    body = json.dumps(payload or {}).encode()
    raw.META["CONTENT_TYPE"] = "application/json"
    raw.META["CONTENT_LENGTH"] = str(len(body))
    raw._body = body
    raw._stream = BytesIO(body)
    raw._read_started = False
    view = SecurityEventViewSet.as_view({raw.method.lower(): action})
    response = view(raw, **({"pk": str(event_id)} if event_id else {}))
    if response.status_code >= 400:
        raise ManualActionFailed(response)
    return response.data


def _save_receipt(task, key, payload, result, request):
    return OpsAssistantReceipt.objects.create(task=task, operation_key=key, payload_hash=digest(payload), executed_by=resolve_actor_id(request), result=result, created_by=resolve_actor_id(request))


def _live_event(request, task):
    if task.event_id:
        return call_manual(request, "retrieve", event_id=task.event_id)
    return None


def _task_questions(task):
    questions = list(task.plan.get("questions", []))
    if (task.plan.get("intent") == "send" and not task.plan.get("allocations")
            and not any(row["field"] == "allocations" for row in questions)
            and not task.receipts.filter(operation_key="send_allocations").exists()):
        questions.append(planning.question("allocations", "Укажите департаменты и количество людей для каждого."))
    return questions


def live_status(task, event):
    if event is None and task.plan.get("eventId"):
        return "event_unavailable"
    if _task_questions(task):
        return "needs_information"
    if event is None:
        return "awaiting_confirmation" if task.plan.get("_reviewBeforeExecute") else "needs_information"
    if task.plan.get("intent") == "send" and not task.receipts.filter(operation_key="send_allocations").exists():
        if event.get("stage") == "CLOSED":
            return "event_unavailable"
        if not event.get("reconForceRequestedAt"):
            return "awaiting_recon"
        return "awaiting_executor" if task.delegated else "prepared"
    if event.get("stage") == "CLOSED":
        return "completed"
    if event.get("stage") in {"APPROVAL", "ACKNOWLEDGEMENT", "CONDUCT"}:
        return "awaiting_approval" if event["stage"] == "APPROVAL" else "completed"
    if task.receipts.filter(operation_key="send_allocations").exists():
        if task.event and task.event.force_handover:
            return "placement"
        return "collecting" if event.get("forceRoster") else "awaiting_department_responses"
    if not event.get("reconForceRequestedAt"):
        return "awaiting_recon"
    if task.plan.get("intent") == "send" and task.delegated:
        return "awaiting_executor"
    return "prepared"


def pending_confirmation(request, task, event):
    """A preview is bound to its actor, proposal and current domain state.

    The token detects stale consent, not authorization. The existing manual API
    reauthenticates and checks all domain permissions again at execution time.
    """
    if not task.plan.get("_reviewBeforeExecute") or _task_questions(task):
        return None
    actor = resolve_actor_id(request)
    blocked_reason = None
    if not event:
        if task.plan.get("eventId") or task.receipts.filter(operation_key="create_bulletin").exists():
            return None
        operation = "create_bulletin"
        can_confirm = task.initiated_by == actor and bool(effective_permissions(request) & {"*", "event.create"})
    else:
        from organization_management.apps.ops.security_events import can_collect_forces
        if (task.plan.get("intent") != "send" or not task.plan.get("allocations")
                or not event.get("reconForceRequestedAt") or not task.event
                or task.event.force_handover or not can_collect_forces(task.event)
                or task.receipts.filter(operation_key="send_allocations").exists()):
            return None
        operation = "send_allocations"
        can_confirm = access.is_headquarters(request)
        proposed = {str(row["departmentId"]): row for row in task.plan["allocations"]}
        for row in event.get("forceAllocation", []):
            if row.get("topUpOf") or row.get("sentAt"):
                continue
            replacement = proposed.get(str(row.get("departmentId")))
            if (replacement is None or row.get("groupDemandIds") or row.get("groupDemands")
                    or row.get("comment") or (row.get("dueAt") and row["dueAt"] != replacement.get("dueAt"))):
                # Legacy execution preserves these conditions. The compact review
                # does not show them, so consent must happen in the full workspace.
                blocked_reason = "В черновиках есть дополнительные условия или другие запросы. Проверьте полный состав и выполните отправку в сборе сил."
                can_confirm = False
                break
    state = {key: event.get(key) for key in (
        "id", "title", "stage", "businessDate", "businessDateEnd", "eventTime", "kind",
        "reconForceRequestedAt", "forceDemandTotal", "forceAllocation",
    )} if event else None
    token = digest({"task": str(task.pk), "actor": actor, "revision": task.revision,
                    "operation": operation, "plan": task.plan, "event": state})
    return {"operation": operation, "canConfirm": can_confirm, "token": token if can_confirm else None,
            **({"blockedReason": blocked_reason} if blocked_reason else {})}


@transaction.atomic
def continue_task(request, pk, *, fields=None, revision=None, confirmation_token=None):
    task = access.lock_task(request, pk)
    actor = resolve_actor_id(request)
    if confirmation_token is not None and task.plan.get("_confirmedActions", {}).get(confirmation_token) == actor:
        # Lost response: return the receipt-bound result; never execute the next action.
        return task
    patch = validate_fields(fields) if fields else None
    if revision is not None and (type(revision) is not int or revision != task.revision):
        # A response lost after commit can replay only the already-saved values.
        old_source = task.plan.get("proposal", {})
        same = patch is not None and all(old_source.get(key) == value for key, value in patch.get("proposal", {}).items())
        same = same and all(task.plan.get(key) == patch[key] for key in ("eventId", "objectId") if key in patch)
        if type(revision) is int and same:
            return task
        conflict()
    if fields:
        if task.initiated_by != actor:
            raise PermissionDenied("PERMISSION_DENIED")
        old = task.plan
        if task.event_id and "eventId" in patch and patch["eventId"] != str(task.event_id):
            conflict()
        if task.receipts.filter(operation_key="create_bulletin").exists():
            immutable = {"title", "businessDate", "businessDateEnd", "eventTime", "kind", "objectId", "eventId"}
            normalized = {**patch.get("proposal", {}), **{key: patch[key] for key in ("eventId", "objectId") if key in patch}}
            if any(key in normalized and normalized[key] != old.get(key) for key in immutable):
                conflict()
        if task.receipts.filter(operation_key="send_allocations").exists() and any(key in fields for key in {"allocations", "intent", "personnelTotal"}):
            conflict()
        preserved = {key: old[key] for key in ("eventId", "objectId") if old.get(key) is not None}
        if not any(q["field"] == "allocations" for q in old.get("questions", [])):
            preserved["allocations"] = old.get("allocations", [])
        task.plan = make_plan(old.get("proposal", {}), {**preserved, **patch}, actor_id=actor)
        for key in ("_reviewBeforeExecute", "_confirmedActions"):
            if key in old:
                task.plan[key] = old[key]
        if "personnelTotal" not in patch.get("proposal", {}):
            task.plan["questions"].extend(row for row in old.get("questions", []) if row["field"] == "personnelTotal")
        task.revision += 1
    plan = task.plan
    if not task.event_id and plan.get("eventId") and task.receipts.exists():
        invalid("Сохранённое мероприятие больше недоступно.", "eventId")
    if plan.get("eventId") and not task.event_id:
        # Resolve/read before persisting a link; it is never a body-supplied owner.
        event = call_manual(request, "retrieve", event_id=plan["eventId"])
        task.event_id = int(event["id"])
    elif not task.event_id and plan.get("eventCode"):
        from organization_management.apps.operations.models_event import OpsSecurityEvent
        event_id = OpsSecurityEvent.objects.filter(code=plan["eventCode"]).values_list("pk", flat=True).first()
        if event_id is None:
            plan["questions"] = [planning.question("eventId", "Мероприятие с этим кодом не найдено. Выберите существующее ОМ.")]
        else:
            event = call_manual(request, "retrieve", event_id=event_id)
            task.event_id = int(event["id"])
            plan["eventId"] = str(event["id"])
    reviewed = plan.get("_reviewBeforeExecute") is True
    approved_operation = None
    if confirmation_token is not None:
        if task.event_id:
            # Match consent against the state protected by the same row lock as
            # the domain write. A task lock alone cannot exclude manual edits.
            from organization_management.apps.operations.models_event import OpsSecurityEvent
            task.event = OpsSecurityEvent.objects.select_for_update().get(pk=task.event_id)
        confirmation = pending_confirmation(request, task, _live_event(request, task))
        if (not reviewed or not confirmation or not confirmation["canConfirm"]
                or confirmation["token"] != confirmation_token):
            conflict()
        approved_operation = confirmation["operation"]
    if not task.event_id and not plan.get("questions") and (not reviewed or approved_operation == "create_bulletin"):
        prior = task.receipts.filter(operation_key="create_bulletin").first()
        if prior is not None:
            invalid("Сохранённый бюллетень больше недоступен. Выберите другое мероприятие.", "eventId")
        payload = {key: plan.get(key) for key in ("title", "businessDate", "businessDateEnd", "eventTime", "kind", "objectId") if plan.get(key) is not None}
        event = call_manual(request, "create", payload=payload)
        task.event_id = int(event["id"])
        plan["eventId"] = str(event["id"])
        _save_receipt(task, "create_bulletin", payload, {"eventId": str(event["id"]), "code": event["code"]}, request)
    event = _live_event(request, task)
    task.delegated = bool(task.event_id and plan.get("intent") == "send" and not access.is_headquarters(request)) or task.delegated
    if (event and not plan.get("questions") and plan.get("intent") == "send" and event.get("reconForceRequestedAt")
            and (not reviewed or approved_operation == "send_allocations")):
        if not plan.get("allocations"):
            plan["questions"] = [planning.question("allocations", "Укажите департаменты и количество людей для каждого.")]
        elif access.is_headquarters(request):
            previous = task.receipts.filter(operation_key="send_allocations").first()
            if previous is None:
                # Preserve every unrelated existing base allocation and its groups;
                # top-ups are kept by the existing splitter, never regenerated here.
                proposed = {str(row["departmentId"]): row for row in plan["allocations"]}
                unrelated_drafts = [row for row in event.get("forceAllocation", []) if not row.get("topUpOf") and not row.get("sentAt") and str(row.get("departmentId")) not in proposed]
                if unrelated_drafts:
                    invalid("В сборе уже есть черновики других департаментов. Проверьте полную рассылку в сборе сил или явно включите их в задачу.", "allocations")
                rows = []
                for row in event.get("forceAllocation", []):
                    if row.get("topUpOf"):
                        continue
                    department_id = str(row.get("departmentId"))
                    if "groupDemandIds" not in row:
                        row = {**row, "groupDemandIds": [str(group["id"]) for group in row.get("groupDemands", [])]}
                    replacement = proposed.pop(department_id, None)
                    if replacement and row.get("sentAt") and int(replacement["need"]) != int(row.get("need", 0)):
                        invalid("Отправленное количество изменяется через довыделение в сборе сил.", "allocations")
                    rows.append({key: value for key, value in {**row, **(replacement or {})}.items() if key in {"departmentId", "need", "dueAt", "comment", "groupDemandIds"}})
                rows.extend({key: value for key, value in row.items() if key in {"departmentId", "need", "dueAt"}} for row in proposed.values())
                payload = {"rows": rows, "draft": False}
                last_audit_id = OpsAuditLog.objects.filter(entity_type="security_event", entity_id=task.event_id, action="FORCE_ALLOCATION_SPLIT", actor_user_id=actor).order_by("-id").values_list("id", flat=True).first() or 0
                event = call_manual(request, "forces_split", payload=payload, event_id=task.event_id)
                report = OpsAuditLog.objects.filter(entity_type="security_event", entity_id=task.event_id, action="FORCE_ALLOCATION_SPLIT", actor_user_id=actor, id__gt=last_audit_id).order_by("-id").first()
                value = report.new_value if report and isinstance(report.new_value, dict) else {}
                targets = {str(row["departmentId"]) for row in plan["allocations"]}
                result = {"eventId": str(task.event_id), "requests": [{key: row.get(key) for key in ("id", "departmentId", "need", "sentAt")} for row in event.get("forceAllocation", []) if row.get("sentAt") and not row.get("topUpOf") and str(row.get("departmentId")) in targets],
                          "delivery": {"known": bool(report), **{key: value[key] for key in ("notifiedOfficers", "unaddressed", "undelivered") if key in value}}}
                _save_receipt(task, "send_allocations", payload, result, request)
    if approved_operation:
        plan.setdefault("_confirmedActions", {})[confirmation_token] = actor
    task.status = live_status(task, event)
    task.plan = plan
    task.save(update_fields=["event", "plan", "status", "delegated", "revision", "updated_at"])
    return task


def _gathering_context(request, task, event, *, collection_eligible):
    if not collection_eligible or not event.get("reconForceRequestedAt"):
        return None
    from organization_management.apps.ops.force_campaigns import active_campaign_ids_for_event
    campaign_ids = active_campaign_ids_for_event(task.event_id)
    if not campaign_ids:
        return {"state": "missing", "campaignId": None}
    if len(campaign_ids) != 1:
        return {"state": "ambiguous", "campaignId": None}
    return {"state": "ready", "campaignId": str(campaign_ids[0]) if access.is_headquarters(request) else None}


def serialize_task(request, task):
    unavailable = False
    try:
        event = _live_event(request, task)
    except ManualActionFailed as error:
        if error.response.status_code not in (401, 403, 404):
            raise
        event, unavailable = None, True
    status = "event_unavailable" if unavailable else live_status(task, event)
    plan = {key: task.plan.get(key) for key in ("title", "businessDate", "businessDateEnd", "eventTime", "kind", "objectId", "objectName", "eventId", "intent", "allocations", "personnelTotal")}
    if event:
        plan.update({key: event.get(key) for key in ("title", "businessDate", "businessDateEnd", "eventTime", "kind")})
    if unavailable:
        plan = {"intent": "prepare", "allocations": []}
    from organization_management.apps.ops.security_events import can_collect_forces
    collection_eligible = bool(event and task.event and not task.event.force_handover and can_collect_forces(task.event))
    questions = _task_questions(task)
    can_continue = bool(not unavailable and event and event.get("reconForceRequestedAt")
                        and collection_eligible and not questions and task.plan.get("allocations")
                        and task.plan.get("intent") == "send" and access.is_headquarters(request)
                        and not task.receipts.filter(operation_key="send_allocations").exists())
    confirmation = None if unavailable else pending_confirmation(request, task, event)
    if confirmation and confirmation["canConfirm"]:
        status = "awaiting_confirmation"
    return {"id": str(task.pk), "initiatedBy": task.initiated_by, "message": task.message, "revision": task.revision,
            "status": status, "delegated": task.delegated, "canEdit": not unavailable and task.initiated_by == resolve_actor_id(request),
            "canContinue": can_continue and not task.plan.get("_reviewBeforeExecute", False),
            "reviewBeforeExecute": bool(task.plan.get("_reviewBeforeExecute")), "confirmation": confirmation,
            "gathering": _gathering_context(request, task, event, collection_eligible=collection_eligible),
            "questions": questions, "interpretationNotice": task.plan.get("interpretationNotice"), "plan": plan,
            "event": ({"id": str(event["id"]), "code": event["code"], "title": event["title"], "stage": event["stage"], "forceDemandTotal": event.get("forceDemandTotal"), "requested": sum(int(row.get("need") or 0) for row in event.get("forceAllocation", []) if row.get("sentAt")), "rosterCount": len(event.get("forceRoster", [])), "progress": assignment_progress(event, handed_over=bool(task.event and task.event.force_handover)), "href": f"/security-ops/events/{event['id']}/"} if event else None),
            "receipts": [] if unavailable else [{"operation": receipt.operation_key, "executedBy": receipt.executed_by, "createdAt": receipt.created_at.isoformat(), "result": receipt.result} for receipt in task.receipts.order_by("id")],
            "updatedAt": task.updated_at.isoformat()}
