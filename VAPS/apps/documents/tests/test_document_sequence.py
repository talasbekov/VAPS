"""Story 6.2 — DocumentSequence: DB-инварианты (AC-4), gap-tolerance (AC-2)
и санитизация контракта ``allocate_number`` (AC-5).

Констрейнты проверяются прямым ``objects.create()`` / SQL-UPDATE под
``transaction.atomic()`` → ``IntegrityError`` ОТ БАЗЫ (паттерн
``test_attachment_model``). Ассертим ТОЛЬКО ``IntegrityError``, НЕ имя
констрейнта: встроенный чек позитив-филда и ``chk_*_min`` делят предикат —
БД может процитировать любое из имён.

⚠️ В ЭТОМ файле НИ ОДНОГО ``django_db(transaction=True)``: такой тест валит
teardown-flush гейта (TRUNCATE audit_logs × statement-триггер append-only).
Тесты конкурентности и ``TransactionManagementError`` живут в
``test_document_sequence_concurrency.py`` (бегут в test-full).
"""

import pytest
from django.db import IntegrityError, connection, transaction

from apps.documents.models import DocumentSequence
from apps.documents.services import allocate_number

pytestmark = pytest.mark.django_db


def _create(**overrides):
    fields = {"doc_type": "расход", "year": 2026}
    fields.update(overrides)
    return DocumentSequence.objects.create(**fields)


# --- AC-4: модель + БД-инварианты -----------------------------------------


def test_valid_row_persists_with_defaults():
    row = _create()
    fetched = DocumentSequence.objects.get(id=row.id)
    assert fetched.last_number == 0  # default: номера ещё не выдавались
    assert fetched.updated_at is not None


def test_duplicate_doc_type_year_rejected_by_db():
    _create()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create()
    assert DocumentSequence.objects.count() == 1


@pytest.mark.parametrize("bad_year", [1999, 2201])
def test_year_range_enforced_by_db(bad_year):
    # create() обходит сервисную санитизацию — инвариант держит Postgres.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(year=bad_year)
    assert not DocumentSequence.objects.exists()


@pytest.mark.parametrize("blank", ["", "   "])
def test_doc_type_not_blank_enforced_by_db(blank):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(doc_type=blank)
    assert not DocumentSequence.objects.exists()


def test_negative_last_number_rejected_on_create():
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _create(last_number=-1)
    assert not DocumentSequence.objects.exists()


def test_negative_last_number_rejected_on_raw_sql_update():
    # Post-insert мутация мимо ORM — самый честный вектор для chk_*_min.
    row = _create()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE documents_document_sequences"
                    " SET last_number = -1 WHERE id = %s",
                    [row.id],
                )
    row.refresh_from_db()
    assert row.last_number == 0


# --- AC-1/AC-5: последовательность и независимость счётчиков ---------------


def test_sequential_allocation_is_monotonic_single_row():
    numbers = []
    for _ in range(3):
        with transaction.atomic():
            numbers.append(allocate_number(doc_type="расход", year=2026))
    assert numbers == [1, 2, 3]
    row = DocumentSequence.objects.get()  # ровно одна строка
    assert row.last_number == 3


def test_counters_are_independent_per_doc_type_and_year():
    # Year-rollover (§82.3): новый (doc_type, year) — новый счётчик с 1.
    pairs = [("расход", 2026), ("расход", 2027), ("справка", 2026)]
    for doc_type, year in pairs:
        with transaction.atomic():
            assert allocate_number(doc_type=doc_type, year=year) == 1
    assert DocumentSequence.objects.count() == 3


# --- AC-2: откат без дырки (лок до коммита) --------------------------------


def test_rollback_leaves_no_gap():
    _create(last_number=5)

    class _Boom(RuntimeError):
        pass

    with pytest.raises(_Boom):
        with transaction.atomic():
            assert allocate_number(doc_type="расход", year=2026) == 6
            raise _Boom()

    row = DocumentSequence.objects.get()
    assert row.last_number == 5  # инкремент откатился вместе с транзакцией

    with transaction.atomic():
        # тот же номер переиспользован — дырки в нумерации нет
        assert allocate_number(doc_type="расход", year=2026) == 6


# --- AC-5: санитизация входов по чек-листу (ретро E5 §4.1) ------------------


@pytest.mark.parametrize(
    "doc_type, year",
    [
        (None, 2026),  # не-str
        (123, 2026),  # не-str
        ("", 2026),  # пустой
        ("   ", 2026),  # whitespace-only
        ("х" * 51, 2026),  # длиннее max_length=50
        ("расход", True),  # bool — подкласс int, отвергается явно
        ("расход", "2026"),  # не-int
        ("расход", 1999),  # ниже диапазона
        ("расход", 2201),  # выше диапазона
    ],
)
def test_contract_violations_raise_value_error(doc_type, year):
    with pytest.raises(ValueError):
        allocate_number(doc_type=doc_type, year=year)
    assert not DocumentSequence.objects.exists()  # БД не тронута


def test_doc_type_is_stripped_and_boundary_length_accepted():
    with transaction.atomic():
        assert allocate_number(doc_type="  расход  ", year=2026) == 1
    assert DocumentSequence.objects.get().doc_type == "расход"
    with transaction.atomic():
        assert allocate_number(doc_type="т" * 50, year=2026) == 1
