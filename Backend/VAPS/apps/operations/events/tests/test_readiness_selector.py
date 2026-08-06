"""Story 20.1a (FR-38/UC-DASH-001): SecurityEventReadinessSelector.readiness_for()
— 5 независимых булевых блокеров (чек-лист/потребность/расстановка/
ознакомление/конфликты) + равновзвешенный readiness_pct, для будущего
дашборда готовности ОМ (20.1b/c)."""

from django.test.utils import CaptureQueriesContext
from django.db import connection

import pytest

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    SecurityEvent,
    SecurityEventChecklistItem,
)
from apps.operations.events.selectors import SecurityEventReadinessSelector
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db


def make_object(code):
    return FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")


def make_event(obj, status_code=SecurityEvent.StatusCode.DRAFT):
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_version(event, status=AssignmentVersion.Status.APPROVED, is_current=True):
    return AssignmentVersion.objects.create(
        event=event, status=status, version=1, is_current=is_current
    )


def make_assignment(version, employee_id, acknowledged_at=None, conflict_severity=""):
    post = Post.objects.create(
        object=version.event.object,
        code=f"POST-{version.pk}-{employee_id}",
        name="Пост",
    )
    return PlacementAssignment.objects.create(
        version=version,
        employee_id=employee_id,
        post=post,
        acknowledged_at=acknowledged_at,
        conflict_severity=conflict_severity,
    )


# --- checklist ---


def test_empty_checklist_is_vacuously_ready():
    obj = make_object("OBJ-20-1-1")
    event = make_event(obj)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["checklist_ready"] is True


def test_checklist_with_incomplete_item_is_not_ready():
    obj = make_object("OBJ-20-1-2")
    event = make_event(obj)
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт 1", done=True)
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт 2", done=False)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["checklist_ready"] is False


def test_checklist_all_done_is_ready():
    obj = make_object("OBJ-20-1-3")
    event = make_event(obj)
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт 1", done=True)
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт 2", done=True)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["checklist_ready"] is True


# --- demand ---


@pytest.mark.parametrize(
    "status_code",
    [
        SecurityEvent.StatusCode.DRAFT,
        SecurityEvent.StatusCode.BULLETIN,
        SecurityEvent.StatusCode.RECON,
        SecurityEvent.StatusCode.DEMAND,
    ],
)
def test_demand_not_ready_before_brokerage(status_code):
    obj = make_object(f"OBJ-20-1-4-{status_code}")
    event = make_event(obj, status_code=status_code)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["demand_ready"] is False


@pytest.mark.parametrize(
    "status_code",
    [
        SecurityEvent.StatusCode.BROKERAGE,
        SecurityEvent.StatusCode.PLACEMENT,
        SecurityEvent.StatusCode.APPROVED,
        SecurityEvent.StatusCode.IN_PROGRESS,
        SecurityEvent.StatusCode.CLOSED,
    ],
)
def test_demand_ready_from_brokerage_onward(status_code):
    obj = make_object(f"OBJ-20-1-5-{status_code}")
    event = make_event(obj, status_code=status_code)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["demand_ready"] is True


def test_demand_not_ready_when_cancelled():
    # CANCELLED не в блок-листе "не в БРОКЕРИДЖ" по конструкции набора —
    # без явного включения событие отменённое сообщило бы demand_ready=True
    # (blocklist пропускает всё, что не перечислено явно).
    obj = make_object("OBJ-20-1-5-CANCELLED")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.CANCELLED)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["demand_ready"] is False


# --- placement ---


def test_placement_not_ready_without_any_version():
    obj = make_object("OBJ-20-1-6")
    event = make_event(obj)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["placement_ready"] is False


def test_placement_not_ready_when_current_version_not_approved():
    obj = make_object("OBJ-20-1-7")
    event = make_event(obj)
    make_version(event, status=AssignmentVersion.Status.SUBMITTED)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["placement_ready"] is False


def test_placement_ready_when_current_version_approved():
    obj = make_object("OBJ-20-1-8")
    event = make_event(obj)
    make_version(event, status=AssignmentVersion.Status.APPROVED)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["placement_ready"] is True


# --- acknowledgement ---


def test_acknowledgement_vacuously_ready_without_version():
    obj = make_object("OBJ-20-1-9")
    event = make_event(obj)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["acknowledgement_ready"] is True


def test_acknowledgement_vacuously_ready_without_assignments():
    obj = make_object("OBJ-20-1-10")
    event = make_event(obj)
    make_version(event)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["acknowledgement_ready"] is True


def test_acknowledgement_not_ready_when_one_unacknowledged():
    obj = make_object("OBJ-20-1-11")
    event = make_event(obj)
    version = make_version(event)
    make_assignment(
        version,
        "11111111-1111-1111-1111-111111111111",
        acknowledged_at="2026-08-01T00:00:00Z",
    )
    make_assignment(
        version, "22222222-2222-2222-2222-222222222222", acknowledged_at=None
    )

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["acknowledgement_ready"] is False


def test_acknowledgement_ready_when_all_acknowledged():
    obj = make_object("OBJ-20-1-12")
    event = make_event(obj)
    version = make_version(event)
    make_assignment(
        version,
        "11111111-1111-1111-1111-111111111111",
        acknowledged_at="2026-08-01T00:00:00Z",
    )
    make_assignment(
        version,
        "22222222-2222-2222-2222-222222222222",
        acknowledged_at="2026-08-01T00:00:00Z",
    )

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["acknowledgement_ready"] is True


# --- conflicts ---


def test_conflicts_ready_without_assignments():
    obj = make_object("OBJ-20-1-13")
    event = make_event(obj)
    make_version(event)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["conflicts_ready"] is True


def test_conflicts_not_ready_when_one_flagged():
    obj = make_object("OBJ-20-1-14")
    event = make_event(obj)
    version = make_version(event)
    make_assignment(
        version,
        "11111111-1111-1111-1111-111111111111",
        conflict_severity=PlacementAssignment.ConflictSeverity.SOFT,
    )

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["conflicts_ready"] is False


def test_conflicts_ready_when_all_clear():
    obj = make_object("OBJ-20-1-15")
    event = make_event(obj)
    version = make_version(event)
    make_assignment(version, "11111111-1111-1111-1111-111111111111")

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["conflicts_ready"] is True


# --- readiness_pct ---


def test_readiness_pct_all_ready_is_100():
    obj = make_object("OBJ-20-1-16")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.APPROVED)
    make_version(event)

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["readiness_pct"] == 100


def test_readiness_pct_none_ready_is_0():
    # Вырожденные случаи (нет версии → ack/conflicts вырожденно True) не
    # дают достичь 0% — чтобы все 5 блокеров были False, нужна РЕАЛЬНАЯ
    # версия с реальным незакрытым назначением (не отсутствие версии).
    obj = make_object("OBJ-20-1-17")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.DRAFT)
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт", done=False)
    version = make_version(event, status=AssignmentVersion.Status.SUBMITTED)
    make_assignment(
        version,
        "11111111-1111-1111-1111-111111111111",
        acknowledged_at=None,
        conflict_severity=PlacementAssignment.ConflictSeverity.SOFT,
    )

    result = SecurityEventReadinessSelector.readiness_for(event)

    assert result["readiness_pct"] == 0


def test_readiness_pct_three_of_five_is_60():
    obj = make_object("OBJ-20-1-18")
    # demand_ready=True (BROKERAGE+), placement_ready=False (нет версии),
    # checklist_ready=True (пусто), acknowledgement_ready=True (нет версии
    # → вырожденно), conflicts_ready=True (нет версии → вырожденно) — это
    # даёт 4/5, не 3/5. Чтобы получить РОВНО 3/5, добавляем НЕ-APPROVED
    # версию (placement_ready=False, но она делает ack/conflicts ложно
    # проверяемыми против реальных назначений вместо вырожденного случая).
    event = make_event(obj, status_code=SecurityEvent.StatusCode.BROKERAGE)
    version = make_version(event, status=AssignmentVersion.Status.SUBMITTED)
    make_assignment(
        version, "11111111-1111-1111-1111-111111111111", acknowledged_at=None
    )

    result = SecurityEventReadinessSelector.readiness_for(event)

    # demand_ready=True, checklist_ready=True (пусто), placement_ready=False
    # (SUBMITTED), acknowledgement_ready=False (не подтверждено),
    # conflicts_ready=True (пусто) → 3/5 = 60%.
    assert result["readiness_pct"] == 60


# --- query count ---


def test_query_count_bounded():
    obj = make_object("OBJ-20-1-19")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.APPROVED)
    version = make_version(event)
    for i in range(5):
        make_assignment(version, f"1111111{i}-1111-1111-1111-11111111111{i}")
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт", done=True)

    with CaptureQueriesContext(connection) as ctx:
        SecurityEventReadinessSelector.readiness_for(event)

    # Review (Blind Hunter): точное число, не расплывчатый верхний предел
    # — доказывает отсутствие N+1 (5 назначений НЕ дают 5 доп. запросов).
    # checklist_items + assignment_versions(current) + assignments(bulk) = 3.
    assert len(ctx.captured_queries) == 3
