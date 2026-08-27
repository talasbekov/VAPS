"""Документ «Список броней в ГОН» (Plane №216).

Восьмой из девяти образцов задачи №156. До реестра транспорта собрать его было
НЕ ИЗ ЧЕГО: автопарка в системе не существовало вовсе, а ближайшее — строки
«Выделяемый транспорт» сводки ГВО — свободный текст без ГРНЗ и класса брони.
Реестр заведён отдельной задачей (№215), и документ строится ПО НЕМУ.

СРЕЗ СИСТЕМЫ, а не бланк под ручное заполнение: правило раздела требует, чтобы
документ показывал то, что в системе есть на момент среза. Поэтому строки —
это действующие машины реестра, а не пустые клетки.

СНЯТЫЕ МАШИНЫ В ДОКУМЕНТ НЕ ИДУТ. Список отвечает на вопрос «что есть в
парке», и машина, снятая с эксплуатации, ответом на него не является: она
живёт в системе ради истории мероприятий, где уже названа.

ОТБОР ПО КЛАССУ БРОНИ — необязательный: документ называется «Список броней»,
и весь парк в нём законен, но выгрузить один класс тоже нужно (в образце
список идёт целиком).
"""
import datetime as dt
import os

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_vehicle import OpsVehicle
from organization_management.apps.ops.document_tables import fill_table_rows
from organization_management.apps.ops.documents import emit, fill_template

TEMPLATES = os.path.join(os.path.dirname(__file__), "document_templates")
VEHICLES_TEMPLATE = os.path.join(TEMPLATES, "vehicles_armored.docx")


def vehicle_rows(armor_class=None):
    """Строки документа: действующие машины парка, по одной на строку.

    Порядок — марка, затем номер: тот же, что у модели и у экрана. Читатель
    документа и читатель экрана обязаны видеть один и тот же список, иначе
    сверять их придётся глазами.
    """
    query = OpsVehicle.objects.filter(is_active=True)
    if armor_class:
        query = query.filter(armor_class__iexact=str(armor_class).strip())
    rows = []
    for car in query:
        rows.append(
            {
                "no": len(rows) + 1,
                "brand": car.brand,
                "body_class": car.body_class,
                # Год пустой, а не «0»: в образце он стоит не у каждой
                # машины, и ноль читался бы как год выпуска.
                "production_year": "" if car.production_year is None else str(car.production_year),
                "plate": car.plate,
                "armor_class": car.armor_class,
                "deployment": car.deployment,
                "note": car.note,
            }
        )
    return rows


def render_vehicles(as_of=None, fmt="pdf", armor_class=None):
    """Байты документа «Список броней в ГОН»."""
    from docx import Document

    moment = as_of or Clock.now()
    if isinstance(moment, dt.date) and not isinstance(moment, dt.datetime):
        moment = dt.datetime.combine(moment, dt.time(8, 0))
    rows = vehicle_rows(armor_class)
    values = {"as_of_date": f"{moment.day:02d}.{moment.month:02d}.{moment.year}"}
    filled_path, _left = fill_template(VEHICLES_TEMPLATE, values)
    try:
        document = Document(filled_path)
        fill_table_rows(document.tables[0], rows)
        document.save(filled_path)
        return emit(filled_path, fmt)
    finally:
        try:
            os.unlink(filled_path)
        except OSError:
            pass
