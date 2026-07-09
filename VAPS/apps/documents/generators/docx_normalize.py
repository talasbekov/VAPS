"""Нормализация ``word/document.xml`` из .docx для golden-сравнения расхода.

Golden-master сравнивает НЕ байты .docx (zip-mtime и ``docProps/core.xml`` с
timestamps волатильны), а извлечённый ``word/document.xml`` с вырезанными
``w:rsid*`` и канонизированный C14N. Детерминировано и идемпотентно; без
wall-clock/ORM.
"""

import io
import re
import zipfile

from lxml import etree

# Волатильные revision-save-id: ``w:rsidR="00AB12CD"`` и т.п. (сегодня ровно 3
# статических в <w:sectPr> шаблона; вырезаем на случай патча/refresh шаблона).
_RSID_RE = re.compile(rb'\s+w:rsid\w+="[0-9A-Fa-f]+"')


def normalize_document_xml(docx_bytes: bytes) -> bytes:
    """Извлечь ``word/document.xml``, вырезать ``w:rsid*``, C14N-канонизировать.

    Возвращает канонический UTF-8 XML, побайтово стабильный между прогонами
    ``generate_expense_docx`` на одном входе.
    """
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zf:
        xml = zf.read("word/document.xml")
    xml = _RSID_RE.sub(b"", xml)
    return etree.canonicalize(xml_data=xml.decode("utf-8")).encode("utf-8")
