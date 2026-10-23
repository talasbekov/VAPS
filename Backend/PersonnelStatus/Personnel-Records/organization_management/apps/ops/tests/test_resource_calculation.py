import copy
import io
import json
import zipfile
from uuid import uuid4

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db


def document():
    group, segment, route, row = [str(uuid4()) for _ in range(4)]
    return {"schemaVersion": 1, "groups": [{"id": group, "organization": "Организация", "callsign": "Группа", "vehicle": "Автомобиль", "vehicleType": "PASSENGER"}], "segments": [{"id": segment, "name": "Участок", "type": "Дорога", "tags": "", "pointA": "А", "pointB": "Б"}], "routes": [{"id": route, "name": "Маршрут", "start": "А", "end": "Б", "date": "2026-10-23", "time": "10:30", "rows": [{"id": row, "segmentId": segment, "reversed": False, "position": "RIGHT", "note": ""}]}], "assignments": {segment: group}}


@pytest.fixture
def scene():
    division = Division.objects.create(name="Владелец")
    api, user = client_for("resource-planner", "RESOURCE_TEST", ("event.view", "resource_calculation.manage"), scope_division_id=division.pk)
    event = OpsSecurityEvent.objects.create(code="RC-1", title="Мероприятие", object_name="Объект", business_date="2026-10-23", stage="BULLETIN", readiness_percent=0, force_need=0, conflicts_count=0, owner_name="", recon_checklist=[], recon_sector_posts=[], demand_rows=[], demand_approved=False, force_requests=[], placement_assignments=[], approval_status="PENDING", journal_entries=[], closure_direction_summaries=[])
    return api, user, division, event, f"/api/ops/security-events/{event.pk}/resource-calculation/"


def save(scene, doc=None, version=0, **extra):
    return scene[0].put(scene[4], {"expectedVersion": version, "document": doc or document(), **extra}, format="json")


def test_empty_get_has_no_writes_or_locks(scene):
    with CaptureQueriesContext(connection) as queries:
        response = scene[0].get(scene[4])
    assert response.status_code == 200
    assert response.json()["exists"] is False
    assert response.json()["ownerChoices"] == [{"id": scene[2].pk, "name": scene[2].name}]
    assert not any(q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) or "FOR UPDATE" in q["sql"].upper() for q in queries)


def test_save_snapshot_revision_and_owner_immutable(scene):
    result = save(scene)
    assert result.status_code == 200, result.content
    body = result.json()
    assert body["version"] == 1 and body["ownerDivisionId"] == scene[2].pk
    assert body["snapshot"]["dateTo"] is None
    assert save(scene).status_code == 409
    other = Division.objects.create(name="Другой")
    assert save(scene, version=1, ownerDivisionId=other.pk).status_code in (400, 403)
    assert scene[0].get(scene[4]).json()["version"] == 1


def test_foreign_scope_cannot_read_list_export_or_write(scene):
    assert save(scene).status_code == 200
    other = Division.objects.create(name="Чужой")
    api, _ = client_for("foreign", "RESOURCE_FOREIGN", ("event.view", "resource_calculation.view", "resource_calculation.manage"), scope_division_id=other.pk)
    assert api.get(scene[4]).status_code == 403
    assert api.get(scene[4] + "export/?format=json").status_code == 403
    assert api.put(scene[4], {"expectedVersion": 1, "document": document()}, format="json").status_code == 403
    assert api.get("/api/ops/resource-calculations/").json()["results"] == []


def test_reader_and_event_view_alone_do_not_create(scene):
    api, _ = client_for("reader", "RESOURCE_READER", ("event.view", "resource_calculation.view"), scope_division_id=scene[2].pk)
    response = api.get(scene[4])
    assert response.status_code == 200 and response.json()["canManage"] is False
    assert api.put(scene[4], {"expectedVersion": 0, "document": document()}, format="json").status_code == 403
    ordinary, _ = client_for("ordinary", "RESOURCE_ORDINARY", ("event.view",))
    assert ordinary.get(scene[4]).status_code == 403


def test_closed_read_and_saved_export_stay_available(scene):
    assert save(scene).status_code == 200
    OpsSecurityEvent.objects.filter(pk=scene[3].pk).update(stage="CLOSED", title="Изменено", business_date="2026-10-24")
    assert save(scene, version=1).status_code == 409
    body = scene[0].get(scene[4]).json()
    assert body["canManage"] is False and body["snapshot"]["title"] == "Мероприятие"
    exported = scene[0].get(scene[4] + "export/?format=json")
    assert exported.status_code == 200
    payload = json.loads(b"".join(exported.streaming_content))
    assert payload["snapshot"]["title"] == "Мероприятие"
    word = scene[0].get(scene[4] + "export/?format=docx")
    assert word.status_code == 200
    content = b"".join(word.streaming_content)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        xml = archive.read("word/document.xml").decode()
    assert "Мероприятие" in xml and "Изменено" not in xml


@pytest.mark.parametrize("mutation", ["duplicate", "foreign", "double", "date", "time", "boolean", "uuid", "schema", "owner"])
def test_invalid_document_rejected(scene, mutation):
    doc = document()
    if mutation == "duplicate": doc["groups"].append(copy.deepcopy(doc["groups"][0]))
    if mutation == "foreign": doc["routes"][0]["rows"][0]["segmentId"] = str(uuid4())
    if mutation == "double":
        segment = copy.deepcopy(doc["segments"][0]); segment["id"] = str(uuid4()); segment["name"] = "Другой"; doc["segments"].append(segment)
        doc["routes"][0]["rows"].append({**doc["routes"][0]["rows"][0], "id": str(uuid4()), "segmentId": segment["id"]})
        doc["assignments"][segment["id"]] = doc["groups"][0]["id"]
    if mutation == "date": doc["routes"][0]["date"] = "2026-10-24"
    if mutation == "time": doc["routes"][0]["time"] = "25:30"
    if mutation == "boolean": doc["routes"][0]["rows"][0]["reversed"] = "false"
    if mutation == "uuid": doc["groups"][0]["id"] = "bad"
    if mutation == "schema": doc["schemaVersion"] = True
    if mutation == "owner": doc["ownerDivisionId"] = scene[2].pk
    assert save(scene, doc).status_code == 400


def test_shared_segment_counts_once_and_prunes_only_last_use(scene):
    from organization_management.apps.ops.resource_calculation import summary
    doc = document()
    route = copy.deepcopy(doc["routes"][0]); route["id"] = str(uuid4()); route["rows"][0]["id"] = str(uuid4()); route["rows"][0]["reversed"] = True
    doc["routes"].append(route)
    assert save(scene, doc).status_code == 200
    assert summary(doc)["groupCount"] == 1
    doc["routes"].pop()
    assert save(scene, doc, 1).json()["document"]["assignments"] == doc["assignments"]
    doc["routes"] = []
    response = save(scene, doc, 2)
    assert response.status_code == 200 and response.json()["document"]["assignments"] == {}
    assert response.json()["issues"]
    assert scene[0].get(scene[4] + "export/?format=docx").status_code == 400
    assert scene[0].get(scene[4] + "export/?format=json").status_code == 200


def test_required_version_and_explicit_global_owner(scene):
    assert scene[0].put(scene[4], {"document": document()}, format="json").status_code == 400
    api, _ = client_for("global", "RESOURCE_GLOBAL", ("event.view", "resource_calculation.manage"))
    assert api.put(scene[4], {"expectedVersion": 0, "document": document()}, format="json").status_code == 400
    assert api.put(scene[4], {"expectedVersion": 0, "document": document(), "ownerDivisionId": scene[2].pk}, format="json").status_code == 200


def test_seed_metadata_does_not_widen_existing_roles():
    from organization_management.apps.operations.management.commands.seed_operations import ROLE_PERMISSIONS
    assert set(ROLE_PERMISSIONS["RESOURCE_CALCULATION_PLANNER"]) == {"event.view", "resource_calculation.view", "resource_calculation.manage"}
    assert not any("resource_calculation.manage" in perms for role, perms in ROLE_PERMISSIONS.items() if role != "RESOURCE_CALCULATION_PLANNER")


def test_saved_read_list_export_have_no_writes_or_locks(scene):
    assert save(scene).status_code == 200
    with CaptureQueriesContext(connection) as queries:
        for url in (scene[4], scene[4] + "export/?format=json", scene[4] + "export/?format=docx", "/api/ops/resource-calculations/"):
            assert scene[0].get(url).status_code == 200
    assert not any(q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) or "FOR UPDATE" in q["sql"].upper() for q in queries)


def test_revoked_scope_is_rechecked_after_loading(scene):
    from organization_management.apps.operations.models import UserRole
    assert save(scene).status_code == 200
    UserRole.objects.filter(user_id=str(scene[1].pk)).update(is_active=False)
    assert scene[0].get(scene[4]).status_code == 403
    assert save(scene, version=1).status_code == 403


def test_atomic_unassign_and_delete_catalog_group_is_valid_final_graph(scene):
    doc = document()
    assert save(scene, doc).status_code == 200
    doc["assignments"] = {}
    doc["groups"] = []
    response = save(scene, doc, 1)
    assert response.status_code == 200 and response.json()["document"]["groups"] == []
    assert response.json()["issues"]


def test_exports_escape_text_and_do_not_include_live_or_unsaved_content(scene):
    from xml.etree import ElementTree
    doc = document()
    doc["routes"][0]["name"] = '<script>& "маршрут"'
    assert save(scene, doc).status_code == 200
    exported = scene[0].get(scene[4] + "export/?format=docx")
    with zipfile.ZipFile(io.BytesIO(b"".join(exported.streaming_content))) as archive:
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    assert '<script>& "маршрут"' in "".join(root.itertext())
    assert b"<script>" not in xml
    assert "дата окончания не указана" in "".join(root.itertext())
    assert "Техника по организациям" in "".join(root.itertext())


def test_validation_error_is_a_human_readable_drf_detail(scene):
    doc = document()
    doc["routes"][0]["time"] = "25:99"
    response = save(scene, doc)
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert "Время" in response.json()["detail"]


def test_incomplete_route_issues_identify_missing_fields(scene):
    doc = document()
    doc["routes"][0]["name"] = ""
    doc["routes"][0]["date"] = ""
    response = save(scene, doc)
    assert response.status_code == 200
    messages = [issue["message"] for issue in response.json()["issues"]]
    assert any("название" in message and "Маршрут 1" in message for message in messages)
    assert any("дату" in message and "Маршрут 1" in message for message in messages)


def test_migration_metadata_is_idempotent_and_never_assigns_users():
    from importlib import import_module
    from types import SimpleNamespace
    from django.apps import apps
    from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
    migration = import_module("organization_management.apps.operations.migrations.0147_resource_calculation")
    custom = Role.objects.create(code="RESOURCE_EXISTING", name="Своё название")
    permission = Permission.objects.create(code="resource.custom", name="Своё право")
    RolePermission.objects.create(role_code=custom, permission_code=permission)
    before = set(RolePermission.objects.exclude(role_code_id="RESOURCE_CALCULATION_PLANNER").values_list("role_code_id", "permission_code_id"))
    assignments = UserRole.objects.count()
    for _ in range(2): migration.seed_metadata(apps, SimpleNamespace(connection=connection))
    assert UserRole.objects.count() == assignments
    assert set(RolePermission.objects.exclude(role_code_id="RESOURCE_CALCULATION_PLANNER").values_list("role_code_id", "permission_code_id")) == before
    assert set(RolePermission.objects.filter(role_code_id="RESOURCE_CALCULATION_PLANNER").values_list("permission_code_id", flat=True)) == {"event.view", "resource_calculation.view", "resource_calculation.manage"}
    custom.refresh_from_db()
    assert custom.name == "Своё название"


def test_migration_does_not_broaden_a_preexisting_role_code_collision():
    from importlib import import_module
    from types import SimpleNamespace
    from django.apps import apps
    from organization_management.apps.operations.models import Role, RolePermission, UserRole
    code = "RESOURCE_CALCULATION_PLANNER"
    role = Role.objects.get(code=code)
    role.name = "Существующее полномочие"
    role.save()
    RolePermission.objects.filter(role_code_id=code).delete()
    api, user = client_for("resource-collision", code, ("resource.custom",))
    assignments = list(UserRole.objects.values("user_id", "role_code_id", "scope_division_id", "is_active"))
    migration = import_module("organization_management.apps.operations.migrations.0147_resource_calculation")
    migration.seed_metadata(apps, SimpleNamespace(connection=connection))
    assert set(RolePermission.objects.filter(role_code_id=code).values_list("permission_code_id", flat=True)) == {"resource.custom"}
    assert list(UserRole.objects.values("user_id", "role_code_id", "scope_division_id", "is_active")) == assignments
    role.refresh_from_db()
    assert role.name == "Существующее полномочие"


def test_event_permission_is_fresh_even_if_request_permission_cache_is_stale(scene):
    from types import SimpleNamespace
    from rest_framework.exceptions import PermissionDenied
    from organization_management.apps.operations.models import RolePermission
    from organization_management.apps.ops.resource_calculation import replace
    request = SimpleNamespace(user=scene[1], _ops_effective_permissions={"event.view", "resource_calculation.manage"})
    RolePermission.objects.filter(role_code_id="RESOURCE_TEST", permission_code_id="event.view").delete()
    with pytest.raises(PermissionDenied):
        replace(request, scene[3].pk, {"expectedVersion": 0, "document": document()})


def test_admin_can_inspect_saved_calculation_without_bypassing_service(scene, rf):
    from django.contrib import admin
    from organization_management.apps.operations.models_resource_calculation import OpsResourceCalculation
    assert save(scene).status_code == 200
    scene[1].is_superuser = True
    scene[1].is_staff = True
    request = rf.get("/admin/")
    request.user = scene[1]
    model_admin = admin.site._registry[OpsResourceCalculation]
    calculation = OpsResourceCalculation.objects.get(event=scene[3])
    assert model_admin.has_view_permission(request, calculation)
    assert not model_admin.has_add_permission(request)
    assert not model_admin.has_change_permission(request, calculation)
    assert not model_admin.has_delete_permission(request, calculation)


@pytest.mark.parametrize("case", ["oversized", "too_many_groups", "case_duplicate", "bad_ref", "long_note", "invalid_xml", "invalid_owner"])
def test_document_bounds_and_catalog_integrity(scene, case):
    doc = document()
    extra = {}
    if case == "oversized": doc["groups"][0]["organization"] = "я" * (1024 * 1024)
    if case == "too_many_groups": doc["groups"] = [{**doc["groups"][0], "id": str(uuid4()), "callsign": str(i)} for i in range(201)]
    if case == "case_duplicate": doc["groups"].append({**doc["groups"][0], "id": str(uuid4()), "callsign": "ГРУППА"})
    if case == "bad_ref": doc["assignments"][doc["segments"][0]["id"]] = str(uuid4())
    if case == "long_note": doc["routes"][0]["rows"][0]["note"] = "x" * 1001
    if case == "invalid_xml": doc["groups"][0]["callsign"] = "bad\x00text"
    if case == "invalid_owner": extra["ownerDivisionId"] = True
    assert save(scene, doc, **extra).status_code == 400


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("expected_version", [0, 1])
def test_concurrent_saves_have_one_winner(scene, expected_version):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    from rest_framework.test import APIClient
    if expected_version: assert save(scene).status_code == 200
    barrier = Barrier(2)
    def attempt():
        close_old_connections()
        api = APIClient()
        api.force_authenticate(scene[1])
        try:
            barrier.wait(timeout=10)
            response = api.put(scene[4], {"expectedVersion": expected_version, "document": document()}, format="json")
            return response.status_code
        finally:
            connection.close()
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: attempt(), range(2)))
    assert sorted(responses) == [200, 409]
    from organization_management.apps.operations.models_resource_calculation import OpsResourceCalculation
    assert OpsResourceCalculation.objects.get(event=scene[3]).version == expected_version + 1
