"""Изолированные проверки границы загрузки снимка объекта (Plane SJ-1049)."""

import io
import struct
import zlib
from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import passport


def _png_header(*, width: int, height: int) -> bytes:
    """Минимальный PNG, достаточный Pillow для чтения размеров из IHDR."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IEND", b"")


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (60, 120, 180)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_non_numeric_object_id_is_treated_as_missing_without_querying_database():
    """Строковый path-параметр не должен превращать ожидаемый 404 в ORM ValueError."""

    assert passport.set_object_photo("not-a-number", None) is None


def test_decompression_bomb_is_reported_as_photo_validation_error(monkeypatch):
    """Огромные размеры из IHDR должны дать контролируемый 400, а не PIL 500."""

    security_object = SimpleNamespace(pk=7, photo=None)
    queryset = SimpleNamespace(first=lambda: security_object)
    monkeypatch.setattr(passport.OpsSecurityObject.objects, "filter", lambda **_: queryset)
    upload = SimpleUploadedFile(
        "bomb.png",
        _png_header(width=20_000, height=20_000),
        content_type="image/png",
    )

    with pytest.raises(DomainError) as raised:
        passport.set_object_photo(7, upload)

    assert raised.value.http_status == 400
    assert raised.value.detail == {
        "photo": ["Файл не является изображением JPEG, PNG или WebP."]
    }


def test_failed_audit_keeps_old_photo_and_removes_uncommitted_new_blob(monkeypatch):
    """Сбой обязательного audit не должен оставить новое фото или удалить старое."""

    class Storage:
        def __init__(self):
            self.files = {"security-objects/photos/old.png"}

        def save(self, name, _upload):
            self.files.add(name)
            return name

        def delete(self, name):
            self.files.discard(name)

    class Photo:
        def __init__(self, storage):
            self.name = "security-objects/photos/old.png"
            self.storage = storage
            self.field = SimpleNamespace(
                generate_filename=lambda _instance, name: f"security-objects/photos/{name}"
            )

        def __bool__(self):
            return bool(self.name)

        def delete(self, *, save):
            assert save is False
            self.storage.delete(self.name)
            self.name = ""

        def save(self, name, upload, *, save):
            self.name = self.storage.save(f"security-objects/photos/{name}", upload)
            if save:
                security_object.save()

    storage = Storage()
    security_object = SimpleNamespace(pk=7, code="A-1", photo=None, save=lambda **_: None)
    security_object.photo = Photo(storage)
    queryset = SimpleNamespace(first=lambda: security_object)
    monkeypatch.setattr(passport.OpsSecurityObject.objects, "filter", lambda **_: queryset)
    monkeypatch.setattr(passport.transaction, "atomic", nullcontext)
    monkeypatch.setattr(passport.transaction, "on_commit", lambda callback: callback())
    monkeypatch.setattr(
        passport.audit_service,
        "record",
        lambda **_: (_ for _ in ()).throw(RuntimeError("audit unavailable")),
    )
    upload = SimpleUploadedFile("new.png", _png(), content_type="image/png")

    with pytest.raises(RuntimeError, match="audit unavailable"):
        passport.set_object_photo(7, upload)

    assert storage.files == {"security-objects/photos/old.png"}
    assert security_object.photo.name == "security-objects/photos/old.png"
