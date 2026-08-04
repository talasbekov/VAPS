"""Расход (строевая записка) раздела ОМ — порт apps/operations/statuses/
services/strength_report.py из Backend/VAPS.

Уровень модуля чист: ни ORM, ни Django. Победитель дня и агрегация — обычные
функции над списками словарей, поэтому считаются и от живых строк, и от
будущего снимка. ORM живёт только в StrengthReportService.

ГЛАВНОЕ ОТЛИЧИЕ ОТ ИСТОЧНИКА — источник правды словаря. Там приоритеты и
колонки продублированы литералами STATUS_TYPE_PRIORITIES/REPORT_COLUMN_BY_CODE
рядом с сидом справочника, и их приходится сверять тестом. Здесь всё берётся
из САМОГО справочника ops_status_types (priority, report_column_code,
counts_in_staff) — расходиться нечему. Порядок колонок тоже выводится: колонки
идут по минимальному приоритету типов, которые в них попадают.

ВТОРОЕ ОТЛИЧИЕ — знаменатель. В источнике «Штат» приходит из отдельной
таблицы штатного расписания с историей, а «Список» — из истории
принадлежности сотрудника подразделению. В старой структуре и штат, и
принадлежность несёт ОДНА таблица штатных единиц (staff_units): слот
принадлежит подразделению и может быть занят сотрудником. Отсюда:

    Штат = число слотов
    Список = слоты, занятые РАБОТАЮЩИМ сотрудником (минус прикомандированные)
    Вакансии = слоты пустые ИЛИ занятые уволенным
    Штат == Список + Прикомандированные + Вакансии  (по построению)

Историчности у этого знаменателя нет: старая структура хранит текущее
состояние слотов, а история перемещений (employee_transfers) — отдельный
разговор. Расход на прошлую дату поэтому считает СТАТУСЫ на ту дату, но
штат — сегодняшний; это осознанный компромисс переезда, а не недосмотр.

Сотрудник БЕЗ штатной единицы в расход не входит вообще: расход считается по
слотам, а не по списку людей. Это прямое следствие старой структуры, и
лечится оно заведением слота, а не подпоркой в расходе.
"""
from dataclasses import dataclass

# Код выводимого «в строю»: он не факт, а отсутствие фактов. Обязан
# присутствовать в справочнике — иначе колонку некуда положить.
DERIVED_IN_SERVICE = "IN_SERVICE"


@dataclass(frozen=True)
class StatusCatalog:
    """Проекция справочника типов, нужная расходу.

    Отдельный объект, а не три словаря по рукам: победитель, колонка и
    «считается ли в штате» обязаны приходить из одного снимка каталога.
    """

    priority: dict
    column: dict
    counts_in_staff: dict

    @classmethod
    def from_rows(cls, rows):
        """rows: словари/кортежи каталога (code, priority, report_column_code,
        counts_in_staff)."""
        priority, column, counts = {}, {}, {}
        for row in rows:
            code = row["code"]
            priority[code] = row["priority"]
            column[code] = row["report_column_code"]
            counts[code] = row["counts_in_staff"]
        if DERIVED_IN_SERVICE not in priority:
            raise ValueError(
                f"справочник типов не содержит {DERIVED_IN_SERVICE!r}: "
                "выводимому «в строю» некуда лечь в расходе"
            )
        return cls(priority=priority, column=column, counts_in_staff=counts)

    def columns_in_order(self):
        """Колонки расхода в детерминированном порядке: по минимальному
        приоритету попадающих в них типов, затем по коду колонки.

        Колонки типов ВНЕ штата (прикомандированные) сюда не входят — они
        считаются отдельным «+N», а не столбцом списка.
        """
        best = {}
        for code, column in self.column.items():
            if not self.counts_in_staff.get(code, True):
                continue
            priority = self.priority[code]
            if column not in best or priority < best[column]:
                best[column] = priority
        return tuple(sorted(best, key=lambda column: (best[column], column)))


def resolve_status(rows, on_date, catalog):
    """Код победителя дня для ОДНОГО сотрудника.

    Факт действует, если date_start <= on_date < date_end (полуинтервал).
    Победитель — минимальный приоритет, тай-брейк по коду, затем по дате
    начала. Нет действующих фактов → выводимое «в строю». Отменённые факты
    вызывающий обязан отфильтровать (контракт селектора).

    Неизвестный справочнику код — ошибка программиста (сервис пишет только
    коды каталога), и молчаливое «иное» её бы замаскировало.
    """
    active = []
    for row in rows:
        code = row["status_type_code"]
        if code not in catalog.priority:
            raise ValueError(f"неизвестный status_type_code: {code!r}")
        if row["date_start"] <= on_date < row["date_end"]:
            active.append(row)
    if not active:
        return DERIVED_IN_SERVICE
    winner = min(
        active,
        key=lambda r: (
            catalog.priority[r["status_type_code"]],
            r["status_type_code"],
            r["date_start"],
        ),
    )
    return winner["status_type_code"]


@dataclass(frozen=True)
class DivisionReportRow:
    division_id: int
    name: str
    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    attached: int


@dataclass(frozen=True)
class ReportTotals:
    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    attached: int


@dataclass(frozen=True)
class StrengthReportResult:
    business_date: object
    rows: list
    totals: ReportTotals
    warnings: list


def derive_report(
    slot_rows, status_rows, on_date, catalog, division_names=None
):
    """Свести расход по подразделениям.

    ``slot_rows``: слоты штатного расписания — словари
    {division_id, employee_id|None}; employee_id=None означает вакантный или
    занятый уволенным слот (вызывающий уже решил, кто «работающий»).
    ``status_rows``: живые интервальные факты со ссылкой employee_id.

    Сходимость держится ПО ПОСТРОЕНИЮ и проверяется утверждением: Σ колонок
    равна списку, а штат равен списку плюс прикомандированные плюс вакансии.
    Нарушение здесь — дефект этого кода, не данных, поэтому AssertionError,
    а не запись в warnings.
    """
    names = division_names or {}
    columns_order = catalog.columns_in_order()
    rows_by_employee = {}
    for row in status_rows:
        rows_by_employee.setdefault(row["employee_id"], []).append(row)

    slots_by_division = {}
    for slot in slot_rows:
        slots_by_division.setdefault(slot["division_id"], []).append(
            slot["employee_id"]
        )

    report_rows, warnings = [], []
    totals_columns = {column: 0 for column in columns_order}
    totals_staff = totals_list = totals_vacancies = totals_attached = 0

    for division_id in sorted(
        slots_by_division, key=lambda d: (names.get(d, ""), str(d))
    ):
        occupants = slots_by_division[division_id]
        columns = {column: 0 for column in columns_order}
        attached = vacancies = 0
        for employee_id in occupants:
            if employee_id is None:
                vacancies += 1
                continue
            winner = resolve_status(
                rows_by_employee.get(employee_id, ()), on_date, catalog
            )
            if not catalog.counts_in_staff.get(winner, True):
                attached += 1
                continue
            column = catalog.column[winner]
            if column not in columns:
                # Колонка типа, которого нет в порядке колонок: такое возможно
                # только если каталог противоречив (тип в штате, а колонка
                # выпала из выборки) — молчать нельзя.
                raise AssertionError(
                    f"колонка {column!r} типа {winner!r} вне порядка колонок"
                )
            columns[column] += 1

        staff_total = len(occupants)
        list_total = staff_total - vacancies - attached
        if sum(columns.values()) != list_total:
            raise AssertionError(
                f"расход нарушил Σ колонок == Список для {division_id}: "
                f"{sum(columns.values())} != {list_total}"
            )
        if staff_total != list_total + attached + vacancies:
            raise AssertionError(
                f"расход нарушил Штат == Список + Прикомандированные + "
                f"Вакансии для {division_id}"
            )

        report_rows.append(
            DivisionReportRow(
                division_id=division_id,
                name=names.get(division_id, ""),
                staff_total=staff_total,
                list_total=list_total,
                vacancies=vacancies,
                columns=columns,
                attached=attached,
            )
        )
        for column, count in columns.items():
            totals_columns[column] += count
        totals_staff += staff_total
        totals_list += list_total
        totals_vacancies += vacancies
        totals_attached += attached

    if sum(totals_columns.values()) != totals_list:
        raise AssertionError("расход нарушил Σ колонок == Список в итогах")
    if totals_staff != totals_list + totals_attached + totals_vacancies:
        raise AssertionError(
            "расход нарушил Штат == Список + Прикомандированные + Вакансии "
            "в итогах"
        )

    return StrengthReportResult(
        business_date=on_date,
        rows=report_rows,
        totals=ReportTotals(
            staff_total=totals_staff,
            list_total=totals_list,
            vacancies=totals_vacancies,
            columns=totals_columns,
            attached=totals_attached,
        ),
        warnings=warnings,
    )


class StrengthReportService:
    """ORM-обёртка: селекторы (по одному пакетному запросу на сущность) →
    derive_report.

    Не принимает актора и ничего не пишет: сужение видимости — забота API,
    бизнес-дата приходит явным аргументом и НИКОГДА не читается из часов
    внутри (иначе расход на вчера тихо посчитался бы на сегодня).
    """

    @staticmethod
    def compute(business_date, division_ids=None):
        # Импорты внутри метода держат уровень модуля чистым (чистые тесты
        # без Django) и разрывают цикл селекторы ↔ сервисы.
        from organization_management.apps.operations.selectors import (
            DivisionTreeSelector,
            EmployeeStatusSelector,
            StaffUnitSelector,
            StatusTypeSelector,
        )

        catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
        slot_rows, dismissed = StaffUnitSelector.slots_with_working_occupants(
            division_ids
        )
        employee_ids = [
            slot["employee_id"] for slot in slot_rows if slot["employee_id"]
        ]
        status_rows = EmployeeStatusSelector.overlapping_on(
            business_date, employee_ids=employee_ids
        )
        names = DivisionTreeSelector.names_map(
            {slot["division_id"] for slot in slot_rows}
        )
        result = derive_report(
            slot_rows, status_rows, business_date, catalog, division_names=names
        )
        if dismissed:
            # Слот, занятый уволенным, посчитан вакансией — арифметика сходится,
            # но это находка о ДАННЫХ, и она обязана быть видна.
            result.warnings.append(
                {"reason": "dismissed_in_slot", "employee_ids": sorted(dismissed)}
            )
        return result
