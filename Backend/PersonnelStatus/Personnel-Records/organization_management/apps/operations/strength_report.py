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
    Список = слоты, занятые РАБОТАЮЩИМ сотрудником (минус вне списка)
    Вакансии = слоты пустые ИЛИ занятые уволенным
    Штат == Список + Вне списка + Вакансии  (по построению)

Прикомандированные («+N») в это равенство НЕ входят: это люди чужого штата,
находящиеся у нас, и своих слотов они не занимают. Их даёт проекция пар
прикомандирования по стороне «куда».

Историчности у этого знаменателя нет: старая структура хранит текущее
состояние слотов, а история перемещений (employee_transfers) — отдельный
разговор. Расход на прошлую дату поэтому считает СТАТУСЫ на ту дату, но
штат — сегодняшний; это осознанный компромисс переезда, а не недосмотр.

Сотрудник БЕЗ штатной единицы в расход не входит вообще: расход считается по
слотам, а не по списку людей. Это прямое следствие старой структуры, и
лечится оно заведением слота, а не подпоркой в расходе.
"""
from dataclasses import dataclass
from datetime import date

# Код выводимого «в строю»: он не факт, а отсутствие фактов. Обязан
# присутствовать в справочнике — иначе колонку некуда положить.
DERIVED_IN_SERVICE = "IN_SERVICE"

#: Участие в ОМ: код статуса → вид участия (Plane №243).
#:
#: СПРАВОЧНАЯ величина, а НЕ колонка расхода. Оба кода отчитываются в
#: «В строю» — человек на мероприятии из строя не выбывает (Plane №169), — и
#: завести им свою колонку значило бы вынуть их из «В строю», сломав
#: инвариант «Σ колонок == Список» и заодно смысл: расход перестал бы
#: показывать, сколько людей у службы есть.
#:
#: Поэтому счётчик живёт рядом с колонками, а не среди них: он отвечает на
#: другой вопрос — «сколько из тех, кто в строю, занято мероприятиями и чем
#: именно». Сценарий заказчика требует свести именно эту цифру за
#: департамент и отправить её штабу.
EVENT_INVOLVEMENT_KINDS = {
    "EVENT_ASSIGNMENT": "squad",
    "EVENT_ASSIGNMENT_GROUP": "group",
}


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
class EventInvolvement:
    """Занятость мероприятиями: всего, в боевых группах, физическим нарядом.

    `total` считается отдельно, а не как сумма двух: справочник статусов
    правят руками, и появившийся третий вид участия должен попасть в «всего»
    сам, а не потеряться до правки этого класса.
    """

    total: int
    group: int
    squad: int

    def as_dict(self):
        return {"total": self.total, "group": self.group, "squad": self.squad}


@dataclass(frozen=True)
class DivisionReportRow:
    division_id: int
    name: str
    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    # «+N»: приданные ИЗВНЕ — люди из чужих штатов, находящиеся у нас. Сверх
    # штата и списка, в знаменатель не входят.
    attached: int
    # Занятый слот, чей победитель дня не считается в штате. Это НАШ слот и
    # НАШ человек, просто сегодня он не по нашему списку, поэтому число
    # участвует в знаменателе (см. инвариант в derive_report).
    off_list: int
    # Занятость мероприятиями — СПРАВОЧНО, вне суммы колонок (Plane №243).
    event: EventInvolvement


@dataclass(frozen=True)
class ReportTotals:
    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    attached: int
    off_list: int
    event: EventInvolvement


@dataclass(frozen=True)
class StrengthReportResult:
    business_date: object
    rows: list
    totals: ReportTotals
    warnings: list


def derive_report(
    slot_rows,
    status_rows,
    on_date,
    catalog,
    division_names=None,
    attached_by_division=None,
):
    """Свести расход по подразделениям.

    ``slot_rows``: слоты штатного расписания — словари
    {division_id, employee_id|None}; employee_id=None означает вакантный или
    занятый уволенным слот (вызывающий уже решил, кто «работающий»).
    ``status_rows``: живые интервальные факты со ссылкой employee_id.
    ``attached_by_division``: {division_id: N} приданных ИЗВНЕ — «+N»
    принимающего подразделения.

    ДВА РАЗНЫХ ЧИСЛА, которые легко спутать:

        off_list — наш слот занят нашим человеком, который сегодня не по
            нашему списку (победитель дня — тип вне штата). Он в знаменателе.
        attached — «+N»: человек ЧУЖОГО штата находится у нас. Своего слота у
            нас он не занимает, поэтому в знаменатель не входит вовсе.

    Отсюда инвариант, который проверяется утверждением:

        Штат == Список + Вне списка + Вакансии      (всё по слотам)
        Σ колонок == Список
        Прикомандированные — ДОБАВКА сверх этого равенства.

    Прикомандированные в колонки не попадают: колонки — разрез СПИСКА, а «+N»
    в списке не состоит. Нарушение равенств — дефект этого кода, не данных,
    поэтому AssertionError, а не запись в warnings.

    Подразделение, у которого есть только приданные (своих слотов нет),
    строкой всё равно появляется: иначе «+N» было бы некуда положить и люди
    исчезли бы из расхода вообще.
    """
    names = division_names or {}
    attached_counts = dict(attached_by_division or {})
    columns_order = catalog.columns_in_order()
    rows_by_employee = {}
    for row in status_rows:
        rows_by_employee.setdefault(row["employee_id"], []).append(row)

    slots_by_division = {}
    for slot in slot_rows:
        slots_by_division.setdefault(slot["division_id"], []).append(
            slot["employee_id"]
        )
    for division_id in attached_counts:
        slots_by_division.setdefault(division_id, [])

    report_rows, warnings = [], []
    totals_columns = {column: 0 for column in columns_order}
    totals_staff = totals_list = totals_vacancies = 0
    totals_attached = totals_off_list = 0
    totals_event = {"total": 0, "group": 0, "squad": 0}

    for division_id in sorted(
        slots_by_division, key=lambda d: (names.get(d, ""), str(d))
    ):
        occupants = slots_by_division[division_id]
        columns = {column: 0 for column in columns_order}
        attached = attached_counts.get(division_id, 0)
        off_list = vacancies = 0
        event = {"total": 0, "group": 0, "squad": 0}
        for employee_id in occupants:
            if employee_id is None:
                vacancies += 1
                continue
            winner = resolve_status(
                rows_by_employee.get(employee_id, ()), on_date, catalog
            )
            if not catalog.counts_in_staff.get(winner, True):
                off_list += 1
                continue
            kind = EVENT_INVOLVEMENT_KINDS.get(winner)
            if kind is not None:
                event["total"] += 1
                event[kind] += 1
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
        list_total = staff_total - vacancies - off_list
        if sum(columns.values()) != list_total:
            raise AssertionError(
                f"расход нарушил Σ колонок == Список для {division_id}: "
                f"{sum(columns.values())} != {list_total}"
            )
        if staff_total != list_total + off_list + vacancies:
            raise AssertionError(
                f"расход нарушил Штат == Список + Вне списка + Вакансии "
                f"для {division_id}"
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
                off_list=off_list,
                event=EventInvolvement(**event),
            )
        )
        for key, count in event.items():
            totals_event[key] += count
        for column, count in columns.items():
            totals_columns[column] += count
        totals_staff += staff_total
        totals_list += list_total
        totals_vacancies += vacancies
        totals_attached += attached
        totals_off_list += off_list

    if sum(totals_columns.values()) != totals_list:
        raise AssertionError("расход нарушил Σ колонок == Список в итогах")
    if totals_staff != totals_list + totals_off_list + totals_vacancies:
        raise AssertionError(
            "расход нарушил Штат == Список + Вне списка + Вакансии в итогах"
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
            off_list=totals_off_list,
            event=EventInvolvement(**totals_event),
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
            SecondmentSelector,
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
        # «+N» принимающих подразделений: сужается тем же множеством, что и
        # слоты, — иначе расход одного подразделения показал бы приданных
        # соседа.
        attached = SecondmentSelector.attached_counts_on(
            business_date, division_ids=division_ids
        )
        names = DivisionTreeSelector.names_map(
            {slot["division_id"] for slot in slot_rows} | set(attached)
        )
        result = derive_report(
            slot_rows,
            status_rows,
            business_date,
            catalog,
            division_names=names,
            attached_by_division=attached,
        )
        if dismissed:
            # Слот, занятый уволенным, посчитан вакансией — арифметика сходится,
            # но это находка о ДАННЫХ, и она обязана быть видна.
            result.warnings.append(
                {"reason": "dismissed_in_slot", "employee_ids": sorted(dismissed)}
            )
        return result


# ── Расход по СДАННОМУ дню ───────────────────────────────────────────────


@dataclass(frozen=True)
class SubmittedExpense:
    """Расход, воспроизведённый ИЗ СНИМКА сданного дня.

    Полей меньше, чем у живой строки расхода, и это не упрощение, а честность:
    снимок хранит список и факты, но НЕ хранит штат, вакансии и приданных
    («+N»). Подмешать их живыми значило бы выдать наполовину сегодняшние числа
    за сданные вчера — а весь смысл сдачи в том, что она не меняется задним
    числом. Штат и вакансии остаются у живого расхода, где они и живут.

    version/submitted_at идут в ответе не для красоты: два читателя одного дня
    обязаны понимать, ту ли самую версию они видят.
    """

    division_id: int
    business_date: object
    version: int
    submitted_at: object
    late: bool
    list_total: int
    off_list: int
    columns: dict


def catalog_of(snapshot, live_catalog):
    """Справочник, по которому читать ЭТОТ снимок.

    Снимок схемы 3 несёт свой каталог — тот, по которому день считался в момент
    сдачи, — и читать его надо им: справочник правят, и правка иначе переписала
    бы уже подписанный день (перенос колонки увёл бы человека в другой столбец,
    снятие counts_in_staff изменило бы знаменатель).

    У снимков версий 1 и 2 каталога нет, и для них берётся живой — как и
    раньше. Отказывать им нельзя: старые сданные дни обязаны читаться, а
    другого справочника для них не существует. То, что такой день зависит от
    сегодняшнего каталога, — свойство ТЕХ снимков, и притворяться, будто это не
    так, значило бы врать о них молча.
    """
    rows = snapshot.get("catalog")
    if not rows:
        return live_catalog
    # ЗАПАСНОГО ПУТИ НА НЕПРИГОДНЫЙ КАТАЛОГ ЗДЕСЬ НЕТ, и это осознанно.
    #
    # Он был — снимок с непригодным каталогом читался живым справочником, —
    # и снят вместе с появлением отказа на СБОРКЕ: непригодный каталог теперь
    # не попадает в снимок вовсе, потому что такой день не сдаётся. Оставить
    # запасной путь значило бы держать ветку на состояние, которого больше не
    # бывает, — а живёт такая ветка ровно до того дня, когда прикроет
    # настоящую поломку своим молчанием.
    #
    # Непригодный каталог в снимке отныне означает порчу данных, и падать на
    # ней громко правильнее, чем считать день по ЧУЖОМУ справочнику и выдать
    # числа, которых никто не подписывал.
    return StatusCatalog.from_rows(rows)


def denominator_of(snapshot, live_staff_total, live_vacancies):
    """Штат и вакансии, которыми подписывать ЭТОТ снимок: (штат, вакансии).

    Четвёртый сосед `catalog_of` / `names_of` / `title_of`. Снимок схемы 6
    несёт оба числа на момент сдачи, и печатать надо ими: пока они брались
    живыми, подписанный документ переставал СХОДИТЬСЯ САМ С СОБОЙ — удали
    кто-нибудь штатную единицу, и штат за вчера оказывался меньше, чем список
    плюс вакансии.

    Берутся ОБА или НИ ОДНОГО: смешать замороженный штат с живыми вакансиями
    значило бы получить третье, не бывшее ни тогда, ни сейчас. Поэтому
    признаком служит наличие `staff_total`, а не каждого числа по отдельности.
    """
    if "staff_total" not in snapshot:
        return live_staff_total, live_vacancies
    return snapshot["staff_total"], snapshot.get("vacancies", 0)


def attached_of(snapshot, live_attached):
    """«+N» приданных, которым подписывать ЭТОТ снимок.

    Пятый и последний сосед `catalog_of` / `names_of` / `title_of` /
    `denominator_of`. Арифметику документа «+N» не ломает — он добавка сверх
    равенства, — но дрейфует так же тихо: подтвердили возврат, и число за
    вчера уменьшилось в уже подписанной бумаге.

    Признаком служит наличие ключа, а не его истинность: ноль приданных —
    законное и частое состояние, и `or` увёл бы его на живое число.
    """
    if "attached" not in snapshot:
        return live_attached
    return snapshot["attached"]


def title_of(snapshot, live_title):
    """Название подразделения, которым подписывать ЭТОТ снимок.

    Третий сосед `catalog_of` и `names_of`: то же правило, но про шапку.
    Снимок схемы 5 несёт название на момент сдачи, и подписывать надо им —
    иначе переименование подразделения переписывает шапку уже сданного дня, а
    два артефакта из ОДНОГО снимка (печатный документ и личная копия)
    называют его по-разному, пока один читает живое, а другой замороженное.

    Живое остаётся запасным для снимков версий 1–4: другого имени для них не
    существует.
    """
    return snapshot.get("division_title") or live_title


def names_of(snapshot, live_names):
    """Подписи статусов, которыми читать ЭТОТ снимок: {код: имя}.

    Сосед `catalog_of`: то же правило, но про подписи. Снимок схемы 4 несёт
    имя в каждой строке своего каталога, и печатать надо ИМ — иначе
    переименование типа меняет уже выданную копию сданного дня, а её берут,
    чтобы предъявить в споре.

    Живые подписи остаются ЗАПАСНЫМИ и подмешиваются под замороженные: у
    снимков версий 1–3 имён нет вовсе, а у снимка версии 4 может не оказаться
    кода, заведённого позже, — печатать голый код там, где подпись существует,
    незачем.
    """
    frozen = {
        row["code"]: row["name"]
        for row in snapshot.get("catalog") or ()
        if row.get("name")
    }
    return {**live_names, **frozen}


def expense_from_snapshot(snapshot, business_date, catalog):
    """Список и колонки по снимку: {list_total, off_list, columns}.

    Чистая функция над снимком — ни ORM, ни часов, как и весь остальной
    модуль. Знаменатель — roster снимка целиком; победитель каждого
    считается тем же resolve_status, что и у живого расхода, поэтому «сданные»
    и «живые» числа одного дня сравнимы напрямую (на этом стоит светофор).

    Инвариант Σ колонок == Список держится ПОСТРОЕНИЕМ — счётчик списка
    растёт ровно там же, где счётчик колонки. Отдельной проверки суммы здесь
    нет намеренно: её снятие не роняет ни одного теста (проверено красной
    пробой), потому что нарушить её нечем, а второй владелец одного правила
    живёт лишь до первого расхождения с настоящим. Остаётся один гард —
    колонка типа вне порядка колонок, то есть противоречивый справочник.
    """
    columns_order = catalog.columns_in_order()
    columns = {column: 0 for column in columns_order}
    facts = {}
    for row in snapshot.get("rows", []):
        facts.setdefault(row["employee_id"], []).append(
            {
                "status_type_code": row["status_type_code"],
                "date_start": date.fromisoformat(row["date_start"]),
                "date_end": date.fromisoformat(row["date_end"]),
            }
        )

    list_total = off_list = 0
    for member in snapshot.get("roster", []):
        employee_id = member["employee_id"]
        winner = resolve_status(facts.get(employee_id, ()), business_date, catalog)
        if not catalog.counts_in_staff.get(winner, True):
            off_list += 1
            continue
        column = catalog.column[winner]
        if column not in columns:
            raise AssertionError(
                f"колонка {column!r} типа {winner!r} вне порядка колонок"
            )
        columns[column] += 1
        list_total += 1
    return {"list_total": list_total, "off_list": off_list, "columns": columns}


def submitted_expense(division_id, business_date):
    """Расход подразделения ЗА СДАННЫЙ день или None, если день не сдан.

    Читает ДЕЙСТВУЮЩУЮ версию: вытесненная поправкой больше не расход, а
    история, и отдавать её значило бы показывать отменённое заявление.
    None здесь не отказ, а ответ «дня нет» — решение, чем он становится на
    HTTP (404 или пустая страница), принимает вьюха.

    Числа берутся ТОЛЬКО из снимка. Живых данных функция не читает вовсе —
    иначе «сданный вчера расход» менялся бы от каждой сегодняшней правки, и
    подпись под ним ничего не значила бы.
    """
    from organization_management.apps.operations.selectors import (
        DailySubmissionSelector,
        StatusTypeSelector,
    )

    submission = DailySubmissionSelector.current_for(division_id, business_date)
    if submission is None:
        return None
    # Каталог снимка, а не живой: докстринг выше обещает, что живых данных эта
    # функция не читает вовсе, и до версии 3 справочник был единственным
    # местом, где обещание не выполнялось.
    live = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    catalog = catalog_of(submission.snapshot, live)
    numbers = expense_from_snapshot(submission.snapshot, business_date, catalog)
    return SubmittedExpense(
        division_id=division_id,
        business_date=business_date,
        version=submission.version,
        submitted_at=submission.submitted_at,
        late=submission.late,
        **numbers,
    )
