"""Юнит-тесты нормализатора word/document.xml (golden-master 6.8).

Нормализатор детерминирован и идемпотентен, вырезает волатильные `w:rsid*`
и канонизирует C14N — база для golden-сравнения XML (не байтов .docx).
Тесты БЕЗ БД (нет django_db) → бегут в `make gate`.
"""

import io
import zipfile

from lxml import etree

from apps.documents.generators.docx_normalize import normalize_document_xml

_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
_DOC_WITH_RSID = (
    f"<w:document {_NS}>"
    "<w:body>"
    '<w:p w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD">'
    "<w:r><w:t>Расход</w:t></w:r>"
    "</w:p>"
    '<w:sectPr w:rsidR="00FFFFFF"/>'
    "</w:body>"
    "</w:document>"
)


def _docx_bytes(document_xml: str) -> bytes:
    """Собрать минимальный .docx-zip с заданным word/document.xml."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", document_xml)
    return buf.getvalue()


def test_strips_all_rsid_attributes():
    out = normalize_document_xml(_docx_bytes(_DOC_WITH_RSID))
    assert b"w:rsid" not in out
    # содержимое сохранено
    assert "Расход".encode() in out


def test_deterministic_two_runs_identical():
    docx = _docx_bytes(_DOC_WITH_RSID)
    assert normalize_document_xml(docx) == normalize_document_xml(docx)


def test_canonicalization_is_idempotent():
    out = normalize_document_xml(_docx_bytes(_DOC_WITH_RSID))
    again = etree.canonicalize(xml_data=out.decode("utf-8")).encode("utf-8")
    assert again == out


def test_two_docx_differing_only_by_rsid_normalize_equal():
    a = _DOC_WITH_RSID
    b = _DOC_WITH_RSID.replace("00AB12CD", "00990099").replace("00FFFFFF", "00111111")
    assert normalize_document_xml(_docx_bytes(a)) == normalize_document_xml(
        _docx_bytes(b)
    )
