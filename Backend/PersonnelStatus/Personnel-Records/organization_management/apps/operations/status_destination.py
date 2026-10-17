"""Batch destination reads shared by status responses and immutable snapshots."""
from django.db.models import Q


def destinations_for(rows, *, event_index=None):
    """Return {status_id: destination}; source queries are bounded per batch.

    Personnel locations and secondment destinations belong to their source
    records. They are copied into submissions, never looked up when rendering
    an already submitted day. A user-entered status comment is the fallback.
    """
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.statuses.models import EmployeeStatus
    from organization_management.apps.operations.models_status import Secondment, OpsStatusParticipation
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    rows = [row if isinstance(row, dict) else {
        "id": row.pk, "employee_id": row.employee_id,
        "source_ref": row.source_ref, "comment": row.comment,
    } for row in rows]
    result = {row["id"]: (row.get("comment") or "").strip() for row in rows}
    known_destinations = set()
    personnel_ids = {}
    for row in rows:
        ref = row.get("source_ref") or ""
        if ref.startswith("personnel:") and ref[10:].isdigit():
            personnel_ids[row["id"]] = int(ref[10:])
    sources = {}
    if personnel_ids:
        sources = {row["id"]: row for row in EmployeeStatus.objects.filter(
            pk__in=set(personnel_ids.values())
        ).values("id", "employee_id", "status_type", "location",
                 "related_division_id", "related_division__name", "employee__staff_unit__division_id")}
    for row in rows:
        source = sources.get(personnel_ids.get(row["id"]))
        if source and source["employee_id"] == row["employee_id"]:
            # Ordinary dialogs also send the employee's own division here.
            # An outgoing secondment's related division is a destination only
            # when it differs from the employee's own staff division.
            receiving = source["related_division__name"] if source["status_type"] in {
                EmployeeStatus.StatusType.SECONDED_TO, "DETACHED", "SECONDED_TO",
            } and source["related_division_id"] != source["employee__staff_unit__division_id"] else ""
            result[row["id"]] = (source["location"] or receiving or "").strip()
            if result[row["id"]]:
                known_destinations.add(row["id"])

    ids = [row["id"] for row in rows]
    if not ids:
        return result
    pairs = list(Secondment.objects.filter(
        Q(out_status_id__in=ids) | Q(in_status_id__in=ids)
    ).values("out_status_id", "in_status_id", "to_division_id"))
    division_names = dict(Division.objects.filter(
        pk__in={pair["to_division_id"] for pair in pairs}
    ).values_list("pk", "name")) if pairs else {}
    for pair in pairs:
        for key in ("out_status_id", "in_status_id"):
            if pair[key] in result:
                result[pair[key]] = division_names.get(pair["to_division_id"], "")
                if result[pair[key]]:
                    known_destinations.add(pair[key])

    participations = list(OpsStatusParticipation.objects.filter(
        status_id__in=ids
    ).order_by("id").values("status_id", "event_id"))
    event_ids = {part["event_id"] for part in participations if part["event_id"]}
    events = event_index
    if events is None:
        events = {
            event.pk: event for event in OpsSecurityEvent.objects.filter(pk__in=event_ids)
            .only("id", "title", "code", "object_name", "placement_assignments", "recon_sector_posts")
            .prefetch_related("visit_objects")
        } if event_ids else {}
    people = {row["id"]: str(row["employee_id"]) for row in rows}
    event_places = {}
    for part in participations:
        event = events.get(part["event_id"])
        if event is None:
            continue
        assignment = next((item for item in (event.placement_assignments or [])
                           if str(item.get("employeeId")) == people[part["status_id"]]), {})
        post = next((item for item in (event.recon_sector_posts or [])
                     if str(item.get("id")) == str(assignment.get("postId"))), {})
        visit = next((visit for visit in event.visit_objects.all()
                      if str(visit.pk) == str(post.get("visitObjectId"))), None)
        destination = visit.object_name if visit else (event.object_name or event.title or event.code)
        places = event_places.setdefault(part["status_id"], [])
        if destination and destination not in places:
            places.append(destination)
    for status_id, places in event_places.items():
        if status_id not in known_destinations:
            result[status_id] = "; ".join(places)
    return result
