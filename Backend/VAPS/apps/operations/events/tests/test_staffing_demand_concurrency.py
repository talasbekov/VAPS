"""Story 15.5b — concurrency regression for `replace_staffing_demand()`.

Same shape as `test_recon_capture_concurrency.py` (15.3b) — proves the
`select_for_update()` applied from the start (not as a review fix this
time) actually serializes concurrent replaces: exactly one writer's rows
survive, never the union.
"""

import threading

import pytest
from django.db import connection

from apps.operations.events.models import SecurityEvent, SecurityEventStaffingDemand
from apps.operations.events.services import replace_staffing_demand
from apps.operations.facilities.models import Object as FacilityObject

WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_replace_staffing_demand_is_not_torn():
    obj = FacilityObject.objects.create(
        code="OBJ-DEMAND-CONCURRENCY-1", name="Штаб", address="г. Кызылорда"
    )
    event = SecurityEvent.objects.create(object=obj, title="ОМ")
    barrier = threading.Barrier(2)
    unexpected = []

    def replace_with(sector_prefix):
        try:
            barrier.wait(timeout=WAIT)
            rows = [{"sector": f"{sector_prefix}-{i}"} for i in range(5)]
            replace_staffing_demand(event, rows)
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"{sector_prefix}: {type(exc).__name__}: {exc}")
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
        SecurityEventStaffingDemand.objects.filter(event=event).values_list(
            "sector", flat=True
        )
    )
    assert len(final) == 5, final
    prefixes = {sector.split("-")[0] for sector in final}
    assert prefixes in ({"A"}, {"B"}), final
