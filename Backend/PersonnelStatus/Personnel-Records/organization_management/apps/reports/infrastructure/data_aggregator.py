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
from typing import Any, Dict, Iterable, Optional, Tuple

from django.db.models import Count, Q
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.staff_unit.models import StaffUnit

_ST = EmployeeStatus.StatusType

# Колонка расхода для каждого типа статуса. Разбиение повторяет канонический
# каталог ОМ (operations.StatusType.report_column_code): отпуск по рапорту
# идёт в «Отпуск», соревнования и конференция — в «Учёбу», дежурство и отдых
# после него — свои колонки (так же, как в бумажном расходе, см.
# reports/utils.py).
#
# Принимающая сторона прикомандирования в этой карте не участвует вовсе: она
# считается отдельно, по related_division строк SECONDED_TO (см. ниже). Эти
# люди не из штата подразделения, и раскладывать их по его колонкам нельзя.
REPORT_COLUMN_BY_STATUS: Dict[str, str] = {
    _ST.IN_SERVICE: "in_service",
    _ST.VACATION: "vacation",
    _ST.LEAVE_BY_REPORT: "vacation",
    _ST.SICK_LEAVE: "sick_leave",
    _ST.BUSINESS_TRIP: "business_trip",
    _ST.TRAINING: "training",
    _ST.COMPETITION: "training",
    _ST.CONFERENCE: "training",
    _ST.ON_DUTY: "on_duty",
    _ST.AFTER_DUTY: "after_duty",
    _ST.OTHER_ABSENCE: "other_absence",
    _ST.SECONDED_TO: "seconded_out",
    # SECONDED_FROM в ту же колонку и это не описка: related_division такой
    # строки — подразделение-ИСТОЧНИК, оно же родное для сотрудника, и в штате
    # мы видим его именно там. Для родного подразделения человек ушёл.
    # До колонки строка доходит редко: одобрение прикомандирования пытается
    # завести пару SECONDED_TO + SECONDED_FROM на один период, но модель
    # пересечения запрещает (EmployeeStatus.clean), а если пара всё же есть
    # в данных — её разводит приоритет ниже.
    _ST.SECONDED_FROM: "seconded_out",
}

# Порядок значимости при нескольких статусах на одну дату: меньше — важнее.
# Числа повторяют приоритеты канонического каталога ОМ.
#
# Модель запрещает пересекающиеся статусы, так что обычно выбирать не из
# чего. Разбор нужен для данных, заведённых мимо save() (импорт, bulk_create,
# правка в БД): там пара «Откомандирован в» + «Прикомандирован из» встречается,
# и SECONDED_TO (40) обязан выигрывать у SECONDED_FROM (50) — иначе у отдающей
# стороны человек оказался бы «прикомандирован» к самому себе.
STATUS_PRIORITY: Dict[str, int] = {
    _ST.SICK_LEAVE: 10,
    _ST.LEAVE_BY_REPORT: 15,
    _ST.VACATION: 20,
    _ST.BUSINESS_TRIP: 30,
    _ST.TRAINING: 32,
    _ST.COMPETITION: 34,
    _ST.CONFERENCE: 36,
    _ST.OTHER_ABSENCE: 38,
    _ST.SECONDED_TO: 40,
    _ST.SECONDED_FROM: 50,
    _ST.AFTER_DUTY: 60,
    _ST.ON_DUTY: 70,
    _ST.IN_SERVICE: 999,
}

# Колонки расхода в порядке вывода. Генераторы (xlsx/docx/pdf) печатают
# заголовки из этого же порядка — колонка, добавленная здесь, не потеряется
# в документе.
ABSENCE_COLUMNS: Tuple[Tuple[str, str], ...] = (
    ("in_service", "В строю"),
    ("vacation", "Отпуск"),
    ("sick_leave", "Больничный"),
    ("business_trip", "Командировка"),
    ("training", "Учёба"),
    ("on_duty", "На дежурстве"),
    ("after_duty", "После дежурства"),
    ("other_absence", "Прочие отсутствия"),
    ("seconded_out", "Откомандировано"),
)

# «Наличествует» = кто в распоряжении подразделения на дату: свои в строю,
# свои на дежурстве и прикомандированные извне. Отдых после дежурства сюда
# НЕ входит — человек не в распоряжении. Определение собрано в одном месте
# намеренно: это единственное место, где его придётся править, если владелец
# читает «наличие» иначе.
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
        return timezone.now().date()

    def _active_on_date(self, queryset, ref_date):
        """Статусы, действующие на дату.

        Конец периода — фактический, если он проставлен: досрочно завершённый
        статус хранит прежний end_date, и без COALESCE отпуск, из которого
        человека отозвали, продолжал бы считаться.

        Отменённые исключены: отменённая строка остаётся в данных как след
        планирования, но фактом не является.
        """
        return queryset.filter(start_date__lte=ref_date).exclude(
            state=EmployeeStatus.StatusState.CANCELLED
        ).filter(
            Q(actual_end_date__gte=ref_date)
            | Q(actual_end_date__isnull=True, end_date__gte=ref_date)
            | Q(actual_end_date__isnull=True, end_date__isnull=True)
        )

    def _effective_status_by_employee(
        self, statuses: Iterable[EmployeeStatus]
    ) -> Dict[int, str]:
        """Один статус на сотрудника — самый значимый из действующих."""
        best: Dict[int, str] = {}
        for employee_id, status_type in statuses:
            current = best.get(employee_id)
            if current is None or _priority(status_type) < _priority(current):
                best[employee_id] = status_type
        return best

    def collect_data(self, report) -> Dict[str, Any]:
        if report.division_id:
            division_ids = list(self._division_subtree_ids(report.division))
        else:
            division_ids = list(Division.objects.values_list("id", flat=True))

        ref_date = self._reference_date(report)

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
            ).values_list("employee_id", "status_type")
        )

        # Пустые счётчики на КАЖДОЕ подразделение области: подразделение без
        # сотрудников должно печататься нулевой строкой, а не исчезать.
        tally: Dict[int, Dict[str, int]] = {
            did: {column: 0 for column, _label in ABSENCE_COLUMNS}
            for did in division_ids
        }
        for employee_id, did in division_by_employee.items():
            status_type = effective.get(employee_id)
            # Без действующего статуса человек в строю: отсутствие записи — не
            # отсутствие человека.
            column = (
                REPORT_COLUMN_BY_STATUS[status_type]
                if status_type is not None
                else "in_service"
            )
            tally[did][column] += 1

        # Прикомандированные считаются на ПРИНИМАЮЩЕЙ стороне по
        # related_division строк «Откомандирован в». Область сотрудников здесь
        # не сужается: человек приходит из чужого подразделения, и фильтр по
        # штату отчёта обнулял бы эту колонку всегда, когда отдающая сторона
        # вне выборки.
        incoming_rows = self._active_on_date(
            EmployeeStatus.objects.filter(
                status_type=_ST.SECONDED_TO,
                related_division_id__in=division_ids,
                employee__employment_status=Employee.EmploymentStatus.WORKING,
            ),
            ref_date,
        ).values_list("related_division_id", "employee_id")
        seconded_in_map: Dict[int, set] = {}
        for did, employee_id in incoming_rows:
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
            "columns": list(ABSENCE_COLUMNS),
            "rows": rows,
        }


def _priority(status_type: Optional[str]) -> int:
    # Неизвестный код не должен вытеснять реальный статус: у него худший
    # приоритет, а до колонки он всё равно не дойдёт (см. тест полноты
    # REPORT_COLUMN_BY_STATUS).
    return STATUS_PRIORITY.get(status_type, 10_000)
