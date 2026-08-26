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
