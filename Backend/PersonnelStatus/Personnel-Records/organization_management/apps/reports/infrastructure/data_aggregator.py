"""Сборка данных расхода по подразделениям на дату.

Подразделение сотрудника берётся из ШТАТНОЙ ЕДИНИЦЫ (staff_unit.division):
у employees.Employee своего поля подразделения нет, и прежняя фильтрация
`Employee.objects.filter(division_id__in=...)` роняла сборку с FieldError —
то есть генерация отчёта не доходила до арифметики ни разу.

Главное правило: КАЖДЫЙ сотрудник штата попадает ровно в одну колонку.
Прежняя версия складывала семь типов из тринадцати, а остаток объявляла
«в строю» — человек на дежурстве, на соревнованиях или в отпуске по рапорту
молча считался присутствующим.
"""
from typing import Any, Dict, Iterable, Tuple

from django.db.models import Count
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.catalog import (
    LEGACY_REPORT_COLUMN_BY_STATUS as REPORT_COLUMN_BY_STATUS,
    LEGACY_STATUS_PRIORITY as STATUS_PRIORITY,
    PERSONNEL_REPORT_COLUMNS as ABSENCE_COLUMNS,
    personnel_reporting_catalog,
)
from organization_management.apps.statuses.selectors import (
    effective_status_types_by_employee,
    statuses_effective_on_date,
)
from organization_management.apps.staff_unit.models import StaffUnit

_ST = EmployeeStatus.StatusType

# In-service, on-duty and incoming staff are available to the division.
PRESENT_OWN_COLUMNS: Tuple[str, ...] = ("in_service", "on_duty")


class DataAggregator:
    """Сборщик данных для отчётов по расходу на дату."""

    def _division_subtree_ids(self, division: Division):
        return division.get_descendants(include_self=True).values_list("id", flat=True)

    def _reference_date(self, report):
        if report.date_to:
            return report.date_to
        if report.date_from:
            return report.date_from
        return timezone.localdate()

    def _active_on_date(self, queryset, ref_date):
        """Статусы, действующие на дату.

        Конец периода — фактический, если он проставлен: досрочно завершённый
        статус хранит прежний end_date, и без COALESCE отпуск, из которого
        человека отозвали, продолжал бы считаться.

        Отменённые исключены: отменённая строка остаётся в данных как след
        планирования, но фактом не является.
        """
        return statuses_effective_on_date(queryset, ref_date)

    def _effective_status_by_employee(
        self, statuses: Iterable[tuple], status_catalog
    ) -> Dict[int, str]:
        """Один статус на сотрудника — самый значимый из действующих.

        ДЕЙСТВУЮЩИЙ статус старше завершённого, и только потом сравнивается
        значимость типа. Это разводит день досрочного завершения: у человека,
        вернувшегося сегодня, завершённый статус закрыт сегодняшним числом и
        в окно даты попадает, но в расходе он уже в строю, а не там, откуда
        его отозвали.

        Завершённые не отбрасываются вовсе: отчёт за прошедшую дату опирается
        именно на них.
        """
        return effective_status_types_by_employee(statuses, status_catalog)

    def collect_data(self, report) -> Dict[str, Any]:
        if report.division_id:
            division_ids = list(self._division_subtree_ids(report.division))
        else:
            division_ids = list(Division.objects.values_list("id", flat=True))

        ref_date = self._reference_date(report)
        status_catalog = personnel_reporting_catalog()

        # Штат подразделения — занятые штатные единицы. Подразделение человека
        # это подразделение его слота: другого признака у Employee нет.
        occupied = StaffUnit.objects.filter(
            division_id__in=division_ids,
            employee__isnull=False,
            employee__employment_status=Employee.EmploymentStatus.WORKING,
        ).values_list("employee_id", "division_id")
        division_by_employee: Dict[int, int] = dict(occupied)

        effective = self._effective_status_by_employee(
            self._active_on_date(
                EmployeeStatus.objects.filter(
                    employee_id__in=list(division_by_employee.keys())
                ),
                ref_date,
            ).values_list("employee_id", "status_type", "state", "start_date", "actual_end_date"), status_catalog
        )

        # Пустые счётчики на КАЖДОЕ подразделение области: подразделение без
        # сотрудников должно печататься нулевой строкой, а не исчезать.
        tally: Dict[int, Dict[str, int]] = {
            did: {column: 0 for column, _label in status_catalog.columns}
            for did in division_ids
        }
        for employee_id, did in division_by_employee.items():
            status_type = effective.get(employee_id)
            # Без действующего статуса человек в строю: отсутствие записи — не
            # отсутствие человека.
            column = status_catalog.column_for(status_type)
            tally[did][column] += 1

        # Прикомандированные считаются на ПРИНИМАЮЩЕЙ стороне по
        # related_division строк «Откомандирован в». Область сотрудников здесь
        # не сужается: человек приходит из чужого подразделения, и фильтр по
        # штату отчёта обнулял бы эту колонку всегда, когда отдающая сторона
        # вне выборки.
        incoming_rows = list(
            self._active_on_date(
                EmployeeStatus.objects.filter(
                    status_type__in=status_catalog.aliases_for(_ST.SECONDED_TO),
                    related_division_id__in=division_ids,
                    employee__employment_status=Employee.EmploymentStatus.WORKING,
                ),
                ref_date,
            ).values_list("related_division_id", "employee_id")
        )
        # Строка откомандирования в окно даты попадает и в день возврата: её
        # закрывают сегодняшним числом. Поэтому «пришёл» считается не по самой
        # строке, а по ДЕЙСТВУЮЩЕМУ статусу человека — иначе вернувшийся ещё
        # сутки числился бы у принимающей стороны.
        incoming_effective = self._effective_status_by_employee(
            self._active_on_date(
                EmployeeStatus.objects.filter(
                    employee_id__in={employee_id for _did, employee_id in incoming_rows}
                ),
                ref_date,
            ).values_list("employee_id", "status_type", "state", "start_date", "actual_end_date"), status_catalog
        )
        seconded_in_map: Dict[int, set] = {}
        for did, employee_id in incoming_rows:
            if status_catalog.code_for(incoming_effective.get(employee_id)) != _ST.SECONDED_TO:
                continue
            seconded_in_map.setdefault(did, set()).add(employee_id)

        # order_by() обязателен: StaffUnit — MPTT-модель с сортировкой по
        # дереву в Meta, и без сброса поля сортировки уезжают в GROUP BY —
        # группировка дробится по слотам, и в штатной численности остаётся
        # единица вместо количества слотов.
        staffing_map = {
            row["division_id"]: row["qty"]
            for row in StaffUnit.objects.filter(division_id__in=division_ids)
            .order_by()
            .values("division_id")
            .annotate(qty=Count("id"))
        }

        rows = []
        for d in Division.objects.filter(id__in=division_ids).values("id", "name"):
            did = d["id"]
            counts = tally[did]
            seconded_in = len(seconded_in_map.get(did, ()))
            staffing_qty = staffing_map.get(did, 0) or 0
            present_total = (
                sum(counts[column] for column in PRESENT_OWN_COLUMNS) + seconded_in
            )
            presence_pct = (
                present_total / staffing_qty * 100.0 if staffing_qty else 0.0
            )

            row = {
                "division_id": did,
                "division_name": d["name"],
                "staff_unit": staffing_qty,
                # Списочная численность — сколько людей разложено по колонкам.
                # Без неё нельзя проверить, что сумма колонок сходится.
                "headcount": sum(counts.values()),
                "seconded_in": seconded_in,
                "present_total": present_total,
                "presence_pct": round(presence_pct, 2),
            }
            row.update(counts)
            rows.append(row)

        return {
            "division": report.division.name if report.division_id else "Вся организация",
            "date": str(ref_date),
            "columns": list(status_catalog.columns),
            "rows": rows,
        }
