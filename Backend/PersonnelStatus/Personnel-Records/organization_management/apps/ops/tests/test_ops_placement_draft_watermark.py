"""«Скачать PDF» всегда, до согласования — водяной знак «Проект» (`[СОГ-03]`, Plane №430).

Проба стережёт обе половины: пока объект не согласован, в PDF есть слово
«ПРОЕКТ»; после последней подписи — нет. DOCX знака не несёт: его дозаполняют
руками. Мутация «всегда проект» краснит вторую половину, «никогда» — первую.
"""
import base64
import io

import pytest

from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    _add_approver,
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db

RENDER = "/api/ops/event-documents/render/"


def text_of(pdf_bytes):
    from pypdf import PdfReader

    return "".join(
        (page.extract_text() or "") for page in PdfReader(io.BytesIO(pdf_bytes)).pages
    )


def _pdf(manager, event_code, visit, fmt="pdf"):  # noqa: F811
    resp = manager.get(
        RENDER,
        {"kind": "placement", "event": event_code, "ext": fmt, "visitObject": str(visit.pk)},
    )
    assert resp.status_code == 200, resp.content
    return base64.b64decode(resp.json()["contentBase64"])


def test_the_pdf_is_a_draft_until_the_object_is_approved(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, event_id, first, _second, _ = two_objects_on_approval
    code = manager.get(base).json()["code"]

    # До отправки и во время согласования — проект.
    assert "ПРОЕКТ" in text_of(_pdf(manager, code, first))
    assert b"PK" == _pdf(manager, code, first, fmt="docx")[:2]  # DOCX — без знака, это zip

    row = _add_approver(manager, base, first)
    approver_id = row["visitObjects"][0]["approvalRoute"][0]["id"] if row.get("visitObjects") else None
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    assert sent.status_code == 200, sent.content
    if approver_id is None:
        approver_id = next(
            v for v in sent.json()["visitObjects"] if v["id"] == str(first.pk)
        )["approvalRoute"][0]["id"]
    assert "ПРОЕКТ" in text_of(_pdf(manager, code, first))

    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert decided.status_code == 200, decided.content
    first.refresh_from_db()
    assert first.approval_status == "APPROVED"
    assert "ПРОЕКТ" not in text_of(_pdf(manager, code, first))
