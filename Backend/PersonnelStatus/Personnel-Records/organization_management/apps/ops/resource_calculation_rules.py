"""Pure validation, completeness and distinct-resource summaries."""
import copy
import json
import re
from datetime import date
from uuid import UUID


class InvalidDocument(ValueError):
    pass


def empty_document():
    return {"schemaVersion": 1, "groups": [], "segments": [], "routes": [], "assignments": {}}


def _check(condition, message):
    if not condition:
        raise InvalidDocument(message)


def _object(value, keys):
    _check(isinstance(value, dict) and set(value) == set(keys), "Неверный набор полей документа.")


def _text(value, limit=200):
    _check(isinstance(value, str) and len(value) <= limit, f"Текст должен содержать не более {limit} символов.")
    _check(all(ord(c) >= 32 or c in "\n\r\t" for c in value) and not any(0xD800 <= ord(c) <= 0xDFFF or ord(c) in (0xFFFE, 0xFFFF) for c in value), "Текст содержит недопустимые символы.")


def _id(value):
    _check(isinstance(value, str), "ID должен быть UUID.")
    try:
        _check(str(UUID(value)) == value.lower(), "ID должен быть UUID стандартного формата.")
    except (ValueError, AttributeError):
        raise InvalidDocument("ID должен быть UUID.")
    return value.lower()


def validate_document(value, date_from, date_to):
    _object(value, ("schemaVersion", "groups", "segments", "routes", "assignments"))
    try:
        _check(len(json.dumps(value, ensure_ascii=False).encode("utf-8")) <= 1024 * 1024, "Документ превышает 1 МБ.")
    except (TypeError, UnicodeError, ValueError):
        raise InvalidDocument("Некорректный JSON.")
    _check(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1, "Неподдерживаемая версия документа.")
    doc = copy.deepcopy(value)
    for collection, limit in (("groups", 200), ("segments", 500), ("routes", 50)):
        _check(isinstance(doc[collection], list) and len(doc[collection]) <= limit, f"Превышен размер коллекции {collection}.")
    ids = set()
    for collection, fields in (("groups", ("id", "organization", "callsign", "vehicle", "vehicleType")), ("segments", ("id", "name", "type", "tags", "pointA", "pointB")), ("routes", ("id", "name", "start", "end", "date", "time", "rows"))):
        names = set()
        for item in doc[collection]:
            _object(item, fields)
            item["id"] = _id(item["id"])
            _check(item["id"] not in ids, "Идентификаторы должны быть уникальны.")
            ids.add(item["id"])
            for key in fields:
                if key not in ("id", "rows"):
                    _text(item[key])
            if collection in ("groups", "segments"):
                name = item["callsign" if collection == "groups" else "name"].strip().casefold()
                _check(not name or name not in names, "Позывные групп и имена участков должны быть уникальны.")
                if name: names.add(name)
            if collection == "groups":
                _check(item["vehicleType"] in ("PASSENGER", "ARMORED", "OTHER"), "Неизвестная категория техники.")
    groups = {item["id"] for item in doc["groups"]}
    segments = {item["id"] for item in doc["segments"]}
    used = set()
    row_count = 0
    first = date.fromisoformat(str(date_from))
    last = date.fromisoformat(str(date_to or date_from))
    for route in doc["routes"]:
        if route["date"]:
            try:
                day = date.fromisoformat(route["date"])
                _check(day.isoformat() == route["date"] and first <= day <= last, "Дата маршрута должна входить в период мероприятия.")
            except ValueError:
                raise InvalidDocument("Дата маршрута должна быть в формате ГГГГ-ММ-ДД и входить в период мероприятия.")
        _check(not route["time"] or bool(re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", route["time"])), "Время маршрута должно быть в формате ЧЧ:ММ.")
        _check(isinstance(route["rows"], list), "Строки маршрута должны быть массивом.")
        row_count += len(route["rows"])
        _check(row_count <= 500, "Допускается не более 500 строк маршрутов.")
        route_segments = set()
        for row in route["rows"]:
            _object(row, ("id", "segmentId", "reversed", "position", "note"))
            row["id"] = _id(row["id"])
            _check(row["id"] not in ids, "Идентификаторы строк должны быть уникальны.")
            ids.add(row["id"])
            row["segmentId"] = _id(row["segmentId"])
            _check(row["segmentId"] in segments, "Участок маршрута отсутствует в каталоге.")
            _check(row["segmentId"] not in route_segments, "Участок повторяется в одном маршруте.")
            route_segments.add(row["segmentId"])
            used.add(row["segmentId"])
            _check(type(row["reversed"]) is bool, "Направление должно быть логическим значением.")
            _check(row["position"] in ("RIGHT", "LEFT", "FRONT", "OBJECT"), "Неизвестное положение группы.")
            _text(row["note"], 1000)
    _check(isinstance(doc["assignments"], dict) and len(doc["assignments"]) <= 500, "Некорректные назначения.")
    assignments = {}
    assigned = set()
    for key, value in doc["assignments"].items():
        segment, group = _id(key), _id(value)
        _check(segment in segments and group in groups, "Назначение ссылается на отсутствующий участок или группу.")
        _check(segment not in assignments, "Повторное назначение участка.")
        if segment not in used: continue
        _check(group not in assigned, "Группа уже назначена другому физическому участку.")
        assignments[segment] = group
        assigned.add(group)
    doc["assignments"] = assignments
    return doc


def issues(doc):
    result = []
    def add(path, message): result.append({"path": path, "message": message})
    if not doc["routes"]: add("routes", "Добавьте хотя бы один маршрут.")
    groups = {g["id"]: g for g in doc["groups"]}
    segments = {s["id"]: s for s in doc["segments"]}
    for index, route in enumerate(doc["routes"]):
        path = f"routes.{index}"
        label = f"Маршрут {index + 1}" + (f" «{route['name']}»" if route["name"] else "")
        for field, field_label in (("name", "название"), ("start", "начало"), ("end", "конец"), ("date", "дату"), ("time", "время")):
            if not route[field].strip(): add(f"{path}.{field}", f"{label}: заполните {field_label}.")
        if not route["rows"]: add(f"{path}.rows", f"{label}: добавьте участок.")
        for j, row in enumerate(route["rows"]):
            segment = segments[row["segmentId"]]
            row_label = f"{label}, участок {j + 1}" + (f" «{segment['name']}»" if segment["name"] else "")
            missing_segment = [text for key, text in (("name", "название"), ("type", "тип"), ("pointA", "начальную точку"), ("pointB", "конечную точку")) if not segment[key].strip()]
            if missing_segment: add(f"{path}.rows.{j}", f"{row_label}: заполните {', '.join(missing_segment)}.")
            group = groups.get(doc["assignments"].get(segment["id"]))
            if group is None: add(f"{path}.rows.{j}", f"{row_label}: назначьте группу.")
            else:
                missing_group = [text for key, text in (("organization", "организацию"), ("callsign", "позывной"), ("vehicle", "название техники")) if not group[key].strip()]
                if missing_group: add(f"{path}.rows.{j}", f"{row_label}: заполните {', '.join(missing_group)} группы.")
    return result


def summary(doc):
    selected = set(doc["assignments"].values())
    organizations = {}
    categories = {"PASSENGER": 0, "ARMORED": 0, "OTHER": 0}
    for group in doc["groups"]:
        if group["id"] not in selected: continue
        categories[group["vehicleType"]] += 1
        item = organizations.setdefault(group["organization"], {"organization": group["organization"], "groupCount": 0, "vehicles": {"PASSENGER": 0, "ARMORED": 0, "OTHER": 0}})
        item["groupCount"] += 1
        item["vehicles"][group["vehicleType"]] += 1
    return {"groupCount": len(selected), "vehicles": categories, "organizations": list(organizations.values())}
