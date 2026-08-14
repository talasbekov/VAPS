from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors

from organization_management.apps.reports.infrastructure import report_table


class PDFGenerator:
    """
    Простейший PDF‑генератор: заголовок + таблица с агрегатами.
    Возвращает (filename, bytes).
    """

    def generate(self, data, report):
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4)
        styles = getSampleStyleSheet()
        story = []

        story.append(Paragraph(report.get_report_type_display(), styles["Heading1"]))
        story.append(Paragraph(f"Раздел: {data.get('division')}", styles["Normal"]))
        story.append(Paragraph(f"Дата: {data.get('date')}", styles["Normal"]))
        story.append(Spacer(1, 12))

        table_data = [report_table.headers(data)]
        for row in data.get("rows", []):
            table_data.append([str(value) for value in report_table.cells(data, row)])

        table = Table(table_data, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ]))
        story.append(table)

        doc.build(story)
        filename = f"report_{report.id}.pdf"
        return filename, buffer.getvalue()
