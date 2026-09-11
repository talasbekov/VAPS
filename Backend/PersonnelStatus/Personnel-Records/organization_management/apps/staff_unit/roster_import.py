"""Read-only import plan and atomic reconciliation of an XLSX roster."""

import logging
from collections import Counter
from dataclasses import dataclass, field
from hashlib import sha256

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.db import connection, transaction

from organization_management.apps.dictionaries.management.commands.seed_positions_ranks import (
    POSITIONS,
    RANKS,
)
from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.roster_photos import (
    PhotoError,
    save_photo,
    scan_photos,
)
from organization_management.apps.staff_unit.roster_xlsx import (
    infer_divisions,
    parent_replacement_warnings,
    replace_missing_parents,
)

MODELS = {
    "division": Division,
    "position": Position,
    "rank": Rank,
    "employee": Employee,
    "slot": StaffUnit,
}


@dataclass
class ImportPlan:
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    actions: list = field(default_factory=list)
    tree: dict = field(default_factory=dict)
    photos: dict = field(default_factory=dict)
    parent_replacements: list = field(default_factory=list)
    password_reset: dict = field(default_factory=dict)
    account_logins: list = field(default_factory=list, repr=False)

    def report(self):
        # Do not leak names/IIN through command logs. Row numbers locate input.
        return {
            "photos": self.photos,
            "parent_replacements": self.parent_replacements,
            "password_reset": self.password_reset,
            "errors": self.errors,
            "warnings": self.warnings,
            "divisions": list(self.tree.values()),
            "counts": dict(Counter(a["operation"] for a in self.actions)),
            "actions": [
                {k: a[k] for k in ("entity", "key", "operation", "changed_fields")}
                for a in self.actions
            ],
        }


def add_action(plan, entity, key, obj, data):
    changed = [k for k, v in data.items() if obj is None or getattr(obj, k) != v]
    operation = "create" if obj is None else ("update" if changed else "keep")
    plan.actions.append(
        {
            "entity": entity,
            "key": key,
            "obj": obj,
            "data": data,
            "operation": operation,
            "changed_fields": changed,
        }
    )


def prepare_import(
    roster,
    config=None,
    *,
    match_dictionary_names=False,
    photos_dir=None,
    missing_parent_code=None,
    reset_account_passwords=False,
):
    config = config or {}
    nodes, errors, warnings = infer_divisions(
        roster.rows, explicit_hierarchy=bool(missing_parent_code)
    )
    plan = ImportPlan(
        errors=list(roster.errors) + errors, warnings=list(roster.warnings) + warnings
    )
    if reset_account_passwords:
        plan.password_reset = {
            "scope": "all",
            "accounts": get_user_model().objects.count(),
            "updated": 0,
            "unchanged": 0,
        }
    photos = scan_photos(roster.rows, photos_dir)
    plan.photos = photos.counts
    plan.errors.extend(photos.errors)
    plan.warnings.extend(photos.warnings)
    if plan.errors:
        return plan
    for code, override in config.get("divisions", {}).items():
        if not isinstance(override, dict) or set(override) - {
            "name",
            "division_type",
            "parent_code",
        }:
            plan.errors.append(f"Неверная настройка подразделения {code}.")
            continue
        nodes.setdefault(
            code,
            {
                "code": code,
                "inferred": False,
                "name": "",
                "division_type": None,
                "parent_code": None,
            },
        ).update(override)
    db_divisions = {d.code: d for d in Division.objects.all()}
    mapping = dict(config.get("division_codes", {}))
    # A generated root may already be registered under its real code. Reuse
    # only a unique exact name/type match; never guess between organizations.
    for code, node in nodes.items():
        if (
            code.startswith("XLSX-")
            and code not in mapping
            and code not in db_divisions
        ):
            matches = [
                d
                for d in db_divisions.values()
                if d.name.casefold() == node["name"].casefold()
                and d.division_type == node["division_type"]
            ]
            if len(matches) == 1:
                mapping[code] = matches[0].code
            elif len(matches) > 1:
                plan.errors.append(
                    f"Неоднозначное подразделение {code}; задайте division_codes."
                )
    remapped = {}
    for code, node in nodes.items():
        node = dict(
            node,
            code=mapping.get(code, code),
            parent_code=mapping.get(node["parent_code"], node["parent_code"]),
        )
        if node["code"] in remapped and node != remapped[node["code"]]:
            plan.errors.append(
                f"Несколько подразделений сопоставлены одному коду {node['code']}."
            )
        remapped[node["code"]] = node
    nodes = remapped
    changes, errors = replace_missing_parents(
        nodes,
        set(nodes) | set(db_divisions),
        mapping.get(missing_parent_code, missing_parent_code),
    )
    plan.parent_replacements = changes
    plan.errors.extend(errors)
    plan.warnings.extend(parent_replacement_warnings(changes))
    changed_parents = {c["code"] for c in changes}
    plan.tree = nodes
    # Validate the complete graph, including existing ancestors of a partial export.
    parents = {code: d.parent_id and d.parent.code for code, d in db_divisions.items()}
    parents.update({code: n["parent_code"] for code, n in nodes.items()})
    for code, node in nodes.items():
        obj = db_divisions.get(code)
        if not node["division_type"] and obj:
            node["division_type"] = obj.division_type
        if not node["name"] or len(node["name"]) > 255 or len(code) > 50:
            plan.errors.append(f"Некорректное название/код подразделения {code}.")
        if node["division_type"] not in Division.DivisionType.values:
            plan.errors.append(
                f"Для подразделения {code} нужен division_type в config.divisions."
            )
        parent = node["parent_code"]
        if parent and parent not in parents:
            plan.errors.append(
                f"Не найден родитель {parent} подразделения {code}; добавьте config.divisions."
            )
        visited, cursor = set(), code
        while cursor:
            if cursor in visited:
                plan.errors.append(f"Цикл подразделений от {code}.")
                break
            visited.add(cursor)
            cursor = parents.get(cursor)
        if obj:
            if obj.archived_at or not obj.is_active:
                plan.errors.append(f"Подразделение {code} неактивно/архивировано.")
            # An explicit config entry is the way to confirm renamed/reparented
            # existing nodes. Inferred grammar alone must not change live scope.
            explicit = any(
                mapping.get(k, k) == code for k in config.get("divisions", {})
            )
            if (
                not explicit
                and code not in changed_parents
                and (obj.parent.code if obj.parent_id else None) != parent
            ):
                plan.errors.append(
                    f"Родитель существующего подразделения {code} отличается; подтвердите через config.divisions."
                )
            if not explicit and obj.name.casefold() != node["name"].casefold():
                source_names = [
                    r["division_name"].casefold()
                    for r in roster.rows
                    if mapping.get(r["division_code"], r["division_code"]) == code
                ]
                if obj.name.casefold() in source_names:
                    node["name"] = obj.name
                else:
                    plan.errors.append(
                        f"Название существующего подразделения {code} отличается; подтвердите через config.divisions."
                    )
    # Unique sibling names must be checked before writing any part of the tree.
    siblings = {}
    for code, parent_code in parents.items():
        name = nodes[code]["name"] if code in nodes else db_divisions[code].name
        pair = (parent_code, name.casefold())
        if pair in siblings and siblings[pair] != code:
            plan.errors.append(
                f"Дублирующееся название подразделения: коды {siblings[pair]}/{code}; задайте division_codes."
            )
        siblings[pair] = code
    pending = dict(nodes)
    while pending and not plan.errors:
        ready = [c for c, n in pending.items() if n["parent_code"] not in pending]
        if not ready:
            break
        for code in ready:
            node = pending.pop(code)
            obj = db_divisions.get(code)
            # References resolve to persisted objects only at apply time.
            add_action(
                plan,
                "division",
                code,
                obj,
                {"name": node["name"], "division_type": node["division_type"]},
            )
            action = plan.actions[-1]
            action["parent_code"] = node["parent_code"]
            if (
                obj
                and (obj.parent.code if obj.parent_id else None) != node["parent_code"]
            ):
                action["operation"] = "update"
                action["changed_fields"].append("parent")
    dictionaries = {}
    for entity, code_key, name_key, model, defaults in [
        ("position", "position_code", "position_name", Position, POSITIONS),
        ("rank", "rank_code", "rank_name", Rank, RANKS),
    ]:
        existing = {o.code: o for o in model.objects.all()}
        aliases = config.get(entity + "_codes", {})
        levels = config.get(entity + "_levels", {})
        default_levels = {name.casefold(): level for _, name, level in defaults}
        definitions = {r[code_key]: r[name_key] for r in roster.rows if r[code_key]}
        targets = {}
        planned_rank_names = {}
        for original, name in definitions.items():
            code = aliases.get(original, original)
            obj = existing.get(code)
            by_name = [
                o for o in existing.values() if o.name.casefold() == name.casefold()
            ]
            if (
                match_dictionary_names
                and original not in aliases
                and obj is None
                and len(by_name) == 1
            ):
                obj = by_name[0]
                code = obj.code
                plan.warnings.append(
                    f"{entity} {original}: по единственному точному названию используется существующий код {code}."
                )
            if code in targets and targets[code] != original:
                plan.errors.append(
                    f"Несколько кодов {entity} сопоставлены одному {code}."
                )
            targets[code] = original
            if obj is None and by_name:
                candidates = ", ".join(sorted(o.code for o in by_name))
                plan.errors.append(
                    f"{entity} {original}: название уже существует с другим кодом; "
                    f"найденные коды: {candidates}; задайте {entity}_codes."
                )
            if (
                obj
                and obj.name.casefold() != name.casefold()
                and original not in aliases
            ):
                plan.errors.append(
                    f"{entity} {original}: название отличается от справочника; задайте {entity}_codes для явного сопоставления."
                )
            if entity == "rank":
                target_name = (obj.name if obj else name).casefold()
                previous = planned_rank_names.get(target_name)
                if previous is not None and previous != code:
                    plan.errors.append(
                        f"rank {original}: название уже запланировано с другим кодом {previous}."
                    )
                planned_rank_names[target_name] = code
            rank_base = (
                name.casefold().removesuffix(" сго рк")
                if entity == "rank"
                else name.casefold()
            )
            level = levels.get(
                original, obj.level if obj else default_levels.get(rank_base, 32767)
            )
            if (
                isinstance(level, bool)
                or not isinstance(level, int)
                or not 0 <= level <= 32767
            ):
                plan.errors.append(
                    f"{entity} {original}: уровень должен быть целым 0..32767."
                )
                level = 32767
            if level == 32767:
                plan.warnings.append(
                    f"{entity} {original}: старшинство не определено, уровень 32767; настройте {entity}_levels."
                )
            add_action(
                plan,
                entity,
                original,
                obj,
                {"name": obj.name if obj else name, "level": level},
            )
            plan.actions[-1]["code"] = code
            dictionaries[(entity, original)] = obj
    employees = list(Employee.objects.all())
    by_external = {e.external_id: e for e in employees if e.external_id}
    by_iin = {e.iin: e for e in employees if e.iin}
    units = list(StaffUnit.objects.select_related("employee"))
    units_external = {u.external_id: u for u in units if u.external_id}
    assigned = {u.employee_id: u for u in units if u.employee_id}
    used_people, used_slots = set(), set()
    personnel_numbers = {e.personnel_number for e in employees}
    for row in roster.rows:
        person, slot_key = row["person_id"], row["slot_code"]
        employee = None
        if person:
            employee = by_external.get(person)
            iin_match = by_iin.get(row["iin"]) if row["iin"] else None
            if employee and iin_match and employee.pk != iin_match.pk:
                plan.errors.append(
                    f"Строка {row['row_number']}: ИИН принадлежит другому сотруднику."
                )
            if employee and employee.iin and row["iin"] and employee.iin != row["iin"]:
                plan.errors.append(
                    f"Строка {row['row_number']}: ИИН не совпадает с существующим personId."
                )
            if not employee and iin_match:
                # IIN is the identity; source IDs and names may have changed.
                employee = iin_match
            if employee:
                if employee.pk in used_people:
                    plan.errors.append(
                        f"Строка {row['row_number']}: повторное сопоставление сотрудника."
                    )
                used_people.add(employee.pk)
                if (
                    not employee.is_active
                    or employee.employment_status != "working"
                    or employee.archived_at
                    or employee.dismissal_date
                ):
                    plan.errors.append(
                        f"Строка {row['row_number']}: сотрудник уволен/неактивен/архивирован."
                    )
            values = {k: row[k] for k in ("last_name", "first_name", "middle_name")}
            values["external_id"] = person
            if row["iin"] or not employee:
                values["iin"] = row["iin"]
            if not employee:
                number = "XLSX-" + person
                if len(number) > 20:
                    number = "XLSH-" + sha256(person.encode()).hexdigest()[:15]
                if number in personnel_numbers:
                    plan.errors.append(
                        f"Строка {row['row_number']}: конфликт внутреннего табельного номера."
                    )
                personnel_numbers.add(number)
                values.update(
                    personnel_number=number,
                    birth_date=None,
                    hire_date=None,
                    gender=None,
                )
            rank = dictionaries.get(("rank", row["rank_code"]))
            values["rank_id"] = rank.pk if rank else None
            add_action(plan, "employee", person, employee, values)
            action = plan.actions[-1]
            action["rank_code"] = row["rank_code"]
            photo = photos.people.get(person)
            if photo and (not employee or not photo.matches(employee.photo)):
                action["photo"] = photo
                action["changed_fields"].append("photo")
                if employee:
                    action["operation"] = "update"
            if employee and row["rank_code"] and not rank:
                action["operation"] = "update"
                if "rank_id" not in action["changed_fields"]:
                    action["changed_fields"].append("rank_id")
        unit = units_external.get(slot_key)
        division_code = mapping.get(row["division_code"], row["division_code"])
        division = db_divisions.get(division_code)
        position = dictionaries.get(("position", row["position_code"]))
        if unit is None and division and position:
            matches = [
                u
                for u in units
                if u.index == int(slot_key)
                and u.division_id == division.pk
                and u.position_id == position.pk
            ]
            if len(matches) > 1 or any(u.external_id for u in matches):
                plan.errors.append(
                    f"Строка {row['row_number']}: неоднозначная штатная единица."
                )
            elif matches:
                unit = matches[0]
        if unit and unit.pk in used_slots:
            plan.errors.append(
                f"Строка {row['row_number']}: повторное сопоставление штатной единицы."
            )
        if unit:
            used_slots.add(unit.pk)
        if (
            unit
            and unit.employee_id
            and (not employee or unit.employee_id != employee.pk)
        ):
            plan.errors.append(
                f"Строка {row['row_number']}: штатная единица занята другим сотрудником; сначала оформите освобождение."
            )
        if (
            unit
            and unit.employee_id
            and (
                division is None
                or position is None
                or unit.division_id != division.pk
                or unit.position_id != position.pk
            )
        ):
            plan.errors.append(
                f"Строка {row['row_number']}: меняется подразделение/должность занятой штатной единицы; сначала оформите перевод."
            )
        if employee and employee.pk in assigned and assigned[employee.pk] != unit:
            plan.errors.append(
                f"Строка {row['row_number']}: сотрудник уже назначен на другую штатную единицу; сначала оформите перевод."
            )
        if unit and unit.vacancy_id and person:
            plan.errors.append(
                f"Строка {row['row_number']}: у единицы есть карточка вакансии; сначала оформите её закрытие."
            )
        values = {
            "external_id": slot_key,
            "index": int(slot_key),
            "import_order": row["order"],
            "position_category": row["category"],
            "division_id": division.pk if division else None,
            "position_id": position.pk if position else None,
            "employee_id": employee.pk if employee else None,
        }
        add_action(plan, "slot", slot_key, unit, values)
        action = plan.actions[-1]
        action.update(
            division_code=division_code,
            position_code=row["position_code"],
            person_id=person,
        )
        if unit and person and not employee:
            action["operation"] = "update"
            action["changed_fields"].append("employee_id")
    return plan


def apply_import(
    roster,
    config=None,
    *,
    match_dictionary_names=False,
    photos_dir=None,
    missing_parent_code=None,
    account_password=None,
):
    created_files = []
    try:
        return _apply_import(
            roster,
            config,
            match_dictionary_names=match_dictionary_names,
            photos_dir=photos_dir,
            missing_parent_code=missing_parent_code,
            account_password=account_password,
            created_files=created_files,
        )
    except BaseException:
        # Files are not transactional. Remove only new files created by this run;
        # previous photos stay available, including for database backup restore.
        for storage, name in created_files:
            try:
                storage.delete(name)
            except OSError:
                logging.getLogger(__name__).warning(
                    "Не удалось удалить новое фото после отмены импорта."
                )
        raise


def _apply_import(
    roster,
    config,
    *,
    match_dictionary_names,
    photos_dir,
    missing_parent_code,
    account_password,
    created_files,
):
    """Re-plan under a transaction: stale previews are never applied blindly."""
    with transaction.atomic():
        with connection.cursor() as cursor:
            if connection.vendor == "postgresql":
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [11750001])
                # Lock related tables against concurrent manual/API writes while
                # reconciling identities; all locks last only this transaction.
                tables = [
                    MODELS[k]._meta.db_table
                    for k in ("division", "position", "rank", "employee", "slot")
                ]
                if account_password is not None:
                    tables.append(get_user_model()._meta.db_table)
                names = ", ".join(connection.ops.quote_name(name) for name in tables)
                cursor.execute(f"LOCK TABLE {names} IN SHARE ROW EXCLUSIVE MODE")
        plan = prepare_import(
            roster,
            config,
            match_dictionary_names=match_dictionary_names,
            photos_dir=photos_dir,
            missing_parent_code=missing_parent_code,
            reset_account_passwords=account_password is not None,
        )
        if plan.errors:
            return plan
        objects = {
            "division": {d.code: d for d in Division.objects.all()},
            "position": {},
            "rank": {},
            "employee": {},
            "slot": {},
        }
        created_employees = []
        for action in plan.actions:
            entity, key = action["entity"], action["key"]
            obj, values = action["obj"], dict(action["data"])
            if entity == "division":
                parent = objects["division"].get(action["parent_code"])
                values["parent_id"] = parent.pk if parent else None
            if entity == "employee":
                rank = objects["rank"].get(action["rank_code"])
                values["rank_id"] = rank.pk if rank else None
            if entity == "slot":
                values["division_id"] = objects["division"][action["division_code"]].pk
                values["position_id"] = objects["position"][action["position_code"]].pk
                employee = objects["employee"].get(action["person_id"])
                values["employee_id"] = employee.pk if employee else None
            if entity == "employee" and action.get("photo"):
                photo = action["photo"]
                storage = Employee._meta.get_field("photo").storage
                try:
                    name = save_photo(photo, storage)
                except OSError as exc:
                    raise PhotoError(
                        "Не удалось сохранить фото; импорт отменён."
                    ) from exc
                created_files.append((storage, name))
                values["photo"] = name
            if obj is None:
                if entity in ("division", "position", "rank"):
                    values["code"] = action.get("code", key)
                obj = MODELS[entity](**values)
                obj.full_clean()
                obj.save()
                if entity == "employee":
                    created_employees.append(obj)
            elif any(getattr(obj, k) != v for k, v in values.items()):
                for k, v in values.items():
                    setattr(obj, k, v)
                obj.full_clean()
                obj.save()
            objects[entity][key] = obj
        # Statuses participate in this same transaction; post_commit callbacks
        # then see an existing status and are no-ops, not a partial-success risk.
        from organization_management.apps.statuses.services import ensure_active_status

        for employee in created_employees:
            ensure_active_status(employee)
        if account_password is not None:
            from organization_management.apps.operations import audit_service

            users = get_user_model().objects.select_for_update().order_by("pk")
            for user in users:
                plan.account_logins.append(user.get_username())
                # No setter: an already matching hash must remain byte-identical.
                if check_password(account_password, user.password):
                    plan.password_reset["unchanged"] += 1
                    continue
                user.set_password(account_password)
                user.save(update_fields=["password"])
                audit_service.record(
                    actor="staffing-import",
                    action=audit_service.ACCESS_ACCOUNT_PASSWORD_RESET,
                    entity_type=audit_service.ENTITY_ACCOUNT,
                    entity_id=user.pk,
                    new_value={"source": "staffing-import"},
                )
                plan.password_reset["updated"] += 1
        return plan
