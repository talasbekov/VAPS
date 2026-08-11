from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .serializers import SecondmentRequestSerializer
from organization_management.apps.secondments.models import SecondmentRequest

from organization_management.apps.divisions.models import Division
from django.db.models import Q
from django.utils import timezone
from organization_management.apps.statuses.models import EmployeeStatus

class SecondmentRequestViewSet(viewsets.ModelViewSet):
    """
    ViewSet для управления запросами на прикомандирование.

    Донорская версия резолвила область через кастомного пользователя
    (user.role/user.division), которого в этом бэке нет — здесь область
    считается цепочкой User → Employee → StaffUnit → Division, как в
    statuses; суперпользователь видит всё.
    """
    queryset = SecondmentRequest.objects.all()
    serializer_class = SecondmentRequestSerializer

    def _get_department_root(self, division: Division) -> Division:
        node = division
        while node.parent and node.division_type != Division.DivisionType.DEPARTMENT:
            node = node.parent
        return node

    def _user_division(self, user):
        employee = getattr(user, "employee", None)
        staff_unit = getattr(employee, "staff_unit", None) if employee else None
        return getattr(staff_unit, "division", None) if staff_unit else None

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if not user.is_authenticated:
            return qs.none()
        if user.is_superuser:
            return qs
        division = self._user_division(user)
        if division is None:
            return qs.none()
        # Для остальных — запросы, где источник/приемник в зоне видимости департамента пользователя
        dept_root = self._get_department_root(division)
        allowed = dept_root.get_descendants(include_self=True)
        allowed_ids = allowed.values_list("id", flat=True)
        return qs.filter(Q(from_division_id__in=allowed_ids) | Q(to_division_id__in=allowed_ids))

    def get_permissions(self):
        """
        Определение прав доступа в зависимости от действия.
        """
        if self.action in ['create', 'approve', 'reject', 'return']:
            self.permission_classes = [permissions.IsAuthenticated]
        else:
            self.permission_classes = [permissions.IsAuthenticated]
        return super().get_permissions()

    def _receiving_side_forbidden(self, request, instance):
        """Принимающая сторона: to_division должен быть в области актора."""
        if request.user.is_superuser:
            return None
        division = self._user_division(request.user)
        if division is None:
            return Response({'detail': 'Пользователь не привязан к сотруднику.'}, status=403)
        allowed = division.get_descendants(include_self=True)
        if instance.to_division_id not in allowed.values_list('id', flat=True):
            return Response({'detail': 'Решение вне вашего подразделения запрещено.'}, status=403)
        return None

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """
        Одобрение запроса на прикомандирование.
        """
        instance = self.get_object()
        forbidden = self._receiving_side_forbidden(request, instance)
        if forbidden is not None:
            return forbidden
        instance.status = SecondmentRequest.ApprovalStatus.APPROVED
        instance.approved_by = request.user
        instance.save()

        # Создание статусов прикомандирования/откомандирования
        # Откомандирован в (для собственного подразделения)
        EmployeeStatus.objects.create(
            employee_id=instance.employee_id,
            status_type=EmployeeStatus.StatusType.SECONDED_TO,
            start_date=instance.start_date,
            end_date=instance.end_date,
            related_division_id=instance.to_division_id,
            created_by=request.user,
            comment=f"Откомандирован в подразделение {instance.to_division_id}",
        )
        # Прикомандирован (для принимающего подразделения)
        EmployeeStatus.objects.create(
            employee_id=instance.employee_id,
            status_type=EmployeeStatus.StatusType.SECONDED_FROM,
            start_date=instance.start_date,
            end_date=instance.end_date,
            related_division_id=instance.from_division_id,
            created_by=request.user,
            comment=f"Прикомандирован из подразделения {instance.from_division_id}",
        )
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """
        Отклонение запроса на прикомандирование.
        """
        instance = self.get_object()
        forbidden = self._receiving_side_forbidden(request, instance)
        if forbidden is not None:
            return forbidden
        instance.status = SecondmentRequest.ApprovalStatus.REJECTED
        instance.rejection_reason = request.data.get('reason', '')
        instance.save()
        # ... (логика уведомления)
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['post'])
    def return_employee(self, request, pk=None):
        """
        Возврат сотрудника из прикомандирования.
        """
        instance = self.get_object()
        # Закрыть текущий статус прикомандирования
        open_status = EmployeeStatus.objects.filter(
            employee_id=instance.employee_id,
            status_type=EmployeeStatus.StatusType.SECONDED_TO,
            end_date__isnull=True,
        ).order_by('-start_date').first()
        if open_status:
            open_status.end_date = timezone.now().date()
            open_status.save(update_fields=['end_date'])
        open_in_status = EmployeeStatus.objects.filter(
            employee_id=instance.employee_id,
            status_type=EmployeeStatus.StatusType.SECONDED_FROM,
            end_date__isnull=True,
        ).order_by('-start_date').first()
        if open_in_status:
            open_in_status.end_date = timezone.now().date()
            open_in_status.save(update_fields=['end_date'])
        instance.status = SecondmentRequest.ApprovalStatus.CANCELLED
        instance.save(update_fields=['status'])
        return Response({'status': 'сотрудник возвращен'})

    @action(detail=False, methods=['get'])
    def incoming(self, request):
        """
        Список входящих запросов для текущего пользователя.
        """
        user = request.user
        queryset = self.get_queryset()
        if not user.is_superuser:
            division = self._user_division(user)
            if division is None:
                queryset = queryset.none()
            else:
                queryset = queryset.filter(
                    to_division__in=division.get_descendants(include_self=True)
                )
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def outgoing(self, request):
        """
        Список исходящих запросов от текущего пользователя.
        """
        user = request.user
        queryset = self.get_queryset().filter(requested_by=user)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
