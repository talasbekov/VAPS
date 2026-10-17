"""Catalog edits preserve live duty references and reject invalid trees atomically."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest
from django.db import close_old_connections

from organization_management.apps.operations.models_object import (
    OpsObjectSector,
    OpsSecurityObject,
    OpsSecurityPost,
)
from organization_management.apps.ops import passport
from organization_management.apps.ops.tests.test_duty_dispatch import (
    DAY,
    configure,
    create as create_dispatch,
    fixed_clock,
    queue,
    scene as dispatch_scene,
)
from organization_management.apps.ops.tests.test_ops_objects_passport_api import (
    make_object,
    make_policy,
    make_sector,
    manager,
)

pytestmark = pytest.mark.django_db
OBJECTS_URL = "/api/ops/objects/"


@pytest.fixture
def catalog():
    make_policy()
    obj = make_object("catalog-existing", "Existing catalog object")
    make_sector(obj, name="First sector", posts=("Retained post", "Removed post"))
    make_sector(obj, name="Second sector", position=2, posts=("Other post",))
    return obj


def tree_state():
    """Include IDs, parents, content and timestamps, including other objects."""
    return (
        list(OpsSecurityObject.objects.order_by("pk").values()),
        list(OpsObjectSector.objects.order_by("pk").values()),
        list(OpsSecurityPost.objects.order_by("pk").values()),
    )


def patch_passport(api, obj, sectors):
    api.raise_request_exception = False
    return api.patch(f"{OBJECTS_URL}{obj.pk}/passport/", {"sectors": sectors}, format="json")


@pytest.mark.parametrize("edit", ["unchanged", "post_task", "another_post"])
def test_passport_save_keeps_dispatch_on_the_same_post(dispatch_scene, edit):
    scene = dispatch_scene
    make_policy()
    post = scene["post"]
    other = OpsSecurityPost.objects.create(sector=post.sector, name="Other post", position=2)
    configure(scene)
    created = create_dispatch(scene)
    assert created.status_code == 201, created.data
    assignment_id = created.data["id"]
    assert created.data["valid"] is True
    sectors = passport.snapshot_sectors(scene["obj"])
    if edit == "post_task":
        sectors[0]["posts"][0]["task"] = "Updated task"
    elif edit == "another_post":
        sectors[0]["posts"][1]["name"] = "Renamed other post"

    response = patch_passport(scene["admin"], scene["obj"], sectors)

    assert response.status_code == 200, getattr(response, "data", None)
    assert response.data["sectors"][0]["id"] == str(post.sector_id)
    assert [item["id"] for item in response.data["sectors"][0]["posts"]] == [str(post.pk), str(other.pk)]
    dispatch = next(row for row in queue(scene).data["assignments"] if row["id"] == assignment_id)
    assert dispatch["valid"] is True, dispatch["invalid_reason"]
    object_forces = scene["admin"].get("/api/statuses/statuses/duty-assignments/", {
        "object_id": str(scene["obj"].pk), "date": DAY.isoformat(),
    })
    assert object_forces.status_code == 200, object_forces.data
    assert [row["dispatch_assignment_id"] for row in object_forces.data["results"]] == [assignment_id]
    roster = scene["admin"].get("/api/ops/duty-register/roster/", {"business_date": DAY.isoformat()})
    assert roster.status_code == 200, roster.data
    person = next(person for group in roster.data["departments"] for person in group["employees"]
                  if person["employee_id"] == scene["people"][0].pk)
    assert [(row["source"], row["source_id"]) for row in person["placements"]] == [("DISPATCH", assignment_id)]


def test_passport_replace_preserves_owned_ids_and_removes_only_omitted_rows(catalog, manager):
    first, second = passport.snapshot_sectors(catalog)
    kept, removed = first["posts"]
    other = second["posts"][0]
    sectors = [
        {**second, "id": int(second["id"]), "name": "Second sector updated"},
        {**first, "posts": [
            {"id": "local-new-post", "name": "New post", "task": "", "requirements": ""},
            {**kept, "id": int(kept["id"]), "name": "Retained post updated"},
        ]},
        {"id": "tmp-new-sector", "name": "New sector", "posts": [
            {"id": "tmp-new-post", "name": "Another new post"},
        ]},
    ]

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 200, getattr(response, "data", None)
    returned = response.data["sectors"]
    assert [row["id"] for row in returned[:2]] == [second["id"], first["id"]]
    assert returned[1]["posts"][1]["id"] == kept["id"]
    assert returned[0]["posts"][0]["id"] == other["id"]
    assert not OpsSecurityPost.objects.filter(pk=removed["id"]).exists()
    assert OpsSecurityPost.objects.get(pk=kept["id"]).name == "Retained post updated"
    assert OpsObjectSector.objects.get(pk=second["id"]).position == 1
    assert OpsObjectSector.objects.get(pk=first["id"]).position == 2
    assert OpsSecurityPost.objects.get(pk=kept["id"]).position == 2
    assert returned[2]["id"].isdigit()
    assert returned[2]["id"] not in {first["id"], second["id"]}
    assert returned[1]["posts"][0]["id"].isdigit()
    assert returned[2]["posts"][0]["id"].isdigit()


@pytest.mark.parametrize("case, field", [
    ("foreign_sector", "sectors.0.id"),
    ("foreign_post", "sectors.0.posts.0.id"),
    ("missing_sector", "sectors.0.id"),
    ("missing_post", "sectors.0.posts.0.id"),
    ("duplicate_sector", "sectors.2.id"),
    ("duplicate_post", "sectors.0.posts.2.id"),
    ("duplicate_post_across_sectors", "sectors.1.posts.0.id"),
    ("duplicate_temporary_sector", "sectors.3.id"),
    ("duplicate_temporary_post", "sectors.0.posts.3.id"),
])
def test_foreign_missing_and_duplicate_passport_ids_are_rejected_atomically(catalog, manager, case, field):
    foreign = make_object("catalog-foreign", "Foreign catalog object")
    foreign_sector = make_sector(foreign, name="Foreign sector", posts=("Foreign post",))
    sectors = passport.snapshot_sectors(catalog)
    if case == "foreign_sector":
        sectors[0]["id"] = str(foreign_sector.pk)
    elif case == "foreign_post":
        sectors[0]["posts"][0]["id"] = str(foreign_sector.posts.get().pk)
    elif case == "missing_sector":
        sectors[0]["id"] = "9223372036854775807"
    elif case == "missing_post":
        sectors[0]["posts"][0]["id"] = "9223372036854775807"
    elif case == "duplicate_sector":
        sectors.append(deepcopy(sectors[0]))
    elif case == "duplicate_post":
        sectors[0]["posts"].append(deepcopy(sectors[0]["posts"][0]))
    elif case == "duplicate_post_across_sectors":
        sectors[1]["posts"] = [deepcopy(sectors[0]["posts"][0])]
    elif case == "duplicate_temporary_sector":
        sectors.extend([
            {"id": "local-duplicate", "name": "New sector A", "posts": []},
            {"id": "local-duplicate", "name": "New sector B", "posts": []},
        ])
    elif case == "duplicate_temporary_post":
        sectors[0]["posts"].extend([
            {"id": "local-duplicate", "name": "New post A"},
            {"id": "local-duplicate", "name": "New post B"},
        ])
    before = tree_state()

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 400, getattr(response, "data", None)
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert field in response.data["details"]
    assert tree_state() == before


@pytest.mark.parametrize("sectors, field", [
    (["invalid sector"], "sectors.0"),
    ([7], "sectors.0"),
    ([["invalid sector"]], "sectors.0"),
    ([{"name": "Sector", "posts": ["invalid post"]}], "sectors.0.posts.0"),
    ([{"name": "Sector", "posts": [7]}], "sectors.0.posts.0"),
    ([{"name": "Sector", "posts": [["invalid post"]]}], "sectors.0.posts.0"),
])
def test_non_object_sector_and_post_rows_are_validation_errors(catalog, manager, sectors, field):
    before = tree_state()

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 400, getattr(response, "data", None)
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert field in response.data["details"]
    assert tree_state() == before


@pytest.mark.parametrize("field, value", [
    ("sectors.0.name", None),
    ("sectors.0.name", ["Sector"]),
    ("sectors.0.name", 7),
    ("sectors.0.posts.0.name", None),
    ("sectors.0.posts.0.name", ["Post"]),
    ("sectors.0.posts.0.name", 7),
    ("sectors.0.posts.0.task", ["Task"]),
    ("sectors.0.posts.0.task", {"task": "Task"}),
    ("sectors.0.posts.0.requirements", ["Requirement"]),
    ("sectors.0.posts.0.requirements", {"requirement": "Requirement"}),
])
def test_non_string_passport_fields_are_rejected_atomically(catalog, manager, field, value):
    sectors = passport.snapshot_sectors(catalog)
    target = sectors[0] if field == "sectors.0.name" else sectors[0]["posts"][0]
    target[field.rsplit(".", 1)[1]] = value
    before = tree_state()

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 400, getattr(response, "data", None)
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert field in response.data["details"]
    assert tree_state() == before


@pytest.mark.parametrize("field", ["task", "requirements"])
def test_nullable_optional_post_text_remains_blank(catalog, manager, field):
    sectors = passport.snapshot_sectors(catalog)
    sectors[0]["posts"][0][field] = None

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 200, getattr(response, "data", None)
    assert response.data["sectors"][0]["posts"][0][field] == ""


@pytest.mark.parametrize("field, length", [
    ("sectors.0.name", 256),
    ("sectors.0.posts.0.name", 256),
    ("sectors.0.posts.0.task", 1001),
    ("sectors.0.posts.0.requirements", 1001),
])
def test_overlong_passport_fields_are_rejected_before_any_change(catalog, manager, field, length):
    sectors = passport.snapshot_sectors(catalog)
    target = sectors[0] if field == "sectors.0.name" else sectors[0]["posts"][0]
    target[field.rsplit(".", 1)[1]] = "Я" * length
    before = tree_state()

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 400, getattr(response, "data", None)
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert field in response.data["details"]
    assert tree_state() == before


def test_passport_accepts_exact_field_limits(catalog, manager):
    sectors = [{"id": "local-sector", "name": "С" * 255, "posts": [
        {"id": "local-post", "name": "П" * 255, "task": "З" * 1000, "requirements": "Т" * 1000},
    ]}]

    response = patch_passport(manager, catalog, sectors)

    assert response.status_code == 200, getattr(response, "data", None)
    returned = response.data["sectors"][0]
    assert returned["name"] == "С" * 255
    assert returned["posts"][0]["name"] == "П" * 255
    assert returned["posts"][0]["task"] == "З" * 1000
    assert returned["posts"][0]["requirements"] == "Т" * 1000


def test_create_object_after_a_numbering_gap_preserves_existing_codes(manager):
    existing = make_object(f"OBJ-{OpsSecurityObject.objects.count() + 2:03d}", "Imported numbered object")
    before = dict(OpsSecurityObject.objects.values_list("pk", "code"))
    manager.raise_request_exception = False

    response = manager.post(OBJECTS_URL, {"name": "Object created after gap"}, format="json")

    assert response.status_code == 201, getattr(response, "data", None)
    created = OpsSecurityObject.objects.get(pk=response.data["id"])
    assert created.name == "Object created after gap"
    assert created.code != existing.code
    assert {pk: code for pk, code in OpsSecurityObject.objects.values_list("pk", "code") if pk in before} == before


@pytest.mark.django_db(transaction=True)
def test_concurrent_object_creation_allocates_distinct_codes(monkeypatch):
    before = dict(OpsSecurityObject.objects.values_list("pk", "code"))
    barrier = Barrier(2)
    real_count = OpsSecurityObject.objects.count

    def simultaneous_legacy_count():
        # Keep the real database reads, but force the original allocation race.
        # An allocator that does not derive codes from row counts bypasses this.
        result = real_count()
        barrier.wait(timeout=15)
        return result

    monkeypatch.setattr(OpsSecurityObject.objects, "count", simultaneous_legacy_count)

    def submit(name):
        close_old_connections()
        try:
            row = passport.create_object(name=name, object_type="", region="", address="")
            return ("created", row.pk, row.code)
        except Exception as error:
            return (type(error).__name__,)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(submit, ("Concurrent object A", "Concurrent object B")))

    assert [result[0] for result in results] == ["created", "created"], results
    assert results[0][2] != results[1][2]
    assert set(OpsSecurityObject.objects.filter(pk__in=[result[1] for result in results]).values_list("name", flat=True)) == {
        "Concurrent object A", "Concurrent object B",
    }
    assert {pk: code for pk, code in OpsSecurityObject.objects.values_list("pk", "code") if pk in before} == before
