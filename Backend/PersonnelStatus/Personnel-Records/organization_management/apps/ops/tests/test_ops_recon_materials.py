"""Real RECON material bytes, object ownership and private-file authorization."""
from io import BytesIO
from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from PIL import Image
from reportlab.pdfgen.canvas import Canvas

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops.tests.test_ops_recon_object_chief_access import (
    two_object_recon,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    manager,
    create_event,
    make_employee,
    make_object,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


def material_url(event_id, visit_id, material_id=None):
    base = f"/api/ops/security-events/{event_id}/visit-objects/{visit_id}/recon-materials/"
    return base if material_id is None else f"{base}{material_id}/"


def image_bytes(image_format="PNG"):
    stream = BytesIO()
    Image.new("RGB", (2, 2), color=(21, 42, 84)).save(stream, format=image_format)
    return stream.getvalue()


def png_bytes():
    return image_bytes()


def pdf_bytes():
    stream = BytesIO()
    canvas = Canvas(stream)
    canvas.drawString(40, 40, "RECON test material")
    canvas.save()
    return stream.getvalue()


def upload(api, url, data=None, *, content=None, name="photo.png", mime="image/png"):
    return api.post(
        url,
        {"file": SimpleUploadedFile(name, png_bytes() if content is None else content, content_type=mime), **(data or {})},
        format="multipart",
    )


@pytest.fixture(autouse=True)
def private_files(settings, tmp_path):
    settings.OPS_PRIVATE_STORAGE_ROOT = str(tmp_path / "private")
    settings.MEDIA_ROOT = str(tmp_path / "public")
    return tmp_path


def test_real_upload_download_reload_and_delete_only_owned_blob(two_object_recon, private_files, django_capture_on_commit_callbacks):
    from organization_management.apps.operations import document_service
    official = document_service.create_attachment(
        source=BytesIO(b"issued-document-bytes"), original_name="issued.pdf",
        content_type="application/pdf", actor="recon-tests",
    )
    official_path = Path(private_files / "private" / str(official.storage_key))
    official_hash = official.sha256
    event_id, first, second, chief_a, chief_b = two_object_recon
    first_url = material_url(event_id, first.pk)
    second_url = material_url(event_id, second.pk)
    created = upload(chief_a, first_url)
    assert created.status_code == 201, created.content
    neighbour_content = pdf_bytes()
    neighbour = upload(chief_b, second_url, content=neighbour_content, name="site-plan.pdf", mime="application/pdf")
    assert neighbour.status_code == 201, neighbour.content
    row = created.json()
    assert row["visitObjectId"] == str(first.pk)
    assert row["eventId"] == str(event_id)
    assert row["contentType"] == "image/png"
    assert row["size"] == len(png_bytes())
    assert row["checklistItemId"] is None
    assert "storage" not in str(row).lower()
    assert chief_a.get(first_url).json()["results"] == [row]
    assert chief_a.get(second_url).json()["results"] == [neighbour.json()]
    downloaded = chief_a.get(f"{first_url}{row['id']}/download/")
    assert downloaded.status_code == 200, downloaded.content
    assert b"".join(downloaded.streaming_content) == png_bytes()
    assert downloaded["Content-Type"] == "image/png"
    assert "attachment;" in downloaded["Content-Disposition"]
    assert "no-store" in downloaded["Cache-Control"]
    assert downloaded["X-Content-Type-Options"] == "nosniff"
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial
    own_file = Path(OpsReconMaterial.objects.get(pk=row["id"]).file.path)
    neighbour_file = Path(OpsReconMaterial.objects.get(pk=neighbour.json()["id"]).file.path)
    assert own_file.is_relative_to(private_files / "private")
    assert not (private_files / "public").exists()
    with django_capture_on_commit_callbacks(execute=True):
        removed = chief_a.delete(f"{first_url}{row['id']}/")
    assert removed.status_code == 204, removed.content
    assert not own_file.exists()
    assert neighbour_file.read_bytes() == neighbour_content
    assert not OpsReconMaterial.objects.filter(pk=row["id"]).exists()
    assert chief_a.get(first_url).json()["results"] == []
    assert chief_a.get(f"{first_url}{row['id']}/download/").status_code == 404
    official.refresh_from_db()
    assert official.sha256 == official_hash
    assert official_path.read_bytes() == b"issued-document-bytes"


def test_checklist_photos_are_bound_to_actual_item(two_object_recon):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    item_id = first.recon_checklist[0]["id"]
    url = material_url(event_id, first.pk)
    created = upload(chief_a, url, {"checklistItemId": item_id})
    assert created.status_code == 201, created.content
    assert created.json()["checklistItemId"] == item_id
    invalid = upload(chief_a, url, {"checklistItemId": "nonexistent-item"})
    assert invalid.status_code == 422, invalid.content
    pdf_photo = upload(chief_a, url, {"checklistItemId": item_id}, content=pdf_bytes(), name="plan.pdf", mime="application/pdf")
    assert pdf_photo.status_code == 422, pdf_photo.content
    assert len(chief_a.get(url).json()["results"]) == 1


@pytest.mark.parametrize("image_format,mime,extension", [("JPEG", "image/jpeg", "jpg"), ("WEBP", "image/webp", "webp")])
def test_supported_photo_formats_download_the_verified_original_bytes(two_object_recon, image_format, mime, extension):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    content = image_bytes(image_format)
    created = upload(chief_a, url, content=content, name=f"photo.{extension}", mime=mime)
    assert created.status_code == 201, created.content
    downloaded = chief_a.get(f"{url}{created.json()['id']}/download/")
    assert downloaded["Content-Type"] == mime
    assert b"".join(downloaded.streaming_content) == content


@pytest.mark.parametrize("content,name,mime", [
    (b"<script>alert(1)</script>", "photo.png", "image/png"),
    (b"%PDF-1.7\nbroken\n%%EOF", "broken.pdf", "application/pdf"),
    (b"", "empty.png", "image/png"),
    (b"text", "text.txt", "text/plain"),
    (png_bytes(), "fake.pdf", "application/pdf"),
    (png_bytes() + b"x" * (10 * 1024 * 1024), "big.png", "image/png"),
], ids=["html-as-image", "broken-pdf", "empty", "unsupported-type", "image-as-pdf", "oversized"])
def test_invalid_file_bytes_and_technical_limits_leave_no_blob(two_object_recon, private_files, content, name, mime):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    response = upload(chief_a, material_url(event_id, first.pk), content=content, name=name, mime=mime)
    assert response.status_code == 422, response.content
    assert list((private_files / "private").rglob("*.*")) == []


def test_chief_cannot_upload_or_remove_neighbours_material(two_object_recon):
    event_id, first, second, chief_a, chief_b = two_object_recon
    second_url = material_url(event_id, second.pk)
    created = upload(chief_b, second_url)
    assert created.status_code == 201, created.content
    assert upload(chief_a, second_url).status_code == 403
    assert chief_a.delete(f"{second_url}{created.json()['id']}/").status_code == 403
    forged_owner = material_url(event_id, first.pk, created.json()["id"])
    assert chief_a.get(f"{forged_owner}download/").status_code == 404
    assert chief_a.delete(forged_owner).status_code == 404


def test_event_manage_alone_does_not_replace_object_chief(two_object_recon):
    event_id, first, _second, _chief_a, _chief_b = two_object_recon
    api, _user = client_for("materials-manager", "MATERIALS_MANAGER", perms=("event.view", "event.manage"))
    denied = upload(api, material_url(event_id, first.pk))
    assert denied.status_code == 403, denied.content


def test_cross_event_visit_and_material_ids_are_not_accepted(two_object_recon, manager):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    created = upload(chief_a, material_url(event_id, first.pk))
    assert created.status_code == 201, created.content
    other_id = create_event(manager, make_object(code="MATERIAL-OTHER")).json()["id"]
    wrong = material_url(other_id, first.pk)
    assert manager.get(wrong).status_code == 404
    assert upload(manager, wrong).status_code == 404
    assert manager.get(f"{wrong}{created.json()['id']}/download/").status_code == 404


@pytest.mark.parametrize("stage", ["PLACEMENT", "CLOSED"])
def test_completed_or_closed_recon_is_immutable_but_materials_stay_readable(two_object_recon, stage):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    created = upload(chief_a, url)
    assert created.status_code == 201, created.content
    if stage == "CLOSED":
        OpsSecurityEvent.objects.filter(pk=event_id).update(stage="CLOSED")
    else:
        first.stage = stage
        first.save(update_fields=["stage"])
    assert upload(chief_a, url).status_code == 403
    assert chief_a.delete(f"{url}{created.json()['id']}/").status_code == 403
    assert chief_a.get(f"{url}{created.json()['id']}/download/").status_code == 200


def test_scoped_chief_reads_only_own_object_outside_allocation_scope(two_object_recon):
    event_id, first, second, chief_a, chief_b = two_object_recon
    first_created = upload(chief_a, material_url(event_id, first.pk))
    second_created = upload(chief_b, material_url(event_id, second.pk))
    assert first_created.status_code == second_created.status_code == 201
    own_division = Division.objects.create(name="RECON chief department")
    allocation_division = Division.objects.create(name="RECON allocated department")
    user = chief_a.handler._force_user
    employee = user.employee
    StaffUnit.objects.create(employee=employee, division=own_division, index=1)
    UserRole.objects.filter(user_id=str(user.pk), role_code_id="RECON_CHIEF_A").update(scope_division_id=own_division.pk)
    OpsSecurityEvent.objects.filter(pk=event_id).update(force_allocation=[{"departmentId": str(allocation_division.pk)}])
    own_url = material_url(event_id, first.pk)
    foreign_url = material_url(event_id, second.pk)
    assert chief_a.get(own_url).status_code == 200
    assert chief_a.get(f"{own_url}{first_created.json()['id']}/download/").status_code == 200
    assert upload(chief_a, own_url).status_code == 201
    assert chief_a.get(foreign_url).status_code == 403
    assert chief_a.get(f"{foreign_url}{second_created.json()['id']}/download/").status_code == 403
    employee.is_active = False
    employee.save(update_fields=["is_active"])
    assert chief_a.get(own_url).status_code == 403
    assert upload(chief_a, own_url).status_code == 403


def test_scoped_reader_needs_verified_allocation_scope_and_event_view(two_object_recon):
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    created = upload(chief_a, url)
    assert created.status_code == 201, created.content
    division = Division.objects.create(name="RECON visible division")
    foreign = Division.objects.create(name="RECON foreign division")
    reader, _user = client_for("materials-scoped-reader", "MATERIALS_SCOPED_READER", perms=("event.view",), scope_division_id=division.pk)
    no_view, _ = client_for("materials-no-view", "MATERIALS_NO_VIEW", perms=("event.manage",))
    assert reader.get(url).status_code == 403
    OpsSecurityEvent.objects.filter(pk=event_id).update(force_allocation=[{"departmentId": str(foreign.pk)}])
    assert reader.get(f"{url}{created.json()['id']}/download/").status_code == 403
    OpsSecurityEvent.objects.filter(pk=event_id).update(force_allocation=[{"departmentId": str(division.pk)}])
    assert reader.get(url).status_code == 200
    assert reader.get(f"{url}{created.json()['id']}/download/").status_code == 200
    assert no_view.get(url).status_code == 403
    assert no_view.get(f"{url}{created.json()['id']}/download/").status_code == 403


def test_download_fails_closed_for_missing_or_modified_private_bytes(two_object_recon):
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    created = upload(chief_a, url)
    assert created.status_code == 201, created.content
    row = OpsReconMaterial.objects.get(pk=created.json()["id"])
    original = Path(row.file.path).read_bytes()
    Path(row.file.path).write_bytes(original[:-1] + b"x")
    assert chief_a.get(f"{url}{row.pk}/download/").status_code == 404
    row.file.storage.delete(row.file.name)
    assert chief_a.get(f"{url}{row.pk}/download/").status_code == 404


def test_missing_chief_and_frozen_document_keep_existing_recon_guards(two_object_recon, manager):
    event_id, first, _second, _chief_a, _chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    first.chief_employee_id = None
    first.save(update_fields=["chief_employee_id"])
    no_chief = upload(manager, url)
    assert no_chief.status_code == 422, no_chief.content
    assert no_chief.json()["error_code"] == "VISIT_CHIEF_REQUIRED"
    first.chief_employee_id = make_employee().pk
    first.approval_status = "APPROVED"
    first.save(update_fields=["chief_employee_id", "approval_status"])
    frozen = upload(manager, url)
    assert frozen.status_code == 422, frozen.content
    assert frozen.json()["error_code"] == "PLACEMENT_FROZEN"


def test_visit_attachment_count_limit_does_not_consume_other_visits(two_object_recon):
    event_id, first, second, chief_a, chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    for _index in range(30):
        created = upload(chief_a, url)
        assert created.status_code == 201, created.content
    limited = upload(chief_a, url)
    assert limited.status_code == 422, limited.content
    assert len(chief_a.get(url).json()["results"]) == 30
    assert upload(chief_b, material_url(event_id, second.pk)).status_code == 201


def test_scoped_active_participant_reads_exact_assigned_visit_only(two_object_recon):
    event_id, first, second, chief_a, chief_b = two_object_recon
    own = upload(chief_a, material_url(event_id, first.pk))
    other = upload(chief_b, material_url(event_id, second.pk))
    assert own.status_code == other.status_code == 201
    division = Division.objects.create(name="RECON participant unit")
    api, user = client_for("materials-participant", "MATERIALS_PARTICIPANT", perms=("event.view",), scope_division_id=division.pk)
    employee = make_employee(last_name="Participant")
    employee.user = user
    employee.save(update_fields=["user"])
    StaffUnit.objects.create(employee=employee, division=division, index=2)
    OpsSecurityEvent.objects.filter(pk=event_id).update(
        recon_sector_posts=[{"id": "participant-post", "visitObjectId": str(first.pk)}],
        placement_assignments=[{"id": "participant-assignment", "employeeId": str(employee.pk), "postId": "participant-post"}],
    )
    own_url = material_url(event_id, first.pk)
    foreign_url = material_url(event_id, second.pk)
    assert api.get(own_url).status_code == 200
    assert api.get(f"{own_url}{own.json()['id']}/download/").status_code == 200
    assert api.get(foreign_url).status_code == 403
    assert api.get(f"{foreign_url}{other.json()['id']}/download/").status_code == 403
    assert upload(api, own_url).status_code == 403


@pytest.mark.parametrize("owner", ["visit", "event"])
def test_owner_cascade_removes_only_owned_private_blobs_after_commit(two_object_recon, private_files, django_capture_on_commit_callbacks, owner):
    from organization_management.apps.operations import document_service
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial
    event_id, first, second, chief_a, chief_b = two_object_recon
    own = upload(chief_a, material_url(event_id, first.pk))
    other = upload(chief_b, material_url(event_id, second.pk))
    assert own.status_code == other.status_code == 201
    own_file = Path(OpsReconMaterial.objects.get(pk=own.json()["id"]).file.path)
    other_file = Path(OpsReconMaterial.objects.get(pk=other.json()["id"]).file.path)
    official = document_service.create_attachment(source=BytesIO(b"official-independent"), original_name="official.pdf", content_type="application/pdf", actor="tests")
    official_path = private_files / "private" / str(official.storage_key)
    with django_capture_on_commit_callbacks(execute=True):
        if owner == "visit":
            first.delete()
        else:
            OpsSecurityEvent.objects.get(pk=event_id).delete()
        assert own_file.exists()  # Bytes are retained until the DB commit.
    assert not own_file.exists()
    assert other_file.exists() is (owner == "visit")
    assert official_path.read_bytes() == b"official-independent"
    official.refresh_from_db()


def test_remove_rollback_retains_metadata_and_private_bytes(two_object_recon, django_capture_on_commit_callbacks):
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    url = material_url(event_id, first.pk)
    created = upload(chief_a, url)
    assert created.status_code == 201, created.content
    material_id = created.json()["id"]
    path = Path(OpsReconMaterial.objects.get(pk=material_id).file.path)
    with django_capture_on_commit_callbacks(execute=True):
        with pytest.raises(RuntimeError, match="rollback fixture"):
            with transaction.atomic():
                removed = chief_a.delete(f"{url}{material_id}/")
                assert removed.status_code == 204
                assert not OpsReconMaterial.objects.filter(pk=material_id).exists()
                raise RuntimeError("rollback fixture")
    assert OpsReconMaterial.objects.filter(pk=material_id).exists()
    assert path.read_bytes() == png_bytes()


def test_owner_cascade_rollback_keeps_both_rows_and_files(two_object_recon, django_capture_on_commit_callbacks):
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    created = upload(chief_a, material_url(event_id, first.pk))
    assert created.status_code == 201, created.content
    material_id = created.json()["id"]
    path = Path(OpsReconMaterial.objects.get(pk=material_id).file.path)
    with django_capture_on_commit_callbacks(execute=True):
        with pytest.raises(RuntimeError, match="owner rollback"):
            with transaction.atomic():
                OpsSecurityEvent.objects.get(pk=event_id).delete()
                raise RuntimeError("owner rollback")
    assert OpsSecurityEvent.objects.filter(pk=event_id).exists()
    assert OpsReconMaterial.objects.filter(pk=material_id).exists()
    assert path.read_bytes() == png_bytes()


def test_owner_cascade_rejects_corrupted_key_that_targets_official_document(two_object_recon, private_files, django_capture_on_commit_callbacks):
    from organization_management.apps.operations import document_service
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial
    event_id, first, _second, chief_a, _chief_b = two_object_recon
    created = upload(chief_a, material_url(event_id, first.pk))
    assert created.status_code == 201, created.content
    official = document_service.create_attachment(source=BytesIO(b"official-protected"), original_name="issued.pdf", content_type="application/pdf", actor="tests")
    row = OpsReconMaterial.objects.get(pk=created.json()["id"])
    row.file.name = str(official.storage_key)
    row.save(update_fields=["file"])
    with django_capture_on_commit_callbacks(execute=True):
        with pytest.raises(DomainError):
            with transaction.atomic():
                OpsSecurityEvent.objects.get(pk=event_id).delete()
    assert OpsSecurityEvent.objects.filter(pk=event_id).exists()
    assert OpsReconMaterial.objects.filter(pk=row.pk).exists()
    assert (private_files / "private" / str(official.storage_key)).read_bytes() == b"official-protected"


def test_admin_exposes_only_read_only_metadata_without_private_keys(two_object_recon, client, rf):
    from django.contrib import admin
    from django.contrib.auth import get_user_model
    from organization_management.apps.operations.models_recon_material import OpsReconMaterial

    event_id, first, _second, chief_a, _chief_b = two_object_recon
    uploaded = upload(chief_a, material_url(event_id, first.pk))
    assert uploaded.status_code == 201, uploaded.content
    row = OpsReconMaterial.objects.get(pk=uploaded.json()["id"])
    original_bytes = Path(row.file.path).read_bytes()
    model_admin = admin.site._registry.get(OpsReconMaterial)
    assert model_admin is not None
    administrator = get_user_model().objects.create_superuser(username="recon-metadata-admin", password="x")
    request = rf.get("/admin/")
    request.user = administrator
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request, row) is False
    assert model_admin.has_delete_permission(request, row) is False
    assert "delete_selected" not in model_admin.get_actions(request)
    client.force_login(administrator)
    base = "/admin/operations/opsreconmaterial/"
    viewed = client.get(f"{base}{row.pk}/change/")
    assert viewed.status_code == 200
    assert row.original_name.encode() in viewed.content
    assert row.file.name.encode() not in viewed.content
    assert b'name="file"' not in viewed.content
    assert client.post(f"{base}{row.pk}/change/", {"file": "official-document-key.pdf", "original_name": "changed"}).status_code == 403
    assert client.post(f"{base}{row.pk}/delete/", {"post": "yes"}).status_code == 403
    assert client.get(f"{base}add/").status_code == 403
    row.refresh_from_db()
    assert row.original_name == uploaded.json()["name"]
    assert Path(row.file.path).read_bytes() == original_bytes
