import datetime as dt

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.core.api.permissions import (
    RequirePermissionMixin, require_permission,
)
from apps.core.api.serializers import (
    DivisionSerializer, EmployeeSerializer, PositionSerializer, RankSerializer,
    StaffingAssignmentSerializer, StaffingSlotSerializer,
)
from apps.core.models import (
    Division, Employee, EmployeeStaffingAssignment, Position, Rank, StaffingSlot,
)
from apps.core.selectors import CoreDivisionTreeSelector
from apps.core.services import compute_free_slots, mask_employee_data


class DefaultPagination(PageNumberPagination):
    page_size = 50


def _permissions_from_request(request) -> set:
    raw = request.headers.get("X-User-Permissions", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


class EmployeeViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    serializer_class = EmployeeSerializer
    pagination_class = DefaultPagination
    http_method_names = ["get", "patch", "post"]
    permission_map = {
        "list": "personnel.view",
        "retrieve": "personnel.view",
        "create": "personnel.edit",
        "partial_update": "personnel.edit",
        "archive": "personnel.edit",
        "restore": "personnel.edit",
    }

    def get_queryset(self):
        qs = Employee.objects.all().order_by("full_name")
        params = self.request.query_params
        if division_id := params.get("division_id"):
            qs = qs.filter(division_id=division_id)
        if status_code := params.get("status"):
            qs = qs.filter(employment_status=status_code)
        if rank_code := params.get("rank_code"):
            qs = qs.filter(rank_code=rank_code)
        if position_code := params.get("position_code"):
            qs = qs.filter(position_code=position_code)
        if search := params.get("search"):
            from django.db.models import Q
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(personnel_number__icontains=search)
            )
        return qs

    def _mask(self, data):
        return mask_employee_data(
            data, user_permissions=_permissions_from_request(self.request)
        )

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        serialized = [self._mask(EmployeeSerializer(e).data) for e in page]
        return self.get_paginated_response(serialized)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response(self._mask(EmployeeSerializer(instance).data))

    @action(detail=True, methods=["post"])
    def archive(self, request, *args, **kwargs):
        # NOTE (story 2.5 review, decision A): the canonical dismissal is the
        # service layer — apps.operations.statuses.services.dismissal
        # .dismiss_employee (archive + interval + slot→Vacancy + status
        # truncation, atomic). This thin legacy action is left as-is; an
        # RBAC-gated dismissal endpoint that wires the orchestrator (with
        # DomainError mapping) is deferred to 2.9/E5 — core ↛ operations
        # prevents this core view from calling the orchestrator.
        emp = self.get_object()
        emp.employment_status = Employee.EmploymentStatus.ARCHIVED
        emp.is_active = False
        emp.save(update_fields=["employment_status", "is_active", "updated_at"])
        return Response(
            self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK
        )

    @action(detail=True, methods=["post"])
    def restore(self, request, *args, **kwargs):
        emp = self.get_object()
        emp.employment_status = Employee.EmploymentStatus.WORKING
        emp.is_active = True
        emp.save(update_fields=["employment_status", "is_active", "updated_at"])
        return Response(
            self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK
        )


class DivisionViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    serializer_class = DivisionSerializer
    pagination_class = DefaultPagination
    queryset = Division.objects.all().order_by("name")
    permission_map = {
        "list": "orgstructure.view",
        "retrieve": "orgstructure.view",
        "leaf_descendants": "orgstructure.view",
        "create": "orgstructure.manage",
        "update": "orgstructure.manage",
        "partial_update": "orgstructure.manage",
        "destroy": "orgstructure.manage",
    }

    @action(detail=True, methods=["get"], url_path="leaf-descendants")
    def leaf_descendants(self, request, *args, **kwargs):
        division = self.get_object()
        leaves = CoreDivisionTreeSelector.leaf_descendants(division.id)
        return Response(DivisionSerializer(leaves, many=True).data)


class PositionViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    serializer_class = PositionSerializer
    pagination_class = DefaultPagination
    queryset = Position.objects.all().order_by("sort_order")
    http_method_names = ["get", "post", "patch"]
    permission_map = {
        "list": "orgstructure.view",
        "retrieve": "orgstructure.view",
        "create": "orgstructure.manage",
        "partial_update": "orgstructure.manage",
    }


class RankViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    serializer_class = RankSerializer
    pagination_class = DefaultPagination
    queryset = Rank.objects.all().order_by("rank_index")
    http_method_names = ["get", "post", "patch"]
    permission_map = {
        "list": "orgstructure.view",
        "retrieve": "orgstructure.view",
        "create": "orgstructure.manage",
        "partial_update": "orgstructure.manage",
    }


class StaffingSlotViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    serializer_class = StaffingSlotSerializer
    pagination_class = DefaultPagination
    queryset = StaffingSlot.objects.all().order_by("valid_from")
    http_method_names = ["get", "post", "patch"]
    permission_map = {
        "list": "personnel.view",
        "retrieve": "personnel.view",
        "create": "personnel.edit",
        "partial_update": "personnel.edit",
        "assign_employee": "personnel.edit",
        "release": "personnel.edit",
    }

    @action(detail=True, methods=["post"], url_path="assign-employee")
    def assign_employee(self, request, *args, **kwargs):
        slot = self.get_object()
        assignment = EmployeeStaffingAssignment.objects.create(
            employee_id=request.data["employee_id"],
            staffing_slot=slot,
            starts_at=timezone.now(),
            # No permission gate on this view yet (service move is E2), so
            # actor_id may be absent — getattr, not a direct read.
            created_by=getattr(request, "actor_id", None),
        )
        return Response(
            StaffingAssignmentSerializer(assignment).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def release(self, request, *args, **kwargs):
        slot = self.get_object()
        EmployeeStaffingAssignment.objects.filter(
            staffing_slot=slot, ends_at__isnull=True
        ).update(ends_at=timezone.now())
        return Response({"released": True}, status=status.HTTP_200_OK)


class VacancyViewSet(viewsets.ViewSet):
    def list(self, request, *args, **kwargs):
        # Story 2.13 pilot gate: in-house RBAC via request.effective_permissions
        # (populated by the operations authz seam) — core ↛ operations.
        require_permission(request, "personnel.view")
        division_id = request.query_params.get("division_id")
        date_str = request.query_params.get("date")
        on_date = (
            timezone.make_aware(
                dt.datetime.combine(parse_date(date_str), dt.time.min)
            )
            if date_str
            else timezone.now()
        )
        free = compute_free_slots(division_id, on_date=on_date)
        results = StaffingSlotSerializer(free, many=True).data
        return Response({"count": len(free), "results": results})
