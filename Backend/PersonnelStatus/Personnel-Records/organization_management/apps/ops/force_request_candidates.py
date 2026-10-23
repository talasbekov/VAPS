"""Scoped, read-only assessment. Ranking applies to the returned page only."""
import datetime as dt
from django.db.models import Q
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.selectors import DivisionTreeSelector, DailySubmissionSelector
from organization_management.apps.operations.status_service import validate_status_creation
from organization_management.apps.operations.amendment_enforcement import affected_days, assert_amendment_reason
from organization_management.apps.ops.forces_requests import _event_of_request, _raw_allocations, directorate_request_view, validate_request_kind
from organization_management.apps.ops.security_events import personnel_full_name, validate_allocation_member, ASSIGNMENT_STATUS_CODE
from organization_management.apps.ops.force_campaigns import validate_reserve_member


def candidates_for_request(allocation_id, allowed_division_ids, *, kind_code, role_code="", search="", page=1, page_size=50, employee_ids=None):
    event = _event_of_request(allocation_id, allowed_division_ids)
    validate_request_kind(kind_code, role_code)
    if not kind_code:
        raise DomainError("VALIDATION_ERROR", 400, message="Выберите вид участия.")
    allocation = next(row for row in _raw_allocations(event) if row.get("id") == allocation_id)
    children = DivisionTreeSelector.children_map()
    addressed = set()
    for row in allocation.get("directorates") or []:
        addressed |= DivisionTreeSelector.subtree_ids(int(row["divisionId"]), children_map=children)
    visible = addressed if allowed_division_ids is None else addressed & set(allowed_division_ids)
    employees = Employee.objects.filter(is_active=True, staff_unit__division_id__in=visible).select_related("rank", "staff_unit__division").distinct().order_by("last_name", "first_name", "pk")
    for token in search.split():
        employees = employees.filter(Q(last_name__icontains=token) | Q(first_name__icontains=token) | Q(middle_name__icontains=token) | Q(personnel_number__icontains=token) | Q(staff_unit__division__name__icontains=token))
    if employee_ids is not None:
        employees = employees.filter(pk__in=employee_ids)
    count = employees.count()
    start = (page - 1) * page_size
    rows = []
    end = (event.business_date_end or event.business_date) + dt.timedelta(days=1)
    for person in employees[start:start + page_size]:
        row = {"employeeId": str(person.pk), "name": personnel_full_name(person), "rankLabel": person.rank.name if person.rank else "", "unit": person.staff_unit.division.name,
               "assessment": "RESERVE_ELIGIBLE" if kind_code == "PHYSICAL_SQUAD" else "AVAILABLE", "code": "", "overridable": False,
               "message": "Можно предложить в резерв; даты назначения проверит Штаб." if kind_code == "PHYSICAL_SQUAD" else "Проверка на период мероприятия пройдена. При отправке проверим повторно."}
        try:
            if kind_code == "PHYSICAL_SQUAD":
                validate_reserve_member(event=event, allocation_id=allocation_id, employee=person)
            else:
                validate_allocation_member(event, allocation_id, person)
                soft_warning = None
                try:
                    validate_status_creation(employee=person, status_type_code=ASSIGNMENT_STATUS_CODE, date_start=event.business_date, date_end=end)
                except DomainError as error:
                    if not getattr(error, "overridable", False):
                        raise
                    soft_warning = error
                assert_amendment_reason(DailySubmissionSelector.covering(person.pk, affected_days([(event.business_date, end)])))
                if soft_warning is not None:
                    raise soft_warning
        except DomainError as error:
            overridable = bool(getattr(error, "overridable", False))
            row.update(assessment="REQUIRES_REASON" if overridable else "BLOCKED", code=error.code, overridable=overridable,
                       message={"OVERLAPPING_HARD_STATUS": "На период мероприятия есть несовместимый статус. Выделение запрещено.", "STATUS_OVERLAP_WARNING": "На период мероприятия есть занятость. Для выделения нужно обоснование."}.get(error.code, error.message))
        rows.append(row)
    order = {"AVAILABLE": 0, "RESERVE_ELIGIBLE": 0, "REQUIRES_REASON": 1, "BLOCKED": 2}
    rows.sort(key=lambda row: order[row["assessment"]])
    return {"request": directorate_request_view(allocation_id, allowed_division_ids), "results": rows, "count": count, "page": page,
            "pageSize": page_size, "hasNext": start + page_size < count, "assessmentScope": "page"}
