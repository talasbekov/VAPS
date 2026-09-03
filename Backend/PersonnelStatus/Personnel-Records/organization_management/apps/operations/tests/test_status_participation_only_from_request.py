"""«Участие в ОМ» только из запроса, колонка «По разделу ОМ», напоминание за
час (Plane №427, `[СТА-04]` `[СБС-32]` `[ОЗН-06]`).
"""
import datetime as dt

import pytest
from django.utils import timezone

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.status_service import create_status
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    make_employee,
    types,  # noqa: F401
)
from organization_management.apps.ops.tests.test_ops_acknowledgement_notify import (  # noqa: F401
    event_with_people,
)

pytestmark = pytest.mark.django_db

TODAY = dt.date(2026, 9, 10)


def _status_type(code):
    from organization_management.apps.operations.models import StatusType

    StatusType.objects.get_or_create(
        code=code,
        defaults={"name": code, "priority": 50, "report_column_code": "IN_SERVICE"},
    )


def test_manual_participation_status_is_refused_but_system_path_passes(types):  # noqa: F811
    _status_type("EVENT_ASSIGNMENT")
    employee = make_employee()
    with pytest.raises(DomainError) as refused:
        create_status(
            employee_id=employee.id, status_type_code="EVENT_ASSIGNMENT",
            date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="test",
        )
    assert refused.value.code == "PARTICIPATION_MANUAL_FORBIDDEN"
    # Системный путь (чекбоксы запроса / выделение штабом) — проходит.
    status = create_status(
        employee_id=employee.id, status_type_code="EVENT_ASSIGNMENT",
        date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="system",
        participations=[], system_participations=True,
    )
    assert status.pk is not None


def test_api_refuses_manual_participation_with_422(types):  # noqa: F811
    _status_type("IN_EVENT")
    employee = make_employee()
    api, _ = client_for("operator", "OPERATOR", perms=("status.manage",))
    resp = api.post(
        "/api/operations/statuses/",
        {"employee_id": employee.id, "status_type_code": "IN_EVENT",
         "date_start": TODAY.isoformat(), "date_end": (TODAY + dt.timedelta(days=1)).isoformat()},
        format="json",
    )
    assert resp.status_code == 422, resp.data
    assert resp.json()["error_code"] == "PARTICIPATION_MANUAL_FORBIDDEN"


def test_section_column_carries_object_post_and_acknowledgement(types, event_with_people):  # noqa: F811
    _status_type("EVENT_ASSIGNMENT")
    event, _account, _boss, unlinked = event_with_people
    from organization_management.apps.operations.models_event import OpsSecurityEventVisitObject

    visit = OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Резиденция", position=1, stage="ACKNOWLEDGEMENT"
    )
    event.recon_sector_posts = [
        {"id": "p-1", "sector": "Периметр", "post": "Пост 1", "visitObjectId": str(visit.pk)}
    ]
    event.placement_assignments = [
        {**row, "acknowledgedAt": "2026-09-01T10:00:00+05:00" if row["id"] == "a-2" else None}
        for row in event.placement_assignments
    ]
    event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    status = create_status(
        employee_id=unlinked.id, status_type_code="EVENT_ASSIGNMENT",
        date_start=event.business_date, date_end=event.business_date + dt.timedelta(days=1), actor="system",
        participations=[{"event_id": event.pk, "kind_code": "PHYSICAL_SQUAD"}],
        system_participations=True,
    )
    api, _ = client_for("viewer", "VIEWER", perms=("status.view",))
    resp = api.get(f"/api/operations/statuses/?employee={unlinked.id}")
    assert resp.status_code == 200, resp.data
    row = next(r for r in resp.json()["results"] if r["id"] == status.pk)
    part = row["participations"][0]
    assert part["event_code"] == event.code
    assert part["visit_object_name"] == "Резиденция"
    assert part["post_label"] == "Периметр · Пост 1"
    assert part["acknowledged_at"] == "2026-09-01T10:00:00+05:00"


def test_supervisors_are_reminded_one_hour_before_start(event_with_people):  # noqa: F811
    from organization_management.apps.ops.acknowledgement_reminders import (
        remind_supervisors_before_start,
    )

    event, _account, boss, _unlinked = event_with_people
    start = timezone.make_aware(dt.datetime.combine(event.business_date, dt.time(8, 0)))
    before = OpsNotification.objects.filter(recipient=str(boss.pk)).count()
    # За два часа — рано.
    early = remind_supervisors_before_start(start - dt.timedelta(hours=2))
    assert early["events"] == 0
    # За 40 минут — в окне: руководитель получает список неподтвердивших.
    report = remind_supervisors_before_start(start - dt.timedelta(minutes=40))
    assert report["events"] == 1 and report["unconfirmed"] == 2
    row = OpsNotification.objects.filter(recipient=str(boss.pk)).latest("id")
    assert OpsNotification.objects.filter(recipient=str(boss.pk)).count() == before + 1
    assert row.payload["oneHourBefore"] is True
    assert len(row.payload["unconfirmed"]) == 2
    # Повтор в то же окно — идемпотентно («одно на день»).
    remind_supervisors_before_start(start - dt.timedelta(minutes=20))
    assert OpsNotification.objects.filter(recipient=str(boss.pk)).count() == before + 1
