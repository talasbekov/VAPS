"""Saved snapshot exports. Plain text inserted through python-docx's XML API."""
import json
from io import BytesIO

from docx import Document

from organization_management.apps.ops.resource_calculation_rules import summary

POSITIONS = {"RIGHT": "Справа", "LEFT": "Слева", "FRONT": "Впереди", "OBJECT": "На объекте"}
CATEGORIES = {"PASSENGER": "Легковая", "ARMORED": "Бронированная", "OTHER": "Другая"}


def snapshot_payload(calculation):
    return {"eventId": str(calculation.event_id), "version": calculation.version, "ownerDivisionId": calculation.owner_division_id, "ownerDivisionName": calculation.owner_division.name, "snapshot": calculation.snapshot, "updatedAt": calculation.updated_at.isoformat(), "document": calculation.document}


def json_document(calculation):
    return json.dumps(snapshot_payload(calculation), ensure_ascii=False, indent=2).encode("utf-8")


def docx_document(calculation):
    word = Document()
    snapshot, doc = calculation.snapshot, calculation.document
    word.add_heading("Расчёт сил и средств", 0)
    word.add_paragraph(snapshot["title"])
    word.add_paragraph(f"Период: {snapshot['dateFrom']} — {snapshot['dateTo'] or 'дата окончания не указана'}")
    word.add_paragraph(f"Версия {calculation.version}. Сохранено: {calculation.updated_at.isoformat()}")
    word.add_paragraph(f"Подразделение: {calculation.owner_division.name}")
    segments = {s["id"]: s for s in doc["segments"]}
    groups = {g["id"]: g for g in doc["groups"]}
    route_counts = {}
    for route in doc["routes"]:
        for row in route["rows"]: route_counts[row["segmentId"]] = route_counts.get(row["segmentId"], 0) + 1
    for route in doc["routes"]:
        word.add_heading(route["name"], 1)
        word.add_paragraph(f"{route['start']} — {route['end']}; {route['date']} {route['time']}")
        table = word.add_table(rows=1, cols=6)
        table.style = "Table Grid"
        for cell, text in zip(table.rows[0].cells, ("Участок", "Направление", "Положение", "Группа / организация", "Техника", "Примечание")): cell.text = text
        for row in route["rows"]:
            segment = segments[row["segmentId"]]
            group = groups[doc["assignments"][segment["id"]]]
            start, end = (segment["pointB"], segment["pointA"]) if row["reversed"] else (segment["pointA"], segment["pointB"])
            shared = f"; общий: {route_counts[segment['id']]} маршрута" if route_counts[segment["id"]] > 1 else ""
            values = (f"{segment['name']} ({segment['type']}) {segment['tags']}{shared}", f"{start} → {end}", POSITIONS[row["position"]], f"{group['callsign']} / {group['organization']}", f"{group['vehicle']} ({CATEGORIES[group['vehicleType']]})", row["note"])
            for cell, text in zip(table.add_row().cells, values): cell.text = text
    totals = summary(doc)
    word.add_heading("Общий свод", 1)
    word.add_paragraph(f"Уникальных групп / единиц техники: {totals['groupCount']}. Одна группа — одна единица техники.")
    table = word.add_table(rows=1, cols=5)
    table.style = "Table Grid"
    for cell, text in zip(table.rows[0].cells, ("Организация", "Группы", "Легковая", "Бронированная", "Другая")): cell.text = text
    for item in totals["organizations"]:
        values = [item["organization"], item["groupCount"], *[item["vehicles"][c] for c in CATEGORIES]]
        for cell, text in zip(table.add_row().cells, values): cell.text = str(text)
    values = ["Итого", totals["groupCount"], *[totals["vehicles"][c] for c in CATEGORIES]]
    for cell, text in zip(table.add_row().cells, values): cell.text = str(text)
    word.add_heading("Техника по организациям", 2)
    vehicles = {}
    selected = set(doc["assignments"].values())
    for group in doc["groups"]:
        if group["id"] in selected:
            key = (group["organization"], group["vehicle"], group["vehicleType"])
            vehicles[key] = vehicles.get(key, 0) + 1
    vehicle_table = word.add_table(rows=1, cols=4)
    vehicle_table.style = "Table Grid"
    for cell, text in zip(vehicle_table.rows[0].cells, ("Организация", "Название техники", "Категория", "Количество")): cell.text = text
    for (organization, vehicle, category), count in sorted(vehicles.items()):
        for cell, text in zip(vehicle_table.add_row().cells, (organization, vehicle, CATEGORIES[category], str(count))): cell.text = text
    stream = BytesIO()
    word.save(stream)
    return stream.getvalue()
