import logging
import threading
import time
import uuid
from datetime import date, timedelta

import pytest
from django.db import (
    IntegrityError,
    OperationalError,
    connection,
    connections,
    transaction,
)
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from apps.core.clock import Clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.bulk_status_service import (
    bulk_create_statuses,
)
from apps.operations.statuses.services.status_service import (
    cancel_status,
    create_status,
)

WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_hard_overlap_exactly_one_commit():
    # Deterministic race (review 1.5): a symmetric barrier start lets both
    # transactions insert before either constraint check runs, and Postgres
    # resolves the mutual wait as DeadlockDetected (no constraint name) in
    # most runs. Sequencing the inserts — first transaction holds its row
    # uncommitted while the second attempts the overlap — guarantees the
    # second blocks on the gist lock and gets IntegrityError after the first
    # commits, which is exactly AC-1.
    employee = uuid.uuid4()
    first_inserted = threading.Event()
    second_attempting = threading.Event()
    integrity_errors = []
    unexpected = []

    def insert_first():
        try:
            with transaction.atomic():
                EmployeeStatus.objects.create(
                    employee_id=employee,
                    status_type_code="VACATION",
                    date_start=date(2026, 6, 1),
                    date_end=date(2026, 6, 15),
                )
                first_inserted.set()
                if not second_attempting.wait(timeout=WAIT):
                    raise RuntimeError("second thread never attempted its insert")
                # Let the second insert reach the gist lock before we commit;
                # if it has not yet, it fails on the committed row instead —
                # either way the outcome is the same IntegrityError.
                time.sleep(0.3)
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"first: {type(exc).__name__}: {exc}")
        finally:
            first_inserted.set()  # never leave the second thread waiting
            connection.close()

    def insert_second():
        try:
            if not first_inserted.wait(timeout=WAIT):
                raise RuntimeError("first thread never inserted")
            second_attempting.set()
            EmployeeStatus.objects.create(
                employee_id=employee,
                status_type_code="SICK_LEAVE",
                date_start=date(2026, 6, 10),
                date_end=date(2026, 6, 20),
            )
        except IntegrityError as exc:
            integrity_errors.append(str(exc))
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"second: {type(exc).__name__}: {exc}")
        finally:
            second_attempting.set()  # never leave the first thread waiting
            connection.close()

    threads = [
        threading.Thread(target=insert_first),
        threading.Thread(target=insert_second),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=WAIT * 3)
        assert not thread.is_alive(), "thread hung past the deadline"

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert len(integrity_errors) == 1, (
        f"expected exactly one IntegrityError, got: {integrity_errors}"
    )
    assert "excl_hard_status_overlap" in integrity_errors[0]
    assert EmployeeStatus.objects.filter(employee_id=employee).count() == 1


# ---------------------------------------------------------------------------
# Story 3.14 — two operators mutate one employee at the same instant.
#
# Nothing below changes production code: the machinery was built in 3.1 (§36
# handler + CONSTRAINT_ERROR_MAP), 3.2 (GiST excl_hard_status_overlap) and 3.3
# (employee row-lock + savepoint). These tests prove it holds the race.
#
# Three outcomes, three distinct mechanisms:
#   * SOFT×SOFT has NO database constraint (excl_hard_status_overlap is partial
#     on hard types), so select_for_update() on the employee row is the only
#     thing preventing a lost update. Loser → 409 STATUS_OVERLAP_WARNING.
#   * HARD×HARD through the service — the loser is stopped by the _assert_no_
#     conflict pre-check under that same lock. Loser → 422. The GiST constraint
#     never fires here; it is the backstop (architecture.md#L283).
#   * HARD×HARD around the service — no lock, so Postgres arbitrates and may
#     resolve the race as a named IntegrityError OR as a deadlock. The §36
#     handler maps both to 422, so the assertion is on the HTTP outcome.
#
# The test above stays as it is: it is the guard for the named-IntegrityError
# path specifically, which its Event sequencing makes deterministic.
# ---------------------------------------------------------------------------

_IIN = iter(f"8801013{n:05d}" for n in range(1, 9999))


def _seed_division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D"
    )


def _seed_types():
    StatusType.objects.create(
        code="VACATION", name="В отпуске", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )


def _seed_employee(div):
    return Employee.objects.create(
        iin=next(_IIN), full_name="T", rank_code="MAJOR",
        position_code="OPER", division=div,
    )


def _seed():
    """Commit an Employee (+ the two status types) before any thread starts.

    A plain helper, not a `db` fixture: `django_db(transaction=True)` already
    opened the database, and the main thread runs in autocommit, so these rows
    are visible to every worker's own connection. Wrapping this in `atomic()`
    would hide them from the workers and hang them on locks instead.

    `create_status` locks a REAL employee row (`_lock_employee` → 404 when the
    row is missing), so a bare uuid4 will not do — unlike the raw-insert path,
    where `employee_id` is a flat UUIDField (ARCH-003).
    """
    div = _seed_division()
    _seed_types()
    return _seed_employee(div)


def _seed_many(count):
    """Same contract as `_seed`, for the bulk path: one division, N employees.

    The list is in creation order, which is NOT id order (uuid4) — so reversing
    it gives a genuinely opposite acquisition order for the second writer.
    """
    div = _seed_division()
    _seed_types()
    return div, [_seed_employee(div) for _ in range(count)]


class _CreateStatusView(APIView):
    """`create_status` behind REAL DRF dispatch (pattern: `_ServiceCreateView`
    in test_status_service). There is no status endpoint yet, and the whole
    point of this story is the HTTP outcome — 409 vs 422 vs 500 — which only
    the §36 handler produces, and only on the dispatch path."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        create_status(
            employee_id=request.data["employee_id"],
            status_type_code=request.data["status_type_code"],
            date_start=date.fromisoformat(request.data["date_start"]),
            date_end=date.fromisoformat(request.data["date_end"]),
            actor="op",
        )
        return Response(status=201)


class _RawCreateView(APIView):
    """Insert around the service (pattern: `_RawOverlapView`), so NO employee
    lock is taken. The GiST constraint is then the only thing between the two
    writers — which is exactly what AC-3 puts under a symmetric race."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        with transaction.atomic():
            EmployeeStatus.objects.create(
                employee_id=request.data["employee_id"],
                status_type_code=request.data["status_type_code"],
                date_start=date.fromisoformat(request.data["date_start"]),
                date_end=date.fromisoformat(request.data["date_end"]),
            )
        return Response(status=201)


def _payload(employee_id, code, date_start, date_end):
    return {
        "employee_id": str(employee_id),
        "status_type_code": code,
        "date_start": date_start.isoformat(),
        "date_end": date_end.isoformat(),
    }


def _race(view, payloads, prepare=None):
    """Fire both writers off one barrier; return (outcomes, unexpected).

    `outcomes` is a list of `(http_status, error_code)`. Never assert inside a
    thread — the exception would be swallowed and the test would pass for the
    wrong reason. Each thread closes its own connection so teardown's TRUNCATE
    is not blocked by a leaked one.

    A real Barrier, not the Event sequencing of the test above: AC-1/AC-2 go
    through the service, which takes a row-lock on the SAME employee first, so
    the threads serialize on a single acquisition order and cannot deadlock;
    AC-3 asserts the union of both Postgres resolutions, so a symmetric start
    is not just safe there but the whole point.

    `prepare(request, payload)` runs in the worker BEFORE the barrier, so any
    row it reads is read by BOTH writers before either commits. The stale-handle
    race on the edit path needs exactly that guarantee — see
    `_attach_stale_status`.
    """
    barrier = threading.Barrier(2, timeout=WAIT)
    outcomes, unexpected = [], []

    def writer(payload):
        try:
            request = APIRequestFactory().post("/x", payload, format="json")
            if prepare is not None:
                prepare(request, payload)
            barrier.wait()  # symmetric start: neither writer gets a head start
            response = view.as_view()(request)
            error_code = (response.data or {}).get("error_code")
            outcomes.append((response.status_code, error_code))
        except threading.BrokenBarrierError as exc:
            unexpected.append(f"barrier broke: {type(exc).__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"{type(exc).__name__}: {exc}")
        finally:
            connection.close()

    threads = [threading.Thread(target=writer, args=(p,)) for p in payloads]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=WAIT * 3)
        assert not thread.is_alive(), "thread hung past the deadline"
    return outcomes, unexpected


# -- AC-1: SOFT race — the employee lock is the ONLY guard --------------------


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_soft_overlap_one_commit_one_409():
    emp = _seed()
    # Clock.today_local(), never clock.override(): the override is a ContextVar
    # and does not cross a thread boundary (deferred-work.md L20). Never
    # timezone.now().date() either — that is the UTC bug 3.13 fixed.
    today = Clock.today_local()
    # BOTH date_start <= today. A rival whose date_start is in the future is
    # PLANNED, and conflict_matrix files a PLANNED soft overlap as a
    # non-blocking WARNING: the loser's pre-check would then see an empty
    # report.soft, both rows would commit, and this test would "pass" while
    # demonstrating the very lost update it exists to forbid.
    payloads = [
        _payload(
            emp.id, "STUDY", today - timedelta(days=2), today + timedelta(days=5)
        ),
        _payload(
            emp.id, "STUDY", today - timedelta(days=1), today + timedelta(days=3)
        ),
    ]

    outcomes, unexpected = _race(_CreateStatusView, payloads)

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert sorted(code for code, _ in outcomes) == [201, 409], outcomes
    assert [err for code, err in outcomes if code == 409] == [
        "STATUS_OVERLAP_WARNING"
    ], outcomes
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1


# -- AC-2: HARD race through the service — the pre-check stops the loser ------


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_hard_overlap_via_service_one_commit_one_422():
    # The loser is caught by _assert_no_conflict under the employee lock, NOT by
    # the GiST constraint — the constraint is the backstop, and AC-3 below is
    # what makes it fire. Asserting the HTTP outcome keeps this true either way.
    emp = _seed()
    today = Clock.today_local()
    payloads = [
        _payload(
            emp.id,
            "VACATION",
            today + timedelta(days=1),
            today + timedelta(days=10),
        ),
        _payload(
            emp.id,
            "VACATION",
            today + timedelta(days=5),
            today + timedelta(days=15),
        ),
    ]

    outcomes, unexpected = _race(_CreateStatusView, payloads)

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert sorted(code for code, _ in outcomes) == [201, 422], outcomes
    assert [err for code, err in outcomes if code == 422] == [
        "OVERLAPPING_HARD_STATUS"
    ], outcomes
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1


# -- AC-3: HARD race around the service — the constraint backstop -------------


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_hard_overlap_raw_symmetric_race_never_500(caplog):
    # The deadlock repro handed forward from 3.1. Without the employee lock the
    # two inserts race on the GiST constraint, and Postgres is free to resolve
    # it either way: the loser gets an IntegrityError naming
    # excl_hard_status_overlap, or — when both speculative inserts wait on each
    # other — DeadlockDetected (40P01) with no constraint name at all. The §36
    # handler maps BOTH to 422, so we assert the outcome, not the class.
    emp = _seed()
    today = Clock.today_local()
    payloads = [
        _payload(
            emp.id,
            "VACATION",
            today + timedelta(days=1),
            today + timedelta(days=10),
        ),
        _payload(
            emp.id,
            "SICK_LEAVE",
            today + timedelta(days=5),
            today + timedelta(days=15),
        ),
    ]

    with caplog.at_level(logging.WARNING, logger="apps.core.api.exception_handler"):
        outcomes, unexpected = _race(_RawCreateView, payloads)

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert sorted(code for code, _ in outcomes) == [201, 422], outcomes
    assert [err for code, err in outcomes if code == 422] == [
        "OVERLAPPING_HARD_STATUS"
    ], outcomes
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1

    messages = [record.getMessage() for record in caplog.records]
    # An unmapped constraint would silently become a 500 — a real defect, not a
    # race artifact, so it stays an assertion rather than an observation.
    assert not [m for m in messages if "Unmapped IntegrityError" in m], messages
    resolved_by = (
        "OperationalError (40P01/40001)"
        if any("Deadlock/serialization" in m for m in messages)
        else "named IntegrityError (excl_hard_status_overlap)"
    )
    print(f"AC-3: Postgres resolved the race via {resolved_by}")


# -- AC-4: the thin gate twin — no threads, no marker -------------------------


@pytest.fixture
def other_session():
    """A second, real database session, used to hold a row lock.

    Copied from the 3.12 idiom with ONE change: autocommit MUST be off. A row
    lock lives exactly as long as its transaction, so under autocommit the
    `SELECT … FOR UPDATE` below would release it the instant the statement ends
    and the test would go green without ever contending for anything. (3.12 took
    only advisory locks, which are session-scoped — hence no autocommit dance.)
    """
    conn = connections.create_connection("default")
    conn.set_autocommit(False)
    try:
        yield conn
    finally:
        conn.rollback()  # release the row lock before teardown's TRUNCATE
        conn.close()


def _hold_employee_lock(conn, employee_id):
    with conn.cursor() as cursor:
        cursor.execute(
            f"SELECT id FROM {Employee._meta.db_table} WHERE id = %s FOR UPDATE",
            [str(employee_id)],
        )
        return cursor.fetchone()


@pytest.mark.django_db(transaction=True)  # no `concurrency` marker → runs in gate
def test_create_status_row_locks_the_employee(other_session):
    """AC-1..AC-3 all rest on create_status locking the employee row, and `make
    gate` deselects all three. This is the guard the gate DOES see: with a rival
    session holding that row, create_status cannot get past _lock_employee.

    Asserts the RAW exception, not an HTTP code: 55P03 (lock_not_available) is
    deliberately absent from _CONFLICT_SQLSTATES, so the §36 handler renders it
    as a 500 — a lock timeout is an infrastructure signal, not a business
    conflict. That narrowing came out of review 3.1; do not "fix" it.
    """
    emp = _seed()
    assert _hold_employee_lock(other_session, emp.id) is not None
    today = Clock.today_local()

    with connection.cursor() as cursor:
        cursor.execute("SET lock_timeout = '250ms'")
    try:
        with pytest.raises(OperationalError) as exc_info:
            create_status(
                employee_id=emp.id,
                status_type_code="STUDY",
                date_start=today,
                date_end=today + timedelta(days=1),
                actor="op",
            )
        assert exc_info.value.__cause__.sqlstate == "55P03"
    finally:
        # Session-scoped setting: leaking it would time out later tests.
        with connection.cursor() as cursor:
            cursor.execute("SET lock_timeout = 0")

    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 0


# ---------------------------------------------------------------------------
# QA hardening (bmad-qa-generate-e2e-tests, 2026-07-10) — the two write-paths
# story 3.14 left uncovered under a real race, both recorded in deferred-work.
#
# The story proved `create_status`. The EDIT family (`_lock_for_edit`) and the
# BULK family (`lock_employees`) rest on the very same pessimistic-lock idea and
# had zero threaded coverage: review 3.6 found an append-once lost update on the
# edit path and fixed it with `status.refresh_from_db()`, but proved the fix
# SEQUENTIALLY (two handles, one thread); story 3.8's bulk lock was never raced
# at all. Both tests below follow the 3.14 pattern exactly — barrier + inline
# view + real DRF dispatch — so the assertion is the HTTP outcome, never 500.
# ---------------------------------------------------------------------------


class _CancelStatusView(APIView):
    """`cancel_status` behind real dispatch, cancelling a handle the CALLER
    fetched (see `_attach_stale_status`) rather than one this view re-reads."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        cancel_status(
            request.stale_status,
            actor=request.data["actor"],
            reason=request.data["reason"],
        )
        return Response(status=200)


def _attach_stale_status(request, payload):
    """Read the status BEFORE the barrier, so both writers hold `cancelled_at =
    None` in memory when they start contending.

    Load-bearing for what this proves. `_lock_for_edit` refreshes the row only
    AFTER `_lock_employee` returns, so the loser's rejection depends on that
    refresh — but only if its in-memory copy was stale to begin with. Were the
    view to fetch the row itself (post-barrier), the loser might read it after
    the winner had already committed, arrive with fresh cancel facts, and reject
    the operation for a reason that has nothing to do with `refresh_from_db()`.
    The test would then stay green with the refresh deleted.

    DRF's `Request.__getattr__` proxies unknown attributes to the underlying
    HttpRequest, so the view reads it back as `request.stale_status`.
    """
    request.stale_status = EmployeeStatus.objects.get(pk=payload["status_id"])


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_cancel_status_append_once_holds():
    """Two operators cancel the same PLANNED status at the same instant.

    Append-once means the cancel facts (`cancelled_at/by/reason`) are written
    once and never overwritten. The employee lock alone does NOT deliver that:
    it serializes the writers but hands the loser its own stale instance, whose
    `cancelled_at` is still None — the loser would sail through the PLANNED
    guard and overwrite the winner's facts. `_lock_for_edit`'s `refresh_from_db`
    under the lock is the whole defence, and this is the only test that races it.
    """
    emp = _seed()
    today = Clock.today_local()  # never clock.override — ContextVar, see AC-1
    status = EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="STUDY",
        date_start=today + timedelta(days=5),  # PLANNED: only PLANNED cancels
        date_end=today + timedelta(days=10),
    )
    reasons = {"op-a": "первая отмена", "op-b": "вторая отмена"}
    payloads = [
        {"status_id": str(status.pk), "actor": actor, "reason": reason}
        for actor, reason in reasons.items()
    ]

    outcomes, unexpected = _race(
        _CancelStatusView, payloads, prepare=_attach_stale_status
    )

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert sorted(code for code, _ in outcomes) == [200, 422], outcomes
    assert [err for code, err in outcomes if code == 422] == [
        "INVALID_LIFECYCLE_TRANSITION"
    ], outcomes

    status.refresh_from_db()
    assert status.cancelled_at is not None
    # The facts belong to ONE writer — a torn write (winner's actor, loser's
    # reason) is the exact corruption append-once forbids.
    assert status.cancelled_by in reasons, status.cancelled_by
    assert status.cancelled_reason == reasons[status.cancelled_by]
    assert EmployeeStatus.objects.filter(employee_id=emp.id).count() == 1


class _BulkCreateView(APIView):
    """`bulk_create_statuses` behind real dispatch. `employee_id` is rebuilt as
    a UUID, not left a string: the service keys its locked-employee map by the
    model's UUID pk, and a string would silently miss it → 404."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        bulk_create_statuses(
            [
                {
                    "employee_id": uuid.UUID(row["employee_id"]),
                    "status_type_code": row["status_type_code"],
                    "date_start": date.fromisoformat(row["date_start"]),
                    "date_end": date.fromisoformat(row["date_end"]),
                }
                for row in request.data["rows"]
            ],
            actor=request.data["actor"],
            business_date=date.fromisoformat(request.data["business_date"]),
            allowed_division_ids={uuid.UUID(request.data["division_id"])},
        )
        return Response(status=201)


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_bulk_create_reverse_ordered_one_commit_one_409(caplog):
    """Two operators mass-write the SAME unit, with oppositely ordered payloads.

    This is the 16-17 peak that `lock_employees` exists for (NFR-4). Two things
    must hold at once, and each fails differently:

    * No deadlock. The bulk lock is one `... ORDER BY id FOR UPDATE` query, so
      both writers acquire in row order and the reversed payloads cannot matter.
      Rebuild it as a per-row lock loop and the acquisition order becomes the
      CALLER's — A waits on B's row while B waits on A's → 40P01. Since «ретраи
      мутаций запрещены» (architecture.md#L463) nothing would retry it; worse,
      the §36 handler maps every conflict SQLSTATE onto the constraint code, so
      the operator is told OVERLAPPING_HARD_STATUS about a deadlock between two
      unrelated employees. Hence the log assertion, not just the status codes.
    * No lost update. Both payloads overlap in time on all three employees, so
      exactly one writer may commit; the loser's pre-check must SEE the winner's
      rows. Drop `select_for_update()` from `lock_employees` and both writers
      read an empty overlap set and commit — six rows where three are allowed.
      This mirrors AC-1: soft×soft has no DB constraint to fall back on.
    """
    div, employees = _seed_many(3)
    today = Clock.today_local()

    def _rows(order, date_start, date_end):
        return [
            {
                "employee_id": str(employee.id),
                "status_type_code": "STUDY",
                "date_start": date_start.isoformat(),
                "date_end": date_end.isoformat(),
            }
            for employee in order
        ]

    def _payload_bulk(actor, order, date_start, date_end):
        return {
            "rows": _rows(order, date_start, date_end),
            "actor": actor,
            "business_date": today.isoformat(),
            "division_id": str(div.id),
        }

    # Overlapping intervals, and BOTH date_start <= today: a PLANNED soft
    # overlap is only a warning, so the loser would commit too (trap #1, AC-1).
    payloads = [
        _payload_bulk(
            "op-a", employees, today - timedelta(days=2), today + timedelta(days=5)
        ),
        _payload_bulk(
            "op-b",
            list(reversed(employees)),  # opposite acquisition order
            today - timedelta(days=1),
            today + timedelta(days=3),
        ),
    ]

    with caplog.at_level(logging.WARNING, logger="apps.core.api.exception_handler"):
        outcomes, unexpected = _race(_BulkCreateView, payloads)

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert sorted(code for code, _ in outcomes) == [201, 409], outcomes
    assert [err for code, err in outcomes if code == 409] == [
        "STATUS_OVERLAP_WARNING"
    ], outcomes
    # All-or-nothing: the winner's three rows, none of the loser's.
    assert EmployeeStatus.objects.count() == 3

    messages = [record.getMessage() for record in caplog.records]
    assert not [m for m in messages if "Deadlock/serialization" in m], messages
