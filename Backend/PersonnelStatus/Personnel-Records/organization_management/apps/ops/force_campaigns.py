"""Общий пул и распределение сил между несколькими ОМ (Plane №978)."""
from django.db import transaction
from django.utils import timezone

from organization_management.apps.operations.models_forces import (
    OpsForceCampaign,
    OpsForceCampaignAssignment,
    OpsForceCampaignEvent,
    OpsForceCampaignHandover,
    OpsForceCampaignPoolMember,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops.security_events import _not_found, _validation


def _event_row(event):
    return {
        "eventId": str(event.pk),
        "code": event.code,
        "title": event.title,
        "businessDate": event.business_date.isoformat(),
        "businessDateEnd": (
            event.business_date_end.isoformat() if event.business_date_end else None
        ),
        "eventTime": event.event_time.isoformat() if event.event_time else None,
        "visitObjects": [
            {"visitObjectId": str(visit.pk), "objectName": visit.object_name}
            for visit in event.visit_objects.all()
        ],
        "demandRows": event.demand_rows or [],
    }


def _pool(campaign):
    persisted = list(campaign.pool_members.order_by("created_at", "pk"))
    if persisted:
        return [
            {
                "employeeId": row.employee_key,
                "employeeName": row.employee_name,
                "sourceEventIds": row.source_event_ids,
            }
            for row in persisted
        ]
    rows = {}
    for link in campaign.campaign_events.select_related("event").order_by(
        "event__business_date", "event__code"
    ):
        for member in link.event.force_roster or []:
            employee_id = str(member.get("employeeId") or "").strip()
            if not employee_id:
                continue
            row = rows.setdefault(
                employee_id,
                {
                    "employeeId": employee_id,
                    "employeeName": str(
                        member.get("employeeName") or member.get("name") or ""
                    ),
                    "sourceEventIds": [],
                },
            )
            row["sourceEventIds"].append(str(link.event_id))
    return list(rows.values())


def campaign_detail(campaign):
    links = list(
        campaign.campaign_events.select_related("event").order_by(
            "event__business_date", "event__code"
        )
    )
    return {
        "id": str(campaign.pk),
        "code": campaign.code,
        "title": campaign.title,
        "status": campaign.status,
        "events": [_event_row(link.event) for link in links],
        "pool": _pool(campaign),
        "assignments": [
            {
                "id": str(row.pk),
                "employeeId": row.employee_key,
                "employeeName": row.employee_name,
                "eventId": str(row.event_id),
                "visitObjectId": str(row.visit_object_id),
                "demandRowId": row.demand_row_id,
                "kindCode": row.kind_code,
                "overrideReason": row.override_reason,
            }
            for row in campaign.assignments.select_related("event", "visit_object")
        ],
        "warnings": [
            {
                "eventId": str(link.event_id),
                "message": (
                    f"У {link.event.code} не указано время — точное перекрытие "
                    "назначений проверить нельзя."
                ),
            }
            for link in links
            if link.event.event_time is None
        ],
    }


def list_campaigns():
    return {
        "results": [
            campaign_detail(campaign)
            for campaign in OpsForceCampaign.objects.prefetch_related(
                "campaign_events__event"
            )
        ]
    }


def get_campaign(campaign_id):
    campaign = (
        OpsForceCampaign.objects.prefetch_related("campaign_events__event")
        .filter(pk=campaign_id)
        .first()
        if str(campaign_id).isdigit()
        else None
    )
    if campaign is None:
        raise _not_found("Распределение сил не найдено.", campaign_id)
    return campaign_detail(campaign)


@transaction.atomic
def hand_over(campaign_id, *, comment, actor):
    campaign = (
        OpsForceCampaign.objects.select_for_update().filter(pk=campaign_id).first()
        if str(campaign_id).isdigit()
        else None
    )
    if campaign is None:
        raise _not_found("Распределение сил не найдено.", campaign_id)
    if campaign.status == OpsForceCampaign.Status.HANDED_OVER:
        raise DomainError(
            "FORCE_CAMPAIGN_HANDED_OVER",
            422,
            message="Распределение уже передано в расстановку.",
        )
    assignments = list(
        campaign.assignments.select_related("event", "visit_object").order_by(
            "created_at", "pk"
        )
    )
    if not assignments:
        raise _validation({"assignments": ["Сначала распределите сотрудников."]})
    pool_ids = {row["employeeId"] for row in _pool(campaign)}
    assigned_ids = {row.employee_key for row in assignments}
    clean_comment = str(comment or "").strip()
    if pool_ids - assigned_ids and not clean_comment:
        raise _validation(
            {"comment": ["При неполном распределении укажите причину передачи."]}
        )
    by_event = {}
    for assignment in assignments:
        by_event.setdefault(assignment.event_id, []).append(assignment)
    now = timezone.now().isoformat()
    actor_key = str(actor or "")
    handovers = []
    for event_id, rows in by_event.items():
        event = rows[0].event
        if event.force_handover:
            raise DomainError(
                "FORCE_HANDED_OVER",
                422,
                message=f"Состав {event.code} уже передан в расстановку.",
            )
        event.force_roster = [
            {
                "employeeId": row.employee_key,
                "employeeName": row.employee_name,
                "visitObjectId": str(row.visit_object_id),
                "demandRowId": row.demand_row_id,
                "campaignAssignmentId": str(row.pk),
            }
            for row in rows
        ]
        event.force_handover = {
            "at": now,
            "by": actor_key,
            "comment": clean_comment,
            "campaignId": str(campaign.pk),
        }
        event.save(update_fields=["force_roster", "force_handover", "updated_at"])
        handovers.append(
            OpsForceCampaignHandover(
                campaign=campaign,
                event=event,
                comment=clean_comment,
                handed_by=actor_key,
            )
        )
    OpsForceCampaignHandover.objects.bulk_create(handovers)
    campaign.status = OpsForceCampaign.Status.HANDED_OVER
    campaign.save(update_fields=["status", "updated_at"])
    return campaign_detail(campaign)


@transaction.atomic
def create_campaign(*, title, event_ids, actor):
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    clean_title = str(title or "").strip()
    if not clean_title:
        raise _validation({"title": ["Укажите название распределения."]})
    clean_ids = list(dict.fromkeys(str(value).strip() for value in (event_ids or []) if value))
    events = list(OpsSecurityEvent.objects.filter(pk__in=clean_ids))
    if not clean_ids:
        raise _validation({"eventIds": ["Выберите хотя бы одно мероприятие."]})
    found = {str(event.pk) for event in events}
    missing = [value for value in clean_ids if value not in found]
    if missing:
        raise _not_found("Мероприятие не найдено.", missing[0])
    campaign = OpsForceCampaign.objects.create(title=clean_title, created_by=str(actor or ""))
    campaign.code = f"РМ-{campaign.created_at.year}-{campaign.pk:04d}"
    campaign.save(update_fields=["code", "updated_at"])
    OpsForceCampaignEvent.objects.bulk_create(
        [OpsForceCampaignEvent(campaign=campaign, event=event) for event in events]
    )
    pool = _pool(campaign)
    from organization_management.apps.employees.models import Employee

    employees = {
        str(row.pk): row
        for row in Employee.objects.filter(pk__in=[row["employeeId"] for row in pool])
    }
    OpsForceCampaignPoolMember.objects.bulk_create(
        [
            OpsForceCampaignPoolMember(
                campaign=campaign,
                employee=employees.get(row["employeeId"]),
                employee_key=row["employeeId"],
                employee_name=row["employeeName"],
                source_event_ids=row["sourceEventIds"],
            )
            for row in pool
        ]
    )
    return campaign_detail(campaign)


@transaction.atomic
def assign_employee(
    campaign_id,
    *,
    employee_id,
    event_id,
    visit_object_id,
    demand_row_id,
    actor,
    override_conflict=False,
    override_reason="",
):
    campaign = (
        OpsForceCampaign.objects.select_for_update().filter(pk=campaign_id).first()
        if str(campaign_id).isdigit()
        else None
    )
    if campaign is None:
        raise _not_found("Распределение сил не найдено.", campaign_id)
    if campaign.status == OpsForceCampaign.Status.HANDED_OVER:
        raise DomainError(
            "FORCE_CAMPAIGN_HANDED_OVER",
            422,
            message="Распределение уже передано в расстановку.",
        )
    employee_key = str(employee_id or "").strip()
    event_key = str(event_id or "").strip()
    visit_key = str(visit_object_id or "").strip()
    demand_key = str(demand_row_id or "").strip()
    errors = {}
    for key, value, message in (
        ("employeeId", employee_key, "Выберите сотрудника."),
        ("eventId", event_key, "Выберите мероприятие."),
        ("visitObjectId", visit_key, "Выберите объект посещения."),
        ("demandRowId", demand_key, "Выберите строку потребности."),
    ):
        if not value:
            errors[key] = [message]
    if errors:
        raise _validation(errors)
    pool = {row["employeeId"]: row for row in _pool(campaign)}
    if employee_key not in pool:
        raise _validation({"employeeId": ["Сотрудник не входит в общий пул."]})
    link = campaign.campaign_events.select_related("event").filter(event_id=event_key).first()
    if link is None:
        raise _validation({"eventId": ["Мероприятие не входит в распределение."]})
    visit = link.event.visit_objects.filter(pk=visit_key).first()
    if visit is None:
        raise _validation({"visitObjectId": ["Объект не принадлежит мероприятию."]})
    demand = next(
        (row for row in (link.event.demand_rows or []) if str(row.get("id")) == demand_key),
        None,
    )
    if demand is None:
        raise _validation({"demandRowId": ["Строка не принадлежит мероприятию."]})
    if str(demand.get("visitObjectId") or "") != visit_key:
        raise _validation({"demandRowId": ["Строка относится к другому объекту."]})
    target_start = link.event.business_date
    target_end = link.event.business_date_end or target_start
    conflicts = []
    for existing in campaign.assignments.select_related("event").filter(
        employee_key=employee_key
    ):
        existing_start = existing.event.business_date
        existing_end = existing.event.business_date_end or existing_start
        if existing_start <= target_end and target_start <= existing_end:
            conflicts.append(
                {
                    "assignmentId": str(existing.pk),
                    "eventId": str(existing.event_id),
                    "eventCode": existing.event.code,
                }
            )
    clean_reason = str(override_reason or "").strip()
    if conflicts and not override_conflict:
        raise DomainError(
            "FORCE_CAMPAIGN_TIME_CONFLICT",
            422,
            detail={"conflicts": conflicts},
            message="Сотрудник уже назначен на пересекающееся мероприятие.",
        )
    if conflicts and not clean_reason:
        raise _validation(
            {"overrideReason": ["Для назначения с конфликтом укажите причину."]}
        )
    from organization_management.apps.employees.models import Employee

    OpsForceCampaignAssignment.objects.create(
        campaign=campaign,
        employee=Employee.objects.filter(pk=employee_key).first(),
        employee_key=employee_key,
        employee_name=pool[employee_key]["employeeName"],
        event=link.event,
        visit_object=visit,
        demand_row_id=demand_key,
        kind_code=str(demand.get("kindCode") or "PHYSICAL_SQUAD"),
        override_reason=clean_reason,
        assigned_by=str(actor or ""),
    )
    if campaign.status != OpsForceCampaign.Status.DISTRIBUTING:
        campaign.status = OpsForceCampaign.Status.DISTRIBUTING
        campaign.save(update_fields=["status", "updated_at"])
    return campaign_detail(campaign)
