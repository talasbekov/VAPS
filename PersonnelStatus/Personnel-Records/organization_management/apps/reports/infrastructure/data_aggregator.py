from typing import Dict, Any

from django.db.models import Count, Q
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.staff_unit.models import StaffUnit


class DataAggregator:
    """
    Сборщик данных для отчетов по расходу на дату (Parity with sync XLSX generator).
    """

    def _reference_date(self, report):
        if report.date_to:
            return report.date_to
        if report.date_from:
            return report.date_from
        return timezone.now().date()

    def collect_data(self, report) -> Dict[str, Any]:
        ref_date = self._reference_date(report)
        department = report.division

        if not department:
            return {"division": "Вся организация", "date": str(ref_date), "rows": [], "summary": {}}

        # Fetch all descendant divisions of the department to avoid N+1
        descendants = list(department.get_descendants(include_self=True))
        descendant_ids = [d.id for d in descendants]

        # Get directorates (direct children of department that are Directorates)
        directorates = [d for d in descendants if d.parent_id == department.id and d.division_type == Division.DivisionType.DIRECTORATE]

        # Map each descendant division to its top-level directorate (for Python rollup)
        # Also identify direct department divisions.
        div_to_directorate = {}
        for d in descendants:
            # Trace back to find if it belongs to a directorate
            current = d
            directorate_id = None
            while current and current.id != department.id:
                if current.division_type == Division.DivisionType.DIRECTORATE:
                    directorate_id = current.id
                    break
                # Find parent in our prefetched list
                parent = next((p for p in descendants if p.id == current.parent_id), None)
                current = parent
            div_to_directorate[d.id] = directorate_id

        # 1. Staff Units & Employees
        staff_units_qs = StaffUnit.objects.filter(division_id__in=descendant_ids).values('division_id', 'employee')

        staff_qty_map = {}
        employees_map = {}
        vacancies_map = {}

        for su in staff_units_qs:
            div_id = su['division_id']
            staff_qty_map[div_id] = staff_qty_map.get(div_id, 0) + 1
            if su['employee']:
                employees_map[div_id] = employees_map.get(div_id, 0) + 1
            else:
                vacancies_map[div_id] = vacancies_map.get(div_id, 0) + 1

        # 2. Statuses
        statuses_qs = EmployeeStatus.objects.filter(
            employee__staff_unit__division_id__in=descendant_ids,
            start_date__lte=ref_date,
            state=EmployeeStatus.StatusState.ACTIVE
        ).filter(Q(end_date__isnull=True) | Q(end_date__gte=ref_date)).values('employee__staff_unit__division_id', 'status_type')

        status_maps = {
            EmployeeStatus.StatusType.IN_SERVICE: {},
            EmployeeStatus.StatusType.VACATION: {},
            EmployeeStatus.StatusType.SICK_LEAVE: {},
            EmployeeStatus.StatusType.BUSINESS_TRIP: {},
            EmployeeStatus.StatusType.TRAINING: {},
            EmployeeStatus.StatusType.SECONDED_TO: {},
            EmployeeStatus.StatusType.OTHER_ABSENCE: {},
        }

        for st in statuses_qs:
            div_id = st['employee__staff_unit__division_id']
            st_type = st['status_type']
            if st_type in status_maps:
                status_maps[st_type][div_id] = status_maps[st_type].get(div_id, 0) + 1

        def safe_get(m, key):
            return m.get(key, 0)

        # 3. Python Rollup
        directorate_results = {dir.id: {
            "staff_unit": 0, "total_working": 0, "vacancies": 0, "in_service": 0, "vacation": 0,
            "sick_leave": 0, "business_trip": 0, "training": 0, "other_absence": 0, "seconded_out": 0
        } for dir in directorates}

        total_summary = {
            "staff_unit": 0, "total_working": 0, "vacancies": 0, "in_service": 0, "vacation": 0,
            "sick_leave": 0, "business_trip": 0, "training": 0, "other_absence": 0, "seconded_out": 0
        }

        for div in descendants:
            div_id = div.id
            dir_id = div_to_directorate[div_id]

            su_qty = safe_get(staff_qty_map, div_id)
            emp_qty = safe_get(employees_map, div_id)
            vac_qty = safe_get(vacancies_map, div_id)
            in_serv = safe_get(status_maps[EmployeeStatus.StatusType.IN_SERVICE], div_id)
            vac = safe_get(status_maps[EmployeeStatus.StatusType.VACATION], div_id)
            sick = safe_get(status_maps[EmployeeStatus.StatusType.SICK_LEAVE], div_id)
            bt = safe_get(status_maps[EmployeeStatus.StatusType.BUSINESS_TRIP], div_id)
            train = safe_get(status_maps[EmployeeStatus.StatusType.TRAINING], div_id)
            other = safe_get(status_maps[EmployeeStatus.StatusType.OTHER_ABSENCE], div_id)
            sec_out = safe_get(status_maps[EmployeeStatus.StatusType.SECONDED_TO], div_id)

            # Roll up to Directorate
            if dir_id in directorate_results:
                dr = directorate_results[dir_id]
                dr["staff_unit"] += su_qty
                dr["total_working"] += emp_qty
                dr["vacancies"] += vac_qty
                dr["in_service"] += in_serv
                dr["vacation"] += vac
                dr["sick_leave"] += sick
                dr["business_trip"] += bt
                dr["training"] += train
                dr["other_absence"] += other
                dr["seconded_out"] += sec_out

            # Roll up to Total (Total includes ALL divisions in scope)
            total_summary["staff_unit"] += su_qty
            total_summary["total_working"] += emp_qty
            total_summary["vacancies"] += vac_qty
            total_summary["in_service"] += in_serv
            total_summary["vacation"] += vac
            total_summary["sick_leave"] += sick
            total_summary["business_trip"] += bt
            total_summary["training"] += train
            total_summary["other_absence"] += other
            total_summary["seconded_out"] += sec_out

        rows = []
        for dir in directorates:
            dr = directorate_results[dir.id]
            rows.append({
                "division_id": dir.id,
                "division_name": dir.name,
                "staff_unit": dr["staff_unit"],
                "total_working": dr["total_working"],
                "vacancies": dr["vacancies"],
                "in_service": dr["in_service"],
                "vacation": dr["vacation"],
                "sick_leave": dr["sick_leave"],
                "business_trip": dr["business_trip"],
                "training": dr["training"],
                "other_absence": dr["other_absence"],
                "seconded_out": dr["seconded_out"],
            })

        # Re-map total_working to total_working in summary to match the contract
        total_summary["staffing_qty"] = total_summary.pop("staff_unit")

        return {
            "division": department.name,
            "date": str(ref_date),
            "rows": rows,
            "summary": total_summary,
        }
