"""Что база НЕ примет в качестве записи о файле.

Проверяется не «поля сохраняются» — это делает ORM, — а четыре ограничения,
каждое из которых закрывает состояние, при котором строка выглядит целой, а
файла за ней нет или он неотличим от подменённого. Пишет вложения сервис через
.create(), то есть мимо форм и full_clean: доказательством может быть только
отказ БАЗЫ, поэтому все пробы идут через транзакцию с ожиданием IntegrityError.

Отдельная нить — storage_key: имя файла на диске обязано быть известно ДО
вставки строки и не повторяться, и оба эти свойства проверяются прямо.
"""
import uuid

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_document import OpsAttachment

pytestmark = pytest.mark.django_db

DIGEST = "a" * 64


def make(**overrides):
    fields = {
        "original_name": "расход_2026-08-06.docx",
        "content_type": (
            "application/vnd.openxmlformats-officedocument"
            ".wordprocessingml.document"
        ),
        "size": 12_345,
        "sha256": DIGEST,
    }
    fields.update(overrides)
    return OpsAttachment.objects.create(**fields)


def rejected(**overrides):
    """Отказ БАЗЫ на вставке — в своей транзакции, чтобы прогон продолжился."""
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make(**overrides)


# ── Дайджест ─────────────────────────────────────────────────────────────


def test_a_well_formed_row_is_accepted():
    """Опора остальных проб: сама по себе заготовка валидна.

    Без неё каждый отказ ниже мог бы объясняться чем угодно в заготовке, а не
    тем полем, которое проба испортила.
    """
    row = make()

    assert row.pk is not None


def test_an_empty_digest_is_rejected_even_though_the_field_has_no_default():
    """Пустой дайджест — самое опасное значение поля без дефолта.

    Оно проходит .create() молча, а сверка перед выдачей сравнивала бы файл с
    «ничем». Форма здесь не помощник: сервис до неё не доходит.
    """
    rejected(sha256="")


def test_a_digest_of_the_right_length_but_wrong_alphabet_is_rejected():
    """Ровно 64 символа, но не hex: проверка длиной такое пропустила бы."""
    rejected(sha256="z" * 64)


def test_a_truncated_digest_is_rejected():
    rejected(sha256="a" * 63)


def test_an_uppercase_digest_is_rejected_because_the_stored_form_is_canonical():
    """Сверка сравнивает СТРОКИ. Пусти сюда верхний регистр — тот же файл,
    посчитанный дважды, разошёлся бы с самим собой."""
    rejected(sha256="A" * 64)


# ── Размер ───────────────────────────────────────────────────────────────


def test_a_zero_sized_file_is_rejected():
    """Ноль байт — след оборванной записи, а не файл.

    Коварство именно в том, что дайджест пустого файла ЗАКОНЕН и сверка на нём
    сойдётся: без этого запрета порча выглядела бы целостной.
    """
    rejected(size=0)


def test_a_negative_size_is_rejected():
    rejected(size=-1)


# ── Имя и тип ────────────────────────────────────────────────────────────


def test_a_whitespace_only_name_is_rejected_not_just_an_empty_one():
    """Проба на "" прошла бы и с проверкой «не пусто»; пробелы отличают
    настоящее ограничение от видимости."""
    rejected(original_name="   ")


def test_an_empty_name_is_rejected():
    rejected(original_name="")


def test_a_whitespace_only_content_type_is_rejected():
    rejected(content_type=" \t ")


# ── Имя файла на диске ───────────────────────────────────────────────────


def test_the_storage_key_exists_before_the_row_is_inserted():
    """Несущее отличие от источника: имя файла известно ДО вставки.

    Байты обязаны лечь на диск раньше строки, поэтому ключ считается в питоне,
    а не выдаётся базой. Проба смотрит на НЕсохранённый объект: перенеси
    вычисление в БД (db_default/триггер) — здесь будет None.
    """
    row = OpsAttachment(
        original_name="x.docx", content_type="text/plain", size=1, sha256=DIGEST
    )

    assert isinstance(row.storage_key, uuid.UUID)


def test_two_rows_never_share_a_storage_key():
    first = make()
    second = make()

    assert first.storage_key != second.storage_key


def test_a_duplicate_storage_key_is_rejected_by_the_database():
    """Совпадение имён означало бы, что вторая запись затирает чужие байты."""
    first = make()

    rejected(storage_key=first.storage_key)
