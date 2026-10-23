"""Read-only composition of canonical duty allocations and saved placements."""
from collections import defaultdict
from datetime import timedelta

from django.db.models import F

from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment, OpsDutyDispatchConfig
from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
from organization_management.apps.operations.models_object import OpsSecurityObject, OpsSecurityPost
from organization_management.apps.operations.models_status import Secondment
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.status_destination import destinations_for
from organization_management.apps.ops.duty_dispatch import DutyContext, interval, receiver
from organization_management.apps.ops.duty_record_access import READ_PERMISSIONS, division_scope, in_scope, public_identifier
from organization_management.apps.ops.security_events import personnel_full_name
from organization_management.apps.statuses.duty_assignments import DUTY_CODES, DUTY_GROUPS, identifier
from organization_management.apps.statuses.duty_intervals import placement_for_roster
from organization_management.apps.ops.api.views_service_combat import _combat_groups_for


def _label(placement):
    """Use frozen names, including after a passport has been replaced."""
    if not isinstance(placement, dict):
        return ""
    place = placement.get("post_name" if placement.get("kind") == "POST" else "group_name")
    return " · ".join(value.strip() for value in (placement.get("object_name"), place)
                      if isinstance(value, str) and value.strip())


def _personnel_id(winner):
    ref = winner.get("source_ref") or ""
    return identifier(ref[10:]) if ref.startswith("personnel:") else None


def _available_dispatch_places(rows):
    """Batch the same active-object/post-membership rule as normalize_assignment."""
    identities = {}
    for row in rows:
        place = row.placement
        if not isinstance(place, dict):
            continue
        object_id = identifier(place.get("object_id"))
        post_id = identifier(place.get("post_id"))
        if object_id is None:
            continue
        if place.get("kind") == "POST" and post_id is not None and not place.get("group_id"):
            identities[row.pk] = (object_id, post_id)
        elif place.get("kind") == "GROUP" and isinstance(place.get("group_id"), str) and place["group_id"] in DUTY_GROUPS and not place.get("post_id"):
            identities[row.pk] = (object_id, None)
    objects = set(OpsSecurityObject.objects.filter(
        pk__in={pair[0] for pair in identities.values()}, object_state=OpsSecurityObject.ObjectState.ACTIVE,
    ).values_list("pk", flat=True))
    posts = dict(OpsSecurityPost.objects.filter(
        pk__in={pair[1] for pair in identities.values() if pair[1]},
    ).values_list("pk", "sector__security_object_id"))
    return {pk for pk, (object_id, post_id) in identities.items()
            if int(object_id) in objects and (post_id is None or posts.get(int(post_id)) == int(object_id))}


def _dispatch_placements(day, context, department, read_scope, dispatch_scope, *, include_places=False):
    if department is None:
        return {}
    start, end = interval(day)
    rows = list(OpsDutyDispatchAssignment.objects.filter(
        cancelled_at__isnull=True, receiver_department_id=department.pk,
        employee_id__gt=0, start_at__lt=end, end_at__gt=start,
    ))
    supplements = {row["source_id"]: row for row in OpsDutyRecordSupplement.objects.filter(
        source_type="DISPATCH", source_id__in=[row.pk for row in rows],
    ).values("source_id", "employee_id", "division_id")}
    readable = []
    for row in rows:
        person = context.people.get(row.employee_id)
        if person is None:
            continue
        staff = getattr(person, "staff_unit", None)
        supplement = supplements.get(row.pk)
        division_id = staff.division_id if staff else None
        if supplement and supplement["employee_id"] is not None:
            # A snapshot never establishes identity by a matching display name.
            if supplement["employee_id"] != row.employee_id:
                continue
            division_id = supplement["division_id"]
        if in_scope(read_scope, division_id) or in_scope(dispatch_scope, row.receiver_department_id):
            readable.append(row)
    available = _available_dispatch_places(readable)
    result = defaultdict(list)
    for row in readable:
        if row.pk not in available:
            continue
        try:
            if context.source_reason(row.employee_id, row.source_status_id, row.start_at, row.end_at):
                continue
            start_at, end_at = Clock.to_local(row.start_at).isoformat(), Clock.to_local(row.end_at).isoformat()
        except (OverflowError, ValueError):
            # Imported timestamps outside the supported local calendar are not
            # current placements; the original journal record remains intact.
            continue
        result[row.employee_id].append({
            "source": "DISPATCH", "source_id": public_identifier(row.pk), "label": _label(row.placement),
            "start_at": start_at, "end_at": end_at, "record_id": f"DISPATCH:{row.pk}",
            **({"_placement": row.placement} if include_places else {}),
        })
    return result


def snapshot(actor, day, *, division_id=None):
    read_scope = division_scope(actor, READ_PERMISSIONS)
    dispatch_scope = PermissionService.visible_division_ids(actor, "duty.dispatch")
    duty_scope = PermissionService.visible_division_ids(actor, "duty.view")
    return _snapshot_for_scopes(day, read_scope=read_scope, dispatch_scope=dispatch_scope,
                                duty_scope=duty_scope, division_id=division_id)


def _snapshot_for_scopes(day, *, read_scope, dispatch_scope, duty_scope, division_id=None, include_places=False):
    """Compose already authorized scopes; private place metadata never leaves snapshot().

    The integration uses this same winner and hourly-placement selection after
    its separate global authorization, then emits only location headcounts.
    """
    config = OpsDutyDispatchConfig.objects.filter(singleton_key=1).first()
    department = receiver(config)
    can_read_queue = department is not None and in_scope(dispatch_scope, department.pk)
    combat_groups = _combat_groups_for(day, duty_scope) if duty_scope is None or duty_scope else []
    if division_id is not None:
        combat_groups = [group for group in combat_groups if group["department_id"] == division_id]
    result = {"business_date": day.isoformat(), "generated_at": Clock.now().isoformat(),
              "time_zone": str(_local_tz()), "departments": [], "combat_groups": combat_groups}
    if read_scope == set() and not can_read_queue:
        return result

    attachments = Secondment.objects.filter(
        in_status__cancelled_at__isnull=True, in_status__period__contains=day,
        in_status__employee_id=F("employee_id"), out_status__employee_id=F("employee_id"),
    ).order_by("id")
    if read_scope is not None:
        attachments = attachments.filter(to_division_id__in=read_scope)
    hosts = dict(attachments.values_list("employee_id", "to_division_id"))
    context = DutyContext(day - timedelta(days=1), day + timedelta(days=1))
    dispatches = _dispatch_placements(day, context, department, read_scope, dispatch_scope, include_places=include_places)
    winners, current_readers = {}, set()
    people = sorted(context.people.values(), key=lambda person: (
        person.staff_unit.position.level if getattr(person, "staff_unit", None) and person.staff_unit.position else float("inf"),
        person.last_name, person.first_name, person.middle_name or "", person.pk,
    ))
    for person in people:
        if not person.is_active or person.pk <= 0:
            continue
        staff = getattr(person, "staff_unit", None)
        if in_scope(read_scope, staff.division_id if staff else None) or person.pk in hosts or can_read_queue:
            current_readers.add(person.pk)
        else:
            # Frozen journal visibility grants access to that historical record,
            # never to a transferred person's live status or personnel data.
            continue
        winner = context.winner(person.pk, day)
        if winner is not None and context.catalog.column[winner["status_type_code"]] == "ON_DUTY":
            winners[person.pk] = winner

    # Keep malformed imported source references out of bigint ORM filters.
    destination_rows = [{**winner, "source_ref": ""} if (winner.get("source_ref") or "").startswith("personnel:")
                        and _personnel_id(winner) is None else winner for winner in winners.values()]
    destinations = destinations_for(destination_rows)
    department_cache = {}

    def department_of(key):
        if key in department_cache:
            return department_cache[key]
        current, seen = key, set()
        while current in context.divisions and current not in seen:
            seen.add(current)
            node = context.divisions[current]
            if node["division_type"] == "department":
                department_cache[key] = current
                return current
            current = node["parent_id"]
        department_cache[key] = 0
        return 0

    groups = {}
    for person in people:
        winner = winners.get(person.pk)
        if winner is None:
            continue
        staff = getattr(person, "staff_unit", None)
        department_id = department_of(hosts.get(person.pk, staff.division_id if staff else None))
        if division_id is not None and department_id != division_id:
            continue
        placements = []
        source_id = _personnel_id(winner)
        if source_id is not None and person.pk in current_readers:
            for source in context.legacy[person.pk]:
                if source.pk == int(source_id) and source.status_type in DUTY_CODES and source.start_date <= day and (source.actual_end_date or source.end_date or day) >= day:
                    place = placement_for_roster(source.duty_assignment, source.start_date, source.actual_end_date or source.end_date)
                    placements.append({"source": "STATUS", "source_id": public_identifier(source.pk),
                        "label": _label(place), "start_at": None, "end_at": None, "record_id": None,
                        **({"intervals": place["intervals"], "time_zone": place["time_zone"]} if "intervals" in place else {}),
                        **({"_placement": place} if include_places else {})})
                    break
        placements.extend(dispatches.get(person.pk, ()))
        group = groups.setdefault(department_id, {"id": public_identifier(department_id),
            "name": context.divisions[department_id]["name"] if department_id else "Без департамента", "employees": []})
        group["employees"].append({"employee_id": public_identifier(person.pk), "full_name": personnel_full_name(person),
            "position_name": staff.position.name if staff and staff.position else "",
            "status_label": context.labels[winner["status_type_code"]], "date_start": winner["date_start"].isoformat(),
            "date_end": winner["date_end"].isoformat(), "destination": destinations.get(winner["id"], ""), "placements": placements})
    order = sorted(groups, key=lambda pk: (context.divisions[pk]["tree_id"], context.divisions[pk]["lft"]) if pk else (float("inf"), 0))
    result["departments"] = [groups[pk] for pk in order]
    return result
