"""«Сводные данные» из живого ОМ (Plane №158, шаг ПД-2).

Документ обязан быть СРЕЗОМ СИСТЕМЫ, а не тем, что прислал браузер. Поэтому
сводка ГВО собирается НА СЕРВЕРЕ: база из мероприятия плюс сохранённые ручные
правки. Пробы стерегут именно это — что данные пришли из ОМ, что правка
поверх базы не затирает соседние поля, и что незаполненное остаётся пустым, а
не превращается в выдуманный факт.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.models_gvo import (
    OpsGvoSummaryPatch,
)
from organization_management.apps.ops import documents_summary as summary

pytestmark = pytest.mark.django_db


def make_event(**over):
    data = dict(
        code="ОМ-Д-1",
        title="Официальный визит",
        object_name="Резиденция",
        business_date=dt.date(2026, 9, 10),
        stage="BULLETIN",
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Абенов",
        protected_person_name="Иван Петров",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )
    data.update(over)
    return OpsSecurityEvent.objects.create(**data)


def test_base_comes_from_the_event_not_from_thin_air():
    """База сводки — факты мероприятия, а не выдумка сервера."""
    event = make_event()

    result = summary.summary_for_event(event)

    assert result["persons"][0]["name"] == "Иван Петров"
    assert result["responsible"]["name"] == "Абенов"
    # Дата прибытия и убытия — ДЕЛОВАЯ ДАТА ОМ: другого источника у сервера нет.
    assert result["arrival"]["date"] == "10.09.2026г."
    assert result["departure"]["date"] == "10.09.2026г."


def test_person_absent_in_the_bulletin_is_not_invented():
    """Лицо не назвали — список пуст.

    Подставить сюда «уточняется» значило бы сказать, что охраняемое лицо есть
    и его выясняют. А его не назвали вовсе.
    """
    event = make_event(code="ОМ-Д-2", protected_person_name="")

    assert summary.summary_for_event(event)["persons"] == []


def test_patch_merges_deeply_and_does_not_wipe_neighbours(django_user_model):
    """Правка раздела «Прибытие» может нести ТОЛЬКО время.

    Плоское слияние затёрло бы дату, и документ показал бы прибытие без дня —
    выглядя при этом заполненным.
    """
    event = make_event(code="ОМ-Д-3")
    OpsGvoSummaryPatch.objects.create(
        event=event, patch={"arrival": {"time": "12:00ч."}, "country": "Вымышляндия"}
    )

    result = summary.summary_for_event(event)

    assert result["arrival"]["time"] == "12:00ч."
    assert result["arrival"]["date"] == "10.09.2026г."
    assert result["country"] == "Вымышляндия"


def test_visit_objects_come_from_the_table_and_keep_their_order():
    """Объекты посещения — из ТАБЛИЦЫ объектов, в порядке `position`.

    Порядок задаёт человек, а не база: `position` — это же порядок раскрытия
    строки реестра, и документ обязан совпадать с экраном.
    """
    event = make_event(code="ОМ-Д-4")
    for position, name in ((2, "Объект «Бета»"), (1, "Объект «Альфа»")):
        OpsSecurityEventVisitObject.objects.create(
            event=event, object_name=name, position=position,
            visit_day=dt.date(2026, 9, 10), note="",
        )

    days = summary.summary_for_event(event)["visits"]

    assert len(days) == 1
    assert [item["obj"] for item in days[0]["items"]] == [
        "Объект «Альфа»", "Объект «Бета»",
    ]
    assert days[0]["weekday"] == "четверг"


def test_unfilled_fields_are_empty_not_invented():
    """Незаполненное уходит в документ ПУСТЫМ.

    Пустая строка под подписью читается как «сведений нет» — это честно.
    Слово «уточняется» на месте, которого никто не заполнял, читалось бы как
    факт о мероприятии.
    """
    event = make_event(code="ОМ-Д-5")

    values = summary.document_values(event)

    # Ключа в данных нет ВОВСЕ — встречающих не заводили. Это не то же самое,
    # что ключ с пустым значением, и разницу видно здесь.
    assert "meeting_1" not in values

    filled = summary.fill_all_keys({"meeting_1", "person2_name"}, values)
    assert filled["meeting_1"] == ""
    assert filled["person2_name"] == ""


def test_every_template_key_gets_a_value():
    """Документ не выпускается недозаполненным — значит на КАЖДОЕ место
    шаблона обязано найтись значение, пусть и пустое.

    Проба идёт от САМОГО ШАБЛОНА: список ключей в коде разошёлся бы с файлом
    при первой же его правке.
    """
    event = make_event(code="ОМ-Д-6")
    keys = summary.template_keys(summary.summary_template_path())

    filled = summary.fill_all_keys(keys, summary.document_values(event))

    assert keys, "шаблон не содержит ни одного места подстановки — он сломан"
    assert set(filled) == keys
