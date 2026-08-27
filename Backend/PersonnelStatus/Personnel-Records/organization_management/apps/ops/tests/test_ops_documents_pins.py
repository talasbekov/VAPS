"""ПИНЫ ВСЕХ ШЕСТИ ДОКУМЕНТОВ ОМ (Plane №163, шаг ПД-7).

ЧТО ЗДЕСЬ СТЕРЕЖЁТСЯ И ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. У каждого документа уже есть
свои пробы — они про ДАННЫЕ: попал ли нужный человек в нужную строку, отобраны
ли предстоящие мероприятия, слился ли патч. Здесь стережётся ФОРМА: состав и
порядок колонок, подписи, имя файла, перечень видов.

Разница не бюрократическая. Заказчик просил документы «в точности как в
образцах», и форма ломается иначе, чем данные: колонку переставили — данные
по-прежнему верные, каждая проба зелена, а в бумаге под подписью
«Встречающее лицо» стоит СГО. Такую поломку не видит ни одна проба про данные,
и на глаз она заметна только тому, кто помнит образец.

Пины сняты с ШАБЛОНОВ, а шаблоны — с образцов заказчика. Менять пин здесь
можно, но только осознанно и с причиной в комментарии: пин, подогнанный под
новый вывод, перестаёт быть пином.
"""
import datetime as dt
import io

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsGvoSummaryPatch
from organization_management.apps.ops import documents_registry as registry

pytestmark = pytest.mark.django_db

#: Колонки шаблонов — ДОСЛОВНО, в порядке образца. Перенос строки внутри
#: подписи заменён пробелом: в `.docx` он часть вёрстки ячейки, а не текста.
TEMPLATE_COLUMNS = {
    "bulletin.docx": ["Дата", "Время", "ОЛ", "Мероприятие", "Локация", "Старший"],
    "placement.docx": ["Сектор", "Пост", "Задача", "Смена", "Требуется", "Назначены"],
    "schedule_arrival.docx": [
        "№",
        "Страна Глава делегации",
        "Дата и время прибытия/ тип борта/ Терминал",
        "Дата и время отбытия Терминал",
        "Проживание   бронированная автомашина",
        "Встречающее лицо от Правительства/ Сопровождающее лицо",
        "ПИГ",
        "Закрепление СГО/МИД",
    ],
    "schedule_departure.docx": [
        "№",
        "Страна Глава делегации",
        "Дата и время отбытия Терминал",
        "Проживание   бронированная автомашина",
        "Встречающее лицо от Правительства/ Сопровождающее лицо",
        "ПИГ",
        "Закрепление СГО/МИД",
    ],
}

#: Виды документов, как их видит экран. Пин ловит ТИХУЮ пропажу: документ,
#: выпавший из реестра, просто перестаёт предлагаться, и никакая проба про
#: данные этого не заметит — она гоняет сборщик напрямую.
KINDS_PINNED = [
    ("summary", "Сводные данные", True),
    ("bulletin", "Информационный бюллетень", False),
    ("arrival", "График прибытия", False),
    ("departure", "График убытия", False),
    ("placement", "Расстановка", True),
    # Бланк заказчика приехал с №164 РЯДОМ с «Расстановкой», а не вместо неё:
    # у них разная природа — срез системы против формы заказчика.
    ("placement_full", "Общая расстановка (бланк)", True),
    # «Список броней в ГОН» приехал с №216 — восьмой образец задачи №156. До
    # реестра транспорта (№215) собрать его было НЕ ИЗ ЧЕГО: автопарка в
    # системе не было вовсе. `needsEvent` = False осознанно: документ про
    # ПАРК, а не про мероприятие, и спрашивать у него код ОМ незачем.
    ("vehicles", "Список броней в ГОН", False),
]


def text_of(pdf_bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def flat(text):
    """Без пробелов и переносов: значение в ячейке переносится по ширине
    колонки, и сравнивать сырой текст значило бы сравнивать вёрстку."""
    return "".join(text.split())


def template_columns(name):
    import os

    from docx import Document

    path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "document_templates", name
    )
    table = Document(path).tables[0]
    return [cell.text.strip().replace("\n", " ") for cell in table.rows[0].cells]


@pytest.fixture
def event():
    """Одно мероприятие на все виды: визит иностранного ОЛ со сводкой,
    расчётом и назначениями — то есть такое, на котором каждый из пяти
    документов имеет что показать."""
    from organization_management.apps.ops import security_events as event_service

    record = event_service.create_event(
        title="Проба пинов",
        object_id=None,
        business_date=dt.date(2026, 4, 25).isoformat(),
        kind="FOREIGN",
        actor="test",
    )
    record.recon_sector_posts = [
        {"id": "p1", "sector": "Периметр", "post": "Пост 1",
         "task": "Охрана периметра", "need": 1, "shift": "07:00–15:00"},
    ]
    record.placement_assignments = [
        {"id": "a1", "postId": "p1", "employeeName": "Абенов С.", "callsign": "2-27"},
    ]
    record.save(update_fields=["recon_sector_posts", "placement_assignments"])
    OpsGvoSummaryPatch.objects.create(
        event=record,
        patch={
            "country": "Черногория",
            "persons": [
                {"name": "Яков Милатович", "role": "Президент", "facts": []}
            ],
            "arrival": {"date": "21.04.2026", "time": "14.00ч",
                        "route": "гг. Подгорица – Астана",
                        "flight": "КС 638", "dur": "(5:40 часа)"},
            "departure": {"date": "23.04.2026", "time": "12.00ч",
                          "route": "", "flight": "", "dur": ""},
            "stay": {"place": "Гостиница Hilton", "room": "№ 1620"},
            "meet": ["ЗПМ РК Р.Скляр"],
            "farewell": ["Зам. МИД А.Исетов"],
        },
    )
    return record


@pytest.mark.parametrize("name,columns", sorted(TEMPLATE_COLUMNS.items()))
def test_template_keeps_the_columns_of_the_customer_sample(name, columns):
    """Состав и ПОРЯДОК колонок шаблона — как в образце.

    Переставленная колонка не ломает ни одну пробу про данные: значения
    по-прежнему верные, просто стоят не под своими подписями. В бумаге это
    читается как факт — «встречающее лицо: закрепление СГО».
    """
    assert template_columns(name) == columns


def test_the_screen_is_offered_exactly_these_documents():
    """Перечень видов — пин целиком, вместе с подписями и нуждой в ОМ.

    `needsEvent` в пине не для полноты: по нему экран решает, спрашивать ли
    мероприятие. Сбитый признак даёт либо лишний вопрос, либо отказ ручки
    после нажатия — и то и другое человек увидит раньше любой пробы.
    """
    listed = [
        (item["kind"], item["label"], item["needsEvent"])
        for item in registry.list_kinds()
    ]

    assert listed == KINDS_PINNED


@pytest.mark.parametrize("kind,label,needs_event", KINDS_PINNED)
def test_every_kind_comes_back_as_a_real_pdf(event, kind, label, needs_event):
    """Каждый вид собирается через реестр и отдаёт НАСТОЯЩИЙ PDF.

    «Файл не пустой» не значит ничего: PDF из пустого шаблона тоже не пуст, и
    файл с текстом ошибки внутри тоже. Стережётся подпись формата и имя файла
    — по нему человек узнаёт документ в папке загрузок.
    """
    payload, name = registry.render(
        kind,
        event_code=event.code if needs_event else None,
        as_of=dt.date(2026, 4, 20),
    )

    assert payload[:4] == b"%PDF", f"«{label}» вернулся не PDF"
    assert name.endswith(".pdf")
    assert (event.code in name) is needs_event


@pytest.mark.parametrize(
    "kind,template",
    [
        ("bulletin", "bulletin.docx"),
        ("placement", "placement.docx"),
        ("arrival", "schedule_arrival.docx"),
        ("departure", "schedule_departure.docx"),
    ],
)
def test_the_columns_reach_the_printed_document(event, kind, template):
    """Подписи колонок доезжают В ГОТОВЫЙ PDF, а не только лежат в шаблоне.

    Между шаблоном и бумагой стоит конвертация: шапка может уехать за край
    страницы или потеряться вместе со строкой-образцом. Пробы про данные
    этого не видят — они смотрят значения.
    """
    payload, _ = registry.render(
        kind,
        event_code=event.code if registry.KINDS[kind]["needs_event"] else None,
        as_of=dt.date(2026, 4, 20),
    )
    printed = flat(text_of(payload))

    missing = [
        column
        for column in TEMPLATE_COLUMNS[template]
        if flat(column) not in printed
    ]

    assert missing == [], f"подписи колонок не доехали в «{kind}»: {missing}"


def test_the_summary_keeps_the_labels_of_its_sample(event):
    """«Сводные данные» — не таблица, а бланк: у него стерегутся ПОДПИСИ.

    Колонок здесь нет, и предыдущая проба про них молчала бы. А подписи —
    ровно та форма, которую заказчик просил «в точности»: они стоят слева от
    каждого значения и называют, что именно человек читает.
    """
    payload, _ = registry.render("summary", event_code=event.code)
    printed = flat(text_of(payload))

    missing = [
        label
        for label in (
            "Страна:",
            "Охраняемые лица:",
            "Антропометрические данные:",
            "Прибытие/тип борта:",
            "Убытие/тип борта:",
            "Встречающие и провожающие лица:",
            "Место проживания:",
            "Состав делегации:",
            "Руководитель СБ:",
            "Пожелания:",
            "Состав ГВО СГО РК:",
            "Выделяемый транспорт:",
            "Вариант ОБ:",
            "Канал р/связи:",
            "Объекты посещения:",
        )
        if flat(label) not in printed
    ]

    assert missing == [], f"подписи бланка не доехали: {missing}"


def test_the_summary_prints_the_values_and_not_only_the_form(event):
    """В бланке стоят ЗНАЧЕНИЯ мероприятия, а не одни подписи.

    Сторож против самой опасной зелени этого раздела: документ, собранный из
    пустого шаблона, проходит и подпись `%PDF`, и проверку подписей — он же
    и есть чистый бланк. Отличает его только присутствие данных.
    """
    payload, _ = registry.render("summary", event_code=event.code)
    printed = flat(text_of(payload))

    assert flat("Черногория") in printed
    assert flat("Яков Милатович") in printed


# ── Формат выгрузки (Plane №156) ─────────────────────────────────────────
#
# Заказчик просил документы «в таком же формате», а образцы — рабочие бланки
# WORD: их дозаполняют руками после выгрузки. Цепочка ПД-2…ПД-7 сделала PDF, и
# это было ответом не на тот вопрос. Здесь стережётся, что оба формата живы и
# что DOCX — настоящий Word, а не PDF с другим именем.


@pytest.mark.parametrize("kind,label,needs_event", KINDS_PINNED)
def test_every_kind_comes_back_as_a_real_docx(event, kind, label, needs_event):
    """Каждый вид выгружается ЕЩЁ И в DOCX, и это настоящий Word.

    `.docx` — zip-архив, и подпись `PK` отличает его от чего угодно с тем же
    расширением. Внутри обязан лежать `word/document.xml`: пустой архив тоже
    начинается с `PK`.
    """
    import zipfile

    payload, name = registry.render(
        kind,
        event_code=event.code if needs_event else None,
        as_of=dt.date(2026, 4, 20),
        fmt="docx",
    )

    assert payload[:2] == b"PK", f"«{label}» вернулся не DOCX"
    assert name.endswith(".docx")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert "word/document.xml" in archive.namelist()


def test_the_docx_carries_the_values_and_not_the_placeholders(event):
    """В выгруженном DOCX стоят ЗНАЧЕНИЯ, а мест подстановки не осталось.

    Самая тихая поломка этого формата: `.docx` отдаётся как есть, и документ
    с `{{country_1}}` внутри открывается в Word без единой жалобы — человек
    прочтёт скобки как часть бланка.
    """
    import re
    import zipfile

    payload, _ = registry.render("summary", event_code=event.code, fmt="docx")

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        body = archive.read("word/document.xml").decode("utf-8", "ignore")
    printed = flat(re.sub(r"<[^>]+>", " ", body))

    assert "{{" not in body
    assert flat("Черногория") in printed


def test_pdf_stays_the_default_format(event):
    """Умолчание — PDF, как до появления выбора.

    Читатели ручки звали `render` без формата и получали PDF. Сменить
    умолчание молча значило бы отдать им другой файл под тем же вызовом — и
    узнали бы они об этом не из кода, а из открытого не тем приложением файла.
    """
    payload, name = registry.render("bulletin", as_of=dt.date(2026, 4, 20))

    assert payload[:4] == b"%PDF"
    assert name.endswith(".pdf")


def test_an_unknown_format_is_refused_by_name():
    """Незнакомый формат — внятный отказ, а не молчаливый PDF.

    Подмена формата это не помощь, а сюрприз: человек просил `xlsx`, получил
    бы PDF и решил, что система умеет xlsx.
    """
    from organization_management.apps.operations.exceptions import DomainError

    with pytest.raises(DomainError) as failure:
        registry.render("bulletin", as_of=dt.date(2026, 4, 20), fmt="xlsx")

    assert failure.value.code == "VALIDATION_ERROR"


def test_the_screen_is_offered_both_formats():
    """Перечень форматов — пин: DOCX первым.

    Порядок не украшение: образцы заказчика это рабочие бланки Word, и
    выгружают их чаще, чтобы дозаполнить руками.
    """
    listed = [(item["format"], item["label"]) for item in registry.list_formats()]

    assert listed == [("docx", "DOCX (Word)"), ("pdf", "PDF")]
