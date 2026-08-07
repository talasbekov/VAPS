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
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.expense_csv import generate_expense_csv
from organization_management.apps.operations.expense_docx import generate_expense_docx
from organization_management.apps.operations.expense_pdf import generate_expense_pdf
from organization_management.apps.operations.expense_document import (
    build_expense_document,
    combine_documents,
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
    report = StrengthReportService.compute(business_date, division_ids={division_id})
    # Строка СВОЕГО подразделения. Её может не быть вовсе — у подразделения
    # без единого штатного слота живому расходу нечего показывать; документ
    # при этом законен: сдача есть, просто знаменатель пуст.
    live = next(
        (row for row in report.rows if row.division_id == division_id), None
    )
    names = DivisionTreeSelector.names_map([division_id])
    return build_expense_document(
        submission.snapshot,
        business_date,
        catalog=catalog,
        # Название — из снимка (схема 5), живое запасное: иначе печатный
        # документ и личная копия одного дня назвали бы подразделение
        # по-разному после переименования.
        division_title=title_of(submission.snapshot, names.get(division_id, "")),
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

    pinned = {
        row.pk: row
        for row in OpsDailySubmission.objects.filter(
            pk__in=[pin["submission_id"] for pin in pins]
        )
    }
    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    division_ids = [division_id, *(pin["division_id"] for pin in pins)]
    report = StrengthReportService.compute(
        business_date, division_ids=set(division_ids)
    )
    live = {row.division_id: row for row in report.rows}
    names = DivisionTreeSelector.names_map(division_ids)

    documents = []
    for source_id, snapshot in [
        (division_id, summary.snapshot),
        *(
            (pin["division_id"], pinned[pin["submission_id"]].snapshot)
            for pin in pins
            # Запиненной строки может не оказаться (чистка данных): её
            # отсутствие — не повод печатать чужие числа под её именем.
            if pin["submission_id"] in pinned
        ),
    ]:
        row = live.get(source_id)
        documents.append(
            build_expense_document(
                snapshot,
                business_date,
                catalog=catalog,
                # У КАЖДОГО ребёнка своё замороженное имя: сводка склеивает
                # чужие дни, и переименование одного из них не смеет
                # переписать строку в уже собранной сводке.
                division_title=title_of(snapshot, names.get(source_id, "")),
                staff_total=row.staff_total if row else 0,
                vacancies=row.vacancies if row else 0,
                attached=row.attached if row else 0,
            )
        )
    return combine_documents(
        documents,
        division_title=title_of(summary.snapshot, names.get(division_id, "")),
        business_date=business_date,
        columns=catalog.columns_in_order(),
    )
