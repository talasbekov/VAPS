"""Графики прибытия и убытия глав делегаций (Plane №156, шаг «ПД-5»).

Документы из образцов заказчика `05 График прибытия.docx` и
`05 График убытия.docx`: шапка с моментом среза («проект на 22.04.2026 г.» /
«время 08:00»), период с городом и таблица по главам делегаций.

ОТКУДА ДАННЫЕ. Из сводки ГВО мероприятия (`OpsGvoSummaryPatch.patch`) —
страна, глава делегации, борт прибытия и убытия, проживание, встречающие и
провожающие. Сводка ведётся на экране карточки ОМ, и документ обязан
показывать ровно её: второй источник тех же сведений разошёлся бы с экраном
молча.

ЧЕГО В ДАННЫХ НЕТ — ТО ОСТАЁТСЯ ПУСТЫМ. В образце есть колонки «ПИГ» и
«Закрепление СГО/МИД»: первой в системе нет вовсе, вторая складывается из
ответственного и старшего СБ, если они названы. Пустая клетка — честный
ответ «сведений нет»; выдуманное значение читатель примет за факт и разведёт
по нему людей.
"""
import datetime as dt
import os

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsGvoSummaryPatch
from organization_management.apps.ops.document_tables import fill_table_rows
from organization_management.apps.ops.documents import docx_to_pdf, fill_template

TEMPLATES = os.path.join(os.path.dirname(__file__), "document_templates")
ARRIVAL_TEMPLATE = os.path.join(TEMPLATES, "schedule_arrival.docx")
DEPARTURE_TEMPLATE = os.path.join(TEMPLATES, "schedule_departure.docx")

ARRIVAL = "arrival"
DEPARTURE = "departure"

_PAST_STAGES = frozenset({"CLOSED"})


def _flight(block):
    """Борт строкой образца: дата, время, маршрут, рейс, время в полёте.

    В образце это несколько строк в одной ячейке — так же и здесь: склеенные
    в одну строку они превращаются в ленту, которую читают по слогам.
    """
    if not isinstance(block, dict):
        return ""
    parts = [
        str(block.get("date") or "").strip(),
        (str(block.get("time") or "").strip()),
        str(block.get("route") or "").strip(),
        str(block.get("flight") or "").strip(),
        str(block.get("dur") or "").strip(),
    ]
    return "\n".join(part for part in parts if part)


def _stay(block):
    if not isinstance(block, dict):
        return ""
    parts = [str(block.get("place") or "").strip(), str(block.get("room") or "").strip()]
    return "\n".join(part for part in parts if part)


def _people(values):
    """Список людей в столбик; не список — пусто."""
    if not isinstance(values, list):
        return ""
    return "\n".join(str(item).strip() for item in values if str(item or "").strip())


def _head_of_delegation(patch):
    """Глава делегации: ПЕРВОЕ лицо сводки.

    В образце в этой колонке стоит страна и под ней глава — первым в списке
    охраняемых лиц сводки идёт именно он. Нет списка — пусто, а не «уточняется»:
    «уточняется» это решение человека, и выдумывать его за него нельзя.
    """
    persons = patch.get("persons")
    if not isinstance(persons, list) or not persons:
        return ""
    first = persons[0]
    if not isinstance(first, dict):
        return ""
    name = str(first.get("name") or "").strip()
    role = str(first.get("role") or "").strip()
    return "\n".join(part for part in (role, name) if part)


def _sgo(patch):
    """Закрепление СГО: ответственный и старший СБ, если названы."""
    parts = []
    responsible = patch.get("responsible")
    if isinstance(responsible, dict):
        name = str(responsible.get("name") or "").strip()
        callsign = str(responsible.get("callsign") or "").strip()
        joined = " ".join(part for part in (name, callsign) if part)
        if joined:
            parts.append(f"СГО: {joined}")
    chief = str(patch.get("sbChief") or "").strip()
    if chief:
        parts.append(chief)
    return "\n".join(parts)


def schedule_rows(kind, as_of_date):
    """Строки графика: по одному ряду на мероприятие со сводкой ГВО."""
    patches = {
        record.event_id: record.patch or {}
        for record in OpsGvoSummaryPatch.objects.select_related("event")
    }
    events = (
        OpsSecurityEvent.objects.filter(
            business_date__gte=as_of_date, kind=OpsSecurityEvent.Kind.FOREIGN
        )
        .exclude(stage__in=_PAST_STAGES)
        .order_by("business_date", "id")
    )
    rows = []
    for event in events:
        patch = patches.get(event.id) or {}
        country = str(patch.get("country") or "").strip()
        head = _head_of_delegation(patch)
        row = {
            "no": len(rows) + 1,
            "country": "\n".join(part for part in (country, head) if part)
            or event.protected_person_name
            or "",
            "departure": _flight(patch.get("departure")),
            "stay": _stay(patch.get("stay")),
            "pig": "",
            "sgo": _sgo(patch),
        }
        if kind == ARRIVAL:
            row["arrival"] = _flight(patch.get("arrival"))
            row["meet"] = _people(patch.get("meet"))
        else:
            row["farewell"] = _people(patch.get("farewell"))
        rows.append(row)
    return rows


def render_schedule(kind, as_of=None):
    """Байты PDF графика прибытия (`arrival`) или убытия (`departure`)."""
    from docx import Document

    if kind not in (ARRIVAL, DEPARTURE):
        raise ValueError(f"неизвестный вид графика: {kind!r}")
    moment = as_of or Clock.now()
    if isinstance(moment, dt.date) and not isinstance(moment, dt.datetime):
        moment = dt.datetime.combine(moment, dt.time(8, 0))
    rows = schedule_rows(kind, moment.date())
    # Период документа — от первого до последнего мероприятия выборки: в
    # образце он стоит подзаголовком и говорит, за какой отрезок график.
    if rows:
        events = (
            OpsSecurityEvent.objects.filter(
                business_date__gte=moment.date(), kind=OpsSecurityEvent.Kind.FOREIGN
            )
            .exclude(stage__in=_PAST_STAGES)
            .order_by("business_date")
        )
        first = events.first().business_date
        last = (events.last().business_date_end or events.last().business_date)
        period = f"({first.strftime('%d.%m.%Y')} - {last.strftime('%d.%m.%Y')})"
    else:
        period = "(на этот момент прибытий и убытий не запланировано)"
    values = {
        "as_of_date": f"{moment.day:02d}.{moment.month:02d}.{moment.year} г.",
        "as_of_time": moment.strftime("%H:%M"),
        "period": period,
    }
    template = ARRIVAL_TEMPLATE if kind == ARRIVAL else DEPARTURE_TEMPLATE
    filled_path, _left = fill_template(template, values)
    try:
        document = Document(filled_path)
        fill_table_rows(document.tables[0], rows)
        document.save(filled_path)
        return docx_to_pdf(filled_path)
    finally:
        try:
            os.unlink(filled_path)
        except OSError:
            pass
