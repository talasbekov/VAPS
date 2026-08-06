"""Выдача исходящего номера: последовательность, откат без дырки и замок.

Три несущих свойства. Номера идут подряд внутри пары (вид, год) и независимо
между парами. Откат транзакции ВЫЗЫВАЮЩЕГО возвращает номер — ради этого
нумерация и сделана целым под замком, а не последовательностью базы. И замок
берётся на самом деле: ассерт ищет `FOR UPDATE` именно по таблице счётчика, а
не «где-нибудь в прогоне».
"""
import pytest
from django.db import connection, transaction
from django.db.transaction import TransactionManagementError
from django.test.utils import CaptureQueriesContext

from organization_management.apps.operations.document_service import allocate_number
from organization_management.apps.operations.models_document import (
    OpsDocumentSequence,
)

pytestmark = pytest.mark.django_db

TYPE = "расход"
YEAR = 2026


# ── Последовательность ───────────────────────────────────────────────────


def test_the_first_number_of_a_fresh_pair_is_one():
    """Ноль означал бы «документ, который не выдавали»."""
    assert allocate_number(doc_type=TYPE, year=YEAR) == 1


def test_numbers_run_consecutively_without_gaps():
    got = [allocate_number(doc_type=TYPE, year=YEAR) for _ in range(5)]

    assert got == [1, 2, 3, 4, 5]


def test_the_counter_row_is_created_once_and_then_reused():
    """Заведение строки идёт через get_or_create — второй вызов не плодит
    вторую строку и не начинает нумерацию заново."""
    allocate_number(doc_type=TYPE, year=YEAR)
    allocate_number(doc_type=TYPE, year=YEAR)

    assert OpsDocumentSequence.objects.filter(doc_type=TYPE, year=YEAR).count() == 1


def test_each_year_numbers_from_one_again():
    allocate_number(doc_type=TYPE, year=YEAR)
    allocate_number(doc_type=TYPE, year=YEAR)

    assert allocate_number(doc_type=TYPE, year=YEAR + 1) == 1


def test_another_document_type_has_its_own_run_of_numbers():
    allocate_number(doc_type=TYPE, year=YEAR)
    allocate_number(doc_type=TYPE, year=YEAR)

    assert allocate_number(doc_type="приказ", year=YEAR) == 1
    assert allocate_number(doc_type=TYPE, year=YEAR) == 3


def test_the_type_is_trimmed_so_a_stray_space_does_not_start_a_second_run():
    """«расход» и «расход » — один вид: иначе опечатка в вызове завела бы
    вторую нумерацию, и в исходящих появилась бы вторая единица."""
    allocate_number(doc_type=TYPE, year=YEAR)

    assert allocate_number(doc_type=f" {TYPE} ", year=YEAR) == 2


# ── Откат без дырки ──────────────────────────────────────────────────────


def test_a_rolled_back_caller_returns_the_number(django_assert_num_queries=None):
    """Несущее свойство всей конструкции.

    Пропуск в исходящих номерах означает УТРАТУ документа. Последовательность
    базы вернула бы здесь 2 (nextval при откате не возвращается) — и это ровно
    та разница, ради которой счётчик сделан обычным целым.
    """
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            assert allocate_number(doc_type=TYPE, year=YEAR) == 1
            raise RuntimeError("выпуск не сложился")

    assert allocate_number(doc_type=TYPE, year=YEAR) == 1


def test_a_rolled_back_first_ever_call_leaves_no_counter_row_behind():
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            allocate_number(doc_type=TYPE, year=YEAR)
            raise RuntimeError("выпуск не сложился")

    assert OpsDocumentSequence.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_calling_outside_a_transaction_is_refused_rather_than_silently_unsafe():
    """Своя транзакция закоммитила бы инкремент отдельно от выпуска — то есть
    вернула бы поведение последовательности базы, от которого мы ушли.

    Отказ и есть доказательство её отсутствия: замок в autocommit снимается тем
    же оператором, поэтому select_for_update там поднимает
    TransactionManagementError. Заведи сервис свой atomic — вызов пройдёт молча
    и тест покраснеет. Для этого теста транзакция-обёртка прогона снята
    (transaction=True): под обычной django_db вызов всегда внутри транзакции, и
    проба была бы невозможна.
    """
    with pytest.raises(TransactionManagementError):
        allocate_number(doc_type=TYPE, year=YEAR)

    # Строка счётчика при этом может уцелеть: заведение идёт до перечитки под
    # замком, и в autocommit оно коммитится само. Это безвредно ровно потому,
    # что заведение НЕ выдаёт номера — ассерт и проверяет ноль, а не отсутствие
    # строки: значимо здесь «номер не ушёл», а не «в таблице пусто».
    assert list(OpsDocumentSequence.objects.values_list("last_number", flat=True)) in (
        [],
        [0],
    )


# ── Замок ────────────────────────────────────────────────────────────────


def test_the_counter_row_is_read_back_under_a_row_lock():
    """Ассерт по ИМЕНИ ТАБЛИЦЫ, а не по наличию `FOR UPDATE` где-нибудь.

    В прогоне хватает других залоченных чтений, и проверка «в запросах есть FOR
    UPDATE» была бы вакуумной. Убери перечитку под замком — два потока прочтут
    одно значение и выдадут один номер дважды.
    """
    with CaptureQueriesContext(connection) as captured:
        allocate_number(doc_type=TYPE, year=YEAR)

    locked = [
        q["sql"]
        for q in captured.captured_queries
        if "ops_document_sequences" in q["sql"] and "FOR UPDATE" in q["sql"].upper()
    ]
    assert locked != []


def test_the_number_returned_is_the_one_persisted():
    """Возврат читается из строки, а не из локальной переменной: разойдись они
    — документ ушёл бы с номером, которого счётчик не знает."""
    number = allocate_number(doc_type=TYPE, year=YEAR)

    row = OpsDocumentSequence.objects.get(doc_type=TYPE, year=YEAR)
    assert row.last_number == number


# ── Границы входов ───────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["", "   ", "я" * 51, None, 5])
def test_a_malformed_document_type_is_a_programming_error(bad):
    with pytest.raises(ValueError):
        allocate_number(doc_type=bad, year=YEAR)


@pytest.mark.parametrize("bad", [1999, 2201, "2026", None, True])
def test_a_malformed_year_is_a_programming_error(bad):
    """True среди прочего: bool — подкласс int, и в разбор он приходит как 1.

    Отвергается он не отдельным гвардом, а диапазоном годов — 1 лежит вне
    2000..2200. Проверка здесь на ФАКТ отказа, а не на его формулировку: гвард,
    заведённый сверх диапазона, был бы вторым владельцем одного правила.
    """
    with pytest.raises(ValueError):
        allocate_number(doc_type=TYPE, year=bad)


def test_the_year_range_boundaries_are_allowed():
    assert allocate_number(doc_type=TYPE, year=2000) == 1
    assert allocate_number(doc_type=TYPE, year=2200) == 1
