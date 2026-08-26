"""Графики прибытия и убытия из образцов заказчика (Plane №156, шаг «ПД-5»).

Проверяется то, что ломается молча: отбор строк (только иностранные визиты и
только предстоящие), сборка ячейки борта из сводки ГВО и то, что данные сводки
ДОЕХАЛИ в готовый PDF. «Файл собрался» тут ничего не значит: пустой график
собирается точно так же.
"""
import datetime as dt
import io

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsGvoSummaryPatch
from organization_management.apps.ops import documents_schedules as schedules

pytestmark = pytest.mark.django_db


def text_of(pdf_bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def flat(text):
    """Без переносов: значение в ячейке переносится по ширине колонки, и
    проверять данные по сырому тексту значило бы проверять ширину."""
    return "".join(text.split())


def make_event(title, start, kind="FOREIGN", stage="RECON"):
    """ОМ штатным сервисом: модель держит инварианты, которые ставит он."""
    from organization_management.apps.ops import security_events as event_service

    event = event_service.create_event(
        title=title,
        object_id=None,
        business_date=start.isoformat(),
        kind=kind,
        actor="test",
    )
    if stage != event.stage:
        event.stage = stage
        event.save(update_fields=["stage"])
    return event


def with_summary(event, patch):
    OpsGvoSummaryPatch.objects.create(event=event, patch=patch)
    return event


FULL_PATCH = {
    "country": "Черногория",
    "persons": [{"name": "Яков Милатович", "role": "Президент Черногории", "facts": []}],
    "arrival": {
        "date": "21.04.2026",
        "time": "14.00ч",
        "route": "гг. Подгорица – Астана",
        "flight": "а/к «Air Astana» КС 638",
        "dur": "(время в полете 5:40 часа)",
    },
    "departure": {"date": "23.04.2026", "time": "12.00ч", "route": "", "flight": "", "dur": ""},
    "stay": {"place": "Гостиница Hilton", "room": "№ 1620"},
    "meet": ["ЗПМ РК Р.Скляр"],
    "farewell": ["Зам. МИД А.Исетов"],
    "responsible": {"name": "Шаубиденов", "callsign": "poz 1-30"},
    "sbChief": "старший СБ: Мамаев",
}


# ── Отбор строк ─────────────────────────────────────────────────────────────


def test_only_foreign_visits_get_into_the_schedule():
    """График — про ГЛАВ ДЕЛЕГАЦИЙ: внутреннему мероприятию тут не место."""
    with_summary(make_event("Иностранный визит", dt.date(2026, 4, 25)), FULL_PATCH)
    make_event("Внутреннее", dt.date(2026, 4, 25), kind="INTERNAL")

    rows = schedules.schedule_rows(schedules.ARRIVAL, dt.date(2026, 4, 20))

    assert len(rows) == 1
    assert "Черногория" in rows[0]["country"]


def test_a_closed_visit_is_not_in_the_schedule():
    with_summary(make_event("Закрытый", dt.date(2026, 4, 25), stage="CLOSED"), FULL_PATCH)

    assert schedules.schedule_rows(schedules.ARRIVAL, dt.date(2026, 4, 20)) == []


def test_rows_are_numbered_from_one():
    """Номер — колонка образца: без него строки не назвать вслух."""
    for day in (25, 26):
        with_summary(make_event(f"Визит {day}", dt.date(2026, 4, day)), FULL_PATCH)

    rows = schedules.schedule_rows(schedules.ARRIVAL, dt.date(2026, 4, 20))

    assert [row["no"] for row in rows] == [1, 2]


# ── Сборка ячеек из сводки ──────────────────────────────────────────────────


def test_the_flight_cell_carries_every_part_of_the_summary():
    """Дата, время, маршрут, рейс и время в полёте — как в образце, в столбик."""
    with_summary(make_event("Визит", dt.date(2026, 4, 25)), FULL_PATCH)

    cell = schedules.schedule_rows(schedules.ARRIVAL, dt.date(2026, 4, 20))[0]["arrival"]

    assert "21.04.2026" in cell
    assert "гг. Подгорица – Астана" in cell
    assert "КС 638" in cell
    assert "время в полете" in cell
    # Столбиком, а не лентой: склеенное в строку читают по слогам.
    assert cell.count("\n") >= 3


def test_the_head_of_delegation_is_the_first_person_of_the_summary():
    with_summary(make_event("Визит", dt.date(2026, 4, 25)), FULL_PATCH)

    cell = schedules.schedule_rows(schedules.ARRIVAL, dt.date(2026, 4, 20))[0]["country"]

    assert "Черногория" in cell
    assert "Яков Милатович" in cell


def test_missing_summary_leaves_cells_empty_and_does_not_guess():
    """Сводки нет — ячейки пусты. «Уточняется» это решение человека, и
    подставлять его за него нельзя."""
    make_event("Визит без сводки", dt.date(2026, 4, 25))

    row = schedules.schedule_rows(schedules.ARRIVAL, dt.date(2026, 4, 20))[0]

    assert row["arrival"] == ""
    assert row["stay"] == ""
    assert row["sgo"] == ""


def test_the_departure_schedule_carries_farewell_and_not_meeting():
    """У убытия своя колонка: провожающие, а не встречающие — иначе документ
    показывал бы чужие сведения под верной подписью."""
    with_summary(make_event("Визит", dt.date(2026, 4, 25)), FULL_PATCH)

    row = schedules.schedule_rows(schedules.DEPARTURE, dt.date(2026, 4, 20))[0]

    assert row["farewell"] == "Зам. МИД А.Исетов"
    assert "meet" not in row


# ── Готовые документы ───────────────────────────────────────────────────────


def test_the_arrival_pdf_carries_the_moment_period_and_the_data():
    with_summary(make_event("Визит", dt.date(2026, 4, 25)), FULL_PATCH)

    text = text_of(schedules.render_schedule(schedules.ARRIVAL, dt.datetime(2026, 4, 20, 8, 0)))

    assert "проект на 20.04.2026 г." in text
    assert "время 08:00" in text
    assert "25.04.2026" in text, "период документа не проставлен"
    assert "Черногория" in flat(text)
    assert "ЯковМилатович" in flat(text)
    assert "ГостиницаHilton" in flat(text)
    assert "№1620" in flat(text)


def test_the_departure_pdf_is_a_different_document_with_its_own_columns():
    with_summary(make_event("Визит", dt.date(2026, 4, 25)), FULL_PATCH)

    text = text_of(schedules.render_schedule(schedules.DEPARTURE, dt.datetime(2026, 4, 20, 8, 0)))

    assert "Зам. МИД А.Исетов" in text or "Зам.МИДА.Исетов" in flat(text)
    # Колонки прибытия в графике убытия нет — это другой документ образца.
    assert "Датаивремяприбытия" not in flat(text)


def test_an_empty_schedule_says_so_instead_of_showing_a_bare_table():
    """Нет прибытий — документ говорит об этом словами: пустая таблица без
    объяснения читается как поломка выгрузки."""
    text = text_of(schedules.render_schedule(schedules.ARRIVAL, dt.datetime(2026, 4, 20, 8, 0)))

    assert "не запланировано" in text


def test_no_placeholder_leaks_into_the_document():
    """КРАСНАЯ ПРОБА: мест подстановки в готовом документе быть не должно."""
    with_summary(make_event("Визит", dt.date(2026, 4, 25)), FULL_PATCH)

    text = text_of(schedules.render_schedule(schedules.ARRIVAL, dt.datetime(2026, 4, 20, 8, 0)))

    assert "{{" not in text
