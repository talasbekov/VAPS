"""Stories 10.1a/10.1b — REST-поверхность статусов (/api/operations/statuses/).

* 10.1a: POST /bulk/ — тонкая вьюха поверх готового сервиса 3.8
  (bulk_create_statuses): сериализатор → резолв scope из RBAC → вызов сервиса
  → 201 {created}. Никакой бизнес-логики/конфликт-детекта здесь (всё в 3.8).
  DomainError сервиса (400/403/404/409/422) течёт через unified handler
  (§36-envelope) — вьюха НЕ ловит и НЕ фильтрует по правам вручную (layer
  contract, зеркало DailySubmissionViewSet 5.8).
* 10.1b: GET /grid-prefill/?business_date=… — query-загрузка «вчера» для
  префилла грида 10.2: roster + живые статусы одним ответом. Scope сужает
  СЕЛЕКТОР (канон L451 — вьюха по правам не фильтрует, чужие дивизионы
  просто отсутствуют); единственная ошибка слоя — DRF 400 от query-формы.

Грубый гейт прав — RequirePermissionMixin ({"bulk": status.manage,
"grid_prefill": status.view}); тонкий per-строчный scope bulk энфорсит сервис
по allowed_division_ids, которое вьюха резолвит из RBAC актора (Решение №2
3.8 — фронту не доверяем).
"""

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.services import PermissionService
from apps.operations.statuses.api.serializers import (
    BulkStatusCreateSerializer,
    GridPrefillQuerySerializer,
    GridPrefillResponseSerializer,
)
from apps.operations.statuses.selectors import (
    GRID_PREFILL_PERMISSION,
    EmployeeStatusSelector,
)
from apps.operations.statuses.services import bulk_create_statuses

_BULK_PERMISSION = "status.manage"


class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """POST /statuses/bulk/ + GET /statuses/grid-prefill/ (10.1a/10.1b)."""

    permission_map = {
        "bulk": _BULK_PERMISSION,
        "grid_prefill": GRID_PREFILL_PERMISSION,
    }
    # «get» открывает ТОЛЬКО grid-prefill: GET на post-only /bulk/ резолвится
    # в action=None → 405 в mixin (permissions.py:49-57, ревью 5.8c; пин AC-6).
    http_method_names = ["get", "post", "options"]

    @extend_schema(
        request=BulkStatusCreateSerializer,
        responses={
            201: inline_serializer(
                name="BulkStatusCreateResponse",
                fields={"created": serializers.IntegerField()},
            )
        },
        description=(
            "Массовое создание статусов-отклонений одним вызовом (FR-12). "
            "403 нет права status.manage / сотрудник вне scope оператора; "
            "400 структурная ошибка payload (дубль/пропуск ключа/пустой/тип/"
            "cap); 409 soft-пересечение (details.rows[]); 422 hard-пересечение "
            "/ интервал / уволен (details.rows[]). Успех → {created: N}."
        ),
    )
    @action(detail=False, methods=["post"], url_path="bulk", url_name="bulk")
    def bulk(self, request, *args, **kwargs):
        form = BulkStatusCreateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # Scope — множество разрешённых дивизионов из RBAC актора (НЕ одна
        # division: bulk охватывает разные подразделения, сервис 3.8 энфорсит
        # per-row). None = безскоуповый/wildcard грант → все дивизионы (сервис
        # ждёт множество, None уронил бы TypeError). ARCH-003: читаем core через
        # селектор, не Division.objects из operations.
        allowed = PermissionService.visible_division_ids(
            request.actor_id, _BULK_PERMISSION
        )
        if allowed is None:
            allowed = set(CoreDivisionTreeSelector.divisions_map().keys())
        created = bulk_create_statuses(
            form.validated_data["rows"],
            # ARCH-SEC-030: actor из auth-контракта, не из payload.
            actor=request.actor_id,
            business_date=form.validated_data["business_date"],
            allowed_division_ids=allowed,
        )
        return Response({"created": len(created)}, status=status.HTTP_201_CREATED)

    @extend_schema(
        parameters=[GridPrefillQuerySerializer],
        responses={200: GridPrefillResponseSerializer},
        description=(
            "Query-загрузка данных дня для префилла грида (FR/AI-4 E10): "
            "roster подразделений актора на дату (WORKING & active) + живые "
            "статус-интервалы, содержащие дату, одним ответом. Scope сужает "
            "видимость (чужие дивизионы отсутствуют — НЕ 403); 403 без "
            "status.view; 400 отсутствующий/битый business_date. Сотрудник "
            "без записи в statuses = дефолт IN_SERVICE на фронте."
        ),
    )
    @action(
        detail=False, methods=["get"], url_path="grid-prefill",
        url_name="grid-prefill",
    )
    def grid_prefill(self, request, *args, **kwargs):
        query = GridPrefillQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        business_date = query.validated_data["business_date"]
        # ARCH-SEC-030: identity из auth-контракта, не из query/payload;
        # сужение по scope — внутри селектора (канон L451).
        data = EmployeeStatusSelector.grid_prefill(
            actor=request.actor_id, business_date=business_date
        )
        return Response({"business_date": business_date, **data})
