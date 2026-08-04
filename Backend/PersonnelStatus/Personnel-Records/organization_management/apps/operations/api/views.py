"""API раздела ОМ: идентичность и администрирование RBAC (порт
apps/operations/api/views.py из Backend/VAPS).

Отличия от источника:
- актор — SimpleJWT-пользователь старого проекта (resolve_actor_id), НЕ
  request.actor_id внешнего КУ; superuser-шортката НЕТ намеренно: admin
  получает wildcard через назначение роли ADMIN, а не через флаг Django;
- тела запросов проходят через сериализаторы (400 вместо KeyError→500 в
  источнике), идентичность в теле не принимается — только из аутентификации.
"""
from django.db.models import Q
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
    SecondmentCreateSerializer,
    SecondmentReturnConfirmSerializer,
    SecondmentSerializer,
    StatusCancelSerializer,
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
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
    SecondmentState,
)
from organization_management.apps.operations.selectors import (
    DivisionTreeSelector,
    StaffUnitSelector,
)
from organization_management.apps.operations.services import (
    PermissionService,
    RoleAdminService,
)
from organization_management.apps.operations.secondment_service import (
    confirm_return as confirm_return_service,
    initiate_secondment,
    request_return as request_return_service,
)
from organization_management.apps.operations.status_service import (
    cancel_status,
    update_status,
)
from organization_management.apps.operations.strength_report import (
    StrengthReportService,
)

# Право на запись статусов; им же резолвится область видимости пачки.
_BULK_STATUS_PERMISSION = "status.manage"
# Право на чтение статусов — то же, что у расхода: кто видит агрегат, тот
# видит и строки, из которых он сложился.
_READ_STATUS_PERMISSION = "status.view"


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


def _parse_bool_param(request, name):
    """Булев query-параметр или None; мусор — 400, а не молчаливое «нет».

    Читается строго (true/false, 1/0): при мягком разборе include_cancelled=
    "yes" означал бы False, и клиент получил бы неполный ответ, будучи
    уверенным, что просил полный.
    """
    raw = request.query_params.get(name)
    if raw is None:
        return None
    lowered = raw.strip().lower()
    if lowered in ("true", "1"):
        return True
    if lowered in ("false", "0"):
        return False
    raise ValidationError({name: "Ожидается true или false."})


def _resolve_division_scope(request, division_id, permission_code):
    """Область видимости списочного запроса: None — всё дерево, иначе
    множество id подразделений.

    Область сужает выборку ВСЕГДА, даже когда division_id не задан:
    безскоуповый оператор видит всё дерево, скоупованный — только своё
    поддерево. Запрос ЧУЖОГО подразделения — 403, а не пустой ответ: пустой
    ответ неотличим от «там никого нет» и прячет отказ.

    Общий вход расхода и чтения статусов: двум спискам, отвечающим на один и
    тот же вопрос «что мне видно», расходиться незачем.
    """
    allowed = PermissionService.visible_division_ids(
        resolve_actor_id(request), permission_code
    )
    if division_id is None:
        return allowed
    subtree = DivisionTreeSelector.subtree_ids(division_id)
    scope = subtree if allowed is None else subtree & allowed
    if not scope:
        raise PermissionDenied("PERMISSION_DENIED")
    return scope


class DefaultPagination(LimitOffsetPagination):
    default_limit = 50


def paginated_response_schema(name, item_serializer):
    """Схема СТРАНИЧНОГО ответа: {count, next, previous, results[]}.

    Объявляется руками, потому что вьюхи раздела — plain ViewSet: spectacular
    выводит обёртку страницы только у GenericAPIView и иначе описал бы ответ
    голым массивом, которого клиент никогда не получит.

    many=False на КЛАССЕ обязателен: для действия с именем list эвристика
    иначе завернёт объект-страницу ещё и в массив.
    """
    return extend_schema_serializer(many=False)(
        inline_serializer(
            name=name,
            fields={
                "count": serializers.IntegerField(),
                "next": serializers.CharField(allow_null=True),
                "previous": serializers.CharField(allow_null=True),
                "results": item_serializer,
            },
        )
    )


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

    @extend_schema(
        responses=paginated_response_schema(
            "PaginatedUserRoleList", UserRoleSerializer(many=True)
        )
    )
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
    @extend_schema(
        responses=paginated_response_schema(
            "PaginatedTemporaryDutyList", TemporaryDutySerializer(many=True)
        )
    )
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
    """Статусы раздела ОМ: чтение, массовое создание и поштучная правка.

    GET   /api/operations/statuses/            — список (срез 11)
    GET   /api/operations/statuses/{id}/       — одна строка (срез 11)
    POST  /api/operations/statuses/bulk/       — пачка (срез 6)
    PATCH /api/operations/statuses/{id}/       — правка интервала и метаданных
    POST  /api/operations/statuses/{id}/cancel/ — отмена не начавшейся строки

    Тонкая вьюха поверх готовых сервисов: сериализатор → резолв области
    видимости из RBAC → вызов сервиса. Ни бизнес-логики, ни детекта
    конфликтов здесь нет; DomainError сервиса (400/403/404/409/422) уходит
    наверх и становится конвертом в ops_exception_handler, вьюха его НЕ
    ловит.

    Права РАЗНЫЕ у чтения и записи: списки и одиночное чтение — status.view
    (тот же гейт, что у расхода), запись — status.manage. Читатель расхода
    обязан уметь посмотреть строки, из которых расход сложился, но не править
    их.

    Грубый гейт права — RequirePermissionMixin; тонкую область видимости
    энфорсят: у пачки — сервис построчно, у чтения списка — фильтр по
    сотрудникам области, у одиночных маршрутов — _assert_status_in_scope ниже.
    Все резолвят её из RBAC актора: подразделению из тела запроса здесь не
    верят.
    """

    permission_map = {
        "list": _READ_STATUS_PERMISSION,
        "retrieve": _READ_STATUS_PERMISSION,
        "bulk": _BULK_STATUS_PERMISSION,
        "partial_update": _BULK_STATUS_PERMISSION,
        "cancel": _BULK_STATUS_PERMISSION,
    }
    # Поверхность: чтение, пачка, правка, отмена. PUT не открыт намеренно
    # (полная замена строки переписала бы неизменяемые поля — правка только
    # частичная), DELETE — тоже: строки не удаляются, а отменяются.
    http_method_names = ["get", "post", "patch", "options"]

    def _get_status_or_404(self, pk):
        """Строка по pk из пути; отсутствующая или нечисловая — 404 конвертом.

        pk роутера — произвольная строка: int() ДО запроса, иначе мусорный
        идентификатор ушёл бы ValueError → 500 вместо 404. Общий вход для
        правки и отмены — разъехаться этим двум ответам незачем.
        """
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
        return status_row

    def _assert_status_in_scope(
        self, request, status_row, permission_code=_BULK_STATUS_PERMISSION
    ):
        """Область видимости адресуемой строки — из RBAC актора.

        Право, под которым считается область, передаёт вызывающий: чтение
        спрашивает «что мне видно под status.view», правка — «что мне можно
        менять под status.manage». Зашитое одно право означало бы, что
        читатель без права записи не видит ни одной строки.

        Подразделение берётся по сотруднику строки через общий селектор (тот
        же, которым область считает пачка). None = безскоуповый/wildcard грант
        → всё дерево. Сотрудник без штатной единицы не принадлежит ничьей
        области — 403 (fail-closed, как в пачке).

        Отказ по области — DomainError → конверт {error_code}; отказ гейта
        права — PermissionDenied DRF → {detail}. Формы РАЗНЫЕ намеренно: оба
        403, и без различения тест одного зеленел бы от другого.
        """
        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), permission_code
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
        parameters=[
            OpenApiParameter(
                "business_date",
                OpenApiTypes.DATE,
                description=(
                    "Оставить строки, ЖИВЫЕ на эту дату (полуинтервал "
                    "[date_start, date_end)); без параметра — весь журнал."
                ),
            ),
            OpenApiParameter(
                "division_id",
                OpenApiTypes.INT,
                description="Корень поддерева; по умолчанию вся область актора.",
            ),
            OpenApiParameter(
                "employee_id", OpenApiTypes.INT, description="Один сотрудник."
            ),
            OpenApiParameter(
                "status_type_code",
                OpenApiTypes.STR,
                description="Код типа статуса, точное совпадение.",
            ),
            OpenApiParameter(
                "include_cancelled",
                OpenApiTypes.BOOL,
                description=(
                    "Включить отменённые строки; по умолчанию false — "
                    "отменённая строка это «записи нет»."
                ),
            ),
        ],
        responses=paginated_response_schema(
            "PaginatedOpsEmployeeStatusList", OpsEmployeeStatusSerializer(many=True)
        ),
        description=(
            "Список статусов раздела ОМ под правом status.view. Область "
            "видимости сужает выборку всегда: скоупованный оператор видит "
            "только сотрудников своего поддерева, запрос чужого подразделения "
            "получает 403, а не пустой список. Отменённые строки по умолчанию "
            "скрыты (include_cancelled=true — показать). Порядок ответа задаёт "
            "сервер: свежие интервалы первыми. 400 — нечитаемый параметр."
        ),
    )
    def list(self, request, *args, **kwargs):
        business_date = _parse_date_param(request, "business_date")
        division_id = _parse_int_param(request, "division_id")
        employee_id = _parse_int_param(request, "employee_id")
        include_cancelled = _parse_bool_param(request, "include_cancelled") is True
        status_type_code = request.query_params.get("status_type_code")

        queryset = OpsEmployeeStatus.objects.all()
        if not include_cancelled:
            # Отменённая строка для читателя — «записи нет»: тот же предикат,
            # которым её не видит расход.
            queryset = queryset.filter(cancelled_at__isnull=True)
        if business_date is not None:
            # period__contains едет по GiST-индексу и повторяет полуинтервал
            # ровно так, как его понимает домен; date_start<=d<=date_end
            # захватил бы день, в который статус уже кончился.
            queryset = queryset.filter(period__contains=business_date)
        if employee_id is not None:
            queryset = queryset.filter(employee_id=employee_id)
        if status_type_code:
            queryset = queryset.filter(status_type_code=status_type_code)

        scope = _resolve_division_scope(
            request, division_id, _READ_STATUS_PERMISSION
        )
        if scope is not None:
            queryset = queryset.filter(
                employee_id__in=StaffUnitSelector.employee_ids_in(scope)
            )
        # Порядок пинится здесь: у модели своего ordering нет, а страничная
        # выдача без полного порядка теряет и дублирует строки между
        # страницами. id — последний разрыв ничьей, он уникален.
        queryset = queryset.order_by("-date_start", "employee_id", "id")

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(
            OpsEmployeeStatusSerializer(page, many=True).data
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id строки статуса.",
            )
        ],
        responses={200: OpsEmployeeStatusSerializer},
        description=(
            "Одна строка статуса под правом status.view. 403 — нет права либо "
            "сотрудник вне области оператора; 404 — строки нет. Отменённая "
            "строка по прямому адресу отдаётся: её скрывает только список, "
            "где она была бы шумом."
        ),
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        status_row = self._get_status_or_404(pk)
        self._assert_status_in_scope(
            request, status_row, permission_code=_READ_STATUS_PERMISSION
        )
        return Response(OpsEmployeeStatusSerializer(status_row).data)

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
        status_row = self._get_status_or_404(pk)
        self._assert_status_in_scope(request, status_row)
        updated = update_status(
            status_row,
            # Актор — из контракта аутентификации, НИКОГДА из тела запроса.
            actor=resolve_actor_id(request),
            **form.validated_data,
        )
        return Response(OpsEmployeeStatusSerializer(updated).data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id отменяемой строки статуса.",
            )
        ],
        request=StatusCancelSerializer,
        responses={200: OpsEmployeeStatusSerializer},
        description=(
            "Отмена НЕ НАЧАВШЕЙСЯ (PLANNED) строки статуса с обязательной "
            "причиной. Начавшаяся или завершённая строка — факт, который "
            "случился: её закрывают раньше срока, а не отменяют (422). "
            "Строка не удаляется: отмена — записанный факт, после неё период "
            "снова свободен. 400 — причина пуста или не прислана; 403 — нет "
            "права status.manage либо сотрудник вне области; 404 — строки "
            "нет; 422 — не PLANNED, уже отменена или принадлежит проекции."
        ),
    )
    @action(detail=True, methods=["post"], url_path="cancel", url_name="cancel")
    def cancel(self, request, pk=None, *args, **kwargs):
        form = StatusCancelSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        status_row = self._get_status_or_404(pk)
        self._assert_status_in_scope(request, status_row)
        cancelled = cancel_status(
            status_row,
            # Кто отменил — из контракта аутентификации: cancelled_by это
            # факт, и присланному в теле имени здесь не верят.
            actor=resolve_actor_id(request),
            reason=form.validated_data["reason"],
        )
        return Response(OpsEmployeeStatusSerializer(cancelled).data)

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


class SecondmentViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Прикомандирование: откомандировать, вернуть и прочитать.

    GET   /api/operations/secondments/                       — список
    GET   /api/operations/secondments/{id}/                  — одна пара
    POST  /api/operations/secondments/                       — откомандировать
    POST  /api/operations/secondments/{id}/request-return/    — запрос возврата
    POST  /api/operations/secondments/{id}/confirm-return/    — подтверждение

    Тонкая вьюха поверх сервиса: сериализатор → область видимости → вызов.
    Правила пары (атомарность, конфликты, порядок рукопожатия, закрытие ног)
    живут в сервисе; его DomainError уходит наверх конвертом, вьюха его НЕ
    ловит.

    ОБЛАСТЬ ВИДИМОСТИ У ТРЁХ ДЕЙСТВИЙ РАЗНАЯ — это и есть смысл рукопожатия:
    откомандировывает и запрашивает возврат ШТАТНОЕ подразделение (проверяем
    сторону «откуда»), подтверждает возврат ПРИНИМАЮЩЕЕ (сторона «куда»).
    Одна общая проверка сделала бы обе стороны одним лицом, и подтверждение
    перестало бы что-либо подтверждать.

    У ЧТЕНИЯ область ОБЕ стороны сразу: пара — общее дело двух подразделений,
    и каждое из них должно видеть её целиком. Право чтения — status.view, как
    у статусов и расхода: право записи чтения не открывает и наоборот.
    """

    permission_map = {
        "list": _READ_STATUS_PERMISSION,
        "retrieve": _READ_STATUS_PERMISSION,
        "create": _BULK_STATUS_PERMISSION,
        "request_return": _BULK_STATUS_PERMISSION,
        "confirm_return": _BULK_STATUS_PERMISSION,
    }
    # PUT/DELETE не открыты намеренно: пару не переписывают и не удаляют —
    # её единственная законная «правка» это возврат отдельным действием.
    http_method_names = ["get", "post", "options"]

    def _visible_sides_filter(self, request):
        """Условие видимости пары: своя ЛЮБАЯ из двух сторон.

        None — безскоуповый/wildcard грант, условия нет вовсе. Пара видна и
        штатному, и принимающему подразделению: у откомандирования два
        участника, и показывать её лишь одной стороне значило бы прятать от
        второй её собственных людей.
        """
        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), _READ_STATUS_PERMISSION
        )
        if allowed is None:
            return None
        return Q(from_division_id__in=allowed) | Q(to_division_id__in=allowed)

    def _get_secondment_or_404(self, pk):
        """Связь по pk из пути; отсутствующая или нечисловая — 404 конвертом.

        Как и у статусов: int() ДО запроса, иначе мусорный идентификатор ушёл
        бы ValueError → 500 вместо 404.
        """
        try:
            secondment_id = int(pk)
        except (TypeError, ValueError):
            secondment_id = None
        row = (
            Secondment.objects.filter(pk=secondment_id).first()
            if secondment_id is not None
            else None
        )
        if row is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"secondment_id": str(pk)},
                message="Прикомандирование не найдено.",
            )
        return row

    def _assert_division_in_scope(self, request, division_id, *, field):
        """Подразделение стороны обязано входить в область актора.

        None = безскоуповый/wildcard грант → обе стороны. Отказ — DomainError
        (конверт {error_code}), а не PermissionDenied DRF: право у оператора
        ЕСТЬ, ему не хватает именно области — и без различения форм тест
        одного отказа зеленел бы от другого.
        """
        allowed = PermissionService.visible_division_ids(
            resolve_actor_id(request), _BULK_STATUS_PERMISSION
        )
        if allowed is None:
            return
        if division_id not in allowed:
            raise DomainError(
                "PERMISSION_DENIED",
                403,
                detail={field: str(division_id)},
                message="Подразделение вне области видимости оператора.",
            )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "employee_id", OpenApiTypes.INT, description="Один сотрудник."
            ),
            OpenApiParameter(
                "division_id",
                OpenApiTypes.INT,
                description=(
                    "Пары, где это подразделение — ЛЮБАЯ из двух сторон "
                    "(поддерево, как и область видимости)."
                ),
            ),
            OpenApiParameter(
                "state",
                OpenApiTypes.STR,
                enum=[choice.value for choice in SecondmentState],
                description="Стадия рукопожатия.",
            ),
        ],
        responses=paginated_response_schema(
            "PaginatedSecondmentList", SecondmentSerializer(many=True)
        ),
        description=(
            "Список пар прикомандирования под правом status.view. Пара видна "
            "ОБЕИМ сторонам — и штатному подразделению, и принимающему. "
            "Запрос чужого подразделения — 403, а не пустой список. Порядок "
            "задаёт сервер: свежие пары первыми. 400 — нечитаемый параметр."
        ),
    )
    def list(self, request, *args, **kwargs):
        employee_id = _parse_int_param(request, "employee_id")
        division_id = _parse_int_param(request, "division_id")
        state = request.query_params.get("state")
        if state is not None and state not in SecondmentState.values:
            raise ValidationError(
                {"state": f"Ожидается одно из: {', '.join(SecondmentState.values)}."}
            )

        # Стадия фильтруется ТОЙ ЖЕ аннотацией, что отдаётся в ответе: второй
        # набор условий разошёлся бы с полем state в строках.
        queryset = Secondment.objects.with_state()
        if employee_id is not None:
            queryset = queryset.filter(employee_id=employee_id)
        if state is not None:
            queryset = queryset.filter(state_annotation=state)
        if division_id is not None:
            # Запрошенное подразделение проходит ту же проверку области, что
            # и у расхода со списком статусов: чужое — отказ, не пустота.
            subtree = _resolve_division_scope(
                request, division_id, _READ_STATUS_PERMISSION
            )
            queryset = queryset.filter(
                Q(from_division_id__in=subtree) | Q(to_division_id__in=subtree)
            )
        else:
            sides = self._visible_sides_filter(request)
            if sides is not None:
                queryset = queryset.filter(sides)
        # Порядок пинится здесь: у модели своего ordering нет, а страничная
        # выдача без полного порядка теряет и дублирует строки между
        # страницами. id — последний разрыв ничьей, он уникален.
        queryset = queryset.order_by("-created_at", "id")

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(
            SecondmentSerializer(page, many=True).data
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id связи прикомандирования.",
            )
        ],
        responses={200: SecondmentSerializer},
        description=(
            "Одна пара под правом status.view; видна обеим сторонам. 403 — "
            "нет права либо ни одна сторона пары не входит в область "
            "оператора; 404 — связи нет."
        ),
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        secondment = self._get_secondment_or_404(pk)
        sides = self._visible_sides_filter(request)
        if sides is not None and not Secondment.objects.filter(
            sides, pk=secondment.pk
        ).exists():
            raise DomainError(
                "PERMISSION_DENIED",
                403,
                detail={"secondment_id": str(secondment.pk)},
                message="Ни одна сторона пары не входит в область оператора.",
            )
        return Response(SecondmentSerializer(secondment).data)

    @extend_schema(
        request=SecondmentCreateSerializer,
        responses={201: SecondmentSerializer},
        description=(
            "Откомандировать сотрудника: создаётся связанная пара "
            "DETACHED+ATTACHED и связь между ними, одной транзакцией. "
            "Штатное подразделение берётся из штатной единицы сотрудника, а "
            "не из тела запроса. 403 — нет права status.manage, сотрудник вне "
            "области оператора либо сотрудник уже откомандирован; 400 — форма "
            "тела или принимающее равно штатному; 404 — нет сотрудника или "
            "принимающего подразделения; 409 — мягкое пересечение (обхода у "
            "этого пути нет); 422 — жёсткое пересечение, интервал, границы "
            "найма или отсутствие штатной единицы."
        ),
    )
    def create(self, request, *args, **kwargs):
        form = SecondmentCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data
        # Сторона «откуда» — по штатной единице сотрудника: тот же общий
        # селектор, которым область считают пачка и правка статусов.
        # Сотрудник без слота не принадлежит ничьей области (fail-closed);
        # безскоуповому актору его отклонит уже сервис — своим 422.
        home_division_id = StaffUnitSelector.divisions_of(
            [data["employee_id"]]
        ).get(data["employee_id"])
        self._assert_division_in_scope(
            request, home_division_id, field="employee_id"
        )
        secondment = initiate_secondment(
            data["employee_id"],
            to_division_id=data["to_division_id"],
            date_start=data["date_start"],
            date_end=data["date_end"],
            # Актор — из контракта аутентификации, НИКОГДА из тела запроса.
            actor=resolve_actor_id(request),
            document_basis=data.get("document_basis", ""),
        )
        return Response(
            SecondmentSerializer(secondment).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id связи прикомандирования.",
            )
        ],
        request=None,
        responses={200: SecondmentSerializer},
        description=(
            "Запрос возврата — первый такт рукопожатия, его делает ШТАТНОЕ "
            "подразделение. 403 — нет права либо штатное подразделение пары "
            "вне области оператора; 404 — связи нет; 422 — возврат уже "
            "запрошен или подтверждён."
        ),
    )
    @action(
        detail=True,
        methods=["post"],
        url_path="request-return",
        url_name="request-return",
    )
    def request_return(self, request, pk=None, *args, **kwargs):
        secondment = self._get_secondment_or_404(pk)
        # Запрашивает тот, КОМУ человека вернут, — штатное подразделение.
        self._assert_division_in_scope(
            request, secondment.from_division_id, field="from_division_id"
        )
        requested = request_return_service(
            secondment, actor=resolve_actor_id(request)
        )
        return Response(SecondmentSerializer(requested).data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id связи прикомандирования.",
            )
        ],
        request=SecondmentReturnConfirmSerializer,
        responses={200: SecondmentSerializer},
        description=(
            "Подтверждение возврата — второй такт, его делает ПРИНИМАЮЩЕЕ "
            "подразделение; подтверждение закрывает обе ноги. Возврат "
            "вступает в силу со следующего дня: сегодня сотрудник ещё "
            "числится прикомандированным. Не начавшаяся пара отменяется, и "
            "причина уходит в её факты отмены. 403 — нет права либо "
            "принимающее подразделение пары вне области оператора; 404 — "
            "связи нет; 422 — возврат не запрошен или уже подтверждён."
        ),
    )
    @action(
        detail=True,
        methods=["post"],
        url_path="confirm-return",
        url_name="confirm-return",
    )
    def confirm_return(self, request, pk=None, *args, **kwargs):
        form = SecondmentReturnConfirmSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        secondment = self._get_secondment_or_404(pk)
        # Подтверждает та сторона, У КОТОРОЙ человек находится, —
        # принимающая. Штатное подразделение здесь НЕ проверяется: иначе
        # подтверждать мог бы тот же оператор, что и запрашивал.
        self._assert_division_in_scope(
            request, secondment.to_division_id, field="to_division_id"
        )
        confirmed = confirm_return_service(
            secondment,
            actor=resolve_actor_id(request),
            reason=form.validated_data.get("reason", ""),
        )
        return Response(SecondmentSerializer(confirmed).data)


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
        # None = глобальная видимость → всё дерево; чужое подразделение — 403
        # (общий резолв со списком статусов).
        scope = _resolve_division_scope(request, division_id, "status.view")

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
                        "off_list": row.off_list,
                        "columns": row.columns,
                    }
                    for row in report.rows
                ],
                "totals": {
                    "staff_total": report.totals.staff_total,
                    "list_total": report.totals.list_total,
                    "vacancies": report.totals.vacancies,
                    "attached": report.totals.attached,
                    "off_list": report.totals.off_list,
                    "columns": report.totals.columns,
                },
                "warnings": report.warnings,
            }
        )
