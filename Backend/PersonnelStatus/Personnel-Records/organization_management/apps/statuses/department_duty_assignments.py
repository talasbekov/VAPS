"""Read-only personnel placements for one department, independent of dispatch."""
from collections import defaultdict

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.strength_report import StatusCatalog, resolve_status_row
from organization_management.apps.statuses.duty_assignments import DUTY_CODES, identifier
from organization_management.apps.statuses.duty_intervals import placement_for_roster
from organization_management.apps.statuses.models import EmployeeStatus


def department_scope(query):
    """Both explicit arguments distinguish this contract from the legacy reader."""
    if "source" not in query and "department_id" not in query:
        return None
    if query.get("source") != "employee_status":
        raise ValidationError({"source": ["Укажите источник employee_status вместе с департаментом."]})
    key = identifier(query.get("department_id"))
    if key is None:
        raise ValidationError({"department_id": ["Укажите корректный идентификатор департамента."]})
    department = Division.objects.filter(pk=int(key), division_type="department").first()
    if department is None:
        raise ValidationError({"department_id": ["Департамент не найден."]})
    return department


def department_assignments(queryset, department, on_date, filters):
    """The caller supplies a status.view-scoped queryset and checks object.view.

    Personnel dates are inclusive; the canonical operations projection uses an
    exclusive end. A winning non-personnel status never borrows a saved post.
    """
    result = {"scope": {"source": "employee_status", "department_id": str(department.pk),
                        "department_name": department.name}, "results": []}
    divisions = department.get_descendants(include_self=True).values_list("pk", flat=True)
    rows = queryset.filter(
        employee__is_active=True, employee__staff_unit__division_id__in=divisions,
        duty_assignment__isnull=False, duty_assignment__object_id=filters["object_id"],
        status_type__in=DUTY_CODES, start_date__lte=on_date,
        state__in=(EmployeeStatus.StatusState.ACTIVE, EmployeeStatus.StatusState.PLANNED,
                   EmployeeStatus.StatusState.COMPLETED),
    ).filter(Q(actual_end_date__gte=on_date) | Q(actual_end_date__isnull=True, end_date__gte=on_date))
    if "employee_id" in filters:
        rows = rows.filter(employee_id=int(filters["employee_id"]))
    rows = list(rows.select_related("employee__rank", "employee__staff_unit__position"))
    if not rows:
        return result
    catalog = StatusCatalog.from_rows(StatusType.objects.values(
        "code", "priority", "report_column_code", "counts_in_staff"))
    projections = defaultdict(list)
    for row in OpsEmployeeStatus.objects.filter(
        employee_id__in={row.employee_id for row in rows}, cancelled_at__isnull=True,
        date_start__lte=on_date, date_end__gt=on_date,
    ).order_by("pk").values("id", "employee_id", "status_type_code", "date_start", "date_end", "source_ref"):
        projections[row["employee_id"]].append(row)
    winners = {employee_id: resolve_status_row(values, on_date, catalog)
               for employee_id, values in projections.items()}
    for row in rows:
        winner = winners.get(row.employee_id)
        if (winner is None or catalog.column[winner["status_type_code"]] != "ON_DUTY"
                or winner["source_ref"] != f"personnel:{row.pk}"):
            continue
        employee = row.employee
        unit = employee.staff_unit
        result["results"].append({
            "status_id": row.pk, "employee_id": employee.pk,
            "employee_name": " ".join(part for part in (employee.last_name, employee.first_name, employee.middle_name) if part),
            "rank_name": employee.rank.name if employee.rank else "",
            "position_name": unit.position.name if unit.position else "",
            "department_id": str(department.pk), "department_name": department.name,
            "placement": placement_for_roster(row.duty_assignment, row.start_date, row.actual_end_date or row.end_date),
            "start_date": row.start_date.isoformat(),
            "end_date": (row.actual_end_date or row.end_date).isoformat(),
            "assigned_at": row.created_at.isoformat(),
        })
    return result
