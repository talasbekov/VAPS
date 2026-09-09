"""Документ расстановки: посты, секторы, назначенные (Plane №156, шаг «ПД-6»).

Стережётся то, что ломается молча: строка на КАЖДЫЙ пост, назначенные —
ИМЕННО этого поста (а не все подряд), имя берётся из записи назначения, и
данные доезжают в готовый PDF.
"""
import datetime as dt
import io

import pytest

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import documents_placement as placement
from .test_ops_placement_post_removal import prepared  # noqa: F401
from .test_ops_security_events_api import (  # noqa: F401
    make_employee,
    manager,
)

pytestmark = pytest.mark.django_db


def text_of(pdf_bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def flat(text):
    return "".join(text.split())


POSTS = [
    {"id": "p1", "sector": "Периметр", "post": "Пост 1", "task": "Охрана периметра", "need": 2, "shift": "07:00–15:00"},
    {"id": "p2", "sector": "КПП", "post": "Пост 2", "task": "Пропускной режим", "need": 1, "shift": ""},
]
ASSIGNMENTS = [
    {"id": "a1", "postId": "p1", "employeeName": "Абенов С.", "callsign": "2-27"},
    {"id": "a2", "postId": "p1", "employeeName": "Жаксылыков Д.", "callsign": "2-31"},
    {"id": "a3", "postId": "p2", "employeeName": "Оспанова А.", "callsign": "7-41"},
]


def make_event(posts=None, assignments=None):
    """ОМ штатным сервисом; расчёт и назначения кладутся полями осознанно —
    предмет проверки здесь документ, а не путь проведения по этапам."""
    from organization_management.apps.ops import security_events as event_service

    event = event_service.create_event(
        title="Проба расстановки",
        object_id=None,
        business_date=dt.date(2026, 4, 25).isoformat(),
        kind="FOREIGN",
        actor="test",
    )
    event.recon_sector_posts = POSTS if posts is None else posts
    event.placement_assignments = ASSIGNMENTS if assignments is None else assignments
    event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    return event


def test_the_callsign_reaches_the_document_from_a_real_assignment(manager):  # noqa: F811
    """🔴 Plane №878: позывной доезжает до документа НАСТОЯЩИМ путём.

    Докстрока `_assigned_names` обещает «фамилиями и позывными», и код читает
    `row.get("callsign")` из строки назначения — а туда позывной не клал
    НИКТО. Ветка была мертва с рождения: соседние пробы этого файла
    (`ASSIGNMENTS`) кладут ключ РУКАМИ, то есть проверяют формат, который
    прод-данные произвести не могут. Такая проба зелена и при полностью
    неработающем поле.

    Поэтому здесь путь целиком: мероприятие доводится до «Расстановки»,
    человек с позывным ставится на пост НАСТОЯЩЕЙ ручкой `placement/assign/`,
    и позывной ищется в готовом PDF.

    Проверяются ДВА звена по отдельности, а не одно «в документе есть строка»:
    (1) строка назначения несёт позывной — иначе непонятно, где обрыв;
    (2) документ его печатает. Одного второго хватило бы для зелени, но при
    падении он не сказал бы, чья это половина.

    Позывной снимается В МОМЕНТ расстановки — тем же правилом, что имя
    (`employeeName`): в документе должно остаться то, что было записано, даже
    если человека потом переименовали или позывной сменили.
    """
    base, data = prepared(manager)
    post = data["reconSectorPosts"][0]
    employee = make_employee(last_name="Беркутов")
    employee.callsign = "2-27"
    employee.save(update_fields=["callsign"])

    assigned = manager.post(
        f"{base}placement/assign/",
        {"postId": post["id"], "employeeId": str(employee.pk)},
        format="json",
    )
    assert assigned.status_code == 200, assigned.json()

    from organization_management.apps.operations.models_event import OpsSecurityEvent

    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    row = next(
        r for r in event.placement_assignments if str(r.get("postId")) == str(post["id"])
    )
    assert row.get("callsign") == "2-27", (
        "строка назначения не несёт позывной — документ читает ключ, "
        f"которого никто не кладёт: {row}"
    )

    printed = flat(text_of(placement.render_placement(event.code)))
    assert "2-27" in printed, "позывной не доехал до документа расстановки"


def test_there_is_a_row_for_every_post():
    rows = placement.placement_rows(make_event())

    assert [row["post"] for row in rows] == ["Пост 1", "Пост 2"]
    assert [row["sector"] for row in rows] == ["Периметр", "КПП"]


def test_assigned_people_belong_to_their_own_post():
    """Назначенные — ИМЕННО этого поста: общий список во всех строках означал
    бы документ, по которому людей развели бы не туда."""
    rows = placement.placement_rows(make_event())

    assert rows[0]["assigned"] == "Абенов С. 2-27\nЖаксылыков Д. 2-31"
    assert rows[1]["assigned"] == "Оспанова А. 7-41"


def test_the_name_comes_from_the_assignment_and_not_from_personnel():
    """Имя берётся из записи назначения: оно верно НА МОМЕНТ расстановки, и
    документ обязан остаться таким же, если человека потом переименуют."""
    event = make_event(
        assignments=[{"id": "a1", "postId": "p1", "employeeName": "Как было записано", "callsign": ""}]
    )

    assert placement.placement_rows(event)[0]["assigned"] == "Как было записано"


def test_an_empty_post_shows_no_one_and_does_not_guess():
    """Пост без назначенных — пустая ячейка: «уточняется» это решение
    человека, а не вывод документа."""
    event = make_event(assignments=[])

    assert placement.placement_rows(event)[0]["assigned"] == ""


def test_a_post_without_a_shift_leaves_the_cell_empty():
    """Смена появилась у поста позже (Plane №123); у заведённых раньше ОМ её
    нет — и выдуманная «дневная» была бы ложью в документе развода."""
    rows = placement.placement_rows(make_event())

    assert rows[1]["shift"] == ""


def test_an_unknown_event_is_a_loud_refusal():
    with pytest.raises(DomainError) as error:
        placement.render_placement("ОМ-НЕТ-ТАКОГО")

    assert error.value.code == "ENTITY_NOT_FOUND"


def test_the_pdf_carries_the_event_the_moment_and_every_post():
    event = make_event()

    text = text_of(placement.render_placement(event.code, dt.datetime(2026, 4, 20, 8, 0)))

    assert event.code in flat(text)
    assert "08:00" in text and "20.04.2026" in text
    assert "Периметр" in flat(text) and "КПП" in flat(text)
    assert "АбеновС.2-27" in flat(text)
    assert "ОспановаА.7-41" in flat(text)
    assert "{{" not in text


# ── Водяной знак «ПРОЕКТ» (Plane №638, №637) ────────────────────────────────


def test_an_event_without_visit_objects_loses_the_draft_stamp_once_approved():
    """Согласованный ОМ БЕЗ объектов посещения печатается чистым (Plane №638).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `_is_draft(None)` возвращал True безусловно, и такой
    документ штамповался «ПРОЕКТ» НАВСЕГДА — даже после согласования. При этом
    экран предупреждение о черновике прятал: `ApprovalStage` читает
    `view.status`, который при пустом объекте падает на `event.approvalStatus`.
    Экран обещал чистый документ, сервер отдавал черновик, и спорить с бумагой
    человеку было нечем.

    Мероприятия без объектов посещения `_document_target` поддерживает
    НАМЕРЕННО — у них расчёт лежит в самом мероприятии, — поэтому «нет объекта»
    не повод считать документ вечным проектом.

    Мутация, на которой проба обязана краснеть: вернуть `if visit is None:
    return True` — знак останется на согласованном документе.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    event = make_event()
    assert not event.visit_objects.exists(), "предусловие: объектов посещения нет"

    # До согласования знак ЕСТЬ — иначе проба доказывала бы только его отсутствие.
    draft = text_of(placement.render_placement(event.code, dt.datetime(2026, 4, 20, 8, 0)))
    assert "ПРОЕКТ" in flat(draft)

    OpsSecurityEvent.objects.filter(pk=event.pk).update(approval_status="APPROVED")

    approved = text_of(
        placement.render_placement(event.code, dt.datetime(2026, 4, 20, 8, 0))
    )
    assert "ПРОЕКТ" not in flat(approved), "согласованный документ всё ещё проект"
    # И это тот же документ, а не пустой: знак снят, содержимое на месте.
    assert event.code in flat(approved)
    assert "АбеновС.2-27" in flat(approved)


def test_a_missing_watermark_font_is_a_named_refusal_not_a_traceback(monkeypatch):
    """Нет шрифта — понятный отказ, а не голый 500 (Plane №637).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Путь к DejaVu был зашит одной абсолютной строкой и не
    проверялся: на хосте без `fonts-dejavu` (в том числе в образе САМОГО
    репозитория — там шрифты не ставились ничем) reportlab поднимал `TTFError`,
    и каждый досогласовательный PDF расстановки отвечал трассировкой. Соседняя
    системная зависимость того же модуля стережётся правильно —
    `shutil.which("soffice")` → `PDF_CONVERTER_MISSING`; здесь правило
    пропустили.

    Мутация, на которой проба обязана краснеть: снять проверку существования —
    вместо `DomainError` полетит `TTFError`.
    """
    from reportlab.pdfbase import pdfmetrics

    from organization_management.apps.ops import documents

    # Шрифт мог быть зарегистрирован соседней пробой в том же процессе —
    # снимаем регистрацию, иначе ветка проверки недостижима.
    pdfmetrics._fonts.pop("DejaVuSans", None)
    monkeypatch.setattr(documents, "_DEJAVU_CANDIDATES", ("/нет/такого/шрифта.ttf",))

    with pytest.raises(DomainError) as failure:
        documents.stamp_draft(b"%PDF-1.4\n")

    assert failure.value.code == "WATERMARK_FONT_MISSING"
    assert failure.value.http_status == 500
