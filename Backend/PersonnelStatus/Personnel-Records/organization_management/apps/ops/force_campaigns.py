"""Общий пул и распределение сил между несколькими ОМ (Plane №978)."""
import datetime as dt
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
from organization_management.apps.ops.security_events import (
    _not_found,
    _validation,
    published_visit_ids,
)


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
    """Общий пул = сохранённые резервисты ∪ составы ОМ кампании (живьём).

    🔴 Раньше при ЛЮБОМ сохранённом резервисте пул читался только из
    таблицы, а составы ОМ игнорировались (Plane №1250, проходка №1142):
    кампанию Штаб заводит ДО того, как департамент присылает список, и
    участник специальной группы — он попадает не в резерв, а в состав ОМ
    через «Отправить список в штаб» — в пул не входил вовсе: Штаб не мог
    выбрать ему объект и строку потребности (`[ОМ-РШ-10]`), а пост группы
    оставался «недобор 1» навсегда. Дубли сводятся по сотруднику, сохранённая
    строка первее; вид и специальность приходят из состава.
    """
    rows = {}
    for row in campaign.pool_members.filter(removed_at__isnull=True).order_by("created_at", "pk"):
        rows[row.employee_key] = {
            "employeeId": row.employee_key,
            "employeeName": row.employee_name,
            "kindCode": row.kind_code,
            "roleCode": "",
            "sourceEventIds": list(row.source_event_ids or []),
        }
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
                    "kindCode": str(member.get("kindCode") or "PHYSICAL_SQUAD"),
                    "roleCode": str(member.get("roleCode") or ""),
                    "sourceEventIds": [],
                },
            )
            if str(link.event_id) not in row["sourceEventIds"]:
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


def list_reserves(allowed_division_ids):
    """Нераспределённый резерв кампаний в области читателя статусов."""
    from organization_management.apps.staff_unit.models import StaffUnit

    rows = list(
        OpsForceCampaignPoolMember.objects.select_related("campaign")
        .filter(
            removed_at__isnull=True,
            campaign__status__in=(
                OpsForceCampaign.Status.DRAFT,
                OpsForceCampaign.Status.GATHERING,
                OpsForceCampaign.Status.DISTRIBUTING,
            )
        )
        .order_by("created_at", "pk")
    )
    assigned = set(
        OpsForceCampaignAssignment.objects.filter(
            campaign_id__in={row.campaign_id for row in rows}
        ).values_list("campaign_id", "employee_key")
    )
    divisions = dict(
        StaffUnit.objects.filter(employee_id__in=[row.employee_id for row in rows])
        .exclude(employee_id__isnull=True)
        .values_list("employee_id", "division_id")
    )
    return {
        "results": [
            {
                "employeeId": row.employee_key,
                "employeeName": row.employee_name,
                "campaignId": str(row.campaign_id),
                "campaignCode": row.campaign.code,
                "campaignTitle": row.campaign.title,
                "kindCode": row.kind_code,
            }
            for row in rows
            if (row.campaign_id, row.employee_key) not in assigned
            and (
                allowed_division_ids is None
                or divisions.get(row.employee_id) in allowed_division_ids
            )
        ]
    }


def reserve_counts_by_division(allowed_division_ids):
    """Число нераспределённых сотрудников пула для справки в расходе."""
    from organization_management.apps.staff_unit.models import StaffUnit

    visible = list_reserves(allowed_division_ids)["results"]
    employee_ids = [row["employeeId"] for row in visible]
    counts = {}
    for division_id in StaffUnit.objects.filter(
        employee_id__in=employee_ids
    ).values_list("division_id", flat=True):
        counts[division_id] = counts.get(division_id, 0) + 1
    return counts


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
    # Validate every campaign event before writing any handover, including
    # events that have no assignments at all. A shortage may be explained,
    # but a published object with demand cannot enter placement empty.
    for link in campaign.campaign_events.select_related("event"):
        event = link.event
        published = published_visit_ids(event)
        for visit in event.visit_objects.all():
            if published is not None and str(visit.pk) not in published:
                continue
            demands = [
                row for row in (event.demand_rows or [])
                if str(row.get("visitObjectId") or "") == str(visit.pk)
            ]
            if sum(int(row.get("need") or 0) for row in demands) <= 0:
                continue
            demand_ids = {str(row.get("id") or "") for row in demands}
            if not any(
                row.visit_object_id == visit.pk and row.demand_row_id in demand_ids
                for row in by_event.get(event.pk, [])
            ):
                raise DomainError(
                    "FORCE_VISIT_UNSTAFFED", 422,
                    message=(f"{event.code}: объект «{visit.object_name}» не укомплектован. "
                             "Назначьте хотя бы одного сотрудника перед передачей в расстановку."),
                )
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
        published = published_visit_ids(event)
        if published is not None and event.visit_objects.exclude(pk__in=published).exists():
            raise DomainError(
                "FORCE_OBJECTS_NOT_READY",
                422,
                message=(
                    f"Состав {event.code} можно передать после завершения "
                    "рекогносцировки всех объектов."
                ),
            )
        pool_rows = {row["employeeId"]: row for row in _pool(campaign)}
        event.force_roster = [
            {
                "employeeId": row.employee_key,
                "employeeName": row.employee_name,
                "visitObjectId": str(row.visit_object_id),
                "demandRowId": row.demand_row_id,
                "campaignAssignmentId": str(row.pk),
                # Вид и специальность едут в состав: расстановка объекта
                # должна отличать группу от физнаряда (Plane №1250).
                "kindCode": row.kind_code or "PHYSICAL_SQUAD",
                "roleCode": str(pool_rows.get(row.employee_key, {}).get("roleCode") or ""),
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
                kind_code=row["kindCode"],
                source_event_ids=row["sourceEventIds"],
            )
            for row in pool
        ]
    )
    return campaign_detail(campaign)


@transaction.atomic
def add_reserve_member(*, event, allocation_id, employee, actor):
    """Записать физнаряд в общий резерв, не создавая финальный статус ОМ."""
    from organization_management.apps.ops.security_events import (
        _employee_division,
        _find_allocation,
        lock_event,
        personnel_display_name,
    )

    event = lock_event(event.pk)
    _find_allocation(event, allocation_id)
    campaign_ids = list(
        OpsForceCampaign.objects.filter(
            campaign_events__event=event,
            status__in=(
                OpsForceCampaign.Status.DRAFT,
                OpsForceCampaign.Status.GATHERING,
                OpsForceCampaign.Status.DISTRIBUTING,
            ),
        )
        .values_list("pk", flat=True)
        .distinct()
    )
    campaigns = list(
        OpsForceCampaign.objects.select_for_update().filter(pk__in=campaign_ids)
    )
    if not campaigns:
        message = "Для мероприятия не создано активное распределение сил."
        raise _validation(
            {"campaign": [message]}, message=message
        )
    if len(campaigns) != 1:
        message = "Мероприятие входит более чем в одно активное распределение."
        raise _validation(
            {"campaign": [message]}, message=message
        )
    campaign = campaigns[0]
    employee_key = str(employee.pk)
    if campaign.pool_members.filter(
        employee_key=employee_key, removed_at__isnull=True
    ).exists():
        raise DomainError(
            "DOUBLE_ASSIGNMENT",
            422,
            message="Сотрудник уже находится в общем резерве.",
        )
    employee_name = personnel_display_name(employee)
    row = OpsForceCampaignPoolMember.objects.create(
        campaign=campaign,
        employee=employee,
        employee_key=employee_key,
        employee_name=employee_name,
        kind_code="PHYSICAL_SQUAD",
        source_allocation_id=str(allocation_id),
        source_event_ids=[str(event.pk)],
    )
    if campaign.status == OpsForceCampaign.Status.DRAFT:
        campaign.status = OpsForceCampaign.Status.GATHERING
        campaign.save(update_fields=["status", "updated_at"])
    division_id, division_name = _employee_division(employee)
    member = {
        "employeeId": employee_key,
        "name": employee_name,
        "divisionId": division_id,
        "divisionName": division_name,
        "addedAt": row.created_at.isoformat(),
        "reserveCampaignId": str(row.campaign_id),
        "kindCode": row.kind_code,
    }
    event.force_allocation = [
        {**item, "members": [*item.get("members", []), member]}
        if item.get("id") == allocation_id
        else item
        for item in event.force_allocation
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    return row


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
    # Вид участия человека и вид строки должны совпадать (`[ОМ-РШ-08]`,
    # `[ОМ-РШ-10]`): физнаряд не закрывает пост группы, группа не закрывает
    # квоту физнаряда. Иначе Штаб «укомплектовал» бы КПП охранником.
    member_kind = str(pool[employee_key].get("kindCode") or "PHYSICAL_SQUAD")
    demand_kind = str(demand.get("kindCode") or "PHYSICAL_SQUAD")
    if member_kind != demand_kind:
        raise DomainError(
            "FORCE_CAMPAIGN_KIND_MISMATCH",
            422,
            detail={"employeeKind": member_kind, "demandKind": demand_kind},
            message=(
                "Вид участия сотрудника не совпадает со строкой потребности: "
                f"«{member_kind}» нельзя назначить на строку «{demand_kind}»."
            ),
        )
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

    assignment = OpsForceCampaignAssignment.objects.create(
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
    # Финальный статус появляется только теперь: Штаб назвал конкретное ОМ,
    # его даты и вид потребности. До этого сотрудник существует только в
    # отдельном пуле кампании (Plane №977).
    from organization_management.apps.operations import status_service
    from organization_management.apps.ops.security_events import ASSIGNMENT_STATUS_CODE

    status_service.create_status(
        employee_id=employee_key,
        status_type_code=ASSIGNMENT_STATUS_CODE,
        date_start=link.event.business_date,
        date_end=(link.event.business_date_end or link.event.business_date)
        + dt.timedelta(days=1),
        actor=actor,
        comment=f"Распределено Штабом на мероприятие {link.event.code}",
        source_ref=f"force-campaign-assignment:{assignment.pk}",
        participations=[
            {
                "event_id": link.event.pk,
                "kind_code": assignment.kind_code,
            }
        ],
        system_participations=True,
        override=bool(override_conflict),
        override_reason=clean_reason,
    )
    if campaign.status != OpsForceCampaign.Status.DISTRIBUTING:
        campaign.status = OpsForceCampaign.Status.DISTRIBUTING
        campaign.save(update_fields=["status", "updated_at"])
    return campaign_detail(campaign)
