from rest_framework import viewsets, status, permissions
from django.db import models
from django.http import FileResponse
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
import os

from rest_framework import mixins

class ReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    ViewSet для управления отчетами.
    Поддерживает чтение (list, retrieve) и кастомные действия (например, generate).
    """
    queryset = Report.objects.all()
    serializer_class = ReportSerializer
    http_method_names = ['get', 'post']

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

        # Проверка зоны ответственности для выбранного division
        division_id = serializer.validated_data.get('division')
        user = request.user

        if division_id:
            from organization_management.apps.divisions.models import Division
            try:
                div = Division.objects.get(pk=division_id.id if hasattr(division_id, 'id') else division_id)
            except Division.DoesNotExist:
                return Response({'detail': 'Некорректное подразделение'}, status=400)

            if not PermissionService.can_access_division(user, div.id):
                # Preserve the legacy behavior: return specific message if user has no scope at all,
                # otherwise return a generic forbidden message.
                if not PermissionService.get_user_division(user) and not user.is_superuser:
                    return Response({'detail': 'Нет зоны ответственности'}, status=403)
                return Response({'detail': 'Подразделение вне зоны ответственности'}, status=403)

        report = serializer.save(created_by=user)
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
            #  (логика для редиректа на файл)
            return Response({'download_url': report.file.url})
        else:
            return Response({'status': 'файл еще не готов'}, status=status.HTTP_404_NOT_FOUND)

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
            if not PermissionService.get_user_division(user) and not user.is_superuser:
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
