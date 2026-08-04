"""Story 17.1/17.2 (FR-29) — журнал штаба: create_journal_entry()
(BRIEFING/DIRECTIVE — 17.1; INCIDENT + post/participant_ids/
photo_attachment_id — 17.2), gated by
SecurityEvent.status_code == IN_PROGRESS."""

import uuid

from django.db import IntegrityError

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import JournalEntry, SecurityEvent
from apps.operations.events.services import create_journal_entry
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code, status_code=SecurityEvent.StatusCode.IN_PROGRESS):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_post(obj, code="POST-1"):
    return Post.objects.create(object=obj, code=code, name="Пост")


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


def test_create_incident_with_post_participants_and_photo():
    event = make_event("OBJ-JOURNAL-5")
    post = make_post(event.object)
    participant = uuid.uuid4()

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="Нарушение пропускного режима",
        post=post,
        participant_ids=[participant],
        photo_attachment_id=uuid.uuid4(),
    )

    assert entry.entry_type == "INCIDENT"
    assert entry.post_id == post.pk
    assert entry.participant_ids == [str(participant)]
    assert entry.photo_attachment_id is not None


def test_create_incident_without_participants_or_photo_is_valid():
    """AC-3: neither participants nor photo are required for an Incident."""
    event = make_event("OBJ-JOURNAL-5b")
    post = make_post(event.object)

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.INCIDENT,
        text="Неисправность оборудования",
        post=post,
    )

    assert entry.participant_ids == []
    assert entry.photo_attachment_id is None


def test_create_incident_without_post_is_rejected():
    event = make_event("OBJ-JOURNAL-5c")

    with pytest.raises(DomainError):
        create_journal_entry(
            event,
            actor="staff-1",
            entry_type=JournalEntry.EntryType.INCIDENT,
            text="x",
        )

    assert not JournalEntry.objects.filter(event=event).exists()


def test_create_briefing_ignores_incident_only_params():
    """post/participant_ids/photo_attachment_id passed to a BRIEFING are
    silently dropped, not written — the CheckConstraint requires post IS
    NULL for non-INCIDENT rows."""
    event = make_event("OBJ-JOURNAL-5d")
    post = make_post(event.object)

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.BRIEFING,
        text="x",
        post=post,
        participant_ids=[uuid.uuid4()],
        photo_attachment_id=uuid.uuid4(),
    )

    assert entry.post_id is None
    assert entry.participant_ids == []
    assert entry.photo_attachment_id is None


def test_create_directive_ignores_incident_only_params():
    """review (Blind Hunter): the BRIEFING variant above didn't cover
    DIRECTIVE's identical ignore-path directly."""
    event = make_event("OBJ-JOURNAL-5e")
    post = make_post(event.object)

    entry = create_journal_entry(
        event,
        actor="staff-1",
        entry_type=JournalEntry.EntryType.DIRECTIVE,
        text="x",
        post=post,
        participant_ids=[uuid.uuid4()],
        photo_attachment_id=uuid.uuid4(),
    )

    assert entry.post_id is None
    assert entry.participant_ids == []
    assert entry.photo_attachment_id is None


def test_create_incident_rejects_post_from_a_different_object():
    """review (Blind Hunter + Edge Case Hunter, independently confirmed):
    буквальный образец PlacementAssignment.clean() (16.x) — post обязан
    принадлежать тому же объекту, что событие."""
    event = make_event("OBJ-JOURNAL-5f")
    other_obj = FacilityObject.objects.create(
        code="OBJ-JOURNAL-5f-OTHER", name="Штаб", address="г. Кызылорда"
    )
    foreign_post = make_post(other_obj, code="POST-FOREIGN")

    with pytest.raises(DomainError):
        create_journal_entry(
            event,
            actor="staff-1",
            entry_type=JournalEntry.EntryType.INCIDENT,
            text="x",
            post=foreign_post,
        )

    assert not JournalEntry.objects.filter(event=event).exists()


def test_create_writes_audit_row():
    event = make_event("OBJ-JOURNAL-6")

    entry = create_journal_entry(
        event, actor="staff-1", entry_type=JournalEntry.EntryType.BRIEFING, text="x"
    )

    audit = AuditLog.objects.get(action="JOURNAL_ENTRY_CREATED")
    assert audit.entity_type == "security_event"
    assert audit.entity_id == uuid.UUID(int=event.pk)
    assert audit.new_value["entry_id"] == entry.pk


def test_create_requires_actor():
    event = make_event("OBJ-JOURNAL-7")

    with pytest.raises(DomainError):
        create_journal_entry(
            event, actor="", entry_type=JournalEntry.EntryType.BRIEFING, text="x"
        )


def test_create_rejects_actor_over_100_chars():
    """review (Edge Case Hunter): created_by is CharField(max_length=100) —
    reject before the DB truncates/errors mid-transaction."""
    event = make_event("OBJ-JOURNAL-10")

    with pytest.raises(DomainError):
        create_journal_entry(
            event,
            actor="x" * 101,
            entry_type=JournalEntry.EntryType.BRIEFING,
            text="x",
        )

    assert not JournalEntry.objects.filter(event=event).exists()


@pytest.mark.parametrize("blank_text", ["", "   ", "\n\t"])
def test_create_rejects_blank_text(blank_text):
    """review (Blind Hunter + Edge Case Hunter, independently confirmed):
    an empty/whitespace-only entry in an append-only journal is
    unrecoverable noise."""
    event = make_event("OBJ-JOURNAL-11")

    with pytest.raises(DomainError):
        create_journal_entry(
            event,
            actor="staff-1",
            entry_type=JournalEntry.EntryType.BRIEFING,
            text=blank_text,
        )

    assert not JournalEntry.objects.filter(event=event).exists()


def test_db_constraint_rejects_entry_type_outside_choices():
    event = make_event("OBJ-JOURNAL-8")

    with pytest.raises(IntegrityError):
        JournalEntry.objects.create(event=event, entry_type="BOGUS", text="x")


@pytest.mark.parametrize("entry_type", list(JournalEntry.EntryType.values))
def test_db_constraint_covers_every_entry_type_choice(entry_type):
    """Drift-guard (16.6d's chk_notification_kind pattern): every declared
    EntryType choice must round-trip through .objects.create() without
    hitting the DB CheckConstraint (INCIDENT additionally requires post —
    ck_journal_entry_incident_requires_post)."""
    event = make_event("OBJ-JOURNAL-9")
    post = (
        make_post(event.object, code=f"POST-{entry_type}")
        if entry_type == JournalEntry.EntryType.INCIDENT
        else None
    )

    JournalEntry.objects.create(event=event, entry_type=entry_type, text="x", post=post)


def test_db_constraint_rejects_incident_without_post():
    """AC-7: direct .objects.create() bypassing the service still hits the
    DB CheckConstraint."""
    event = make_event("OBJ-JOURNAL-12")

    with pytest.raises(IntegrityError):
        JournalEntry.objects.create(
            event=event, entry_type="INCIDENT", text="x", post=None
        )


def test_db_constraint_rejects_non_incident_with_post():
    """The asymmetric half of ck_journal_entry_incident_requires_post:
    BRIEFING/DIRECTIVE must have post NULL, even bypassing the service."""
    event = make_event("OBJ-JOURNAL-13")
    post = make_post(event.object)

    with pytest.raises(IntegrityError):
        JournalEntry.objects.create(
            event=event, entry_type="BRIEFING", text="x", post=post
        )
