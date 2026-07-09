"""Story 6.1 — сервис create_attachment + селектор get_attachment (AC-1, 5).

Хранилище переопределяется на ``tmp_path`` через ``settings``-фикстуру
pytest-django — тесты не пишут в BASE_DIR/private_storage.
"""

import hashlib
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.documents.models import Attachment
from apps.documents.selectors import get_attachment
from apps.documents.services import create_attachment, storage_path

pytestmark = pytest.mark.django_db

_CONTENT = "Расход бойынша құжат — содержимое файла".encode("utf-8")
_ACTOR = "uploader-1"


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


def _upload(name="расход.docx", content=_CONTENT, content_type="application/pdf"):
    return SimpleUploadedFile(name, content, content_type=content_type)


def _create(name="расход.docx", content=_CONTENT, content_type="application/pdf"):
    return create_attachment(
        uploaded_file=_upload(name, content, content_type),
        original_name=name,
        content_type=content_type,
        actor=_ACTOR,
    )


# -- запись файла + строка (Ловушка №6) ---------------------------------------


def test_file_lands_under_uuid_name_with_reference_sha256(storage):
    attachment = _create()
    on_disk = storage / str(attachment.id)
    assert on_disk.read_bytes() == _CONTENT  # имя на диске = {uuid}, не original_name
    assert attachment.size == len(_CONTENT)
    assert attachment.sha256 == hashlib.sha256(_CONTENT).hexdigest()
    assert attachment.created_by == _ACTOR
    assert storage_path(attachment) == on_disk


def test_no_tmp_files_left_after_success(storage):
    attachment = _create()
    assert [p.name for p in storage.iterdir()] == [str(attachment.id)]


def test_original_name_sanitized_to_basename(storage):
    for raw, expected in [
        ("  расход.docx  ", "расход.docx"),
        ("dir/sub/расход.docx", "расход.docx"),
        ("C:\\Users\\evil\\отчёт.xlsx", "отчёт.xlsx"),
    ]:
        attachment = create_attachment(
            uploaded_file=_upload(),
            original_name=raw,
            content_type="application/pdf",
            actor=_ACTOR,
        )
        assert attachment.original_name == expected, raw


@pytest.mark.parametrize("bad_name", ["", "   ", "dir/", "a" * 256])
def test_invalid_name_rejected_and_leaves_no_file(storage, bad_name):
    with pytest.raises(DomainError) as excinfo:
        create_attachment(
            uploaded_file=_upload(),
            original_name=bad_name,
            content_type="application/pdf",
            actor=_ACTOR,
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.http_status == 400
    assert list(storage.iterdir()) == []
    assert not Attachment.objects.exists()


def test_empty_file_rejected_and_leaves_no_file(storage):
    with pytest.raises(DomainError) as excinfo:
        _create(content=b"")
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert list(storage.iterdir()) == []  # tmp прибран
    assert not Attachment.objects.exists()


def test_blank_content_type_rejected(storage):
    with pytest.raises(DomainError):
        _create(content_type="   ")
    assert list(storage.iterdir()) == []


# -- аудит в той же транзакции (Д7) -------------------------------------------


def test_audit_row_written_with_upload(storage):
    attachment = _create()
    row = AuditLog.objects.get(action="ATTACHMENT_UPLOADED")
    assert row.actor_user_id == _ACTOR
    assert row.entity_type == "attachment"
    assert str(row.entity_id) == str(attachment.id)
    assert row.new_value["sha256"] == attachment.sha256
    assert row.new_value["size"] == attachment.size


def test_failed_audit_rolls_back_row_and_removes_file(storage):
    # actor="" валит record() ПОСЛЕ create строки → транзакция откатывается,
    # unlink(final) прибирает уже переименованный файл (Ловушка №6).
    with pytest.raises(ValueError):
        create_attachment(
            uploaded_file=_upload(),
            original_name="расход.docx",
            content_type="application/pdf",
            actor="",
        )
    assert not Attachment.objects.exists()
    assert not AuditLog.objects.filter(action="ATTACHMENT_UPLOADED").exists()
    assert list(storage.iterdir()) == []


# -- селектор: канонизация pk (Ловушка №5) -------------------------------------


def test_get_attachment_returns_row(storage):
    attachment = _create()
    assert get_attachment(str(attachment.id)).id == attachment.id
    # канонизация: пробелы вокруг валидного uuid не роняют lookup
    assert get_attachment(f"  {attachment.id}  ").id == attachment.id


@pytest.mark.parametrize(
    "garbage",
    ["not-a-uuid", "  ", "0", "f" * 100, None, 42],
)
def test_get_attachment_garbage_id_is_404_not_500(garbage):
    with pytest.raises(DomainError) as excinfo:
        get_attachment(garbage)
    assert excinfo.value.code == "ENTITY_NOT_FOUND"
    assert excinfo.value.http_status == 404


def test_get_attachment_unknown_uuid_is_404():
    with pytest.raises(DomainError) as excinfo:
        get_attachment(str(uuid.uuid4()))
    assert excinfo.value.code == "ENTITY_NOT_FOUND"
