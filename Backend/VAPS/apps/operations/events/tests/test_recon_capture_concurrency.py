"""Story 15.3b — concurrency regression for `replace_checklist_items()`.

Review (Edge Case Hunter): reproduced a torn-write bug — without
`select_for_update()` on the parent `SecurityEvent`, two concurrent
replace-all calls both see the pre-delete row set (READ COMMITTED), and
both commit their own `bulk_create()`, leaving the UNION of both writers'
rows instead of one clean replace. Fixed by locking the parent row
(mirrors `issue_bulletin()`). This test proves the fix: the final row
count is exactly one writer's set (5), never the union (10).
"""

import threading

import pytest
from django.db import connection

from apps.operations.events.models import SecurityEvent, SecurityEventChecklistItem
from apps.operations.events.services import replace_checklist_items
from apps.operations.facilities.models import Object as FacilityObject

WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_replace_checklist_is_not_torn():
    obj = FacilityObject.objects.create(
        code="OBJ-RECON-CONCURRENCY-1", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    barrier = threading.Barrier(2)
    unexpected = []

    def replace_with(label_prefix):
        try:
            barrier.wait(timeout=WAIT)
            rows = [{"label": f"{label_prefix}-{i}"} for i in range(5)]
            replace_checklist_items(event, rows)
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"{label_prefix}: {type(exc).__name__}: {exc}")
        finally:
            connection.close()

    threads = [
        threading.Thread(target=replace_with, args=("A",)),
        threading.Thread(target=replace_with, args=("B",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=WAIT)

    assert not unexpected, unexpected
    final = list(
        SecurityEventChecklistItem.objects.filter(event=event).values_list(
            "label", flat=True
        )
    )
    # Exactly one writer's 5 rows must survive — never the 10-row union that
    # the pre-fix torn-write bug produced.
    assert len(final) == 5, final
    prefixes = {label.split("-")[0] for label in final}
    assert prefixes in ({"A"}, {"B"}), final
