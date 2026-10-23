"""Scoped, revision-checked resource calculation aggregate service."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_resource_calculation import OpsResourceCalculation
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.ops.resource_calculation_rules import InvalidDocument, empty_document, issues, summary, validate_document

VIEW = "resource_calculation.view"
MANAGE = "resource_calculation.manage"


class CalculationConflict(APIException):
    status_code = 409
    default_detail = "Расчёт изменён другим пользователем. Обновите страницу и повторите изменения."


def _scope(request, manage=False):
    actor = resolve_actor_id(request)
    if actor is None: raise PermissionDenied("Доступ закрыт.")
    # Fresh authorization is essential after waiting for the event row lock;
    # the ViewSet's initial permission cache may predate a revoked grant.
    if not PermissionService.has_permission(actor, "event.view"):
        raise PermissionDenied("Нет доступа к мероприятиям.")
    codes = (MANAGE,) if manage else (VIEW, MANAGE)
    combined = set()
    for code in codes:
        scope = PermissionService.visible_division_ids(actor, code)
        if scope is None: return None
        combined.update(scope)
    if not combined: raise PermissionDenied("Нет действующей области доступа к расчётам.")
    return combined


def _owners(request):
    try: scope = _scope(request, manage=True)
    except PermissionDenied: return []
    query = Division.objects.filter(is_active=True)
    if scope is not None: query = query.filter(pk__in=scope)
    return list(query.order_by("name", "pk").values("id", "name"))


def _allowed(scope, owner):
    return scope is None or owner in scope


def _event(event_id):
    if not str(event_id).isdigit() or int(event_id) > 2147483647: raise ValidationError("Некорректное мероприятие.")
    return get_object_or_404(OpsSecurityEvent, pk=event_id)


def _snapshot(event):
    return {"title": event.title, "dateFrom": event.business_date.isoformat(), "dateTo": event.business_date_end.isoformat() if event.business_date_end else None}


def _response(request, event, calculation):
    choices = _owners(request)
    manage_scope = None
    try:
        manage_scope = _scope(request, manage=True)
        manageable = calculation is None and bool(choices) or calculation is not None and _allowed(manage_scope, calculation.owner_division_id)
    except PermissionDenied:
        manageable = False
    return {"event": {"id": str(event.pk), **_snapshot(event), "stage": event.stage}, "exists": calculation is not None, "version": calculation.version if calculation else 0, "ownerDivisionId": calculation.owner_division_id if calculation else None, "ownerDivisionName": calculation.owner_division.name if calculation else "", "ownerChoices": choices if calculation is None else [], "canManage": bool(manageable and event.stage != "CLOSED"), "snapshot": calculation.snapshot if calculation else None, "document": calculation.document if calculation else empty_document(), "issues": issues(calculation.document) if calculation else [], "updatedAt": calculation.updated_at.isoformat() if calculation else None}


def retrieve(request, event_id):
    scope = _scope(request)
    event = _event(event_id)
    calculation = OpsResourceCalculation.objects.select_related("owner_division").filter(event=event).first()
    if calculation and not _allowed(scope, calculation.owner_division_id): raise PermissionDenied("Расчёт принадлежит другому подразделению.")
    return _response(request, event, calculation)


@transaction.atomic
def replace(request, event_id, payload):
    # Serialize both first creation and updates on the existing parent row.
    _scope(request, manage=True)
    event = _event(event_id)
    event = OpsSecurityEvent.objects.select_for_update().get(pk=event.pk)
    scope = _scope(request, manage=True)
    calculation = OpsResourceCalculation.objects.select_related("owner_division").filter(event=event).first()
    if calculation and not _allowed(scope, calculation.owner_division_id): raise PermissionDenied("Расчёт принадлежит другому подразделению.")
    if event.stage == "CLOSED": raise CalculationConflict("Закрытое мероприятие доступно только для чтения.")
    if not isinstance(payload, dict) or set(payload) - {"expectedVersion", "ownerDivisionId", "document"}: raise ValidationError("Неверные поля запроса.")
    expected = payload.get("expectedVersion")
    if type(expected) is not int or not 0 <= expected <= 2147483647: raise ValidationError("Укажите целую expectedVersion.")
    if expected != (calculation.version if calculation else 0): raise CalculationConflict()
    supplied = payload.get("ownerDivisionId")
    if "ownerDivisionId" in payload and (type(supplied) is not int or supplied <= 0): raise ValidationError("Выберите действующее подразделение-владельца.")
    if calculation:
        if supplied is not None and supplied != calculation.owner_division_id: raise ValidationError("Владелец сохранённого расчёта неизменяем.")
        owner = calculation.owner_division
    else:
        choices = _owners(request)
        if supplied is None and scope is not None and len(choices) == 1: supplied = choices[0]["id"]
        if supplied is None: raise ValidationError("Выберите подразделение-владельца расчёта.")
        if not _allowed(scope, supplied): raise PermissionDenied("Недоступный владелец расчёта.")
        owner = Division.objects.filter(pk=supplied, is_active=True).first()
        if owner is None: raise ValidationError("Подразделение-владелец не найдено или неактивно.")
    try:
        doc = validate_document(payload.get("document"), event.business_date, event.business_date_end)
    except InvalidDocument as exc:
        raise ValidationError(str(exc))
    actor = resolve_actor_id(request)
    old_version = calculation.version if calculation else 0
    if calculation is None: calculation = OpsResourceCalculation(event=event, owner_division=owner, created_by=actor)
    calculation.document = doc
    calculation.snapshot = _snapshot(event)
    calculation.version = old_version + 1
    calculation.updated_by = actor
    calculation.save()
    audit_service.record(actor=actor, action=audit_service.RESOURCE_CALCULATION_SAVED, entity_type=audit_service.ENTITY_SECURITY_EVENT, entity_id=event.pk, old_value={"version": old_version}, new_value={"version": calculation.version, "ownerDivisionId": owner.pk, "routeCount": len(doc["routes"]), "groupCount": len(doc["groups"]), "segmentCount": len(doc["segments"])})
    return _response(request, event, calculation)


def list_saved(request):
    scope = _scope(request)
    query = OpsResourceCalculation.objects.select_related("event", "owner_division").order_by("-updated_at", "pk")
    if scope is not None: query = query.filter(owner_division_id__in=scope)
    return query


def saved_export(request, event_id, format):
    scope = _scope(request)
    event = _event(event_id)
    calculation = get_object_or_404(OpsResourceCalculation.objects.select_related("owner_division"), event=event)
    if not _allowed(scope, calculation.owner_division_id): raise PermissionDenied("Расчёт принадлежит другому подразделению.")
    if format not in ("json", "docx"): raise ValidationError("Выберите формат docx или json.")
    if format == "docx" and issues(calculation.document): raise ValidationError({"message": "Завершите расчёт перед выгрузкой Word.", "issues": issues(calculation.document)})
    return calculation
