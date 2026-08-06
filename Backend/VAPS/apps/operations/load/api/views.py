"""Story 20.3b — HTTP surface over compute_overload_summary() (20.3a).

GET /api/operations/load/summary/ — one division, resolves its roster on
date_to via HistoricalEmployeeSelector.roster_on() (canon date-versioned
roster, ARCH-003 — not Employee.objects directly), then calls the already-
tested bulk selector. No selector logic changes here — thin HTTP wrapper,
structural precedent apps.operations.statuses.api.views.StatusViewSet.on_date
(same roster_on()+scope+existence pattern).
"""

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreDivisionTreeSelector, HistoricalEmployeeSelector
from apps.operations.load.api.serializers import OverloadSummaryFilterSerializer
from apps.operations.load.selectors import compute_overload_summary
from apps.operations.services import PermissionService

_VIEW_PERMISSION = "status.view"
# Same value as ExpensePeriodFilterSerializer's MAX_PERIOD_DAYS
# (submissions/services/expense_read_service.py) — local copy, not an
# import: this module stays self-contained the same way statuses/api/
# views.py duplicates its own _ensure_division_scope rather than reaching
# into submissions (architecture.md#L587, subdomain chain statuses ←
# submissions ← reports — load isn't in that chain, but the same
# no-cross-subdomain-god-import discipline applies).
_MAX_RANGE_DAYS = 62


def _ensure_division_scope(actor, permission_code, division_id):
    """403 unless *actor* holds *permission_code* for *division_id*
    (module-local copy of statuses'/submissions' own scope gate — see
    module docstring)."""
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
    guard (a scoped stranger still gets 403 first, never an existence
    oracle)."""
    if not CoreDivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )


class OverloadViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """GET .../summary/ — days of overload (19.2's threshold) per employee
    of one division over a date range (20.3a bulk selector, FR-32)."""

    permission_map = {"summary": _VIEW_PERMISSION}
    # No "head": HEAD stays 405 (project-wide canon, mirror of the
    # read-only ViewSets in submissions/statuses).
    http_method_names = ["get", "options"]

    @extend_schema(
        parameters=[OverloadSummaryFilterSerializer],
        responses={
            200: inline_serializer(
                name="OverloadSummaryResponse",
                fields={
                    "division_id": serializers.UUIDField(),
                    "date_from": serializers.DateField(),
                    "date_to": serializers.DateField(),
                    "threshold_hours": serializers.DecimalField(
                        max_digits=5, decimal_places=2
                    ),
                    "employees": inline_serializer(
                        name="OverloadSummaryEmployee",
                        many=True,
                        fields={
                            "employee_id": serializers.UUIDField(),
                            "overload_days": serializers.ListField(
                                child=serializers.DateField()
                            ),
                        },
                    ),
                },
            )
        },
        description="Дни перегрузки (19.2) по каждому сотруднику управления "
        "за период (20.3a/FR-32). Будущий date_to НЕ блокируется — факт, "
        "не проекция, естественно пуст. 400 отсутствует/невалидная/"
        "инвертированная/слишком длинная (>62д) дата; 403 нет права/scope; "
        "404 нет подразделения.",
    )
    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request, *args, **kwargs):
        form = OverloadSummaryFilterSerializer(data=request.query_params)
        form.is_valid(raise_exception=True)
        division_id = form.validated_data["division_id"]
        date_from = form.validated_data["date_from"]
        date_to = form.validated_data["date_to"]
        threshold_hours = form.validated_data["threshold_hours"]

        if date_from > date_to:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={
                    "date_from": date_from.isoformat(),
                    "date_to": date_to.isoformat(),
                },
                message="date_from не может быть позже date_to.",
            )
        span = (date_to - date_from).days + 1
        if span > _MAX_RANGE_DAYS:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"days": span, "max": _MAX_RANGE_DAYS},
                message=f"Период слишком длинный (макс. {_MAX_RANGE_DAYS} дней).",
            )

        # Scope сначала, existence — потом (6.10a-канон): держатель без
        # scope на фантомный ID получает 403, не 404-oracle существования.
        _ensure_division_scope(request.actor_id, _VIEW_PERMISSION, division_id)
        _ensure_division_exists(division_id)

        roster = HistoricalEmployeeSelector.roster_on(
            date_to, division_ids=[division_id]
        )
        employee_ids = roster.get(division_id, [])
        summary_by_employee = compute_overload_summary(
            employee_ids, date_from, date_to, threshold_hours=threshold_hours
        )
        return Response(
            {
                "division_id": str(division_id),
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
                "threshold_hours": threshold_hours,
                "employees": [
                    {
                        "employee_id": str(employee_id),
                        "overload_days": [d.isoformat() for d in overload_days],
                    }
                    for employee_id, overload_days in summary_by_employee.items()
                ],
            }
        )
