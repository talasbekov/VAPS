"""Story 19.7 (NFR-4/AR-10): конкурентные/нагрузочные тесты submit_day() у
контрольного часа 17:00 — существующий механизм сериализации
(unique_daily_submission_current + savepoint, 5.3b) под конкурентной/бёрст-
нагрузкой, ничего нового не строит.

`submit_day()` НЕ ловит IntegrityError сама (в отличие от
issue_expense_document — см. test_document_release.py) — вызов вне HTTP
получает СЫРОЙ `django.db.IntegrityError` (day_submission_service.py:187-188,
тот же канон, что amendment_service.py:76-78). Каждый worker-поток обязан
сам вызвать `clock.override(D)` внутри своей функции — ContextVar не
наследуется в новые потоки (apps/core/clock.py's `_override`).

Конкурентный тест пишет audit-строки — teardown-flush может дать 1 ожидаемый
ERROR (audit_logs append-only x TRUNCATE), это не провал (см.
test_document_release.py's docstring)."""

import itertools
import threading
from datetime import date

import pytest
from django.db import IntegrityError, connection

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import submit_day

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs
_iin = itertools.count(750)
# submit_day() всегда создаёт version=1 для первой сдачи — оба гонящихся
# потока пишут ИДЕНТИЧНУЮ строку (division_id, business_date, version=1,
# is_current=True), поэтому Postgres может репортовать любой из ДВУХ
# констрейнтов, защищающих один и тот же инвариант (проверено эмпирически:
# фактически бьёт unique_daily_submission_version, не _current) — оба
# приемлемы, любой ДРУГОЙ констрейнт означал бы посторонний баг.
_DUPLICATE_SUBMISSION_CONSTRAINTS = (
    "unique_daily_submission_current",
    "unique_daily_submission_version",
)


def make_division(code):
    organization = Organization.objects.create(name="Орг", code=f"ORG-{code}")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=organization, type_code=dtp, name=f"Отдел {code}", code=code
    )


def teardown_division(division):
    organization_id = division.organization_id
    DailySubmission.objects.filter(division_id=division.id).delete()
    Employee.objects.filter(division=division).delete()
    DivisionHistoricalSlot.objects.filter(division=division).delete()
    Division.objects.filter(id=division.id).delete()
    Organization.objects.filter(id=organization_id).delete()


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_slot(division, slots):
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 7, 1)),
    )


def seed_division(code):
    division = make_division(code)
    make_employee(division)
    make_slot(division, 1)
    return division


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_same_division_race_exactly_one_wins():
    division = seed_division("SUB70-A")
    try:
        barrier = threading.Barrier(2)
        results = {}

        def worker(name):
            try:
                barrier.wait(timeout=WAIT)
                with clock.override(D):
                    submission = submit_day(
                        division_id=division.id, business_date=D, actor=f"op-{name}"
                    )
                results[name] = ("ok", submission.pk)
            except IntegrityError as exc:
                results[name] = ("integrity", str(exc))
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

        outcomes = sorted(kind for kind, _ in results.values())
        assert outcomes == ["integrity", "ok"], f"unexpected outcomes: {results}"
        loser = next(v for k, v in results.items() if v[0] == "integrity")
        assert any(name in loser[1] for name in _DUPLICATE_SUBMISSION_CONSTRAINTS)

        current = DailySubmission.objects.filter(
            division_id=division.id, business_date=D, is_current=True
        )
        assert current.count() == 1
    finally:
        teardown_division(division)


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_cross_division_no_false_contention():
    division_a = seed_division("SUB70-B")
    division_b = seed_division("SUB70-C")
    try:
        barrier = threading.Barrier(2)
        results = {}

        def worker(name, division):
            try:
                barrier.wait(timeout=WAIT)
                with clock.override(D):
                    submission = submit_day(
                        division_id=division.id, business_date=D, actor=f"op-{name}"
                    )
                results[name] = ("ok", submission.pk)
            except Exception as exc:  # noqa: BLE001
                results[name] = ("error", f"{type(exc).__name__}: {exc}")
            finally:
                connection.close()

        threads = [
            threading.Thread(target=worker, args=("A", division_a)),
            threading.Thread(target=worker, args=("B", division_b)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=WAIT * 3)
            assert not thread.is_alive(), "thread hung past the deadline"

        assert all(kind == "ok" for kind, _ in results.values()), results
    finally:
        teardown_division(division_a)
        teardown_division(division_b)


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_burst_load_exactly_one_wins_no_hang():
    division = seed_division("SUB70-D")
    N = 20
    try:
        barrier = threading.Barrier(N)
        results = {}

        def worker(name):
            try:
                barrier.wait(timeout=WAIT)
                with clock.override(D):
                    submission = submit_day(
                        division_id=division.id, business_date=D, actor=f"op-{name}"
                    )
                results[name] = ("ok", submission.pk)
            except IntegrityError as exc:
                results[name] = ("integrity", str(exc))
            except Exception as exc:  # noqa: BLE001
                results[name] = ("error", f"{type(exc).__name__}: {exc}")
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(N)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=WAIT * 3)
            assert not thread.is_alive(), "thread hung past the deadline"

        outcomes = [kind for kind, _ in results.values()]
        assert outcomes.count("ok") == 1, f"expected exactly 1 winner: {results}"
        assert outcomes.count("integrity") == N - 1, f"unexpected losers: {results}"
        losers = [v for v in results.values() if v[0] == "integrity"]
        assert all(
            any(name in v[1] for name in _DUPLICATE_SUBMISSION_CONSTRAINTS)
            for v in losers
        )

        current = DailySubmission.objects.filter(
            division_id=division.id, business_date=D, is_current=True
        )
        assert current.count() == 1
    finally:
        teardown_division(division)
