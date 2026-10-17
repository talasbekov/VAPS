from datetime import timedelta
from pathlib import PurePosixPath

from rest_framework import viewsets, status, permissions, serializers
from django.db import models
from django.http import FileResponse, HttpResponse
from django.urls import reverse
from django.utils.http import content_disposition_header
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema, OpenApiParameter
from drf_spectacular.types import OpenApiTypes
from .serializers import ReportSerializer
from organization_management.apps.reports.models import Report
from organization_management.apps.reports.tasks import generate_report_task
from organization_management.apps.reports.utils import generate_personnel_expense_report
from organization_management.apps.divisions.models import Division
from organization_management.apps.common.services.permissions import PermissionService
from organization_management.apps.common.rbac import _scope_division_ids
from organization_management.apps.operations.api.permissions import require_permission
from organization_management.apps.operations.clock import Clock
from organization_management.apps.reports.application.personnel_reports import (
    absence_csv, absence_report, division_options, page_of, staffing_report, staffing_xlsx,
)
from organization_management.apps.reports.application.generation_scope import (
    GENERATION_SCOPE_FILTER, require_generation_scope,
)

from rest_framework import mixins


class PersonnelReportQuerySerializer(serializers.Serializer):
    division_id = serializers.IntegerField(required=False, min_value=1)
    page = serializers.IntegerField(required=False, default=1, min_value=1)
    page_size = serializers.IntegerField(required=False, default=25, min_value=1, max_value=100)
    export = serializers.ChoiceField(required=False, choices=["xlsx", "csv"])


class AbsenceReportQuerySerializer(PersonnelReportQuerySerializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, data):
        today = Clock.today_local()
        end = data.setdefault("date_to", today)
        if "date_from" not in data:
            try:
                data["date_from"] = end - timedelta(days=29)
            except OverflowError:
                raise serializers.ValidationError({"detail": "Укажите начало периода: для этой даты невозможно выбрать 30 предыдущих дней"})
        start = data["date_from"]
        if start > end:
            raise serializers.ValidationError({"detail": "Начало периода должно быть не позже окончания"})
        if end > today:
            raise serializers.ValidationError({"detail": "Статистика отсутствий доступна до сегодняшней даты"})
        if (end - start).days >= 366:
            raise serializers.ValidationError({"detail": "Период не должен превышать 366 дней"})
        return data


def _personnel_report_scope(request, feature_permission, selected_id=None):
    """Both the report grant and the feature grant constrain visible data."""
    if request.user.is_superuser:
        visible = None
    else:
        require_permission(request, "daily_report.generate")
        require_permission(request, feature_permission)
        report_scope = _scope_division_ids(request.user, "daily_report.generate")
        feature_scope = _scope_division_ids(request.user, feature_permission)
        visible = feature_scope if report_scope is None else report_scope if feature_scope is None else report_scope & feature_scope
    accessible = Division.objects.all() if visible is None else Division.objects.filter(pk__in=visible)
    accessible_ids = set(accessible.values_list("id", flat=True))
    selected_ids = accessible_ids
    if selected_id is not None:
        division = Division.objects.filter(pk=selected_id).first()
        if division is None:
            raise NotFound("Подразделение не найдено")
        if selected_id not in accessible_ids:
            raise PermissionDenied("Подразделение вне зоны ответственности")
        selected_ids = accessible_ids & set(division.get_descendants(include_self=True).values_list("id", flat=True))
    return selected_ids, division_options(accessible_ids)


def _personnel_report_envelope(payload, query, options):
    page, page_size = query["page"], query["page_size"]
    if page > 1 and (page - 1) * page_size >= payload["count"]:
        raise serializers.ValidationError({"detail": "Страница отчёта не найдена"})
    return {
        **payload, "page": page, "page_size": page_size,
        "next_page": page + 1 if page * page_size < payload["count"] else None,
        "previous_page": page - 1 if page > 1 else None,
        "divisions": options, "basis": "current_staffing", "as_of": Clock.today_local().isoformat(),
    }


_PERSONNEL_REPORT_PARAMETERS = [
    OpenApiParameter("division_id", OpenApiTypes.INT, description="Подразделение вместе с потомками; по умолчанию доступная область."),
    OpenApiParameter("page", OpenApiTypes.INT),
    OpenApiParameter("page_size", OpenApiTypes.INT, description="Размер предпросмотра от 1 до 100; по умолчанию 25."),
]

class ReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    ViewSet для управления отчетами.
    Поддерживает чтение (list, retrieve) и кастомные действия (например, generate).
    """
    queryset = Report.objects.all()
    serializer_class = ReportSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post']

    @extend_schema(
        parameters=[*_PERSONNEL_REPORT_PARAMETERS, OpenApiParameter("export", OpenApiTypes.STR, enum=["xlsx"])],
        responses={200: OpenApiTypes.OBJECT, (200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): OpenApiTypes.BINARY},
        description="Текущее штатное расписание: занятые и свободные слоты. Права daily_report.generate и orgstructure.view; пересечение областей. XLSX включает все отфильтрованные слоты, независимо от страницы предпросмотра.",
    )
    @action(detail=False, methods=["get"])
    def staffing(self, request):
        serializer = PersonnelReportQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data
        division_ids, options = _personnel_report_scope(request, "orgstructure.view", query.get("division_id"))
        export = query.get("export")
        if export not in (None, "xlsx"):
            raise serializers.ValidationError({"detail": "Штатное расписание выгружается в Excel (xlsx)"})
        payload = staffing_report(division_ids, page=query["page"], page_size=query["page_size"], full=export is not None)
        if export:
            response = HttpResponse(staffing_xlsx(payload["rows"]), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            response["Content-Disposition"] = content_disposition_header(True, f"staffing-{Clock.today_local().isoformat()}.xlsx")
            return response
        return Response(_personnel_report_envelope(payload, query, options))

    @extend_schema(
        parameters=[*_PERSONNEL_REPORT_PARAMETERS, OpenApiParameter("date_from", OpenApiTypes.DATE), OpenApiParameter("date_to", OpenApiTypes.DATE), OpenApiParameter("export", OpenApiTypes.STR, enum=["csv"])],
        responses={200: OpenApiTypes.OBJECT, (200, "text/csv"): OpenApiTypes.BINARY},
        description="Фактические отсутствия по текущему штату: человеко-дни и уникальные сотрудники по победившему типу статуса. Даты включительно, до сегодня, максимум 366 дней; умолчание 30 дней. Права daily_report.generate и status.view; пересечение областей. CSV включает все типы выбранного периода.",
    )
    @action(detail=False, methods=["get"])
    def absences(self, request):
        serializer = AbsenceReportQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        query = serializer.validated_data
        division_ids, options = _personnel_report_scope(request, "status.view", query.get("division_id"))
        export = query.get("export")
        if export not in (None, "csv"):
            raise serializers.ValidationError({"detail": "Статистика отсутствий выгружается в CSV"})
        payload = absence_report(division_ids, query["date_from"], query["date_to"])
        if export:
            response = HttpResponse(absence_csv(payload), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = content_disposition_header(True, f"absences-{payload['date_from']}-{payload['date_to']}.csv")
            return response
        payload["rows"] = page_of(payload["rows"], query["page"], query["page_size"])
        return Response(_personnel_report_envelope(payload, query, options))

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()

        if not user.is_authenticated:
            return qs.none()

        if user.is_superuser:
            return qs

        accessible_divisions = PermissionService.get_accessible_divisions(user)

        # Если нет доступных подразделений (т.е. нет зоны видимости) - видит только свои
        if not accessible_divisions.exists():
            return qs.filter(created_by_id=user.id)

        return qs.filter(
            models.Q(created_by_id=user.id) |
            models.Q(division_id__in=accessible_divisions.values_list("id", flat=True))
        )

    @action(detail=False, methods=['post'])
    def generate(self, request):
        """
        Создание задачи на генерацию отчета.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        division = serializer.validated_data.get('division')
        division_id = division.pk if division is not None else None
        user = request.user
        require_generation_scope(user, division_id)
        # Durable server-owned selection: SET_NULL on deletion must not turn
        # a selected report into a service-wide report while it is queued.
        filters = {
            **serializer.validated_data.get('filters', {}),
            GENERATION_SCOPE_FILTER: {'division_id': division_id},
        }
        report = serializer.save(created_by=user, filters=filters)
        generate_report_task.delay(report.id)
        return Response({'job_id': report.job_id}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'])
    def status(self, request, pk=None):
        """
        Проверка статуса задачи.
        """
        report = self.get_object()
        return Response({'status': report.status})

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """
        Скачивание готового отчета.
        """
        report = self.get_object()
        if report.file:
            return Response({'download_url': reverse('report-content', kwargs={'pk': report.pk})})
        else:
            return Response({'status': 'файл еще не готов'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['get'])
    def content(self, request, pk=None):
        """Read existing stored bytes through the same report scope as metadata."""
        report = self.get_object()
        if not report.file:
            raise NotFound('Файл отчёта ещё не готов')
        try:
            stream = report.file.open('rb')
        except FileNotFoundError:
            raise NotFound('Файл отчёта не найден')
        response = FileResponse(stream, as_attachment=True, filename=PurePosixPath(report.file.name).name)
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name='department_id',
                type=OpenApiTypes.INT,
                location=OpenApiParameter.PATH,
                description='ID департамента для генерации отчета'
            )
        ],
        responses={
            200: {
                'type': 'string',
                'format': 'binary',
                'description': 'Excel файл отчета "Расход"'
            }
        }
    )
    @action(
        detail=False,
        methods=['get'],
        url_path='expense/(?P<department_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated]
    )
    def expense(self, request, department_id=None):
        """
        Генерация и скачивание отчета "Расход" по департаменту.
        GET /api/reports/reports/expense/<department_id>/
        """
        user = request.user

        if not department_id:
            return Response({'detail': 'department_id обязателен'}, status=status.HTTP_400_BAD_REQUEST)

        # Проверяем существование департамента
        try:
            department = Division.objects.get(
                pk=department_id,
                division_type=Division.DivisionType.DEPARTMENT
            )
        except Division.DoesNotExist:
            return Response({'detail': 'Департамент не найден'}, status=status.HTTP_404_NOT_FOUND)

        # Проверка прав доступа
        if not PermissionService.can_access_division(user, department.id):
            # «Зоны нет вовсе» — это пустая область гранта (Plane №352, Ш-6),
            # раньше — отсутствие портальной роли. Два разных отказа остаются
            # разными: их чинят разные люди.
            if (
                not PermissionService.get_accessible_divisions(user).exists()
                and not user.is_superuser
            ):
                return Response({'detail': 'Нет зоны ответственности'}, status=status.HTTP_403_FORBIDDEN)
            return Response(
                {'detail': 'Департамент вне зоны ответственности'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Генерируем отчет
        try:
            file_buffer, filename = generate_personnel_expense_report(department_id)

            response = FileResponse(
                file_buffer,
                as_attachment=True,
                filename=filename,
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
            return response

        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response(
                {'detail': f'Ошибка при генерации отчета: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
