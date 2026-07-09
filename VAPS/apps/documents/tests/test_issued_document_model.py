"""Story 6.5 — DB-инварианты IssuedDocument (AC-6).

Каждый констрейнт проверяется прямым ``objects.create()`` под
``transaction.atomic()`` → ``IntegrityError`` ОТ БАЗЫ (паттерн
``test_attachment_model``): choice/regex-поля без дефолта не валидируются на
пути ``create()``, поэтому инварианты держит Postgres, не Python.
"""

import uuid
from datetime import date

import pytest
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError

from apps.documents.models import EXPENSE_DOC_TYPE, Attachment, IssuedDocument

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
DIVISION_ID = uuid.uuid4()


@pytest.fixture
def attachment():
    return Attachment.objects.create(
        original_name="расход.docx",
        content_type="application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document",
        size=10,
        sha256="a" * 64,
    )


def _create(attachment, **overrides):
    fields = {
        "doc_type": EXPENSE_DOC_TYPE,
        "number": 1,
        "year": 2026,
        "business_date": D,
        "division_id": DIVISION_ID,
        "submission_id": 1,
        "submission_version": 1,
        "attachment": attachment,
        "status": IssuedDocument.Status.ISSUED,
    }
    fields.update(overrides)
    return IssuedDocument.objects.create(**fields)


def test_valid_row_persists_with_uuid_pk(attachment):
    row = _create(attachment)
    assert isinstance(row.id, uuid.UUID)
    fetched = IssuedDocument.objects.get(id=row.id)
    assert fetched.number == 1
    assert fetched.status == IssuedDocument.Status.ISSUED
    assert fetched.supersedes is None
    assert fetched.reason == ""


def test_number_unique_within_doc_type_year(attachment):
    _create(attachment)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            # Другой день/подразделение — тот же (тип, год, номер) запрещён.
            _create(
                attachment,
                division_id=uuid.uuid4(),
                business_date=date(2026, 7, 9),
                submission_id=2,
            )


def test_partial_unique_blocks_second_issued_until_first_flips(attachment):
    first = _create(attachment)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(attachment, number=2, submission_id=2)
    # Флип первого ISSUED→SUPERSEDED освобождает слот — второй ISSUED проходит.
    IssuedDocument.objects.filter(pk=first.pk).update(
        status=IssuedDocument.Status.SUPERSEDED
    )
    second = _create(
        attachment,
        number=2,
        submission_id=2,
        supersedes=first,
        reason="ретро-правка",
    )
    assert second.supersedes_id == first.id
    # Два SUPERSEDED на одном дне partial-unique не ограничивает.
    IssuedDocument.objects.filter(pk=second.pk).update(
        status=IssuedDocument.Status.SUPERSEDED
    )
    assert _create(attachment, number=3, submission_id=3).number == 3


@pytest.mark.parametrize("bad_status", ["", "DRAFT", "issued"])
def test_status_outside_choices_rejected_by_check(attachment, bad_status):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(attachment, status=bad_status)


def test_status_without_value_rejected_by_check(attachment):
    # status БЕЗ default: create() без него пишет "" — CHECK бьёт молчаливое "".
    fields = {
        "doc_type": EXPENSE_DOC_TYPE,
        "number": 1,
        "year": 2026,
        "business_date": D,
        "division_id": DIVISION_ID,
        "submission_id": 1,
        "submission_version": 1,
        "attachment": attachment,
    }
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            IssuedDocument.objects.create(**fields)


def test_number_floor_zero_rejected(attachment):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(attachment, number=0)


@pytest.mark.parametrize("blank", ["", "   "])
def test_doc_type_not_blank_enforced_by_db(attachment, blank):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(attachment, doc_type=blank)


@pytest.mark.parametrize("blank", ["", "   "])
def test_supersedes_requires_nonblank_reason(attachment, blank):
    first = _create(attachment)
    IssuedDocument.objects.filter(pk=first.pk).update(
        status=IssuedDocument.Status.SUPERSEDED
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(
                attachment, number=2, submission_id=2, supersedes=first, reason=blank
            )


def test_attachment_protected_from_delete(attachment):
    _create(attachment)
    with pytest.raises(ProtectedError):
        attachment.delete()


def test_supersedes_protected_from_delete(attachment):
    first = _create(attachment)
    IssuedDocument.objects.filter(pk=first.pk).update(
        status=IssuedDocument.Status.SUPERSEDED
    )
    _create(attachment, number=2, submission_id=2, supersedes=first, reason="правка")
    with pytest.raises(ProtectedError):
        first.delete()
