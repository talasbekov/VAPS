from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from .serializers import DivisionSerializer
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.employees.api.serializers import EmployeeSerializer
from organization_management.apps.operations.api.permissions import (
    require_permission,
    resolve_actor_id,
)
from organization_management.apps.operations.services import PermissionService

from django.utils import timezone


class DivisionTreeViewSet(viewsets.ViewSet):
    """
    ViewSet для получения дерева подразделений.
    Возвращает корневое подразделение со всеми детьми.
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = DivisionSerializer
    http_method_names = ['get']

    def list(self, request):
        """Возвращает корневое подразделение с детьми"""
        # Получаем первое корневое подразделение (parent=None)
        root = Division.objects.filter(parent__isnull=True).first()

        if not root:
            return Response({'detail': 'Корневое подразделение не найдено'}, status=404)

        serializer = DivisionSerializer(root)
        return Response(serializer.data)


class DivisionViewSet(viewsets.ModelViewSet):
    """
    ViewSet для управления подразделениями.
    Предоставляет CRUD операции и кастомные действия.
    """
    queryset = Division.objects.all()
    serializer_class = DivisionSerializer

    permission_classes = [permissions.IsAuthenticated]
    WRITE_PERMISSION = "orgstructure.manage"
    EMPLOYEES_PERMISSION = "personnel.view"
    WRITE_ACTIONS = frozenset(
        {
            "create", "update", "partial_update", "destroy", "restore", "move",
        }
    )

    def initial(self, request, *args, **kwargs):
        """Одного факта входа недостаточно для правки дерева (№955).

        На запись требуется явный код оргструктуры; action
        employees отдаёт кадровые карточки и потому гейтится
        отдельным `personnel.view`. Прочие legacy read-actions не меняются.
        """
        super().initial(request, *args, **kwargs)
        if self.action in self.WRITE_ACTIONS:
            require_permission(request, self.WRITE_PERMISSION)
        elif self.action == "employees":
            require_permission(request, self.EMPLOYEES_PERMISSION)

    def _scope_for(self, permission_code):
        return PermissionService.visible_division_ids(
            resolve_actor_id(self.request), permission_code
        )

    def _write_scope(self):
        return self._scope_for(self.WRITE_PERMISSION)

    def get_queryset(self):
        """Write-object и employees-source адресуются только в своём scope."""
        qs = super().get_queryset()
        scope_permission = None
        if self.action in self.WRITE_ACTIONS:
            scope_permission = self.WRITE_PERMISSION
        elif self.action == "employees":
            scope_permission = self.EMPLOYEES_PERMISSION
        if scope_permission is not None:
            allowed = self._scope_for(scope_permission)
            if allowed is not None:
                qs = qs.filter(pk__in=allowed)
        return qs

    def _assert_parent_in_write_scope(self, parent_id):
        """Новый parent тоже должен быть в области записи.

        Scoped-manager не может создать второй корень или вынести
        свой узел за границу обычным PATCH `parent`/action `move`.
        """
        allowed = self._write_scope()
        if allowed is None:
            return
        if parent_id is None or int(parent_id) not in allowed:
            raise PermissionDenied("PERMISSION_DENIED")

    def perform_create(self, serializer):
        parent = serializer.validated_data.get("parent")
        self._assert_parent_in_write_scope(parent.pk if parent else None)
        serializer.save()

    def perform_update(self, serializer):
        if "parent" in serializer.validated_data:
            parent = serializer.validated_data["parent"]
            self._assert_parent_in_write_scope(parent.pk if parent else None)
        serializer.save()

    @action(detail=True, methods=['get'])
    def employees(self, request, pk=None):
        """
        Получение списка сотрудников для конкретного подразделения.
        """
        division = self.get_object()
        # Employee links to Division through StaffUnit (Employee.staff_unit.division).
        employees = Employee.objects.filter(staff_unit__division=division)
        serializer = EmployeeSerializer(employees, many=True)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        """Мягкое удаление подразделения с проверками."""
        instance: Division = self.get_object()
        # запрет, если есть дочерние активные
        if instance.get_children().exists():
            return Response({'detail': 'Сначала удалите/переместите дочерние подразделения.'}, status=400)
        # запрет, если есть активные сотрудники
        from organization_management.apps.employees.models import Employee
        active_in_branch = Employee.objects.filter(
            staff_unit__division__in=instance.get_descendants(include_self=True),
            employment_status=Employee.EmploymentStatus.WORKING,
        ).exists()
        if active_in_branch:
            return Response({'detail': 'Нельзя удалить подразделение с активными сотрудниками.'}, status=400)

        instance.is_active = False
        instance.archived_at = timezone.now()
        instance.save(update_fields=['is_active', 'archived_at'])
        return Response(status=204)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def restore(self, request, pk=None):
        """Восстановление мягко удаленного подразделения."""
        instance: Division = self.get_object()
        instance.is_active = True
        instance.archived_at = None
        instance.save(update_fields=['is_active', 'archived_at'])
        return Response({'status': 'restored'})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def move(self, request, pk=None):
        """
        Перемещение узла на нового родителя с валидациями:
        - нельзя переместить в самого себя или в собственного потомка
        - ограничение глубины до 5 уровней
        """
        instance: Division = self.get_object()
        parent_id = request.data.get('parent_id')
        if parent_id is None:
            self._assert_parent_in_write_scope(parent_id)
            instance.parent = None
            instance.save()
            return Response({'status': 'moved'})
        try:
            parent_id = int(parent_id)
        except (TypeError, ValueError):
            return Response({'detail': 'Параметр parent_id должен быть числом.'}, status=400)
        self._assert_parent_in_write_scope(parent_id)
        if parent_id == instance.id:
            return Response({'detail': 'Нельзя переместить подразделение само в себя.'}, status=400)
        try:
            new_parent = Division.objects.get(pk=parent_id)
        except Division.DoesNotExist:
            return Response({'detail': 'Новый родитель не найден.'}, status=404)
        # запрет перемещения в потомка
        if new_parent in instance.get_descendants():
            return Response({'detail': 'Нельзя перемещать подразделение в собственный потомок.'}, status=400)

        # проверка глубины: глубина = глубина нового родителя + 1; ограничение <=5
        # вычислим будущую глубину как len(ancestors(new_parent)) + 1
        future_depth = len(new_parent.get_ancestors()) + 1
        if future_depth > 5:
            return Response({'detail': 'Превышена максимальная глубина вложенности (5).'}, status=400)

        instance.parent = new_parent
        instance.save()
        return Response({'status': 'moved'})
