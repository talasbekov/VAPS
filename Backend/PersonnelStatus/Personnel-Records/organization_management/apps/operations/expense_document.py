"""Данные официального документа расхода (порт expense_document.py +
контракт-датаклассов expense_docx из Backend/VAPS).

ЧИСТЫЙ модуль: ни ORM, ни часов, ни файлов. На входе — снимок сданного дня и
числа, которых в снимке нет (штат, вакансии, приданные), на выходе —
`ExpenseDocumentData`, из которого рендереры (.csv/.xlsx/.docx — следующие
срезы) делают файлы, ничего не считая. Разделение несущее: посчитанное один
раз не разъедется по форматам, а рендерер, умеющий считать, рано или поздно
посчитает иначе.

СЧЁТЧИКИ БЕРУТСЯ У ТОГО ЖЕ ВЛАДЕЛЬЦА, что и у экрана, — expense_from_snapshot
(расход по сданному дню). Отличие от источника, где документ пересчитывал
числа своим derive_report: два пути счёта над одним снимком расходятся не
сразу, а на редком случае, и обнаруживается это тогда, когда документ уже
подписан. Документ здесь добавляет к числам ровно одно, чего у экрана нет, —
ПОИМЁННЫЙ состав ячеек, и сверяет: количество членов обязано совпасть со
счётчиком колонки.

Чего документ НЕ выводит из снимка:
- штат и вакансии — снимок их не хранит (он о людях и фактах, не о штате);
- приданных («+N») — это ЧУЖИЕ люди, которых в нашем списке нет по
  определению, поэтому у их ячейки есть число и не бывает членов.
Всё это приходит аргументами от вызывающего: подмешать живые числа внутри
значило бы выдать наполовину сегодняшний документ за сданный вчера.
"""
from dataclasses import dataclass, field, replace
from datetime import date

from organization_management.apps.operations.roster_order import order_roster
from organization_management.apps.operations.strength_report import (
    DERIVED_IN_SERVICE,
    attached_of,
    catalog_of,
    denominator_of,
    expense_from_snapshot,
    title_of,
    resolve_status,
)


@dataclass(frozen=True)
class ExpenseCellMember:
    """Один человек в ячейке: как он подписан и по какой период.

    Звание и ФИО — ИЗ СНИМКА, а не из справочника: сдача говорит о том, как
    было на момент сдачи, и позднее присвоение звания не должно менять
    подписанный документ.
    """

    rank: str
    full_name: str
    date_start: date
    date_end: date


@dataclass(frozen=True)
class ExpenseCell:
    """Ячейка колонки: число и (для колонок списка) поимённый состав."""

    count: int
    members: tuple = ()


@dataclass(frozen=True)
class ExpenseRow:
    """Строка документа — одно подразделение."""

    name: str
    staff_total: int
    list_total: int
    vacancies: int
    cells: dict
    attached: ExpenseCell


@dataclass(frozen=True)
class ExpenseTotals:
    """Строка ИТОГО. Отдельный тип, а не ещё одна ExpenseRow: у итога нет
    ни имени подразделения, ни поимённого состава — сложить фамилии нельзя."""

    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    attached: int


@dataclass(frozen=True)
class ExpenseDocumentData:
    """Всё, что нужно рендереру. Ни одного числа он не считает сам."""

    division_title: str
    business_date: date
    rows: list
    totals: ExpenseTotals
    columns: tuple = field(default=())


def _parsed_facts(snapshot):
    """Факты снимка по сотрудникам, с датами-объектами.

    В снимке даты — ISO-строки полуинтервала [начало, конец); сравнивать их
    как строки можно, но одна нестандартная запись сделала бы сравнение
    молча неверным.
    """
    facts = {}
    for row in snapshot.get("rows", []):
        facts.setdefault(row["employee_id"], []).append(
            {
                "status_type_code": row["status_type_code"],
                "date_start": date.fromisoformat(row["date_start"]),
                "date_end": date.fromisoformat(row["date_end"]),
            }
        )
    return facts


def build_expense_document(
    snapshot,
    business_date,
    *,
    catalog,
    division_title,
    staff_total,
    vacancies,
    attached=0,
):
    """Снимок сданного дня → данные документа расхода.

    Числа колонок и списка считает expense_from_snapshot — тот же счёт, что
    видит экран. Здесь добавляется поимённый состав и СВЕРЯЕТСЯ с числами:
    расхождение означает дефект группировки, и документ выходить не должен —
    подписывают его, а не сообщение об ошибке.

    Период члена — действующий на дату факт ПОБЕДИВШЕГО кода; при нескольких
    таких берётся самый ранний, а равные начала разводит конец. Тай-брейк
    нужен не для красоты: без него документ зависел бы от порядка строк в
    снимке и дважды подряд выходил бы разным.

    Не по списку (победитель вне штата) в колонки не попадает — ровно как в
    живом расходе; поимённо такие люди в документе не показываются, потому
    что колонки для них нет.
    """
    # ВСЁ, ЧТО СНИМОК ЗАМОРОЗИЛ, БЕРЁТСЯ ИЗ НЕГО — здесь, а не у вызывающего.
    #
    # Раньше справочник разрешался тут, а шапка, знаменатель и «+N» приходили
    # уже разрешёнными из expense_release. Асимметрия была ловушкой: всякий
    # ДРУГОЙ вызывающий молча получал живые значения трёх полей из четырёх, и
    # генератор эталона печатной формы оказался ровно таким — его случай
    # печатал живое имя и живой знаменатель поверх замороженных.
    #
    # Переданные значения остаются ЗАПАСНЫМИ: у снимков младших версий
    # соответствующих полей нет, и брать их неоткуда, кроме как у вызывающего.
    catalog = catalog_of(snapshot, catalog)
    division_title = title_of(snapshot, division_title)
    staff_total, vacancies = denominator_of(snapshot, staff_total, vacancies)
    attached = attached_of(snapshot, attached)
    numbers = expense_from_snapshot(snapshot, business_date, catalog)
    columns_order = catalog.columns_in_order()
    facts_by_employee = _parsed_facts(snapshot)

    members = {column: [] for column in columns_order}
    # Состав перебирается в КАНОНИЧЕСКОМ порядке, и потому ячейки заполняются
    # по нему сами: один проход задаёт порядок сразу всем колонкам, и разойтись
    # им негде. Сортировать каждую ячейку отдельно значило бы завести столько
    # мест, где порядок может съехать, сколько в справочнике колонок.
    #
    # До этого состав шёл в порядке employee_id — то есть в порядке появления
    # строк в базе: старший по должности стоял между рядовыми потому, что его
    # завели позже.
    for member in order_roster(snapshot.get("roster", [])):
        employee_facts = facts_by_employee.get(member["employee_id"], ())
        winner = resolve_status(employee_facts, business_date, catalog)
        if not catalog.counts_in_staff.get(winner, True):
            continue
        column = catalog.column[winner]
        if winner == DERIVED_IN_SERVICE:
            # У «в строю» факта нет по определению — это отсутствие фактов, и
            # взять период неоткуда. Число в ячейке при этом есть, поэтому
            # именно она и не участвует в сверке ниже.
            continue
        acting = min(
            (
                fact
                for fact in employee_facts
                if fact["status_type_code"] == winner
                and fact["date_start"] <= business_date < fact["date_end"]
            ),
            key=lambda fact: (fact["date_start"], fact["date_end"]),
        )
        members[column].append(
            ExpenseCellMember(
                rank=member.get("rank", ""),
                full_name=member.get("full_name", ""),
                date_start=acting["date_start"],
                date_end=acting["date_end"],
            )
        )

    in_service_column = catalog.column[DERIVED_IN_SERVICE]
    for column in columns_order:
        if column == in_service_column:
            continue
        if len(members[column]) != numbers["columns"][column]:
            raise AssertionError(
                f"документ расхода: состав колонки {column!r} разошёлся со "
                f"счётчиком ({len(members[column])} против "
                f"{numbers['columns'][column]})"
            )

    row = ExpenseRow(
        name=division_title,
        staff_total=staff_total,
        list_total=numbers["list_total"],
        vacancies=vacancies,
        cells={
            column: ExpenseCell(
                count=numbers["columns"][column], members=tuple(members[column])
            )
            for column in columns_order
        },
        # Приданные — чужие люди: число есть, членов не бывает.
        attached=ExpenseCell(count=attached),
    )
    return ExpenseDocumentData(
        division_title=division_title,
        business_date=business_date,
        rows=[row],
        totals=ExpenseTotals(
            staff_total=staff_total,
            list_total=numbers["list_total"],
            vacancies=vacancies,
            columns=dict(numbers["columns"]),
            attached=attached,
        ),
        columns=columns_order,
    )


def combine_documents(documents, *, division_title, business_date, columns):
    """Несколько однострочных документов → один многострочный с общим итогом.

    Так собирается документ СВОДКИ: строка на каждое подразделение плюс
    «ИТОГО». Строки не строятся здесь заново — они приходят готовыми от
    build_expense_document, у которого одна ответственность: превратить один
    снимок в одну строку. Второй способ построить строку разошёлся бы с
    первым ровно там, где расхождение труднее всего заметить, — в подписанном
    документе, где ИТОГО не сходится со слагаемыми.

    Итог — СУММА строк, а не отдельный пересчёт по объединённым данным:
    сумма по определению сходится с тем, что напечатано выше, а независимый
    пересчёт сошёлся бы только пока никто не ошибся.

    `columns` задаётся явно (а не берётся у первого документа): пустой список
    строк — законное состояние, и у него всё равно обязана быть шапка.

    СТРОКИ МОГУТ ПРИЙТИ С РАЗНЫМИ НАБОРАМИ КОЛОНОК, и это не порча данных.
    Со схемы снимка 3 каждый сданный день считается СВОИМ замороженным
    справочником, а сводка склеивает дни разных подразделений: переименуй
    администратор колонку между двумя сдачами — и один ребёнок принесёт строку
    со старым именем колонки, другой с новым. Раньше на этом весь сводный
    документ падал KeyError, то есть родитель не мог напечатать день ВООБЩЕ —
    ровно та поломка, которую срез 134 закрывал у дневного документа.

    Поэтому шапка — ОБЪЕДИНЕНИЕ: сперва переданный порядок, затем колонки,
    встретившиеся в строках и в него не попавшие (в порядке первого появления,
    чтобы документ не зависел от порядка словарей). А недостающие ячейки
    достраиваются НУЛЯМИ — не «данных нет», а «в ту эпоху справочника такой
    колонки не было», и ноль это и означает.

    Слить старую колонку с новой было бы хуже падения: числа сошлись бы под
    именем, которого один из дней не подписывал.
    """
    rows = [row for document in documents for row in document.rows]
    order = list(columns)
    seen = set(order)
    for row in rows:
        for column in row.cells:
            if column not in seen:
                seen.add(column)
                order.append(column)

    empty = ExpenseCell(count=0)
    rows = [
        replace(row, cells={column: row.cells.get(column, empty) for column in order})
        for row in rows
    ]
    return ExpenseDocumentData(
        division_title=division_title,
        business_date=business_date,
        rows=rows,
        totals=ExpenseTotals(
            staff_total=sum(row.staff_total for row in rows),
            list_total=sum(row.list_total for row in rows),
            vacancies=sum(row.vacancies for row in rows),
            columns={
                column: sum(row.cells[column].count for row in rows)
                for column in order
            },
            attached=sum(row.attached.count for row in rows),
        ),
        columns=tuple(order),
    )
