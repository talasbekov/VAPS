"""Story 17.2 (FR-29): read-only channel for "Инцидент попадает в историю
ОМ, Паспорт Объекта и карточки участников" — NO write-path exists on
either ``ObjectPassport`` or ``Employee`` for incidents (research
confirmed neither model has an incident-log field in the donor schema);
callers (Story 17.7+ screens) join through these selectors instead.
Mirrors ``StatusTypeSelector``/``EmployeeStatusSelector``
(``apps.operations.statuses.selectors``) — plain classes, ``@staticmethod``
queries, one bulk query per method.
"""

from apps.core.exceptions import DomainError
from apps.core.selectors import CoreEmployeeSelector
from apps.operations.events.models import JournalEntry, SecurityEvent
from apps.operations.statuses.models import StatusType
from apps.operations.statuses.selectors import EmployeeStatusSelector


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


def find_replacement_candidates(division_id, on_date, exclude_employee_ids):
    """Story 17.5 (FR-31): "следующий по штатной цепочке внутри
    управления/департамента" — буквальное переиспользование
    `CoreEmployeeSelector.active_in_division()`'s канонического
    roster-порядка (FR-5, Story 2.6), не новый алгоритм. Первый элемент
    возвращённого списка — "следующий по штатной цепочке".

    Исключает: `exclude_employee_ids` (сам выбывший + уже занятые в
    текущей версии) И сотрудников с hard-block статусом
    (`StatusType.is_hard_block`) на `on_date`.
    """
    roster = CoreEmployeeSelector.active_in_division(division_id)
    exclude = set(exclude_employee_ids)
    candidates = [e for e in roster if e.id not in exclude]
    if not candidates:
        return []
    hard_block_codes = set(
        StatusType.objects.filter(is_hard_block=True).values_list("code", flat=True)
    )
    if not hard_block_codes:
        return candidates
    blocked_ids = {
        row["employee_id"]
        for row in EmployeeStatusSelector.overlapping_on(
            on_date, employee_ids=[e.id for e in candidates]
        )
        if row["status_type_code"] in hard_block_codes
    }
    return [e for e in candidates if e.id not in blocked_ids]


class SecurityEventArchiveSelector:
    """Story 18.2 (FR-30): read-only aggregation of a CLOSED event's full
    history — every sub-history already lives on `SecurityEvent`'s
    related models (18.1's `closure_summaries` included); this is a join,
    not a new table. Plain-dict return (not a DRF serializer — that's
    18.6's API-layer concern, not guaranteed JSON-primitive here)."""

    @staticmethod
    def full_history(event):
        if event.status_code != SecurityEvent.StatusCode.CLOSED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Архив доступен только для закрытого события.",
            )
        current_version = event.assignment_versions.filter(is_current=True).first()
        return {
            "event": event,
            "checklist_items": list(event.checklist_items.all()),
            "sector_posts": list(event.sector_posts.all()),
            "staffing_demands": list(event.staffing_demands.all()),
            "journal_entries": list(event.journal_entries.all()),
            "closure_summaries": list(event.closure_summaries.all()),
            "current_assignment_version": current_version,
        }
