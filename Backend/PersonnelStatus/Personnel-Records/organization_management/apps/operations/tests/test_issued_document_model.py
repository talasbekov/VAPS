"""Выпуск документа: что база не даст сделать с исходящим номером.

Четыре несущих запрета. Номер не повторяется внутри (вид, год). Действующий
выпуск на день — ровно один, но ЗАМЕНЁННЫХ сколько угодно (иначе запрет на
второй выпуск был бы запретом на поправку). Замена без причины невозможна. И
байты выпущенного документа не удалить.

Всё — через .create() и delete(), тем же путём, каким ходит сервис выпуска.
"""
from datetime import date

import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from organization_management.apps.operations.models_document import (
    OpsAttachment,
    OpsIssuedDocument,
)

pytestmark = pytest.mark.django_db

TYPE = "расход"
YEAR = 2026
DAY = date(2026, 8, 6)


def attachment():
    return OpsAttachment.objects.create(
        original_name="расход.docx", content_type="text/plain",
        size=10, sha256="a" * 64,
    )


def issue(**overrides):
    fields = {
        "doc_type": TYPE,
        "number": 1,
        "year": YEAR,
        "business_date": DAY,
        "division_id": 42,
        "submission_id": 100,
        "submission_version": 1,
        "attachment": attachment(),
        "status": OpsIssuedDocument.Status.ISSUED,
    }
    fields.update(overrides)
    return OpsIssuedDocument.objects.create(**fields)


def rejected(action):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            action()


# ── Номер ────────────────────────────────────────────────────────────────


def test_a_well_formed_issue_is_accepted():
    assert issue().pk is not None


def test_the_same_number_cannot_be_issued_twice_in_one_year():
    issue()

    rejected(lambda: issue(division_id=43, number=1))


def test_the_same_number_in_another_year_is_a_different_document():
    issue()

    assert issue(year=YEAR + 1, division_id=43, number=1).pk is not None


def test_a_zero_number_is_rejected():
    rejected(lambda: issue(number=0))


def test_an_out_of_range_year_is_rejected():
    rejected(lambda: issue(year=1999))


# ── Один действующий на день ─────────────────────────────────────────────


def test_a_division_cannot_have_two_current_issues_for_one_day():
    issue()

    rejected(lambda: issue(number=2))


def test_another_division_on_the_same_day_is_unaffected():
    issue()

    assert issue(number=2, division_id=43).pk is not None


def test_the_same_division_on_another_day_is_unaffected():
    issue()

    assert issue(number=2, business_date=date(2026, 8, 7)).pk is not None


def test_superseded_issues_may_pile_up_on_one_day_alongside_the_current_one():
    """Именно ради этого ограничение частичное.

    Безусловная уникальность запретила бы вторую версию вовсе — то есть
    запретила бы поправку сдачи, ради которой перевыпуск и существует. Проба
    берёт ДВЕ заменённых и одну действующую на одном дне.
    """
    first = issue(status=OpsIssuedDocument.Status.SUPERSEDED)
    second = issue(
        number=2, status=OpsIssuedDocument.Status.SUPERSEDED,
        supersedes=first, reason="поправка наряда",
    )
    current = issue(number=3, supersedes=second, reason="вторая поправка")

    assert OpsIssuedDocument.objects.filter(
        division_id=42, business_date=DAY
    ).count() == 3
    assert current.status == OpsIssuedDocument.Status.ISSUED


# ── Замена ───────────────────────────────────────────────────────────────


def test_a_replacement_without_a_reason_is_rejected():
    """Указал, ЧТО заменяешь, — обязан сказать, ПОЧЕМУ: молчаливая подмена
    документа неотличима от подлога."""
    first = issue(status=OpsIssuedDocument.Status.SUPERSEDED)

    rejected(lambda: issue(number=2, supersedes=first, reason=""))


def test_a_whitespace_only_reason_is_rejected_too():
    """Строка из пробелов — такой же немой ответ, как и пустая; проверка «не
    пусто» её пропустила бы."""
    first = issue(status=OpsIssuedDocument.Status.SUPERSEDED)

    rejected(lambda: issue(number=2, supersedes=first, reason="   "))


def test_a_first_issue_needs_no_reason():
    assert issue(reason="").pk is not None


def test_a_document_cannot_supersede_itself():
    """Цикл длины один проходит любую проверку ссылки и делает цепь выпусков
    неразрешимой."""
    row = issue()

    rejected(
        lambda: OpsIssuedDocument.objects.filter(pk=row.pk).update(
            supersedes=row.pk, reason="я сам себя"
        )
    )


def test_a_superseded_document_cannot_be_deleted_out_from_under_its_replacement():
    """Цепь «взамен исходящего №1» не должна указывать в пустоту."""
    first = issue(status=OpsIssuedDocument.Status.SUPERSEDED)
    issue(number=2, supersedes=first, reason="поправка")

    with pytest.raises(ProtectedError):
        first.delete()


# ── Состояние и байты ────────────────────────────────────────────────────


def test_an_unknown_status_is_rejected_by_the_database():
    """choices проверяются только формами, а строки пишет сервис через
    .create() — то есть мимо."""
    rejected(lambda: issue(status="DRAFT"))


def test_an_empty_status_is_rejected_since_the_field_has_no_default():
    rejected(lambda: issue(status=""))


def test_the_bytes_of_an_issued_document_cannot_be_deleted():
    row = issue()

    with pytest.raises(ProtectedError):
        row.attachment.delete()
