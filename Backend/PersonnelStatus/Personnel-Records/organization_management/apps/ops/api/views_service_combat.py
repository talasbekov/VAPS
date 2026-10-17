"""Service combat duty from canonical statuses and accepted combat submissions."""
from collections import defaultdict

from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from django.db.models import F, Q
from rest_framework import serializers, viewsets
from rest_framework.response import Response

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.api.permissions import RequirePermissionMixin, resolve_actor_id
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_combat import OpsCombatDutyShift
from organization_management.apps.operations.models_status import OpsEmployeeStatus, Secondment
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.status_destination import destinations_for
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.strength_report import StatusCatalog, resolve_status_row
from organization_management.apps.ops.security_events import personnel_full_name


class ServiceCombatQuerySerializer(serializers.Serializer):
    business_date = serializers.DateField(required=False)


def _combat_groups_for(day, allowed):
    """Keep roster names and check scope against the frozen submission unit ID.

    Legacy names cannot establish identity: a renamed unit's old name may be
    reused by another department. Name-only submissions and missing units are
    therefore visible only with global duty visibility.
    """
    shifts = list(OpsCombatDutyShift.objects.filter(
        business_date=day, submission__stateCode="ACCEPTED",
    ).order_by("pk").values("id", "group_name", "route_set", "submission"))
    if not shifts:
        return []
    divisions = {row["id"]: row for row in Division.objects.values(
        "id", "name", "parent_id", "division_type",
    )}
    department_cache = {}

    def department_of(division_id):
        if division_id in department_cache:
            return department_cache[division_id]
        current, seen = division_id, set()
        while current in divisions and current not in seen:
            seen.add(current)
            node = divisions[current]
            if node["division_type"] == Division.DivisionType.DEPARTMENT:
                department_cache[division_id] = current
                return current
            current = node["parent_id"]
        department_cache[division_id] = None
        return None

    stage_labels = {
        "ACCEPTED": "Состав принят",
        "PENDING_ACKNOWLEDGEMENT": "Ожидает ознакомления",
        "READY": "Готов к заступлению",
        "ACTIVE": "На боевом дежурстве",
        "COMPLETED": "Дежурство завершено",
    }
    result = []
    for shift in shifts:
        submission = shift["submission"]
        unit_name = submission.get("submittedByUnitName") or ""
        frozen_id = submission.get("submittedByDivisionId")
        division_id = frozen_id if type(frozen_id) is int and frozen_id in divisions else None
        if allowed is not None and division_id not in allowed:
            continue
        department_id = department_of(division_id)
        execution = submission.get("execution") or {}
        stage_code = execution.get("stateCode") or "ACCEPTED"
        route_set = shift["route_set"]
        result.append({
            "shift_id": shift["id"], "group_name": shift["group_name"],
            "route_label": route_set.get("safeLabel", ""),
            "route_ids": route_set.get("routeIds", []),
            "division_id": division_id, "division_name": unit_name,
            "department_id": department_id,
            "department_name": divisions[department_id]["name"] if department_id else "",
            "leader_name": submission.get("groupLeaderEmployeeName", ""),
            "member_names": submission.get("memberEmployeeNames", []),
            "reserve_names": submission.get("reserveEmployeeNames", []),
            "stage_code": stage_code,
            "stage_label": stage_labels.get(stage_code, stage_labels["ACCEPTED"]),
            "actual_member_names": execution.get("actualMemberNames"),
            "actual_start": execution.get("actualStart"),
            "actual_end": execution.get("actualEnd"),
        })
    return result


class ServiceCombatDutyViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET service-combat-duty: duty personnel grouped by department identity.

    Staff scope determines visibility. A live attachment also admits the person
    to their host scope, using the same live incoming-leg rule as daily expense.
    Attachment does not replace the canonical status priority rule.
    """

    permission_map = {"list": "duty.view"}

    @extend_schema(parameters=[
        OpenApiParameter("business_date", OpenApiTypes.DATE, OpenApiParameter.QUERY),
    ])
    def list(self, request):
        # Preserve an explicit empty date as invalid rather than an omitted HTML field.
        query = ServiceCombatQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        day = query.validated_data.get("business_date", Clock.today_local())
        allowed = PermissionService.visible_division_ids(resolve_actor_id(request), "duty.view")
        combat_groups = _combat_groups_for(day, allowed)
        attachments = Secondment.objects.filter(
            in_status__cancelled_at__isnull=True, in_status__period__contains=day,
            in_status__employee_id=F("employee_id"), out_status__employee_id=F("employee_id"),
        ).order_by("id")
        if allowed is not None:
            attachments = attachments.filter(to_division_id__in=allowed)
        host_divisions = dict(attachments.values_list("employee_id", "to_division_id"))
        people = Employee.objects.filter(is_active=True)
        if allowed is not None:
            people = people.filter(
                Q(staff_unit__division_id__in=allowed) | Q(pk__in=host_divisions)
            )
        people = list(people.select_related("staff_unit__position").order_by(
            "staff_unit__position__level", "last_name", "first_name", "middle_name", "pk",
        ))
        if not people:
            return Response({"business_date": day.isoformat(), "departments": [], "combat_groups": combat_groups})

        catalog_rows = list(StatusType.objects.values(
            "code", "name", "priority", "report_column_code", "counts_in_staff",
        ))
        catalog = StatusCatalog.from_rows(catalog_rows)
        labels = {row["code"]: row["name"] for row in catalog_rows}
        statuses = defaultdict(list)
        for row in OpsEmployeeStatus.objects.filter(
            employee_id__in=[person.pk for person in people],
            cancelled_at__isnull=True, period__contains=day,
        ).values(
            "id", "employee_id", "status_type_code", "date_start", "date_end",
            "source_ref", "comment",
        ):
            statuses[row["employee_id"]].append(row)
        winners = {}
        for person in people:
            winner = resolve_status_row(statuses[person.pk], day, catalog)
            if winner is not None and catalog.column[winner["status_type_code"]] == "ON_DUTY":
                winners[person.pk] = winner
        destinations = destinations_for(winners.values())

        # One scan resolves every ancestor; identical names never merge identities.
        divisions = {row["id"]: row for row in Division.objects.values(
            "id", "parent_id", "division_type", "name", "tree_id", "lft",
        )}
        department_cache = {}

        def department_of(division_id):
            if division_id in department_cache:
                return department_cache[division_id]
            current, seen = division_id, set()
            while current in divisions and current not in seen:
                seen.add(current)
                node = divisions[current]
                if node["division_type"] == Division.DivisionType.DEPARTMENT:
                    department_cache[division_id] = current
                    return current
                current = node["parent_id"]
            department_cache[division_id] = 0
            return 0

        groups = {}
        for person in people:
            winner = winners.get(person.pk)
            if winner is None:
                continue
            staff = getattr(person, "staff_unit", None)
            division_id = host_divisions.get(person.pk, staff.division_id if staff else None)
            department_id = department_of(division_id)
            group = groups.setdefault(department_id, {
                "id": department_id,
                "name": divisions[department_id]["name"] if department_id else "Без департамента",
                "employees": [],
            })
            group["employees"].append({
                "employee_id": person.pk, "full_name": personnel_full_name(person),
                "position_name": staff.position.name if staff and staff.position else "",
                "status_label": labels[winner["status_type_code"]],
                "date_start": winner["date_start"].isoformat(),
                "date_end": winner["date_end"].isoformat(),
                "destination": destinations.get(winner["id"], ""),
            })
        ordered = sorted(groups, key=lambda pk: (
            (divisions[pk]["tree_id"], divisions[pk]["lft"]) if pk else (float("inf"), 0)
        ))
        return Response({
            "business_date": day.isoformat(), "departments": [groups[pk] for pk in ordered],
            "combat_groups": combat_groups,
        })
