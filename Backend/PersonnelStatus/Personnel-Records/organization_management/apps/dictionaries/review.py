"""Shared dictionary review: bilingual similarity, audit details and replacement families."""
from difflib import SequenceMatcher
import unicodedata
from django.contrib.auth import get_user_model
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.exceptions import DomainError


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def similar_rows(rows, *names):
    needles = [normalized(name) for name in names if normalized(name)]
    results = []
    for row in rows:
        labels = [normalized(row.get(key)) for key in ("label", "labelKk", "name", "name_kk")]
        if any(a == b or (min(len(a), len(b)) >= 4 and SequenceMatcher(None, a, b).ratio() >= .85)
               for a in needles for b in labels if b):
            results.append(row)
    return results[:20]


def require_similarity_confirmation(rows, names, confirmed):
    if confirmed is True:
        return
    matches = similar_rows(rows, *names)
    if matches:
        raise DomainError("DICTIONARY_SIMILAR_ENTRIES", 409,
                          detail={"similarEntries": matches},
                          message="Найдены похожие записи. Используйте существующую или подтвердите создание.")


def change_metadata(entity_type, ids):
    logs = list(OpsAuditLog.objects.filter(entity_type=entity_type, entity_id__in=ids)
                .order_by("entity_id", "-created_at", "-id").distinct("entity_id"))
    actors = {log.actor_user_id for log in logs if log.actor_user_id.isdigit()}
    users = get_user_model().objects.filter(pk__in=actors).select_related("employee")
    names = {}
    for user in users:
        employee = getattr(user, "employee", None)
        names[str(user.pk)] = (" ".join(filter(None, [employee.last_name, employee.first_name, employee.middle_name]))
                              if employee else user.get_full_name() or user.username)
    return {log.entity_id: {"operation": ("DICTIONARY_ENTRY_SUPERSEDED" if
                            log.action == "DICTIONARY_ENTRY_CREATED" and (log.new_value or {}).get("supersedes") else log.action), "at": log.created_at.isoformat(),
                            "actor": names.get(log.actor_user_id, log.actor_user_id)} for log in logs}


def add_replacement_families(rows, *, predecessor_key, active_key):
    by_id = {str(row["id"]): row for row in rows}
    families = {}
    for row in rows:
        root = row
        seen = set()
        while str(root["id"]) not in seen:
            seen.add(str(root["id"]))
            previous = root.get(predecessor_key)
            previous = previous.get("id") if isinstance(previous, dict) else previous
            if previous is None or str(previous) not in by_id:
                break
            root = by_id[str(previous)]
        families.setdefault(str(root["id"]), []).append(row)
    for root_id, members in families.items():
        current = next((row for row in members if row.get(active_key)), members[-1])
        summary = {"rootId": root_id, "currentId": str(current["id"]),
                   "memberIds": [str(row["id"]) for row in members],
                   "totalCount": sum(row["usage"]["totalCount"] for row in members)}
        for row in members:
            row["replacementFamily"] = summary
    return rows
