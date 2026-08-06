"""Счётчик исходящих номеров: что база не примет и что она сериализует.

Ключевое здесь — уникальность пары (вид, год). Она не гигиена: на неё
опирается заведение строки нового года в гонке двух первых выпусков, и без неё
год начался бы с ДВУХ параллельных счётчиков, то есть с двух документов под
номером 1.

Пробы идут через .create() и update() — тем же путём, каким счётчик трогает
выдача номера, то есть мимо форм и full_clean.
"""
import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_document import (
    OpsDocumentSequence,
)

pytestmark = pytest.mark.django_db

TYPE = "расход"
YEAR = 2026


def make(**overrides):
    fields = {"doc_type": TYPE, "year": YEAR}
    fields.update(overrides)
    return OpsDocumentSequence.objects.create(**fields)


def rejected(action):
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            action()


# ── Пара (вид, год) ──────────────────────────────────────────────────────


def test_a_fresh_counter_starts_at_zero_so_the_first_number_is_one():
    """Ноль по умолчанию, а не единица: строка означает «выдано столько-то»,
    и новорождённый счётчик не выдал ещё ничего."""
    assert make().last_number == 0


def test_the_same_type_and_year_cannot_have_two_counters():
    make()

    rejected(lambda: make())


def test_the_same_type_in_another_year_is_a_separate_counter():
    """Новый год — просто новая строка, стартующая с нуля."""
    make()
    nxt = make(year=YEAR + 1)

    assert nxt.last_number == 0
    assert OpsDocumentSequence.objects.count() == 2


def test_another_document_type_in_the_same_year_is_a_separate_counter():
    make()

    assert make(doc_type="приказ").pk != OpsDocumentSequence.objects.first().pk


# ── Границы значений ─────────────────────────────────────────────────────


def test_a_negative_counter_is_rejected():
    row = make()

    rejected(
        lambda: OpsDocumentSequence.objects.filter(pk=row.pk).update(last_number=-1)
    )


def test_a_year_below_the_range_is_rejected():
    """year=6 (перепутанные аргументы) завёл бы вечную нумерацию, которую
    никто никогда не ищет."""
    rejected(lambda: make(year=6))


def test_a_year_above_the_range_is_rejected():
    rejected(lambda: make(year=20026))


def test_the_range_boundaries_themselves_are_accepted():
    """Границы включительны: проба на них отличает диапазон от «строго между»."""
    assert make(year=2000).year == 2000
    assert make(year=2200).year == 2200


def test_a_whitespace_only_document_type_is_rejected():
    """Пустой вид схлопнул бы нумерацию всех видов документов в одну."""
    rejected(lambda: make(doc_type="   "))


def test_an_empty_document_type_is_rejected():
    rejected(lambda: make(doc_type=""))
