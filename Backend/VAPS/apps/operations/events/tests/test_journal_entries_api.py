"""Story 17.7a — API behavioral tests: journal-entries under
SecurityEventViewSet (create/list) + JournalEntryViewSet (detail).
Thin wrapper over create_journal_entry() (17.1/17.2)."""

import uuid

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import JournalEntry, SecurityEvent
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def writer_client(seeded):
    role = Role.objects.create(code="TEST_JOURNAL_WRITER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="event.journal.create"
    )
    UserRole.objects.create(user_id="journal-writer-1", role_code=role)
    return _client("journal-writer-1")


@pytest.fixture
def reader_client(seeded):
    role = Role.objects.create(code="TEST_JOURNAL_READER", name="Test")
    RolePermission.objects.create(
        role_code=role, permission_code_id="event.journal.view"
    )
    UserRole.objects.create(user_id="journal-reader-1", role_code=role)
    return _client("journal-reader-1")


@pytest.fixture
def no_permission_client(seeded):
    return _client("nobody-with-no-role")


def make_event(code, status_code=SecurityEvent.StatusCode.IN_PROGRESS):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def journal_url(event):
    return reverse("ops-security-event-journal-entries", args=[event.pk])


def detail_url(entry):
    return reverse("ops-journal-entry-detail", args=[entry.pk])


def test_create_briefing_entry(writer_client):
    event = make_event("OBJ-JAPI-1")

    resp = writer_client.post(
        journal_url(event), {"entry_type": "BRIEFING", "text": "Инструктаж"}
    )

    assert resp.status_code == 201
    assert resp.data["entry_type"] == "BRIEFING"
    assert JournalEntry.objects.filter(event=event).count() == 1


def test_create_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-JAPI-2")

    resp = no_permission_client.post(
        journal_url(event), {"entry_type": "BRIEFING", "text": "x"}
    )

    assert resp.status_code == 403


def test_create_incident_without_post_is_400(writer_client):
    event = make_event("OBJ-JAPI-3")

    resp = writer_client.post(
        journal_url(event), {"entry_type": "INCIDENT", "text": "x"}
    )

    assert resp.status_code == 400


def test_create_incident_with_post_succeeds(writer_client):
    event = make_event("OBJ-JAPI-3b")
    post = make_post(event.object)

    resp = writer_client.post(
        journal_url(event), {"entry_type": "INCIDENT", "text": "x", "post": post.pk}
    )

    assert resp.status_code == 201
    assert resp.data["post"] == post.pk


def test_create_incident_with_participants_and_photo_round_trips(writer_client):
    """review (Blind Hunter): participant_ids/photo_attachment_id were
    accepted by the serializer but never asserted in a response."""
    event = make_event("OBJ-JAPI-3c")
    post = make_post(event.object)
    participant = str(uuid.uuid4())
    photo = str(uuid.uuid4())

    resp = writer_client.post(
        journal_url(event),
        {
            "entry_type": "INCIDENT",
            "text": "x",
            "post": post.pk,
            "participant_ids": [participant],
            "photo_attachment_id": photo,
        },
    )

    assert resp.status_code == 201
    assert resp.data["participant_ids"] == [participant]
    assert resp.data["photo_attachment_id"] == photo


def test_list_returns_entries_in_chronological_order(reader_client, writer_client):
    """review (Blind Hunter): the endpoint claims chronological ordering
    (JournalEntry.Meta.ordering) but no test pinned it directly."""
    event = make_event("OBJ-JAPI-3d")
    first = writer_client.post(
        journal_url(event), {"entry_type": "BRIEFING", "text": "1"}
    ).data
    second = writer_client.post(
        journal_url(event), {"entry_type": "DIRECTIVE", "text": "2"}
    ).data
    third = writer_client.post(
        journal_url(event), {"entry_type": "BRIEFING", "text": "3"}
    ).data

    resp = reader_client.get(journal_url(event))

    assert [row["id"] for row in resp.data] == [
        first["id"],
        second["id"],
        third["id"],
    ]


def test_list_journal_entries(reader_client, writer_client):
    event = make_event("OBJ-JAPI-4")
    writer_client.post(journal_url(event), {"entry_type": "BRIEFING", "text": "1"})
    writer_client.post(journal_url(event), {"entry_type": "DIRECTIVE", "text": "2"})

    resp = reader_client.get(journal_url(event))

    assert resp.status_code == 200
    assert len(resp.data) == 2


def test_list_filters_by_entry_type(reader_client, writer_client):
    event = make_event("OBJ-JAPI-5")
    post = make_post(event.object)
    writer_client.post(journal_url(event), {"entry_type": "BRIEFING", "text": "1"})
    writer_client.post(
        journal_url(event), {"entry_type": "INCIDENT", "text": "2", "post": post.pk}
    )

    resp = reader_client.get(journal_url(event), {"entry_type": "INCIDENT"})

    assert resp.status_code == 200
    assert len(resp.data) == 1
    assert resp.data[0]["entry_type"] == "INCIDENT"


def test_list_without_permission_is_403(no_permission_client):
    event = make_event("OBJ-JAPI-6")

    resp = no_permission_client.get(journal_url(event))

    assert resp.status_code == 403


def test_detail_retrieve(reader_client, writer_client):
    event = make_event("OBJ-JAPI-7")
    created = writer_client.post(
        journal_url(event), {"entry_type": "BRIEFING", "text": "x"}
    )
    entry = JournalEntry.objects.get(pk=created.data["id"])

    resp = reader_client.get(detail_url(entry))

    assert resp.status_code == 200
    assert resp.data["id"] == entry.pk


def test_create_rejected_when_event_not_in_progress(writer_client):
    event = make_event("OBJ-JAPI-8", status_code=SecurityEvent.StatusCode.DRAFT)

    resp = writer_client.post(
        journal_url(event), {"entry_type": "BRIEFING", "text": "x"}
    )

    assert resp.status_code == 422


def test_create_nonexistent_event_is_404(writer_client):
    resp = writer_client.post(
        reverse("ops-security-event-journal-entries", args=[999999]),
        {"entry_type": "BRIEFING", "text": "x"},
    )
    assert resp.status_code == 404
