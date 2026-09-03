"""Реестр видов документов ОМ (Plane №159, шаг ПД-3).

ЗАЧЕМ. Пять сборщиков приехали шагами ПД-2…ПД-6 и, что естественно для
параллельной работы, получились с РАЗНЫМИ подписями: один берёт мероприятие
объектом, другой — его код, третьи не берут мероприятия вовсе (бюллетень и
графики строятся по всем ОМ на момент среза). Экрану и ручке нужен ОДИН вход,
иначе выбор вида документа превратился бы в цепочку условий на клиенте — а
клиент не должен знать, у какого документа какая подпись.

Реестр — единственное место, где эта разница описана. Добавился документ —
строка здесь, и он появился и в ручке, и на экране.

ЧЕГО ЗДЕСЬ НЕТ. Прав: их проверяет ручка. Реестр отвечает на вопрос «какие
документы бывают и чем собираются», а не «кому их видно».
"""
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops.documents import CONTENT_TYPES, FORMATS

#: Виды документов. `needs_event` — не украшение: бюллетень и графики строятся
#: ПО ВСЕМ мероприятиям на момент среза, и требовать для них код ОМ значило бы
#: спрашивать то, что документу не нужно. А «Сводные данные» и «Расстановка»
#: без мероприятия бессмысленны — их отказ должен быть внятным, а не пустым
#: документом.
KINDS = {
    "summary": {
        "label": "Сводные данные",
        "needs_event": True,
        "file": "svodnye-dannye",
    },
    "bulletin": {
        "label": "Информационный бюллетень",
        "needs_event": False,
        "file": "byulleten",
    },
    "arrival": {
        "label": "График прибытия",
        "needs_event": False,
        "file": "grafik-pribytiya",
    },
    "departure": {
        "label": "График убытия",
        "needs_event": False,
        "file": "grafik-ubytiya",
    },
    "placement": {
        "label": "Расстановка",
        "needs_event": True,
        "file": "rasstanovka",
    },
    # Бланк заказчика целиком — вёрстка «Общей расстановки РЭС» без грифа и
    # личных данных (Plane №164). Стоит РЯДОМ с «Расстановкой», а не вместо
    # неё: та — срез системы по постам расчёта, этот — форма заказчика, в
    # которой у системы есть только даты. Подменить одно другим значило бы
    # отобрать у человека тот вид, который ему нужен сейчас.
    "placement_full": {
        "label": "Общая расстановка (бланк)",
        "needs_event": True,
        "file": "obshchaya-rasstanovka",
    },
    # «Список броней в ГОН» — про ПАРК, а не про мероприятие (Plane №216):
    # в образце это перечень машин автохозяйства, и требовать для него код ОМ
    # значило бы спрашивать то, чего документу не нужно.
    "vehicles": {
        "label": "Список броней в ГОН",
        "needs_event": False,
        "file": "spisok-broney",
    },
}


def list_formats():
    """Форматы для экрана. Порядок не случаен: DOCX первым, потому что
    образцы заказчика — рабочие бланки Word, и выгружают их чаще, чтобы
    дозаполнить руками."""
    return [
        {"format": "docx", "label": "DOCX (Word)"},
        {"format": "pdf", "label": "PDF"},
    ]


def content_type(fmt):
    return CONTENT_TYPES[fmt]


def list_kinds():
    """Перечень для экрана: код, подпись и нужно ли мероприятие.

    Экран показывает выбор по ЭТОМУ списку, а не по своему: разойдясь, они
    предложили бы человеку документ, которого ручка не соберёт.
    """
    return [
        {
            "kind": kind,
            "label": meta["label"],
            "needsEvent": meta["needs_event"],
        }
        for kind, meta in KINDS.items()
    ]


def render(kind, *, event_code=None, as_of=None, fmt="pdf", visit_object_id=None):
    """Собрать документ выбранного вида. Возвращает пару (байты, имя файла).

    Разница в подписях сборщиков спрятана ЗДЕСЬ и только здесь.

    `fmt` — «docx» либо «pdf». По умолчанию PDF: так вели себя все читатели
    до появления выбора, и менять умолчание молча значило бы отдать им другой
    файл под тем же вызовом.
    """
    if fmt not in FORMATS:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"format": ["Формат бывает: " + ", ".join(FORMATS)]},
            message="Проверьте заполнение формы.",
        )
    meta = KINDS.get(kind)
    if meta is None:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"kind": [
                "Неизвестный вид документа: " + ", ".join(sorted(KINDS))
            ]},
            message="Проверьте заполнение формы.",
        )
    code = (event_code or "").strip()
    if meta["needs_event"] and not code:
        # Отказ называет ПРИЧИНУ: «Сводные данные» без мероприятия — это не
        # пустой документ, а вопрос без предмета.
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"event": [
                f"Документ «{meta['label']}» строится по мероприятию — укажите его код."
            ]},
            message="Проверьте заполнение формы.",
        )

    if kind == "summary":
        from organization_management.apps.operations.models_event import (
            OpsSecurityEvent,
        )
        from organization_management.apps.ops.documents_summary import (
            render_summary_pdf,
        )

        event = OpsSecurityEvent.objects.filter(code=code).first()
        if event is None:
            raise DomainError(
                "ENTITY_NOT_FOUND", 404, detail={"id": code},
                message="Запись не найдена.",
            )
        payload = render_summary_pdf(event, fmt=fmt)
    elif kind == "placement":
        from organization_management.apps.ops.documents_placement import (
            render_placement,
        )

        # Документ «Расстановка сил» принадлежит ОБЪЕКТУ посещения (Plane
        # №411): у ОМ с несколькими объектами сборщик просит выбрать, а не
        # склеивает посты разных мест в одну таблицу.
        payload = render_placement(
            code, as_of=as_of, fmt=fmt, visit_object_id=visit_object_id
        )
    elif kind == "placement_full":
        from organization_management.apps.ops.documents_placement_full import (
            render_placement_full,
        )

        payload = render_placement_full(code, as_of=as_of, fmt=fmt)
    elif kind == "vehicles":
        from organization_management.apps.ops.documents_vehicles import (
            render_vehicles,
        )

        payload = render_vehicles(as_of=as_of, fmt=fmt)
    elif kind == "bulletin":
        from organization_management.apps.ops.documents_bulletin import (
            render_bulletin,
        )

        payload = render_bulletin(as_of=as_of, fmt=fmt)
    else:
        from organization_management.apps.ops.documents_schedules import (
            render_schedule,
        )

        payload = render_schedule(kind, as_of=as_of, fmt=fmt)

    name = meta["file"] + (f"-{code}" if code else "") + "." + fmt
    return payload, name
