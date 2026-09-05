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
        # Визит — только у мероприятий с иностранцами (Plane №435).
        kind="FOREIGN",
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
    # 🔴 ПИН ИЗМЕНЁН ОСОЗНАННО (Plane №166): было «10.09.2026г.». Суффикс «г.»
    # нужен ДОКУМЕНТУ (так в образце заказчика) и не нужен СВОДКЕ — экран
    # показывает дату без него. Пока суффикс сидел в сборке сводки, экран и
    # документ уже расходились в дате. Теперь он живёт в раскладке документа,
    # и сводка отдаёт ровно то, что показывает экран.
    assert result["arrival"]["date"] == "10.09.2026"
    assert result["departure"]["date"] == "10.09.2026"


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
    assert result["arrival"]["date"] == "10.09.2026"
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


def test_document_writes_the_date_with_g_and_the_summary_without_it():
    """Документ и экран пишут дату ПО-РАЗНОМУ, и оба правы.

    В образце заказчика дата стоит с «г.» и пробелом («17.06.2026 г.»), на
    экране сводки — без него. Разница законная: это разные слои. Незаконно
    было бы держать её В ОДНОМ значении, как было до Plane №166, — тогда
    правка под документ молча меняет экран, и наоборот.

    Проба стережёт обе формы сразу: поправить одну, забыв другую, не выйдет.
    """
    event = make_event(code="ОМ-Д-Г")

    assert summary.summary_for_event(event)["arrival"]["date"] == "10.09.2026"
    assert summary.document_values(event)["arrival_1"].startswith("10.09.2026 г.")


def test_the_document_does_not_stamp_g_on_the_word_unspecified():
    """«уточняется г.» — не дата, а мусор под подписью.

    Суффикс приклеивается к ДАТЕ, а не ко всему, что стоит в поле даты.
    """
    event = make_event(code="ОМ-Д-У")
    OpsGvoSummaryPatch.objects.create(
        event=event, patch={"arrival": {"date": summary.UNSPECIFIED}}
    )

    assert summary.document_values(event)["arrival_1"].startswith("уточняется")
    assert "уточняется г." not in summary.document_values(event)["arrival_1"]


# ── Сводка собирается ОДИН раз на строку (Plane №690) ───────────────────


def test_the_row_assembles_the_summary_once(django_assert_num_queries):
    """`summary_row` и `_required_progress` собирали сводку ДВАЖДЫ.

    🔴 ЧТО ЭТО СТОИЛО. `_with_refs` ходит в `Employee` ПО ОДНОМУ ЗАПРОСУ НА
    ИДЕНТИФИКАТОР (`_employee_refs`), а `assembled_summaries` зовёт
    `summary_row` на КАЖДОЕ мероприятие и написан ровно затем, чтобы не
    платить запросом за строку («реестр из сорока строк стоил бы сорок
    запросов»). Двойная сборка удваивала именно эту цену — и делала это
    молча: ответ был верный, дороже был только путь.

    Проба считает ЗАПРОСЫ, а не вызовы: подмена функции проверяла бы, как
    написан код, а число запросов — во что он обходится. Трёх встречающих
    хватает: 12 запросов против 7, и разницу не спутать с погрешностью.
    """
    from organization_management.apps.operations.models_gvo import OpsForeignVisit
    from organization_management.apps.ops.tests.test_ops_security_events_api import (
        make_employee,
    )

    event = make_event()
    people = [make_employee(last_name=f"Встречающий{i}") for i in range(3)]
    OpsForeignVisit.objects.create(
        event=event,
        data={"meetEmployeeIds": [str(p.pk) for p in people]},
    )

    # 🔴 ЧИСЛО ПОСЧИТАНО ЗАПУСКОМ, А НЕ ВЫВЕДЕНО ИЗ ГОЛОВЫ. До правки на этой
    # же фикстуре было 12, после — 7: три встречающих переставали стоить
    # вдвое. Разбирать семёрку по слагаемым проба не берётся — состав запросов
    # `_find_personnel` не её предмет; предмет — что сборка ОДНА. Мутация
    # «вернуть повторную сборку в `_required_progress`» даёт 12 и краснит
    # здесь (проверено запуском).
    with django_assert_num_queries(7):
        row = summary.summary_row(event)

    assert [ref["id"] for ref in row["summary"]["meetRefs"]] == [
        str(p.pk) for p in people
    ]
    # Прогресс обязательных полей считается по ТОЙ ЖЕ сводке — иначе экономия
    # обернулась бы вторым, расходящимся ответом.
    assert row["requiredTotal"] > 0
    assert isinstance(row["missingRequired"], list)
