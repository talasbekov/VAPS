"""Story 6.1 — DB-инварианты Attachment (AC-4).

Каждый CheckConstraint проверяется прямым ``objects.create()`` под
``transaction.atomic()`` → ``IntegrityError`` ОТ БАЗЫ (паттерн
``test_control_settings``): choice/regex-поля без дефолта не валидируются на
пути ``create()``, поэтому инварианты держит Postgres, не Python.
"""

import uuid

import pytest
from django.db import IntegrityError, transaction

from apps.documents.models import Attachment

pytestmark = pytest.mark.django_db

_SHA = "a" * 64  # валидный lowercase-hex дайджест


def _create(**overrides):
    fields = {
        "original_name": "расход.docx",
        "content_type": "application/pdf",
        "size": 10,
        "sha256": _SHA,
    }
    fields.update(overrides)
    return Attachment.objects.create(**fields)


def test_valid_row_persists_with_uuid_pk_and_timestamps():
    row = _create()
    assert isinstance(row.id, uuid.UUID)
    assert row.created_at is not None
    assert row.updated_at is not None
    fetched = Attachment.objects.get(id=row.id)
    assert fetched.original_name == "расход.docx"
    assert fetched.sha256 == _SHA


@pytest.mark.parametrize(
    "bad_sha",
    [
        "A" * 64,  # uppercase hex — не канонический lowercase
        "z" * 64,  # не-hex символы
        "a" * 63,  # короче 64
        "a" * 65,  # длиннее 64 — режется колонкой varchar(64) → ошибка БД
        "",  # пустой
    ],
)
def test_sha256_format_enforced_by_db(bad_sha):
    with pytest.raises(Exception) as excinfo:
        with transaction.atomic():
            _create(sha256=bad_sha)
    # 65 симв. режется на уровне колонки (DataError), остальное — CheckConstraint;
    # в обоих случаях строка НЕ записана и это ошибка БД, не Python-валидация.
    assert excinfo.type.__module__.startswith("django.db")
    assert not Attachment.objects.exists()


def test_sha256_check_is_integrity_error_for_uppercase():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(sha256="F" * 64)


def test_size_floor_zero_rejected():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(size=0)


def test_size_floor_negative_rejected():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(size=-5)


@pytest.mark.parametrize("blank", ["", "   "])
def test_original_name_not_blank_enforced_by_db(blank):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(original_name=blank)


@pytest.mark.parametrize("blank", ["", "   "])
def test_content_type_not_blank_enforced_by_db(blank):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(content_type=blank)


def test_big_size_fits_bigint():
    # Д10: BigIntegerField — файл > 2 ГБ не упирается в int32.
    row = _create(size=3 * 1024**3, original_name="big.bin")
    assert Attachment.objects.get(id=row.id).size == 3 * 1024**3
