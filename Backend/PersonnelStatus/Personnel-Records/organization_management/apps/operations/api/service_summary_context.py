"""Permission-gated workspace context; shared report APIs keep their own scopes."""
from rest_framework import serializers, viewsets
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.api.permissions import effective_permissions, require_permission, resolve_actor_id
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.selectors import DivisionTreeSelector
from organization_management.apps.operations.services import PermissionService


class ServiceSummaryContextSerializer(serializers.Serializer):
    root_division_id = serializers.IntegerField()
    root_name = serializers.CharField()
    can_generate_root_summary = serializers.BooleanField()


class ServiceSummaryContextViewSet(viewsets.ViewSet):
    http_method_names = ["get", "options"]

    @extend_schema(responses=ServiceSummaryContextSerializer(many=False))
    def list(self, request):
        """Read the workspace root with service_summary.view AND status.view."""
        # Keep the primary workspace guard explicit for the permission catalog.
        require_permission(request, "service_summary.view")
        require_permission(request, "status.view")
        root_id = DivisionTreeSelector.root_id()
        if root_id is None:
            raise DomainError("SERVICE_SUMMARY_ROOT_MISSING", 409,
                              message="Корень организации не настроен.")
        for permission in ("service_summary.view", "status.view"):
            allowed = PermissionService.visible_division_ids(resolve_actor_id(request), permission)
            if allowed is not None and root_id not in allowed:
                raise DomainError("PERMISSION_DENIED", 403,
                                  message="Для свода по Службе нужен доступ к корню организации.")
        permissions = effective_permissions(request)
        generation_scope = PermissionService.visible_division_ids(
            resolve_actor_id(request), "daily_report.generate"
        )
        can_generate = ("*" in permissions or "daily_report.generate" in permissions) and (
            generation_scope is None or root_id in generation_scope
        )
        return Response({"root_division_id": root_id,
                         "root_name": Division.objects.get(pk=root_id).name,
                         "can_generate_root_summary": can_generate})
