"""Department-owned combat catalogues, including scoped object selections."""
from django.db import IntegrityError, transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_combat import OpsCombatDutyType, OpsCombatGroup, OpsCombatPlace, OpsCombatRoute
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.ops import combat_access as access

MODELS = {"groups": OpsCombatGroup, "types": OpsCombatDutyType, "routes": OpsCombatRoute, "places": OpsCombatPlace}


def model_for(kind):
    if kind not in MODELS:
        access.fail(message="Неизвестный справочник.")
    return MODELS[kind]


def serialize(kind, row):
    base = {"id": str(row.pk), "divisionId": str(row.division_id) if row.division_id else None, "isActive": row.is_active}
    if kind == "groups":
        return {**base, "name": row.name, "maxMembers": row.max_members}
    if kind == "types":
        return {**base, "code": row.duty_type_code, "name": row.safe_label, "shiftKind": row.shift_kind, "restDayAfter": row.rest_day_after, "supportsMultipleRoutes": row.supports_multiple_routes}
    if kind == "routes":
        return {**base, "code": row.route_code, "name": row.safe_label, "description": row.description}
    obj = row.security_object
    return {**base, "objectId": str(obj.pk), "name": obj.name, "posts": [{"id": str(post.pk), "name": post.name, "sectorName": sector.name} for sector in obj.sectors.all() for post in sector.posts.all()]}


def rows(actor, kind, selected=None):
    query = access.scoped_rows(model_for(kind), actor, selected)
    if kind == "places":
        query = query.select_related("security_object").prefetch_related("security_object__sectors__posts")
    return query.order_by("division_id", "pk")


def text(data, key, maximum=255, required=True):
    value = data.get(key, "")
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
        access.fail(message=f"Проверьте поле «{key}».", field=key)
    return value.strip()


def boolean(data, key, default=False):
    value = data.get(key, default)
    if type(value) is not bool:
        access.fail(message="Ожидается логическое значение.", field=key)
    return value


@transaction.atomic
def save(actor, kind, data, pk=None):
    model = model_for(kind)
    if not isinstance(data, dict):
        access.fail()
    if pk:
        row = model.objects.select_for_update().filter(pk=access.identifier(pk)).first()
        if row is None:
            access.fail("ENTITY_NOT_FOUND", "Запись справочника не найдена.", status=404)
        access.require_scope(actor, row.division_id, access.CATALOG)
        if row.division_id is None:
            access.fail(message="Исторический общий справочник редактируется прежним способом.")
        if "divisionId" in data and access.identifier(data["divisionId"]) != row.division_id:
            access.fail(message="Владелец записи не меняется. Создайте запись в нужном подразделении.")
        merged = {**serialize(kind, row), **data}
    else:
        division = access.owner(actor, data.get("divisionId"), access.CATALOG)
        row = model(division=division, created_by=actor)
        merged = data
    row.is_active = boolean(merged, "isActive", True)
    if kind == "groups":
        row.name = text(merged, "name", 64)
        capacity = merged.get("maxMembers", 4)
        if type(capacity) is not int or not 1 <= capacity <= 200:
            access.fail(message="Предел численности должен быть от 1 до 200.", field="maxMembers")
        row.max_members = capacity
    elif kind == "types":
        row.safe_label, row.duty_type_code = text(merged, "name"), text(merged, "code", 50)
        row.shift_kind = merged.get("shiftKind", "DAY")
        if row.shift_kind not in {"DAY", "NIGHT", "DAILY"}:
            access.fail(message="Выберите дневное, ночное или суточное дежурство.")
        row.rest_day_after = boolean(merged, "restDayAfter")
        if row.rest_day_after and row.shift_kind != "DAILY":
            access.fail(message="Отдых на следующий день задаётся для суточного дежурства.")
        row.supports_multiple_routes = boolean(merged, "supportsMultipleRoutes")
    elif kind == "routes":
        row.safe_label, row.route_code = text(merged, "name"), text(merged, "code", 50)
        row.description = text(merged, "description", 500, False)
    else:
        obj_id = access.identifier(merged.get("objectId"), "objectId")
        # Passports are the existing service registry; the local selection is owned.
        if not PermissionService.has_permission(actor, "object.view"):
            access.fail("PERMISSION_DENIED", "Нет доступа к реестру объектов.", status=403)
        obj = OpsSecurityObject.objects.filter(pk=obj_id, object_state="ACTIVE").first()
        if obj is None:
            access.fail("ENTITY_NOT_FOUND", "Действующий объект не найден.", status=404)
        row.security_object = obj
    try:
        with transaction.atomic():
            row.save()
    except IntegrityError:
        access.fail(message="Запись с таким именем или кодом уже есть в подразделении.")
    audit_service.record(actor=actor, action=audit_service.COMBAT_CATALOG_UPDATED, entity_type="combat_catalog", entity_key=f"{kind}:{row.pk}", new_value=serialize(kind, row))
    return serialize(kind, row)
