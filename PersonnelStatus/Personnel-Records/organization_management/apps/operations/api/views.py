"""API раздела ОМ: идентичность и администрирование RBAC (порт
apps/operations/api/views.py из Backend/VAPS).

Отличия от источника:
- актор — SimpleJWT-пользователь старого проекта (resolve_actor_id), НЕ
  request.actor_id внешнего КУ; superuser-шортката НЕТ намеренно: admin
  получает wildcard через назначение роли ADMIN, а не через флаг Django;
- тела запросов проходят через сериализаторы (400 вместо KeyError→500 в
  источнике), идентичность в теле не принимается — только из аутентификации.
"""
from datetime import timedelta

from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime
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
    DailySubmissionAmendSerializer,
    DailySubmissionCreateSerializer,
    GrantTemporaryDutyRequestSerializer,
    OpsDailySubmissionAmendedSerializer,
    OpsDailySubmissionDetailSerializer,
    OpsDailySubmissionSerializer,
    OpsAuditLogSerializer,
    OpsEmployeeStatusSerializer,
    PermissionSerializer,
    RoleSerializer,
    SecondmentCreateSerializer,
    SecondmentReturnConfirmSerializer,
    SecondmentSerializer,
    StatusCancelSerializer,
    StatusTypeSerializer,
    StatusUpdateSerializer,
    SubmittedExpenseFilterSerializer,
    OpsTomorrowBlockOverrideSerializer,
    TemporaryDutySerializer,
    TrafficLightDivisionFilterSerializer,
    TomorrowBlockOverrideCreateSerializer,
    TrafficLightTreeFilterSerializer,
    UserRoleSerializer,
)
from organization_management.apps.operations.block_override import (
    override_tomorrow_block,
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
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
    SecondmentState,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
    OpsAuditLogSelector,
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
    submitted_expense,
)
from organization_management.apps.operations.tomorrow_gate import (
    assert_tomorrow_not_blocked,
)
from organization_management.apps.operations.traffic_light import (
    TrafficLightStatus,
    division_traffic_light,
    traffic_light_tree,
)

# Право на запись статусов; им же резолвится область видимости пачки.
_BULK_STATUS_PERMISSION = "status.manage"
# Право чтения журнала раздела — существующий код каталога (seed_operations),
# нового не заводим: каталог прав закрытый мир.
_AUDIT_PERMISSION = "audit.view"
# Право на чтение статусов — то же, что у расхода: кто видит агрегат, тот
# видит и строки, из которых он сложился.
_READ_STATUS_PERMISSION = "status.view"
# Право на сдачу дня — существующий код каталога («отметки в суточном
# отчёте»), нового не заводим. Поправка сданного пойдёт под
# daily_report.correct: сдать день и переписать сданное — разные полномочия,
# и одним кодом их объединять значило бы выдать каждому отмечающему право
# задним числом менять подписанное.
_SUBMIT_DAY_PERMISSION = "daily_report.mark_update"
# Право на поправку сданного — своё («корректировка суточного отчёта»).
_AMEND_DAY_PERMISSION = "daily_report.correct"
# Право на обход блокировки завтрашнего дня — тоже своё: обход снимает замок
# со всего раздела на целый день, и вывести его из права отмечать значило бы
# раздать полномочие руководителя каждому оператору.
_OVERRIDE_BLOCK_PERMISSION = "daily_report.override_block"
# Насколько далеко вперёд можно записать обход. Строка неотзывна, поэтому
# опечатка в годе открыла бы день, о котором никто уже не вспомнит; неделя —
# горизонт, на котором о завтрашнем расходе вообще договариваются.
MAX_OVERRIDE_HORIZON_DAYS = 7


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


def _parse_datetime_param(request, name):
    """Момент ISO из query или None; мусор и НАИВНОЕ время — 400.

    Зона обязательна, и это не придирка: журнал хранит момент в UTC, а
    наивный «2026-08-04T00:00» в поясе +05 сдвигает границу окна на пять
    часов — читатель, попросивший «за 4 августа», молча получил бы чужой
    день. Ровно тем же доводом clock.override() отвергает наивные datetime;
    двум границам раздела расходиться в этом незачем.
    """
    raw = request.query_params.get(name)
    if raw is None:
        return None
    parsed = parse_datetime(raw)
    if parsed is None:
        raise ValidationError(
            {name: "Ожидается момент в формате ISO 8601 с указанием зоны."}
        )
    if parsed.utcoffset() is None:
        raise ValidationError({name: "Укажите часовой пояс (например, +05:00 или Z)."})
    return parsed


def _parse_choice_param(request, name, allowed):
    """Значение из ЗАКРЫТОГО множества или None; чужое — 400, не пустой ответ.

    Словарь событий и типов сущностей закрыт (audit_service), поэтому опечатка
    в фильтре — это ошибка запроса, а не «ничего не найдено». Молчаливая
    пустая страница на `action=STATUS_CREATE` убедила бы читателя, что таких
    событий не было.
    """
    raw = request.query_params.get(name)
    if raw is None:
        return None
    if raw not in allowed:
        raise ValidationError(
            {name: f"Допустимые значения: {', '.join(sorted(allowed))}."}
        )
    return raw


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


def _assert_division_in_scope(request, division_id, permission_code, *, field):
    """Подразделение ЗАПИСИ обязано входить в область актора.

    None = безскоуповый/wildcard грант → любое подразделение. Отказ —
    DomainError (конверт {error_code}), а не PermissionDenied DRF: право у
    оператора ЕСТЬ, ему не хватает именно области — и без различения форм
    тест одного отказа зеленел бы от другого.

    Отличие от `_resolve_division_scope` (списки): там подразделение может
    быть не задано и область СУЖАЕТ выборку, здесь адресат записи всегда
    один и вопрос двоичный — своё или чужое.
    """
    allowed = PermissionService.visible_division_ids(
        resolve_actor_id(request), permission_code
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
    # В рантайме plain ViewSet этот атрибут не читает — list() создаёт
    # DefaultPagination() сам. Он объявлен ради схемы: им spectacular
    # документирует limit/offset, которые вьюха реально исполняет.
    pagination_class = DefaultPagination

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

    # Только ради схемы: документирует limit/offset (см. TemporaryDutyViewSet).
    pagination_class = DefaultPagination

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

    # Только ради схемы: документирует limit/offset (см. TemporaryDutyViewSet).
    pagination_class = DefaultPagination

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
        """Подразделение стороны обязано входить в область актора."""
        _assert_division_in_scope(
            request, division_id, _BULK_STATUS_PERMISSION, field=field
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
    """Расход (строевая записка) — живой и по сданному дню.

    GET /api/operations/strength-report/           — ЖИВОЙ расход
    GET /api/operations/strength-report/submitted/ — расход СДАННОГО дня

    Чтение под status.view. Область видимости сужает выборку ВСЕГДА, даже
    когда division_id не задан: безскоуповый оператор видит всё дерево,
    скоупованный — только своё поддерево, и запрос чужого подразделения ему
    отвечает 403, а не пустым отчётом (пустой отчёт неотличим от «там никого
    нет» и прячет отказ).

    business_date — явный параметр с умолчанием «сегодня» по Clock раздела:
    сервис расхода часы не читает, иначе расход на вчера тихо посчитался бы
    на сегодня.

    ДВА МАРШРУТА, А НЕ ФЛАГ У ОДНОГО: живой расход отвечает «как обстоит
    сейчас», сданный — «под чем подписались». Это разные вопросы с разными
    ответами (в том числе разным НАБОРОМ полей: снимок не хранит штат,
    вакансии и «+N»), и параметр `?submitted=true` заставил бы один контракт
    описывать две несовпадающие формы — клиент не смог бы полагаться ни на
    одну. Совпадать они обязаны только на нетронутом дне, и на этом стоит
    светофор.
    """

    permission_map = {
        "list": _READ_STATUS_PERMISSION,
        "submitted": _READ_STATUS_PERMISSION,
    }
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
        # Порядок гардов: сперва область (403), потом бизнес-правило (422) —
        # чужому подразделению нельзя даже сообщать, заблокирован ли день.
        # Гейт только ЗДЕСЬ: сданный расход отвечает про день, который уже
        # сдан, и блокировать чтение подписанного нечем и незачем.
        assert_tomorrow_not_blocked(
            business_date=business_date, today=Clock.today_local()
        )

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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "division_id",
                OpenApiTypes.INT,
                required=True,
                description=(
                    "Подразделение — ОДНО и обязательно: сдают поштучно, "
                    "снимка поддерева не существует."
                ),
            ),
            OpenApiParameter(
                "business_date",
                OpenApiTypes.DATE,
                description="День; по умолчанию сегодняшний по часам раздела.",
            ),
        ],
        responses={
            200: extend_schema_serializer(many=False)(
                inline_serializer(
                    name="SubmittedExpenseResponse",
                    fields={
                        "division_id": serializers.IntegerField(),
                        "business_date": serializers.DateField(),
                        "version": serializers.IntegerField(),
                        "submitted_at": serializers.DateTimeField(),
                        "late": serializers.BooleanField(),
                        "columns": serializers.ListField(
                            child=serializers.CharField()
                        ),
                        "list_total": serializers.IntegerField(),
                        "off_list": serializers.IntegerField(),
                        "counts": serializers.DictField(
                            child=serializers.IntegerField()
                        ),
                    },
                )
            )
        },
        description=(
            "Расход по СДАННОМУ дню: числа воспроизводятся из снимка "
            "действующей версии и не меняются от сегодняшних правок. Полей "
            "меньше, чем у живого расхода: снимок не хранит штат, вакансии и "
            "приданных, и подмешивать их живыми значило бы выдать "
            "наполовину сегодняшние числа за сданные вчера. Паспорт версии "
            "(version/submitted_at/late) едет вместе с числами. 400 — "
            "подразделение не указано или параметр нечитаем; 403 — нет права "
            "status.view либо подразделение вне области; 404 — подразделения "
            "нет (ENTITY_NOT_FOUND) либо день не сдан (DAY_NOT_SUBMITTED); "
            "422 — в снимке код статуса вне справочника."
        ),
    )
    @action(detail=False, methods=["get"], url_path="submitted")
    def submitted(self, request, *args, **kwargs):
        form = SubmittedExpenseFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        # Порядок гардов НЕСУЩИЙ и тот же, что у светофора: область раньше
        # существования, иначе 404 стал бы для чужака оракулом существования
        # подразделений.
        _assert_division_in_scope(
            request, division_id, _READ_STATUS_PERMISSION, field="division_id"
        )
        if not DivisionTreeSelector.exists(division_id):
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"division_id": str(division_id)},
                message="Подразделение не найдено.",
            )
        business_date = form.validated_data.get("business_date") or Clock.today_local()
        try:
            expense = submitted_expense(division_id, business_date)
        except ValueError as error:
            # Снимок ссылается на код вне справочника — дефект ДАННЫХ, а не
            # сервера (тот же перевод, что у точечного светофора): 500 сказал
            # бы «у нас сломалось», а нули в колонках выдали бы поломку за
            # пустой день.
            raise DomainError(
                "UNRESOLVABLE_STATUS_TYPE",
                422,
                detail={"division_id": str(division_id)},
                message="В снимке сдачи код статуса вне справочника.",
            ) from error
        if expense is None:
            # Отдельный код, а не общий ENTITY_NOT_FOUND: «дня не сдавали» и
            # «нет такого подразделения» — разные новости, и под одним кодом
            # клиент не отличил бы опечатку в id от несданного дня.
            raise DomainError(
                "DAY_NOT_SUBMITTED",
                404,
                detail={
                    "division_id": str(division_id),
                    "business_date": business_date.isoformat(),
                },
                message="День не сдан: расхода по нему не существует.",
            )
        return Response(
            {
                "division_id": expense.division_id,
                # Дата эхом (как у светофора): сервер считает по часам
                # раздела, экран — по браузеру.
                "business_date": expense.business_date.isoformat(),
                "version": expense.version,
                "submitted_at": expense.submitted_at.isoformat(),
                "late": expense.late,
                # `columns` значит ПОРЯДОК колонок на обоих маршрутах расхода,
                # числа лежат в `counts`. Отдать здесь словарь под тем же
                # именем значило бы дать одному имени в одном разделе два
                # смысла — клиенту пришлось бы разбирать тип поля, чтобы
                # понять, что он получил.
                "columns": list(expense.columns),
                "list_total": expense.list_total,
                "off_list": expense.off_list,
                "counts": expense.columns,
            }
        )


class AuditLogViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Журнал раздела ОМ: только чтение.

    GET /api/operations/audit-logs/      — лента с фильтрами
    GET /api/operations/audit-logs/{id}/ — одна запись

    ТОЛЬКО ЧТЕНИЕ, и это не формальность: журнал append-only на уровне БД
    (триггер, срез 20), и открытая запись по HTTP обещала бы правку, которую
    база всё равно отвергнет 500-м.

    Держит это ОТСУТСТВИЕ пишущих действий: у ViewSet нет create/update/
    destroy, роутер их и не маршрутизирует, поэтому POST/PUT/PATCH/DELETE
    получают 405 — раньше, чем гейт права успел бы ответить сбивающим с толку
    403. Владелец один: `http_method_names` здесь стоял и был снят как
    декорация — его снятие не роняло ни одного теста (проверено красной
    пробой). Открыть запись можно только новым действием — и это будет видно
    в коде, а не спрятано за списком глаголов.

    Право audit.view — уже существующий код каталога, нового не заводил:
    каталог прав закрытый мир. Область ПЛОСКАЯ (владелец решения и довод —
    OpsAuditLogSelector): держатель права видит журнал целиком.

    Это ВТОРОЙ журнал проекта и он о другом: старый /api/audit/ пишет
    middleware на каждый успешный HTTP-запрос, здесь же лежат доменные
    события раздела. Ни его маршруты, ни его экраны не трогаются.
    """

    # Только ради схемы: документирует limit/offset (см. TemporaryDutyViewSet).
    pagination_class = DefaultPagination

    permission_map = {"list": _AUDIT_PERMISSION, "retrieve": _AUDIT_PERMISSION}

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "entity_type",
                OpenApiTypes.STR,
                description=(
                    "Тип сущности из закрытого словаря "
                    "(employee_status, secondment, employee)."
                ),
            ),
            OpenApiParameter(
                "entity_id",
                OpenApiTypes.INT,
                description="Идентификатор сущности; вместе с entity_type — её лента.",
            ),
            OpenApiParameter(
                "actor", OpenApiTypes.STR, description="Актор события, точное совпадение."
            ),
            OpenApiParameter(
                "action",
                OpenApiTypes.STR,
                description="Код события из закрытого словаря audit_service.ACTIONS.",
            ),
            OpenApiParameter(
                "created_from",
                OpenApiTypes.DATETIME,
                description="Нижняя граница окна, включительно (ISO 8601 с зоной).",
            ),
            OpenApiParameter(
                "created_to",
                OpenApiTypes.DATETIME,
                description="Верхняя граница окна, ИСКЛЮЧИТЕЛЬНО (ISO 8601 с зоной).",
            ),
        ],
        responses=paginated_response_schema(
            "PaginatedOpsAuditLogList", OpsAuditLogSerializer(many=True)
        ),
        description=(
            "Лента журнала раздела под правом audit.view. Окно "
            "[created_from, created_to) полуоткрытое — соседние окна не "
            "покажут одну строку дважды. Неизвестный тип сущности или код "
            "события — 400, а не пустая страница. Порядок задаёт сервер: "
            "свежие первыми, при равном времени (пачка пишется одним "
            "моментом) — по убыванию id."
        ),
    )
    def list(self, request, *args, **kwargs):
        queryset = OpsAuditLogSelector.list(
            entity_type=_parse_choice_param(
                request, "entity_type", audit_service.ENTITY_TYPES
            ),
            entity_id=_parse_int_param(request, "entity_id"),
            actor_user_id=request.query_params.get("actor"),
            action=_parse_choice_param(request, "action", audit_service.ACTIONS),
            created_from=_parse_datetime_param(request, "created_from"),
            created_to=_parse_datetime_param(request, "created_to"),
        )
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(
            OpsAuditLogSerializer(page, many=True).data
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id записи журнала.",
            )
        ],
        responses={200: OpsAuditLogSerializer},
        description=(
            "Одна запись журнала под правом audit.view. 404 — записи нет "
            "либо идентификатор нечисловой."
        ),
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        # int() ДО запроса: pk роутера — произвольная строка, и мусорный
        # идентификатор ушёл бы ValueError → 500 вместо 404 (тот же приём, что
        # у _get_status_or_404).
        try:
            entry_id = int(pk)
        except (TypeError, ValueError):
            entry_id = None
        entry = (
            OpsAuditLogSelector.list().filter(pk=entry_id).first()
            if entry_id is not None
            else None
        )
        if entry is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"audit_log_id": str(pk)},
                message="Запись журнала не найдена.",
            )
        return Response(OpsAuditLogSerializer(entry).data)


class DailySubmissionViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Сдача дня подразделением.

    GET  /api/operations/daily-submissions/            — список сдач
    GET  /api/operations/daily-submissions/{id}/       — одна версия со снимком
    POST /api/operations/daily-submissions/            — сдать день
    POST /api/operations/daily-submissions/{id}/amend/ — поправить сданное

    Тонкая вьюха поверх сервиса: форма тела → область записи → вызов. Окно
    дат, повторная сдача, событие и отметка опоздания живут в
    day_submission_service и покрыты его тестами; DomainError сервиса уходит
    наверх конвертом, вьюха его НЕ ловит.

    ЧТЕНИЕ ИДЁТ ПОД status.view — тем же правом, что расход и строевая
    записка. Снимок сдачи это тот же состав и те же факты статусов, которые
    status.view уже открывает, а сдача добавляет к ним лишь момент и подпись;
    заводить для них более строгое право значило бы защищать одни и те же
    сведения по-разному в зависимости от маршрута. Право ЗАПИСИ на чтение не
    ставится намеренно (в источнике читают под mark_update): наблюдатель не
    обязан иметь права отмечать.

    ПРАВА У ДЕЙСТВИЙ ЗАПИСИ РАЗНЫЕ: сдача под daily_report.mark_update
    («отметки в суточном отчёте»), поправка под daily_report.correct
    («корректировка») — сдать день и переписать сданное разные полномочия,
    и общий код выдал бы право задним числом менять подписанное каждому,
    кому разрешили отмечать.
    """

    # Только ради схемы: документирует limit/offset (см. TemporaryDutyViewSet).
    pagination_class = DefaultPagination

    permission_map = {
        "list": _READ_STATUS_PERMISSION,
        "retrieve": _READ_STATUS_PERMISSION,
        "create": _SUBMIT_DAY_PERMISSION,
        "amend": _AMEND_DAY_PERMISSION,
    }
    # PUT/PATCH/DELETE не открыты: сдача иммутабельна, её единственная
    # законная «правка» — поправка отдельным действием со своей причиной.
    http_method_names = ["get", "post", "options"]

    def _get_submission_or_404(self, pk):
        """Строка сдачи по pk из пути; отсутствующая или нечисловая — 404.

        int() ДО запроса, как у статусов и пар: мусорный идентификатор ушёл
        бы ValueError → 500 вместо 404.
        """
        try:
            submission_id = int(pk)
        except (TypeError, ValueError):
            submission_id = None
        row = (
            OpsDailySubmission.objects.filter(pk=submission_id).first()
            if submission_id is not None
            else None
        )
        if row is None:
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"submission_id": str(pk)},
                message="Сдача не найдена.",
            )
        return row

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "division_id",
                OpenApiTypes.INT,
                description="Подразделение и его поддерево.",
            ),
            OpenApiParameter(
                "business_date", OpenApiTypes.DATE, description="Один день."
            ),
            OpenApiParameter(
                "history",
                OpenApiTypes.BOOL,
                description=(
                    "true — вместе с вытесненными версиями; по умолчанию "
                    "только действующие."
                ),
            ),
        ],
        responses=paginated_response_schema(
            "PaginatedOpsDailySubmissionList", OpsDailySubmissionSerializer(many=True)
        ),
        description=(
            "Список сдач под правом status.view — БЕЗ снимков (снимок отдаёт "
            "только чтение одной версии). По умолчанию видны действующие "
            "версии, история — по флагу. Запрос чужого подразделения — 403, "
            "а не пустой список. Порядок задаёт сервер: свежий день первым, "
            "внутри дня свежая версия. 400 — нечитаемый параметр."
        ),
    )
    def list(self, request, *args, **kwargs):
        division_id = _parse_int_param(request, "division_id")
        # Область сужает выборку ВСЕГДА, даже без division_id — общий
        # резолвер списков раздела; чужое подразделение даёт 403, а не
        # пустую страницу, неотличимую от «там не сдавали».
        scope = _resolve_division_scope(request, division_id, _READ_STATUS_PERMISSION)
        queryset = DailySubmissionSelector.list(
            scope=scope,
            business_date=_parse_date_param(request, "business_date"),
            history=bool(_parse_bool_param(request, "history")),
        )
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(
            OpsDailySubmissionSerializer(page, many=True).data
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id КОНКРЕТНОЙ версии сдачи.",
            )
        ],
        responses={200: OpsDailySubmissionDetailSerializer},
        description=(
            "Одна версия сдачи со СНИМКОМ состава и фактов — источник расхода "
            "и светофора. Отдаётся ЗАПРОШЕННАЯ версия, действующая или "
            "вытесненная: щит доказывает конкретное заявление, а не последнее. "
            "403 — нет права status.view либо подразделение вне области; "
            "404 — версии с таким id нет."
        ),
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        submission = self._get_submission_or_404(pk)
        # Область — по подразделению найденной строки, тем же правом, что и
        # список: право записи чтения не открывает и наоборот.
        _assert_division_in_scope(
            request, submission.division_id, _READ_STATUS_PERMISSION,
            field="division_id",
        )
        return Response(OpsDailySubmissionDetailSerializer(submission).data)

    @extend_schema(
        request=DailySubmissionCreateSerializer,
        responses={201: OpsDailySubmissionSerializer},
        description=(
            "Сдать день за подразделение: собирается снимок состава и фактов, "
            "пишется версия 1 и событие журнала. Актор — из аутентификации, "
            "не из тела. 400 — форма тела; 403 — нет права "
            "daily_report.mark_update либо подразделение вне области "
            "оператора; 404 — подразделения нет; 409 — день уже сдан "
            "(пересдача — это поправка); 422 — дата вне окна сдачи."
        ),
    )
    def create(self, request, *args, **kwargs):
        form = DailySubmissionCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        # Область проверяется ДО сервиса: иначе чужак узнавал бы о
        # существовании подразделения по разнице между 404 и 403.
        _assert_division_in_scope(
            request, division_id, _SUBMIT_DAY_PERMISSION, field="division_id"
        )
        submission = submit_day(
            division_id=division_id,
            business_date=form.validated_data["business_date"],
            # Актор — из контракта аутентификации, НИКОГДА из тела запроса.
            actor=resolve_actor_id(request),
        )
        return Response(
            OpsDailySubmissionSerializer(submission).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="id ЛЮБОЙ версии дня — поправляется цепочка.",
            )
        ],
        request=DailySubmissionAmendSerializer,
        responses={201: OpsDailySubmissionAmendedSerializer},
        description=(
            "Поправить сданный день: пишется НОВАЯ версия со свежим снимком, "
            "прежняя сохраняется целиком. Причина и санкция обязательны. "
            "403 — нет права daily_report.correct либо подразделение вне "
            "области оператора; 404 — версии с таким id нет; 409 — гонка "
            "поправок; 422 — день не сдан (поправлять нечего)."
        ),
    )
    @action(detail=True, methods=["post"])
    def amend(self, request, pk=None, *args, **kwargs):
        form = DailySubmissionAmendSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # {id} адресует ЦЕПОЧКУ, а не версию: голову сервис перерезолвит сам,
        # поэтому ссылка на устаревшую версию поправляет тот же день. Иначе
        # клиенту пришлось бы сначала выяснять текущий номер версии — а
        # выяснять его пока негде, чтения сдач ещё нет.
        submission = self._get_submission_or_404(pk)
        # Область — по подразделению НАЙДЕННОЙ строки: подразделение в теле
        # не принимается, иначе поправку можно было бы адресовать одному
        # дню, а гейт пройти по другому.
        _assert_division_in_scope(
            request, submission.division_id, _AMEND_DAY_PERMISSION,
            field="division_id",
        )
        amended = amend_day(
            division_id=submission.division_id,
            business_date=submission.business_date,
            # Актор — из контракта аутентификации, НИКОГДА из тела запроса.
            actor=resolve_actor_id(request),
            reason=form.validated_data["reason"],
            sanction=form.validated_data["sanction"],
            # triggered_by_status_id остаётся None: происхождение поправки
            # ставит система, а не клиент (см. сериализатор).
        )
        return Response(
            OpsDailySubmissionAmendedSerializer(amended).data,
            status=status.HTTP_201_CREATED,
        )


class TrafficLightViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Свод светофора поддерева плоским списком.

    GET /api/operations/traffic-light/tree/?root_division_id=&business_date=
    GET /api/operations/traffic-light/{division_id}/?business_date=

    Вьюха НЕ считает цвет: status/late приходят из свода как есть, а она
    добавляет ровно то, чего у свода нет, — имя и родителя из общего селектора
    дерева плюс гарды, которых у сервиса нет: 403 на чужой корень и 404 на
    несуществующий. Порядок гардов НЕСУЩИЙ: сначала область, потом
    существование — обратный сделал бы 404 оракулом существования для чужака.

    Право чтения — status.view, то же, что у расхода, статусов и сдач: цвет
    выводится из тех же сведений, и своего кода ему не нужно.

РАЗДЕЛЕНИЕ ДВУХ ЧТЕНИЙ: свод отвечает «куда смотреть» и расхождения не
    несёт; поимённое расхождение отдаёт точечное чтение узла. Возить drift по
    всему дереву значило бы гонять детали, нужные на одном узле из сотни, а
    прятать их совсем — оставить дежурного с жёлтым цветом и без ответа на
    вопрос «кого проверять».

    ТОЧЕЧНОЕ ЧТЕНИЕ — СВОЙ УРОВЕНЬ УЗЛА, без свода потомков: жёлтый в своде
    приходит от какого-то одного узла, и подмена его сведённым цветом
    показывала бы чужую беду под своим именем. Цвет узла из свода и цвет из
    точечного чтения поэтому МОГУТ отличаться — это разные вопросы, и в
    ответе они не смешиваются.
    """

    permission_map = {
        "tree": _READ_STATUS_PERMISSION,
        "retrieve": _READ_STATUS_PERMISSION,
    }
    # Только чтение: цвет — вывод, а не запись; менять его можно лишь сдав
    # день или поправив статус, и у обоих есть свои маршруты.
    http_method_names = ["get", "options"]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "root_division_id",
                OpenApiTypes.INT,
                description=(
                    "Корень поддерева. По умолчанию — корни области актора."
                ),
            ),
            OpenApiParameter(
                "business_date",
                OpenApiTypes.DATE,
                description="День. По умолчанию сегодняшний по часам раздела.",
            ),
        ],
        responses={
            200: extend_schema_serializer(many=False)(
                inline_serializer(
                    name="TrafficLightTree",
                    fields={
                        "business_date": serializers.DateField(),
                        "nodes": inline_serializer(
                            name="TrafficLightNode",
                            many=True,
                            fields={
                                "division_id": serializers.IntegerField(),
                                "name": serializers.CharField(),
                                "parent_id": serializers.IntegerField(
                                    allow_null=True
                                ),
                                "status": serializers.ChoiceField(
                                    choices=TrafficLightStatus.choices
                                ),
                                "late": serializers.BooleanField(),
                            },
                        ),
                    },
                )
            )
        },
        description=(
            "Свод светофора поддерева под правом status.view: цвет каждого "
            "узла — худший из своего и цветов потомков, late поднимается "
            "снизу. Корень по умолчанию берётся из области актора, дата — "
            "сегодняшняя по часам раздела и возвращается эхом. 400 — "
            "нечитаемый параметр; 403 — чужой корень; 404 — корня нет."
        ),
    )
    @action(detail=False, methods=["get"], url_path="tree")
    def tree(self, request, *args, **kwargs):
        form = TrafficLightTreeFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        # Один скан дерева на весь ответ: им же резолвятся корни и родители.
        children = DivisionTreeSelector.children_map()
        parent_of = {
            child: parent for parent, kids in children.items() for child in kids
        }

        root_division_id = form.validated_data.get("root_division_id")
        if root_division_id is not None:
            _assert_division_in_scope(
                request, root_division_id, _READ_STATUS_PERMISSION,
                field="root_division_id",
            )
            if not DivisionTreeSelector.exists(root_division_id):
                raise DomainError(
                    "ENTITY_NOT_FOUND",
                    404,
                    detail={"root_division_id": str(root_division_id)},
                    message="Подразделение не найдено.",
                )
            roots = [root_division_id]
        else:
            # Корень опущен — выводим его из области. visible_division_ids
            # отдаёт РАЗВЁРНУТОЕ поддерево, поэтому корнями считаются узлы,
            # чей родитель в область не входит: так вложенные и
            # пересекающиеся гранты не дублируют узлы в ответе.
            # Ветвление строго на `is None`: None — глобальный грант, пустое
            # множество — грантов нет, и спутать их значило бы отдать всё
            # дерево тому, кому не видно ничего.
            visible = PermissionService.visible_division_ids(
                resolve_actor_id(request), _READ_STATUS_PERMISSION
            )
            if visible is None:
                roots = children.get(None, [])
            else:
                roots = [
                    division_id
                    for division_id in visible
                    if parent_of.get(division_id) not in visible
                ]

        business_date = form.validated_data.get("business_date") or Clock.today_local()
        merged = {}
        for root in roots:
            merged.update(traffic_light_tree(root, business_date))

        names = DivisionTreeSelector.names_map(merged.keys())
        nodes = [
            {
                "division_id": division_id,
                # Гонка удаления: имени нет — узел ОСТАЁТСЯ в ответе.
                # Потерять красный хуже, чем потерять подпись.
                "name": names.get(division_id, ""),
                # null, если родителя в ответе нет (корень поддерева или
                # родитель вне области): клиент не получает ссылку на узел,
                # которого ему не выдали.
                "parent_id": (
                    parent_of.get(division_id)
                    if parent_of.get(division_id) in merged
                    else None
                ),
                "status": cascade.status,
                "late": cascade.late,
            }
            for division_id, cascade in merged.items()
        ]
        # Полный порядок: имя, затем id — одноимённые узлы иначе менялись бы
        # местами между запросами.
        nodes.sort(key=lambda node: (node["name"], node["division_id"]))
        # Дата эхом: сервер считает по часам раздела, экран — по браузеру, и
        # на границе суток «сегодня» у них разное.
        return Response(
            {"business_date": business_date.isoformat(), "nodes": nodes}
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description="Подразделение.",
            ),
            OpenApiParameter(
                "business_date",
                OpenApiTypes.DATE,
                description="День. По умолчанию сегодняшний по часам раздела.",
            ),
        ],
        responses={
            200: extend_schema_serializer(many=False)(
                inline_serializer(
                    name="TrafficLightDivision",
                    fields={
                        "division_id": serializers.IntegerField(),
                        "business_date": serializers.DateField(),
                        "status": serializers.ChoiceField(
                            choices=TrafficLightStatus.choices
                        ),
                        "late": serializers.BooleanField(),
                        "drift": inline_serializer(
                            name="TrafficLightDrift",
                            allow_null=True,
                            fields={
                                "added": serializers.ListField(
                                    child=serializers.IntegerField()
                                ),
                                "removed": serializers.ListField(
                                    child=serializers.IntegerField()
                                ),
                                "changed": inline_serializer(
                                    name="TrafficLightDriftChange",
                                    many=True,
                                    fields={
                                        "employee_id": serializers.IntegerField(),
                                        "from": serializers.CharField(),
                                        "to": serializers.CharField(),
                                    },
                                ),
                            },
                        ),
                    },
                )
            )
        },
        description=(
            "Светофор ОДНОГО подразделения со своим уровнем и поимённым "
            "расхождением: кто добавился, кто выбыл и у кого сменилось "
            "состояние дня. drift непустой только у жёлтого. Цвет здесь — "
            "собственный, БЕЗ свода потомков, и потому может отличаться от "
            "цвета того же узла в дереве. 400 — нечитаемая дата; 403 — "
            "подразделение вне области; 404 — подразделения нет; 422 — в "
            "снимке код, которого нет в справочнике."
        ),
    )
    def retrieve(self, request, pk=None, *args, **kwargs):
        form = TrafficLightDivisionFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        try:
            division_id = int(pk)
        except (TypeError, ValueError):
            division_id = None
        # Тот же порядок, что у дерева: область раньше существования.
        if division_id is not None:
            _assert_division_in_scope(
                request, division_id, _READ_STATUS_PERMISSION, field="division_id"
            )
        if division_id is None or not DivisionTreeSelector.exists(division_id):
            raise DomainError(
                "ENTITY_NOT_FOUND",
                404,
                detail={"division_id": str(pk)},
                message="Подразделение не найдено.",
            )
        business_date = form.validated_data.get("business_date") or Clock.today_local()
        try:
            light = division_traffic_light(division_id, business_date)
        except ValueError as error:
            # Снимок ссылается на код вне справочника. Это дефект ДАННЫХ, а не
            # сервера: 500 сказал бы «у нас сломалось», а цвет UNKNOWN (как в
            # своде) выдал бы поломку за состояние подразделения. Отказ честнее
            # обоих — спросили про один узел, и ответ обязан быть внятным.
            raise DomainError(
                "UNRESOLVABLE_STATUS_TYPE",
                422,
                detail={"division_id": str(division_id)},
                message="В снимке сдачи код статуса вне справочника.",
            ) from error
        return Response(
            {
                "division_id": division_id,
                "business_date": business_date.isoformat(),
                "status": light.status,
                "late": light.late,
                "drift": light.drift,
            }
        )


class TomorrowBlockViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Законный обход блокировки расхода на завтра.

    POST /api/operations/tomorrow-block/override/

    Право своё — daily_report.override_block, и оно НЕ выводится из права
    сдавать или поправлять: обход снимает замок со всего раздела на целый
    день, и выдать его вместе с отметками в отчёте значило бы раздать
    полномочие руководителя всем операторам.

    Области у обхода нет намеренно: замок общий по разделу (закрывает любой
    отстающий), поэтому и снимается он целиком, а не «в своём поддереве».
    Сузить обход областью значило бы обещать избирательность, которой нет ни
    в выводе блокировки, ни в отказе гейта.

    ГОРИЗОНТ ВПЕРЁД ОГРАНИЧЕН: строка неотзывна, и опечатка в годе
    («2027-08-06» вместо «2026-08-06») навсегда открыла бы день, о котором
    никто уже не вспомнит. Верхняя граница — единственная защита от неё, и
    стоит она здесь, а не в сервисе: сервису дату приносят и переносы данных,
    которым горизонт ни к чему.
    """

    permission_map = {"override": _OVERRIDE_BLOCK_PERMISSION}
    http_method_names = ["post", "options"]

    @extend_schema(
        request=TomorrowBlockOverrideCreateSerializer,
        responses={201: OpsTomorrowBlockOverrideSerializer},
        description=(
            "Снять блокировку расхода на будущую дату под правом "
            "daily_report.override_block: пишется строка ответственности "
            "(кто, когда, почему) и событие журнала, после чего расход на эту "
            "дату формируется, а отстающие остаются видны. Ответственный — из "
            "аутентификации, не из тела. 400 — форма тела, дата не в будущем "
            "или дальше допустимого горизонта; 403 — нет права; 409 — обход "
            "на эту дату уже записан."
        ),
    )
    @action(detail=False, methods=["post"])
    def override(self, request, *args, **kwargs):
        form = TomorrowBlockOverrideCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        business_date = form.validated_data["business_date"]
        today = Clock.today_local()
        if business_date <= today:
            # Обходить нечего: гейт прошлое и сегодня не закрывает, и такая
            # заявка — не разрешение, а недоразумение, которое осталось бы в
            # журнале как чьё-то решение.
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"business_date": business_date.isoformat()},
                message="Обойти можно только блокировку будущей даты.",
            )
        if business_date > today + timedelta(days=MAX_OVERRIDE_HORIZON_DAYS):
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={
                    "business_date": business_date.isoformat(),
                    "max_days_ahead": MAX_OVERRIDE_HORIZON_DAYS,
                },
                message=(
                    f"Дата обхода дальше +{MAX_OVERRIDE_HORIZON_DAYS} дней — "
                    "проверьте год."
                ),
            )
        override = override_tomorrow_block(
            business_date=business_date,
            # Подпись — из контракта аутентификации, НИКОГДА из тела.
            actor=resolve_actor_id(request),
            reason=form.validated_data["reason"],
        )
        return Response(
            OpsTomorrowBlockOverrideSerializer(override).data,
            status=status.HTTP_201_CREATED,
        )
