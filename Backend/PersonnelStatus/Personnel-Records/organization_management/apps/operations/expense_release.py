"""Выпуск документа расхода: ORM-обвязка вокруг чистого билдера (порт зоны
document_release_service из Backend/VAPS).

Билдер чист и ничего не читает — данные ему приносят отсюда. Разделение
позволяет проверять раскладку документа без базы, а здесь остаётся ровно один
вопрос: ОТКУДА берётся каждое число.

ДВА ИСТОЧНИКА, И ЭТО ОСОЗНАННО:
- список, колонки и поимённый состав — ИЗ СНИМКА сданного дня; они и есть то,
  под чем подписались, и живые правки их менять не смеют;
- штат, вакансии и приданные — ЖИВЫЕ: снимок их не хранит вовсе. Это тот же
  компромисс, на котором стоит живой расход раздела («статусы на дату, штат
  сегодняшний»), а не новая вольность: другого источника штата у старой
  структуры нет, и притвориться, будто он есть, было бы хуже.

Форматов четыре, и различает их ПОТРЕБИТЕЛЬ, а не вкус: .csv — числа для
дальнейшего счёта, .xlsx — лист для работы, .docx — страница под подпись,
.pdf — то же, что .docx, но уже нередактируемое: его отправляют и подшивают.
Данные у всех четырёх одни: разъехаться им негде, считает только билдер.
"""
from dataclasses import replace

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.expense_csv import generate_expense_csv
from organization_management.apps.operations.expense_docx import generate_expense_docx
from organization_management.apps.operations.expense_pdf import generate_expense_pdf
from organization_management.apps.operations.expense_document import (
    build_expense_document,
    combine_documents,
    ExpenseCell,
)
from organization_management.apps.operations.expense_xlsx import generate_expense_xlsx
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
    StatusTypeSelector,
)
from organization_management.apps.operations.strength_report import (
    StatusCatalog,
    catalog_of,
    title_of,
    StrengthReportService,
)

# Формат → (рендерер, расширение, MIME). Закрытый мир: неизвестный формат
# отвергается на границе, а не отдаётся пустым файлом.
FORMATS = {
    "csv": (generate_expense_csv, "csv", "text/csv; charset=utf-8"),
    "xlsx": (
        generate_expense_xlsx,
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "docx": (
        generate_expense_docx,
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    # .pdf — та же страница, что .docx, но уже нередактируемая: её отправляют и
    # подшивают. Форматов стало четыре, и различает их по-прежнему ПОТРЕБИТЕЛЬ,
    # а не вкус.
    "pdf": (generate_expense_pdf, "pdf", "application/pdf"),
}


def build_submitted_expense_document(division_id, business_date):
    """Данные документа по СДАННОМУ дню подразделения.

    Отсутствие сдачи — DAY_NOT_SUBMITTED, тем же кодом, что у чтения сданного
    расхода: выгружать нечего ровно по той же причине, и два кода на одну
    новость заставили бы клиента разбирать, какой из них про что.

    Живые числа берутся у того же расхода, что показывает экран, — своей
    выборкой штата документ разошёлся бы с ним на первой же правке правил.
    """
    submission = DailySubmissionSelector.current_for(division_id, business_date)
    if submission is None:
        raise DomainError(
            "DAY_NOT_SUBMITTED",
            404,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="День не сдан: выгружать нечего.",
        )
    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    needs_live = any(key not in submission.snapshot for key in ("staff_total", "vacancies", "attached"))
    report = StrengthReportService.compute(business_date, division_ids={division_id}) if needs_live else None
    # Строка СВОЕГО подразделения. Её может не быть вовсе — у подразделения
    # без единого штатного слота живому расходу нечего показывать; документ
    # при этом законен: сдача есть, просто знаменатель пуст.
    live = next(
        (row for row in (report.rows if report else []) if row.division_id == division_id), None
    )
    names = DivisionTreeSelector.names_map([division_id])
    return build_expense_document(
        submission.snapshot,
        business_date,
        catalog=catalog,
        # Название — из снимка (схема 5), живое запасное: иначе печатный
        # документ и личная копия одного дня назвали бы подразделение
        # по-разному после переименования.
        # Разрешение замороженных полей — внутри билдера; сюда подаётся
        # ЖИВОЕ как запасное для снимков младших версий.
        division_title=names.get(division_id, ""),
        staff_total=live.staff_total if live else 0,
        vacancies=live.vacancies if live else 0,
        attached=live.attached if live else 0,
    )


def render_expense(data, export_format):
    """Данные документа → (байты, имя файла, MIME).

    Имя файла несёт подразделение и дату: выгрузки складывают в одну папку, и
    «расход.xlsx» второй раз перезаписал бы первый.
    """
    try:
        render, extension, content_type = FORMATS[export_format]
    except KeyError as error:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"format": export_format, "allowed": sorted(FORMATS)},
            message="Неизвестный формат выгрузки.",
        ) from error
    filename = f"expense-{data.business_date.isoformat()}.{extension}"
    return render(data), filename, content_type


def build_summary_expense_document(division_id, business_date):
    """Документ СВОДНОГО расхода: строка на подразделение плюс итог.

    Собирается из ЗАПИНЕННЫХ версий детей, а не из их текущих сдач: сводка
    заявила, из чего она сложена, и документ обязан показывать ровно это.
    Возьми он текущие — протухшая сводка молча печаталась бы свежим
    документом, и расхождение, ради обнаружения которого пины и заведены,
    исчезло бы именно там, где его подписывают.

    Первая строка — СВОЙ уровень родителя (у штаба тоже есть люди), дальше
    дети по возрастанию id. Живые числа (штат/вакансии/приданные) читаются
    одним расходом на все подразделения сразу.
    """
    summary = DailySubmissionSelector.current_for(division_id, business_date)
    if summary is None:
        raise DomainError(
            "DAY_NOT_SUBMITTED",
            404,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="День не сдан: выгружать нечего.",
        )
    pins = summary.snapshot.get("sources")
    if pins is None:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"division_id": str(division_id)},
            message="Этот день сдан обычной сдачей, а не сводкой.",
        )

    # Load every pinned level in batches. A child summary freezes its OWN
    # roster, so stopping at direct children silently drops grandchildren.
    pinned = {summary.pk: summary}
    frontier = [summary]
    while frontier:
        wanted = {pin["submission_id"] for row in frontier
                  for pin in row.snapshot.get("sources", [])} - pinned.keys()
        if not wanted:
            break
        frontier = list(OpsDailySubmission.objects.filter(pk__in=wanted))
        missing = wanted - {row.pk for row in frontier}
        if missing:
            raise DomainError("SUMMARY_SOURCE_MISSING", 409,
                              detail={"submission_ids": sorted(missing)},
                              message="Закреплённая версия сдачи отсутствует: свод нельзя выгрузить полностью.")
        pinned.update((row.pk, row) for row in frontier)
    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    division_ids = {row.division_id for row in pinned.values()}
    fallback_ids = {row.division_id for row in pinned.values()
                    if any(key not in row.snapshot for key in ("staff_total", "vacancies", "attached"))}
    report = StrengthReportService.compute(business_date, division_ids=fallback_ids) if fallback_ids else None
    live = {row.division_id: row for row in report.rows} if report else {}
    names = DivisionTreeSelector.names_map(division_ids)

    def own_document(submission):
        row = live.get(submission.division_id)
        return build_expense_document(
                submission.snapshot,
                business_date,
                catalog=catalog,
                # У КАЖДОГО ребёнка своё замороженное имя и свой знаменатель:
                # сводка склеивает чужие дни. Разрешает их билдер; сюда едет
                # живое как запасное.
                division_title=names.get(submission.division_id, ""),
                staff_total=row.staff_total if row else 0,
                vacancies=row.vacancies if row else 0,
                attached=row.attached if row else 0,
            )

    def branch_documents(submission, seen):
        if submission.pk in seen:
            return []
        seen.add(submission.pk)
        documents = [own_document(submission)]
        for pin in submission.snapshot.get("sources", []):
            documents.extend(branch_documents(pinned[pin["submission_id"]], seen))
        return documents

    from organization_management.apps.divisions.models import Division
    division_types = dict(Division.objects.filter(pk__in=division_ids).values_list("id", "division_type"))
    for row in pinned.values():
        if row.snapshot.get("division_type"):
            division_types[row.division_id] = row.snapshot["division_type"]
    service_summary = division_types.get(division_id) in {"organization", "service"}
    if service_summary:
        documents = []
        own = own_document(summary)
        own_rows = [replace(row, personnel=(), cells={code: ExpenseCell(cell.count) for code, cell in row.cells.items()}) for row in own.rows]
        documents.append(replace(own, rows=own_rows))
        seen = {summary.pk}
        for pin in pins:
            child = pinned[pin["submission_id"]]
            branches = branch_documents(child, seen)
            combined = combine_documents(branches, division_title=title_of(child.snapshot, names.get(child.division_id, "")),
                                         business_date=business_date, columns=catalog_of(summary.snapshot, catalog).columns_in_order())
            leaders = tuple(person for branch in branches for row in branch.rows for person in row.personnel
                            if person.position_level in (1, 2)
                            and (person.division_type == "department" or (
                                not person.division_type and division_types.get(child.division_id) == "department"
                                and branch is branches[0])))
            totals = combined.totals
            aggregate = replace(own.rows[0], name=combined.division_title, staff_total=totals.staff_total,
                                list_total=totals.list_total, vacancies=totals.vacancies,
                                cells={code: ExpenseCell(count) for code, count in totals.columns.items()},
                                attached=ExpenseCell(totals.attached), event=totals.event, personnel=leaders)
            documents.append(replace(combined, rows=[aggregate]))
    else:
        documents = branch_documents(summary, set())
    return combine_documents(
        documents,
        division_title=title_of(summary.snapshot, names.get(division_id, "")),
        business_date=business_date,
        # Порядок колонок — из справочника СВОДКИ, а не живого. Строки к этому
        # моменту уже заморожены каждая своим каталогом, и живая шапка
        # оставалась последней щелью: правка справочника переставляла столбцы
        # в уже собранной сводке, не тронув ни одного числа под ними.
        #
        # Колонки ушедших эпох, встретившиеся у детей, допишет combine_documents
        # (срез 139) — здесь задаётся только основа порядка.
        columns=catalog_of(summary.snapshot, catalog).columns_in_order(),
    )
