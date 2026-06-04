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
        return self._collect_for_scope(department, ref_date)

    def collect_for_division(self, division, date=None) -> Dict[str, Any]:
        ref_date = date or timezone.now().date()
        return self._collect_for_scope(division, ref_date)

    def _collect_for_scope(self, department, ref_date) -> Dict[str, Any]:

        if not department:
            # Fallback to entire organization
            descendants = list(Division.objects.all())
            department_name = "Вся организация"
            department_id = None
        else:
            descendants = list(department.get_descendants(include_self=True))
            department_name = department.name
            department_id = department.id
        descendant_ids = [d.id for d in descendants]

        # Get directorates (direct children of department that are Directorates)
        directorates = [d for d in descendants if d.parent_id == department_id and d.division_type == Division.DivisionType.DIRECTORATE]

        # Map each descendant division to its top-level directorate (for Python rollup)
        # Also identify direct department divisions.
        div_to_directorate = {}
        division_by_id = {d.id: d for d in descendants}
        for d in descendants:
            # Trace back to find if it belongs to a directorate
            current = d
            directorate_id = None
            while current and current.id != department_id:
                if current.division_type == Division.DivisionType.DIRECTORATE:
                    directorate_id = current.id
                    break
                # Find parent in our prefetched list in O(1)
                current = division_by_id.get(current.parent_id)
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

        on_duty_type = getattr(EmployeeStatus.StatusType, 'ON_DUTY', 'on_duty')
        after_duty_type = getattr(EmployeeStatus.StatusType, 'AFTER_DUTY', 'after_duty')
        leave_by_report_type = getattr(EmployeeStatus.StatusType, 'LEAVE_BY_REPORT', 'leave_by_report')
        competition_type = getattr(EmployeeStatus.StatusType, 'COMPETITION', 'competition')

        # 2. Statuses
        statuses_qs = EmployeeStatus.objects.filter(
            employee__staff_unit__division_id__in=descendant_ids,
            start_date__lte=ref_date,
            state=EmployeeStatus.StatusState.ACTIVE
        ).filter(Q(end_date__isnull=True) | Q(end_date__gte=ref_date)).select_related('employee', 'employee__staff_unit', 'employee__staff_unit__division', 'related_division')

        # Прикомандированные считаем по related_division (входящие на приемную сторону)
        incoming_qs = EmployeeStatus.objects.filter(
            status_type=EmployeeStatus.StatusType.SECONDED_TO,
            related_division_id__in=descendant_ids,
            start_date__lte=ref_date,
            state=EmployeeStatus.StatusState.ACTIVE
        ).filter(Q(end_date__isnull=True) | Q(end_date__gte=ref_date)).select_related('employee', 'employee__staff_unit', 'employee__staff_unit__division', 'related_division')

        seconded_in_map = {}
        for incoming in incoming_qs:
            div_id = incoming.related_division_id
            if div_id:
                if div_id not in seconded_in_map:
                    seconded_in_map[div_id] = []
                seconded_in_map[div_id].append(incoming)

        status_maps = {
            EmployeeStatus.StatusType.IN_SERVICE: {},
            EmployeeStatus.StatusType.VACATION: {},
            EmployeeStatus.StatusType.SICK_LEAVE: {},
            EmployeeStatus.StatusType.BUSINESS_TRIP: {},
            EmployeeStatus.StatusType.TRAINING: {},
            EmployeeStatus.StatusType.SECONDED_TO: {},
            EmployeeStatus.StatusType.OTHER_ABSENCE: {},
            # Additional keys for missing notes mapping:
            "ON_DUTY": {},
            "AFTER_DUTY": {},
            EmployeeStatus.StatusType.SECONDED_FROM: {},
        }

        for st in statuses_qs:
            # Check for duty types if defined or fall back.
            # The codebase doesn't have an explicit ON_DUTY type, let's keep all matching strings dynamically or use the standard mapping
            div_id = st.employee.staff_unit.division_id
            st_type = st.status_type

            # Map standard statuses
            if st_type in status_maps:
                if div_id not in status_maps[st_type]:
                    status_maps[st_type][div_id] = []
                status_maps[st_type][div_id].append(st)

            # If the app defines ON_DUTY/AFTER_DUTY custom logic elsewhere, we map it.
            # In utils.py they used EmployeeStatus.StatusType.ON_DUTY explicitly (if it exists).
            # Let's map it safely dynamically if it's not strictly typed in models.py
            if not getattr(EmployeeStatus.StatusType, 'ON_DUTY', None):
                if st_type == 'on_duty':
                    if div_id not in status_maps["ON_DUTY"]: status_maps["ON_DUTY"][div_id] = []
                    status_maps["ON_DUTY"][div_id].append(st)
            if not getattr(EmployeeStatus.StatusType, 'AFTER_DUTY', None):
                if st_type == 'after_duty':
                    if div_id not in status_maps["AFTER_DUTY"]: status_maps["AFTER_DUTY"][div_id] = []
                    status_maps["AFTER_DUTY"][div_id].append(st)

        def safe_get(m, key):
            return m.get(key, 0)

        def format_status_list(lst, with_period=True, with_division=False, division_prefix="в"):
            res = []
            for status in lst:
                emp = status.employee
                name_str = f"{emp.last_name} {emp.first_name}"
                if with_period:
                    period = f"{status.start_date.strftime('%d.%m.%Y') if status.start_date else ''} - {status.end_date.strftime('%d.%m.%Y') if status.end_date else ''}"
                    if with_division:
                        to_div = status.related_division.name if hasattr(status, 'related_division') and status.related_division else "?"
                        res.append(f"{name_str} ({period}, {division_prefix} {to_div})")
                    else:
                        res.append(f"{name_str} ({period})")
                else:
                    res.append(name_str)
            return res

        # 3. Python Rollup
        directorate_results = {dir.id: {
            "staff_unit": 0, "total_working": 0, "vacancies": 0, "in_service": 0, "vacation": 0,
            "sick_leave": 0, "business_trip": 0, "training": 0, "other_absence": 0, "seconded_out": 0,
            "notes": {
                "vacation_list": [],
                "trip_list": [],
                "sick_list": [],
                "on_duty_list": [],
                "after_duty_list": [],
                "training_list": [],
                "seconded_from_list": [],
                "seconded_to_list": []
            }
        } for dir in directorates}

        head_metrics = {
            "staff_unit": 0, "total_working": 0, "vacancies": 0, "in_service": 0, "vacation": 0,
            "sick_leave": 0, "business_trip": 0, "training": 0, "other_absence": 0, "seconded_out": 0,
            "notes": {
                "vacation_list": [],
                "trip_list": [],
                "sick_list": [],
                "on_duty_list": [],
                "after_duty_list": [],
                "training_list": [],
                "seconded_from_list": [],
                "seconded_to_list": []
            }
        }

        total_summary = {
            "staff_unit": 0, "total_working": 0, "vacancies": 0, "in_service": 0, "vacation": 0,
            "sick_leave": 0, "business_trip": 0, "training": 0, "other_absence": 0, "seconded_out": 0,
            "on_duty": 0, "after_duty": 0
        }

        for div in descendants:
            div_id = div.id
            dir_id = div_to_directorate[div_id]

            su_qty = safe_get(staff_qty_map, div_id)
            emp_qty = safe_get(employees_map, div_id)
            vac_qty = safe_get(vacancies_map, div_id)

            in_serv_list = status_maps[EmployeeStatus.StatusType.IN_SERVICE].get(div_id, [])
            leave_by_report_list = status_maps.get(leave_by_report_type, {}).get(div_id, [])
            competition_list = status_maps.get(competition_type, {}).get(div_id, [])

            vac_list = status_maps[EmployeeStatus.StatusType.VACATION].get(div_id, []) + leave_by_report_list
            sick_list = status_maps[EmployeeStatus.StatusType.SICK_LEAVE].get(div_id, [])
            bt_list = status_maps[EmployeeStatus.StatusType.BUSINESS_TRIP].get(div_id, [])
            train_list = status_maps[EmployeeStatus.StatusType.TRAINING].get(div_id, []) + competition_list
            other_list = status_maps[EmployeeStatus.StatusType.OTHER_ABSENCE].get(div_id, [])
            sec_out_list = status_maps[EmployeeStatus.StatusType.SECONDED_TO].get(div_id, [])

            sec_from_type = getattr(EmployeeStatus.StatusType, 'SECONDED_FROM', 'SECONDED_FROM')

            on_duty_list = status_maps.get(on_duty_type, {}).get(div_id, [])
            after_duty_list = status_maps.get(after_duty_type, {}).get(div_id, [])
            sec_from_list = status_maps.get(sec_from_type, {}).get(div_id, [])
            sec_in_list = seconded_in_map.get(div_id, [])

            in_serv = len(in_serv_list)
            vac = len(vac_list)
            sick = len(sick_list)
            bt = len(bt_list)
            train = len(train_list)
            other = len(other_list)
            sec_out = len(sec_out_list)
            sec_in = len(sec_in_list)

            # Determine where to roll up
            dr = None
            if dir_id in directorate_results:
                dr = directorate_results[dir_id]
            elif div_id == department_id:
                dr = head_metrics

            if dr:
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
                dr["seconded_in"] = dr.get("seconded_in", 0) + sec_in

                dr["notes"]["vacation_list"].extend(format_status_list(vac_list, True, False))
                dr["notes"]["trip_list"].extend(format_status_list(bt_list, True, False))
                dr["notes"]["sick_list"].extend(format_status_list(sick_list, True, False))
                dr["notes"]["on_duty_list"].extend(format_status_list(on_duty_list, False, False))
                dr["notes"]["after_duty_list"].extend(format_status_list(after_duty_list, False, False))
                dr["notes"]["training_list"].extend(format_status_list(train_list, True, False))
                dr["notes"]["seconded_from_list"].extend(format_status_list(sec_from_list, True, True, "из"))
                dr["notes"]["seconded_to_list"].extend(format_status_list(sec_out_list, True, True, "в"))

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
            total_summary["seconded_in"] = total_summary.get("seconded_in", 0) + sec_in
            total_summary["on_duty"] += len(on_duty_list)
            total_summary["after_duty"] += len(after_duty_list)

        rows = []
        for dir in directorates:
            dr = directorate_results[dir.id]

            present_total = dr["in_service"] + dr.get("seconded_in", 0)
            presence_pct = (present_total / dr["staff_unit"] * 100.0) if dr["staff_unit"] else 0.0

            rows.append({
                "division_id": dir.id,
                "division_name": dir.name,
                "staff_unit": dr["staff_unit"],
                "staffing_qty": dr["staff_unit"],  # backward-compatible alias
                "total_working": dr["total_working"],
                "vacancies": dr["vacancies"],
                "in_service": dr["in_service"],
                "vacation": dr["vacation"],
                "sick_leave": dr["sick_leave"],
                "business_trip": dr["business_trip"],
                "training": dr["training"],
                "other_absence": dr["other_absence"],
                "seconded_in": dr.get("seconded_in", 0),
                "seconded_out": dr["seconded_out"],
                "present_total": present_total,
                "presence_pct": round(presence_pct, 2),
                "notes": dr["notes"],
            })

        # Re-map to match the contract and keep backwards compatibility
        total_summary["staffing_qty"] = total_summary.get("staff_unit")

        return {
            "division": department_name,
            "date": str(ref_date),
            "rows": rows,
            "summary": total_summary,
            "head_metrics": head_metrics, # Pass head metrics explicitly for the XLSX rendering row 4/5
        }
