import datetime as dt

from django.db import transaction
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
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector
from apps.core.services import compute_free_slots, mask_employee_data

# Единственная санкционированная точка записи аудита (story 4.3): импорт
# сервиса, не моделей — границу охраняет test_audit_write_boundary. core ↛
# operations не нарушается: audit — инфраструктурный лист.
from apps.audit.services import record as audit_record


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
        # truncation, atomic). This thin legacy action stays THIN (no slot /
        # status logic; the orchestrator wiring is deferred to 2.9/E5 — core ↛
        # operations), but its OWN mutation is safe now: row lock + state
        # guard + audit. Гонка archive против оркестратора увольнения или
        # второго archive сериализуется локом строки; повторный archive — не
        # молчаливый no-op, а честный 409: второй вызывающий должен узнать,
        # что состояние уже изменил не он.
        self.get_object()  # 404 + object-perms ДО транзакции
        with transaction.atomic():
            emp = Employee.objects.select_for_update().get(
                pk=self.kwargs[self.lookup_field]
            )
            if emp.employment_status == Employee.EmploymentStatus.ARCHIVED:
                raise DomainError(
                    "EMPLOYEE_ALREADY_ARCHIVED",
                    409,
                    detail={"employee_id": str(emp.pk)},
                    message="Сотрудник уже в архиве.",
                )
            old_status = emp.employment_status
            emp.employment_status = Employee.EmploymentStatus.ARCHIVED
            emp.is_active = False
            emp.save(
                update_fields=["employment_status", "is_active", "updated_at"]
            )
            # В ambient-транзакции мутации (E3 retro): откат мутации откатит
            # и строку аудита — аудируются СЛУЧИВШИЕСЯ изменения.
            audit_record(
                actor=request.actor_id,
                action="EMPLOYEE_ARCHIVED",
                entity_type="employee",
                entity_id=emp.pk,
                old_value={"employment_status": old_status},
                new_value={
                    "employment_status": str(
                        Employee.EmploymentStatus.ARCHIVED
                    )
                },
            )
        return Response(
            self._mask(EmployeeSerializer(emp).data), status=status.HTTP_200_OK
        )

    @action(detail=True, methods=["post"])
    def restore(self, request, *args, **kwargs):
        self.get_object()
        with transaction.atomic():
            emp = Employee.objects.select_for_update().get(
                pk=self.kwargs[self.lookup_field]
            )
            # Восстанавливать можно только из архива: restore работающего —
            # признак гонки или ошибки клиента, и молчаливое «ок» скрыло бы её.
            if emp.employment_status != Employee.EmploymentStatus.ARCHIVED:
                raise DomainError(
                    "EMPLOYEE_NOT_ARCHIVED",
                    409,
                    detail={
                        "employee_id": str(emp.pk),
                        "employment_status": str(emp.employment_status),
                    },
                    message="Сотрудник не в архиве — восстанавливать нечего.",
                )
            emp.employment_status = Employee.EmploymentStatus.WORKING
            emp.is_active = True
            emp.save(
                update_fields=["employment_status", "is_active", "updated_at"]
            )
            audit_record(
                actor=request.actor_id,
                action="EMPLOYEE_RESTORED",
                entity_type="employee",
                entity_id=emp.pk,
                old_value={
                    "employment_status": str(
                        Employee.EmploymentStatus.ARCHIVED
                    )
                },
                new_value={
                    "employment_status": str(
                        Employee.EmploymentStatus.WORKING
                    )
                },
            )
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
        employee_id = (request.data or {}).get("employee_id")
        if not employee_id:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"employee_id": ["Укажите сотрудника."]},
                message="employee_id обязателен.",
            )
        if not Employee.objects.filter(pk=employee_id).exists():
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"employee_id": str(employee_id)},
                message="Сотрудник не найден.",
            )
        with transaction.atomic():
            # Лок СТРОКИ СЛОТА сериализует конкурирующие назначения: без
            # него два одновременных assign проходили бы проверку занятости
            # оба и создавали ДВА открытых назначения на один слот.
            slot = StaffingSlot.objects.select_for_update().get(pk=slot.pk)
            occupied = EmployeeStaffingAssignment.objects.filter(
                staffing_slot=slot, ends_at__isnull=True
            ).exists()
            if occupied:
                raise DomainError(
                    "STAFFING_SLOT_OCCUPIED",
                    409,
                    detail={"staffing_slot_id": str(slot.pk)},
                    message=(
                        "Слот уже занят действующим назначением — сначала "
                        "освободите его (release)."
                    ),
                )
            assignment = EmployeeStaffingAssignment.objects.create(
                employee_id=employee_id,
                staffing_slot=slot,
                starts_at=timezone.now(),
                created_by=request.actor_id,
            )
            audit_record(
                actor=request.actor_id,
                action="STAFFING_ASSIGNMENT_CREATED",
                entity_type="staffing_slot",
                entity_id=slot.pk,
                new_value={
                    "assignment_id": str(assignment.pk),
                    "employee_id": str(employee_id),
                },
            )
        return Response(
            StaffingAssignmentSerializer(assignment).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def release(self, request, *args, **kwargs):
        slot = self.get_object()
        with transaction.atomic():
            slot = StaffingSlot.objects.select_for_update().get(pk=slot.pk)
            released_ids = list(
                EmployeeStaffingAssignment.objects.filter(
                    staffing_slot=slot, ends_at__isnull=True
                ).values_list("id", flat=True)
            )
            EmployeeStaffingAssignment.objects.filter(
                id__in=released_ids
            ).update(ends_at=timezone.now())
            # Аудируются СЛУЧИВШИЕСЯ изменения: release пустого слота ничего
            # не менял — строки аудита не заслуживает.
            if released_ids:
                audit_record(
                    actor=request.actor_id,
                    action="STAFFING_ASSIGNMENT_RELEASED",
                    entity_type="staffing_slot",
                    entity_id=slot.pk,
                    old_value={
                        "assignment_ids": [str(i) for i in released_ids]
                    },
                )
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
