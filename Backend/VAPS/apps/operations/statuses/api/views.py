"""Story 10.1a — REST bulk-роут статусов (POST /api/operations/statuses/bulk/).
Story 10.1b — GET on-date роут (преднабор «вчера»).

Тонкая вьюха поверх готового сервиса 3.8 (bulk_create_statuses): сериализатор →
резолв scope из RBAC → вызов сервиса → 201 {created}. Никакой бизнес-логики/
конфликт-детекта здесь (всё в 3.8). DomainError сервиса (400/403/404/409/422)
течёт через unified handler (§36-envelope) — вьюха НЕ ловит и НЕ фильтрует по
правам вручную (layer contract, зеркало DailySubmissionViewSet 5.8).

Грубый гейт права — RequirePermissionMixin ({"bulk": "status.manage",
"on_date": "status.view"}); тонкий per-строчный scope энфорсит сервис по
allowed_division_ids (bulk) / локальный ``_ensure_division_scope`` (on-date)
— вьюха резолвит из RBAC актора (Решение №2 3.8 — фронту не доверяем).

``_ensure_division_scope`` — СВОЙ, не импорт ``submissions.services.scope_gate``:
architecture.md#L587 запрещает statuses → submissions (одностороннее течение
subdomain-графа, ARCH-ISO guard test_statuses_does_not_import_submissions);
одна и та же проверка (``PermissionService.has_permission``) продублирована
здесь как маленькая локальная функция, не общий импорт.
"""

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector, HistoricalEmployeeSelector
from apps.operations.services import PermissionService
from apps.operations.statuses.api.serializers import (
    BulkStatusCreateSerializer,
    StatusOnDateQuerySerializer,
    StatusOnDateRowSerializer,
)
from apps.operations.statuses.selectors import EmployeeStatusSelector
from apps.operations.statuses.services import bulk_create_statuses

_BULK_PERMISSION = "status.manage"
_VIEW_PERMISSION = "status.view"


def _ensure_division_scope(actor, permission_code, division_id):
    """403 unless *actor* holds *permission_code* for *division_id*
    (ARCH-003 module-local copy of submissions' ``ensure_division_scope`` —
    statuses must not import submissions, architecture.md#L587).

    Ревью-фикс (Edge Case Hunter, 10.1b): guards a blank/None ``division_id``
    — ``PermissionService``'s scope-matching treats a falsy division as
    "does not narrow", so a blank value would silently PASS for a
    scoped-out actor. The current caller (``on_date``) can never supply one
    (DRF's ``UUIDField`` rejects blank with 400 first), but this is a
    general-purpose module-local helper — a future caller with an optional
    query param would silently reopen the hole without this guard."""
    if not division_id:
        raise ValueError("_ensure_division_scope requires a division_id")
    if not PermissionService.has_permission(
        actor, permission_code, division_id=division_id
    ):
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            detail={"division_id": str(division_id)},
            message="Нет права на это подразделение.",
        )


def _ensure_division_exists(division_id):
    """404 for a valid-but-phantom division UUID — called AFTER the scope
    guard (mirror of submissions 6.10a: a scoped stranger still gets 403
    first, never an existence oracle)."""
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )


class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """POST .../bulk/ — массовое создание статусов; GET .../on-date/ —
    живые статусы подразделения на дату (10.1b, преднабор «вчера»)."""

    permission_map = {"bulk": _BULK_PERMISSION, "on_date": _VIEW_PERMISSION}
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
        parameters=[
            OpenApiParameter(
                "division_id", str, OpenApiParameter.QUERY, required=True
            ),
            OpenApiParameter(
                "business_date", str, OpenApiParameter.QUERY, required=True
            ),
        ],
        responses={200: StatusOnDateRowSerializer(many=True)},
        description=(
            "Живые статусы сотрудников подразделения на дату (10.1b, "
            "преднабор «вчера» грида 10.2). Сотрудник без статуса на дату "
            "в списке отсутствует (пусто = «В строю»). 403 нет status.view "
            "на division_id; 404 подразделение не существует (после scope)."
        ),
    )
    @action(detail=False, methods=["get"], url_path="on-date", url_name="on-date")
    def on_date(self, request, *args, **kwargs):
        form = StatusOnDateQuerySerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        business_date = form.validated_data["business_date"]

        # Scope сначала, existence — потом (порядок 6.10a): держатель без
        # scope на фантомный ID получает 403, не 404-oracle существования.
        _ensure_division_scope(request.actor_id, _VIEW_PERMISSION, division_id)
        _ensure_division_exists(division_id)

        # ARCH-003: employee-состав подразделения на ДАТУ — через core-селектор
        # (роster_on — канон date-versioned ростера), не Employee.objects
        # напрямую из operations.
        roster = HistoricalEmployeeSelector.roster_on(
            business_date, division_ids=[division_id]
        )
        employee_ids = roster.get(division_id, [])
        rows = EmployeeStatusSelector.overlapping_on(business_date, employee_ids)
        return Response(StatusOnDateRowSerializer(rows, many=True).data)
