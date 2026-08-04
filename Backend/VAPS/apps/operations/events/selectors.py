"""Story 17.2 (FR-29): read-only channel for "Инцидент попадает в историю
ОМ, Паспорт Объекта и карточки участников" — NO write-path exists on
either ``ObjectPassport`` or ``Employee`` for incidents (research
confirmed neither model has an incident-log field in the donor schema);
callers (Story 17.7+ screens) join through these selectors instead.
Mirrors ``StatusTypeSelector``/``EmployeeStatusSelector``
(``apps.operations.statuses.selectors``) — plain classes, ``@staticmethod``
queries, one bulk query per method.
"""

from apps.operations.events.models import JournalEntry


class JournalEntrySelector:
    """Read-only incident lookups — the ONLY data channel for "Паспорт
    Объекта"/"карточки участников" until a dedicated screen (17.7+) needs
    something richer than a flat queryset."""

    @staticmethod
    def incidents_for_object(object_id):
        """All INCIDENT entries whose event belongs to the given Object,
        chronological (Meta.ordering) — the "история ОМ" surfaced per
        Object, i.e. what "Паспорт Объекта" needs."""
        return JournalEntry.objects.filter(
            entry_type=JournalEntry.EntryType.INCIDENT,
            event__object_id=object_id,
        )

    @staticmethod
    def incidents_for_participant(employee_id):
        """All INCIDENT entries naming this employee in participant_ids —
        the "карточка участника" read. participant_ids stores string UUIDs
        (JSONField can't serialize uuid.UUID directly), so the lookup value
        is stringified the same way create_journal_entry() stores it."""
        return JournalEntry.objects.filter(
            entry_type=JournalEntry.EntryType.INCIDENT,
            participant_ids__contains=[str(employee_id)],
        )
