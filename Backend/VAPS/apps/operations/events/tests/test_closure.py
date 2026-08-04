"""Story 18.1 (FR-30) — start_security_event() (APPROVED->IN_PROGRESS,
missing link between 16.x approve and Epic 17's journal/amend) and
close_security_event() (IN_PROGRESS->CLOSED, requires a summary per
distinct SecurityEventSectorPost.sector)."""

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    SecurityEvent,
    SecurityEventClosureSummary,
    SecurityEventSectorPost,
)
from apps.operations.events.services import close_security_event, start_security_event
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_event(code, status_code=SecurityEvent.StatusCode.APPROVED):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_sector_post(event, sector, code="POST-1"):
    return SecurityEventSectorPost.objects.create(event=event, sector=sector, post=code)


# --- start_security_event() ---


def test_start_transitions_approved_to_in_progress():
    event = make_event("OBJ-START-1")

    started = start_security_event(event, actor="staff-1")

    assert started.status_code == "IN_PROGRESS"
    assert AuditLog.objects.filter(
        action="SECURITY_EVENT_STARTED", entity_type="security_event"
    ).exists()


def test_start_is_idempotent_on_already_in_progress():
    event = make_event("OBJ-START-2", status_code=SecurityEvent.StatusCode.IN_PROGRESS)

    started = start_security_event(event, actor="staff-1")

    assert started.status_code == "IN_PROGRESS"
    assert not AuditLog.objects.filter(action="SECURITY_EVENT_STARTED").exists()


def test_start_rejected_from_wrong_status():
    event = make_event("OBJ-START-3", status_code=SecurityEvent.StatusCode.DRAFT)

    with pytest.raises(DomainError) as exc_info:
        start_security_event(event, actor="staff-1")

    assert exc_info.value.http_status == 422


def test_start_rejected_from_closed():
    """review (Blind Hunter): only DRAFT was tested as a wrong starting
    status — CLOSED (terminal) is a distinct, more consequential case."""
    event = make_event("OBJ-START-4", status_code=SecurityEvent.StatusCode.CLOSED)

    with pytest.raises(DomainError) as exc_info:
        start_security_event(event, actor="staff-1")

    assert exc_info.value.http_status == 422
    event.refresh_from_db()
    assert event.status_code == "CLOSED"


# --- close_security_event() ---


def test_close_succeeds_with_all_sectors_covered():
    event = make_event("OBJ-CLOSE-1", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_sector_post(event, "Север")
    make_sector_post(event, "Юг")

    closed = close_security_event(
        event,
        actor="staff-1",
        summaries=[
            {"sector": "Север", "summary": "Без происшествий."},
            {"sector": "Юг", "summary": "Инцидент устранён."},
        ],
    )

    assert closed.status_code == "CLOSED"
    assert SecurityEventClosureSummary.objects.filter(event=event).count() == 2
    audit_row = AuditLog.objects.get(action="SECURITY_EVENT_CLOSED")
    # review (Acceptance Auditor, мутационно найденный пробел): раньше
    # проверялось только .exists() — пустой/устаревший снимок в new_value
    # прошёл бы незамеченным.
    assert audit_row.new_value["status_code"] == "CLOSED"
    assert sorted(
        row["sector"] for row in audit_row.new_value["closure_summaries"]
    ) == ["Север", "Юг"]


def test_close_rejected_when_sector_missing():
    event = make_event("OBJ-CLOSE-2", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_sector_post(event, "Север")
    make_sector_post(event, "Юг")

    with pytest.raises(DomainError) as exc_info:
        close_security_event(
            event,
            actor="staff-1",
            summaries=[{"sector": "Север", "summary": "Без происшествий."}],
        )

    assert exc_info.value.http_status == 400
    # review (Acceptance Auditor, мутационно найденный пробел): AC-3
    # требует список недостающих секторов в details — раньше не
    # проверялось вовсе.
    assert exc_info.value.detail == {"missing_sectors": ["Юг"]}
    event.refresh_from_db()
    assert event.status_code == "IN_PROGRESS"


def test_close_rejected_when_sector_unknown():
    """review (Blind Hunter + Edge Case Hunter, независимо совпали):
    сектор, которого нет ни у одной sector_posts-строки, молча упсертился
    бы как мусорная запись."""
    event = make_event("OBJ-CLOSE-8", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_sector_post(event, "Север")

    with pytest.raises(DomainError) as exc_info:
        close_security_event(
            event,
            actor="staff-1",
            summaries=[
                {"sector": "Север", "summary": "x"},
                {"sector": "Призрак", "summary": "y"},
            ],
        )

    assert exc_info.value.http_status == 400
    assert exc_info.value.detail == {"unknown_sectors": ["Призрак"]}
    event.refresh_from_db()
    assert event.status_code == "IN_PROGRESS"
    assert not SecurityEventClosureSummary.objects.filter(event=event).exists()


def test_close_rejected_when_sector_duplicated():
    """review (Blind Hunter + Edge Case Hunter, независимо совпали):
    дубликат сектора в одном payload молча перезаписывался бы
    update_or_create без сигнала об ошибке ввода."""
    event = make_event("OBJ-CLOSE-9", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_sector_post(event, "Север")

    with pytest.raises(DomainError) as exc_info:
        close_security_event(
            event,
            actor="staff-1",
            summaries=[
                {"sector": "Север", "summary": "x"},
                {"sector": "Север", "summary": "y"},
            ],
        )

    assert exc_info.value.http_status == 400
    assert exc_info.value.detail == {"duplicate_sector": "Север"}


def test_close_rejected_when_summary_is_blank():
    event = make_event("OBJ-CLOSE-3", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_sector_post(event, "Север")

    with pytest.raises(DomainError) as exc_info:
        close_security_event(
            event, actor="staff-1", summaries=[{"sector": "Север", "summary": "  "}]
        )

    assert exc_info.value.http_status == 400


def test_close_succeeds_with_no_sectors_at_all():
    event = make_event("OBJ-CLOSE-4", status_code=SecurityEvent.StatusCode.IN_PROGRESS)

    closed = close_security_event(event, actor="staff-1", summaries=[])

    assert closed.status_code == "CLOSED"


def test_close_rejected_when_not_in_progress():
    event = make_event("OBJ-CLOSE-5", status_code=SecurityEvent.StatusCode.APPROVED)

    with pytest.raises(DomainError) as exc_info:
        close_security_event(event, actor="staff-1", summaries=[])

    assert exc_info.value.http_status == 422


def test_close_is_not_idempotent_on_already_closed():
    event = make_event("OBJ-CLOSE-6", status_code=SecurityEvent.StatusCode.CLOSED)

    with pytest.raises(DomainError) as exc_info:
        close_security_event(event, actor="staff-1", summaries=[])

    assert exc_info.value.http_status == 422


def test_close_upserts_repeated_sector():
    event = make_event("OBJ-CLOSE-7", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_sector_post(event, "Север")
    SecurityEventClosureSummary.objects.create(
        event=event, sector="Север", summary="Старый черновик."
    )

    close_security_event(
        event, actor="staff-1", summaries=[{"sector": "Север", "summary": "Финал."}]
    )

    row = SecurityEventClosureSummary.objects.get(event=event, sector="Север")
    assert row.summary == "Финал."
    assert SecurityEventClosureSummary.objects.filter(event=event).count() == 1
