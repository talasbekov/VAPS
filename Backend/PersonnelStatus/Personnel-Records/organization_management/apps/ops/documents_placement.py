"""Документ расстановки: посты, секторы, назначенные (Plane №156, шаг «ПД-6»).

🔴 ДОПУЩЕНИЕ, О КОТОРОМ НАДО ЗНАТЬ ДО ЧТЕНИЯ КОДА. У остальных документов
цепочки шаблон снят С ОБРАЗЦА заказчика, и они выглядят «в точности как ворд».
С расстановкой так не вышло, и вот почему:

* `Расстановка Алем Ай 25 ОБРАЗЕЦ.doc` — ФАЙЛ БИТЫЙ: заголовок OLE на месте,
  но потока `WordDocument` внутри НЕТ, и ни LibreOffice, ни Word его не
  откроют (соседний `.doc` из той же папки конвертируется, то есть дело в
  файле, а не в формате);
* `Общая расстановка РЭС.DOCX` — рукодельная вёрстка ПОД КОНКРЕТНОЕ
  мероприятие: 14 таблиц разной формы (6 и 4 колонки), без строк-заголовков,
  на казахском, с грифом и подписями руководства. Это не бланк, который
  заполняют данными, а документ, который каждый раз собирают заново.

Поэтому таблица здесь собрана ПО ПОЛЯМ ШАГА («посты, секторы, назначенные»), а
ВЁРСТКА — рамки, заливка заголовка, шрифты — взята у бюллетеня, то есть у
образца заказчика. Как только придёт годный образец расстановки, шаблон
меняется на него, а код остаётся: он отдаёт строки, а не рисует.

Данные — из расчёта постов рекогносцировки и назначений расстановки самого
мероприятия: второй источник тех же сведений разошёлся бы с доской подбора.
"""
import datetime as dt
import os

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.document_tables import fill_table_rows
from organization_management.apps.ops.documents import emit, fill_template

TEMPLATE = os.path.join(
    os.path.dirname(__file__), "document_templates", "placement.docx"
)


def _assigned_names(event, post_id):
    """Кто стоит на посту — фамилиями и позывными, столбиком.

    Имена берутся из САМОГО назначения (`placement_assignments`), а не из
    кадров по идентификатору: в назначении лежит имя на момент расстановки, и
    оно должно остаться таким же в документе, даже если человека потом
    переименовали или уволили.
    """
    names = []
    for row in event.placement_assignments or []:
        if str(row.get("postId")) != str(post_id):
            continue
        name = str(row.get("employeeName") or "").strip()
        callsign = str(row.get("callsign") or "").strip()
        names.append(" ".join(part for part in (name, callsign) if part) or "—")
    return "\n".join(names)


def placement_rows(event):
    """Строки документа: по одной на пост расчёта, в порядке секторов."""
    posts = event.recon_sector_posts or []
    rows = []
    for post in posts:
        post_id = post.get("id")
        rows.append(
            {
                "sector": str(post.get("sector") or ""),
                "post": str(post.get("post") or post.get("name") or ""),
                "task": str(post.get("task") or ""),
                # Смена у поста появилась шагом Plane №123; у ОМ, заведённых
                # раньше, её нет — и пустая ячейка честнее выдуманной «дневной».
                "shift": str(post.get("shift") or ""),
                "need": post.get("need") if post.get("need") is not None else "",
                "assigned": _assigned_names(event, post_id),
            }
        )
    return rows


def render_placement(event_code, as_of=None, fmt="pdf"):
    """Байты расстановки мероприятия по его коду; `fmt` — «docx» либо «pdf»."""
    from docx import Document

    event = OpsSecurityEvent.objects.filter(code=event_code).first()
    if event is None:
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"code": [str(event_code)]},
            message="Мероприятие не найдено.",
        )
    moment = as_of or Clock.now()
    if isinstance(moment, dt.date) and not isinstance(moment, dt.datetime):
        moment = dt.datetime.combine(moment, dt.time(8, 0))
    values = {
        "event": f"{event.code} — {event.title}",
        "as_of": (
            f"{moment.strftime('%H:%M')} ч. "
            f"{moment.day:02d}.{moment.month:02d}.{moment.year} года"
        ),
    }
    filled_path, _left = fill_template(TEMPLATE, values)
    try:
        document = Document(filled_path)
        fill_table_rows(document.tables[0], placement_rows(event))
        document.save(filled_path)
        return emit(filled_path, fmt)
    finally:
        try:
            os.unlink(filled_path)
        except OSError:
            pass
