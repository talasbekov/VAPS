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

from django.utils import timezone

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
    """Старший мероприятия для бюллетеня: «Фамилия / позывной» (`[МД-10]`).

    🔴 ФОРМАТ ЗАДАН СПЕЦИФИКАЦИЕЙ, А НЕ УДОБСТВОМ (Plane №456). Позывной —
    то, чем старшего зовут в эфире, и в бюллетене он стоит рядом с фамилией
    именно поэтому: документ читают те, кто будет выходить на связь.

    Позывного нет — печатается прежнее «Фамилия И.». Это не запасной вариант
    «на случай пустоты», а честный ответ: инициал различает однофамильцев, а
    выдуманного позывного у человека нет. У всех записей, заведённых до
    миграции 0003, поле пусто, и документ для них не меняется ни на символ.

    Пусто целиком — старший не назначен.
    """
    if event.chief_employee_id is None:
        return ""
    from organization_management.apps.employees.models import Employee

    employee = Employee.objects.filter(pk=event.chief_employee_id).first()
    if employee is None:
        return ""
    callsign = (employee.callsign or "").strip()
    if callsign:
        return f"{employee.last_name} / {callsign}"
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
        .prefetch_related("visit_objects__security_object", "protected_persons")
    )
    rows = []
    for event in events:
        rows.append(
            {
                "date": format_period(event.business_date, event.business_date_end),
                # Времени у ОМ в модели нет: в образце колонка тоже пуста.
                "time": "",
                # ВСЕ лица бюллетеня, а не только главное (Plane №188).
                # Колонка бланка одна, лиц бывает несколько — они
                # перечисляются через запятую, как это и делают руками.
                # Главное идёт ПЕРВЫМ: в бланке его читают как «за кого
                # мероприятие», остальные — сопровождение.
                "person": _persons(event),
                "event": event.title,
                "location": _location(event),
                "chief": _chief_name(event),
            }
        )
    return rows


def _persons(event):
    """Лица бюллетеня строкой: главное первым, остальные по имени.

    Снимок подписи (`protected_person_name`) остаётся источником для главного
    лица: он переживает скрытие лица из справочника, а связь — нет.
    """
    main = (event.protected_person_name or "").strip()
    rest = sorted(
        person.name
        for person in event.protected_persons.all()
        if person.name.strip() != main
    )
    return ", ".join(name for name in [main, *rest] if name != "")


def render_bulletin(as_of=None, fmt="pdf", rows=None):
    """Байты бюллетеня на момент среза (по умолчанию — сейчас).

    `fmt` — «docx» либо «pdf». DOCX это то, что просил заказчик: бюллетень
    дозаполняют руками после выгрузки.

    🔴 СРЕЗ ПРИВОДИТСЯ К МЕСТНОМУ ВРЕМЕНИ ЗДЕСЬ, В ОДНОМ МЕСТЕ (Plane №624).
    Раньше каждый вызывающий решал это сам: выпуск (`issue_bulletin`) переводил
    момент в `localtime` до отрисовки, а ручка отрисовки на лету отдавала
    разобранный aware-datetime как есть. Один и тот же `asOf` давал ДВА разных
    документа: `2026-09-15T00:30+00:00` через отрисовку — шапку «00:30 ч.
    15.09.2026» и срез по 15.09, а через выпуск — «05:30 ч. 15.09.2026»
    (Asia/Almaty) и около полуночи ДРУГОЙ набор мероприятий. Два документа с
    одним и тем же срезом в реквизитах — спор «что было отправлено» такой
    бюллетень не решает, а создаёт.

    🔴 `rows` — УЖЕ СОБРАННЫЕ СТРОКИ (Plane №623). Выпуск сохраняет снимок строк
    и PDF, и собирать их дважды значит собирать их в РАЗНЫЕ моменты: при READ
    COMMITTED коммит, пришедший между двумя вызовами, разводит сохранённый
    снимок и замороженный PDF. Ровно та гарантия, которую объявляет докстринг
    модуля выпусков, и рушилась. Не передали — собираются здесь, как и прежде.
    """
    from docx import Document

    moment = as_of or Clock.now()
    if isinstance(moment, dt.date) and not isinstance(moment, dt.datetime):
        moment = dt.datetime.combine(moment, dt.time(8, 0))
    elif timezone.is_aware(moment):
        moment = timezone.localtime(moment)
    as_of_text = (
        f"{moment.strftime('%H:%M')} ч. "
        f"{moment.day:02d}.{moment.month:02d}.{moment.year} года"
    )
    filled_path, left = fill_template(TEMPLATE, {"as_of": as_of_text})
    try:
        document = Document(filled_path)
        fill_table_rows(
            document.tables[0],
            bulletin_rows(moment.date()) if rows is None else rows,
        )
        document.save(filled_path)
        return emit(filled_path, fmt)
    finally:
        try:
            os.unlink(filled_path)
        except OSError:
            pass
