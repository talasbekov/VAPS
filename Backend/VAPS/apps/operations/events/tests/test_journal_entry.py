"""Story 17.1 (FR-29) — журнал штаба: create_journal_entry() (BRIEFING/
DIRECTIVE only, INCIDENT reserved for 17.2), gated by
SecurityEvent.status_code == IN_PROGRESS."""

from django.db import IntegrityError

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import JournalEntry, SecurityEvent
from apps.operations.events.services import create_journal_entry
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_event(code, status_code=SecurityEvent.StatusCode.IN_PROGRESS):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def test_create_briefing_entry_while_in_progress():
    event = make_event("OBJ-JOURNAL-1")

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.BRIEFING,
        text="Инструктаж",
    )

    assert entry.event_id == event.pk
    assert entry.entry_type == "BRIEFING"
    assert entry.created_by == "staff-1"


def test_create_directive_entry_while_in_progress():
    event = make_event("OBJ-JOURNAL-2")

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.DIRECTIVE,
        text="Указание",
    )

    assert entry.entry_type == "DIRECTIVE"


@pytest.mark.parametrize(
    "status_code",
    [
        SecurityEvent.StatusCode.DRAFT,
        SecurityEvent.StatusCode.APPROVED,
        SecurityEvent.StatusCode.CLOSED,
    ],
)
def test_create_rejected_when_event_not_in_progress(status_code):
    event = make_event("OBJ-JOURNAL-3", status_code=status_code)

    with pytest.raises(DomainError):
        create_journal_entry(
            event, actor="staff-1", entry_type=JournalEntry.EntryType.BRIEFING, text="x"
        )

    assert not JournalEntry.objects.filter(event=event).exists()


def test_entries_ordered_chronologically():
    event = make_event("OBJ-JOURNAL-4")
    first = create_journal_entry(
        event, actor="staff-1", entry_type=JournalEntry.EntryType.BRIEFING, text="1"
    )
    second = create_journal_entry(
        event, actor="staff-1", entry_type=JournalEntry.EntryType.DIRECTIVE, text="2"
    )
    third = create_journal_entry(
        event, actor="staff-1", entry_type=JournalEntry.EntryType.BRIEFING, text="3"
    )

    ids = list(JournalEntry.objects.filter(event=event).values_list("pk", flat=True))
    assert ids == [first.pk, second.pk, third.pk]


def test_incident_entry_type_rejected_not_yet_implemented():
    event = make_event("OBJ-JOURNAL-5")

    with pytest.raises(DomainError):
        create_journal_entry(event, actor="staff-1", entry_type="INCIDENT", text="x")

    assert not JournalEntry.objects.filter(event=event).exists()


def test_create_writes_audit_row():
    event = make_event("OBJ-JOURNAL-6")

    entry = create_journal_entry(
        event, actor="staff-1", entry_type=JournalEntry.EntryType.BRIEFING, text="x"
    )

    audit = AuditLog.objects.get(action="JOURNAL_ENTRY_CREATED")
    assert audit.entity_type == "security_event"
    assert audit.new_value["entry_id"] == entry.pk


def test_create_requires_actor():
    event = make_event("OBJ-JOURNAL-7")

    with pytest.raises(DomainError):
        create_journal_entry(
            event, actor="", entry_type=JournalEntry.EntryType.BRIEFING, text="x"
        )


def test_db_constraint_rejects_entry_type_outside_choices():
    event = make_event("OBJ-JOURNAL-8")

    with pytest.raises(IntegrityError):
        JournalEntry.objects.create(event=event, entry_type="BOGUS", text="x")


@pytest.mark.parametrize("entry_type", list(JournalEntry.EntryType.values))
def test_db_constraint_covers_every_entry_type_choice(entry_type):
    """Drift-guard (16.6d's chk_notification_kind pattern): every declared
    EntryType choice must round-trip through .objects.create() without
    hitting the DB CheckConstraint."""
    event = make_event("OBJ-JOURNAL-9")

    JournalEntry.objects.create(event=event, entry_type=entry_type, text="x")
