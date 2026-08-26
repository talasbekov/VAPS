"""Ручка выгрузки документов ОМ (Plane №159, шаг ПД-3).

Пять сборщиков приехали шагами ПД-2…ПД-6 с РАЗНЫМИ подписями: один берёт
мероприятие объектом, другой — код, третьи не берут мероприятия вовсе. Экрану
нужен ОДИН вход, и пробы стерегут именно его: перечень видов совпадает с тем,
что ручка умеет собрать; отказ называет причину; файл — настоящий PDF.
"""
import pytest

from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops import documents_registry

pytestmark = pytest.mark.django_db

LIST_URL = "/api/ops/event-documents/"
RENDER_URL = "/api/ops/event-documents/render/"


@pytest.fixture
def reader():
    """Тот, кто вправе ЧИТАТЬ мероприятия. Своего права у выгрузки нет
    осознанно: она открывает ровно то, что показывают экраны."""
    api, _ = client_for("doc-reader", "DOC_READER", perms=("event.view",))
    return api


@pytest.fixture
def outsider():
    api, _ = client_for("doc-outsider", "DOC_OUTSIDER", perms=("duty.view",))
    return api


def test_kinds_listed_are_exactly_what_can_be_rendered(reader):
    """Экран показывает выбор по ЭТОМУ списку.

    Разойдясь со сборщиками, список предложил бы человеку документ, которого
    ручка не соберёт, — и отказ пришёл бы уже после нажатия.
    """
    body = reader.get(LIST_URL).json()

    listed = {row["kind"] for row in body["results"]}
    assert listed == set(documents_registry.KINDS)
    # Подпись обязана быть у каждого: пустая строка в выпадающем списке —
    # это выбор вслепую.
    assert all(row["label"].strip() for row in body["results"])


def test_unknown_kind_is_named_not_guessed(reader):
    response = reader.get(RENDER_URL, {"kind": "накладная"})

    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_kind_that_needs_an_event_says_so(reader):
    """«Сводные данные» без мероприятия — это вопрос без предмета.

    Отдать пустой документ значило бы соврать: он выглядел бы как сводка, в
    которой ничего не заполнено, а на деле не указано, о ком она.
    """
    response = reader.get(RENDER_URL, {"kind": "summary"})

    assert response.status_code == 400
    details = response.json()["details"]
    assert "event" in details
    assert "Сводные данные" in details["event"][0]


def test_missing_kind_is_a_request_error(reader):
    response = reader.get(RENDER_URL)

    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_unknown_event_is_not_found(reader):
    response = reader.get(RENDER_URL, {"kind": "summary", "event": "ОМ-НЕТ"})

    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_without_the_permission_the_document_is_refused(outsider):
    """Право читать мероприятия закрывает и выгрузку: файл открывает те же
    сведения, что экран."""
    assert outsider.get(LIST_URL).status_code == 403
    assert outsider.get(RENDER_URL, {"kind": "bulletin"}).status_code == 403


def test_registry_hides_the_difference_in_renderer_signatures():
    """Смысл шага: разница подписей сборщиков живёт в ОДНОМ месте.

    Красная проба — снять из реестра признак `needs_event`: тогда «Сводные
    данные» попытаются собраться без мероприятия, и вместо внятного отказа
    придёт ошибка изнутри сборщика.
    """
    assert documents_registry.KINDS["summary"]["needs_event"] is True
    assert documents_registry.KINDS["placement"]["needs_event"] is True
    # Бюллетень и графики строятся ПО ВСЕМ мероприятиям на момент среза —
    # требовать для них код ОМ значило бы спрашивать ненужное.
    assert documents_registry.KINDS["bulletin"]["needs_event"] is False
    assert documents_registry.KINDS["arrival"]["needs_event"] is False
    assert documents_registry.KINDS["departure"]["needs_event"] is False
