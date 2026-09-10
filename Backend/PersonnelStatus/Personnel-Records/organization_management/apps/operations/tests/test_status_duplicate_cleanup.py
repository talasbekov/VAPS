import datetime as dt

import pytest

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.status_cleanup import (
    find_duplicate_participations,
    purge_duplicate_participations,
)

pytestmark = pytest.mark.django_db


def participation(
    *,
    employee_id=1,
    event_id=100,
    start=dt.date(2026, 9, 10),
    end=dt.date(2026, 9, 11),
    kind="PHYSICAL_SQUAD",
    role="",
):
    status = OpsEmployeeStatus.objects.create(
        employee_id=employee_id,
        status_type_code="IN_EVENT",
        date_start=start,
        date_end=end,
        source=OpsEmployeeStatus.Source.USER,
        created_by="user:old-smoke",
    )
    return OpsStatusParticipation.objects.create(
        status=status,
        event_id=event_id,
        kind_code=kind,
        role_code=role,
        created_by="user:old-smoke",
    )


def test_only_exact_semantic_duplicates_are_found():
    kept = participation()
    duplicate = participation()
    another_day = participation(start=dt.date(2026, 9, 11), end=dt.date(2026, 9, 12))
    another_kind = participation(kind="SCREENING_GROUP", role="SCREENER")
    another_event = participation(event_id=101)

    found = find_duplicate_participations()

    assert found.duplicate_ids == (duplicate.pk,)
    assert found.kept_ids == (kept.pk,)
    assert found.groups == 1
    assert {another_day.pk, another_kind.pk, another_event.pk}.isdisjoint(
        found.duplicate_ids
    )


def test_cleanup_keeps_the_oldest_fact_and_removes_only_emptied_statuses():
    kept = participation()
    duplicate = participation()
    shared_status = OpsEmployeeStatus.objects.create(
        employee_id=1,
        status_type_code="IN_EVENT",
        date_start=dt.date(2026, 9, 10),
        date_end=dt.date(2026, 9, 11),
        source=OpsEmployeeStatus.Source.USER,
        created_by="user:old-smoke",
    )
    duplicate_with_history = OpsStatusParticipation.objects.create(
        status=shared_status,
        event_id=100,
        kind_code="PHYSICAL_SQUAD",
    )
    surviving_history = OpsStatusParticipation.objects.create(
        status=shared_status,
        event_id=777,
        kind_code="PHYSICAL_SQUAD",
    )

    result = purge_duplicate_participations(actor="user:cleanup")

    assert (result.participations, result.statuses, result.groups) == (2, 1, 1)
    assert OpsStatusParticipation.objects.filter(pk=kept.pk).exists()
    assert not OpsStatusParticipation.objects.filter(
        pk__in=[duplicate.pk, duplicate_with_history.pk]
    ).exists()
    assert OpsStatusParticipation.objects.filter(pk=surviving_history.pk).exists()
    assert OpsEmployeeStatus.objects.filter(pk=shared_status.pk).exists()
    assert not OpsEmployeeStatus.objects.filter(pk=duplicate.status_id).exists()

    audit = OpsAuditLog.objects.get(action="STATUS_PARTICIPATIONS_PURGED")
    assert audit.actor_user_id == "user:cleanup"
    assert audit.old_value["reason"] == "exact-duplicate"
    assert audit.old_value["participations"] == 2
    assert audit.old_value["groups"] == 1
