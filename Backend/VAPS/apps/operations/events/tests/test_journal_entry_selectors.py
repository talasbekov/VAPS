"""Story 17.2 (FR-29) — JournalEntrySelector: read-only "история ОМ по
Объекту" / "карточка участника" queries, the only surface for "Инцидент
попадает в Паспорт Объекта и карточки участников" (no write-path exists
on ObjectPassport/Employee for this)."""

import uuid

import pytest

from apps.operations.events.models import JournalEntry, SecurityEvent
from apps.operations.events.selectors import JournalEntrySelector
from apps.operations.events.services import create_journal_entry
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(obj, code):
    return SecurityEvent.objects.create(
        object=obj, title="ОМ " + code, status_code=SecurityEvent.StatusCode.IN_PROGRESS
    )


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


def test_incidents_for_object_returns_all_events_of_that_object_chronologically():
    obj = FacilityObject.objects.create(
        code="OBJ-SEL-1", name="Штаб", address="г. Кызылорда"
    )
    event_a = make_event(obj, "A")
    event_b = make_event(obj, "B")
    post_a = make_post(obj, "POST-A")
    post_b = make_post(obj, "POST-B")

    first = create_journal_entry(
        event_a,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="Первый",
        post=post_a,
    )
    second = create_journal_entry(
        event_b,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="Второй",
        post=post_b,
    )

    ids = list(
        JournalEntrySelector.incidents_for_object(obj.pk).values_list("pk", flat=True)
    )
    assert ids == [first.pk, second.pk]


def test_incidents_for_object_excludes_other_objects_and_non_incidents():
    obj = FacilityObject.objects.create(
        code="OBJ-SEL-2", name="Штаб", address="г. Кызылорда"
    )
    other_obj = FacilityObject.objects.create(
        code="OBJ-SEL-3", name="Штаб", address="г. Кызылорда"
    )
    event = make_event(obj, "C")
    other_event = make_event(other_obj, "D")
    post = make_post(obj)
    other_post = make_post(other_obj, "POST-OTHER")

    create_journal_entry(
        event, actor="staff-1", entry_type=JournalEntry.EntryType.BRIEFING, text="x"
    )
    create_journal_entry(
        other_event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="x",
        post=other_post,
    )
    matching = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="x",
        post=post,
    )

    result = list(JournalEntrySelector.incidents_for_object(obj.pk))
    assert [r.pk for r in result] == [matching.pk]


def test_incidents_for_participant_finds_named_participant_only():
    obj = FacilityObject.objects.create(
        code="OBJ-SEL-4", name="Штаб", address="г. Кызылорда"
    )
    event = make_event(obj, "E")
    post = make_post(obj)
    participant_a = uuid.uuid4()
    participant_b = uuid.uuid4()
    not_a_participant = uuid.uuid4()

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="x",
        post=post,
        participant_ids=[participant_a, participant_b],
    )

    found = list(JournalEntrySelector.incidents_for_participant(participant_a))
    assert [f.pk for f in found] == [entry.pk]
    assert not JournalEntrySelector.incidents_for_participant(
        not_a_participant
    ).exists()
