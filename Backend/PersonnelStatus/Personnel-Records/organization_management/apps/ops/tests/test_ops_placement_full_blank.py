"""Бланк «Общая расстановка» выгружается тем же файлом (Plane №164).

ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ И ЧЕГО НЕТ. Решение заказчика — «сделай выгрузку точно
такого же файла, обезлич все внутри» — распадается на три проверяемых
утверждения, и у каждого своя проба:

1. вёрстка образца доехала целиком, а не пересобрана по полям;
2. внутри не осталось ни одного места подстановки — ни видимого `{{…}}`,
   ни забытого человека;
3. даты в бланке — период ЭТОГО мероприятия, а не числа образца.

Чего здесь НЕТ: проверки, что люди расставлены по ролям. Их не расставляют
вовсе — см. заглавную докстроку `documents_placement_full.py`: ролей бланка в
модели расстановки не существует, и заполнение «по порядку» назвало бы
водителем VIP человека с поста оцепления.
"""
import datetime as dt
import io
import re
import zipfile

import pytest

from organization_management.apps.ops import documents_registry as registry
from organization_management.apps.ops import documents_placement_full as blank

pytestmark = pytest.mark.django_db


@pytest.fixture
def event():
    from organization_management.apps.ops import security_events as event_service

    record = event_service.create_event(
        title="Проба бланка расстановки",
        object_id=None,
        business_date=dt.date(2026, 4, 20).isoformat(),
        kind="FOREIGN",
        actor="test",
    )
    record.business_date_end = dt.date(2026, 4, 21)
    record.save(update_fields=["business_date_end"])
    return record


def docx_text(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        raw = archive.read("word/document.xml").decode("utf-8", "ignore")
    return re.sub(r"<[^>]+>", " ", raw)


def test_the_blank_keeps_the_customers_own_layout(event):
    """Четырнадцать таблиц образца доезжают в выгрузку.

    Это и есть «точно такой же файл»: пересборка по полям дала бы одну
    таблицу — ровно то, что делает соседний вид «Расстановка».
    """
    from docx import Document

    payload, name = registry.render("placement_full", event_code=event.code, fmt="docx")

    assert name.endswith(".docx") and event.code in name
    document = Document(io.BytesIO(payload))
    assert len(document.tables) == 14, (
        f"вёрстка образца потеряна: таблиц {len(document.tables)} вместо 14"
    )


def test_nothing_is_left_unfilled_in_the_blank(event):
    """Ни одного `{{…}}` в выгруженном файле.

    Место подстановки, доехавшее до заказчика, читается как поломка выгрузки,
    а не как «система этого не знает».
    """
    payload, _ = registry.render("placement_full", event_code=event.code, fmt="docx")

    left = blank.PLACEHOLDER.findall(docx_text(payload))

    assert left == [], f"в бланке остались места подстановки: {sorted(set(left))[:10]}"


def test_the_dates_are_the_period_of_this_event(event):
    """Даты бланка — период мероприятия, а не числа образца."""
    payload, _ = registry.render("placement_full", event_code=event.code, fmt="docx")

    text = docx_text(payload)

    assert "20-21.04.2026" in text, "период мероприятия в бланк не попал"
    assert "22.04.2026" not in text, "в бланке остались даты образца"


def test_a_single_day_event_is_not_written_as_a_range(event):
    """Однодневное мероприятие пишется одной датой, а не «20-20».

    Образец пишет и диапазоном, и одной датой; выдумывать второй день ради
    единообразия значило бы сообщить о мероприятии неправду.
    """
    event.business_date_end = None
    event.save(update_fields=["business_date_end"])

    payload, _ = registry.render("placement_full", event_code=event.code, fmt="docx")

    text = docx_text(payload)
    assert "20.04.2026" in text
    assert "20-20.04.2026" not in text


def test_the_blank_carries_no_people_and_says_so_loudly(event):
    """КРАСНАЯ ПРОБА РЕШЕНИЯ «людей не подставляем».

    Если однажды люди начнут подставляться, это должно быть ОСОЗНАННЫМ
    изменением с ответом заказчика в руках, а не побочным следствием правки
    подстановки. Проба падает ровно в этот момент и приводит читателя к
    докстроке с вопросом.
    """
    values = blank.placement_full_values(event)

    people = {name: value for name, value in values.items() if name.startswith("person_")}
    assert people, "в бланке не осталось мест под людей — образец подменили"
    assert set(people.values()) == {""}, (
        "людей начали подставлять в бланк: ролей бланка в модели расстановки "
        "нет, и порядок подстановки назначит человека наугад — см. Plane №164"
    )


def test_an_unknown_event_is_refused_by_code(event):
    """Несуществующий код — отказ 404, а не пустой бланк."""
    from organization_management.apps.operations.exceptions import DomainError

    with pytest.raises(DomainError) as raised:
        registry.render("placement_full", event_code="НЕТ-ТАКОГО", fmt="docx")

    assert raised.value.http_status == 404
