"""Story 6.7 — аудит скачивания + рантайм-сверка sha256 на download-роуте.

Две вещи на СУЩЕСТВУЮЩЕМ ``AttachmentViewSet.download`` (6.1):
(1) аудит ``DOCUMENT_DOWNLOADED`` (одна строка на СОСТОЯВШУЮСЯ выдачу — и в
X-Accel-режиме, и в FileResponse-fallback; entity_type="document", entity_id =
UUID вложения, лёгкий payload); (2) рантайм-сверка sha256 байт-в-байт ДО отдачи
(``verify_integrity``: чтение файла чанками, зеркало ``create_attachment``;
порча/пропажа → 500 ``DOCUMENT_INTEGRITY_FAILED``, без деталей наружу).

Аудит — только на успех: 403 (нет ``document.view``), 404 (мусор/неизвестный id)
и 500-integrity НЕ пишут ``DOCUMENT_DOWNLOADED`` (гейт → резолв → verify → audit).

Auth — канон Ловушки №5 6.1: свои копии фикстур (``seed_operations`` +
``UserRole`` + ``HTTP_X_USER_ID``), общего conftest нет.
"""

import hashlib

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.documents.models import Attachment
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

_UPLOADER = "dl-attachment-uploader"  # DIVISION_OPERATOR: upload + view
_NO_RIGHTS = "dl-attachment-norights"  # OMD: ни upload, ни view

_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_NAME = "Расход_құрам.docx"
_CONTENT = "Расход бойынша құжат — байты 6.7".encode("utf-8")


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def rbac_actors(db):
    call_command("seed_operations")
    UserRole.objects.create(user_id=_UPLOADER, role_code_id="DIVISION_OPERATOR")
    UserRole.objects.create(user_id=_NO_RIGHTS, role_code_id="OMD")


def _client(actor=_UPLOADER):
    client = APIClient()
    if actor is not None:
        client.credentials(HTTP_X_USER_ID=actor)
    return client


def _upload_url():
    return reverse("documents-attachment-list")


def _download_url(pk):
    return reverse("documents-attachment-download", kwargs={"pk": str(pk)})


def _uploaded(name=_NAME, content=_CONTENT, content_type=_DOCX):
    payload = {"file": SimpleUploadedFile(name, content, content_type=content_type)}
    response = _client().post(_upload_url(), payload, format="multipart")
    assert response.status_code == 201, response.data
    return response.data


# -- AC-1: одна строка DOCUMENT_DOWNLOADED на СОСТОЯВШУЮСЯ выдачу ---------------


@pytest.mark.parametrize("xaccel", [True, False])
def test_download_emits_single_audit_row(storage, rbac_actors, settings, xaccel):
    # Образец test_upload_audit_smoke_through_route (api:154): один download →
    # ровно одна DOCUMENT_DOWNLOADED, entity_type="document", entity_id=UUID,
    # actor из заголовка, payload несёт sha256==attachment.sha256. Оба режима.
    settings.VAPS_XACCEL_ENABLED = xaccel
    data = _uploaded()

    response = _client().get(_download_url(data["id"]))
    assert response.status_code == 200
    if not xaccel:
        b"".join(response.streaming_content)  # дочитать тело fallback

    rows = AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED")
    assert rows.count() == 1
    row = rows.get()
    assert row.entity_type == "document"
    assert str(row.entity_id) == data["id"]
    assert row.actor_user_id == _UPLOADER
    assert row.new_value["sha256"] == data["sha256"]
    assert row.new_value["original_name"] == _NAME
    assert row.new_value["content_type"] == _DOCX
    assert row.new_value["size"] == len(_CONTENT)


# -- AC-2: рантайм-сверка sha256 — повторная выдача = те же байты ---------------


def test_fallback_repeat_download_is_byte_for_byte(storage, rbac_actors, settings):
    # Два последовательных download в fallback → побайтово идентичное тело,
    # равное исходным байтам (sha прошёл повторно). «Повторная выдача» =
    # скачивание тех же байт, а не свежая сборка.
    settings.VAPS_XACCEL_ENABLED = False
    data = _uploaded()

    first = b"".join(_client().get(_download_url(data["id"])).streaming_content)
    second = b"".join(_client().get(_download_url(data["id"])).streaming_content)
    assert first == second == _CONTENT
    assert hashlib.sha256(first).hexdigest() == data["sha256"]


def test_xaccel_repeat_download_targets_same_uuid(storage, rbac_actors, settings):
    # X-Accel-режим: оба download дают тот же X-Accel-Redirect на тот же uuid,
    # оба прошли рантайм-сверку до эмиссии заголовка.
    settings.VAPS_XACCEL_ENABLED = True
    data = _uploaded()
    expected = f"/protected/{data['id']}"

    first = _client().get(_download_url(data["id"]))
    second = _client().get(_download_url(data["id"]))
    assert first["X-Accel-Redirect"] == second["X-Accel-Redirect"] == expected
    assert first.content == second.content == b""


# -- AC-3: провал целостности → 500 без утечки, аудита нет ----------------------


@pytest.mark.parametrize("xaccel", [True, False])
def test_corrupted_bytes_fail_integrity(storage, rbac_actors, settings, xaccel):
    # Байты на диске подменены (порча приватного стореджа): sha ≠ зафиксированного
    # → 500 DOCUMENT_INTEGRITY_FAILED, тело без specifics, ни X-Accel-Redirect,
    # ни строки DOCUMENT_DOWNLOADED.
    settings.VAPS_XACCEL_ENABLED = xaccel
    data = _uploaded()
    (storage / data["id"]).write_bytes(b"tampered-bytes")

    response = _client().get(_download_url(data["id"]))
    assert response.status_code == 500
    assert response.data["error_code"] == "DOCUMENT_INTEGRITY_FAILED"
    assert response.data["details"] == {}  # 500 без деталей наружу (§Format Patterns)
    assert not response.has_header("X-Accel-Redirect")
    assert not AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED").exists()


def test_missing_file_fails_integrity_not_404(storage, rbac_actors, settings):
    # Строка есть, байтов нет = серверная порча → тот же 500, НЕ 404 (404 — про
    # неизвестный id, зона get_attachment ДО verify). DOCUMENT_DOWNLOADED нет.
    settings.VAPS_XACCEL_ENABLED = True
    data = _uploaded()
    (storage / data["id"]).unlink()

    response = _client().get(_download_url(data["id"]))
    assert response.status_code == 500
    assert response.data["error_code"] == "DOCUMENT_INTEGRITY_FAILED"
    assert not AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED").exists()


# -- AC-1 негативы: отказ ДО выдачи не аудируется -------------------------------


def test_403_without_view_right_emits_no_audit(storage, rbac_actors):
    # Гейт document.view fail-closed ДО резолва/verify/audit: отказ не пишет
    # DOCUMENT_DOWNLOADED (аудируем только состоявшуюся выдачу).
    data = _uploaded()
    response = _client(_NO_RIGHTS).get(_download_url(data["id"]))
    assert response.status_code == 403
    assert not AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED").exists()


@pytest.mark.parametrize(
    "target", ["not-a-uuid", "00000000-0000-0000-0000-000000000000"]
)
def test_404_garbage_or_unknown_id_emits_no_audit(storage, rbac_actors, target):
    # 404 (мусорный/неизвестный id) резолвится ДО verify и audit → нет строки.
    response = _client().get(f"/api/documents/attachments/{target}/download/")
    assert response.status_code == 404
    assert not AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED").exists()
    assert not Attachment.objects.filter(id="00000000-0000-0000-0000-000000000000")
