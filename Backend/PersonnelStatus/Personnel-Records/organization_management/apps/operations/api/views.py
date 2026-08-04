"""API раздела ОМ: идентичность и администрирование RBAC (порт
apps/operations/api/views.py из Backend/VAPS).

Отличия от источника:
- актор — SimpleJWT-пользователь старого проекта (resolve_actor_id), НЕ
  request.actor_id внешнего КУ; superuser-шортката НЕТ намеренно: admin
  получает wildcard через назначение роли ADMIN, а не через флаг Django;
- тела запросов проходят через сериализаторы (400 вместо KeyError→500 в
  источнике), идентичность в теле не принимается — только из аутентификации.
"""
from drf_spectacular.utils import (
    extend_schema,
    extend_schema_serializer,
    inline_serializer,
)
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
    require_permission,
    resolve_actor_id,
)
from organization_management.apps.operations.api.serializers import (
    AssignRoleRequestSerializer,
    BulkStatusCreateSerializer,
    GrantTemporaryDutyRequestSerializer,
    PermissionSerializer,
    RoleSerializer,
    StatusTypeSerializer,
    TemporaryDutySerializer,
    UserRoleSerializer,
)
from organization_management.apps.operations.models import (
    Permission,
    Role,
    StatusType,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.bulk_status_service import (
    bulk_create_statuses,
)
from organization_management.apps.operations.selectors import DivisionTreeSelector
from organization_management.apps.operations.services import (
    PermissionService,
    RoleAdminService,
)

# Право на запись статусов; им же резолвится область видимости пачки.
_BULK_STATUS_PERMISSION = "status.manage"


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

    @extend_schema(responses=UserRoleSerializer(many=True))
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

    @extend_schema(
        request=AssignRoleRequestSerializer, responses=UserRoleSerializer
    )
    def create(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        payload = AssignRoleRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        user_role = RoleAdminService.assign_role(
            user_id=data["user_id"],
            role_code=data["role_code"].code,
            scope_division_id=data.get("scope_division_id"),
            # Идентичность — из контракта аутентификации, не из тела запроса.
            actor=resolve_actor_id(request),
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
    @extend_schema(responses=TemporaryDutySerializer(many=True))
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

    @extend_schema(
        request=GrantTemporaryDutyRequestSerializer,
        responses=TemporaryDutySerializer,
    )
    def create(self, request, *args, **kwargs):
        require_permission(request, "admin.roles")
        payload = GrantTemporaryDutyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        grant = RoleAdminService.grant_temporary_duty(
            user_id=data["user_id"],
            duty_role_code=data["duty_role_code"],
            starts_at=data["starts_at"],
            ends_at=data["ends_at"],
            # Идентичность приходит из контракта аутентификации, никогда —
            # из поля, присланного клиентом.
            created_by=resolve_actor_id(request),
            employee_id=data.get("employee_id"),
            scope_division_id=data.get("scope_division_id"),
            event_id=data.get("event_id"),
        )
        return Response(
            TemporaryDutySerializer(grant).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        request=None,
        responses=extend_schema_serializer(many=False)(
            inline_serializer(
                name="ExpireTemporaryDutyResponse",
                fields={"expired": serializers.BooleanField()},
            )
        ),
    )
    @action(detail=True, methods=["post"])
    def expire(self, request, pk=None, *args, **kwargs):
        require_permission(request, "admin.roles")
        # 404 на несуществующий грант: «истёк» в ответ на пустой UPDATE
        # сообщал бы об успехе там, где ничего не произошло (отличие от
        # источника, где ответ всегда {"expired": true}).
        if not TemporaryDutyPermission.objects.filter(id=pk).exists():
            return Response(status=status.HTTP_404_NOT_FOUND)
        RoleAdminService.expire_temporary_duty(pk)
        return Response({"expired": True}, status=status.HTTP_200_OK)


class StatusTypeViewSet(viewsets.ReadOnlyModelViewSet):
    """Справочник типов статусов — чтение под правом status.view.

    Каталог, а не бизнес-данные: гейт мягче, чем admin.roles, потому что
    словарь нужен каждому, кто вообще видит статусы. Правка каталога —
    только сидом (канон пересинхронизируется из кода), поэтому запись здесь
    не открыта.
    """

    serializer_class = StatusTypeSerializer
    pagination_class = DefaultPagination
    queryset = StatusType.objects.all()

    def list(self, request, *args, **kwargs):
        require_permission(request, "status.view")
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        require_permission(request, "status.view")
        return super().retrieve(request, *args, **kwargs)


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


class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """POST /api/operations/statuses/bulk/ — массовое создание статусов.

    Тонкая вьюха поверх готового сервиса: сериализатор → резолв области
    видимости из RBAC → вызов сервиса → 201 {created}. Ни бизнес-логики, ни
    детекта конфликтов здесь нет — всё в bulk_status_service; DomainError
    сервиса (400/403/404/409/422) уходит наверх и становится конвертом в
    ops_exception_handler, вьюха его НЕ ловит.

    Грубый гейт права — RequirePermissionMixin (status.manage); тонкую
    построчную область энфорсит сервис по allowed_division_ids, которое вьюха
    резолвит из RBAC актора: пришедшему из тела запроса подразделению здесь
    не верят.
    """

    permission_map = {"bulk": _BULK_STATUS_PERMISSION}
    # Минимальная поверхность: только POST bulk. Чтение статусов — отдельный
    # срез, поэтому GET здесь не открыт.
    http_method_names = ["post", "options"]

    @extend_schema(
        request=BulkStatusCreateSerializer,
        responses={
            201: inline_serializer(
                name="BulkStatusCreateResponse",
                fields={"created": serializers.IntegerField()},
            )
        },
        description=(
            "Массовое создание статусов-отклонений одним вызовом. "
            "403 — нет права status.manage либо сотрудник вне области "
            "оператора; 400 — структурная ошибка payload (пустой/дубль/"
            "пропуск ключа/превышение предела строк); 409 — мягкое "
            "пересечение (details.rows[]); 422 — жёсткое пересечение, "
            "интервал или границы найма (details.rows[]). Успех — {created}."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk", url_name="bulk")
    def bulk(self, request, *args, **kwargs):
        form = BulkStatusCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # Область — МНОЖЕСТВО подразделений из RBAC актора (не одно: пачка
        # может охватывать разные подразделения, сервис проверяет построчно).
        # None = безскоуповый/wildcard грант → все подразделения: сервис ждёт
        # множество, None уронил бы его TypeError'ом.
        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), _BULK_STATUS_PERMISSION
        )
        if allowed is None:
            allowed = DivisionTreeSelector.all_ids()
        created = bulk_create_statuses(
            form.validated_data["rows"],
            # Актор — из контракта аутентификации, НИКОГДА из тела запроса.
            actor=resolve_actor_id(request),
            business_date=form.validated_data["business_date"],
            allowed_division_ids=allowed,
        )
        return Response({"created": len(created)}, status=status.HTTP_201_CREATED)
