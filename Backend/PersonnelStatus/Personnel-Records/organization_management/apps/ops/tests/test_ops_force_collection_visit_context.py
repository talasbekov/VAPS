"""Collection context names every visit without widening allocation targets."""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"
LIST = f"{URL}forces/collections/"


@pytest.fixture
def collection_reader():
    # The existing collection permission is sufficient; no catalog/event
    # permission should be needed just to name this collection's visits.
    api, _ = client_for(
        "collection-visit-context",
        "COLLECTION_VISIT_CONTEXT",
        perms=("forces.command",),
    )
    return api


def _collection(manager, *, suffix):
    obj = make_object(code=f"OBJ-CONTEXT-{suffix}", name=f"Основной {suffix}")
    created = create_event(manager, obj, title=f"Сбор {suffix}")
    assert created.status_code == 201, created.content
    event = OpsSecurityEvent.objects.get(pk=created.json()["id"])
    event.recon_force_request = 3
    event.recon_force_requested_at = Clock.now()
    event.save(update_fields=["recon_force_request", "recon_force_requested_at"])
    return event


@pytest.fixture
def multi_visit_collection(manager):  # noqa: F811
    event = _collection(manager, suffix="маршрут")
    primary = event.visit_objects.get()
    primary.stage = "CLOSED"
    primary.position = 20
    primary.save(update_fields=["stage", "position"])

    pending_object = make_object(code="OBJ-CONTEXT-PENDING", name="Новое имя в реестре")
    pending = OpsSecurityEventVisitObject.objects.create(
        pk=9007199254740997,
        event=event,
        security_object=pending_object,
        object_name="Снимок незавершённого объекта",
        stage="RECON",
        position=5,
    )
    ready_object = make_object(code="OBJ-CONTEXT-READY", name="Готовая площадка")
    ready = OpsSecurityEventVisitObject.objects.create(
        pk=9007199254740995,
        event=event,
        security_object=ready_object,
        object_name="Готовая площадка",
        stage="PLACEMENT",
        force_need=3,
        position=5,
    )
    removed_object = make_object(code="OBJ-CONTEXT-REMOVED", name="Удалённая площадка")
    OpsSecurityEventVisitObject.objects.create(
        pk=9007199254740999,
        event=event,
        security_object=removed_object,
        object_name="Снимок удалённой площадки",
        stage="PLACEMENT",
        position=10,
    )
    removed_object.delete()

    event.recon_sector_posts = [
        {"id": "ready-post", "visitObjectId": str(ready.pk), "need": 3},
        {"id": "pending-post", "visitObjectId": str(pending.pk), "need": 7},
    ]
    event.demand_rows = [
        {"id": "demand-ready", "visitObjectId": str(ready.pk), "need": 3},
    ]
    event.save(update_fields=["recon_sector_posts", "demand_rows"])
    return {
        "event": event,
        "readyId": str(ready.pk),
        "expected": [
            {
                "visitObjectId": "9007199254740995",
                "objectId": str(ready_object.pk),
                "objectName": "Готовая площадка",
                "stage": "PLACEMENT",
            },
            {
                "visitObjectId": "9007199254740997",
                "objectId": str(pending_object.pk),
                "objectName": "Снимок незавершённого объекта",
                "stage": "RECON",
            },
            {
                "visitObjectId": "9007199254740999",
                "objectId": None,
                "objectName": "Снимок удалённой площадки",
                "stage": "PLACEMENT",
            },
            {
                "visitObjectId": str(primary.pk),
                "objectId": str(primary.security_object_id),
                "objectName": "Основной маршрут",
                "stage": "CLOSED",
            },
        ],
    }


def _read_collection(api, event, route):
    response = api.get(LIST if route == "list" else f"{URL}{event.pk}/force-collection/")
    assert response.status_code == 200, response.content
    body = response.json()
    if route == "list":
        return next(row for row in body["results"] if row["eventId"] == str(event.pk))
    return body


@pytest.mark.parametrize("route", ["list", "detail"])
def test_collection_context_preserves_all_visit_identities_and_snapshot_names(
    collection_reader, multi_visit_collection, route,
):
    """Primary-only, catalog-ID and published-only projections lose route context."""
    scene = multi_visit_collection

    body = _read_collection(collection_reader, scene["event"], route)

    assert body.get("visitObjects") == scene["expected"]


def test_visit_context_keeps_unpublished_sites_out_of_existing_allocation_targets(
    collection_reader, multi_visit_collection,
):
    """Displaying pending visits must not silently allow assigning people to them."""
    scene = multi_visit_collection

    body = _read_collection(collection_reader, scene["event"], "detail")

    assert body.get("visitObjects") == scene["expected"]
    assert body["objects"] == [{
        "visitObjectId": scene["readyId"],
        "objectName": "Готовая площадка",
        "need": 3,
        "assigned": 0,
    }]
    assert [(row["visitObjectId"], row["need"]) for row in body["needByObject"]] == [
        (scene["readyId"], 3),
    ]
    assert (body["need"], body["allocated"], body["gathered"], body["remaining"]) == (3, 0, 0, 3)
    assert body["totals"] == {
        "need": 3, "requested": 0, "allocating": 0, "sent": 0, "shortage": 3,
    }
    assert body["allocations"] == []
    assert body["roster"] == []
    assert body["handover"] == {}


@pytest.mark.parametrize("route", ["list", "detail"])
def test_collection_without_visits_has_empty_context(collection_reader, manager, route):  # noqa: F811
    """A legacy primary object is not a substitute for missing visit identities."""
    event = _collection(manager, suffix="без-визитов")
    event.visit_objects.all().delete()

    body = _read_collection(collection_reader, event, route)

    assert body.get("visitObjects") == []
    assert body["location"] == "Основной без-визитов"
    assert body["need"] == 3


def test_collection_list_reads_visit_context_once_for_multiple_events(
    collection_reader, manager, multi_visit_collection,
):  # noqa: F811
    """Per-event reads or order_by after prefetch reintroduce visit-context N+1."""
    second = _collection(manager, suffix="второй")
    third = _collection(manager, suffix="третий")
    event_ids = {str(multi_visit_collection["event"].pk), str(second.pk), str(third.pk)}

    with CaptureQueriesContext(connection) as queries:
        response = collection_reader.get(LIST)

    assert response.status_code == 200, response.content
    rows = {row["eventId"]: row for row in response.json()["results"]}
    assert event_ids <= rows.keys()
    assert rows[str(multi_visit_collection["event"].pk)].get("visitObjects") == multi_visit_collection["expected"]
    assert len(rows[str(second.pk)].get("visitObjects", [])) == 1
    assert len(rows[str(third.pk)].get("visitObjects", [])) == 1
    visit_reads = [
        query["sql"] for query in queries.captured_queries
        if "ops_security_event_visit_objects" in query["sql"]
    ]
    assert len(visit_reads) == 1, visit_reads
    catalog_reads = [
        query["sql"] for query in queries.captured_queries
        if "ops_security_objects" in query["sql"]
    ]
    assert catalog_reads == [], catalog_reads
