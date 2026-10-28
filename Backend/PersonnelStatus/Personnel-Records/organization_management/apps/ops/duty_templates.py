"""Server-backed personal and scoped shared duty templates."""
import hashlib
import json
import re
import unicodedata
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.clock import _local_tz
from organization_management.apps.operations.models_duty_template import OpsDutyTemplate
from organization_management.apps.ops.duty_log import active_kind
from organization_management.apps.ops.duty_record_access import REGISTER_PERMISSIONS, WRITE_PERMISSIONS, division_scope, in_scope

FIELDS = {"name": 120, "kind": 100, "start_time": 5, "location_label": 500, "document_basis": 500, "note": 10000}


class TemplateConflict(APIException):
    status_code = 409
    default_detail = "Шаблон изменился. Обновите список и повторите изменения."


def authority(request, write=False):
    actor = resolve_actor_id(request)
    if not actor:
        raise PermissionDenied("Доступ закрыт.")
    scope = division_scope(actor, WRITE_PERMISSIONS if write else REGISTER_PERMISSIONS)
    if scope == set():
        raise PermissionDenied("Нет действующей области доступа к шаблонам.")
    return actor, scope


def visible(actor, scope, *, active=True):
    shared = Q(owner_division__isnull=False) if scope is None else Q(owner_division_id__in=scope)
    rows = OpsDutyTemplate.objects.filter(Q(owner_division__isnull=True, owner_actor=actor) | shared, time_zone=str(_local_tz()))
    return rows.filter(is_active=True) if active else rows


def manageable(actor, scope, row):
    return (row.owner_division_id is None and row.owner_actor == actor) or (row.owner_division_id is not None and in_scope(scope, row.owner_division_id))


def result(request, row):
    try:
        actor, scope = authority(request, write=True)
        can_manage = manageable(actor, scope, row)
    except PermissionDenied:
        can_manage = False
    return {**{key: getattr(row, key) for key in FIELDS}, "id": str(row.pk), "duration_minutes": row.duration_minutes,
            "owner_division_id": row.owner_division_id, "owner_division_name": row.owner_division.name if row.owner_division_id else "",
            "revision": row.revision, "time_zone": row.time_zone, "can_manage": can_manage}


def listing(request):
    actor, scope = authority(request)
    try:
        _, write_scope = authority(request, write=True)
        choices = Division.objects.filter(is_active=True)
        if write_scope is not None:
            choices = choices.filter(pk__in=write_scope)
        owners = list(choices.order_by("name", "pk").values("id", "name"))
        can_create = True
    except PermissionDenied:
        owners, can_create = [], False
    rows = visible(actor, scope).select_related("owner_division").order_by("name", "pk")
    return {"results": [result(request, row) for row in rows], "owner_choices": owners, "can_create": can_create, "time_zone": str(_local_tz())}


def retrieve(request, pk):
    actor, scope = authority(request)
    return result(request, get_object_or_404(visible(actor, scope).select_related("owner_division"), pk=identifier(pk)))


def identifier(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Некорректный идентификатор шаблона.")


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != set(FIELDS) | {"id", "expected_revision", "owner_division_id", "duration_minutes"}:
        raise ValidationError("Некорректные поля шаблона.")
    values = {}
    for key, limit in FIELDS.items():
        value = payload[key]
        if not isinstance(value, str) or len(value) > limit or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
            raise ValidationError({key: "Некорректное значение."})
        values[key] = value.strip()
    if not values["name"] or not values["kind"] or re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", values["start_time"]) is None:
        raise ValidationError("Укажите название, действующий вид и время начала.")
    duration = payload["duration_minutes"]
    revision = payload["expected_revision"]
    owner = payload["owner_division_id"]
    if type(duration) is not int or not 1 <= duration <= 527040 or type(revision) is not int or not 0 <= revision <= 2147483647:
        raise ValidationError("Некорректные длительность или версия.")
    if owner is not None and (type(owner) is not int or not 0 < owner <= 9007199254740991):
        raise ValidationError("Некорректное подразделение.")
    name_key = " ".join(unicodedata.normalize("NFKC", values["name"]).casefold().split())
    if len(name_key) > 240:
        raise ValidationError("Название слишком длинное после нормализации.")
    values.update(duration_minutes=duration, name_key=name_key)
    return identifier(payload["id"]), revision, owner, values


def save(request, payload, *, pk=None):
    key, expected, owner, values = validate(payload)
    if pk is not None and identifier(pk) != key:
        raise ValidationError("Идентификатор шаблона неизменяем.")
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    try:
        with transaction.atomic():
            actor, scope = authority(request, write=True)
            if pk is None:
                existing = OpsDutyTemplate.objects.select_for_update().filter(pk=key).first()
                if existing:
                    if existing.owner_actor != actor or existing.create_hash != digest or not existing.is_active:
                        raise TemplateConflict()
                    if not manageable(actor, scope, existing):
                        raise PermissionDenied("Нет доступа к шаблону.")
                    return result(request, existing), False
                if expected != 0:
                    raise TemplateConflict()
                if owner is not None:
                    if not in_scope(scope, owner):
                        raise PermissionDenied("Нет доступа к выбранному подразделению.")
                    if not Division.objects.filter(pk=owner, is_active=True).exists():
                        raise ValidationError("Подразделение не найдено или неактивно.")
                row = OpsDutyTemplate(id=key, owner_actor=actor, owner_division_id=owner, created_by=actor, time_zone=str(_local_tz()), create_hash=digest)
                old_revision = 0
            else:
                row = get_object_or_404(visible(actor, scope).select_for_update(), pk=key)
                if not manageable(actor, scope, row):
                    raise PermissionDenied("Нет доступа к изменению шаблона.")
                if owner != row.owner_division_id:
                    raise ValidationError("Область сохранённого шаблона неизменяема.")
                if expected != row.revision:
                    raise TemplateConflict()
                old_revision = row.revision
            active_kind(values["kind"], lock=True)
            # Recheck grants after obtaining any row lock.
            actor, scope = authority(request, write=True)
            if not manageable(actor, scope, row):
                raise PermissionDenied("Доступ к шаблону изменился.")
            for field, value in values.items():
                setattr(row, field, value)
            row.revision = old_revision + 1
            row.updated_by = actor
            row.save()
            audit_service.record(actor=actor, action="DUTY_TEMPLATE_SAVED", entity_type="duty_template", entity_key=str(row.pk),
                                 old_value={"revision": old_revision}, new_value={"revision": row.revision, "owner_division_id": owner})
            return result(request, row), pk is None
    except IntegrityError:
        # Concurrent retry is resolved by its UUID after the failed transaction.
        if pk is None:
            actor, scope = authority(request, write=True)
            row = visible(actor, scope).filter(pk=key, owner_actor=actor, create_hash=digest).first()
            if row is not None:
                return result(request, row), False
        raise TemplateConflict("Шаблон с таким названием уже существует. Обновите список или выберите другое название.")


@transaction.atomic
def remove(request, pk, payload):
    if not isinstance(payload, dict) or set(payload) != {"expected_revision"} or type(payload.get("expected_revision")) is not int:
        raise ValidationError("Укажите версию удаляемого шаблона.")
    actor, scope = authority(request, write=True)
    row = get_object_or_404(visible(actor, scope, active=False).select_for_update(), pk=identifier(pk))
    actor, scope = authority(request, write=True)
    if not manageable(actor, scope, row):
        raise PermissionDenied("Нет доступа к удалению шаблона.")
    if not row.is_active and payload["expected_revision"] == row.revision - 1:
        return
    if not row.is_active or row.revision != payload["expected_revision"]:
        raise TemplateConflict()
    row.is_active = False
    row.revision += 1
    row.updated_by = actor
    row.save(update_fields=["is_active", "revision", "updated_at", "updated_by"])
    audit_service.record(actor=actor, action="DUTY_TEMPLATE_REMOVED", entity_type="duty_template", entity_key=str(row.pk),
                         old_value={"revision": row.revision - 1}, new_value={"revision": row.revision})

