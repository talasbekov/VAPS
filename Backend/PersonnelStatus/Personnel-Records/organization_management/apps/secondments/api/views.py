from rest_framework import viewsets, permissions
from rest_framework import status as status_codes
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .serializers import SecondmentRequestSerializer
from organization_management.apps.secondments.models import SecondmentRequest

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.application.services import (
    StatusApplicationService,
)
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
    resolve_actor_id,
)
from organization_management.apps.operations.services import (
    PermissionService as OpsPermissionService,
)


class SecondmentRequestViewSet(RequirePermissionMixin, viewsets.ModelViewSet):
    """
    ViewSet для управления запросами на прикомандирование.

    Право и область берутся из того же grant-каталога, что у канонического
    operations API: чтение — status.view, действия — status.manage.
    """
    queryset = SecondmentRequest.objects.all()
    serializer_class = SecondmentRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_map = {
        'list': 'status.view',
        'retrieve': 'status.view',
        'incoming': 'status.view',
        'outgoing': 'status.view',
        'create': 'status.manage',
        'approve': 'status.manage',
        'reject': 'status.manage',
        'return_employee': 'status.manage',
    }
    # Generic rewrite/delete обходят workflow approve/reject/return. У
    # канонического operations API они тоже не обслуживаются.
    http_method_names = ['get', 'post', 'options']

    def _visible_division_ids(self, permission_code):
        actor_id = resolve_actor_id(self.request)
        if actor_id is None:
            return set()
        return OpsPermissionService.visible_division_ids(
            actor_id, permission_code
        )

    def get_queryset(self):
        qs = super().get_queryset()
        permission_code = self.permission_map.get(self.action)
        if permission_code is None:
            return qs.none()
        allowed_ids = self._visible_division_ids(permission_code)
        if allowed_ids is None:
            return qs
        return qs.filter(
            Q(from_division_id__in=allowed_ids)
            | Q(to_division_id__in=allowed_ids)
        )

    def perform_create(self, serializer):
        """Источник и актор выводятся из серверных данных, не из payload."""
        employee = serializer.validated_data.get('employee')
        staff_unit = getattr(employee, 'staff_unit', None) if employee else None
        from_division = (
            getattr(staff_unit, 'division', None) if staff_unit else None
        )
        if from_division is None:
            raise ValidationError({
                'employee': 'Сотрудник не назначен в подразделение.'
            })
        allowed_ids = self._visible_division_ids('status.manage')
        if allowed_ids is not None and from_division.pk not in allowed_ids:
            raise PermissionDenied('PERMISSION_DENIED')
        serializer.save(
            from_division=from_division,
            requested_by=self.request.user,
            status=SecondmentRequest.ApprovalStatus.PENDING,
            approved_by=None,
            approved_at=None,
            rejection_reason='',
        )

    def _receiving_side_forbidden(self, request, instance):
        """Принимающая сторона: to_division должен быть в области актора."""
        allowed_ids = self._visible_division_ids('status.manage')
        if allowed_ids is None:
            return None
        if instance.to_division_id not in allowed_ids:
            return Response(
                {'detail': 'Решение вне вашего подразделения запрещено.'},
                status=403,
            )
        return None

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def approve(self, request, pk=None):
        """
        Одобрение запроса на прикомандирование.

        Заводится ОДИН статус — «Откомандирован в» на самого сотрудника, с
        related_division = принимающее подразделение. Принимающая сторона
        считается по этому же полю (reports.DataAggregator, reports/utils.py),
        отдельная зеркальная запись ей не нужна.

        Раньше заводились ДВЕ строки на один период — «Откомандирован в» и
        «Прикомандирован из», — а EmployeeStatus.clean пересечения запрещает:
        вторая падала ValidationError, и одобрение возвращало 500, оставив
        запрос помеченным одобренным и один осиротевший статус. Зеркальная
        запись к тому же дублировала человека в отчётах: он попадал и в
        «откомандирован», и в «прикомандирован» своего же подразделения.
        """
        instance = self.get_object()
        forbidden = self._receiving_side_forbidden(request, instance)
        if forbidden is not None:
            return forbidden
        if instance.status == SecondmentRequest.ApprovalStatus.APPROVED:
            # Повторное одобрение завело бы второй статус на тот же период.
            return Response(
                {'detail': 'Запрос уже одобрен.'},
                status=status_codes.HTTP_409_CONFLICT,
            )
        if instance.employee_id is None or instance.to_division_id is None:
            return Response(
                {'detail': 'В запросе не указан сотрудник или принимающее подразделение.'},
                status=status_codes.HTTP_400_BAD_REQUEST,
            )

        instance.status = SecondmentRequest.ApprovalStatus.APPROVED
        instance.approved_by = request.user
        instance.approved_at = timezone.now()
        instance.save()

        to_division_name = (
            instance.to_division.name if instance.to_division else instance.to_division_id
        )
        try:
            # Через сервис, а не EmployeeStatus.objects.create: он закрывает
            # текущий статус сотрудника (иначе пересечение с «В строю») и
            # пишет запись в историю изменений.
            StatusApplicationService().create_status(
                employee_id=instance.employee_id,
                status_type=EmployeeStatus.StatusType.SECONDED_TO,
                start_date=instance.start_date,
                end_date=instance.end_date,
                comment=f"Откомандирован в подразделение {to_division_name}",
                related_division_id=instance.to_division_id,
                user=request.user,
            )
        except DjangoValidationError as error:
            # Отказ статуса откатывает и одобрение: запрос, помеченный
            # одобренным без статуса, врал бы обеим сторонам.
            transaction.set_rollback(True)
            return Response(
                {'detail': 'Не удалось оформить откомандирование.',
                 'errors': getattr(error, 'message_dict', None) or error.messages},
                status=status_codes.HTTP_400_BAD_REQUEST,
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
    @transaction.atomic
    def return_employee(self, request, pk=None):
        """
        Возврат сотрудника из прикомандирования.

        Искали статус с `end_date__isnull=True`, а одобрение всегда проставляет
        конец периода из запроса — под условие не попадал НИ ОДИН статус, и
        возврат молча не возвращал никого: сотрудник оставался откомандирован
        до планового конца.

        Досрочное завершение идёт через сервис: он ставит фактическую дату
        конца, причину и заводит следом «В строю» — вернувшийся человек должен
        появиться в строю, а не остаться без статуса.
        """
        instance = self.get_object()
        forbidden = self._receiving_side_forbidden(request, instance)
        if forbidden is not None:
            return forbidden

        today = timezone.localdate()
        open_status = EmployeeStatus.objects.filter(
            employee_id=instance.employee_id,
            status_type=EmployeeStatus.StatusType.SECONDED_TO,
            state=EmployeeStatus.StatusState.ACTIVE,
        ).order_by('-start_date').first()
        if open_status is None:
            return Response(
                {'detail': 'Действующего откомандирования у сотрудника нет.'},
                status=status_codes.HTTP_409_CONFLICT,
            )

        try:
            StatusApplicationService().terminate_status_early(
                status_id=open_status.id,
                termination_date=today,
                reason=request.data.get('reason') or 'Возврат из прикомандирования',
                user=request.user,
            )
        except DjangoValidationError as error:
            transaction.set_rollback(True)
            return Response(
                {'detail': 'Не удалось вернуть сотрудника.',
                 'errors': getattr(error, 'message_dict', None) or error.messages},
                status=status_codes.HTTP_400_BAD_REQUEST,
            )

        instance.status = SecondmentRequest.ApprovalStatus.CANCELLED
        instance.save(update_fields=['status'])
        return Response({'status': 'сотрудник возвращен'})

    @action(detail=False, methods=['get'])
    def incoming(self, request):
        """
        Список входящих запросов для текущего пользователя.
        """
        queryset = self.get_queryset()
        allowed_ids = self._visible_division_ids('status.view')
        if allowed_ids is not None:
            queryset = queryset.filter(to_division_id__in=allowed_ids)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def outgoing(self, request):
        """
        Список исходящих запросов от текущего пользователя.
        """
        user = request.user
        queryset = self.get_queryset()
        allowed_ids = self._visible_division_ids('status.view')
        if allowed_ids is not None:
            queryset = queryset.filter(from_division_id__in=allowed_ids)
        queryset = queryset.filter(requested_by=user)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)
