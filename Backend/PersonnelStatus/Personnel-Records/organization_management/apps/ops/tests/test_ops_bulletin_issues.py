"""Бюллетень — выпуск с датой и временем среза, хранимый документ (Plane №420).

`[МД-01]`: «выпуск: дата + время среза („на 08:00 ч. 22.04.2026“)».
`[БЛН-04]`: «пользователь выбирает дату/время среза → все мероприятия с датой
≥ среза → PDF». До этой задачи срез был «сейчас», выбрать его было негде, а
собранный документ нигде не оставался.

Пробы стерегут:
1. срез из параметра `asOf` меняет ОТБОР и ЗАГОЛОВОК документа на лету;
2. выпуск замораживает строки и байты — новое ОМ после выпуска в него не
   попадает, а свежая сборка на тот же срез его видит;
3. выпуск отдаёт файл тем же конвертом, что и выгрузка; без среза — 400.
"""
import base64
import datetime as dt
import io

import pytest

from organization_management.apps.ops.tests.test_ops_documents_bulletin import (
    make_event as _make_event,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    manager,
)

pytestmark = pytest.mark.django_db

ISSUES = "/api/ops/bulletin-issues/"
RENDER = "/api/ops/event-documents/render/"


def text_of(pdf_bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "".join((page.extract_text() or "") for page in reader.pages)


def make_event(title, business_date):
    """Штатным сервисом, как и проба документа: ORM обходит инварианты модели."""
    return _make_event(title, business_date)


def test_the_slice_parameter_drives_selection_and_heading(manager):  # noqa: F811
    make_event("Раннее мероприятие", dt.date(2026, 9, 10))
    make_event("Позднее мероприятие", dt.date(2026, 9, 20))

    resp = manager.get(RENDER, {"kind": "bulletin", "ext": "pdf", "asOf": "2026-09-15T08:00"})
    assert resp.status_code == 200, resp.content
    text = "".join(text_of(base64.b64decode(resp.json()["contentBase64"])).split())
    assert "08:00ч.15.09.2026" in text
    assert "Позднеемероприятие" in text
    assert "Раннеемероприятие" not in text

    bad = manager.get(RENDER, {"kind": "bulletin", "asOf": "вчера"})
    assert bad.status_code == 400, bad.content


def test_an_issue_freezes_rows_and_bytes(manager):  # noqa: F811
    make_event("Первое", dt.date(2026, 9, 20))
    issued = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")
    assert issued.status_code == 201, issued.content
    issue = issued.json()
    assert issue["eventCount"] == 1
    assert issue["asOf"].startswith("2026-09-15T08:00")
    assert issue["issuedBy"] != ""

    # Новое ОМ после выпуска: свежая сборка его видит, выпуск — нет.
    make_event("Второе", dt.date(2026, 9, 21))
    fresh = manager.get(RENDER, {"kind": "bulletin", "asOf": "2026-09-15T08:00"})
    assert "Второе" in "".join(text_of(base64.b64decode(fresh.json()["contentBase64"])).split())

    stored = manager.get(f"{ISSUES}{issue['id']}/file/")
    assert stored.status_code == 200, stored.content
    assert stored.json()["fileName"] == issue["fileName"]
    frozen = "".join(text_of(base64.b64decode(stored.json()["contentBase64"])).split())
    assert "Первое" in frozen
    assert "Второе" not in frozen

    listed = manager.get(ISSUES)
    assert [row["id"] for row in listed.json()["results"]] == [issue["id"]]


def test_an_issue_requires_a_slice(manager):  # noqa: F811
    resp = manager.post(ISSUES, {}, format="json")
    assert resp.status_code == 400, resp.content
    assert "asOf" in resp.json().get("details", resp.json().get("detail", {})) or resp.status_code == 400
