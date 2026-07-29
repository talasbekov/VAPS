from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.core.api.permissions import require_permission
from apps.operations.bugreports.api.serializers import (
    BugReportCreateSerializer,
    BugReportSerializer,
)
from apps.operations.bugreports.models import BugReport

_VIEW_PERMISSION = "bugreports.view"


class BugReportPagination(LimitOffsetPagination):
    """limit/offset envelope — project canon (architecture.md#L427), mirrors
    AuditLogPagination (apps/audit/api/views.py). ``create`` has no RBAC
    gate (AC-2, cost ~0) — without a cap here, ``list`` would return an
    unbounded, ever-growing table on every call (review: Blind Hunter)."""

    default_limit = 50
    max_limit = 200


class BugReportViewSet(viewsets.ViewSet):
    """Story 13.1a: «сообщить о проблеме», стоимость ~0.

    Deliberately does NOT use ``RequirePermissionMixin`` (apps/core/api/
    permissions.py) — that mixin fail-closes every action behind a mapped
    permission code, which would force EVERY role to carry a new
    "bugreports.create" code just to let anyone report a problem (buries the
    story's own "cost ~0" requirement under RBAC ceremony). With
    ``DEFAULT_PERMISSION_CLASSES=[]`` (config/settings.py), any request that
    reaches this ViewSet already cleared DRF authentication — ``create``
    only additionally checks ``actor_id`` is present (i.e. genuinely
    authenticated, not anonymous). ``list``/``retrieve`` gate on the
    ``bugreports.view`` permission code directly via the free
    ``require_permission`` function — same mechanism, applied where the
    story actually wants a restriction: visibility, not the ability to
    report.
    """

    http_method_names = ["get", "post", "options"]
    pagination_class = BugReportPagination

    @extend_schema(
        operation_id="bugreports_create",
        request=BugReportCreateSerializer,
        responses={201: BugReportSerializer},
        description="«Сообщить о проблеме» — любой аутентифицированный "
        "пользователь, без RBAC-права.",
    )
    def create(self, request, *args, **kwargs):
        if not getattr(request, "actor_id", None):
            raise PermissionDenied("PERMISSION_DENIED")
        form = BugReportCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        report = BugReport.objects.create(
            user_id=request.actor_id,
            created_by=request.actor_id,
            **form.validated_data,
        )
        return Response(
            BugReportSerializer(report).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        operation_id="bugreports_list",
        responses={200: BugReportSerializer(many=True)},
        description="Требует bugreports.view (только DEVELOPER-роль по "
        "seed_operations) — анонимность отправителя от начальства. "
        "limit/offset-пагинация (дефолт 50, потолок 200).",
    )
    def list(self, request, *args, **kwargs):
        require_permission(request, _VIEW_PERMISSION)
        reports = BugReport.objects.order_by("-created_at")
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(reports, request)
        return paginator.get_paginated_response(
            BugReportSerializer(page, many=True).data
        )

    @extend_schema(
        operation_id="bugreports_retrieve",
        responses={200: BugReportSerializer},
        description="Требует bugreports.view — см. list().",
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        require_permission(request, _VIEW_PERMISSION)
        report = get_object_or_404(BugReport, pk=pk)
        return Response(BugReportSerializer(report).data)
