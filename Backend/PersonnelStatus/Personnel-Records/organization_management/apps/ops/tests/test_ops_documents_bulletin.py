"""Информационный бюллетень: документ образца на живых данных (Plane №156, «ПД-4»).

Проверяется НЕ «файл собрался», а три вещи, каждая из которых ломается молча:
дата в виде образца, отбор «предстоящих» на момент среза и то, что строк в
таблице ровно столько, сколько мероприятий (шаблон держит одну строку-образец,
её размножает код).

Текст достаётся из готового PDF, а не из промежуточного `.docx`: заказчик
получает PDF, и проверять надо его.
"""
import datetime as dt
import io

import pytest

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops import documents_bulletin as bulletin

pytestmark = pytest.mark.django_db


def text_of(pdf_bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def flat(text):
    """Текст без переносов и пробелов.

    Значение в ячейке ПЕРЕНОСИТСЯ по ширине колонки, и извлечение честно
    отдаёт «Президент Черно\nгории». Проверять «строка есть в документе» по
    сырому тексту значило бы проверять ширину колонки, а не наличие данных;
    ширину проверяет глаз на снимке, а проба — факт.
    """
    return "".join(text.split())


def make_event(title, start, end=None, stage="RECON", person="", location="Резиденция"):
    """ОМ заводится ШТАТНЫМ сервисом, а не вставкой в базу.

    Первая редакция пробы создавала строки через ORM и упиралась в ограничения
    БД одно за другим (`readiness_percent`, `force_need`, проверка статуса
    согласования) — потому что модель держит инварианты, которые проставляет
    сервис. Проба, обходящая сервис, описывает состояние, которого система сама
    не производит, — то же правило, что записано у сида цепочки расхода.
    """
    from organization_management.apps.ops import security_events as event_service

    event = event_service.create_event(
        title=title,
        object_id=None,
        business_date=start.isoformat(),
        business_date_end=None if end is None else end.isoformat(),
        kind="FOREIGN",
        location=location,
        actor="test",
    )
    changed = []
    if person:
        event.protected_person_name = person
        changed.append("protected_person_name")
    if stage != event.stage:
        # Стадия ставится полем ОСОЗНАННО: путь «провести мероприятие по
        # цепочке» здесь не предмет проверки, а бюллетень читает стадию.
        event.stage = stage
        changed.append("stage")
    if changed:
        event.save(update_fields=changed)
    return event


# ── Дата в виде образца ─────────────────────────────────────────────────────


def test_a_single_day_is_written_with_its_weekday():
    assert bulletin.format_period(dt.date(2026, 4, 24), None) == "24 апреля\n(пт.)"


def test_a_range_inside_one_month_is_written_as_in_the_sample():
    """«20-23 апреля (пн.-чт.)» — форма снята с образца, а не придумана."""
    assert (
        bulletin.format_period(dt.date(2026, 4, 20), dt.date(2026, 4, 23))
        == "20-23 апреля\n(пн.-чт.)"
    )


def test_a_range_across_months_names_both_months():
    """Иначе «30-2 апреля» читается как ошибка, а не как переход через месяц."""
    assert (
        bulletin.format_period(dt.date(2026, 4, 30), dt.date(2026, 5, 2))
        == "30 апреля - 2 мая\n(чт.-сб.)"
    )


# ── Отбор на момент среза ───────────────────────────────────────────────────


def test_only_the_upcoming_events_get_into_the_bulletin():
    """Бюллетень отвечает «что ПРЕДСТОИТ», а не «что есть в базе»."""
    make_event("Прошедшее", dt.date(2026, 4, 1))
    make_event("Предстоящее", dt.date(2026, 4, 25))

    titles = [row["event"] for row in bulletin.bulletin_rows(dt.date(2026, 4, 20))]

    assert titles == ["Предстоящее"]


def test_a_closed_event_is_not_upcoming_even_with_a_future_date():
    """Закрытое не предстоит: оно прошло, какой бы датой ни было заведено."""
    make_event("Закрытое", dt.date(2026, 4, 25), stage="CLOSED")
    make_event("Живое", dt.date(2026, 4, 25))

    titles = [row["event"] for row in bulletin.bulletin_rows(dt.date(2026, 4, 20))]

    assert titles == ["Живое"]


def test_the_nearest_event_stands_first():
    make_event("Позже", dt.date(2026, 5, 10))
    make_event("Раньше", dt.date(2026, 4, 25))

    titles = [row["event"] for row in bulletin.bulletin_rows(dt.date(2026, 4, 20))]

    assert titles == ["Раньше", "Позже"]


def test_a_missing_chief_is_an_empty_cell_and_not_a_guess():
    """Пустая ячейка — честное «не назначен»; выдуманное значение читатель
    примет за факт."""
    make_event("Без старшего", dt.date(2026, 4, 25))

    assert bulletin.bulletin_rows(dt.date(2026, 4, 20))[0]["chief"] == ""


# ── Готовый документ ────────────────────────────────────────────────────────


def test_the_pdf_carries_the_moment_and_every_event():
    """Момент среза в шапке и СТОЛЬКО строк, сколько мероприятий.

    Шаблон держит ОДНУ строку-образец: если её размножение сломается, в
    документе останется одно мероприятие из трёх — и это не заметит ни
    «файл собрался», ни «текст непустой».
    """
    make_event("Визит первый", dt.date(2026, 4, 25), person="Президент Черногории")
    make_event("Визит второй", dt.date(2026, 4, 26))
    make_event("Визит третий", dt.date(2026, 4, 27))

    text = text_of(bulletin.render_bulletin(dt.datetime(2026, 4, 20, 8, 0)))

    assert "08:00 ч. 20.04.2026 года" in text
    assert "Визит первый" in text
    assert "Визит второй" in text
    assert "Визит третий" in text
    assert "ПрезидентЧерногории" in flat(text)
    # Шапка таблицы образца — на месте: без неё это не документ образца.
    assert "Мероприятие" in text and "Старший" in text


def test_an_empty_bulletin_is_still_a_document():
    """Нет предстоящих — документ с шапкой и заголовком таблицы, а не отказ:
    иначе человек не отличит «ничего не предстоит» от поломки выгрузки."""
    text = text_of(bulletin.render_bulletin(dt.datetime(2026, 4, 20, 8, 0)))

    assert "08:00 ч. 20.04.2026 года" in text
    assert "Старший" in text


def test_the_template_row_does_not_leak_into_the_document():
    """КРАСНАЯ ПРОБА: строка-образец обязана исчезнуть.

    Оставленная, она уезжает в документ местами подстановки `{{date}}` — и
    `documents.py` честно отобьёт такой документ как недозаполненный. Проба
    держит обе стороны: и что мест не осталось, и что отказ существует.
    """
    make_event("Визит", dt.date(2026, 4, 25))

    text = text_of(bulletin.render_bulletin(dt.datetime(2026, 4, 20, 8, 0)))

    assert "{{" not in text, "в документ уехало место подстановки"
    assert "date" not in text.split("Дата")[0]
