"""Story 14.11a: `POST|GET /api/operations/duty-plans` (API-OPS-012).

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

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework import status as http_status

from apps.operations.api.permissions import require_permission
from apps.operations.duties.api.serializers import (
    DutyPlanCreateSerializer,
    DutyPlanSerializer,
)
from apps.operations.duties.models import DutyPlan

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
            plans = plans.filter(object_id=object_id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(plans, request)
        return paginator.get_paginated_response(
            DutyPlanSerializer(page, many=True).data
        )
