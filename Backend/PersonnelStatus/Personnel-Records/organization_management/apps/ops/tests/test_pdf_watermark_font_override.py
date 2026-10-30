"""An isolated Windows runtime may provide the Cyrillic watermark font explicitly."""
import io
from pathlib import Path

import reportlab
from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from organization_management.apps.ops import documents


def test_watermark_uses_configured_font_without_requiring_linux_font_directories(monkeypatch):
    fonts = dict(pdfmetrics._fonts)
    fonts.pop("DejaVuSans", None)
    monkeypatch.setattr(pdfmetrics, "_fonts", fonts)
    monkeypatch.setattr(documents, "_DEJAVU_CANDIDATES", ())
    # reportlab's own fixture font keeps this test independent of host packages.
    font = Path(reportlab.__file__).parent / "fonts" / "Vera.ttf"
    assert font.is_file()
    monkeypatch.setenv("OPS_WATERMARK_FONT_PATH", str(font))
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer)
    page.drawString(10, 10, "Fixture")
    page.save()

    stamped = documents.stamp_draft(buffer.getvalue(), label="TEST")

    assert "TEST" in PdfReader(io.BytesIO(stamped)).pages[0].extract_text()
