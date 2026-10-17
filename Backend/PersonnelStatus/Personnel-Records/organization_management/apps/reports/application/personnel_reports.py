"""Read-only current staffing and factual absence reports.

Staff membership is current, matching the existing strength report. Historical
status facts use the canonical half-open interval and winner rules. Absence
counts visit interval boundaries, never materialize employee/day combinations.
"""
import csv
from collections import defaultdict
from datetime import timedelta
from io import BytesIO, StringIO

from django.db.models import Count, F, Q
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.selectors import (
    DivisionTreeSelector, EmployeeStatusSelector, StaffUnitSelector,
)
from organization_management.apps.operations.strength_report import StatusCatalog, resolve_status_row
from organization_management.apps.staff_unit.models import StaffUnit


def division_options(division_ids):
    naming = DivisionTreeSelector.naming_map(division_ids)
    return [
        {"id": did, "name": meta["name"], "ancestors": meta["ancestors"]}
        for did, meta in sorted(naming.items(), key=lambda item: (tuple([*item[1]["ancestors"], item[1]["name"]]), item[0]))
    ]


def page_of(rows, page, page_size):
    start = (page - 1) * page_size
    return rows[start:start + page_size]


def _staff_queryset(division_ids):
    return StaffUnit.objects.filter(division_id__in=division_ids).select_related(
        "position", "employee__rank", "division"
    ).order_by(
        "division__tree_id", "division__lft",
        F("import_order").asc(nulls_last=True), "index", "id",
    )


def _staff_rows(queryset, naming):
    for slot in queryset.iterator(chunk_size=1000):
        employee = slot.employee
        working = employee is not None and employee.employment_status == Employee.EmploymentStatus.WORKING
        yield {
            "staff_unit_id": slot.pk,
            "external_id": slot.external_id,
            "division_id": slot.division_id,
            "division_name": slot.division.name,
            "ancestors": naming.get(slot.division_id, {}).get("ancestors", []),
            "position": slot.position.name if slot.position else None,
            "employee_id": employee.pk if employee else None,
            "employee_name": " ".join(filter(None, [employee.last_name, employee.first_name, employee.middle_name])) if employee else None,
            "personnel_number": employee.personnel_number if employee else None,
            "rank": employee.rank.name if employee and employee.rank else None,
            "hire_date": employee.hire_date.isoformat() if employee and employee.hire_date else None,
            "occupancy": "occupied" if working else ("dismissed_in_slot" if employee else "vacant"),
        }


def staffing_report(division_ids, *, page=1, page_size=25, full=False):
    queryset = _staff_queryset(division_ids)
    working = Q(employee__employment_status=Employee.EmploymentStatus.WORKING)
    totals = queryset.order_by().aggregate(
        staff_total=Count("id"), occupied=Count("id", filter=working),
        dismissed_in_slot=Count("id", filter=Q(employee__isnull=False) & ~working),
    )
    totals["vacancies"] = totals["staff_total"] - totals["occupied"]
    naming = DivisionTreeSelector.naming_map(division_ids)
    offset = (page - 1) * page_size
    # Count first: an out-of-range page must not reach SQL with an overflowing
    # OFFSET. The API turns this empty preview into an explicit validation error.
    selected = queryset if full else queryset.none() if offset >= totals["staff_total"] else queryset[offset:offset + page_size]
    rows = _staff_rows(selected, naming)
    return {"count": totals["staff_total"], "totals": totals, "rows": rows if full else list(rows)}


def absence_report(division_ids, date_from, date_to):
    exclusive_end = date_to + timedelta(days=1)
    catalog_rows = list(StatusType.objects.values(
        "code", "name", "priority", "report_column_code", "counts_in_staff", "is_placeholder"
    ))
    catalog = StatusCatalog.from_rows(catalog_rows)
    metadata = {row["code"]: row for row in catalog_rows}
    slots, _dismissed = StaffUnitSelector.slots_with_working_occupants(division_ids)
    employee_ids = {slot["employee_id"] for slot in slots if slot["employee_id"] is not None}
    facts = EmployeeStatusSelector.overlapping_range(date_from, exclusive_end, employee_ids=employee_ids)
    by_employee = defaultdict(list)
    for row in facts:
        by_employee[row["employee_id"]].append(row)
    days_by_type = defaultdict(int)
    people_by_type = defaultdict(set)
    absent_people = set()
    for employee_id, rows in by_employee.items():
        boundaries = sorted({date_from, exclusive_end} | {
            boundary for row in rows
            for boundary in (max(date_from, row["date_start"]), min(exclusive_end, row["date_end"]))
        })
        for start, end in zip(boundaries, boundaries[1:]):
            winner = resolve_status_row(rows, start, catalog)
            if winner is None:
                continue
            code = winner["status_type_code"]
            info = metadata[code]
            # A duty/event is still present. A placeholder is not a factual
            # absence, and off-list types do not belong to the staff denominator.
            if not info["counts_in_staff"] or info["is_placeholder"] or info["report_column_code"] in {"IN_SERVICE", "ON_DUTY"}:
                continue
            days_by_type[code] += (end - start).days
            people_by_type[code].add(employee_id)
            absent_people.add(employee_id)
    rows = [
        {"code": code, "name": metadata[code]["name"], "person_days": count, "unique_people": len(people_by_type[code])}
        for code, count in sorted(days_by_type.items(), key=lambda item: (metadata[item[0]]["priority"], item[0]))
    ]
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "count": len(rows), "rows": rows,
        "totals": {"person_days": sum(days_by_type.values()), "unique_people": len(absent_people)},
    }


OCCUPANCY_LABELS = {"occupied": "Занят", "vacant": "Вакантен", "dismissed_in_slot": "Занят уволенным"}


def staffing_xlsx(rows):
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("Текущий штат")
    sheet.freeze_panes = "A2"
    headings = ["ID штатной единицы", "Подразделение", "Должность", "Сотрудник", "Табельный номер", "Звание", "Состояние слота", "Дата приёма", "Импортный ID единицы"]
    header = []
    for title in headings:
        cell = WriteOnlyCell(sheet, value=title)
        cell.font = Font(bold=True)
        header.append(cell)
    sheet.append(header)
    for row in rows:
        values = [
            row["staff_unit_id"], " › ".join([*row["ancestors"], row["division_name"]]), row["position"],
            row["employee_name"], row["personnel_number"], row["rank"], OCCUPANCY_LABELS[row["occupancy"]],
            row["hire_date"], row["external_id"],
        ]
        cells = []
        for value in values:
            cell = WriteOnlyCell(sheet, value=value)
            if isinstance(value, str):
                cell.data_type = "s"  # imported dictionary/name text is never a formula
            cells.append(cell)
        sheet.append(cells)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def _csv_text(value):
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else text


def absence_csv(report):
    output = StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["С", "По", "Тип отсутствия (по текущему штату)", "Дней отсутствия (человеко-дни)", "Сотрудников (уникальные)"])
    for row in report["rows"]:
        writer.writerow([report["date_from"], report["date_to"], _csv_text(row["name"]), row["person_days"], row["unique_people"]])
    return output.getvalue().encode("utf-8-sig")
