"""Story 6.2 — конкурентная выдача номеров (AC-1, AC-3) и энфорс «только в
транзакции» (AC-5). Скелет — ``test_employee_status_concurrency`` (3.14).

⚠️ Бегут ТОЛЬКО в test-full: ``django_db(transaction=True)`` обязан нести
``@pytest.mark.concurrency`` — gate деселектит маркер, иначе teardown-flush
(TRUNCATE audit_logs × statement-триггер append-only) валит гейт ДАЖЕ на
пустой таблице. Каждый тест здесь даёт 1 ожидаемый teardown-ERROR — это НЕ
провал; критерий успеха прогона: ``3 passed``, все error'ы строго teardown.

⚠️ Прогонять на Postgres (:5433): SQLite молча игнорирует
``select_for_update`` — тесты «пройдут» по ложной причине::

    docker compose up -d --wait db && \\
    VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps \\
    VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 \\
    .venv/bin/pytest -m concurrency apps/documents

В каждом воркере — СВОЙ ``transaction.atomic()`` вокруг ``allocate_number``:
сервис намеренно своего atomic НЕ открывает (лок должен дожить до коммита
вызывающего), без обёртки воркер уйдёт в autocommit и упадёт с
``TransactionManagementError``.
"""

import threading

import pytest
from django.db import connection, transaction

from apps.documents.models import DocumentSequence
from apps.documents.services import allocate_number

WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs


def _run_two_workers(*, doc_type, year):
    """Два потока конкурентно аллоцируют номер; возвращает results-dict."""
    barrier = threading.Barrier(2)
    results = {}

    def worker(name):
        try:
            barrier.wait(timeout=WAIT)
            with transaction.atomic():
                number = allocate_number(doc_type=doc_type, year=year)
            results[name] = ("ok", number)
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            results[name] = ("error", f"{type(exc).__name__}: {exc}")
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(n,)) for n in ("A", "B")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=WAIT * 3)
        assert not thread.is_alive(), "thread hung past the deadline"
    return results


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_increment_of_existing_counter_is_serialized():
    # AC-1: проигравшая транзакция ЖДЁТ на row-локе до коммита победителя
    # (не падает) → номера уникальны и последовательны, lost update невозможен.
    try:
        DocumentSequence.objects.create(doc_type="расход", year=2026, last_number=5)
        results = _run_two_workers(doc_type="расход", year=2026)

        outcomes = sorted(v[0] for v in results.values())
        assert outcomes == ["ok", "ok"], f"unexpected outcomes: {results}"
        numbers = {v[1] for v in results.values()}
        assert numbers == {6, 7}, results
        row = DocumentSequence.objects.get()  # ровно одна строка
        assert row.last_number == 7
    finally:
        DocumentSequence.objects.all().delete()


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_bootstrap_race_creates_single_row_no_leaked_error():
    # AC-3 (§82.3): строки (doc_type, year) НЕТ — гонка двух транзакций
    # сериализуется на unique-индексе (get_or_create: savepoint-rollback →
    # повторный get) + row-локе; наружу не выходит ни IntegrityError, ни
    # отравленная внешняя транзакция. Счётчик нового года стартует с 1.
    try:
        assert not DocumentSequence.objects.exists()
        results = _run_two_workers(doc_type="расход", year=2027)

        outcomes = sorted(v[0] for v in results.values())
        assert outcomes == ["ok", "ok"], f"unexpected outcomes: {results}"
        numbers = {v[1] for v in results.values()}
        assert numbers == {1, 2}, results
        row = DocumentSequence.objects.get()  # ровно ОДНА строка
        assert row.last_number == 2
    finally:
        DocumentSequence.objects.all().delete()


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_allocate_outside_atomic_raises_transaction_management_error():
    # AC-5: вне atomic (autocommit) select_for_update кидает TME — имплицитный
    # энфорс контракта «только в транзакции финализации». Потоки не нужны.
    try:
        with pytest.raises(transaction.TransactionManagementError):
            allocate_number(doc_type="расход", year=2026)
    finally:
        # get_or_create успевает закоммитить строку в autocommit ДО того,
        # как lock_sequence поднимет TME — прибрать за собой.
        DocumentSequence.objects.all().delete()
