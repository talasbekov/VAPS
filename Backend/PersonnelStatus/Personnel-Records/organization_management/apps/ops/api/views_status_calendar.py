"""Вид календаря статусов (/api/ops/status-calendar/*, Plane №270).

Отдельным модулем от `ops/api/views.py`: тот файл уже 3475 строк, и класть в
него ещё один ресурс значило бы делать его нечитаемым дальше. Гейт, резолвер
области и разбор параметров берутся общие — второе определение «что мне
видно» разошлось бы с расходом на первом же уточнении.
"""
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from organization_management.apps.operations.api.views import (
    _parse_date_param,
    _parse_int_param,
    _resolve_division_scope,
)
from organization_management.apps.ops import status_calendar

#: Календарь показывает те же сведения, что и расход дня, только за месяц —
#: и открывается тем же правом. Своё «календарное» право означало бы, что одни
#: и те же факты защищены по-разному в зависимости от экрана.
_READ_PERMISSION = "status.view"


class OpsStatusCalendarViewSet(RequirePermissionMixin, viewsets.ViewSet):
    """Календарь статусов: месяц по дням и занятость на выбранную дату.

    GET /api/ops/status-calendar/month/ — коды по дням месяца.
    GET /api/ops/status-calendar/day/ — три группы занятости поимённо.
    """

    permission_map = {"month": _READ_PERMISSION, "day": _READ_PERMISSION}

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "month", OpenApiTypes.STR, OpenApiParameter.QUERY,
                required=True,
                description="Месяц ГГГГ-ММ. Полная дата не принимается.",
            ),
            OpenApiParameter(
                "division_id", OpenApiTypes.INT, OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Подразделение. Не задано — вся область актора; чужое — "
                    "403, а не пустой ответ."
                ),
            ),
            OpenApiParameter(
                "page", OpenApiTypes.INT, OpenApiParameter.QUERY, required=False
            ),
            OpenApiParameter(
                "page_size", OpenApiTypes.INT, OpenApiParameter.QUERY,
                required=False,
                description=(
                    f"Потолок {status_calendar.MAX_PAGE_SIZE}: месяц × состав "
                    "службы одним ответом не отдаётся."
                ),
            ),
        ]
    )
    @action(detail=False, methods=["get"])
    def month(self, request):
        first_day = status_calendar.parse_month(request.query_params.get("month"))
        if first_day is None:
            raise ValidationError(
                {"month": "Ожидается месяц в формате ГГГГ-ММ."}
            )
        division_id = _parse_int_param(request, "division_id")
        scope = _resolve_division_scope(request, division_id, _READ_PERMISSION)
        return Response(
            status_calendar.month_page(
                first_day=first_day,
                scope_division_ids=scope,
                page=_parse_int_param(request, "page") or 1,
                page_size=(
                    _parse_int_param(request, "page_size")
                    or status_calendar.MAX_PAGE_SIZE
                ),
            )
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "date", OpenApiTypes.DATE, OpenApiParameter.QUERY,
                required=True,
                description="Дата ГГГГ-ММ-ДД.",
            ),
            OpenApiParameter(
                "division_id", OpenApiTypes.INT, OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Подразделение. Не задано — вся область актора; чужое — "
                    "403, а не пустой ответ."
                ),
            ),
        ]
    )
    @action(detail=False, methods=["get"])
    def day(self, request):
        """Занятость области на дату: на дежурстве / на ОМ / отсутствуют."""
        on_date = _parse_date_param(request, "date")
        if on_date is None:
            raise ValidationError({"date": "Укажите дату в формате ГГГГ-ММ-ДД."})
        division_id = _parse_int_param(request, "division_id")
        scope = _resolve_division_scope(request, division_id, _READ_PERMISSION)
        return Response(
            status_calendar.day_panel(on_date=on_date, scope_division_ids=scope)
        )
