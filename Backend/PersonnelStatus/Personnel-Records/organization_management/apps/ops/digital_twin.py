"""Read-only, explicitly selected integration fields over existing Smart sources."""
from collections import Counter

from django.db.models import Q

from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.ops import duty_roster, map_locations, security_events
from organization_management.apps.ops.api.serializers import _visit_placement as canonical_visit_placement
from organization_management.apps.statuses.duty_assignments import identifier


def _wire_id(value):
    return str(value) if value is not None else None


def _known_need(value):
    """Missing imported need is unknown; zero is a known calculation."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    return None


def _catalog():
    # A catalog object has no universal coordinate: saved points belong to
    # individual visits, so even the same building can have several points.
    objects = OpsSecurityObject.objects.prefetch_related("sectors__posts")
    return [{
        "id": str(obj.pk), "code": obj.code, "name": obj.name,
        "object_type": obj.object_type, "region": obj.region, "address": obj.address,
        "state": obj.object_state, "ownership": obj.ownership, "location": None,
        "posts": [{
            "id": str(post.pk), "source": "PASSPORT", "sector_id": str(sector.pk),
            "sector_name": sector.name, "name": post.name, "need": None, "location": None,
        } for sector in obj.sectors.all() for post in sector.posts.all()],
    } for obj in objects]


def _event_posts(posts, assignments, saved_map):
    counts = Counter(str(row.get("postId")) for row in assignments)
    result = []
    for post in posts:
        post_id = _wire_id(post.get("id"))
        point = saved_map.get(post_id, {})
        result.append({
            "id": post_id, "source": "EVENT", "passport_post_id": _wire_id(post.get("sourcePostId")),
            "name": post.get("post") or "", "sector_name": post.get("sector") or None,
            "need": _known_need(post.get("need")), "assigned": counts.get(post_id, 0),
            "location": point.get("location"), "outdoor": point.get("outdoor"),
        })
    return result


def _events(day):
    records = OpsSecurityEvent.objects.filter(business_date__lte=day).filter(
        Q(business_date_end__gte=day) | Q(business_date_end__isnull=True, business_date=day),
    ).prefetch_related("visit_objects").order_by("business_date", "pk")
    result = []
    for event in records:
        visits = list(event.visit_objects.all())
        # read() validates file ownership and committed geometry. A missing
        # file is empty; corruption/unreadability propagates as its real 503.
        saved_map = map_locations.read(event)
        visit_rows = []
        represented_posts = set()
        single = len(visits) == 1
        for visit in visits:
            posts = security_events.visit_object_posts(event, visit, single=single)
            # Track the original rows, including imported rows without IDs;
            # names or repeated IDs cannot establish another row's owner.
            represented_posts.update(id(post) for post in posts)
            try:
                need, assigned = canonical_visit_placement(event, visit, single=single)
            except (TypeError, ValueError, OverflowError):
                # Legacy JSON can bypass current input validation. The
                # canonical helper has already resolved ownership before its
                # int(need) conversion; preserve known assignments without
                # changing those stored rows or inventing a numeric need.
                post_ids = {str(post.get("id")) for post in posts}
                need = None
                assigned = sum(1 for row in (event.placement_assignments or [])
                               if str(row.get("postId")) in post_ids)
            # Canonical placement resolves post ownership; an imported row
            # with no count still cannot become a known zero in this contract.
            if any(_known_need(post.get("need")) is None for post in posts):
                need = None
            visit_rows.append({
                "id": str(visit.pk), "object_id": _wire_id(visit.security_object_id),
                "object_name": visit.object_name, "visit_date": visit.visit_day.isoformat() if visit.visit_day else None,
                "stage": visit.stage, "placement_need": need, "placement_assigned": assigned,
                "location": saved_map["objects"].get(str(visit.pk)),
                "posts": _event_posts(posts, event.placement_assignments or [], saved_map["posts"]),
            })
        result.append({
            "id": str(event.pk), "code": event.code, "title": event.title,
            "business_date": event.business_date.isoformat(),
            "business_date_end": event.business_date_end.isoformat() if event.business_date_end else None,
            "stage": event.stage, "visits": visit_rows,
            "unresolved_posts": _event_posts(
                [post for post in (event.recon_sector_posts or []) if id(post) not in represented_posts],
                event.placement_assignments or [], saved_map["posts"],
            ),
        })
    return result


def _duty_headcounts(day):
    # Scope resolution is private: only the integration view with the global
    # digital_twin.read guard calls snapshot(). No personnel permission is
    # granted, and the existing roster endpoint keeps its original scopes.
    roster = duty_roster._snapshot_for_scopes(day, read_scope=None, dispatch_scope=None,
                                             duty_scope=set(), include_places=True)
    allocated, placed, objects = set(), set(), {}
    for department in roster["departments"]:
        for person in department["employees"]:
            employee_id = person["employee_id"]
            allocated.add(employee_id)
            for assignment in person["placements"]:
                place = assignment.get("_placement")
                if not isinstance(place, dict):
                    continue
                object_id = identifier(place.get("object_id"))
                kind = place.get("kind")
                post_id = identifier(place.get("post_id")) if kind == "POST" else None
                group_id = place.get("group_id") if kind == "GROUP" else None
                if object_id is None or not (post_id or isinstance(group_id, str) and group_id):
                    continue
                placed.add(employee_id)
                target = objects.setdefault(object_id, {
                    "object_id": object_id, "object_name": place.get("object_name") or None,
                    "people": set(), "posts": {}, "groups": {},
                })
                target["people"].add(employee_id)
                collection, key, id_field, name_field = (
                    ("posts", post_id, "post_id", "post_name") if post_id else
                    ("groups", group_id, "group_id", "group_name")
                )
                location = target[collection].setdefault(key, {
                    id_field: key, name_field: place.get(name_field) or None, "people": set(),
                })
                location["people"].add(employee_id)

    def counts(locations):
        return [{key: value for key, value in location.items() if key != "people"} |
                {"headcount": len(location["people"])} for _, location in sorted(locations.items())]

    return {
        "count_basis": "UNIQUE_PEOPLE_ASSIGNED_DURING_BUSINESS_DATE",
        "allocated_headcount": len(allocated), "placed_headcount": len(placed),
        "unplaced_headcount": len(allocated - placed),
        "objects": [{
            "object_id": target["object_id"], "object_name": target["object_name"],
            "headcount": len(target["people"]), "posts": counts(target["posts"]), "groups": counts(target["groups"]),
        } for _, target in sorted(objects.items())],
    }


def snapshot(day):
    """Called only after the API's global integration guard; no generic dumps."""
    return {
        "schema_version": "1.0", "business_date": day.isoformat(),
        "generated_at": Clock.now().isoformat(), "time_zone": str(_local_tz()),
        "objects": _catalog(), "events": _events(day), "duty": _duty_headcounts(day),
    }
