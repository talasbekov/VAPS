"""The integration boundary exposes saved locations and counts, never personnel."""
import json
from datetime import date, datetime, timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchAssignment, OpsDutyDispatchConfig
from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsSecurityEventVisitObject
from organization_management.apps.operations.models_object import OpsObjectSector, OpsSecurityObject, OpsSecurityPost
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.ops import map_locations
from organization_management.apps.statuses.application.services import StatusApplicationService
from organization_management.apps.statuses.duty_assignments import normalize_assignment
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db
URL = "/api/integrations/digital-twin/v1/snapshot/"
DAY = date(2026, 10, 16)
POINT = {"latitude": 51.128, "longitude": 71.43}


@pytest.fixture(autouse=True)
def integration_clock_and_storage(settings, tmp_path):
    settings.OPS_PRIVATE_STORAGE_ROOT = str(tmp_path)
    call_command("seed_status_types", verbosity=0)
    for code, priority, column in (("DUTY", 70, "ON_DUTY"), ("GEV", 75, "ON_DUTY"), ("SICK_LEAVE", 10, "SICK")):
        StatusType.objects.update_or_create(code=code, defaults={
            "name": code, "priority": priority, "report_column_code": column,
        })
    with clock.override(DAY):
        yield tmp_path


@pytest.fixture
def reader():
    return client_for("twin-reader", "TWIN_READER_TEST", ("digital_twin.read",))[0]


def object_with_post(code="TWIN-1", **extra):
    obj = OpsSecurityObject.objects.create(**{
        "code": code, "name": "Одинаковое название", "object_type": "BUILDING", "region": "Астана",
        "address": "Сохранённый адрес", "object_state": "ACTIVE", "passport_state": "RED", "ownership": "OWN", **extra,
    })
    sector = OpsObjectSector.objects.create(security_object=obj, name="Периметр", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Одинаковый пост", position=1)
    return obj, post


def event_for(obj, code="TWIN-EVENT", **extra):
    event = OpsSecurityEvent.objects.create(**{
        "code": code, "title": "Охранное мероприятие", "security_object": obj, "object_name": obj.name,
        "passport_binding": None, "business_date": DAY, "stage": "PLACEMENT", "readiness_percent": 42,
        "force_need": 999, "conflicts_count": 0, "owner_name": "PRIVATE OWNER", "chief_name": "PRIVATE CHIEF",
        "protected_person_name": "PRIVATE PROTECTED PERSON", "recon_checklist": [], "recon_sector_posts": [],
        "demand_rows": [], "demand_approved": False, "force_requests": [], "placement_assignments": [],
        "approval_status": "PENDING", "journal_entries": [], "closure_direction_summaries": [], **extra,
    })
    visit = OpsSecurityEventVisitObject.objects.create(event=event, security_object=obj, object_name=obj.name,
        passport_binding=None, position=1, stage="PLACEMENT", chief_name="PRIVATE VISIT CHIEF",
        protected_person_name="PRIVATE VISIT PROTECTED PERSON", force_need=888, force_assigned=777)
    return event, visit


def saved_status(person, obj, post=None, **extra):
    raw = {"kind": "POST", "object_id": str(obj.pk), "post_id": str(post.pk)} if post else {
        "kind": "GROUP", "object_id": str(obj.pk), "group_id": "duty-group-1",
    }
    placement = normalize_assignment(raw, status_type="on_duty", start_date=DAY, end_date=DAY + timedelta(days=1))
    return StatusApplicationService().create_status(employee_id=person.pk, status_type="on_duty", **{
        "start_date": DAY, "end_date": DAY + timedelta(days=1), "duty_assignment": placement, **extra,
    })


def allocated(person, **extra):
    return OpsEmployeeStatus.objects.create(employee_id=person.pk, **{
        "status_type_code": "DUTY", "date_start": DAY, "date_end": DAY + timedelta(days=2), **extra,
    })


def dispatch(person, source, department, placement, **extra):
    return OpsDutyDispatchAssignment.objects.create(employee_id=person.pk, employee_name="PRIVATE DISPATCH NAME",
        source_status=source, receiver_department_id=department.pk, placement=placement, **{
            "start_at": datetime.fromisoformat("2026-10-16T08:00:00+05:00"),
            "end_at": datetime.fromisoformat("2026-10-16T16:00:00+05:00"), "created_by": "PRIVATE CREATOR", **extra,
        })


def snapshot(api, **query):
    response = api.get(URL, {"date": DAY.isoformat(), **query})
    assert response.status_code == 200, response.content
    return response.json()


def test_existing_jwt_authorizes_only_the_new_global_permission():
    _, user = client_for("twin-jwt", "TWIN_JWT_TEST", ("digital_twin.read",))
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION="Bearer " + str(RefreshToken.for_user(user).access_token))
    assert api.get(URL).status_code == 200
    UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
    assert api.get(URL).status_code == 403
    assert APIClient().get(URL).status_code == 401


@pytest.mark.parametrize("permission,scoped", [("status.manage", False), ("event.view", False), ("digital_twin.read", True), ("*", True)])
def test_other_or_scoped_grants_do_not_read_integration_data(permission, scoped):
    department = Division.objects.create(name="Область", division_type="department")
    api, _ = client_for("twin-denied", "TWIN_DENIED_TEST", (permission,), department.pk if scoped else None)
    object_with_post()
    with CaptureQueriesContext(connection) as captured:
        response = api.get(URL)
    assert response.status_code == 403, response.content
    sql = " ".join(query["sql"].lower() for query in captured)
    for table in ("ops_security_objects", "ops_security_events", "ops_duty_dispatch_assignments", "employees_employee"):
        assert table not in sql


def test_global_wildcard_remains_allowed():
    api, _ = client_for("twin-admin", "TWIN_ADMIN_TEST", ("*",))
    assert api.get(URL).status_code == 200


def test_integration_permission_does_not_open_personnel_or_operational_routes(reader):
    assert reader.get("/api/ops/personnel/").status_code == 403
    assert reader.get("/api/ops/duty-register/roster/").status_code == 403
    assert reader.get("/api/operations/statuses/").status_code == 403


def test_access_catalog_explains_the_real_integration_get_function():
    from organization_management.apps.ops.access_catalog import catalog

    functions = catalog().get("digital_twin.read", [])
    assert [(row["method"], row["path"], row["kind"]) for row in functions] == [("GET", URL, "gate")]


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_write_methods_are_405_and_leave_source_rows_unchanged(reader, method):
    obj, _ = object_with_post()
    event_for(obj)
    before = list(OpsSecurityEvent.objects.values())
    response = getattr(reader, method)(URL, {"objects": [], "events": []}, format="json")
    assert response.status_code == 405, response.content
    assert list(OpsSecurityEvent.objects.values()) == before


@pytest.mark.parametrize("invalid", ["", "2026-1-16", "2026-10-1", "20261016", "2026-10-16T00:00:00Z", "2026-02-30", " 2026-10-16", "0001-01-01", "9999-12-31"])
def test_date_is_strict_and_rejects_unsupported_calendar_boundaries(reader, invalid):
    assert reader.get(URL, {"date": invalid}).status_code == 400


def test_business_clock_is_default_and_safe_methods_have_no_body_or_write(reader):
    with clock.override(datetime.fromisoformat("2026-10-15T20:01:00+00:00")):
        response = reader.get(URL)
        assert response.status_code == 200, response.content
        body = response.json()
        assert set(body) == {"schema_version", "business_date", "generated_at", "time_zone", "objects", "events", "duty"}
        assert body["schema_version"] == "1.0"
        assert body["business_date"] == "2026-10-16"
        assert body["time_zone"] == "Asia/Almaty"
        assert datetime.fromisoformat(body["generated_at"]) == clock.Clock.now()
    assert reader.head(URL).status_code == 200
    assert reader.head(URL).content == b""
    assert reader.options(URL).status_code == 200


def test_catalog_posts_and_event_posts_keep_distinct_exact_ids_and_saved_points(reader, integration_clock_and_storage):
    obj, post = object_with_post(id=9007199254740993)
    event, visit = event_for(obj)
    other_visit = OpsSecurityEventVisitObject.objects.create(event=event, security_object=None, object_name="Второе посещение",
        passport_binding=None, position=2, stage="RECON")
    event.recon_sector_posts = [
        {"id": "event-post-1", "visitObjectId": str(visit.pk), "sourcePostId": str(post.pk), "post": "Пост мероприятия", "sector": "Периметр", "need": 2, "private": "PRIVATE POST DATA"},
        {"id": "event-post-2", "visitObjectId": str(other_visit.pk), "post": "Другой пост", "need": 1},
    ]
    event.placement_assignments = [{"id": "assignment-private", "postId": "event-post-1", "employeeId": "123", "employeeName": "PRIVATE ASSIGNEE", "phone": "PRIVATE PHONE"}]
    event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    folder = integration_clock_and_storage / "maps"
    folder.mkdir()
    (folder / f"{event.pk}.geojson").write_bytes(map_locations._encode(event, {
        "objects": {str(visit.pk): POINT},
        "posts": {"event-post-1": {"location": POINT, "outdoor": True}},
    }))
    body = snapshot(reader)
    catalog = next(row for row in body["objects"] if row["id"] == str(obj.pk))
    assert catalog["location"] is None
    assert catalog["posts"][0]["id"] == str(post.pk)
    assert catalog["posts"][0]["source"] == "PASSPORT"
    assert catalog["posts"][0]["need"] is None
    exported = next(row for row in body["events"] if row["id"] == str(event.pk))
    assert exported["business_date_end"] is None
    assert exported["stage"] == "PLACEMENT"
    first, second = exported["visits"]
    assert (first["placement_need"], first["placement_assigned"]) == (2, 1)
    assert first["object_id"] == "9007199254740993"
    assert first["id"] == str(visit.pk)
    assert first["location"] == POINT
    assert first["posts"] == [{"id": "event-post-1", "source": "EVENT", "passport_post_id": str(post.pk),
        "name": "Пост мероприятия", "sector_name": "Периметр", "need": 2, "assigned": 1, "location": POINT, "outdoor": True}]
    assert second["stage"] == "RECON"
    assert second["location"] is None
    assert second["posts"][0]["location"] is None


def test_selected_day_includes_spanning_and_closed_events_but_keeps_unknown_placement_null(reader):
    obj, _ = object_with_post()
    spanning, first = event_for(obj, business_date=DAY - timedelta(days=2), business_date_end=DAY, stage="CLOSED")
    OpsSecurityEventVisitObject.objects.create(event=spanning, security_object=None, object_name="Историческое посещение",
        passport_binding=None, position=2, stage="RECON")
    spanning.recon_sector_posts = [{"id": "unscoped-event-post", "post": "Неразмеченный", "need": 4}]
    spanning.save(update_fields=["recon_sector_posts"])
    event_for(obj, "PAST", business_date=DAY - timedelta(days=1))
    event_for(obj, "FUTURE", business_date=DAY + timedelta(days=1))
    body = snapshot(reader)
    assert [row["id"] for row in body["events"]] == [str(spanning.pk)]
    assert body["events"][0]["stage"] == "CLOSED"
    assert all(row["placement_need"] is None and row["placement_assigned"] is None for row in body["events"][0]["visits"])
    spanning.refresh_from_db()
    assert spanning.force_need == 999
    assert first.force_need == 888


@pytest.mark.parametrize("owner,expected_counts", [
    (None, [(None, None), (None, None)]),
    ("missing-visit", [(2, 1), (0, 0)]),
])
def test_unresolved_event_posts_keep_counts_and_map_without_guessing_a_visit_owner(reader, integration_clock_and_storage, owner, expected_counts):
    obj, _ = object_with_post()
    event, visit = event_for(obj)
    OpsSecurityEventVisitObject.objects.create(event=event, security_object=None, object_name="Историческая площадка",
        passport_binding=None, position=2, stage="RECON")
    event.recon_sector_posts = [
        {"id": "resolved-post", "visitObjectId": str(visit.pk), "post": "Размеченный пост", "need": 2},
        {"id": "unresolved-post", "visitObjectId": owner, "post": "Пост без известной площадки", "sector": "Периметр", "need": 4,
         "employeeName": "PRIVATE POST ASSIGNEE"},
    ]
    event.placement_assignments = [
        {"id": "resolved-assignment", "postId": "resolved-post", "employeeId": "101"},
        {"id": "unresolved-assignment-1", "postId": "unresolved-post", "employeeId": "102", "employeeName": "PRIVATE ASSIGNEE"},
        {"id": "unresolved-assignment-2", "postId": "unresolved-post", "employeeId": "103", "phone": "PRIVATE PHONE"},
    ]
    event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    folder = integration_clock_and_storage / "maps"
    folder.mkdir()
    (folder / f"{event.pk}.geojson").write_bytes(map_locations._encode(event, {
        "objects": {}, "posts": {"unresolved-post": {"location": POINT, "outdoor": True}},
    }))
    exported = snapshot(reader)["events"][0]
    assert exported["unresolved_posts"] == [{
        "id": "unresolved-post", "source": "EVENT", "passport_post_id": None,
        "name": "Пост без известной площадки", "sector_name": "Периметр", "need": 4,
        "assigned": 2, "location": POINT, "outdoor": True,
    }]
    assert [(row["placement_need"], row["placement_assigned"]) for row in exported["visits"]] == expected_counts
    assert [post["id"] for row in exported["visits"] for post in row["posts"]] == ["resolved-post"]
    assert "PRIVATE" not in json.dumps(exported, ensure_ascii=False)
    event.refresh_from_db()
    assert event.recon_sector_posts[1]["visitObjectId"] == owner


def test_corrupt_map_returns_honest_unavailability(reader, integration_clock_and_storage):
    obj, _ = object_with_post()
    event, _ = event_for(obj)
    folder = integration_clock_and_storage / "maps"
    folder.mkdir()
    (folder / f"{event.pk}.geojson").write_text("{broken", encoding="utf-8")
    response = reader.get(URL)
    assert response.status_code == 503, response.content
    assert response.json()["error_code"] == "PLACEMENT_MAP_UNAVAILABLE"


def test_legacy_nonnumeric_post_need_is_unknown_and_keeps_known_assignment_count(reader):
    obj, _ = object_with_post()
    event, visit = event_for(obj)
    event.recon_sector_posts = [{"id": "legacy-post", "visitObjectId": str(visit.pk), "post": "Сохранённый пост", "need": "unknown"}]
    event.placement_assignments = [{"id": "legacy-assignment", "postId": "legacy-post", "employeeName": "PRIVATE ASSIGNEE"}]
    event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    exported = snapshot(reader)["events"][0]["visits"][0]
    assert exported["placement_need"] is None
    assert exported["placement_assigned"] == 1
    assert exported["posts"][0]["need"] is None
    assert exported["posts"][0]["assigned"] == 1
    event.refresh_from_db()
    assert event.recon_sector_posts[0]["need"] == "unknown"


def test_duty_headcounts_use_canonical_winner_unique_people_and_valid_hourly_assignments(reader):
    department = Division.objects.create(name="Подразделение", division_type="department")
    receiver = Division.objects.create(name="Принимающий", division_type="department")
    OpsDutyDispatchConfig.objects.create(receiver_department_id=receiver.pk)
    obj, post = object_with_post()
    people = [make_employee(department) for _ in range(7)]
    saved = saved_status(people[0], obj, post)
    saved_status(people[1], obj, post)
    allocated(people[1], status_type_code="SICK_LEAVE")
    saved_status(people[2], obj, post)
    people[2].is_active = False
    people[2].save(update_fields=["is_active"])
    cancelled = saved_status(people[3], obj, post)
    EmployeeStatus.objects.filter(pk=cancelled.pk).update(state="cancelled")
    OpsEmployeeStatus.objects.filter(source_ref=f"personnel:{cancelled.pk}").update(cancelled_at=clock.Clock.now())
    allocated(people[4], status_type_code="GEV")
    source = allocated(people[5])
    dispatch(people[5], source, receiver, saved.duty_assignment)
    dispatch(people[5], source, receiver, saved.duty_assignment,
        start_at=datetime.fromisoformat("2026-10-16T16:00:00+05:00"), end_at=datetime.fromisoformat("2026-10-17T00:00:00+05:00"))
    invalid_source = allocated(people[6])
    dispatch(people[6], invalid_source, receiver, saved.duty_assignment, cancelled_at=clock.Clock.now())
    event, _ = event_for(obj)
    event.placement_assignments = [{"id": "event-only", "postId": "event-only", "employeeId": str(people[0].pk)}]
    event.save(update_fields=["placement_assignments"])
    result = snapshot(reader)["duty"]
    assert result["count_basis"] == "UNIQUE_PEOPLE_ASSIGNED_DURING_BUSINESS_DATE"
    assert result["allocated_headcount"] == 4
    assert result["placed_headcount"] == 2
    assert result["unplaced_headcount"] == 2
    assert result["objects"] == [{"object_id": str(obj.pk), "object_name": obj.name, "headcount": 2,
        "posts": [{"post_id": str(post.pk), "post_name": post.name, "headcount": 2}], "groups": []}]


def test_retired_saved_locations_keep_ids_and_names_and_equal_names_do_not_merge(reader):
    department = Division.objects.create(name="Подразделение", division_type="department")
    first_obj, first_post = object_with_post()
    second_obj, second_post = object_with_post("TWIN-2")
    first_post_id = str(first_post.pk)
    first_person, second_person, group_person = [make_employee(department) for _ in range(3)]
    saved_status(first_person, first_obj, first_post)
    saved_status(second_person, second_obj, second_post)
    saved_status(group_person, second_obj)
    first_post.delete()
    OpsSecurityObject.objects.filter(pk=first_obj.pk).update(name="Новое имя", object_state="ARCHIVED")
    body = snapshot(reader)
    locations = {row["object_id"]: row for row in body["duty"]["objects"]}
    assert len(locations) == 2
    assert locations[str(first_obj.pk)] == {"object_id": str(first_obj.pk), "object_name": "Одинаковое название", "headcount": 1,
        "posts": [{"post_id": first_post_id, "post_name": "Одинаковый пост", "headcount": 1}], "groups": []}
    assert locations[str(second_obj.pk)]["headcount"] == 2
    assert locations[str(second_obj.pk)]["groups"] == [{"group_id": "duty-group-1", "group_name": "Группа №1", "headcount": 1}]


def test_response_is_a_recursive_whitelist_with_no_personal_or_private_fields(reader):
    obj, post = object_with_post()
    department = Division.objects.create(name="Подразделение", division_type="department")
    person = make_employee(department)
    person.last_name = "PRIVATE EMPLOYEE SURNAME"
    person.save(update_fields=["last_name"])
    saved_status(person, obj, post)
    event, _ = event_for(obj)
    event.force_roster = [{"employeeId": str(person.pk), "fullName": "PRIVATE FORCE NAME", "iin": person.iin, "phone": "PRIVATE PHONE"}]
    event.passport_binding = {"privateFile": "/secret/private/passport.pdf"}
    event.save(update_fields=["force_roster", "passport_binding"])
    body = snapshot(reader)
    text = json.dumps(body, ensure_ascii=False)
    for secret in ("PRIVATE", person.iin, "private/passport.pdf"):
        assert secret not in text
    forbidden = {"employee_id", "employeeId", "full_name", "fullName", "iin", "phone", "protectedPersonId", "protected_person_name", "passportBinding", "photoUrl", "readiness_percent"}

    def check(value):
        if isinstance(value, dict):
            assert not forbidden.intersection(value)
            for key, child in value.items():
                if key == "id" or key.endswith("_id"):
                    assert child is None or isinstance(child, str)
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)

    check(body)
    assert set(body["objects"][0]) == {"id", "code", "name", "object_type", "region", "address", "state", "ownership", "location", "posts"}
    assert set(body["objects"][0]["posts"][0]) == {"id", "source", "sector_id", "sector_name", "name", "need", "location"}
    assert set(body["events"][0]) == {"id", "code", "title", "business_date", "business_date_end", "stage", "visits", "unresolved_posts"}
    assert set(body["events"][0]["visits"][0]) == {"id", "object_id", "object_name", "visit_date", "stage", "placement_need", "placement_assigned", "location", "posts"}


def test_snapshot_metadata_queries_do_not_grow_per_object_event_or_saved_placement(reader):
    department = Division.objects.create(name="Подразделение", division_type="department")
    obj, post = object_with_post()
    event_for(obj)
    saved_status(make_employee(department), obj, post)
    with CaptureQueriesContext(connection) as small:
        first = snapshot(reader)
    for index in range(8):
        obj, post = object_with_post(f"TWIN-EXTRA-{index}")
        event_for(obj, f"TWIN-EVENT-EXTRA-{index}")
        saved_status(make_employee(department), obj, post)
    with CaptureQueriesContext(connection) as large:
        result = snapshot(reader)
    assert len(first["objects"]) == 1
    assert len(result["objects"]) == 9
    assert len(result["events"]) == 9
    assert result["duty"]["placed_headcount"] == 9
    assert len(large) <= len(small) + 2
