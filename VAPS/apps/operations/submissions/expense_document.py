"""Story 6.3 — билдер данных официального .docx расхода из снапшота сдачи.

Read-only derive-модуль app-root submissions (зеркало ``traffic_light`` /
``tomorrow_block``): ЧИСТАЯ функция без ORM, wall-clock и сети — снапшот,
``business_date`` и ORM-производные (``staff_map``, ``division_names``)
приходят аргументами (зеркало сигнатуры ``derive_report``; снапшот НЕ несёт
штат/вакансии/имя подразделения — Ловушка №5). ORM-обвязку (селекторы
``CoreStaffingSelector.allocated_slots_on`` / ``CoreDivisionTreeSelector
.divisions_map``) даёт вызывающий: в 6.3 — e2e-тест, в проде — выпуск 6.5.

Каждое число документа — БУКВАЛЬНО derive(снапшот): счётчики и итоги берутся
из ``derive_report`` от тех же строк снапшота (урок ретро E5 №2), исключения
derive (AssertionError/ValueError) пролетают наружу — STOP-семантика (AC-3).
Билдер добавляет ТОЛЬКО членов ячеек (ФИО/звание из roster + период
winner-факта) и cross-assert count == len(members).

Контракт-датаклассы импортируются из documents — стрелка
«documents ← operations» разрешена (Ловушка №3, architecture.md §границы).

Документ 6.3 — ОДНОстрочный (Д11): один снапшот → одна строка derive +
строка ИТОГО. Многострочный свод по детям и период — зона 6.5/6.10.
"""

from datetime import date

from apps.documents.generators.expense_docx import (
    ExpenseCell,
    ExpenseCellMember,
    ExpenseDocumentData,
    ExpenseRow,
    ExpenseTotals,
)
from apps.operations.statuses.services.strength_report import (
    ATTACHED_CODE,
    REPORT_COLUMN_BY_CODE,
    REPORT_COLUMNS,
    derive_report,
    resolve_status,
)

_IN_SERVICE_COLUMN = "IN_SERVICE"


def build_expense_document(
    snapshot, business_date, *, staff_map, division_names, division_id
):
    """Снапшот сдачи (schema v1) → ``ExpenseDocumentData`` для рендерера 6.3.

    Даты строк снапшота — ISO-строки полуоткрытых интервалов ``[start, end)``
    (зеркало ``_snapshot_winners``, Ловушка №8). Члены ячеек группируются по
    КОЛОНКЕ — ``REPORT_COLUMN_BY_CODE[winner]``, many-to-one (STUDY/COMPETITION/
    CONFERENCE → TRAINING, DUTY/GEV → ON_DUTY); период — действующий факт
    winner-кода, при нескольких — min по ``(date_start, date_end)`` (Д7;
    date_end ломает тай одинаковых стартов детерминированно, а не порядком
    строк снапшота — ревью 6.3). Для «В строю»
    члены сознательно НЕ собираются (AC-4): у derived-носителей факта нет, а
    EVENT_ASSIGNMENT маппится в ту же колонку — потому она и вне cross-assert.
    """
    roster = snapshot["roster"]
    roster_ids = [member["employee_id"] for member in roster]

    parsed_rows = [
        {
            "employee_id": row["employee_id"],
            "status_type_code": row["status_type_code"],
            "date_start": date.fromisoformat(row["date_start"]),
            "date_end": date.fromisoformat(row["date_end"]),
        }
        for row in snapshot["rows"]
    ]

    report = derive_report(
        {division_id: roster_ids},
        parsed_rows,
        staff_map,
        business_date,
        division_names=division_names,
    )
    # Д11: один снапшот — ровно одна строка derive; расхождение (лишние ключи
    # в staff_map и т.п.) — ошибка вызывающего, падает громко здесь же.
    (report_row,) = report.rows

    facts_by_employee = {}
    for row in parsed_rows:
        facts_by_employee.setdefault(row["employee_id"], []).append(row)

    members_by_column = {key: [] for key in (*REPORT_COLUMNS, ATTACHED_CODE)}
    for member in roster:
        facts = facts_by_employee.get(member["employee_id"], [])
        winner = resolve_status(facts, business_date)
        column = REPORT_COLUMN_BY_CODE[winner]
        if column == _IN_SERVICE_COLUMN:
            continue
        # winner != IN_SERVICE ⇒ действующий факт winner-кода существует
        # (его и выбрал resolve_status); при нескольких — min по
        # (date_start, date_end): Д7 + детерминированный тай-брейк
        # одинаковых стартов (ревью 6.3, независимость от порядка строк).
        acting = min(
            (
                fact
                for fact in facts
                if fact["status_type_code"] == winner
                and fact["date_start"] <= business_date < fact["date_end"]
            ),
            key=lambda fact: (fact["date_start"], fact["date_end"]),
        )
        members_by_column[column].append(
            ExpenseCellMember(
                rank=member["rank"],
                full_name=member["full_name"],
                date_start=acting["date_start"],
                date_end=acting["date_end"],
            )
        )

    # Cross-assert AC-4: полный список членов согласован со счётчиком derive
    # для ВСЕХ колонок, кроме IN_SERVICE (выше) — расхождение означает
    # программную ошибку группировки, документ выйти не должен.
    for key in REPORT_COLUMNS:
        if key == _IN_SERVICE_COLUMN:
            continue
        if len(members_by_column[key]) != report_row.columns[key]:
            raise AssertionError(
                f"expense document broke count == len(members) for {key}: "
                f"{report_row.columns[key]} != {len(members_by_column[key])}"
            )
    if len(members_by_column[ATTACHED_CODE]) != report_row.attached:
        raise AssertionError(
            "expense document broke count == len(members) for ATTACHED: "
            f"{report_row.attached} != {len(members_by_column[ATTACHED_CODE])}"
        )

    cells = {
        key: ExpenseCell(
            count=report_row.columns[key], members=tuple(members_by_column[key])
        )
        for key in REPORT_COLUMNS
    }
    expense_row = ExpenseRow(
        name=report_row.name,
        staff_total=report_row.staff_total,
        list_total=report_row.list_total,
        vacancies=report_row.vacancies,
        cells=cells,
        attached=ExpenseCell(
            count=report_row.attached,
            members=tuple(members_by_column[ATTACHED_CODE]),
        ),
    )
    totals = report.totals
    return ExpenseDocumentData(
        division_title=division_names.get(division_id, ""),
        business_date=business_date,
        rows=[expense_row],
        totals=ExpenseTotals(
            staff_total=totals.staff_total,
            list_total=totals.list_total,
            vacancies=totals.vacancies,
            columns=dict(totals.columns),
            attached=totals.attached,
        ),
    )
