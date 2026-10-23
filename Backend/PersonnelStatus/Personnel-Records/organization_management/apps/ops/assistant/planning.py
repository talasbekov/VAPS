"""Validate model proposals and resolve names against current domain catalogs.

No mutation or authorization is performed here. Callers must authorize catalog
access before invoking this module; execution re-enters the manual API boundary.
"""
import re
from datetime import date, time, timedelta

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_object import OpsSecurityObject


class ProposalError(ValueError):
    pass


TEXT_FIELDS = ("title", "businessDate", "businessDateEnd", "eventTime", "kind", "objectName", "eventCode")
ALLOWED_FIELDS = {*TEXT_FIELDS, "intent", "allocations", "personnelTotal"}


def _optional_text(value, limit=255):
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ProposalError("Ожидался короткий текст.")
    return value.strip() or None


def validate_proposal(value):
    if not isinstance(value, dict) or set(value) - ALLOWED_FIELDS:
        raise ProposalError("Неизвестная структура предложения.")
    result = {key: _optional_text(value.get(key)) for key in TEXT_FIELDS}
    total = value.get("personnelTotal")
    if total is not None and (type(total) is not int or not 1 <= total <= 100000):
        raise ProposalError("Количество людей по поручению должно быть целым числом от1 до100000.")
    result["personnelTotal"] = total
    for key in ("businessDate", "businessDateEnd"):
        day = result[key]
        if day is not None:
            try:
                parsed = date.fromisoformat(day)
                if parsed.isoformat() != day:
                    raise ValueError
            except ValueError as error:
                raise ProposalError("Дата должна быть в формате ГГГГ-ММ-ДД.") from error
    if result["businessDate"] and result["businessDateEnd"] and result["businessDateEnd"] < result["businessDate"]:
        raise ProposalError("Окончание раньше начала.")
    if result["eventTime"]:
        try:
            parsed_time = time.fromisoformat(result["eventTime"])
            if parsed_time.tzinfo is not None or not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", result["eventTime"]):
                raise ValueError
        except ValueError as error:
            raise ProposalError("Время должно быть в формате ЧЧ:ММ.") from error
    if result["kind"] not in (None, "INTERNAL", "FOREIGN"):
        raise ProposalError("Неизвестный тип мероприятия.")
    result["intent"] = value.get("intent", "prepare")
    if result["intent"] not in ("prepare", "send"):
        raise ProposalError("Неизвестное действие.")
    rows = value.get("allocations", [])
    if not isinstance(rows, list) or len(rows) > 50:
        raise ProposalError("Укажите не более50 департаментов.")
    result["allocations"] = []
    for row in rows:
        if not isinstance(row, dict) or set(row) - {"departmentName", "need", "dueAt"}:
            raise ProposalError("Некорректная строка запроса.")
        name = _optional_text(row.get("departmentName"))
        need = row.get("need")
        if not name or type(need) is not int or not 1 <= need <= 100000:
            raise ProposalError("Укажите департамент и целое положительное количество.")
        clean = {"departmentName": name, "need": need}
        due_at = _optional_text(row.get("dueAt"), limit=40)
        if due_at:
            # The domain parser owns timezone/default policy at execution.
            from datetime import datetime
            try:
                datetime.fromisoformat(due_at.replace("Z", "+00:00"))
            except ValueError as error:
                raise ProposalError("Некорректный срок запроса.") from error
            clean["dueAt"] = due_at
        result["allocations"].append(clean)
    return result


def normalized_name(value):
    return re.sub(r"[^\w]+", " ", str(value).casefold().replace("ё", "е")).strip()


_ORDINALS = {
    "перв": 1, "втор": 2, "трет": 3, "четверт": 4,
    "пят": 5, "шест": 6, "седьм": 7, "восьм": 8,
    "девят": 9, "десят": 10, "одиннадцат": 11,
}


def department_name_key(value):
    name = normalized_name(value)
    if "департамент" not in name:
        return name
    numbers = re.findall(r"\b\d+\b", name)
    words = set(name.split())
    ordinals = [number for stem, number in _ORDINALS.items() if any(re.fullmatch(stem + r"(?:ой|ий|ого|его|ому|ему|ом|ем|ым|им|ьего|ьему|ьем|ьим)", word) for word in words)]
    if len(numbers) == 1:
        return f"department:{int(numbers[0])}"
    if len(ordinals) == 1:
        return f"department:{ordinals[0]}"
    return name


_CARDINALS = {
    "один": 1, "одного": 1, "одному": 1, "два": 2, "двух": 2, "двое": 2,
    "три": 3, "трех": 3, "трое": 3, "четыре": 4, "четырех": 4,
    "пять": 5, "пяти": 5, "шесть": 6, "шести": 6, "семь": 7, "семи": 7,
    "восемь": 8, "восьми": 8, "девять": 9, "девяти": 9, "десять": 10, "десяти": 10,
}
_COUNT = r"(?:100000|[1-9]\d{0,4}|" + "|".join(sorted(_CARDINALS, key=len, reverse=True)) + r")(?!\w)"
_PEOPLE = r"(?:человек(?:а)?|сотрудник(?:а|ов)?|людей|военнослужащ(?:их|его))"
_ORDINAL_WORD = r"(?:" + "|".join(sorted(_ORDINALS, key=len, reverse=True)) + r")(?:ой|ый|ий|ого|его|ому|ему|ом|ем|ым|им|ьего|ьему|ьем|ьим)"
_DEPARTMENT_WORD = r"департамент(?:а|у|ом|е|ы|ов|ам|ами|ах)?"
_NUMBERED_DEPARTMENT = re.compile(
    r"(?<!\w)(?:(?:" + _ORDINAL_WORD + r"|\d{1,3}(?:\s*[-–]?\s*(?:й|го|му|м|ым))?)\s+" + _DEPARTMENT_WORD
    + r"|" + _DEPARTMENT_WORD + r"\s*(?:№\s*|номер\s*)?\d{1,3}"
    + r"|" + _ORDINAL_WORD + r")(?![а-яa-z_])"
)
_BEFORE_QUANTITY = re.compile(r"(?<!\w)(?P<count>" + _COUNT + r")\s*(?:" + _PEOPLE + r"\s+)?(?:из|от|в|во|у|для)\s*$")
_AFTER_QUANTITY = re.compile(r"^\s*(?:[,;:—–=\-]\s*)?(?:(?:нужно|нужны|надо|выделить|выдели|по)\s+)?(?P<count>" + _COUNT + r")")
_NOT_PERSONNEL = re.compile(r"^\s*(?:[./\-]\d|(?:пост|смен|час|дн|сут|департамент)\w*\b)")


def grounded_allocations(message, rows):
    """Require every proposed recipient/count pair to have direct text evidence."""
    if not rows:
        return []
    source = message.casefold().replace("ё", "е")
    spans = []
    if re.search(_DEPARTMENT_WORD, source):
        for match in _NUMBERED_DEPARTMENT.finditer(source):
            phrase = match.group()
            if "департамент" not in phrase:
                phrase += " департамент"
            key = department_name_key(phrase)
            if key.startswith("department:"):
                spans.append((match.start(), match.end(), key))
    # Other official names require their full token sequence. Uncertain
    # inflection/abbreviation is deliberately returned to the explicit catalog.
    for row in rows:
        key = department_name_key(row["departmentName"])
        if key.startswith("department:"):
            continue
        words = normalized_name(row["departmentName"]).split()
        expression = r"(?<!\w)" + r"[\W_]+".join(map(re.escape, words)) + r"(?!\w)"
        for match in re.finditer(expression, source):
            spans.append((match.start(), match.end(), key))
    spans = sorted(set(spans), key=lambda span: (span[0], -(span[1] - span[0])))
    selected = []
    for span in spans:
        if not selected or span[0] >= selected[-1][1]:
            selected.append(span)
    evidence = {}
    for index, (start, end, key) in enumerate(selected):
        left = source[selected[index - 1][1] if index else 0:start]
        right = source[end:selected[index + 1][0] if index + 1 < len(selected) else len(source)]
        # Alternatives and corrections require an explicit reviewed choice.
        if re.search(r"\b(?:или|вместо|исправь|исправить)\b|а\s+не\b", left + " " + right):
            return []
        candidates = []
        before = _BEFORE_QUANTITY.search(left)
        after = _AFTER_QUANTITY.search(right)
        if before:
            candidates.append(before.group("count"))
        next_recipient = bool(after and index + 1 < len(selected) and re.fullmatch(r"\s*(?:" + _PEOPLE + r"\s+)?(?:из|от|в|во|у|для)\s*", right[after.end():]))
        if after and not next_recipient and not _NOT_PERSONNEL.match(right[after.end():]):
            candidates.append(after.group("count"))
        for value in candidates:
            evidence.setdefault(key, set()).add(int(value) if value.isdigit() else _CARDINALS[value])
    proposed = {}
    for row in rows:
        key = department_name_key(row["departmentName"])
        if key in proposed or evidence.get(key) != {row["need"]}:
            return []
        proposed[key] = row["need"]
    if set(evidence) != set(proposed):
        return []
    return rows


def _event_code_is_explicit(message, code):
    # Titles are document facts, never references to a different saved event.
    source = re.sub(r'[«"“][^»"”]*[»"”]', " ", message.casefold().replace("ё", "е"))
    value = code.casefold().replace("ё", "е")
    token = r"(?<![\w-])" + re.escape(value) + r"(?![\w-])"
    for match in re.finditer(token, source):
        prefix = source[max(0, match.start() - 70):match.start()]
        if re.search(r"\bкод(?:а|у|ом)?\s*[:№]?\s*$", prefix):
            return True
        if re.search(r"\b(?:по|для|в|к)\s+(?:существующ[а-я]*\s+)?(?:ом|мероприяти[а-я]*)\s*[:№]?\s*$", prefix):
            return True
        # Generated codes and legacy OM01 references carry an event namespace.
        if re.fullmatch(r"(?:ом|om)(?:[-_]?\d+){1,3}", value):
            if not re.search(r"\bобъект[а-я]*\s*[:№]?\s*$", prefix):
                return True
    return False


_MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}
_CALENDAR_DAY = re.compile(
    r"(?<!\w)(?:на\s+)?(?P<day>\d{1,2})\s*(?:числ[оа]\b|(?P<month>"
    + "|".join(_MONTHS) + r")\b(?:\s+(?P<year>\d{4})(?!\d))?)"
)


def _day_of_month(message):
    """Resolve explicit calendar words; omitted month/year never roll forward."""
    from organization_management.apps.operations.clock import Clock
    source = message.casefold().replace("ё", "е")
    matches = list(_CALENDAR_DAY.finditer(source))
    if not matches:
        return False, None
    if (len(matches) != 1
            or re.search(r"\b(?:не|или|либо|вместо)\b", source[max(0, matches[0].start() - 24):matches[-1].end()])
            or re.match(r"\s*(?:или|либо|вместо)\s+(?:на\s+)?\d{1,2}(?!\d)", source[matches[-1].end():matches[-1].end() + 40])):
        return True, None
    today = Clock.today_local()
    try:
        match = matches[0]
        candidate = date(int(match["year"] or today.year), _MONTHS.get(match["month"], today.month), int(match["day"]))
    except ValueError:
        return True, None
    if candidate < today and not match["year"]:
        return True, None
    full_dates = re.findall(r"(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{2}[./]\d{2}[./]\d{4})(?!\d)", source)
    forms = {candidate.isoformat(), candidate.strftime("%d.%m.%Y"), candidate.strftime("%d/%m/%Y")}
    if any(value not in forms for value in full_dates):
        return True, None
    for word, offset in {"сегодня": 0, "завтра": 1, "послезавтра": 2}.items():
        if re.search(r"\b" + word + r"\b", source) and candidate != today + timedelta(days=offset):
            return True, None
    return True, candidate.isoformat()


def _personnel_total_evidence(message):
    """A standalone people count is not a department quota or a post quantity."""
    source = message.casefold().replace("ё", "е")
    candidates = []
    recipient_counts = set()
    for department in _NUMBERED_DEPARTMENT.finditer(source):
        before = _BEFORE_QUANTITY.search(source[:department.start()])
        after = _AFTER_QUANTITY.search(source[department.end():])
        if before:
            recipient_counts.add(before.start("count"))
        if after:
            recipient_counts.add(department.end() + after.start("count"))
    for match in re.finditer(r"(?<![\w.,])([+\-]?\d+(?:[.,]\d+)?)\s*" + _PEOPLE + r"(?!\w)", source):
        start = max(source.rfind(mark, 0, match.start()) for mark in (",", ";", "\n")) + 1
        ends = [source.find(mark, match.end()) for mark in (",", ";", "\n")]
        end = min((pos for pos in ends if pos >= 0), default=len(source))
        clause = source[start:end]
        if match.start(1) in recipient_counts:
            continue
        if re.search(r"\b(?:не|или|либо|вместо)\b", clause):
            return None, True
        count = int(match[1]) if match[1].isascii() and match[1].isdigit() and len(match[1]) <= 6 else 0
        if not 1 <= count <= 100000:
            return None, True
        candidates.append(count)
    return (candidates[0], False) if len(candidates) == 1 else (None, len(candidates) > 1)


def _personnel_total(message):
    return _personnel_total_evidence(message)[0]


def personnel_total_requires_review(message):
    """An explicitly mentioned but unresolved total needs a human choice."""
    return _personnel_total_evidence(message)[1]


def _object_mentions(source, name):
    """Whole catalog labels, plus simple accusative nouns after 'на/в'."""
    words = normalized_name(name).split()
    if not words:
        return []
    expression = r"(?<![\w-])" + r"[\W_]+".join(map(re.escape, words)) + r"(?![\w-])"
    matches = list(re.finditer(expression, source))
    # Restrict inflection to a single noun. Multiword agreement and similar
    # spellings need an explicit catalog choice, not a fuzzy name match.
    if len(words) == 1 and len(words[0]) > 2 and words[0][-1] in "ая":
        accusative = words[0][:-1] + {"а": "у", "я": "ю"}[words[0][-1]]
        for match in re.finditer(r"(?<![\w-])" + re.escape(accusative) + r"(?![\w-])", source):
            if re.search(r"\b(?:на|в)\s+(?:объект(?:е)?\s+)?$", source[:match.start()]):
                matches.append(match)
    return matches


def complete_explicit_proposal(message, proposal, *, object_names):
    """Complete explicit initial-task facts without choosing authority or IDs.

    Catalog names are supplied by the caller's existing catalog policy. This
    function never reads records and is never used for human continuations.
    """
    clean = ground_proposal(message, proposal)
    source = message.casefold().replace("ё", "е")
    matches = []
    for name in object_names:
        for match in _object_mentions(source, name):
            matches.append((match.start(), match.end(), name))
    # A full label beats a catalog label that is only its embedded prefix.
    matches = [row for row in matches if not any(other[0] <= row[0] and other[1] >= row[1] and other[:2] != row[:2] for other in matches)]
    identities = {(start, end, name) for start, end, name in matches}
    if identities:
        first, last = min(row[0] for row in matches), max(row[1] for row in matches)
        uncertain = re.search(r"\b(?:не|или|либо|вместо)\b", source[max(0, first - 28):last])
        trailing_alternative = re.match(r"\s*(?:или|либо|вместо)\b", source[last:last + 40])
        if len(identities) == 1 and not uncertain and not trailing_alternative:
            clean["objectName"] = matches[0][2]
        else:
            # Retain the unresolved literal context so the exact resolver asks
            # for a catalog choice instead of dropping the object requirement.
            end = last + 40 if trailing_alternative else last
            clean["objectName"] = message[max(0, first - 28):end][:255].strip()
    elif object_names and (clean["objectName"] or re.search(r"\bобъект[а-я]*\b", source)):
        # No whole catalog label was present. Keep the user's literal context
        # unresolved; a model's shorter prefix must not select a different ID.
        context = message[:255].strip()
        clean["objectName"] = context if all(normalized_name(context) != normalized_name(name) for name in object_names) else None
    mentioned, day = _day_of_month(message)
    if mentioned:
        clean["businessDate"] = day
    clean["personnelTotal"] = _personnel_total(message)
    return clean


def ground_proposal(message, proposal):
    """Discard unsupported model facts before they can create a document.

    This is an evidence floor, not another free-text generator. Ambiguous facts
    remain empty and are collected through explicit task fields.
    """
    from organization_management.apps.operations.clock import Clock
    clean = validate_proposal(proposal)
    source = message.casefold().replace("ё", "е")
    normalized = normalized_name(message)
    if clean["title"] and normalized_name(clean["title"]) not in normalized:
        clean["title"] = None
    if clean["objectName"] and normalized_name(clean["objectName"]) not in normalized and not _object_mentions(source, clean["objectName"]):
        clean["objectName"] = None
    if clean["eventCode"] and not _event_code_is_explicit(message, clean["eventCode"]):
        clean["eventCode"] = None
    if clean["title"]:
        quoted = re.findall(r'[«"“]([^»"”]+)[»"”]', message)
        named = any(normalized_name(clean["title"]) == normalized_name(value) for value in quoted)
        generic = normalized_name(clean["title"]) in {"наряд", "сбор наряда", "подготовка наряда", "мероприятие", "охранное мероприятие"}
        if not named and (generic or not re.search(r"мероприяти|назван|назови", source)):
            clean["title"] = None
    mentioned_day, explicit_day = _day_of_month(message)
    for key in ("businessDate", "businessDateEnd"):
        if clean[key]:
            day = date.fromisoformat(clean[key])
            forms = (day.isoformat(), day.strftime("%d.%m.%Y"), day.strftime("%d/%m/%Y"))
            relative = {"сегодня": 0, "завтра": 1, "послезавтра": 2}
            supported = any(value in source for value in forms) or any(re.search(r"\b" + word + r"\b", source) and day == Clock.today_local() + timedelta(days=offset) for word, offset in relative.items())
            if key == "businessDate" and mentioned_day:
                supported = clean[key] == explicit_day
            if not supported:
                clean[key] = None
    if clean["personnelTotal"] != _personnel_total(message):
        clean["personnelTotal"] = None
    if clean["eventTime"] and clean["eventTime"] not in source:
        clean["eventTime"] = None
    if clean["kind"] == "INTERNAL" and not re.search(r"\bвнутренн", source):
        clean["kind"] = None
    if clean["kind"] == "FOREIGN" and not re.search(r"\b(?:иностранн|зарубежн)", source):
        clean["kind"] = None
    sending = re.search(r"\b(?:отправь|отправить|разошли|разослать|запроси|запросить)(?![а-я])", source)
    declined = re.search(r"\bне\s+(?:отправ|разошл|рассыл|запраш|запрос)", source)
    clean["intent"] = "send" if sending and not declined else "prepare"
    # The model schema only permits recipient/count. Shared validation also
    # accepts human-entered deadlines; they must never come from model output.
    model_rows = [{key: row[key] for key in ("departmentName", "need")} for row in clean["allocations"]]
    clean["allocations"] = grounded_allocations(message, model_rows)
    return clean


def question(field, text):
    return {"field": field, "text": text}


def resolve_plan(proposal, *, actor_id):
    clean = validate_proposal(proposal)
    plan = {**clean, "objectId": None, "eventId": None, "questions": []}
    plan["allocations"] = []
    for key, text in (("title", "Как называется мероприятие?"), ("businessDate", "На какую дату нужен наряд?"), ("kind", "Мероприятие внутреннее или с участием иностранных лиц?")):
        if not clean[key] and not clean["eventCode"]:
            plan["questions"].append(question(key, text))
    if clean["objectName"]:
        matches = [obj for obj in OpsSecurityObject.objects.all().only("id", "name") if normalized_name(obj.name) == normalized_name(clean["objectName"])]
        if len(matches) == 1:
            plan["objectId"] = str(matches[0].pk)
            plan["objectName"] = matches[0].name
        else:
            plan["questions"].append(question("objectId", "Уточните объект: название не найдено или соответствует нескольким записям."))
    departments = list(Division.objects.filter(division_type=Division.DivisionType.DEPARTMENT, is_active=True).only("id", "name"))
    seen = set()
    for row in clean["allocations"]:
        matches = [division for division in departments if department_name_key(division.name) == department_name_key(row["departmentName"])]
        if len(matches) != 1:
            plan["questions"].append(question("allocations", f"Уточните департамент «{row['departmentName']}»: нет однозначного соответствия."))
            continue
        department = matches[0]
        if department.pk in seen:
            raise ProposalError("Один департамент указан несколько раз.")
        seen.add(department.pk)
        plan["allocations"].append({**row, "departmentId": str(department.pk), "departmentName": department.name})
    if clean["intent"] == "send" and not clean["allocations"]:
        plan["questions"].append(question("allocations", "Уточните департаменты и количество людей для каждого: текст не даёт однозначного распределения."))
    return plan
