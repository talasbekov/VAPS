"""Информационный бюллетень по предстоящим ОМ (Plane №156, шаг «ПД-4»).

Документ из образца заказчика `02 Бюллетень Орда-4 рабочий.docx`: шапка с
МОМЕНТОМ СРЕЗА («на 08:00 ч. 22.04.2026 года») и таблица из шести колонок —
дата, время, охраняемое лицо, мероприятие, локация, старший.

ПОЧЕМУ СРЕЗ, А НЕ ПРОСТО СПИСОК. Бюллетень читают утром и по нему разводят
людей; он обязан отвечать на вопрос «что предстоит НА ЭТОТ МОМЕНТ», а не «что
сейчас в базе». Момент печатается в шапке, отбор идёт от него же: мероприятия
с датой начала не раньше даты среза, ближайшие сверху.

ЧТО БЕРЁТСЯ ИЗ ДАННЫХ, А ЧТО ОСТАЁТСЯ ПУСТЫМ. Пустая ячейка — честный ответ
«сведений нет»; выдуманное значение — ложь, которую читатель примет за факт.
Поэтому: нет охраняемого лица — пусто, нет старшего — пусто, нет объекта
посещения — берётся `location` мероприятия, а нет и её — пусто. Время у ОМ в
модели отдельным полем не хранится вовсе: в образце эта колонка тоже часто
пуста, и заполнять её «09:00» на глаз нельзя.
"""
import datetime as dt
import os

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.document_tables import fill_table_rows
from organization_management.apps.ops.documents import emit, fill_template

TEMPLATE = os.path.join(
    os.path.dirname(__file__), "document_templates", "bulletin.docx"
)

#: Стадии, которых в бюллетене «предстоящих» быть не должно: закрытое
#: мероприятие не предстоит, а прошло.
_PAST_STAGES = frozenset({"CLOSED"})

_WEEKDAYS = ("пн.", "вт.", "ср.", "чт.", "пт.", "сб.", "вс.")
_MONTHS = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def format_period(start, end):
    """Дата в виде образца: «20-23 апреля\n(пн.-чт.)», «24 апреля\n(пт.)».

    Формат снят с образца, а не придуман: там дата и день недели стоят в две
    строки, и многодневное мероприятие пишется диапазоном.
    """
    if start is None:
        return ""
    if end is None or end == start:
        return f"{start.day} {_MONTHS[start.month - 1]}\n({_WEEKDAYS[start.weekday()]})"
    if (start.year, start.month) == (end.year, end.month):
        days = f"{start.day}-{end.day} {_MONTHS[start.month - 1]}"
    else:
        days = (
            f"{start.day} {_MONTHS[start.month - 1]} - "
            f"{end.day} {_MONTHS[end.month - 1]}"
        )
    return f"{days}\n({_WEEKDAYS[start.weekday()]}-{_WEEKDAYS[end.weekday()]})"


def _chief_name(event):
    """Фамилия и инициал старшего мероприятия; пусто — если не назначен."""
    if event.chief_employee_id is None:
        return ""
    from organization_management.apps.employees.models import Employee

    employee = Employee.objects.filter(pk=event.chief_employee_id).first()
    if employee is None:
        return ""
    initial = f" {employee.first_name[0]}." if employee.first_name else ""
    return f"{employee.last_name}{initial}"


def _location(event):
    """Локация: объекты посещения, а нет их — поле мероприятия.

    Объектов может быть несколько, и в образце они стоят в столбик — так же и
    здесь: перечисление в строку слилось бы в неразбираемую ленту.
    """
    names = [
        visit.security_object.name
        for visit in event.visit_objects.select_related("security_object").all()
        if visit.security_object is not None
    ]
    if names:
        return "\n".join(names)
    return event.location or ""


def bulletin_rows(as_of_date):
    """Строки бюллетеня на момент среза: ближайшие предстоящие ОМ."""
    events = (
        OpsSecurityEvent.objects.filter(business_date__gte=as_of_date)
        .exclude(stage__in=_PAST_STAGES)
        .order_by("business_date", "id")
        .prefetch_related("visit_objects__security_object")
    )
    rows = []
    for event in events:
        rows.append(
            {
                "date": format_period(event.business_date, event.business_date_end),
                # Времени у ОМ в модели нет: в образце колонка тоже пуста.
                "time": "",
                "person": event.protected_person_name or "",
                "event": event.title,
                "location": _location(event),
                "chief": _chief_name(event),
            }
        )
    return rows


def render_bulletin(as_of=None, fmt="pdf"):
    """Байты бюллетеня на момент среза (по умолчанию — сейчас).

    `fmt` — «docx» либо «pdf». DOCX это то, что просил заказчик: бюллетень
    дозаполняют руками после выгрузки.
    """
    from docx import Document

    moment = as_of or Clock.now()
    if isinstance(moment, dt.date) and not isinstance(moment, dt.datetime):
        moment = dt.datetime.combine(moment, dt.time(8, 0))
    as_of_text = (
        f"{moment.strftime('%H:%M')} ч. "
        f"{moment.day:02d}.{moment.month:02d}.{moment.year} года"
    )
    filled_path, left = fill_template(TEMPLATE, {"as_of": as_of_text})
    try:
        document = Document(filled_path)
        fill_table_rows(document.tables[0], bulletin_rows(moment.date()))
        document.save(filled_path)
        return emit(filled_path, fmt)
    finally:
        try:
            os.unlink(filled_path)
        except OSError:
            pass
