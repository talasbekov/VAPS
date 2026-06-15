from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from apps.operations.api.permissions import require_permission
from apps.operations.api.serializers import (
    PermissionSerializer, RoleSerializer, TemporaryDutySerializer, UserRoleSerializer,
)
from apps.operations.models import Permission, Role, TemporaryDutyPermission, UserRole
from apps.operations.services import PermissionService, RoleAdminService


class DefaultPagination(LimitOffsetPagination):
    default_limit = 50


class RoleViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RoleSerializer
    pagination_class = DefaultPagination
    queryset = Role.objects.all().order_by("code")

    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().retrieve(request, *args, **kwargs)


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PermissionSerializer
    pagination_class = DefaultPagination
    queryset = Permission.objects.all().order_by("code")

    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        return super().retrieve(request, *args, **kwargs)


class UserRoleViewSet(viewsets.ViewSet):
    pagination_class = DefaultPagination

    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        qs = UserRole.objects.all().order_by("user_id")
        if user_id := request.query_params.get("user_id"):
            qs = qs.filter(user_id=user_id)
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            UserRoleSerializer(page, many=True).data
        )

    def create(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        user_role = RoleAdminService.assign_role(
            user_id=request.data["user_id"],
            role_code=request.data["role_code"],
            scope_division_id=request.data.get("scope_division_id"),
            actor=request.actor_id,
        )
        return Response(
            UserRoleSerializer(user_role).data, status=status.HTTP_201_CREATED
        )

    def destroy(self, request, pk=None, *args, **kwargs):
        require_permission(request, "admin.roles")
        user_role = UserRole.objects.filter(id=pk).first()
        if user_role is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        RoleAdminService.revoke_role(
            user_role.user_id, user_role.role_code_id, user_role.scope_division_id
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class TemporaryDutyViewSet(viewsets.ViewSet):
    def list(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        qs = TemporaryDutyPermission.objects.all().order_by("-starts_at")
        if user_id := request.query_params.get("user_id"):
            qs = qs.filter(user_id=user_id)
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            TemporaryDutySerializer(page, many=True).data
        )

    def create(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        grant = RoleAdminService.grant_temporary_duty(
            user_id=request.data["user_id"],
            duty_role_code=request.data["duty_role_code"],
            starts_at=request.data["starts_at"],
            ends_at=request.data["ends_at"],
            # ARCH-SEC-030: identity comes from the auth contract, never
            # from a client-supplied payload field.
            created_by=request.actor_id,
            employee_id=request.data.get("employee_id"),
            scope_division_id=request.data.get("scope_division_id"),
            event_id=request.data.get("event_id"),
        )
        return Response(
            TemporaryDutySerializer(grant).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def expire(self, request, pk=None, *args, **kwargs):
        require_permission(request, "admin.roles")
        RoleAdminService.expire_temporary_duty(pk)
        return Response({"expired": True}, status=status.HTTP_200_OK)


class MyPermissionsViewSet(viewsets.ViewSet):
    def list(self, request, *args, **kwargs):
        user_id = getattr(request, "actor_id", None)
        if not user_id:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("PERMISSION_DENIED")
        division_id = request.query_params.get("division_id")
        perms = PermissionService.effective_permissions(
            user_id, division_id=division_id
        )
        return Response({"permissions": sorted(perms)})
