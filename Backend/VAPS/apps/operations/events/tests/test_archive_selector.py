"""Story 18.2 (FR-30) — SecurityEventArchiveSelector.full_history(): a
read-only join over a CLOSED event's already-existing sub-histories, not
a new table."""

import pytest

from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    AssignmentVersion,
    JournalEntry,
    PlacementAssignment,
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventClosureSummary,
    SecurityEventSectorPost,
    SecurityEventStaffingDemand,
)
from apps.operations.events.selectors import SecurityEventArchiveSelector
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_event(code, status_code=SecurityEvent.StatusCode.CLOSED):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def test_full_history_aggregates_all_sub_histories():
    event = make_event("OBJ-ARCH-1")
    SecurityEventChecklistItem.objects.create(event=event, label="Проверка периметра")
    SecurityEventSectorPost.objects.create(event=event, sector="Север", post="POST-1")
    SecurityEventStaffingDemand.objects.create(event=event, sector="Север", need=2)
    JournalEntry.objects.create(
        event=event, entry_type=JournalEntry.EntryType.BRIEFING, text="Инструктаж"
    )
    SecurityEventClosureSummary.objects.create(
        event=event, sector="Север", summary="Без происшествий."
    )
    post = Post.objects.create(object=event.object, code="POST-1", name="Пост")
    version = AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.APPROVED,
        version=1,
        is_current=True,
    )
    PlacementAssignment.objects.create(
        version=version, employee_id="11111111-1111-1111-1111-111111111111", post=post
    )

    history = SecurityEventArchiveSelector.full_history(event)

    assert history["event"] == event
    assert len(history["checklist_items"]) == 1
    assert len(history["sector_posts"]) == 1
    assert len(history["staffing_demands"]) == 1
    assert len(history["journal_entries"]) == 1
    assert len(history["closure_summaries"]) == 1
    assert history["current_assignment_version"] == version
    # review (Blind Hunter): only a .count() was asserted before — doesn't
    # rule out a wrong related_name/filter coincidentally matching count.
    assignment_rows = list(history["current_assignment_version"].assignments.all())
    assert len(assignment_rows) == 1
    assert str(assignment_rows[0].employee_id) == "11111111-1111-1111-1111-111111111111"


def test_full_history_returns_empty_lists_when_no_sub_history():
    event = make_event("OBJ-ARCH-2")

    history = SecurityEventArchiveSelector.full_history(event)

    assert history["checklist_items"] == []
    assert history["sector_posts"] == []
    assert history["staffing_demands"] == []
    assert history["journal_entries"] == []
    assert history["closure_summaries"] == []


def test_full_history_current_version_is_none_when_no_versions_exist():
    event = make_event("OBJ-ARCH-3")

    history = SecurityEventArchiveSelector.full_history(event)

    assert history["current_assignment_version"] is None


def test_full_history_rejected_when_not_closed():
    event = make_event("OBJ-ARCH-4", status_code=SecurityEvent.StatusCode.IN_PROGRESS)

    with pytest.raises(DomainError) as exc_info:
        SecurityEventArchiveSelector.full_history(event)

    assert exc_info.value.http_status == 422


def test_full_history_sector_posts_have_stable_order():
    """review (Blind Hunter + Edge Case Hunter, независимо совпали): все
    sub-histories, кроме journal_entries, полагались на недокументированный
    DB-порядок — закрыто явным order_by("id")."""
    event = make_event("OBJ-ARCH-7")
    third = SecurityEventSectorPost.objects.create(
        event=event, sector="Юг", post="POST-3"
    )
    first = SecurityEventSectorPost.objects.create(
        event=event, sector="Север", post="POST-1"
    )
    second = SecurityEventSectorPost.objects.create(
        event=event, sector="Восток", post="POST-2"
    )

    history = SecurityEventArchiveSelector.full_history(event)

    assert [row.id for row in history["sector_posts"]] == sorted(
        [third.id, first.id, second.id]
    )


def test_full_history_journal_entries_are_chronological():
    event = make_event("OBJ-ARCH-5")
    first = JournalEntry.objects.create(
        event=event, entry_type=JournalEntry.EntryType.BRIEFING, text="1"
    )
    second = JournalEntry.objects.create(
        event=event, entry_type=JournalEntry.EntryType.DIRECTIVE, text="2"
    )
    third = JournalEntry.objects.create(
        event=event, entry_type=JournalEntry.EntryType.BRIEFING, text="3"
    )

    history = SecurityEventArchiveSelector.full_history(event)

    assert [e.id for e in history["journal_entries"]] == [
        first.id,
        second.id,
        third.id,
    ]


def test_full_history_current_version_excludes_non_current():
    event = make_event("OBJ-ARCH-6")
    old_version = AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.RETURNED,
        version=1,
        is_current=False,
    )
    current_version = AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.APPROVED,
        version=2,
        is_current=True,
    )

    history = SecurityEventArchiveSelector.full_history(event)

    assert history["current_assignment_version"] == current_version
    assert history["current_assignment_version"] != old_version
