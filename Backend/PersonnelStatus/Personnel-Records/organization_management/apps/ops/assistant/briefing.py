"""Bounded multi-object bulletin facts. Text is evidence, never authority."""
import copy
import re

MAX_OBJECTS = 20


def _schema(properties):
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}


_TEXT = {"type": ["string", "null"]}
_COUNT = {"type": ["integer", "null"], "minimum": 0, "maximum": 100000}
_SUBPOST = _schema({"number": {"type": "integer", "minimum": 1, "maximum": 50}, "need": _COUNT})
_POST = _schema({"number": {"type": "integer", "minimum": 1, "maximum": 200}, "need": _COUNT,
    "subpostCount": {"type": ["integer", "null"], "minimum": 0, "maximum": 50},
    "subposts": {"type": "array", "maxItems": 50, "items": _SUBPOST}})
_SECTOR = _schema({"number": {"type": "integer", "minimum": 1, "maximum": 30},
    "postCount": {"type": ["integer", "null"], "minimum": 0, "maximum": 200},
    "posts": {"type": "array", "maxItems": 200, "items": _POST}})
BRIEFING_SCHEMA = {**_schema({
    "objects": {"type": "array", "maxItems": MAX_OBJECTS, "items": _schema({
        "name": {"type": "string"}, "chiefName": _TEXT,
        "sectorCount": {"type": ["integer", "null"], "minimum": 0, "maximum": 30},
        "sectors": {"type": "array", "maxItems": 30, "items": _SECTOR},
        "personnelNeed": _COUNT, "needStatus": {"enum": ["known", "unknown"]},
        "checklistChecked": {"type": ["boolean", "null"]},
    })},
    "protectedPersons": {"type": "array", "maxItems": 30, "items": _schema({
        "code": _TEXT, "name": _TEXT, "country": _TEXT, "createIfMissing": {"type": "boolean"},
    })},
}), "type": ["object", "null"]}
WORDS = {
    "ноль": 0, "один": 1, "одна": 1, "одно": 1, "одного": 1, "одному": 1, "одним": 1,
    "два": 2, "две": 2, "двух": 2, "двумя": 2, "три": 3, "трех": 3,
    "четыре": 4, "четырех": 4, "пять": 5, "пяти": 5, "шесть": 6,
    "семь": 7, "восемь": 8, "девять": 9, "десять": 10,
}
ORDINALS = {"перв": 1, "втор": 2, "трет": 3, "треть": 3, "четверт": 4, "пят": 5,
            "шест": 6, "седьм": 7, "восьм": 8, "девят": 9, "десят": 10}
NUM = r"(?:\d{1,6}|" + "|".join(sorted(WORDS, key=len, reverse=True)) + r")(?!\w)"
ORDER = r"(?:\d{1,3}(?:-?[а-я]+)?|" + "|".join(ORDINALS) + r")[а-я]*"
OBJ_KEYS = {"name", "objectId", "chiefName", "chiefEmployeeId", "sectorCount", "sectors",
            "personnelNeed", "needStatus", "checklistChecked", "checklistResults", "demandSpecified"}


def key(value):
    return re.sub(r"[\W_]+", " ", str(value).casefold().replace("ё", "е")).strip()


def number(value):
    value = value.casefold().replace("ё", "е")
    if value.isdigit():
        return int(value)
    return WORDS.get(value)


def ordinal(value):
    if value[0].isdigit():
        return int(re.match(r"\d+", value).group())
    return next((n for stem, n in ORDINALS.items() if value.startswith(stem)), None)


def _integer(value, limit):
    if value is not None and (type(value) is not int or not 0 <= value <= limit):
        raise ValueError("Некорректное количество в структуре объекта.")


def _text(value, limit=255):
    if value is not None and (not isinstance(value, str) or len(value) > limit):
        raise ValueError("Некорректный текст в сведениях бюллетеня.")


def validate_briefing(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {"objects", "protectedPersons", "issues", "resolvedIssues", "replaceForeignPerson"}:
        raise ValueError("Некорректные сведения бюллетеня.")
    objects, persons, issues = value.get("objects", []), value.get("protectedPersons", []), value.get("issues", [])
    if not isinstance(objects, list) or len(objects) > MAX_OBJECTS:
        raise ValueError("Укажите не более 20 объектов.")
    if not isinstance(persons, list) or len(persons) > 30 or not isinstance(issues, list) or len(issues) > 100:
        raise ValueError("Слишком много сведений бюллетеня.")
    if not isinstance(value.get("resolvedIssues", []), list) or len(value.get("resolvedIssues", [])) > 100:
        raise ValueError("Некорректные уточнения.")
    for resolved in value.get("resolvedIssues", []):
        _text(resolved, 2000)
    if "replaceForeignPerson" in value and type(value["replaceForeignPerson"]) is not bool:
        raise ValueError("Некорректное уточнение иностранного ОЛ.")
    budget = 0
    for obj in objects:
        if not isinstance(obj, dict) or set(obj) - OBJ_KEYS or not obj.get("name"):
            raise ValueError("Некорректная запись объекта.")
        for field in ("name", "chiefName", "objectId", "chiefEmployeeId"):
            _text(obj.get(field))
        _integer(obj.get("sectorCount"), 30)
        _integer(obj.get("personnelNeed"), 100000)
        if obj.get("needStatus", "unknown") not in {"known", "unknown"}:
            raise ValueError("Некорректное состояние потребности.")
        if "demandSpecified" in obj and type(obj["demandSpecified"]) is not bool:
            raise ValueError("Некорректное уточнение потребности.")
        if obj.get("checklistChecked") is not None and type(obj["checklistChecked"]) is not bool:
            raise ValueError("Некорректное состояние осмотра.")
        sectors = obj.get("sectors", [])
        if not isinstance(sectors, list) or len(sectors) > 30:
            raise ValueError("Некорректный список секторов.")
        seen_sectors = set()
        for sector in sectors:
            if not isinstance(sector, dict) or set(sector) - {"number", "postCount", "posts"}:
                raise ValueError("Некорректный сектор.")
            _integer(sector.get("number"), 30)
            if not sector.get("number"):
                raise ValueError("Укажите номер сектора.")
            if sector["number"] in seen_sectors or (obj.get("sectorCount") is not None and sector["number"] > obj["sectorCount"]):
                raise ValueError("Номера секторов повторяются или выходят за указанное количество.")
            seen_sectors.add(sector["number"])
            _integer(sector.get("postCount"), 200)
            posts = sector.get("posts", [])
            if not isinstance(posts, list) or len(posts) > 200:
                raise ValueError("Некорректный список постов.")
            seen_posts = set()
            for post in posts:
                if not isinstance(post, dict) or set(post) - {"number", "need", "subpostCount", "subposts"}:
                    raise ValueError("Некорректный пост.")
                _integer(post.get("number"), 200)
                if not post.get("number"):
                    raise ValueError("Укажите номер поста.")
                if post["number"] in seen_posts or (sector.get("postCount") is not None and post["number"] > sector["postCount"]):
                    raise ValueError("Номера постов повторяются или выходят за указанное количество.")
                seen_posts.add(post["number"])
                _integer(post.get("need"), 100000)
                _integer(post.get("subpostCount"), 50)
                subposts = post.get("subposts", [])
                if not isinstance(subposts, list) or len(subposts) > 50:
                    raise ValueError("Некорректные подпосты.")
                seen_subposts = set()
                for sub in subposts:
                    if not isinstance(sub, dict) or set(sub) - {"number", "need"}:
                        raise ValueError("Некорректный подпост.")
                    _integer(sub.get("number"), 50)
                    _integer(sub.get("need"), 100000)
                    if not sub.get("number"):
                        raise ValueError("Укажите номер подпоста.")
                    if sub["number"] in seen_subposts or (post.get("subpostCount") is not None and sub["number"] > post["subpostCount"]):
                        raise ValueError("Номера подпостов повторяются или выходят за указанное количество.")
                    seen_subposts.add(sub["number"])
                budget += 1 + len(subposts)
        results = obj.get("checklistResults", [])
        if not isinstance(results, list) or len(results) > 20:
            raise ValueError("Некорректные результаты осмотра.")
        for result in results:
            if not isinstance(result, dict) or set(result) - {"id", "state", "comment"}:
                raise ValueError("Некорректный результат осмотра.")
            if result.get("state") not in {"NORMAL", "REMARK", "UNCHECKED"}:
                raise ValueError("Укажите результат осмотра.")
            _text(result.get("id"), 80)
            _text(result.get("comment"), 2000)
    if budget > 1000:
        raise ValueError("Слишком много постов и подпостов.")
    for person in persons:
        if not isinstance(person, dict) or set(person) - {"code", "name", "country", "createIfMissing", "personId"}:
            raise ValueError("Некорректное охраняемое лицо.")
        for field in ("code", "name", "country", "personId"):
            _text(person.get(field))
        if "createIfMissing" in person and type(person["createIfMissing"]) is not bool:
            raise ValueError("Некорректное поручение создать ОЛ.")
    for issue in issues:
        if not isinstance(issue, dict) or set(issue) != {"field", "text"}:
            raise ValueError("Некорректное уточнение.")
        _text(issue["field"], 255)
        _text(issue["text"], 2000)
    return copy.deepcopy(value)


def _pattern(name):
    words = key(name).split()
    if not words:
        return r"(?!)"
    last = words[-1]
    if last.endswith("а"):
        last = re.escape(last[:-1]) + r"(?:а|у|ы|е|ой)"
    elif last.endswith("я"):
        last = re.escape(last[:-1]) + r"(?:я|ю|и|е|ей)"
    elif len(words) == 1 or "-" in name:
        last = re.escape(last) + r"(?:а|у|е|ом)?"
    else:
        last = re.escape(last)
    return r"(?<!\w)" + r"[\W_]+".join([*map(re.escape, words[:-1]), last]) + r"(?!\w)"


def _blank(name):
    return {"name": name, "chiefName": None, "sectorCount": None, "sectors": [],
            "personnelNeed": None, "needStatus": "unknown", "checklistChecked": None}


def _posts(count):
    return [{"number": n, "subpostCount": None, "need": None, "subposts": []} for n in range(1, count + 1)]


def _set_subposts(post, count):
    post["subpostCount"] = count
    post["subposts"] = [{"number": n, "need": None} for n in range(1, count + 1)]


def extract_briefing(message, *, object_names=(), previous=None):
    """Extract explicit structure; unsupported or ambiguous wording stays a question."""
    source = message.casefold().replace("ё", "е")
    header = re.search(r"\b(?:на|по)\s+объектах\s+([^.!?\n]+)", message, re.I)
    names = []
    if header:
        for part in re.split(r"\s*,\s*|\s+и\s+", header.group(1)):
            name = part.strip(" «»\"")
            if name:
                exact = [n for n in object_names if key(n) == key(name)]
                names.append(exact[0] if len(exact) == 1 else name)
    elif previous:
        names = [o["name"] for o in previous.get("objects", []) if re.search(_pattern(o["name"]), source)]
        if re.search(r"все\s+объекты|всем\s+объектам", source):
            names = [o["name"] for o in previous.get("objects", [])]
    else:
        return None
    if len(names) > MAX_OBJECTS:
        raise ValueError("Укажите не более 20 объектов.")
    names = list(dict.fromkeys(names))
    result = {"objects": [], "protectedPersons": [], "issues": []}
    spans = sorted((m.start(), m.end(), name) for name in names for m in re.finditer(_pattern(name), source))
    chunks = {name: [] for name in names}
    for i, (start, end, name) in enumerate(spans):
        stop = spans[i + 1][0] if i + 1 < len(spans) else len(message)
        chunks[name].append(message[end:stop])
    global_checked = bool(re.search(r"все\s+объекты[^.]{0,70}(?:проверены|осмотрены)", source))
    chief_context = bool(re.search(r"старш(?:ий|ие|его)\s+объект", source))
    for name in names:
        obj = _blank(name)
        text = " ".join(chunks[name])
        lower = text.casefold().replace("ё", "е")
        if global_checked:
            obj["checklistChecked"] = True
        count = re.search(r"(?<!\w)(" + NUM + r")\s+сектор", lower)
        if count:
            obj["sectorCount"] = number(count.group(1))
        demand = None if re.search(r"(?:на|для)\s+(?:кажд[а-я]*\s+)?(?:под)?пост|пост\s*\d", lower) else re.search(r"(?:нужно\s+|нужны\s+|выделить\s+|по\s+)?(" + NUM + r")\s+(?:человек|сотрудник|людей)", lower)
        if demand:
            obj["personnelNeed"], obj["needStatus"] = number(demand.group(1)), "known"
            obj["demandSpecified"] = True
        if re.search(r"неизвестн|еще\s+не\s+(?:ясно|определен)|пока[^.]{0,35}не\s+нужны", lower):
            obj["personnelNeed"], obj["needStatus"] = None, "unknown"
            obj["demandSpecified"] = True
        chief = re.search(r"старш(?:ий|его)\s+объекта\s+([А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі][^,.;]+)", text, re.I)
        if chief:
            obj["chiefName"] = chief.group(1).strip()
        elif chief_context:
            # A continuation of an explicit list of object chiefs: «у Аккорды ФИО».
            for chunk in chunks[name]:
                candidate = re.match(r"\s+([А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі-]+\s+[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі-]+(?:\s+[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі-]+)?)\s*[,.;]", chunk)
                if candidate and not re.search(r"нуж|человек|сектор|пост|неизвест", candidate.group(1), re.I):
                    obj["chiefName"] = candidate.group(1).strip()
                    break
        sector_matches = list(re.finditer(r"(?:у\s+(" + ORDER + r")\s+(?:сектора?\s+)?|(" + ORDER + r")\s+сектора?\s+)(" + NUM + r")\s+пост(?:а|ов)?\b", lower))
        for index, match in enumerate(sector_matches):
            no, post_count = ordinal(match.group(1) or match.group(2)), number(match.group(3))
            if no is None or not 1 <= no <= 30 or post_count is None or post_count > 200:
                continue
            end = sector_matches[index + 1].start() if index + 1 < len(sector_matches) else len(lower)
            tail = lower[match.end():end]
            sector = {"number": no, "postCount": post_count, "posts": _posts(post_count)}
            if re.match(r"\s+без\s+подпост", tail):
                for post in sector["posts"]:
                    _set_subposts(post, 0)
            if post_count == 1:
                sub = re.match(r"\s+с\s+(" + NUM + r")\s+подпост", tail)
                if sub and number(sub.group(1)) <= 50:
                    _set_subposts(sector["posts"][0], number(sub.group(1)))
            first = re.search(r"первые\s+(" + NUM + r")\s+поста[^.;]{0,45}по\s+(" + NUM + r")\s+подпост", tail)
            if first:
                first_count, sub_count = number(first.group(1)), number(first.group(2))
                if first_count <= post_count and sub_count <= 50:
                    for post in sector["posts"][:first_count]:
                        _set_subposts(post, sub_count)
            for pm in re.finditer(r"(" + ORDER + r")\s+(?:пост[а-я]*\s+)?(?:не\s+имеет\s+подпоста|без\s+подпост)", tail):
                pn = ordinal(pm.group(1))
                if pn and pn <= post_count:
                    _set_subposts(sector["posts"][pn - 1], 0)
            obj["sectors"].append(sector)
        if re.search(r"(?:терть|треть|трет)[а-я]*\s+поста\s+(" + NUM + r")\s+подпост", lower):
            result["issues"].append({"field": "briefing", "text": f"«{name}»: уточните, к какому сектору относится указанный третий пост с подпостом."})
        result["objects"].append(obj)
    protected = re.search(r"охраняемые\s+лица[^.]{0,180}", source)
    if protected:
        codes = re.findall(r"(?<!\d)\d{2,10}(?!\d)", protected.group())
        result["protectedPersons"] = [{"code": code} for code in dict.fromkeys(codes)]
    foreign = re.search(r"фио\s+иностранного\s+ол\s+([^,.;]+),\s*страна\s+([^,.;]+)", message, re.I)
    if foreign:
        result["protectedPersons"].append({"name": foreign.group(1).strip(), "country": foreign.group(2).strip(),
            "createIfMissing": bool(re.search(r"\bсоздай(?:те)?\s+(?:такого\s+)?иностранного\s+ол", source)) and not bool(re.search(r"не\s+созда(?:вай|вайте|ть|й)", source))})
    elif re.search(r"иностранн[а-я]*\s+ол", source):
        result["issues"].append({"field": "briefing", "text": "Укажите ФИО и страну иностранного охраняемого лица."})
    if previous:
        from .briefing_followup import apply_followup
        result = apply_followup(message, result, previous)
    return validate_briefing(result) if result["objects"] or result["protectedPersons"] or result["issues"] else None


def _merge_numbered(old, patch, child=None):
    merged = {row["number"]: copy.deepcopy(row) for row in old}
    for row in patch:
        base = merged.get(row["number"], {})
        update = {k: copy.deepcopy(v) for k, v in row.items() if v is not None and k != child}
        if child:
            next_child = "subposts" if child == "posts" else None
            update[child] = _merge_numbered(base.get(child, []), row.get(child, []), next_child)
            count = row.get("postCount" if child == "posts" else "subpostCount")
            if count is not None:
                update[child] = [item for item in update[child] if item["number"] <= count]
        merged[row["number"]] = {**base, **update}
    return sorted(merged.values(), key=lambda row: row["number"])


def merge_briefing(old, patch):
    if not patch:
        return copy.deepcopy(old)
    if not old:
        return validate_briefing(patch)
    objects = {key(obj["name"]): copy.deepcopy(obj) for obj in old.get("objects", [])}
    for obj in patch["objects"]:
        identity = key(obj["name"])
        base = objects.get(identity, {})
        changes = {k: copy.deepcopy(v) for k, v in obj.items() if v is not None and k not in {"sectors", "needStatus", "personnelNeed"}}
        if obj.get("personnelNeed") is not None or obj.get("demandSpecified"):
            changes.update(personnelNeed=obj.get("personnelNeed"), needStatus="known" if obj.get("personnelNeed") is not None else "unknown")
        changes["sectors"] = _merge_numbered(base.get("sectors", []), obj.get("sectors", []), "posts")
        if obj.get("sectorCount") is not None:
            changes["sectors"] = [s for s in changes["sectors"] if s["number"] <= obj["sectorCount"]]
        objects[identity] = {**base, **changes}
        if obj.get("chiefName") and key(obj["chiefName"]) != key(base.get("chiefName", "")):
            objects[identity].pop("chiefEmployeeId", None)
    people = {p.get("code") or key(p.get("name", "")): copy.deepcopy(p) for p in old.get("protectedPersons", [])}
    if patch.get("replaceForeignPerson"):
        old_foreign = [identity for identity, person in people.items() if person.get("name") and not person.get("code")]
        new_foreign = [person for person in patch.get("protectedPersons", []) if person.get("name") and not person.get("code")]
        if len(old_foreign) == len(new_foreign) == 1:
            people.pop(old_foreign[0])
    for person in patch.get("protectedPersons", []):
        people[person.get("code") or key(person.get("name", ""))] = copy.deepcopy(person)
    resolved = set(patch.get("resolvedIssues", []))
    issues = list({row["text"]: row for row in [*old.get("issues", []), *patch.get("issues", [])] if row["text"] not in resolved}.values())
    return validate_briefing({"objects": list(objects.values()), "protectedPersons": list(people.values()), "issues": issues})


def completeness_questions(value):
    from organization_management.apps.ops.security_events import TEMPLATE_CHECK_IDS
    questions = list(value.get("issues", []))
    for obj in value.get("objects", []):
        missing = []
        if not obj.get("chiefName"):
            missing.append("старшего объекта")
        if obj.get("personnelNeed") is None:
            missing.append("потребность в людях (неизвестно или точное количество)")
        if obj.get("sectorCount") is None:
            missing.append("количество секторов и структуру постов")
        else:
            sectors = {s["number"]: s for s in obj.get("sectors", [])}
            for number_ in range(1, obj["sectorCount"] + 1):
                sector = sectors.get(number_)
                if not sector or sector.get("postCount") is None:
                    missing.append(f"сектор {number_}: количество постов и подпостов")
                    continue
                posts = {p["number"]: p for p in sector.get("posts", [])}
                for pn in range(1, sector["postCount"] + 1):
                    post = posts.get(pn)
                    if not post or post.get("subpostCount") is None:
                        missing.append(f"сектор {number_}, пост {pn}: количество подпостов")
                    if not post or post.get("need") is None:
                        missing.append(f"сектор {number_}, пост {pn}: число людей")
                    elif post.get("need") == 0:
                        missing.append(f"сектор {number_}, пост {pn}: нужен ли пост с нулевой потребностью")
                    if post and post.get("subpostCount") is not None:
                        subposts = {s["number"]: s for s in post.get("subposts", [])}
                        if any(subposts.get(sn, {}).get("need") in (None, 0) for sn in range(1, post["subpostCount"] + 1)):
                            missing.append(f"сектор {number_}, пост {pn}: число людей на каждом подпосту")
        results = {r["id"]: r for r in obj.get("checklistResults", [])}
        known_need, complete_need = 0, obj.get("sectorCount") is not None
        sectors = obj.get("sectors", [])
        complete_need = complete_need and len(sectors) == obj.get("sectorCount")
        for sector in sectors:
            posts = sector.get("posts", [])
            complete_need = complete_need and sector.get("postCount") is not None and len(posts) == sector["postCount"]
            for post in posts:
                subposts = post.get("subposts", [])
                complete_need = complete_need and post.get("subpostCount") is not None and len(subposts) == post["subpostCount"]
                for row in [post, *subposts]:
                    known_need += row.get("need") or 0
                    complete_need = complete_need and row.get("need") is not None
        total = obj.get("personnelNeed")
        if total is not None and (known_need > total or (complete_need and known_need != total)):
            missing.append(f"общую потребность: по объекту {total}, по указанным постам и подпостам {known_need}")
        if set(results) != TEMPLATE_CHECK_IDS or any(results.get(cid, {}).get("state") not in {"NORMAL", "REMARK"}
               or (results.get(cid, {}).get("state") == "REMARK" and not results[cid].get("comment")) for cid in TEMPLATE_CHECK_IDS):
            missing.append("результаты пунктов чек-листа и замечания; факт проверки сохранён отдельно")
        if missing:
            questions.append({"field": "briefing", "text": f"«{obj['name']}»: уточните " + "; ".join(missing) + "."})
    if not value.get("protectedPersons"):
        questions.append({"field": "briefing", "text": "Укажите охраняемых лиц и их коды либо ФИО."})
    return questions
