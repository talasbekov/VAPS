"""Story 6.1 — HTTP-контракт вложений (AC-1, 2, 3, 5).

Auth — ``HTTP_X_USER_ID`` + ``call_command("seed_operations")`` + ``UserRole``
напрямую (Ловушка №5: ``grant``-фикстура из core здесь недоступна). Раскладка
Д6: DIVISION_OPERATOR держит upload+view; VIEWER — только view; OMD — ни того
ни другого (DENY-дискриминатор).

404-векторы мусорного pk — ТОЛЬКО проходящие lookup-regex роутера ``[^/.]+``
(id с ``.``/``/`` режутся резолвером ДО view — обычный 404 без конверта §36,
их конверт не проверяем).
"""

import hashlib

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from django.utils.http import content_disposition_header
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.documents.models import Attachment
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

_UPLOADER = "attachment-uploader"  # DIVISION_OPERATOR: upload + view
_VIEWER = "attachment-viewer"  # VIEWER: только view
_NO_RIGHTS = "attachment-norights"  # OMD: ни upload, ни view

_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_NAME = "Расход_құрам.docx"
_CONTENT = "Расход бойынша құжат — байты".encode("utf-8")


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def rbac_actors(db):
    call_command("seed_operations")
    UserRole.objects.create(user_id=_UPLOADER, role_code_id="DIVISION_OPERATOR")
    UserRole.objects.create(user_id=_VIEWER, role_code_id="VIEWER")
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


def _post_file(client, name=_NAME, content=_CONTENT, content_type=_DOCX):
    return client.post(
        _upload_url(),
        {"file": SimpleUploadedFile(name, content, content_type=content_type)},
        format="multipart",
    )


def _uploaded(client=None):
    response = _post_file(client or _client())
    assert response.status_code == 201, response.data
    return response.data


# -- AC-1: 400 — нарушение формы, файл НЕ записан ------------------------------


def test_400_content_type_outside_whitelist(storage, rbac_actors):
    response = _post_file(_client(), content_type="application/x-msdownload")
    assert response.status_code == 400
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert list(storage.iterdir()) == []
    assert not Attachment.objects.exists()


def test_400_size_over_limit(storage, rbac_actors, settings):
    settings.VAPS_MAX_UPLOAD_MB = 1
    response = _post_file(_client(), content=b"x" * (1024 * 1024 + 1))
    assert response.status_code == 400
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert list(storage.iterdir()) == []
    assert not Attachment.objects.exists()


def test_400_empty_file(storage, rbac_actors):
    response = _post_file(_client(), content=b"")
    assert response.status_code == 400
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert list(storage.iterdir()) == []
    assert not Attachment.objects.exists()


# -- AC-2: 403 — без прав, гейт ДО резолва объекта -----------------------------


def test_403_anonymous_upload(storage, rbac_actors):
    response = _post_file(_client(actor=None))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_403_role_without_upload_right(storage, rbac_actors):
    for actor in (_VIEWER, _NO_RIGHTS):
        response = _post_file(_client(actor))
        assert response.status_code == 403, actor
        assert response.data["error_code"] == "PERMISSION_DENIED"
    assert not Attachment.objects.exists()


def test_403_anonymous_download(storage, rbac_actors):
    data = _uploaded()
    response = _client(actor=None).get(_download_url(data["id"]))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_403_download_gate_runs_before_object_resolve(storage, rbac_actors):
    # Мусорный pk у актора БЕЗ права → 403, не 404: fail-closed гейт срабатывает
    # до селектора (AC-2).
    response = _client(_NO_RIGHTS).get(_download_url("not-a-uuid"))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


# -- AC-1/5: 201 — легальный upload + HTTP-smoke аудита ------------------------


def test_201_upload_returns_metadata_and_reference_sha256(storage, rbac_actors):
    data = _uploaded()
    assert data["original_name"] == _NAME
    assert data["content_type"] == _DOCX
    assert data["size"] == len(_CONTENT)
    assert data["sha256"] == hashlib.sha256(_CONTENT).hexdigest()
    # файл на диске лежит под именем {uuid}, не original_name (AC-5)
    assert (storage / data["id"]).read_bytes() == _CONTENT
    assert not (storage / _NAME).exists()


def test_upload_audit_smoke_through_route(storage, rbac_actors):
    # Контракт _Audited() — поведенческий пин сквозь роут (паттерн
    # test_submission_audit 5.9): ровно одна строка ATTACHMENT_UPLOADED.
    data = _uploaded()
    rows = AuditLog.objects.filter(action="ATTACHMENT_UPLOADED")
    assert rows.count() == 1
    row = rows.get()
    assert row.actor_user_id == _UPLOADER
    assert str(row.entity_id) == data["id"]
    assert row.new_value["sha256"] == data["sha256"]


# -- AC-3: download — X-Accel, Django не стримит -------------------------------


def test_download_xaccel_headers_and_empty_body(storage, rbac_actors, settings):
    settings.VAPS_XACCEL_ENABLED = True
    data = _uploaded()
    response = _client(_VIEWER).get(_download_url(data["id"]))
    assert response.status_code == 200
    assert response["X-Accel-Redirect"] == f"/protected/{data['id']}"
    assert response["Content-Type"] == _DOCX
    # RFC-5987: кириллическое/казахское имя уходит в filename*=utf-8''…
    assert response["Content-Disposition"] == content_disposition_header(True, _NAME)
    assert "filename*=utf-8''" in response["Content-Disposition"]
    assert response.content == b""  # байты отдаёт nginx, Django не стримит


def test_download_xaccel_location_setting_respected(storage, rbac_actors, settings):
    settings.VAPS_XACCEL_ENABLED = True
    settings.VAPS_XACCEL_LOCATION = "/private-files"
    data = _uploaded()
    response = _client(_VIEWER).get(_download_url(data["id"]))
    assert response["X-Accel-Redirect"] == f"/private-files/{data['id']}"


def test_download_fallback_streams_bytes_when_xaccel_disabled(
    storage, rbac_actors, settings
):
    settings.VAPS_XACCEL_ENABLED = False
    data = _uploaded()
    response = _client(_VIEWER).get(_download_url(data["id"]))
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == _CONTENT
    assert response["Content-Type"] == _DOCX
    assert response["Content-Disposition"] == content_disposition_header(True, _NAME)
    assert not response.has_header("X-Accel-Redirect")


# -- AC-5: санитизация pk — 404, не 500 ----------------------------------------


@pytest.mark.parametrize("garbage", ["not-a-uuid", "%20%20", "0", "f" * 64])
def test_404_on_garbage_id_not_500(storage, rbac_actors, garbage):
    # Векторы проходят lookup-regex роутера [^/.]+ и достигают view; селектор
    # канонизирует → DomainError 404 в конверте §36 (Ловушка №5).
    response = _client(_VIEWER).get(
        f"/api/documents/attachments/{garbage}/download/"
    )
    assert response.status_code == 404, garbage
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_404_on_unknown_uuid(storage, rbac_actors):
    response = _client(_VIEWER).get(
        _download_url("00000000-0000-0000-0000-000000000000")
    )
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


# -- Д8: поверхность минимальна — прочие глаголы 405 ---------------------------


def test_list_get_is_405_not_403():
    # list/retrieve не реализованы (Д8): GET на POST-only роуте — метод-
    # поверхность (405), не право (урок 5.8c: action=None → MethodNotAllowed).
    assert _client().get(_upload_url()).status_code == 405
    assert _client(actor=None).get(_upload_url()).status_code == 405


def test_delete_is_405():
    assert _client().delete(_upload_url()).status_code == 405
