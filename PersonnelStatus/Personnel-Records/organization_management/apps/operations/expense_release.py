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

Форматов два — .csv и .xlsx; .docx источника не портирован (его вёрстка
опирается на донорские шрифты и рич-текст ячейки, которых здесь нет).
"""
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.expense_csv import generate_expense_csv
from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.expense_xlsx import generate_expense_xlsx
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
    StatusTypeSelector,
)
from organization_management.apps.operations.strength_report import (
    StatusCatalog,
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
