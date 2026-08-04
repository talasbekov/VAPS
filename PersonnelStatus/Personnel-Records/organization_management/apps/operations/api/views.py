"""API раздела ОМ: идентичность/права (порт MyPermissionsViewSet из
Backend/VAPS apps/operations/api/views.py).

Отличие от источника: актор — SimpleJWT-пользователь старого проекта
(resolve_actor_id), НЕ request.actor_id внешнего КУ. Superuser-шортката НЕТ
намеренно: роли и права — как в новой системе, admin получает wildcard через
назначение роли ADMIN (seed_operations --assign), а не через флаг Django.
"""
from drf_spectacular.utils import (
    extend_schema,
    extend_schema_serializer,
    inline_serializer,
)
from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import resolve_actor_id
from organization_management.apps.operations.services import PermissionService


class MyPermissionsViewSet(viewsets.ViewSet):
    # Schema-only аннотация: у plain ViewSet нет сериализатора, spectacular
    # отдавал бы "No response body". many=False приводит list-эвристику
    # (action == "list") к единичному объекту вместо массива.
    @extend_schema(
        responses=extend_schema_serializer(many=False)(
            inline_serializer(
                name="MyPermissionsResponse",
                fields={
                    "permissions": serializers.ListField(
                        child=serializers.CharField()
                    ),
                },
            )
        )
    )
    def list(self, request, *args, **kwargs):
        actor_id = resolve_actor_id(request)
        if not actor_id:
            raise PermissionDenied("PERMISSION_DENIED")
        division_id = request.query_params.get("division_id")
        if division_id is not None:
            # pk старого дерева подразделений целочисленный; строка из query
            # без коэрции никогда не совпала бы с int-набором subtree_ids.
            try:
                division_id = int(division_id)
            except ValueError:
                raise ValidationError({"division_id": "Ожидается целое число."})
        perms = PermissionService.effective_permissions(
            actor_id, division_id=division_id
        )
        return Response({"permissions": sorted(perms)})
