"""Independent object inspection routes; fail closed for unmappable scopes."""
from django.contrib.auth import get_user_model
from django.db.models import Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from organization_management.apps.operations.api.permissions import require_global_permission, resolve_actor_id
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_object_inspection import OpsObjectInspection
from organization_management.apps.ops import object_inspections as service


class ObjectInspectionViewSet(viewsets.ViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        require_global_permission(request, "object.view" if self.action in ("list", "retrieve") else "object.manage")

    @extend_schema(
        operation_id="ops_object_inspections_list",
        parameters=[
            OpenApiParameter("objectId", {"type": "string", "pattern": "^[1-9][0-9]{0,17}$"},
                             OpenApiParameter.QUERY, required=True, description="Идентификатор объекта; список содержит только его обследования."),
            OpenApiParameter("page", {"type": "integer", "minimum": 1, "maximum": 100000, "default": 1},
                             OpenApiParameter.QUERY, required=False, description="Страница, по 20 обследований."),
        ],
    )
    def list(self, request):
        if set(request.query_params) - {"objectId", "page"}:
            raise ValidationError("Неизвестные параметры списка обследований.")
        obj_id = service.object_id(request.query_params.get("objectId"))
        try:
            page = int(request.query_params.get("page", "1"))
            if not 1 <= page <= 100000:
                raise ValueError
        except ValueError:
            raise ValidationError("Некорректная страница.")
        rows = OpsObjectInspection.objects.filter(security_object_id=obj_id).select_related("reviewer")
        count = rows.count()
        perms = PermissionService.unscoped_permissions(resolve_actor_id(request))
        return Response({"results": [service.serialize(row) for row in rows[(page-1)*20:page*20]],
                         "count": count, "page": page, "hasNext": page*20 < count,
                         "today": Clock.today_local().isoformat(), "currentUser": service.user_view(request.user),
                         "canManage": bool(perms & {"*", "object.manage"})})

    def retrieve(self, request, pk=None):
        row = OpsObjectInspection.objects.select_related("reviewer").filter(pk=service.inspection_id(pk)).first()
        if row is None:
            raise NotFound("Обследование не найдено.")
        return Response(service.serialize(row))

    def create(self, request):
        row, created = service.create(request.data, request.user, resolve_actor_id(request))
        return Response(service.serialize(row), status=201 if created else 200)

    def partial_update(self, request, pk=None):
        return Response(service.serialize(service.mutate(pk, request.data, resolve_actor_id(request), request.user, "save")))

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return Response(service.serialize(service.mutate(pk, request.data, resolve_actor_id(request), request.user, "complete")))

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        return Response(service.serialize(service.mutate(pk, request.data, resolve_actor_id(request), request.user, "resolve")))

    @extend_schema(parameters=[
        OpenApiParameter("q", {"type": "string", "maxLength": 150}, OpenApiParameter.QUERY, required=False,
                         description="Начало логина, имени или фамилии. От двух символов — поиск до 25 активных учётных записей; иначе только текущая учётная запись."),
    ])
    @action(detail=False, methods=["get"])
    def assignees(self, request):
        query = service.text(request.query_params.get("q", ""), "поиск", 150)
        users = get_user_model().objects.filter(is_active=True)
        if len(query) < 2:
            users = users.filter(pk=request.user.pk)
        else:
            users = users.filter(Q(username__istartswith=query) | Q(first_name__istartswith=query) | Q(last_name__istartswith=query))
        return Response({"results": [service.user_view(user) for user in users.order_by("username")[:25]]})

