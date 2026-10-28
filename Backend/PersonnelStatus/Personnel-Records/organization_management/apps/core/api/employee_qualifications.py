"""Evidence records use the existing personnel read/write scope and profile revision."""
from datetime import date
import hashlib
import json
import re

from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from organization_management.apps.operations import audit_service
from organization_management.apps.core.service_employees import visible_employees
from organization_management.apps.employees.models import Employee, EmployeeServiceProfile
from organization_management.apps.employees.service_profile import SKILLS, UNSAFE_TEXT
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_employee_qualification import OpsEmployeeQualification
from .employee_service_profile import can_edit_profile

PAGE_SIZE = 20


def _date(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValidationError({field: "Укажите дату в формате ГГГГ-ММ-ДД."})
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValidationError({field: "Укажите существующую дату."}) from error


def _validate(body):
    fields = {"revision", "request_key", "skill", "score", "assessed_on", "valid_until", "basis"}
    if not isinstance(body, dict) or set(body) != fields:
        raise ValidationError("Укажите поля проверки, ключ запроса и текущую версию профиля.")
    if type(body["revision"]) is not int or body["revision"] < 0:
        raise ValidationError({"revision": "Некорректная версия профиля."})
    key = body["request_key"]
    if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", key):
        raise ValidationError({"request_key": "Некорректный ключ запроса."})
    if not isinstance(body["skill"], str) or body["skill"] not in SKILLS:
        raise ValidationError({"skill": "Выберите навык."})
    if type(body["score"]) is not int or not 1 <= body["score"] <= 5:
        raise ValidationError({"score": "Укажите целую оценку от 1 до 5."})
    assessed = _date(body["assessed_on"], "assessed_on")
    if assessed > Clock.today_local():
        raise ValidationError({"assessed_on": "Проверка не может быть датирована будущим числом."})
    valid = None if body["valid_until"] is None else _date(body["valid_until"], "valid_until")
    if valid is not None and valid < assessed:
        raise ValidationError({"valid_until": "Срок действия не может закончиться раньше проверки."})
    basis = body["basis"]
    if not isinstance(basis, str) or not basis.strip() or len(basis) > 1000 or UNSAFE_TEXT.search(basis):
        raise ValidationError({"basis": "Укажите основание проверки до 1000 символов."})
    return {"skill": body["skill"], "score": body["score"], "assessed_on": assessed,
            "valid_until": valid, "basis": basis.strip()}


def _row(row):
    return {"id": str(row.pk), "skill": row.skill, "score": row.score,
            "assessed_on": row.assessed_on.isoformat(),
            "valid_until": row.valid_until.isoformat() if row.valid_until else None,
            "basis": row.basis, "recorded_by": row.recorded_by, "recorded_by_name": row.recorded_by_name,
            "created_at": row.created_at.isoformat()}


def _envelope(employee, editable, *, page=1):
    today = Clock.today_local()
    profile = EmployeeServiceProfile.objects.filter(employee=employee).first()
    records = OpsEmployeeQualification.objects.filter(employee=employee)
    current = {}
    for skill in SKILLS:
        record = records.filter(skill=skill).first()
        state = "unknown"
        if record is not None and record.valid_until is not None:
            state = "valid" if record.valid_until >= today else "expired"
        current[skill] = {"state": state, "assessment": _row(record) if record else None}
    return {"revision": profile.revision if profile else 0, "can_edit": editable, "today": today.isoformat(),
            "current": current, "history": {"count": records.count(), "page": page, "page_size": PAGE_SIZE,
            "results": [_row(row) for row in records[(page - 1) * PAGE_SIZE:page * PAGE_SIZE]]}}


def employee_qualifications(request, pk):
    if not str(pk).isdigit():
        raise Http404
    employee = get_object_or_404(visible_employees(request), pk=pk)
    editable = can_edit_profile(request, employee)
    if request.method == "GET":
        if set(request.query_params) - {"page"} or len(request.query_params.getlist("page")) > 1:
            raise ValidationError("Неизвестные параметры истории.")
        page = request.query_params.get("page", "1")
        if not re.fullmatch(r"[1-9][0-9]{0,6}", page):
            raise ValidationError({"page": "Укажите номер страницы."})
        return Response(_envelope(employee, editable, page=int(page)))
    if not editable:
        raise PermissionDenied("PERMISSION_DENIED")
    data = _validate(request.data)
    actor = str(resolve_actor_id(request))
    digest = hashlib.sha256(json.dumps(request.data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    with transaction.atomic():
        Employee.objects.select_for_update().get(pk=employee.pk)
        employee = get_object_or_404(visible_employees(request), pk=pk)
        if not can_edit_profile(request, employee):
            raise PermissionDenied("PERMISSION_DENIED")
        existing = OpsEmployeeQualification.objects.filter(employee=employee, request_key=request.data["request_key"]).first()
        if existing:
            if existing.request_hash != digest or existing.recorded_by != actor:
                return Response({"detail": "Этот ключ уже использован для другой проверки."}, status=409)
            return Response(_envelope(employee, True))
        profile = EmployeeServiceProfile.objects.filter(employee=employee).first()
        revision = profile.revision if profile else 0
        if revision != request.data["revision"]:
            return Response({"detail": "Профиль уже изменён. Обновите сведения перед записью проверки."}, status=409)
        record = OpsEmployeeQualification.objects.create(
            employee=employee, **data, recorded_by=actor,
            recorded_by_name=str(request.user.get_username())[:150],
            request_key=request.data["request_key"], request_hash=digest,
        )
        if profile is None:
            profile = EmployeeServiceProfile(employee=employee, data={})
        # The existing profile/DT contract carries the current numeric score.
        # Only an explicit assessment updates it; older history does not win.
        current = OpsEmployeeQualification.objects.filter(employee=employee, skill=record.skill).first()
        profile.data = {**profile.data, "skills": {**(profile.data.get("skills") or {}), record.skill: current.score}}
        profile.revision = revision + 1
        profile.save()
        audit_service.record(
            actor=actor, action=audit_service.EMPLOYEE_QUALIFICATION_RECORDED,
            entity_type=audit_service.ENTITY_EMPLOYEE, entity_id=employee.pk,
            old_value={"revision": revision},
            new_value={"qualification_id": str(record.pk), "skill": record.skill, "revision": profile.revision},
        )
        return Response(_envelope(employee, True), status=201)

