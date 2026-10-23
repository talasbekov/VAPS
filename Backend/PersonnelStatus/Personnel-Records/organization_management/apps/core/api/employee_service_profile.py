"""Employee-scoped read/edit and the same boundary for duty-assignment exports."""
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from organization_management.apps.audit.domain.models import AuditLog
from organization_management.apps.core.service_employees import visible_employees
from organization_management.apps.employees.models import Employee, EmployeeServiceProfile
from organization_management.apps.employees.service_profile import normalize_profile, profile_payload
from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.services import PermissionService


def can_edit_profile(request, employee):
    actor = resolve_actor_id(request)
    unit = getattr(employee, "staff_unit", None)
    division_id = unit.division_id if unit else None
    # Match the existing personnel administration form, for this employee's scope.
    for permission in ("orgstructure.manage", "admin.roles"):
        scope = PermissionService.visible_division_ids(actor, permission)
        if scope is not None and division_id not in scope:
            return False
    return actor is not None


def _envelope(profile, can_edit):
    return {
        "profile": profile_payload(profile),
        "revision": profile.revision if profile else 0,
        "can_edit": can_edit,
    }


def employee_service_profile(request, pk):
    if not str(pk).isdigit():
        raise Http404
    employee = get_object_or_404(visible_employees(request), pk=pk)
    editable = can_edit_profile(request, employee)
    if request.method == "GET":
        return Response(_envelope(EmployeeServiceProfile.objects.filter(employee=employee).first(), editable))
    if not editable:
        raise PermissionDenied("PERMISSION_DENIED")
    body = request.data
    if not isinstance(body, dict) or set(body) != {"profile", "revision"}:
        raise ValidationError("Укажите профиль и его текущую версию.")
    revision = body.get("revision")
    if type(revision) is not int or revision < 0:
        raise ValidationError("Некорректная версия профиля.")
    try:
        data = normalize_profile(body["profile"])
    except ValueError as exc:
        raise ValidationError({"profile": str(exc)}) from exc
    with transaction.atomic():
        # Lock the parent too: two first saves must not create competing profiles.
        Employee.objects.select_for_update().get(pk=employee.pk)
        employee = get_object_or_404(visible_employees(request), pk=pk)
        if not can_edit_profile(request, employee):
            raise PermissionDenied("PERMISSION_DENIED")
        profile = EmployeeServiceProfile.objects.filter(employee=employee).first()
        current_revision = profile.revision if profile else 0
        if revision != current_revision:
            return Response({"detail": "Профиль уже изменён. Обновите карточку перед сохранением."}, status=409)
        if profile is None:
            profile = EmployeeServiceProfile(employee=employee)
        profile.data = data
        profile.revision = current_revision + 1
        profile.save()
        # Record who changed the card, without copying health or inventory into logs.
        AuditLog.objects.create(
            user=request.user, action_type="UPDATE" if current_revision else "CREATE",
            content_type=ContentType.objects.get_for_model(EmployeeServiceProfile),
            object_id=profile.pk,
            payload={"employee_id": employee.pk, "revision_before": current_revision, "revision_after": profile.revision},
        )
    return Response(_envelope(profile, True))


def attach_service_profiles(request, rows):
    """Status/object access never grants additional personnel-profile visibility."""
    employee_ids = {row["employee_id"] for row in rows}
    visible_ids = set(visible_employees(request).filter(pk__in=employee_ids).values_list("pk", flat=True))
    profiles = {
        profile.employee_id: profile
        for profile in EmployeeServiceProfile.objects.filter(employee_id__in=visible_ids)
    }
    result = []
    for row in rows:
        employee_id = int(row["employee_id"])
        payload = None
        if employee_id in visible_ids:
            try:
                payload = profile_payload(profiles.get(employee_id))
            except (ValueError, TypeError, OverflowError):
                # Bad optional profile data cannot make an otherwise valid roster disappear.
                payload = None
        result.append({**row, "service_profile": payload})
    return result
