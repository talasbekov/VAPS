"""Расход за ПЕРИОД: страница на каждую дату (порт derive_period из Backend/VAPS
apps/operations/submissions/services/expense_read_service.py).

Раздел уже умеет расход на ОДИН день — живой и по сданному. Период — не сумма и
не среднее по ним, а именно СТРАНИЦА НА ДАТУ: расход отвечает на вопрос «кто где
был в этот день», и сложить два таких ответа не во что. Человек, отпускной с
понедельника по среду, в сумме за неделю дал бы «три отпуска» — величину, не
означающую ничего.

СТРАНИЦЫ СЧИТАЮТСЯ, А НЕ ЧИТАЮТСЯ ИЗ ВЫПУСКОВ. Здесь нет ни номера, ни
сохранённых байт: это чтение, и оно намеренно доступно по дням, за которые
ничего не выпускали. Дата без сдачи не пропускается и не заменяется пустотой —
у неё та же страница, посчитанная по фактам статусов; «сдал» и «что было» суть
разные вопросы, и подмена первого вторым спрятала бы как раз те дни, ради
которых период и смотрят.

ПЕРИОД НЕ УХОДИТ В БУДУЩЕЕ, и гвард стоит ЗДЕСЬ, а не в маршруте (в источнике —
в маршруте). Причина доменная, а не транспортная: завтрашние страницы
сфабриковались бы из СЕГОДНЯШНЕГО штата и выглядели бы как настоящие числа за
день, которого не было. Оставь гвард наверху — и любой второй вызывающий
(команда, выгрузка, отчёт) обошёл бы его, ничего об этом не зная.
"""
from datetime import timedelta

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.strength_report import (
    StrengthReportService,
)

# Верхняя граница длины периода. Не вкус: страница считается отдельным проходом
# по статусам, и неограниченный период превращает один запрос в обход всей
# истории. Два месяца с запасом покрывают месячную отчётность — а именно её и
# смотрят периодом.
MAX_PERIOD_DAYS = 62


def _serialize_row(row):
    return {
        "division_id": row.division_id,
        "name": row.name,
        "staff_total": row.staff_total,
        "list_total": row.list_total,
        "vacancies": row.vacancies,
        "columns": dict(row.columns),
        "attached": row.attached,
        "off_list": row.off_list,
    }


def _serialize_page(business_date, result):
    """Страница одной даты.

    Дата берётся из аргумента, но выбор здесь не несущий: расход кладёт в
    результат ровно тот день, по которому его посчитали, и `result.business_date`
    дало бы то же самое. Значимо другое — что дата в странице ВООБЩЕ есть:
    именно она отличает соседние страницы, и без неё ответ стал бы столбиком
    одинаковых на вид объектов.
    """
    return {
        "business_date": business_date.isoformat(),
        "rows": [_serialize_row(row) for row in result.rows],
        "totals": {
            "staff_total": result.totals.staff_total,
            "list_total": result.totals.list_total,
            "vacancies": result.totals.vacancies,
            "columns": dict(result.totals.columns),
            "attached": result.totals.attached,
            "off_list": result.totals.off_list,
        },
    }


def derive_period(*, date_from, date_to, division_ids=None):
    """Страницы расхода за `[date_from, date_to]` включительно.

    Оба конца принадлежат периоду: «с 1 по 31 августа» в обиходе означает и
    первое, и тридцать первое, и полуоткрытый интервал молча терял бы последний
    день месяца — тот самый, ради которого месячную сводку и смотрят.

    `division_ids=None` не сужает выборку — общий уговор чтений раздела.
    """
    if date_from > date_to:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            },
            message="Начало периода позже его конца.",
        )
    span = (date_to - date_from).days + 1
    if span > MAX_PERIOD_DAYS:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"days": span, "max": MAX_PERIOD_DAYS},
            message=f"Период длиннее {MAX_PERIOD_DAYS} дней.",
        )
    today = Clock.today_local()
    if date_to > today:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"date_to": date_to.isoformat(), "today": today.isoformat()},
            message="Период не может уходить в будущее.",
        )

    pages = []
    day = date_from
    while day <= date_to:
        pages.append(
            _serialize_page(
                day, StrengthReportService.compute(day, division_ids=division_ids)
            )
        )
        day += timedelta(days=1)
    return pages
