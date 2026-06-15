import threading
import time
import uuid
from datetime import date

import pytest
from django.db import IntegrityError, connection, transaction

from apps.operations.statuses.models import EmployeeStatus

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
