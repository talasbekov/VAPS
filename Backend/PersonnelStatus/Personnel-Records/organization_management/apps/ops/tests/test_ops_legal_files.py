"""Private normative files: authenticated bytes, global writes and history."""
import hashlib
import io
import zipfile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from pypdf import PdfWriter
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

URL = "/api/ops/legal-documents/"
pytestmark = pytest.mark.django_db


def pdf_bytes():
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(output)
    return output.getvalue()


def upload(content=None, name="training.pdf"):
    return SimpleUploadedFile(name, pdf_bytes() if content is None else content, "application/pdf")


def metadata(**extra):
    return {"kind": "LAW", "code": "TRAINING-1", "title": "Educational fixture", "status": "IN_FORCE", **extra}


@pytest.fixture(autouse=True)
def private_root(settings, tmp_path):
    settings.OPS_PRIVATE_STORAGE_ROOT = str(tmp_path / "private")
    settings.MEDIA_ROOT = str(tmp_path / "public")


def manager():
    return client_for("legal-manager", "TEST_LEGAL_MANAGER", ["legal.manage"])


def test_manager_creates_pdf_and_reader_downloads_identical_private_bytes():
    api, user = manager()
    content = pdf_bytes()
    response = api.post(URL, metadata(file=upload(content)), format="multipart")
    assert response.status_code == 201, response.content
    row = response.json()
    assert row["version"] == 1
    assert row["pages"] == 1
    assert row["fileUrl"] is None
    assert row["file"]["sha256"] == hashlib.sha256(content).hexdigest()
    assert row["file"]["uploadedBy"] == str(user.pk)
    assert set(row["file"]) == {"id", "name", "contentType", "size", "sha256", "uploadedAt", "uploadedBy"}
    reader, _ = client_for("legal-reader", "TEST_LEGAL_READER", ["catalog.view"])
    listing = reader.get(URL).json()
    assert listing["canManage"] is False
    assert listing["maxFileSizeBytes"] == 10 * 1024 * 1024
    path = f"{URL}{row['id']}/files/{row['file']['id']}/download/"
    downloaded = reader.get(path)
    assert downloaded.status_code == 200
    assert b"".join(downloaded.streaming_content) == content
    assert downloaded["Cache-Control"] == "private, no-store"
    assert downloaded["X-Content-Type-Options"] == "nosniff"
    assert "attachment" in downloaded["Content-Disposition"]
    assert APIClient().get(path).status_code == 401


@pytest.mark.parametrize("scoped", [False, True])
def test_reader_and_scoped_manager_cannot_mutate_global_register(scoped):
    division = Division.objects.create(name="Legal scope")
    api, _ = client_for("limited-legal", "TEST_LIMITED_LEGAL", ["legal.manage" if scoped else "catalog.view"], scope_division_id=division.pk if scoped else None)
    assert api.get(URL).status_code == 200
    assert api.get(URL).json()["canManage"] is False
    response = api.post(URL, metadata(file=upload()), format="multipart")
    assert response.status_code == 403
    from organization_management.apps.ops.tests.test_ops_legal_api import make_doc
    row = make_doc()
    assert api.patch(f"{URL}{row.pk}/", {"expectedVersion": 1, "title": "Unauthorized"}, format="multipart").status_code == 403


def docx_bytes(extra=None):
    output = io.BytesIO()
    members = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
        **(extra or {}),
    }
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return output.getvalue()


def create(api, **extra):
    response = api.post(URL, metadata(**extra), format="multipart")
    assert response.status_code == 201, response.content
    return response.json()


def download(api, row, file_id=None):
    return api.get(f"{URL}{row['id']}/files/{file_id or row['file']['id']}/download/")


def test_docx_roundtrip_and_replacement_retains_old_pdf_bytes():
    api, _ = manager()
    pdf = pdf_bytes()
    row = create(api, file=upload(pdf))
    docx = docx_bytes()
    response = api.patch(f"{URL}{row['id']}/", {"expectedVersion": 1, "title": "Revised fixture", "file": upload(docx, "fixture.docx")}, format="multipart")
    assert response.status_code == 200, response.content
    updated = response.json()
    assert updated["id"] == row["id"]
    assert updated["version"] == 2
    assert updated["pages"] is None
    assert updated["file"]["contentType"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert b"".join(download(api, updated).streaming_content) == docx
    assert b"".join(download(api, row).streaming_content) == pdf
    history = api.get(f"{URL}{row['id']}/files/").json()["results"]
    assert [file["id"] for file in history] == [updated["file"]["id"], row["file"]["id"]]
    from organization_management.apps.operations.models_audit import OpsAuditLog
    actions = list(OpsAuditLog.objects.filter(entity_type="legal_document", entity_id=row["id"]).values_list("action", flat=True))
    assert sorted(actions) == ["LEGAL_DOCUMENT_CREATED", "LEGAL_DOCUMENT_FILE_UPLOADED", "LEGAL_DOCUMENT_FILE_UPLOADED", "LEGAL_DOCUMENT_UPDATED"]


@pytest.mark.parametrize("content,name", [(b"", "empty.pdf"), (b"%PDF-1.7\nmalformed", "bad.pdf"), (b"plain text", "bad.pdf"), (b"bad zip", "bad.docx"), (docx_bytes({"word/vbaProject.bin": b"macro"}), "macro.docx"), (docx_bytes({"../outside": b"x"}), "unsafe.docx"), (docx_bytes({"word/bad.xml": b"<broken>"}), "broken.docx"), (docx_bytes({"word/bomb.xml": b"x" * (41 * 1024 * 1024)}), "bomb.docx"), (pdf_bytes(), "bad.exe"), (b"x" * (10 * 1024 * 1024 + 1), "large.pdf")], ids=lambda value: value if isinstance(value, str) else "bytes")
def test_invalid_upload_does_not_create_document_or_blob(content, name, settings):
    api, _ = manager()
    response = api.post(URL, metadata(file=upload(content, name)), format="multipart")
    assert response.status_code == 400, response.content
    assert "file" in response.json().get("details", response.json())
    from pathlib import Path
    from organization_management.apps.operations.models_legal import OpsLegalDocument
    assert not OpsLegalDocument.objects.exists()
    assert not [p for p in Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*") if p.is_file()]


def test_encrypted_pdf_rejected():
    stream = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.encrypt("secret")
    writer.write(stream)
    api, _ = manager()
    assert api.post(URL, metadata(file=upload(stream.getvalue())), format="multipart").status_code == 400


def test_pdf_at_ten_mib_boundary_is_accepted():
    content = pdf_bytes()
    content += b" " * (10 * 1024 * 1024 - len(content))
    api, _ = manager()
    row = create(api, file=upload(content))
    assert row["file"]["size"] == 10 * 1024 * 1024


def test_stale_update_rejected_before_any_blob_is_written(settings):
    from pathlib import Path
    api, _ = manager()
    row = create(api, file=upload())
    url = f"{URL}{row['id']}/"
    assert api.patch(url, {"expectedVersion": 1, "title": "Winner"}, format="multipart").status_code == 200
    before = set(Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*"))
    response = api.patch(url, {"expectedVersion": 1, "title": "Stale", "file": upload()}, format="multipart")
    assert response.status_code == 409
    assert set(Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*")) == before
    assert api.get(URL).json()["results"][0]["title"] == "Winner"


def test_legacy_metadata_and_links_survive_edit_and_invalid_fields_are_visible():
    from organization_management.apps.ops.tests.test_ops_legal_api import make_doc
    api, _ = manager()
    legacy = make_doc(file_url="https://example.org/existing.pdf", pages=7)
    response = api.patch(f"{URL}{legacy.pk}/", {"expectedVersion": 1, "description": "Updated"}, format="multipart")
    assert response.status_code == 200
    row = response.json()
    assert row["id"] == str(legacy.pk)
    assert row["fileUrl"] == "https://example.org/existing.pdf"
    assert row["pages"] == 7
    assert row["file"] is None
    assert create(api, code="NO-PAGES")["pages"] is None
    for fields, field in [(metadata(kind="BAD"), "kind"), (metadata(status="BAD"), "status"), (metadata(code=legacy.code), "code"), (metadata(title=""), "title"), (metadata(pages="bad"), "pages"), ({"kind": "LAW"}, "code")]:
        response = api.post(URL, fields, format="multipart")
        assert response.status_code == 400
        assert field in response.json().get("details", response.json())
    assert api.patch(f"{URL}{legacy.pk}/", {"title": "No version"}, format="multipart").status_code == 400
    assert api.patch(f"{URL}{legacy.pk}/", {"expectedVersion": 2, "fileUrl": "http://changed"}, format="multipart").status_code == 400
    assert api.delete(f"{URL}{legacy.pk}/").status_code == 405


def test_wrong_document_inactive_document_and_missing_or_tampered_blob_rejected():
    from organization_management.apps.operations.models_legal import OpsLegalDocument, OpsLegalDocumentFile
    api, _ = manager()
    row = create(api, file=upload())
    other = create(api, code="OTHER", file=upload())
    assert download(api, other, row["file"]["id"]).status_code == 404
    record = OpsLegalDocumentFile.objects.get(pk=row["file"]["id"])
    from pathlib import Path
    path = Path(record.file.path)
    content = path.read_bytes()
    path.write_bytes(b"x" * len(content))
    assert download(api, row).status_code == 500
    path.unlink()
    assert download(api, row).status_code == 404
    OpsLegalDocument.objects.filter(pk=other["id"]).update(is_active=False)
    assert download(api, other).status_code == 404
    assert api.get(f"{URL}{other['id']}/files/").status_code == 404


def test_client_name_does_not_control_private_path_and_public_media_is_empty(settings):
    from pathlib import Path
    from organization_management.apps.operations.models_legal import OpsLegalDocumentFile
    api, _ = manager()
    row = create(api, file=upload(name="../../outside.pdf"))
    record = OpsLegalDocumentFile.objects.get(pk=row["file"]["id"])
    assert record.file.name.startswith(f"legal-documents/{row['id']}/")
    assert "outside" not in record.file.name
    assert Path(record.file.path).resolve().is_relative_to(Path(settings.OPS_PRIVATE_STORAGE_ROOT).resolve())
    assert not list(Path(settings.MEDIA_ROOT).rglob("*"))
    with pytest.raises(Exception):
        _ = record.file.url
    record.file.name = "../outside.pdf"
    record.save(update_fields=["file"])
    assert download(api, row).status_code == 500


def test_storage_and_database_failure_roll_back_metadata_and_keep_previous_file(monkeypatch, settings):
    from pathlib import Path
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.legal_document_storage import LegalDocumentStorage
    from organization_management.apps.operations.models_legal import OpsLegalDocument
    api, _ = manager()
    row = create(api, file=upload())
    before = {p: p.read_bytes() for p in Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*") if p.is_file()}
    def fail(*args, **kwargs):
        raise OSError("fixture failure")
    with monkeypatch.context() as patch:
        patch.setattr(LegalDocumentStorage, "_save", fail)
        response = api.patch(f"{URL}{row['id']}/", {"expectedVersion": 1, "title": "Failed", "file": upload()}, format="multipart")
        assert response.status_code == 503
    with monkeypatch.context() as patch:
        patch.setattr(audit_service, "record", fail)
        api.raise_request_exception = False
        assert api.patch(f"{URL}{row['id']}/", {"expectedVersion": 1, "title": "Failed", "file": upload()}, format="multipart").status_code == 500
    assert {p: p.read_bytes() for p in Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*") if p.is_file()} == before
    record = OpsLegalDocument.objects.get(pk=row["id"])
    assert record.title == "Educational fixture"
    assert record.version == 1
    assert record.files.count() == 1


def test_seed_grants_legal_management_only_to_existing_reference_admin():
    from django.core.management import call_command
    from organization_management.apps.operations.models import RolePermission
    call_command("seed_operations", reference_only=True)
    assert set(RolePermission.objects.filter(permission_code_id="legal.manage").values_list("role_code_id", flat=True)) == {"REFERENCE_ADMIN"}
    assert not RolePermission.objects.filter(role_code_id="REFERENCE_ADMIN", permission_code_id="catalog.view").exists()


def test_wildcard_manager_can_write_without_specific_legal_grant():
    api, _ = client_for("legal-wildcard", "TEST_LEGAL_WILDCARD", ["*"])
    assert api.get(URL).json()["canManage"] is True
    assert create(api)["version"] == 1


def test_file_admin_is_visible_with_russian_name_and_readonly(rf):
    from django.contrib import admin
    from django.contrib.auth.models import User
    from organization_management.apps.operations.models_legal import OpsLegalDocumentFile
    model_admin = admin.site._registry[OpsLegalDocumentFile]
    request = rf.get("/admin/")
    request.user = User.objects.create_superuser("legal-admin", password="x")
    assert model_admin.has_view_permission(request)
    assert not model_admin.has_add_permission(request)
    assert not model_admin.has_change_permission(request)
    assert not model_admin.has_delete_permission(request)
    assert OpsLegalDocumentFile._meta.verbose_name == "Файл нормативного документа"


def test_metadata_edit_keeps_server_derived_pdf_pages():
    api, _ = manager()
    row = create(api, file=upload(), pages="999")
    assert row["pages"] == 1
    response = api.patch(f"{URL}{row['id']}/", {"expectedVersion": 1, "pages": "", "title": "Metadata edit"}, format="multipart")
    assert response.status_code == 200
    assert response.json()["pages"] == 1


def test_utf16_docx_entities_are_rejected():
    xml = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE document [<!ENTITY demo "expanded">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>&demo;</w:p></w:body></w:document>'
    api, _ = manager()
    response = api.post(URL, metadata(file=upload(docx_bytes({"word/document.xml": xml.encode("utf-16")}), "entities.docx")), format="multipart")
    assert response.status_code == 400


def test_non_upload_file_field_returns_field_error():
    api, _ = manager()
    api.raise_request_exception = False
    response = api.post(URL, metadata(file="not-an-upload"), format="multipart")
    assert response.status_code == 400
    assert "file" in response.json().get("details", response.json())


def test_partial_storage_failure_on_create_removes_only_new_unsaved_blob(monkeypatch, settings):
    from pathlib import Path
    from organization_management.apps.operations.legal_document_storage import LegalDocumentStorage
    from organization_management.apps.operations.models_legal import OpsLegalDocument
    api, _ = manager()
    row = create(api, file=upload())
    before = {p: p.read_bytes() for p in Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*") if p.is_file()}
    def partial_failure(storage, name, content):
        path = Path(storage.path(name))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"partial")
        raise OSError("fixture partial failure")
    monkeypatch.setattr(LegalDocumentStorage, "_save", partial_failure)
    response = api.post(URL, metadata(code="FAIL-CREATE", file=upload()), format="multipart")
    assert response.status_code == 503
    assert not OpsLegalDocument.objects.filter(code="FAIL-CREATE").exists()
    assert OpsLegalDocument.objects.filter(pk=row["id"]).exists()
    assert {p: p.read_bytes() for p in Path(settings.OPS_PRIVATE_STORAGE_ROOT).rglob("*") if p.is_file()} == before


def test_download_rejects_symlink_escape(tmp_path):
    from pathlib import Path
    from organization_management.apps.operations.models_legal import OpsLegalDocumentFile
    api, _ = manager()
    row = create(api, file=upload())
    record = OpsLegalDocumentFile.objects.get(pk=row["file"]["id"])
    path = Path(record.file.path)
    foreign = tmp_path / "foreign.pdf"
    foreign.write_bytes(path.read_bytes())
    path.unlink()
    try:
        path.symlink_to(foreign)
    except OSError as error:
        if getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows test account lacks the privilege to create symlinks")
        raise
    assert download(api, row).status_code == 500


def test_generated_name_collision_never_deletes_previous_successful_blob(monkeypatch):
    from pathlib import Path
    from types import SimpleNamespace
    from organization_management.apps.ops import legal_documents
    from organization_management.apps.operations.models_legal import OpsLegalDocumentFile
    api, _ = manager()
    row = create(api, file=upload())
    record = OpsLegalDocumentFile.objects.get(pk=row["file"]["id"])
    path = Path(record.file.path)
    content = path.read_bytes()
    monkeypatch.setattr(legal_documents.uuid, "uuid4", lambda: SimpleNamespace(hex=path.stem))
    api.raise_request_exception = False
    response = api.patch(f"{URL}{row['id']}/", {"expectedVersion": 1, "file": upload()}, format="multipart")
    assert response.status_code == 503
    assert path.read_bytes() == content
    assert len(list(path.parent.glob("*"))) == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_replacements_have_one_winner_and_preserve_history(settings):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.contrib.auth.models import User
    from django.db import close_old_connections
    from organization_management.apps.operations.models_legal import OpsLegalDocumentFile
    api, user = manager()
    row = create(api, file=upload())
    barrier = Barrier(2)
    def submit(index):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=user.pk))
            barrier.wait(timeout=20)
            return client.patch(f"{URL}{row['id']}/", {"expectedVersion": 1, "title": f"Concurrent {index}", "file": upload()}, format="multipart").status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert sorted(results) == [200, 409]
    assert OpsLegalDocumentFile.objects.filter(document_id=row["id"]).count() == 2
    assert b"".join(download(api, row).streaming_content) == pdf_bytes()
