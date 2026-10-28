"""Resolve a reviewed briefing and apply it through the original actor's APIs."""
from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

from django.db import transaction
from django.db.models import Q

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.services import PermissionService


def resolve_briefing_references(briefing, *, actor_id):
    """Only minimal catalogs already readable by this actor are consulted."""
    clean, questions = deepcopy(briefing), []
    permissions = PermissionService.effective_permissions(actor_id)
    for index, row in enumerate(clean.get("objects", [])):
        from organization_management.apps.ops.security_events import TEMPLATE_CHECK_IDS
        results = row.get("checklistResults", [])
        ids = [item.get("id") for item in results]
        if len(ids) != len(set(ids)) or set(ids) - TEMPLATE_CHECK_IDS:
            questions.append({"field": f"briefing.objects.{index}.checklistResults",
                              "text": f"«{row.get('name', '')}»: уточните результаты чек-листа — указан неизвестный или повторённый пункт."})
        name = str(row.get("chiefName") or "").strip()
        identifier = row.get("chiefEmployeeId")
        if not name and not identifier:
            continue
        field = f"briefing.objects.{index}.chiefName"
        if not permissions & {"*", "event.create", "event.manage"}:
            row.pop("chiefEmployeeId", None)
            questions.append({"field": field, "text": f"Для подбора старшего «{row.get('name', '')}» нужен доступ к кадровому списку ОМ."})
            continue
        candidates = Employee.objects.filter(is_active=True)
        if name:
            for token in name.split():
                candidates = candidates.filter(Q(last_name__iexact=token) | Q(first_name__iexact=token) | Q(middle_name__iexact=token))
        else:
            candidates = candidates.filter(pk=identifier) if str(identifier).isdigit() else candidates.none()
        matches = list(candidates.values_list("pk", flat=True)[:2])
        if len(matches) == 1:
            row["chiefEmployeeId"] = str(matches[0])
        else:
            row.pop("chiefEmployeeId", None)
            questions.append({"field": field, "text": f"Уточните старшего объекта «{row.get('name', '')}»: «{name}» не найден однозначно среди действующих сотрудников."})
    for index, row in enumerate(clean.get("protectedPersons", [])):
        field = f"briefing.protectedPersons.{index}"
        if not permissions & {"*", "catalog.view"}:
            row.pop("personId", None)
            questions.append({"field": field, "text": "Для выбора охраняемого лица нужен доступ к его справочнику."})
            continue
        identifier, code = row.get("personId"), str(row.get("code") or "").strip()
        name, country = str(row.get("name") or "").strip(), str(row.get("country") or "").strip()
        candidates = OpsProtectedPerson.objects.all()
        if code:
            # A spoken code/callsign is not a database primary key.
            candidates = candidates.filter(Q(code__iexact=code) | Q(callsign__iexact=code))
        elif name:
            candidates = candidates.filter(name__iexact=name)
            if country:
                candidates = candidates.filter(country__iexact=country)
        elif identifier:
            candidates = candidates.filter(pk=identifier) if str(identifier).isdigit() else candidates.none()
        else:
            candidates = candidates.none()
        matches = list(candidates.only("id", "is_active", "category")[:2])
        expects_foreign = bool(name and country and row.get("createIfMissing") is True)
        if len(matches) == 1 and matches[0].is_active and (not expects_foreign or matches[0].category == "FOREIGN"):
            row["personId"] = str(matches[0].pk)
        elif not matches and row.get("createIfMissing") is True and name and country and not identifier:
            row["personId"] = None
        else:
            row.pop("personId", None)
            questions.append({"field": field, "text": f"Уточните охраняемое лицо «{code or name or 'иностранное ОЛ'}»: нет однозначной действующей записи справочника."})
    return clean, questions


def _recon_state(event, visit_id):
    visit = next(row for row in event.get("visitObjects", []) if str(row["id"]) == str(visit_id))
    return {"rows": [row for row in event.get("reconSectorPosts", []) if str(row.get("visitObjectId")) == str(visit_id)],
            "checklist": visit.get("reconChecklist", []), "forceRequest": visit.get("reconForceRequest")}


def can_resume_briefing(event, pending):
    if not event:
        return False
    for row in pending or []:
        if row.get("action") in {"visit_object_add", "visit_object_chief"} and event.get("canManageVisitObjects"):
            return True
        if row.get("action") == "recon" and any(
                str(visit.get("objectId")) == str(row.get("objectId")) and visit.get("canManageRecon")
                for visit in event.get("visitObjects", [])):
            return True
    return False


def prepare_creation(request, task, payload):
    """No foreign catalog mutation occurs until all references resolve."""
    from .execution import call_manual, _save_receipt, invalid
    from organization_management.apps.operations.api.permissions import resolve_actor_id

    briefing, questions = resolve_briefing_references(task.plan["briefing"], actor_id=resolve_actor_id(request))
    task.plan["briefing"] = briefing
    if questions:
        task.plan["questions"] = [*task.plan.get("questions", []), *questions]
        return None
    people = []
    for index, row in enumerate(briefing.get("protectedPersons", [])):
        person_id = row.get("personId")
        if not person_id:
            if task.plan.get("kind") != "FOREIGN" or row.get("createIfMissing") is not True:
                invalid("Создание иностранного ОЛ нужно поручить явно.", "briefing")
            creation = {"name": row["name"], "country": row["country"], "category": "FOREIGN"}
            person = call_manual(request, "protected_person_create", payload=creation)
            person_id = str(person["id"])
            row["personId"] = person_id
            _save_receipt(task, f"briefing:person:{index}", creation, {"personId": person_id}, request)
        if str(person_id) not in people:
            people.append(str(person_id))
    if people:
        payload["protectedPersonIds"] = people
    objects = briefing.get("objects", [])
    if objects:
        first_id = objects[0].get("objectId")
        if not first_id:
            invalid("Выберите объект из реестра.", "briefing")
        payload["objectId"] = str(first_id)
    task.plan["committedBriefing"] = deepcopy(briefing)
    return payload


def _post_rows(task, obj, visit_id):
    """Return no operational rows if any per-post amount is still unknown."""
    rows = []
    for sector in obj.get("sectors", []):
        for post in sector.get("posts", []):
            if type(post.get("need")) is not int or post["need"] < 1:
                return None
            subposts = post.get("subposts", [])
            if len(subposts) != post.get("subpostCount", 0):
                return None
            identity = f"{task.pk}:{obj['objectId']}:{sector['number']}:{post['number']}"
            parent = str(uuid5(NAMESPACE_URL, identity))
            base = {"sector": f"Сектор {sector['number']}", "task": "", "requirements": "",
                    "result": None, "comment": "", "sourceSectorId": None,
                    "sourcePostId": None, "minRating": None, "visitObjectId": str(visit_id)}
            rows.append({**base, "id": parent, "post": f"Пост {post['number']}", "need": post["need"]})
            for subpost in subposts:
                if type(subpost.get("need")) is not int or subpost["need"] < 1:
                    return None
                rows.append({**base, "id": str(uuid5(NAMESPACE_URL, identity + ":" + str(subpost["number"]))),
                             "post": f"Подпост {post['number']}.{subpost['number']}",
                             "parentPostId": parent, "need": subpost["need"]})
    return rows


def apply_briefing(request, task, event):
    """Apply allowed draft actions; denied steps remain explicit, never impersonated."""
    from .execution import call_manual, _save_receipt, digest, conflict, ManualActionFailed

    briefing = task.plan.get("briefing")
    if not briefing:
        return event
    pending = []

    def defer(obj, action, reason):
        pending.append({"objectId": obj.get("objectId"), "objectName": obj.get("name"), "action": action, "reason": reason})

    created = task.receipts.filter(operation_key="create_bulletin").first()
    if not created or not created.result.get("briefing"):
        defer({}, "existing_event", "Сведения сохранены в поручении. Изменения существующего ОМ проверьте в его карточке.")
        task.plan["briefingPending"] = pending
        return event
    if task.plan.get("committedBriefing") != briefing:
        conflict()

    def execute(obj, action, key, payload, *, visit_id=None):
        nonlocal event
        prior = task.receipts.filter(operation_key=key).first()
        if prior:
            if prior.payload_hash != digest(payload):
                conflict()
            return True
        try:
            with transaction.atomic():
                event = call_manual(request, action, event_id=task.event_id, visit_object_id=visit_id, payload=payload)
                result = {"eventId": str(task.event_id), "objectId": obj.get("objectId"), "visitObjectId": str(visit_id) if visit_id else None}
                if action == "recon":
                    result["reconFingerprint"] = digest(_recon_state(event, payload["visitObjectId"]))
                _save_receipt(task, key, payload, result, request)
            return True
        except ManualActionFailed as error:
            if error.response.status_code != 403:
                raise
            reason = ("Добавление объекта выполняет уполномоченный руководитель или старший мероприятия."
                      if action == "visit_object_add" else "Назначение старшего выполняет уполномоченный руководитель или старший мероприятия."
                      if action == "visit_object_chief" else "Расчёт и результаты осмотра сохраняет назначенный старший этого объекта или руководство с соответствующим правом.")
            defer(obj, action, reason)
            return False

    for index, obj in enumerate(briefing.get("objects", [])):
        object_id = str(obj.get("objectId") or "")
        visit = next((row for row in event.get("visitObjects", []) if str(row.get("objectId")) == object_id), None)
        object_key = f"briefing:object:{object_id}"
        if visit is None:
            # The first visit was committed by create_bulletin itself. A later
            # manual removal must never be mistaken for an unfinished add step.
            if index == 0 or task.receipts.filter(operation_key=object_key).exists():
                conflict()
            if not execute(obj, "visit_object_add", object_key, {"objectId": object_id}):
                continue
            visit = next((row for row in event.get("visitObjects", []) if str(row.get("objectId")) == object_id), None)
        if visit is None:
            conflict()
        visit_id = str(visit["id"])
        chief_id = obj.get("chiefEmployeeId")
        chief_key = object_key + ":chief"
        if chief_id:
            if task.receipts.filter(operation_key=chief_key).exists() and str(visit.get("chiefEmployeeId")) != str(chief_id):
                conflict()
            if str(visit.get("chiefEmployeeId")) != str(chief_id):
                execute(obj, "visit_object_chief", chief_key, {"employeeId": str(chief_id)}, visit_id=visit_id)
        has_recon = bool(obj.get("sectors") or obj.get("checklistChecked") is not None or obj.get("checklistResults"))
        if not has_recon:
            continue
        visit = next(row for row in event["visitObjects"] if str(row["id"]) == visit_id)
        recon_key = object_key + ":recon"
        prior_recon = task.receipts.filter(operation_key=recon_key).first()
        if prior_recon:
            if prior_recon.result.get("reconFingerprint") != digest(_recon_state(event, visit_id)):
                conflict()
            continue
        if not visit.get("canManageRecon"):
            defer(obj, "recon", "Расчёт и результаты осмотра должен проверить и сохранить назначенный старший этого объекта.")
            continue
        rows = _post_rows(task, obj, visit_id)
        if rows is None:
            defer(obj, "recon", "Уточните численность каждого поста и подпоста; общее число по объекту не распределяется автоматически.")
            continue
        if not obj.get("sectors"):
            # A checklist-only proposal never removes an existing calculation.
            rows = [row for row in event.get("reconSectorPosts", []) if str(row.get("visitObjectId")) == visit_id]
        checklist = list(visit.get("reconChecklist", []))
        results = obj.get("checklistResults")
        if results:
            by_id = {row["id"]: row for row in results}
            checklist = [{**row, **by_id.get(row["id"], {})} for row in checklist]
        elif obj.get("checklistChecked") is True:
            defer(obj, "checklist", "Проверка заявлена. Уточните результаты: норма или замечания по пунктам; отметка «проверено» не означает «без замечаний».")
        other_posts = [row for row in event.get("reconSectorPosts", []) if str(row.get("visitObjectId")) != visit_id]
        payload = {"visitObjectId": visit_id, "checklist": checklist, "sectorPosts": other_posts + rows}
        if obj.get("needStatus") == "known" and type(obj.get("personnelNeed")) is int:
            payload["forceRequest"] = obj["personnelNeed"]
        # A finished operation is never replayed with a new whole-event payload.
        if not task.receipts.filter(operation_key=recon_key).exists():
            execute(obj, "recon", recon_key, payload)
    task.plan["briefingPending"] = pending
    return event
