"""Permanent post points, passport history and scoped combat snapshots."""
from copy import deepcopy

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_combat import OpsCombatDutyShift, OpsCombatPlace
from organization_management.apps.operations.models_object import OpsSecurityPost
from organization_management.apps.ops import passport
from organization_management.apps.ops.tests.test_combat_day_planning import BOARD, CATALOG, DAY, form, payload, scene
from organization_management.apps.ops.tests.test_ops_objects_passport_api import make_object, make_policy, make_sector, manager, publish, reader
from organization_management.apps.ops.tests.test_passport_catalog_integrity import patch_passport, tree_state

pytestmark = pytest.mark.django_db
POINT = {"latitude": 51.128456, "longitude": 71.430125}


@pytest.fixture
def obj():
    make_policy()
    row = make_object("post-map", "Post map object", latitude=51.15, longitude=71.45)
    make_sector(row, posts=("Gate", "Unknown post"))
    return row


def set_point(obj, point=POINT):
    tree = passport.snapshot_sectors(obj)
    tree[0]["posts"][0]["location"] = point
    passport.update_passport(obj, tree)


def test_new_post_point_roundtrips_and_invalid_api_payload_is_atomic(obj, manager):
    tree = passport.snapshot_sectors(obj)
    tree[0]["posts"].append({"id": "new-map-post", "name": "New mapped post", "location": POINT})
    response = patch_passport(manager, obj, tree)
    assert response.status_code == 200, response.data
    created = response.data["sectors"][0]["posts"][-1]
    assert created["id"].isdigit() and created["location"] == POINT
    tree = response.data["sectors"]
    tree[0]["posts"][0]["name"] = "Must roll back"
    tree[0]["posts"][-1]["location"] = {"latitude": 51}
    before = tree_state()
    response = patch_passport(manager, obj, tree)
    assert response.status_code == 400, response.data
    assert "sectors.0.posts.2.location" in response.data["details"]
    assert tree_state() == before


@pytest.mark.parametrize("point", [POINT, {"latitude": 0, "longitude": 0}, {"latitude": -90, "longitude": 180}])
def test_post_location_roundtrip_preserves_ids_and_distinguishes_omission_from_clear(obj, manager, point):
    tree = passport.snapshot_sectors(obj)
    original_id = tree[0]["posts"][0]["id"]
    tree[0]["posts"][0]["location"] = point
    response = patch_passport(manager, obj, tree)
    assert response.status_code == 200, response.data
    post = response.data["sectors"][0]["posts"][0]
    assert post["id"] == original_id and post["location"] == point
    assert response.data["sectors"][0]["posts"][1]["location"] is None
    tree = response.data["sectors"]
    del tree[0]["posts"][0]["location"]
    tree[0]["posts"][0]["task"] = "Changed task"
    response = patch_passport(manager, obj, tree)
    assert response.status_code == 200, response.data
    assert response.data["sectors"][0]["posts"][0]["location"] == point
    tree[0]["posts"][0]["location"] = None
    response = patch_passport(manager, obj, tree)
    assert response.status_code == 200, response.data
    assert response.data["sectors"][0]["posts"][0]["location"] is None
    row = OpsSecurityPost.objects.get(pk=original_id)
    assert row.latitude is None and row.longitude is None


@pytest.mark.parametrize("point", [
    {}, [], "51,71", True, {"latitude": 51}, {"longitude": 71},
    {"latitude": 51, "longitude": 71, "extra": 1},
    *[{"latitude": bad, "longitude": 71} for bad in (True, "51", None, 91, -91, 10**400, float("nan"), float("inf"))],
    *[{"latitude": 51, "longitude": bad} for bad in (False, "71", None, 181, -181, float("-inf"))],
])
def test_invalid_post_location_rejects_whole_passport_atomically(obj, point):
    tree = passport.snapshot_sectors(obj)
    tree[0]["name"] = "Must not save"
    tree[0]["posts"][0]["location"] = point
    before = tree_state()
    with pytest.raises(DomainError) as error:
        passport.update_passport(obj, tree)
    assert error.value.http_status == 400
    assert "sectors.0.posts.0.location" in error.value.detail
    assert tree_state() == before


def test_post_location_write_requires_object_manage_and_rejects_foreign_post(obj, manager, reader):
    tree = passport.snapshot_sectors(obj)
    tree[0]["posts"][0]["location"] = POINT
    before = tree_state()
    assert patch_passport(reader, obj, tree).status_code == 403
    assert tree_state() == before
    foreign = make_object("post-map-foreign", "Foreign object")
    foreign_post = make_sector(foreign).posts.get()
    tree[0]["posts"][0]["id"] = str(foreign_post.pk)
    before = tree_state()
    response = patch_passport(manager, obj, tree)
    assert response.status_code == 400
    assert "sectors.0.posts.0.id" in response.data["details"]
    assert tree_state() == before


def test_published_post_point_is_frozen_and_location_only_changes_dirty_state(obj, manager):
    set_point(obj)
    response = publish(obj, "2026-11-01", api=manager)
    assert response.status_code == 201, response.data
    version = obj.passport_versions.get()
    frozen = deepcopy(version.sectors_snapshot)
    assert frozen[0]["posts"][0]["location"] == POINT
    assert response.data["passportState"] == "GREEN"
    set_point(obj, {"latitude": 51.1, "longitude": 71.4})
    obj.refresh_from_db()
    assert obj.passport_state == "YELLOW"
    set_point(obj)
    obj.refresh_from_db()
    assert obj.passport_state == "GREEN"
    tree = passport.snapshot_sectors(obj)
    tree[0]["posts"].pop(0)
    passport.update_passport(obj, tree)
    version.refresh_from_db()
    assert version.sectors_snapshot == frozen
    read = manager.get(f"/api/ops/objects/{obj.pk}/").json()
    assert read["passportVersions"][0]["sectors"] == frozen


def test_legacy_snapshot_missing_location_equals_null_but_never_inherits_new_point(obj, manager):
    assert publish(obj, "2026-11-01", api=manager).status_code == 201
    version = obj.passport_versions.get()
    for post in version.sectors_snapshot[0]["posts"]:
        post.pop("location", None)
    version.save(update_fields=["sectors_snapshot"])
    frozen = deepcopy(version.sectors_snapshot)
    assert passport.resolve_passport_state(obj) == "GREEN"
    set_point(obj)
    assert passport.resolve_passport_state(obj) == "YELLOW"
    response = manager.get(f"/api/ops/objects/{obj.pk}/").json()
    assert response["passportVersions"][0]["sectors"] == frozen


@pytest.mark.parametrize("latitude,longitude", [(1, None), (None, 1), (91, 71), (51, 181), (float("nan"), 71), (51, float("inf"))])
def test_database_rejects_partial_or_invalid_post_points(obj, latitude, longitude):
    post = obj.sectors.get().posts.first()
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsSecurityPost.objects.filter(pk=post.pk).update(latitude=latitude, longitude=longitude)


def test_combat_catalog_exposes_only_scoped_authoritative_object_and_post_points(obj, scene):
    set_point(obj)
    own = OpsCombatPlace.objects.create(division=scene["own"], security_object=obj)
    foreign = make_object("foreign-place", "Foreign place", latitude=50, longitude=70)
    OpsCombatPlace.objects.create(division=scene["other"], security_object=foreign)
    response = scene["api"].get(CATALOG, {"kind": "places"})
    assert response.status_code == 200, response.data
    rows = response.json()["results"]
    assert [row["id"] for row in rows] == [str(own.pk)]
    assert rows[0]["location"] == {"latitude": 51.15, "longitude": 71.45}
    assert rows[0]["posts"][0]["location"] == POINT
    assert rows[0]["posts"][1]["location"] is None
    choices = scene["api"].get(BOARD + "choices/", {"date": DAY.isoformat()})
    assert choices.status_code == 200, choices.data
    assert choices.json()["places"] == rows
    denied = scene["api"].post(BOARD, payload(scene, location={"kind": "OBJECT", "objectId": foreign.pk, **POINT}), format="json")
    assert denied.status_code == 403
    assert not scene["groups"][0].shifts.exists()


@pytest.mark.parametrize("kind,expected", [("OBJECT", {"latitude": 51.15, "longitude": 71.45}), ("POST", POINT)])
def test_combat_points_ignore_client_forgery_and_remain_frozen_after_catalog_edits(obj, scene, kind, expected):
    set_point(obj)
    OpsCombatPlace.objects.create(division=scene["own"], security_object=obj)
    post = obj.sectors.get().posts.first()
    data = form(scene, location={"kind": kind, "objectId": obj.pk, "postId": post.pk, "latitude": 1, "longitude": 2})
    assert {key: data["location"][key] for key in ("latitude", "longitude")} == expected
    set_point(obj, {"latitude": 50, "longitude": 70})
    obj.latitude, obj.longitude = 49, 69
    obj.save(update_fields=["latitude", "longitude"])
    board = scene["api"].get(BOARD, {"date": DAY.isoformat()}).json()
    shift = OpsCombatDutyShift.objects.get(pk=data["id"])
    assert shift.location == data["location"]
    assert board["shifts"][0]["location"] == data["location"]
    # A pre-map shift stays unknown even when its current catalogue has points.
    legacy = {key: value for key, value in shift.location.items() if key not in {"latitude", "longitude"}}
    shift.location = legacy
    shift.save(update_fields=["location"])
    assert scene["api"].get(f'{BOARD}{shift.pk}/').json()["location"] == legacy


@pytest.mark.parametrize("kind", ["OBJECT", "POST"])
def test_unknown_combat_point_ignores_client_coordinates_and_has_no_object_fallback(obj, scene, kind):
    if kind == "OBJECT":
        obj.latitude = obj.longitude = None
        obj.save(update_fields=["latitude", "longitude"])
    OpsCombatPlace.objects.create(division=scene["own"], security_object=obj)
    post = obj.sectors.get().posts.first()
    data = form(scene, location={"kind": kind, "objectId": obj.pk, "postId": post.pk, **POINT})
    assert "latitude" not in data["location"] and "longitude" not in data["location"]


@pytest.mark.django_db(transaction=True)
def test_combat_snapshot_waits_for_concurrent_passport_point_edit(obj, scene, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from organization_management.apps.ops import combat_planning
    from organization_management.apps.ops.tests.test_duty_month_concurrency import run_session, waits_on

    OpsCombatPlace.objects.create(division=scene["own"], security_object=obj)
    post = obj.sectors.get().posts.first()
    tree = passport.snapshot_sectors(obj)
    tree[0]["posts"][0]["location"] = POINT
    observed, release = Event(), Event()
    original = passport._validate_passport_ids

    def pause(*args, **kwargs):
        original(*args, **kwargs)
        observed.set()
        assert release.wait(10)

    monkeypatch.setattr(passport, "_validate_passport_ids", pause)
    first_started, second_started = Event(), Event()
    first_state, second_state = {}, {}
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run_session, lambda: passport.update_passport(obj, tree), first_started, first_state)
        try:
            assert observed.wait(10)
            second = executor.submit(
                run_session,
                lambda: combat_planning.form(str(scene["user"].pk), payload(scene, location={"kind": "POST", "objectId": obj.pk, "postId": post.pk})),
                second_started, second_state,
            )
            assert second_started.wait(10)
            serialized = waits_on(second, second_state["pid"], first_state["pid"])
        finally:
            release.set()
        assert first.result(timeout=15) == "ok"
        assert second.result(timeout=15) == "ok"
    assert serialized
    shift = scene["groups"][0].shifts.get()
    assert {key: shift.location[key] for key in ("latitude", "longitude")} == POINT
