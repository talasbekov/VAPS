"""Catalog points are shared by reads and copied only when publishing a passport."""
import datetime as dt

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_object import (
    OpsObjectSector,
    OpsPassportVersion,
    OpsSecurityObject,
)
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import passport
from organization_management.apps.ops.tests.test_ops_objects_passport_api import (
    make_object,
    make_policy,
    make_sector,
)


pytestmark = pytest.mark.django_db
URL = "/api/ops/objects/"
POINT_A = {"latitude": 51.12828, "longitude": 71.430471}
POINT_B = {"latitude": 51.15, "longitude": 71.45}


@pytest.fixture
def obj():
    make_policy()
    return make_object("MAP-1", "Synthetic map object")


@pytest.fixture
def manager():
    return client_for("location-manager", "LOCATION_MANAGER", ("object.view", "object.manage"))[0]


@pytest.fixture
def reader():
    return client_for("location-reader", "LOCATION_READER", ("object.view",))[0]


def location_url(obj):
    return f"{URL}{obj.pk}/location/"


def test_save_rounds_point_and_list_and_detail_share_it(obj, manager, reader):
    other = make_object("MAP-2", "Another synthetic object")
    make_sector(obj)
    before = reader.get(f"{URL}{obj.pk}/").json()
    response = manager.patch(location_url(obj), {
        "location": {"latitude": 51.1282804, "longitude": 71.4304708},
    }, format="json")

    assert response.status_code == 200
    saved = response.json()
    assert saved["location"] == POINT_A
    assert saved["sectors"] == before["sectors"]
    for field in ("id", "name", "code", "type", "region", "address", "ownership", "objectState", "passportState"):
        assert saved[field] == before[field]
    assert reader.get(f"{URL}{obj.pk}/").json()["location"] == POINT_A
    rows = {row["id"]: row for row in reader.get(URL).json()["results"]}
    assert rows[str(obj.pk)]["location"] == POINT_A
    assert rows[str(other.pk)]["location"] is None
    obj.refresh_from_db()
    assert (obj.latitude, obj.longitude) == (51.12828, 71.430471)


def test_unknown_location_stays_null_and_clear_persists(obj, manager, reader):
    assert reader.get(f"{URL}{obj.pk}/").json()["location"] is None
    assert manager.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 200
    response = manager.patch(location_url(obj), {"location": None}, format="json")
    assert response.status_code == 200
    assert response.json()["location"] is None
    obj.refresh_from_db()
    assert obj.latitude is None and obj.longitude is None
    assert reader.get(URL).json()["results"][0]["location"] is None


@pytest.mark.parametrize("point", [
    {"latitude": 0, "longitude": 0},
    {"latitude": -90, "longitude": -180},
    {"latitude": 90, "longitude": 180},
    {"latitude": 43.25, "longitude": 76.95},
])
def test_wgs84_point_is_valid_even_when_outside_local_map(obj, manager, point):
    response = manager.patch(location_url(obj), {"location": point}, format="json")
    assert response.status_code == 200
    assert response.json()["location"] == point


@pytest.mark.parametrize("payload", [
    {}, [], None, {"location": {}}, {"location": []}, {"location": 0},
    {"location": {"latitude": 51}},
    {"location": {"latitude": 51, "longitude": 71, "altitude": 1}},
    {"location": {"latitude": "51", "longitude": 71}},
    {"location": {"latitude": True, "longitude": 71}},
    {"location": {"latitude": 51, "longitude": False}},
    {"location": {"latitude": None, "longitude": 71}},
    {"location": {"latitude": 90.000001, "longitude": 71}},
    {"location": {"latitude": 51, "longitude": -180.000001}},
])
def test_invalid_payload_does_not_change_point_or_timestamp(obj, manager, payload):
    before = obj.updated_at
    response = manager.patch(location_url(obj), payload, format="json")
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"
    obj.refresh_from_db()
    assert obj.latitude is None and obj.longitude is None
    assert obj.updated_at == before


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), 10**1000])
def test_nonfinite_coordinate_is_a_domain_error(value):
    from organization_management.apps.ops.object_locations import normalize_location

    with pytest.raises(DomainError) as error:
        normalize_location({"latitude": value, "longitude": 71})
    assert error.value.code == "VALIDATION_ERROR"


def test_reader_cannot_save_and_unprivileged_users_cannot_read(obj, reader):
    assert reader.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 403
    stranger = client_for("location-stranger", "LOCATION_STRANGER", ("event.view",))[0]
    assert stranger.get(f"{URL}{obj.pk}/").status_code == 403
    assert stranger.get(URL).status_code == 403
    assert stranger.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 403
    anonymous = APIClient()
    assert anonymous.get(f"{URL}{obj.pk}/").status_code in (401, 403)
    assert anonymous.patch(location_url(obj), {"location": POINT_A}, format="json").status_code in (401, 403)
    obj.refresh_from_db()
    assert obj.latitude is None and obj.longitude is None


@pytest.mark.parametrize("object_id", ["not-a-number", "0", "99999999999999999999999999999999999"])
def test_unknown_or_invalid_object_id_is_domain_404(manager, object_id):
    response = manager.patch(f"{URL}{object_id}/location/", {"location": POINT_A}, format="json")
    assert response.status_code == 404
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_location_audit_is_atomic_and_a_noop_does_not_make_a_change(obj, manager, monkeypatch):
    assert manager.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 200
    entry = OpsAuditLog.objects.get(action="SECURITY_OBJECT_LOCATION_UPDATED", entity_id=str(obj.pk))
    assert entry.entity_type == "security_object"
    assert entry.old_value == {"location": None}
    assert entry.new_value == {"location": POINT_A}
    before = OpsAuditLog.objects.filter(action="SECURITY_OBJECT_LOCATION_UPDATED").count()
    assert manager.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 200
    assert OpsAuditLog.objects.filter(action="SECURITY_OBJECT_LOCATION_UPDATED").count() == before

    from organization_management.apps.ops.object_locations import set_object_location

    old_updated_at = OpsSecurityObject.objects.get(pk=obj.pk).updated_at

    def fail_audit(**kwargs):
        raise RuntimeError("synthetic audit failure")

    monkeypatch.setattr(audit_service, "record", fail_audit)
    with pytest.raises(RuntimeError, match="synthetic audit failure"):
        set_object_location(obj.pk, POINT_B, actor="synthetic")
    obj.refresh_from_db()
    assert (obj.latitude, obj.longitude) == (51.12828, 71.430471)
    assert obj.updated_at == old_updated_at
    assert OpsAuditLog.objects.filter(action="SECURITY_OBJECT_LOCATION_UPDATED").count() == before


@pytest.mark.parametrize("latitude,longitude", [
    (None, 71), (51, None), (-90.1, 71), (51, 180.1),
    (float("nan"), 71), (51, float("inf")),
])
def test_database_rejects_invalid_object_coordinate_pairs(obj, latitude, longitude):
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsSecurityObject.objects.filter(pk=obj.pk).update(latitude=latitude, longitude=longitude)


@pytest.mark.parametrize("latitude,longitude", [
    (None, 71), (51, None), (90.1, 71), (51, -180.1),
    (float("inf"), 71), (51, float("nan")),
])
def test_database_rejects_invalid_snapshot_coordinate_pairs(obj, latitude, longitude):
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsPassportVersion.objects.create(
            security_object=obj, version_number=1, effective_from=dt.date(2026, 11, 2),
            published_at=dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc),
            published_by="synthetic", sectors_snapshot=[],
            latitude_snapshot=latitude, longitude_snapshot=longitude,
        )


def test_passport_versions_snapshot_saved_point_and_do_not_follow_current_object(obj, manager, reader):
    make_sector(obj, "Original sector")
    # A pre-map publication is deliberately missing a location snapshot.
    legacy = OpsPassportVersion.objects.create(
        security_object=obj, version_number=1, effective_from=dt.date(2026, 10, 1),
        published_at=dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc),
        published_by="synthetic", sectors_snapshot=[],
    )
    assert manager.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 200
    first = manager.post(f"{URL}{obj.pk}/passport/versions/", {
        "effectiveFrom": "2026-11-01", "note": "first", "location": POINT_B,
    }, format="json")
    assert first.status_code == 201
    assert first.json()["passportState"] == "GREEN"
    assert manager.patch(location_url(obj), {"location": POINT_B}, format="json").json()["passportState"] == "GREEN"
    second = manager.post(f"{URL}{obj.pk}/passport/versions/", {
        "effectiveFrom": "2026-11-02", "note": "second",
    }, format="json")
    assert second.status_code == 201
    assert manager.patch(location_url(obj), {"location": None}, format="json").status_code == 200

    row = reader.get(f"{URL}{obj.pk}/").json()
    assert row["location"] is None
    assert [version["location"] for version in row["passportVersions"]] == [None, POINT_A, POINT_B]
    legacy.refresh_from_db()
    assert legacy.latitude_snapshot is None and legacy.longitude_snapshot is None


def test_publish_refreshes_stale_prefetch_before_snapshotting_sectors_and_point(obj):
    sector = make_sector(obj, "Old sector")
    stale = OpsSecurityObject.objects.prefetch_related("sectors__posts", "passport_versions").get(pk=obj.pk)
    # Simulate another completed edit after the publishing caller read its object.
    OpsSecurityObject.objects.filter(pk=obj.pk).update(latitude=51.15, longitude=71.45)
    OpsObjectSector.objects.filter(pk=sector.pk).update(name="Fresh sector")
    passport.publish_version(stale, effective_from="2026-11-02", note="fresh", actor="synthetic")
    version = OpsPassportVersion.objects.get(security_object=obj)
    assert (version.latitude_snapshot, version.longitude_snapshot) == (51.15, 71.45)
    assert version.sectors_snapshot[0]["name"] == "Fresh sector"


def test_location_does_not_make_empty_passport_publishable(obj, manager):
    assert manager.patch(location_url(obj), {"location": POINT_A}, format="json").status_code == 200
    response = manager.post(f"{URL}{obj.pk}/passport/versions/", {
        "effectiveFrom": "2026-11-02", "note": "still empty",
    }, format="json")
    assert response.status_code == 400
    assert not OpsPassportVersion.objects.filter(security_object=obj).exists()
