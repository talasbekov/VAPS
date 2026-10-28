"""Explicit follow-up facts scoped to named objects. No domain reads or writes."""
from copy import deepcopy
import re


def apply_followup(message, patch, previous):
    """Augment a text-derived patch, preserving unrelated objects and amounts.

    Empty/ambiguous context is left for clarification. This function never
    accepts employee/person IDs or invents checklist results from «проверено».
    """
    from .briefing import NUM, ORDER, _pattern, _merge_numbered, key, number, ordinal, validate_briefing

    source = message.casefold().replace("ё", "е")
    result = deepcopy(patch) if patch else {"objects": [], "protectedPersons": [], "issues": []}
    result.setdefault("objects", [])
    result.setdefault("protectedPersons", [])
    result.setdefault("issues", [])
    old_objects = (previous or {}).get("objects", [])
    candidates = {key(obj["name"]): obj for obj in [*old_objects, *result["objects"]]}
    spans = sorted((m.start(), m.end(), obj["name"]) for obj in candidates.values()
                   for m in re.finditer(_pattern(obj["name"]), source))
    chunks = {}
    for index, (_, end, name) in enumerate(spans):
        stop = spans[index + 1][0] if index + 1 < len(spans) else len(message)
        chunks.setdefault(name, []).append(message[end:stop])
    all_normal_pattern = r"(?:по\s+)?всем\s+пунктам\s+чек[ -]?листа\s+(?:все\s+)?(?:норма|normal)|все\s+пункты\s+чек[ -]?листа\s+(?:в\s+норме|норма)"
    global_checklist = bool(not spans and re.search(r"\b(?:всех\s+объектах|всем\s+объектам|все\s+объекты)\b", source)
                            and re.search(all_normal_pattern, source))
    if global_checklist:
        chunks = {obj["name"]: [message] for obj in old_objects}
    token = rf"(?:{NUM}|{ORDER})"
    people = r"(?:человек(?:а|у)?|людей|сотрудник(?:а|ов|у)?)\b"
    amount = re.compile(rf"(?:нужно\s+|нужны\s+|по\s+)?({NUM})\s+{people}")
    sector_pattern = re.compile(rf"(?:(?P<before>{token})\s+сектор[а-я]*|сектор[а-я]*\s+(?P<after>{token}))(?!\w)")
    post_pattern = re.compile(rf"(?<!\w)(?:(?P<before>{token})\s+пост[а-я]*|пост[а-я]*\s+(?P<after>{token}))(?!\w)")
    sub_pattern = re.compile(rf"(?<!\w)(?:(?P<before>{token})\s+подпост[а-я]*|подпост[а-я]*\s+(?P<after>{token}))(?!\w)")

    def no(match):
        value = match.group("before") or match.group("after")
        parsed = number(value)
        return parsed if parsed is not None else ordinal(value)

    def issue(name, text):
        row = {"field": "briefing", "text": f"«{name}»: {text}"}
        if row not in result["issues"]:
            result["issues"].append(row)

    def resolve(predicate):
        for row in [*(previous or {}).get("issues", []), *result["issues"]]:
            if predicate(row["text"]) and row["text"] not in result.get("resolvedIssues", []):
                result.setdefault("resolvedIssues", []).append(row["text"])

    def resized(rows, count, sub=False):
        existing = {row["number"]: row for row in rows}
        return [deepcopy(existing.get(n, {"number": n, "need": None} if sub else
            {"number": n, "need": None, "subpostCount": None, "subposts": []})) for n in range(1, count + 1)]

    for name, fragments in chunks.items():
        text = " ".join(fragments)
        lower = text.casefold().replace("ё", "е")
        old = next((o for o in old_objects if key(o["name"]) == key(name)), {})
        proposed = next((o for o in result["objects"] if key(o["name"]) == key(name)), {})
        obj = deepcopy(old or proposed or {"name": name, "sectors": [], "needStatus": "unknown"})
        obj.update({k: deepcopy(v) for k, v in proposed.items() if v is not None and k != "sectors"})
        explicit_unknown = proposed.get("demandSpecified") is True and proposed.get("personnelNeed") is None
        if explicit_unknown:
            obj["personnelNeed"], obj["needStatus"] = None, "unknown"
        obj["sectors"] = _merge_numbered(old.get("sectors", []), proposed.get("sectors", []), "posts")
        if not obj["sectors"] and proposed.get("sectors"):
            obj["sectors"] = deepcopy(proposed["sectors"])
        mentions = list(sector_pattern.finditer(lower))
        sections = [(no(m), lower[m.end():mentions[i + 1].start() if i + 1 < len(mentions) else len(lower)])
                    for i, m in enumerate(mentions)]
        if not sections:
            sections = [(None, lower)]
        if global_checklist:
            sections = []
        post_scoped_quantity = False
        for sn, body in sections:
            sectors = obj["sectors"] if sn is None else [s for s in obj["sectors"] if s["number"] == sn]
            if sn is not None and not 1 <= sn <= 30:
                continue
            post_count = re.match(rf"\s+({NUM})\s+пост[а-я]*\b", body)
            if sn is not None and post_count and number(post_count.group(1)) <= 200:
                if not sectors:
                    sector = {"number": sn, "postCount": None, "posts": []}
                    obj["sectors"].append(sector)
                    sectors = [sector]
                sectors[0]["postCount"] = number(post_count.group(1))
                sectors[0]["posts"] = resized(sectors[0].get("posts", []), sectors[0]["postCount"])
            bulk_post = re.search(rf"(?:на\s+)?каждом\s+посту\s+(?:нужно\s+)?по\s+({NUM})\s+{people}", body)
            bulk_sub = re.search(rf"(?:на\s+)?каждом\s+подпосту\s+(?:нужно\s+)?по\s+({NUM})\s+{people}", body)
            if bulk_post or bulk_sub:
                post_scoped_quantity = True
                for sector in sectors:
                    for post in sector.get("posts", []):
                        if bulk_post:
                            post["need"] = number(bulk_post.group(1))
                        if bulk_sub:
                            for subpost in post.get("subposts", []):
                                subpost["need"] = number(bulk_sub.group(1))
            post_mentions = list(post_pattern.finditer(body))
            for pi, pm in enumerate(post_mentions):
                pn = no(pm)
                if not pn or not 1 <= pn <= 200:
                    continue
                tail = body[pm.end():post_mentions[pi + 1].start() if pi + 1 < len(post_mentions) else len(body)]
                if len(sectors) != 1:
                    issue(name, f"уточните сектор для поста {pn}.")
                    continue
                post = next((p for p in sectors[0].get("posts", []) if p["number"] == pn), None)
                if post is None:
                    issue(name, f"пост {pn} не указан в структуре сектора {sectors[0]['number']}.")
                    continue
                before_sub = re.split(r"\b(?:на\s+)?подпост[а-я]*\s+", tail, maxsplit=1)[0]
                need = amount.search(before_sub)
                if need:
                    post["need"] = number(need.group(1))
                    post_scoped_quantity = True
                    if sn is not None:
                        resolve(lambda value: value == f"«{name}»: уточните сектор для поста {pn}.")
                sub_count = re.match(rf"\s+(?:(?:имеет|содержит)\s+)?({NUM})\s+подпост[а-я]*\b", tail)
                if sub_count and number(sub_count.group(1)) <= 50:
                    post["subpostCount"] = number(sub_count.group(1))
                    post["subposts"] = resized(post.get("subposts", []), post["subpostCount"], sub=True)
                    if sn is not None:
                        resolve(lambda value: value == f"«{name}»: уточните сектор для поста {pn}.")
                    if sn is not None and pn == 3:
                        resolve(lambda value: key(name) in key(value) and "к какому сектору" in value.casefold()
                                and "третий пост" in value.casefold())
                elif re.match(r"\s+без\s+подпост", tail):
                    post["subpostCount"], post["subposts"] = 0, []
                sub_mentions = list(sub_pattern.finditer(tail))
                for si, sm in enumerate(sub_mentions):
                    sub_tail = tail[sm.end():sub_mentions[si + 1].start() if si + 1 < len(sub_mentions) else len(tail)]
                    sub_need = amount.search(sub_tail)
                    subpost = next((s for s in post.get("subposts", []) if s["number"] == no(sm)), None)
                    if sub_need and subpost is not None:
                        subpost["need"] = number(sub_need.group(1))
                        post_scoped_quantity = True
        # A post-specific amount must never become the object's aggregate.
        if post_scoped_quantity and not explicit_unknown and not amount.search(re.split(r"\b(?:сектор|пост|подпост)[а-я]*\b", lower, maxsplit=1)[0]):
            obj["personnelNeed"] = old.get("personnelNeed")
            obj["needStatus"] = old.get("needStatus", "unknown")
        all_normal = re.search(all_normal_pattern, lower)
        if all_normal and not re.search(r"есть\s+замечани|не\s+(?:по\s+)?(?:все|всем|норма)|кроме|\?", lower):
            obj["checklistResults"] = [{"id": f"checklist-{i}", "state": "NORMAL", "comment": ""} for i in range(5)]
        check_pattern = re.compile(r"пункт(?:а|у|е)?\s+([1-5])\s+чек[ -]?листа\s*[:—–-]?\s*(норма|normal|замечание|не проверен)(?:\s*[:—–-]\s*([^.;]+))?")
        for check in check_pattern.finditer(lower):
            state = "REMARK" if check.group(2) == "замечание" else "UNCHECKED" if check.group(2) == "не проверен" else "NORMAL"
            comment = text[check.start(3):check.end(3)].strip() if check.group(3) else ""
            if state == "REMARK" and not comment:
                issue(name, f"укажите замечание по пункту {check.group(1)} чек-листа.")
                continue
            row = {"id": f"checklist-{int(check.group(1)) - 1}", "state": state, "comment": comment}
            current = {r["id"]: r for r in obj.get("checklistResults", [])}
            current[row["id"]] = row
            obj["checklistResults"] = list(current.values())
        aliases = {
            "подъездные пути и парковка": 0, "подъезд": 0,
            "периметр и ограждение": 1, "периметр": 1, "ограждение": 1,
            "входные группы и кпп": 2, "вход": 2,
            "пути эвакуации": 3, "эвакуация": 3,
            "связь и электропитание": 4, "связь": 4, "электропитание": 4,
        }
        named_check = re.compile(r"(?<!\w)(" + "|".join(re.escape(alias) for alias in sorted(aliases, key=len, reverse=True))
            + r")\s*:?\s+(норма|normal|замечание|не проверен)(?:\s*[:—–-]\s*([^.;]+))?")
        for check in named_check.finditer(lower):
            if lower[check.end():].lstrip().startswith("?"):
                continue
            state = "REMARK" if check.group(2) == "замечание" else "UNCHECKED" if check.group(2) == "не проверен" else "NORMAL"
            comment = text[check.start(3):check.end(3)].strip() if check.group(3) else ""
            if state == "REMARK" and not comment:
                issue(name, f"укажите замечание по пункту «{check.group(1)}» чек-листа.")
                continue
            row = {"id": f"checklist-{aliases[check.group(1)]}", "state": state, "comment": comment}
            current = {r["id"]: r for r in obj.get("checklistResults", [])}
            current[row["id"]] = row
            obj["checklistResults"] = list(current.values())
        if re.search(r"чек[ -]?лист\s+проверен", lower):
            obj["checklistChecked"] = True
        obj["sectors"].sort(key=lambda s: s["number"])
        result["objects"] = [o for o in result["objects"] if key(o["name"]) != key(name)] + [obj]

    foreign = re.search(r"фио\s+иностранного\s+ол\s+([^,.;]+),\s*страна\s+([^,.;]+)", message, re.I)
    if foreign:
        person = {"name": foreign.group(1).strip(), "country": foreign.group(2).strip(),
                  "createIfMissing": bool(re.search(r"(?<!\w)создай(?:те)?\s+(?:такого\s+)?иностранного\s+ол", source))}
        if re.search(r"не\s+созда(?:вай|вайте|ть)|не\s+создай", source):
            person["createIfMissing"] = False
        previous_foreign = [p for p in (previous or {}).get("protectedPersons", [])
                            if not p.get("code") and p.get("name") and p.get("country")]
        another = re.search(r"\b(?:еще|другой|другого|второй|второго|дополнительный|дополнительного)\s+(?:одного\s+)?иностранн[а-я]*\s+ол\b"
                            r"|\b(?:добавь|добавьте|добавить)\s+(?:еще\s+)?(?:одного|другого|второго)\b", source)
        if len(previous_foreign) == 1 and not another:
            result["replaceForeignPerson"] = True
        result["protectedPersons"] = [p for p in result["protectedPersons"] if key(p.get("name", "")) != key(person["name"])] + [person]
        resolve(lambda value: value == "Укажите ФИО и страну иностранного охраняемого лица.")
    if result.get("resolvedIssues"):
        result["issues"] = [issue for issue in result["issues"] if issue["text"] not in result["resolvedIssues"]]
    if not patch and not result["objects"] and not result["protectedPersons"] and not result["issues"]:
        return None
    return validate_briefing(result)
