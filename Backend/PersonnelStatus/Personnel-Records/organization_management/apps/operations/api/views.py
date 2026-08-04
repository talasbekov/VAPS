"""API раздела ОМ: идентичность и администрирование RBAC (порт
apps/operations/api/views.py из Backend/VAPS).

Отличия от источника:
- актор — SimpleJWT-пользователь старого проекта (resolve_actor_id), НЕ
  request.actor_id внешнего КУ; superuser-шортката НЕТ намеренно: admin
  получает wildcard через назначение роли ADMIN, а не через флаг Django;
- тела запросов проходят через сериализаторы (400 вместо KeyError→500 в
  источнике), идентичность в теле не принимается — только из аутентификации.
"""
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
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
    OpsEmployeeStatusSerializer,
    PermissionSerializer,
    RoleSerializer,
    StatusTypeSerializer,
    StatusUpdateSerializer,
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
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.selectors import (
    DivisionTreeSelector,
    StaffUnitSelector,
)
from organization_management.apps.operations.services import (
    PermissionService,
    RoleAdminService,
)
from organization_management.apps.operations.status_service import update_status
from organization_management.apps.operations.strength_report import (
    StrengthReportService,
)

# Право на запись статусов; им же резолвится область видимости пачки.
_BULK_STATUS_PERMISSION = "status.manage"


def _parse_int_param(request, name):
    """Целочисленный query-параметр или None; мусор — 400, не 500.

    Коэрция обязательна: pk старого дерева целочисленный, и строка из query
    никогда не совпала бы с int-множеством subtree_ids — сравнение молча
    давало бы пустой результат вместо ответа.
    """
    raw = request.query_params.get(name)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValidationError({name: "Ожидается целое число."}) from None


def _parse_date_param(request, name):
    """Дата ISO из query или None; мусор — 400."""
    raw = request.query_params.get(name)
    if raw is None:
        return None
    parsed = parse_date(raw)
    if parsed is None:
        raise ValidationError({name: "Ожидается дата в формате ГГГГ-ММ-ДД."})
    return parsed


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
        division_id = _parse_int_param(request, "division_id")
        perms = PermissionService.effective_permissions(
            actor_id, division_id=division_id
        )
        return Response({"permissions": sorted(perms)})


class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Статусы раздела ОМ: массовое создание и поштучная правка.

    POST /api/operations/statuses/bulk/  — пачка (срез 6)
    PATCH /api/operations/statuses/{id}/ — правка интервала и метаданных

    Тонкая вьюха поверх готовых сервисов: сериализатор → резолв области
    видимости из RBAC → вызов сервиса. Ни бизнес-логики, ни детекта
    конфликтов здесь нет; DomainError сервиса (400/403/404/409/422) уходит
    наверх и становится конвертом в ops_exception_handler, вьюха его НЕ
    ловит.

    Грубый гейт права — RequirePermissionMixin (status.manage); тонкую
    область видимости энфорсят: у пачки — сервис построчно, у правки —
    _assert_status_in_scope ниже. Оба резолвят её из RBAC актора: подразделению
    из тела запроса здесь не верят.
    """

    permission_map = {
        "bulk": _BULK_STATUS_PERMISSION,
        "partial_update": _BULK_STATUS_PERMISSION,
    }
    # Поверхность: пачка и правка. Чтение статусов — отдельный срез, поэтому
    # GET здесь не открыт; PUT не открыт намеренно (полная замена строки
    # переписала бы неизменяемые поля — правка только частичная).
    http_method_names = ["post", "patch", "options"]

    def _assert_status_in_scope(self, request, status_row):
        """Область видимости правимой строки — из RBAC актора.

        Подразделение берётся по сотруднику строки через общий селектор (тот
        же, которым область считает пачка). None = безскоуповый/wildcard грант
        → всё дерево. Сотрудник без штатной единицы не принадлежит ничьей
        области — 403 (fail-closed, как в пачке).

        Отказ по области — DomainError → конверт {error_code}; отказ гейта
        права — PermissionDenied DRF → {detail}. Формы РАЗНЫЕ намеренно: оба
        403, и без различения тест одного зеленел бы от другого.
        """
        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), _BULK_STATUS_PERMISSION
        )
        if allowed is None:
            return
        division_id = StaffUnitSelector.divisions_of([status_row.employee_id]).get(
            status_row.employee_id
        )
        if division_id not in allowed:
            raise DomainError(
                "PERMISSION_DENIED",
                403,
                detail={"employee_id": str(status_row.employee_id)},
                message="Сотрудник вне области видимости оператора.",
            )

    @extend_schema(
        # Тип параметра пути объявлен явно: у ViewSet нет queryset, и без
        # этого spectacular вывел бы "string" (и предупредил бы об этом).
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id строки статуса.",
            )
        ],
        request=StatusUpdateSerializer,
        responses={200: OpsEmployeeStatusSerializer},
        description=(
            "Правка статуса: интервал (date_start/date_end) и метаданные "
            "(comment/document_basis). Смена типа, сотрудника и фактов "
            "отмены запрещена — 400 с указанием поля; пустое тело — тоже "
            "400. 403 — нет права status.manage либо сотрудник вне области "
            "оператора; 404 — строки нет; 409 — мягкое пересечение (обхода "
            "у правки нет); 422 — жёсткое пересечение, интервал, границы "
            "найма, строка проекции или отменённая (терминальная) строка."
        ),
    )
    def partial_update(self, request, pk=None, *args, **kwargs):
        form = StatusUpdateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # pk из пути — произвольная строка роутера: int() до запроса, иначе
        # мусорный идентификатор ушёл бы ValueError → 500 вместо 404.
        try:
            status_id = int(pk)
        except (TypeError, ValueError):
            status_id = None
        status_row = (
            OpsEmployeeStatus.objects.filter(pk=status_id).first()
            if status_id is not None
            else None
        )
        if status_row is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"status_id": str(pk)},
                message="Статус не найден.",
            )
        self._assert_status_in_scope(request, status_row)
        updated = update_status(
            status_row,
            # Актор — из контракта аутентификации, НИКОГДА из тела запроса.
            actor=resolve_actor_id(request),
            **form.validated_data,
        )
        return Response(OpsEmployeeStatusSerializer(updated).data)

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


class StrengthReportViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET /api/operations/strength-report/ — расход (строевая записка).

    Чтение под status.view. Область видимости сужает выборку ВСЕГДА, даже
    когда division_id не задан: безскоуповый оператор видит всё дерево,
    скоупованный — только своё поддерево, и запрос чужого подразделения ему
    отвечает 403, а не пустым отчётом (пустой отчёт неотличим от «там никого
    нет» и прячет отказ).

    business_date — явный параметр с умолчанием «сегодня» по Clock раздела:
    сервис расхода часы не читает, иначе расход на вчера тихо посчитался бы
    на сегодня.
    """

    permission_map = {"list": "status.view"}
    http_method_names = ["get", "options"]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "business_date",
                OpenApiTypes.DATE,
                description="Бизнес-дата расхода; по умолчанию сегодня.",
            ),
            OpenApiParameter(
                "division_id",
                OpenApiTypes.INT,
                description="Корень поддерева; по умолчанию вся область актора.",
            ),
        ],
        responses=extend_schema_serializer(many=False)(
            inline_serializer(
                name="StrengthReportResponse",
                fields={
                    "business_date": serializers.DateField(),
                    "columns": serializers.ListField(child=serializers.CharField()),
                    "rows": serializers.ListField(child=serializers.DictField()),
                    "totals": serializers.DictField(),
                    "warnings": serializers.ListField(child=serializers.DictField()),
                },
            )
        ),
    )
    def list(self, request, *args, **kwargs):
        business_date = _parse_date_param(request, "business_date")
        if business_date is None:
            business_date = Clock.today_local()
        division_id = _parse_int_param(request, "division_id")

        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), "status.view"
        )
        if division_id is None:
            scope = allowed  # None = глобальная видимость → всё дерево
        else:
            subtree = DivisionTreeSelector.subtree_ids(division_id)
            scope = subtree if allowed is None else subtree & allowed
            if not scope:
                raise PermissionDenied("PERMISSION_DENIED")

        report = StrengthReportService.compute(business_date, division_ids=scope)
        columns = list(report.totals.columns)
        return Response(
            {
                "business_date": report.business_date,
                "columns": columns,
                "rows": [
                    {
                        "division_id": row.division_id,
                        "name": row.name,
                        "staff_total": row.staff_total,
                        "list_total": row.list_total,
                        "vacancies": row.vacancies,
                        "attached": row.attached,
                        "columns": row.columns,
                    }
                    for row in report.rows
                ],
                "totals": {
                    "staff_total": report.totals.staff_total,
                    "list_total": report.totals.list_total,
                    "vacancies": report.totals.vacancies,
                    "attached": report.totals.attached,
                    "columns": report.totals.columns,
                },
                "warnings": report.warnings,
            }
        )
