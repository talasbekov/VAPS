"""Story 6.2 — QA-пробелы механики ``allocate_number`` (bmad-qa-generate-e2e-tests).

Дополняет dev-сьют (``test_document_sequence*.py``) осями, где у контракта
судьи нет вовсе. Все судьи бегут в GATE (ни одного ``transaction=True``) —
это принципиально: до сих пор мутация «убрать ``select_for_update``» или
«открыть свой ``atomic`` в сервисе» краснила ТОЛЬКО test-full (concurrency
деселектится гейтом), а quality-bar проекта = ``make gate``.

Оси:

1. Row-лок и «свой atomic НЕ открывается» — структурно (CaptureQueries):
   ровно один ``FOR UPDATE``, ни одного ``SAVEPOINT`` на горячем пути.
2. Границы диапазона year: 2000 и 2200 ПРИНИМАЮТСЯ (dev судит только
   1999/2201 → off-by-one в сервисе или ``gte``→``gt`` в констрейнте не
   краснил бы ничего; зеркало QA-судьи №3 стори 6.1 «ровно max_bytes → 201»).
3. Откат bootstrap-транзакции: строка счётчика откатывается ЦЕЛИКОМ, повтор
   снова выдаёт 1 (шов AC-2×AC-3 — bootstrap живёт В транзакции финализации).
4. Две аллокации одной пары в ОДНОЙ транзакции — паттерн потребителя 6.5
   (батч-финализация); лок реентерабелен, номера продолжаются.
5. Санитизация СЛИВАЕТ ``"  расход  "`` с ``"расход"`` в один счётчик
   (dev судит хранение stripped-значения, но не слияние с существующим).
6. ``updated_at`` двигается при выдаче — пин ``"updated_at"`` в
   ``update_fields`` (auto_now без него молча не сработает).
7-8. Анти-SEQUENCE гвард (Ловушка №2, AC-4 MUST NOT): ``last_number`` — не
   AutoField; в миграциях documents нет nextval/IDENTITY/CREATE SEQUENCE.
"""

from pathlib import Path

import pytest
from django.db import connection, transaction
from django.db.models import AutoField, PositiveIntegerField
from django.test.utils import CaptureQueriesContext

from apps.documents.models import DocumentSequence
from apps.documents.services import allocate_number

# --- Судья 1: механика лока — структурно, в gate ----------------------------


@pytest.mark.django_db
@pytest.mark.skipif(
    not connection.features.has_select_for_update,
    reason="бэкенд без SELECT ... FOR UPDATE (гейт бежит на Postgres)",
)
def test_allocation_takes_row_lock_and_opens_no_own_atomic():
    # Существующая строка → get_or_create идёт по get-пути (без savepoint):
    # любой SAVEPOINT в капче = сервис открыл СВОЙ atomic (нарушение
    # контракта «лок доживает до коммита вызывающего»).
    DocumentSequence.objects.create(doc_type="расход", year=2026, last_number=3)
    with transaction.atomic():
        with CaptureQueriesContext(connection) as ctx:
            assert allocate_number(doc_type="расход", year=2026) == 4
    sqls = [q["sql"] for q in ctx.captured_queries]
    assert sum("FOR UPDATE" in sql for sql in sqls) == 1, sqls
    assert not any("SAVEPOINT" in sql.upper() for sql in sqls), sqls


# --- Судья 2: границы диапазона year принимаются ----------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("year", [2000, 2200])
def test_year_range_boundaries_are_accepted(year):
    # Проходит ОБА слоя: санитизацию сервиса и chk_document_sequence_year_range.
    with transaction.atomic():
        assert allocate_number(doc_type="расход", year=year) == 1
    row = DocumentSequence.objects.get()
    assert (row.year, row.last_number) == (year, 1)


# --- Судья 3: откат bootstrap-транзакции (шов AC-2×AC-3) --------------------


@pytest.mark.django_db
def test_bootstrap_rollback_rolls_back_counter_row_entirely():
    class _Boom(RuntimeError):
        pass

    with pytest.raises(_Boom):
        with transaction.atomic():
            assert allocate_number(doc_type="расход", year=2026) == 1
            raise _Boom()

    # Строка создана В транзакции финализации → откатилась вместе с ней
    # (bootstrap через отдельное соединение/autocommit оставил бы сироту).
    assert not DocumentSequence.objects.exists()

    with transaction.atomic():
        assert allocate_number(doc_type="расход", year=2026) == 1
    assert DocumentSequence.objects.get().last_number == 1


# --- Судья 4: две аллокации одной пары в одной транзакции -------------------


@pytest.mark.django_db
def test_two_allocations_of_same_pair_in_one_transaction():
    with transaction.atomic():
        assert allocate_number(doc_type="расход", year=2026) == 1
        assert allocate_number(doc_type="расход", year=2026) == 2
    row = DocumentSequence.objects.get()
    assert row.last_number == 2


# --- Судья 5: канонизация сливает padded doc_type в один счётчик ------------


@pytest.mark.django_db
def test_padded_doc_type_merges_into_existing_counter():
    with transaction.atomic():
        assert allocate_number(doc_type="расход", year=2026) == 1
    with transaction.atomic():
        assert allocate_number(doc_type="  расход  ", year=2026) == 2
    row = DocumentSequence.objects.get()  # одна строка — счётчик не форкнулся
    assert (row.doc_type, row.last_number) == ("расход", 2)


# --- Судья 6: updated_at двигается при выдаче номера ------------------------


@pytest.mark.django_db
def test_updated_at_advances_on_allocation():
    row = DocumentSequence.objects.create(doc_type="расход", year=2026)
    stamp_before = row.updated_at
    with transaction.atomic():
        allocate_number(doc_type="расход", year=2026)
    row.refresh_from_db()
    # auto_now срабатывает только если "updated_at" остался в update_fields.
    assert row.updated_at > stamp_before


# --- Судьи 7-8: анти-SEQUENCE гвард (Ловушка №2, AC-4 MUST NOT) -------------


def test_last_number_is_plain_integer_not_autofield():
    field = DocumentSequence._meta.get_field("last_number")
    assert not isinstance(field, AutoField)
    assert isinstance(field, PositiveIntegerField)


_MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
# `serial` не сканируем: ложное срабатывание на `serialize=False` в каждой
# CreateModel; serial-семантику номера держит судья по типу поля выше.
_FORBIDDEN_TOKENS = ("nextval", "identity", "create sequence", "createsequence")


def test_no_postgres_sequence_primitives_in_documents_migrations():
    files = [p for p in _MIGRATIONS_DIR.glob("*.py") if p.name != "__init__.py"]
    assert files, f"no migrations scanned under {_MIGRATIONS_DIR}"
    offenders = []
    for path in files:
        text = path.read_text(encoding="utf-8").lower()
        offenders.extend(
            (path.name, token) for token in _FORBIDDEN_TOKENS if token in text
        )
    assert offenders == [], f"sequence primitives in migrations: {offenders}"
