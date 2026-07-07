import threading
import time
import uuid
from datetime import date, timedelta

import pytest
from django.db import IntegrityError, connection, transaction

from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.status_service import create_status

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


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_create_status_one_commits_other_conflicts():
    # Story 3.14 — SERVICE-level race (operator path), complementary to the
    # model-level test above. Two operators call create_status() on ONE employee
    # with overlapping HARD statuses. The service serializes them on the employee
    # row (_lock_employee → select_for_update): the loser unblocks after the
    # winner commits, its pre-check (_assert_no_conflict) sees the winner's hard
    # status and raises a clean DomainError(OVERLAPPING_HARD_STATUS, 422) — NOT a
    # 500, NOT a raw IntegrityError/OperationalError, NOT a lost update.
    #
    # This asserts the OUTCOME contract (one commit + 422 + no 500/lost-update);
    # which layer fires — the lock pre-check or the GiST backstop — is
    # defense-in-depth and not isolated here (both yield 422). Assumes READ
    # COMMITTED + Postgres: under a higher isolation level the loser's snapshot
    # could miss the winner and hit the GiST → raw IntegrityError instead.
    #
    # Thin gate-runnable companion (deterministic, no threads): test_status_service
    # .py::test_service_savepoint_integrityerror_maps_to_422 (GiST→§36→422). Deadlock
    # backstop: test_exception_handler.py::test_deadlock_sqlstate_maps_to_422. The
    # epic says "409"; the deliberate registry code for a HARD overlap is 422
    # (409 is the SOFT-overridable STATUS_OVERLAP_WARNING).
    org = Organization.objects.create(name="HQ-314", code="HQ314")
    dtp = DivisionType.objects.create(code="mgmt314", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D314", code="D314"
    )
    StatusType.objects.create(
        code="VACATION",
        name="В отпуске",
        is_hard_block=True,
        priority=20,
        report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="SICK_LEAVE",
        name="На больничном",
        is_hard_block=True,
        priority=10,
        report_column_code="SICK",
    )
    emp = Employee.objects.create(
        iin="920101300314",
        full_name="Гонщиков",
        rank_code="MAJOR",
        position_code="OPER",
        division=div,
    )
    # Both intervals span today → both ACTIVE regardless of when the suite runs;
    # they overlap, so the second create is a hard×hard conflict. clock.override
    # would NOT propagate to the worker threads (ContextVar), so we use real dates.
    today = Clock.today_local()
    plans = [
        ("A", "VACATION", today - timedelta(days=5), today + timedelta(days=10)),
        ("B", "SICK_LEAVE", today - timedelta(days=2), today + timedelta(days=15)),
    ]
    barrier = threading.Barrier(len(plans))
    results = {}

    def op(name, code, date_start, date_end):
        try:
            barrier.wait(timeout=WAIT)
            try:
                status = create_status(
                    employee_id=emp.id,
                    status_type_code=code,
                    date_start=date_start,
                    date_end=date_end,
                    actor=f"op-{name}",
                )
                results[name] = ("ok", status.pk)
            except DomainError as exc:
                results[name] = ("conflict", exc.code, exc.http_status)
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            results[name] = ("error", f"{type(exc).__name__}: {exc}")
        finally:
            connection.close()

    threads = [threading.Thread(target=op, args=p) for p in plans]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=WAIT * 3)
            assert not thread.is_alive(), "thread hung past the deadline"

        outcomes = sorted(v[0] for v in results.values())
        assert outcomes == ["conflict", "ok"], (
            f"expected one ok + one conflict: {results}"
        )
        conflict = next(v for v in results.values() if v[0] == "conflict")
        assert conflict[1] == "OVERLAPPING_HARD_STATUS", results
        assert conflict[2] == 422, results
        # exactly one commit, and the surviving row is the WINNER's (not a
        # phantom / not a lost update)
        live = EmployeeStatus.objects.filter(
            employee_id=emp.id, cancelled_at__isnull=True
        )
        assert live.count() == 1
        ok = next(v for v in results.values() if v[0] == "ok")
        assert live.get().pk == ok[1], results
    finally:
        EmployeeStatus.objects.filter(employee_id=emp.id).delete()
        Employee.objects.filter(id=emp.id).delete()
        Division.objects.filter(id=div.id).delete()
        DivisionType.objects.filter(code="mgmt314").delete()
        Organization.objects.filter(code="HQ314").delete()
        StatusType.objects.filter(code__in=["VACATION", "SICK_LEAVE"]).delete()
