import json

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsSecurityEventVisitObject, OpsPlacementDocumentVersion, OpsVisitObjectDeputy
from .test_ops_placement_post_removal import prepared
from .test_ops_security_events_api import chief_for, manager, viewer  # noqa: F401

pytestmark = pytest.mark.django_db
POINT = {"latitude": 51.128, "longitude": 71.43}


@pytest.fixture(autouse=True)
def private_map_storage(settings, tmp_path):
    settings.OPS_PRIVATE_STORAGE_ROOT = str(tmp_path)
    return tmp_path


def test_coordinates_persist_without_changing_posts_people_or_need(manager, private_map_storage):
    base, before = prepared(manager)
    visit_id = before["visitObjects"][0]["id"]
    response = manager.patch(base + "placement/map/", {"targetType": "object", "targetId": visit_id, "location": POINT}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["objects"][visit_id] == POINT
    assert manager.get(base + "placement/map/").json()["objects"][visit_id] == POINT
    after = manager.get(base).json()
    assert after["reconSectorPosts"] == before["reconSectorPosts"]
    assert after["placementAssignments"] == before["placementAssignments"]
    assert after["forceRoster"] == before["forceRoster"]
    stored_file = private_map_storage / "maps" / f'{before["id"]}.geojson'
    assert stored_file.is_file()
    stored = json.loads(stored_file.read_text(encoding="utf-8"))
    assert stored["type"] == "FeatureCollection"
    assert stored["features"][0]["geometry"] == {"type": "Point", "coordinates": [71.43, 51.128]}


def test_outdoor_post_can_be_marked_and_cleared_without_removing_the_post(manager):
    base, before = prepared(manager)
    post_id = before["reconSectorPosts"][0]["id"]
    response = manager.patch(base + "placement/map/", {"targetType": "post", "targetId": post_id, "location": POINT, "outdoor": True}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["posts"][post_id] == {"location": POINT, "outdoor": True}
    removed = manager.patch(base + "placement/map/", {"targetType": "post", "targetId": post_id, "location": None, "outdoor": False}, format="json")
    assert removed.status_code == 200, removed.content
    assert post_id not in removed.json()["posts"]
    assert manager.get(base).json()["reconSectorPosts"] == before["reconSectorPosts"]


@pytest.mark.parametrize("point", [
    {"latitude": 91, "longitude": 71}, {"latitude": 51, "longitude": 181},
    {"latitude": True, "longitude": 71}, {"latitude": "NaN", "longitude": 71},
    {"latitude": 51}, {"latitude": 51, "longitude": 71, "unexpected": 1}, [],
])
def test_invalid_coordinates_are_rejected_without_creating_map_data(manager, point, private_map_storage):
    base, data = prepared(manager)
    response = manager.patch(base + "placement/map/", {"targetType": "object", "targetId": data["visitObjects"][0]["id"], "location": point}, format="json")
    assert response.status_code == 400, response.content
    assert not list(private_map_storage.rglob("*.geojson"))


def test_map_read_does_not_grant_write_permission(manager, viewer, private_map_storage):
    base, data = prepared(manager)
    response = viewer.get(base + "placement/map/")
    assert response.status_code == 200, response.content
    assert response.json()["objects"] == {}
    denied = viewer.patch(base + "placement/map/", {"targetType": "object", "targetId": data["visitObjects"][0]["id"], "location": POINT}, format="json")
    assert denied.status_code == 403
    assert not list(private_map_storage.rglob("*.geojson"))


def test_coordinate_changes_stop_after_approval(manager, private_map_storage):
    base, data = prepared(manager)
    visit = OpsSecurityEventVisitObject.objects.get(pk=data["visitObjects"][0]["id"])
    visit.stage = "CONDUCT"
    visit.save(update_fields=["stage"])
    response = manager.patch(base + "placement/map/", {"targetType": "object", "targetId": str(visit.pk), "location": POINT}, format="json")
    assert response.status_code in {403, 409, 422}, response.content
    assert not list(private_map_storage.rglob("*.geojson"))


def test_foreign_visit_cannot_be_marked_on_this_event(manager, private_map_storage):
    base, data = prepared(manager)
    response = manager.patch(base + "placement/map/", {"targetType": "object", "targetId": "999999999", "location": POINT}, format="json")
    assert response.status_code in {400, 403, 404}, response.content
    assert not list(private_map_storage.rglob("*.geojson"))


def test_corrupt_map_is_an_unavailable_response_not_an_empty_map(manager, private_map_storage):
    base, data = prepared(manager)
    folder = private_map_storage / "maps"
    folder.mkdir()
    (folder / f'{data["id"]}.geojson').write_text("{broken", encoding="utf-8")
    response = manager.get(base + "placement/map/")
    assert response.status_code == 503, response.content


def test_failed_audit_restores_the_previous_coordinate_file(manager, monkeypatch):
    base, data = prepared(manager)
    visit_id = data["visitObjects"][0]["id"]
    first = manager.patch(base + "placement/map/", {"targetType": "object", "targetId": visit_id, "location": POINT}, format="json")
    assert first.status_code == 200, first.content
    from organization_management.apps.ops import map_locations
    def fail_audit(**kwargs):
        raise RuntimeError("deliberate audit failure")
    monkeypatch.setattr(map_locations.audit_service, "record", fail_audit)
    with pytest.raises(RuntimeError, match="deliberate audit failure"):
        manager.patch(base + "placement/map/", {"targetType": "object", "targetId": visit_id, "location": {"latitude": 51.13, "longitude": 71.44}}, format="json")
    assert manager.get(base + "placement/map/").json()["objects"][visit_id] == POINT


@pytest.mark.parametrize("role", ["chief", "deputy", "observer"])
def test_object_role_does_not_depend_on_having_a_post(manager, viewer, role):
    base, data = prepared(manager)
    visit = OpsSecurityEventVisitObject.objects.get(pk=data["visitObjects"][0]["id"])
    employee = chief_for(viewer)
    if role == "chief":
        visit.chief_employee_id = employee.pk
        visit.save(update_fields=["chief_employee_id"])
    else:
        OpsVisitObjectDeputy.objects.create(visit_object=visit, employee_id=employee.pk, employee_name="Тестовый замещающий", assigned_by="Тест", can_edit_placement=role == "deputy")
    OpsSecurityEvent.objects.filter(pk=data["id"]).update(recon_sector_posts=[], placement_assignments=[])
    response = viewer.patch(base + "placement/map/", {"targetType": "object", "targetId": str(visit.pk), "location": POINT}, format="json")
    assert response.status_code == (403 if role == "observer" else 200), response.content


@pytest.mark.parametrize("status", ["DRAFT", "RETURNED", "SUBMITTED", "APPROVED"])
def test_document_status_controls_coordinate_editing_on_approval(manager, status, private_map_storage):
    base, data = prepared(manager)
    visit = OpsSecurityEventVisitObject.objects.get(pk=data["visitObjects"][0]["id"])
    visit.stage = "APPROVAL"
    visit.save(update_fields=["stage"])
    OpsPlacementDocumentVersion.objects.create(visit_object=visit, number=1, status=status)
    response = manager.patch(base + "placement/map/", {"targetType": "object", "targetId": str(visit.pk), "location": POINT}, format="json")
    assert response.status_code == (200 if status in {"DRAFT", "RETURNED"} else 422), response.content
    if status in {"SUBMITTED", "APPROVED"}:
        assert not list(private_map_storage.rglob("*.geojson"))


def test_document_snapshot_includes_only_the_objects_actual_geometry(manager):
    from organization_management.apps.ops import security_events
    base, data = prepared(manager)
    visit_id = data["visitObjects"][0]["id"]
    visit = OpsSecurityEventVisitObject.objects.get(pk=visit_id)
    event = OpsSecurityEvent.objects.get(pk=data["id"])
    assert "map" not in security_events._document_snapshot(event, visit)
    manager.patch(base + "placement/map/", {"targetType": "object", "targetId": visit_id, "location": POINT}, format="json")
    snapshot = security_events._document_snapshot(event, visit)
    assert snapshot["map"] == {"objects": {visit_id: POINT}, "posts": {}}


def test_interrupted_writer_recovers_the_last_committed_coordinate_file(manager, monkeypatch):
    from organization_management.apps.ops import map_locations
    base, data = prepared(manager)
    visit_id = data["visitObjects"][0]["id"]
    body = {"targetType": "object", "targetId": visit_id, "location": POINT}
    assert manager.patch(base + "placement/map/", body, format="json").status_code == 200
    atomic_write = map_locations._atomic_write
    def interrupted(path, content):
        atomic_write(path, content)
        if path.name == f'{data["id"]}.geojson':
            raise SystemExit("simulated process termination")
    monkeypatch.setattr(map_locations, "_atomic_write", interrupted)
    actor = manager.handler._force_user
    with pytest.raises(SystemExit):
        map_locations.update(data["id"], {**body, "location": {"latitude": 51.2, "longitude": 71.5}}, actor=actor)
    monkeypatch.setattr(map_locations, "_atomic_write", atomic_write)
    assert manager.get(base + "placement/map/").json()["objects"][visit_id] == POINT


def test_coordinate_changes_change_the_signed_content(manager):
    from organization_management.apps.ops import security_events
    base, data = prepared(manager)
    event = OpsSecurityEvent.objects.get(pk=data["id"])
    visit = event.visit_objects.first()
    original = security_events.placement_signature(event, visit)
    manager.patch(base + "placement/map/", {"targetType": "object", "targetId": str(visit.pk), "location": POINT}, format="json")
    first = security_events.placement_signature(event, visit)
    manager.patch(base + "placement/map/", {"targetType": "object", "targetId": str(visit.pk), "location": {"latitude": 51.2, "longitude": 71.5}}, format="json")
    second = security_events.placement_signature(event, visit)
    assert len({original, first, second}) == 3


def test_unavailable_file_lock_has_a_domain_service_response(manager, monkeypatch):
    from organization_management.apps.ops import map_locations
    base, data = prepared(manager)
    assert manager.patch(base + "placement/map/", {"targetType": "object", "targetId": data["visitObjects"][0]["id"], "location": POINT}, format="json").status_code == 200
    original_open = map_locations.os.open
    def unavailable(path, *args, **kwargs):
        if str(path).endswith('.lock'):
            raise PermissionError("test private storage unavailable")
        return original_open(path, *args, **kwargs)
    monkeypatch.setattr(map_locations.os, "open", unavailable)
    response = manager.get(base + "placement/map/")
    assert response.status_code == 503, response.content


def test_corrupt_signed_map_does_not_block_the_event_or_registry(manager, private_map_storage):
    from organization_management.apps.ops import security_events
    base, data = prepared(manager)
    event = OpsSecurityEvent.objects.get(pk=data["id"])
    visit = event.visit_objects.first()
    manager.patch(base + "placement/map/", {"targetType": "object", "targetId": str(visit.pk), "location": POINT}, format="json")
    visit.approval_snapshot = security_events.placement_signature(event, visit)
    visit.stage = "APPROVAL"
    visit.save(update_fields=["approval_snapshot", "stage"])
    (private_map_storage / "maps" / f'{event.pk}.geojson').write_text('{broken', encoding='utf-8')
    assert manager.get(base).status_code == 200
    assert manager.get('/api/ops/security-events/').status_code == 200
    assert manager.get(base + 'placement/map/').status_code == 503
    from organization_management.apps.operations.exceptions import DomainError
    with pytest.raises(DomainError, match='PLACEMENT_MAP_UNAVAILABLE'):
        security_events.approval_is_stale(event, visit)


@pytest.mark.parametrize("target_type", [None, "unknown"])
def test_malformed_map_target_is_denied_without_recursing_through_role_scope(manager, viewer, target_type):
    base, data = prepared(manager)
    visit = OpsSecurityEventVisitObject.objects.get(pk=data["visitObjects"][0]["id"])
    visit.chief_employee_id = chief_for(viewer).pk
    visit.save(update_fields=["chief_employee_id"])
    response = viewer.patch(base + "placement/map/", {"targetType": target_type, "targetId": str(visit.pk), "location": POINT}, format="json")
    assert response.status_code in {400, 403}, response.content


@pytest.mark.django_db(transaction=True)
def test_reader_does_not_restore_old_bytes_while_the_writers_commit_is_pending(manager):
    import threading
    from django.db import close_old_connections, connections, transaction
    from organization_management.apps.ops import map_locations
    base, data = prepared(manager)
    visit_id = data["visitObjects"][0]["id"]
    assert manager.patch(base + "placement/map/", {"targetType": "object", "targetId": visit_id, "location": POINT}, format="json").status_code == 200
    event = OpsSecurityEvent.objects.get(pk=data["id"])
    path = map_locations._path(event)
    previous = path.read_bytes()
    ready, release = threading.Event(), threading.Event()
    entries, errors = [], []
    actor = manager.handler._force_user
    def pending_commit():
        close_old_connections()
        try:
            with transaction.atomic():
                OpsSecurityEvent.objects.select_for_update().get(pk=event.pk)
                entry = map_locations.audit_service.record(actor=actor, action=map_locations.audit_service.SECURITY_EVENT_MAP_LOCATION_UPDATED, entity_type=map_locations.audit_service.ENTITY_SECURITY_EVENT, entity_id=event.pk, new_value={"pending": True})
                entries.append(entry.pk)
                ready.set()
                if not release.wait(10):
                    raise TimeoutError("Reader did not finish")
        except BaseException as exc:
            errors.append(exc)
            ready.set()
        finally:
            connections.close_all()
    thread = threading.Thread(target=pending_commit)
    thread.start()
    try:
        assert ready.wait(10) and entries, errors
        newer = {"objects": {visit_id: {"latitude": 51.2, "longitude": 71.5}}, "posts": {}}
        map_locations._atomic_write(path.with_suffix('.previous.geojson'), previous)
        pending = map_locations._encode(event, newer, entries[0])
        map_locations._atomic_write(path, pending)
        response = manager.get(base + 'placement/map/')
        assert response.status_code == 503, response.content
        assert path.read_bytes() == pending
    finally:
        release.set()
        thread.join(10)
    assert not thread.is_alive() and not errors, errors
    response = manager.get(base + 'placement/map/')
    assert response.status_code == 200, response.content
    assert response.json() == newer
