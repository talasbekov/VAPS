"""Strict state transitions for saved object inspections."""
import hashlib
import json
import re
from datetime import date
from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_object_inspection import OpsObjectInspection
from organization_management.apps.operations.services import PermissionService


class InspectionConflict(APIException):
    status_code = 409
    default_detail = "Обследование изменилось. Обновите сохранённые сведения и повторите действие."


def strict(data, allowed):
    if not isinstance(data, dict) or set(data) - set(allowed):
        raise ValidationError("Неизвестные поля обследования.")


def text(value, label, maximum=1000, required=False):
    if not isinstance(value, str) or len(value) > maximum or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
        raise ValidationError(f"Проверьте поле «{label}».")
    value = value.strip()
    if required and not value:
        raise ValidationError(f"Заполните поле «{label}».")
    return value


def business_date(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValidationError(f"Укажите дату: {label}.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError(f"Проверьте дату: {label}.")


def user_view(user):
    return {"id": str(user.pk), "username": user.username, "name": user.get_full_name().strip() or user.username}


def validated_document(data):
    inspected_on = business_date(data.get("inspectedOn"), "дата обследования")
    if inspected_on > Clock.today_local():
        raise ValidationError("Дата проведённого обследования не может быть в будущем.")
    raw_items = data.get("items")
    if not isinstance(raw_items, list) or len(raw_items) > 100:
        raise ValidationError("Допустимо до 100 пунктов обследования.")
    items, ids = [], set()
    for raw in raw_items:
        strict(raw, {"id", "question", "answer", "finding", "responsibleUsername", "dueOn"})
        key = text(raw.get("id"), "идентификатор пункта", 80, True)
        if key in ids:
            raise ValidationError("Пункты обследования должны иметь разные идентификаторы.")
        ids.add(key)
        answer = raw.get("answer", "")
        if answer not in ("", "yes", "no", "na"):
            raise ValidationError("Выберите: да, нет или не применимо.")
        question = text(raw.get("question", ""), "вопрос", 1000)
        finding = text(raw.get("finding", ""), "замечание", 2000)
        username = text(raw.get("responsibleUsername", ""), "ответственный", 150)
        responsible = None
        if username:
            user = get_user_model().objects.filter(username=username, is_active=True).first()
            if user is None:
                raise ValidationError("Ответственный должен иметь действующую учётную запись.")
            responsible = user_view(user)
        due = raw.get("dueOn")
        if due is not None:
            due = business_date(due, "срок устранения")
            if due < inspected_on:
                raise ValidationError("Срок устранения не может быть раньше обследования.")
        if answer != "no" and (finding or responsible or due):
            raise ValidationError("Замечание и ответственный указываются для ответа «Нет».")
        items.append({"id": key, "question": question, "answer": answer, "finding": finding,
                      "responsible": responsible, "responsibleUsername": username, "dueOn": due.isoformat() if due else None,
                      "resolution": "", "resolvedAt": None, "resolvedBy": None})
    return inspected_on, items


def serialize(row):
    open_items = [item for item in row.items if item["answer"] == "no" and not item.get("resolvedAt")]
    today = Clock.today_local().isoformat()
    return {"id": str(row.pk), "objectId": str(row.security_object_id), "inspectedOn": row.inspected_on.isoformat(),
            "reviewer": user_view(row.reviewer), "items": row.items, "revision": row.revision,
            "state": "completed" if row.completed_at else "draft",
            "completedAt": row.completed_at.isoformat() if row.completed_at else None,
            "updatedAt": row.updated_at.isoformat(), "openFindings": len(open_items),
            "overdueFindings": sum(bool(item.get("dueOn") and item["dueOn"] < today) for item in open_items)}


def audit(row, actor, action, old_revision=None):
    audit_service.record(actor=actor, action=action, entity_type=audit_service.ENTITY_SECURITY_OBJECT,
                         entity_id=row.security_object_id, old_value={"revision": old_revision},
                         new_value={"inspectionId": str(row.pk), "revision": row.revision,
                                    "itemCount": len(row.items), "openFindings": serialize(row)["openFindings"]})


def object_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,17}", value):
        raise ValidationError("Укажите объект.")
    if not OpsSecurityObject.objects.filter(pk=value).exists():
        raise NotFound("Объект не найден.")
    return int(value)


def inspection_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,17}", value):
        raise NotFound("Обследование не найдено.")
    return int(value)


def require_live_write_permission(actor, user):
    # Do not reuse the HTTP request's cached grants: a locking query or insert
    # can wait while a role is revoked or a temporary grant expires.
    if not get_user_model().objects.filter(pk=user.pk, is_active=True).exists():
        raise PermissionDenied("PERMISSION_DENIED")
    if not PermissionService.unscoped_permissions(actor).intersection({"*", "object.manage"}):
        raise PermissionDenied("PERMISSION_DENIED")


def create(data, user, actor):
    require_live_write_permission(actor, user)
    strict(data, {"objectId", "inspectedOn", "items", "requestKey"})
    obj_id = object_id(data.get("objectId"))
    key = text(data.get("requestKey"), "ключ запроса", 80, True)
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    existing = OpsObjectInspection.objects.filter(reviewer=user, request_key=key).first()
    if existing:
        require_live_write_permission(actor, user)
        if existing.request_hash != fingerprint:
            raise InspectionConflict("Ключ уже использован для другого обследования.")
        return existing, False
    inspected_on, items = validated_document(data)
    with transaction.atomic():
        require_live_write_permission(actor, user)
        row, created = OpsObjectInspection.objects.get_or_create(
            reviewer=user, request_key=key,
            defaults={"security_object_id": obj_id, "inspected_on": inspected_on, "items": items,
                      "created_by": actor, "request_hash": fingerprint})
        # get_or_create can wait on the unique key/FK. If authority expired
        # there, abort this transaction, including any newly inserted row.
        require_live_write_permission(actor, user)
        if row.request_hash != fingerprint:
            raise InspectionConflict("Ключ уже использован для другого обследования.")
        if created:
            audit(row, actor, audit_service.OBJECT_INSPECTION_SAVED)
    return row, created


@transaction.atomic
def mutate(pk, data, actor, user, operation):
    allowed = {"revision", "inspectedOn", "items"} if operation == "save" else {"revision", "itemId", "resolution"} if operation == "resolve" else {"revision"}
    strict(data, allowed)
    row = OpsObjectInspection.objects.select_for_update().select_related("reviewer").filter(pk=inspection_id(pk)).first()
    require_live_write_permission(actor, user)
    if row is None:
        raise NotFound("Обследование не найдено.")
    revision = data.get("revision")
    if type(revision) is not int or revision < 1:
        raise ValidationError("Укажите версию обследования.")
    if revision != row.revision:
        raise InspectionConflict()
    if operation == "save":
        if row.completed_at:
            raise InspectionConflict("Завершённое обследование нельзя переписать. Создайте новое обследование.")
        row.inspected_on, row.items = validated_document(data)
        action = audit_service.OBJECT_INSPECTION_SAVED
    elif operation == "complete":
        if row.completed_at:
            raise InspectionConflict("Обследование уже завершено.")
        if not row.items or any(not item["question"] or not item["answer"] for item in row.items):
            raise ValidationError("Перед завершением заполните каждый вопрос и ответ.")
        for item in row.items:
            if item["answer"] == "no":
                if not item["finding"] or not item["responsible"] or not item["dueOn"]:
                    raise ValidationError("Для каждого ответа «Нет» укажите замечание, ответственного и срок устранения.")
                if not get_user_model().objects.filter(pk=item["responsible"]["id"], is_active=True).exists():
                    raise ValidationError("Учётная запись ответственного больше не активна.")
        row.completed_at = Clock.now()
        action = audit_service.OBJECT_INSPECTION_COMPLETED
    else:
        if not row.completed_at:
            raise InspectionConflict("Сначала завершите обследование.")
        target = next((item for item in row.items if item["id"] == data.get("itemId")), None)
        if target is None or target["answer"] != "no":
            raise ValidationError("Замечание не найдено.")
        if target.get("resolvedAt"):
            raise InspectionConflict("Замечание уже устранено.")
        target["resolution"] = text(data.get("resolution"), "результат устранения", 2000, True)
        target["resolvedAt"] = Clock.now().isoformat()
        target["resolvedBy"] = user_view(user)
        action = audit_service.OBJECT_INSPECTION_FINDING_RESOLVED
    row.revision += 1
    require_live_write_permission(actor, user)
    row.save(update_fields=["inspected_on", "items", "completed_at", "revision", "updated_at"])
    audit(row, actor, action, revision)
    return row

