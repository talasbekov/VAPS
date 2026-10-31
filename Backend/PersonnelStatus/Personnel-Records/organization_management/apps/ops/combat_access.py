"""One scope boundary for daily combat planning and its owned catalogues."""
from datetime import date

from django.db.models import Q
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.services import PermissionService

READ = ("duty.view", "duty.roster", "duty.manage", "duty.combat.manage", "duty.catalog.manage")
ROSTER = ("duty.roster", "duty.manage", "duty.combat.manage")
REVIEW = ("duty.manage", "duty.combat.manage")
CATALOG = ("duty.catalog.manage",)


def fail(code="VALIDATION_ERROR", message="Проверьте данные формы.", status=422, **detail):
    raise DomainError(code, status, message=message, detail=detail)


def identifier(value, field="id"):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        fail(message="Укажите корректный идентификатор.", field=field)
    value = str(value)
    if not value.isascii() or not value.isdigit() or not 0 < int(value) <= 2147483647:
        fail(message="Укажите корректный идентификатор.", field=field)
    return int(value)


def business_date(value):
    try:
        result = date.fromisoformat(str(value))
        if result in (date.min, date.max) or result.isoformat() != str(value):
            raise ValueError
        return result
    except (TypeError, ValueError):
        fail("INVALID_BUSINESS_DATE", "Укажите существующую дату в формате ГГГГ-ММ-ДД.")


def scope(actor, codes=READ):
    allowed = set()
    for code in codes:
        part = PermissionService.visible_division_ids(actor, code)
        if part is None:
            return None
        allowed.update(part)
    return allowed


def require_scope(actor, division_id, codes=READ):
    allowed = scope(actor, codes)
    if allowed is not None and (division_id is None or division_id not in allowed):
        fail("PERMISSION_DENIED", "Нет доступа к подразделению.", status=403)
    return division_id


def divisions(actor, codes=READ):
    rows = Division.objects.filter(is_active=True)
    allowed = scope(actor, codes)
    return rows if allowed is None else rows.filter(pk__in=allowed)


def division_ids(actor, selected=None, codes=READ):
    rows = divisions(actor, codes)
    if selected not in (None, ""):
        pk = identifier(selected, "division_id")
        require_scope(actor, pk, codes)
        owner = rows.filter(pk=pk).first()
        if owner is None:
            fail("ENTITY_NOT_FOUND", "Подразделение не найдено.", status=404)
        tree = owner.get_descendants(include_self=True).values_list("pk", flat=True)
        rows = rows.filter(pk__in=tree)
    return set(rows.values_list("pk", flat=True))


def owner(actor, value, codes=ROSTER):
    pk = identifier(value, "divisionId")
    require_scope(actor, pk, codes)
    row = Division.objects.filter(pk=pk, is_active=True).first()
    if row is None:
        fail("ENTITY_NOT_FOUND", "Подразделение не найдено.", status=404)
    return row


def scoped_rows(model, actor, selected=None, codes=READ):
    return model.objects.filter(division_id__in=division_ids(actor, selected, codes))


def event_choices(actor, day, selected_division=None):
    """Duty grants admit only linked/owned events inside that same department.

    No global event permission or other module's grant widens a duty scope.
    Name-only legacy owners cannot establish an event's department identity.
    """
    ids = division_ids(actor, selected_division, ROSTER)
    query = OpsSecurityEvent.objects.filter(business_date__lte=day).filter(
        Q(business_date_end__gte=day) | Q(business_date_end__isnull=True, business_date=day)
    ).exclude(stage="CLOSED")
    if scope(actor, ROSTER) is None:
        return query.order_by("business_date", "pk")
    owners = set(Employee.objects.filter(staff_unit__division_id__in=ids, user__isnull=False).values_list("user_id", flat=True))
    # Use active grants only. An unscoped role does not make its owner's events local.
    owners.update(UserRole.objects.filter(scope_division_id__in=ids, is_active=True, role_code__is_active=True).values_list("user_id", flat=True))
    # Headquarters can own a central event while inviting this department.
    # Use the same sent/requested markers as the existing forces workflow;
    # an unsent draft allocation does not disclose a central event.
    from organization_management.apps.ops.forces_send import is_sent
    from organization_management.apps.operations.models_forces import OpsForceRequestMember
    related = set(OpsForceRequestMember.objects.filter(event_id__in=query.values("pk"), employee__staff_unit__division_id__in=ids, removed_at__isnull=True).values_list("event_id", flat=True))
    keys = {str(pk) for pk in ids}
    for event in query.only("id", "force_allocation"):
        for row in event.force_allocation or []:
            if not isinstance(row, dict) or not is_sent(row):
                continue
            own_request = str(row.get("departmentId")) in keys
            own_unit = any(isinstance(unit, dict) and str(unit.get("directorateId")) in keys and unit.get("requestedAt") for unit in row.get("directorates", []) or [])
            if own_request or own_unit:
                related.add(event.pk)
                break
    return query.filter(Q(pk__in=related) | Q(owner_actor_id__in=[str(pk) for pk in owners]) | Q(chief_employee_id__in=Employee.objects.filter(staff_unit__division_id__in=ids).values("pk"))).order_by("business_date", "pk")
