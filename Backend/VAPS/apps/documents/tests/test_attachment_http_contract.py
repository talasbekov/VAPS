"""Story 6.1 — QA-пробелы HTTP-контракта вложений (bmad-qa-generate-e2e-tests).

Дополняет dev-сьют ``test_attachment_api.py`` осями, которые там не судятся:
отсутствие поля ``file`` (форма = ровно одно поле — контракт schema.yaml),
403 на СУЩЕСТВУЮЩЕМ вложении у роли без ``document.view``, граница лимита
(ровно max_bytes → 201), негативный аудит-контракт скачивания (Ловушка №2:
``DOCUMENT_DOWNLOADED`` — зона 6.7, download не пишет НИ ОДНОЙ строки),
спуф identity-полей в multipart (ARCH-SEC-030) и пин дефолтного whitelist Д4.

Auth — канон Ловушки №5: свои копии фикстур (``seed_operations`` +
``UserRole`` + ``HTTP_X_USER_ID``), общего conftest нет.
"""

import hashlib

import pytest
from django.conf import settings as django_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.documents.models import Attachment
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

_UPLOADER = "qa-attachment-uploader"  # DIVISION_OPERATOR: upload + view
_NO_RIGHTS = "qa-attachment-norights"  # OMD: ни upload, ни view

_PDF = "application/pdf"
_CONTENT = "QA: құжат по расходу — байты".encode("utf-8")


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


def _uploaded(name="расход.pdf", content=_CONTENT, content_type=_PDF, extra=None):
    payload = {"file": SimpleUploadedFile(name, content, content_type=content_type)}
    payload.update(extra or {})
    response = _client().post(_upload_url(), payload, format="multipart")
    assert response.status_code == 201, response.data
    return response.data


# -- AC-1: форма = ровно одно поле `file` --------------------------------------


def test_400_missing_file_field(storage, rbac_actors):
    # Самый частый клиентский сбой — multipart без файл-части. Dev судит только
    # невалидные ЗНАЧЕНИЯ file; отсутствие поля — отдельная ветка DRF (required).
    response = _client().post(_upload_url(), {}, format="multipart")
    assert response.status_code == 400
    assert response.data["error_code"] == "VALIDATION_ERROR"
    assert list(storage.iterdir()) == []
    assert not Attachment.objects.exists()
    assert not AuditLog.objects.filter(action="ATTACHMENT_UPLOADED").exists()


# -- AC-2: право view судится и на существующем объекте -------------------------


def test_403_download_existing_attachment_without_view_right(storage, rbac_actors):
    # Dev пинит гейт-до-резолва только на мусорном pk; здесь объект СУЩЕСТВУЕТ —
    # 403 без утечки: ни X-Accel-заголовка, ни байтов в теле.
    data = _uploaded()
    response = _client(_NO_RIGHTS).get(_download_url(data["id"]))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert not response.has_header("X-Accel-Redirect")
    assert _CONTENT not in response.content


# -- AC-1: граница лимита — ровно max_bytes проходит ----------------------------


def test_201_upload_at_exact_size_limit(storage, rbac_actors, settings):
    # Сериализатор режет строгим `size > max_bytes`; dev судит limit+1 → 400.
    # Файл РОВНО в лимит обязан пройти — иначе форма ест легальный максимум.
    settings.VAPS_MAX_UPLOAD_MB = 1
    exact = b"x" * (1024 * 1024)
    data = _uploaded(content=exact)
    assert data["size"] == len(exact)
    assert data["sha256"] == hashlib.sha256(exact).hexdigest()
    assert (storage / data["id"]).read_bytes() == exact


# -- Ловушка №2: download НЕ эмитит аудит (зона 6.7) ----------------------------


def test_download_emits_no_audit_rows(storage, rbac_actors, settings):
    # Негативный контракт: аудит скачивания = Story 6.7 (`DOCUMENT_DOWNLOADED`
    # уже в реестре — эмиссия сейчас запрещена). Судим оба режима отдачи:
    # регрессия «ленивый record() в теле FileResponse» (deferred-work ~401)
    # обязана краснить именно этот тест.
    data = _uploaded()
    rows_after_upload = AuditLog.objects.count()

    settings.VAPS_XACCEL_ENABLED = True
    assert _client().get(_download_url(data["id"])).status_code == 200
    settings.VAPS_XACCEL_ENABLED = False
    response = _client().get(_download_url(data["id"]))
    assert response.status_code == 200
    b"".join(response.streaming_content)  # тело дочитано — ленивая эмиссия всплыла бы

    assert AuditLog.objects.count() == rows_after_upload
    assert not AuditLog.objects.filter(action="DOCUMENT_DOWNLOADED").exists()


# -- ARCH-SEC-030: identity только из request.actor_id --------------------------


def test_spoofed_identity_form_fields_ignored(storage, rbac_actors):
    # Лишние multipart-поля не входят в форму (единственное поле — file):
    # created_by строки и actor аудита обязаны прийти из заголовка, не из payload.
    data = _uploaded(
        extra={"created_by": "intruder", "actor": "intruder", "user_id": "intruder"}
    )
    attachment = Attachment.objects.get(id=data["id"])
    assert attachment.created_by == _UPLOADER
    row = AuditLog.objects.get(action="ATTACHMENT_UPLOADED")
    assert row.actor_user_id == _UPLOADER


# -- Д4: дефолтный whitelist принимает каждый заявленный тип --------------------


@pytest.mark.parametrize(
    "content_type",
    [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/pdf",
        "text/csv",
        "image/jpeg",
        "image/png",
    ],
)
def test_default_whitelist_types_accepted(storage, rbac_actors, content_type):
    # Пин конфигурации Д4 (вопрос Q2 Bratan): dev судит только «вне whitelist →
    # 400»; сузившийся дефолт (потерянный тип) не краснил бы ни один тест.
    assert content_type in django_settings.VAPS_ATTACHMENT_CONTENT_TYPES
    data = _uploaded(name="файл.bin", content_type=content_type)
    assert data["content_type"] == content_type
