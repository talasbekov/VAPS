"""Story 14.11a/14.11b: `POST|GET /api/operations/duty-plans[/{id}/shifts]`
(API-OPS-012).

Deliberately a plain `viewsets.ViewSet` + the free `require_permission`
function (`apps.operations.api.permissions`), not `RequirePermissionMixin`:
two actions don't earn a `permission_map` declaration — mirrors
`apps.operations.bugreports.api.views.BugReportViewSet`, the most recent
precedent for this shape.

`duty.manage`'s RBAC role-binding row (which roles actually carry this
code) and HTTP audit logging are explicitly 14.12's territory — this story
only gates on the permission code, which already exists in the seed
(`apps/operations/management/commands/seed_operations.py`).

Duplicate-plan (409/422) and year/month-range (422) rejections are NOT
re-validated here: the existing DB-level `UniqueConstraint`/
`CheckConstraint` (Story 14.5) already reject them, and the project's
existing exception handler already maps the resulting `IntegrityError` to
a 4xx response (Story 3.3's "IntegrityError -> 422" backstop) — no new
validation logic duplicated in this layer.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.operations.api.permissions import require_permission
from apps.operations.duties.api.serializers import (
    DutyPlanCreateSerializer,
    DutyPlanSerializer,
    DutyShiftCreateSerializer,
    DutyShiftSerializer,
)
from apps.operations.duties.models import DutyPlan, DutyShift

_PERMISSION = "duty.manage"


class DutyPlanPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 200


class DutyPlanViewSet(viewsets.ViewSet):
    """Story 14.11a: create/list duty plans."""

    http_method_names = ["get", "post", "options"]
    pagination_class = DutyPlanPagination

    @extend_schema(
        operation_id="duty_plans_create",
        request=DutyPlanCreateSerializer,
        responses={201: DutyPlanSerializer},
        description="Создать план дежурств (DRAFT). Требует duty.manage.",
    )
    def create(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        form = DutyPlanCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        plan = DutyPlan.objects.create(**form.validated_data)
        return Response(
            DutyPlanSerializer(plan).data, status=http_status.HTTP_201_CREATED
        )

    @extend_schema(
        operation_id="duty_plans_list",
        responses={200: DutyPlanSerializer(many=True)},
        description="Список планов дежурств. Требует duty.manage. "
        "limit/offset-пагинация (дефолт 50, потолок 200). Опциональный "
        "фильтр по object (query-параметр).",
    )
    def list(self, request, *args, **kwargs):
        require_permission(request, _PERMISSION)
        plans = DutyPlan.objects.order_by("-year", "-month")
        object_id = request.query_params.get("object")
        if object_id:
            # Review (Blind Hunter/Edge Case Hunter, independently confirmed):
            # Object's PK is a plain integer — filtering with a raw,
            # unvalidated query-param string raises a bare ValueError deep
            # inside the queryset (Postgres "invalid input syntax for type
            # integer"), which exception_handler.py doesn't map and falls
            # through to a bare 500. Validate/coerce here so bad input is a
            # clean 400, same as create's PrimaryKeyRelatedField already
            # gives for the request-body path.
            if not object_id.isdigit():
                raise ValidationError({"object": "Ожидается числовой id объекта."})
            plans = plans.filter(object_id=object_id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(plans, request)
        return paginator.get_paginated_response(
            DutyPlanSerializer(page, many=True).data
        )

    @extend_schema(
        operation_id="duty_plan_shifts_create",
        methods=["POST"],
        request=DutyShiftCreateSerializer,
        responses={201: DutyShiftSerializer},
        description="Создать смену в плане. Требует duty.manage.",
    )
    @extend_schema(
        operation_id="duty_plan_shifts_list",
        methods=["GET"],
        responses={200: DutyShiftSerializer(many=True)},
        description="Список смен плана. Требует duty.manage. "
        "limit/offset-пагинация (дефолт 50, потолок 200).",
    )
    @action(detail=True, methods=["get", "post"])
    def shifts(self, request, pk=None, *args, **kwargs):
        require_permission(request, _PERMISSION)
        plan = get_object_or_404(DutyPlan, pk=pk)
        if request.method == "POST":
            return self._create_shift(request, plan)
        return self._list_shifts(request, plan)

    def _create_shift(self, request, plan):
        form = DutyShiftCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        shift = DutyShift(plan=plan, **form.validated_data)
        # Story 14.11b: DutyShift.clean()'s cross-FK guard (post/duty_type
        # must belong to plan.object) has NO DB-level backstop (a Postgres
        # CHECK can't compare columns across tables) — full_clean() is the
        # ONLY enforcement layer, and this is the first HTTP write path for
        # DutyShift. Django 4.1+'s full_clean() ALSO validates
        # ck_duty_shift_starts_before_ends up front (Model.
        # validate_constraints()) — empirically confirmed both raise
        # django.core.exceptions.ValidationError, which DRF's exception
        # handling does NOT auto-convert (a well-known DRF gotcha — it only
        # understands its own rest_framework.exceptions.ValidationError).
        # Converting explicitly here avoids a bare 500 for either case.
        try:
            shift.full_clean()
        except DjangoValidationError as exc:
            raise ValidationError(exc.message_dict) from exc
        shift.save()
        return Response(
            DutyShiftSerializer(shift).data, status=http_status.HTTP_201_CREATED
        )

    def _list_shifts(self, request, plan):
        shifts = plan.shifts.order_by("starts_at")
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(shifts, request)
        return paginator.get_paginated_response(
            DutyShiftSerializer(page, many=True).data
        )
