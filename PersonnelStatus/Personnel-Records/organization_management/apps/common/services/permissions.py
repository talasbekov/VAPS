from typing import Any
from django.db.models import QuerySet, Q
from organization_management.apps.divisions.models import Division
from organization_management.apps.common.rbac import check_permission

class PermissionService:
    """
    Фасад над текущей системой RBAC (rbac.py, UserRole) для централизации проверок прав доступа
    и вычисления области видимости подразделений (scopes).
    Не применять ко Views до полного завершения тестирования.
    """
    def __init__(self, user):
        self.user = user
        self.role_info = getattr(user, 'role_info', None)

    def get_role_code(self) -> str | None:
        """Возвращает код роли текущего пользователя."""
        if not self.role_info:
            return None
        return self.role_info.get_role_code()

    def get_scope_division(self) -> Division | None:
        """Возвращает базовое (эффективное) подразделение для расчета видимости."""
        if not self.role_info:
            return None
        if hasattr(self.role_info, "effective_scope_division"):
            return self.role_info.effective_scope_division
        if hasattr(self.role_info, "get_user_division"):
            return self.role_info.get_user_division()
        return getattr(self.role_info, "scope_division", None)

    def get_visible_divisions(self) -> QuerySet[Division] | list:
        """Возвращает набор подразделений, доступных для просмотра."""
        if not self.user or not self.user.is_authenticated:
            return Division.objects.none()

        if self.user.is_superuser:
            return Division.objects.all()

        role = self.get_role_code()
        if not role:
            return Division.objects.none()

        # Роли 1 (Наблюдатель Орг), 4 (Сисадмин), 5 (Кадровик) видят всю организацию
        if role in ['ROLE_1', 'ROLE_4', 'ROLE_5']:
            return Division.objects.all()

        # Роль 2 (Наблюдатель Департамента)
        if role == 'ROLE_2':
            scope_div = self.get_scope_division()
            if not scope_div:
                return Division.objects.none()

            # Find the department in the ancestor tree
            department = None
            current = scope_div
            while current:
                if current.division_type == Division.DivisionType.DEPARTMENT:
                    department = current
                    break
                current = current.parent

            if not department:
                return Division.objects.none()
            return department.get_descendants(include_self=True)

        scope_div = self.get_scope_division()
        if not scope_div:
            return Division.objects.none()

        # Роль 3 (Начальник Управления) видит управление и все подчиненные отделы
        if role == 'ROLE_3':
            return scope_div.get_descendants(include_self=True)

        # Роли 6 (Нач. Отдела) и 7 (Делопроизводитель) видят только свой отдел
        if role in ['ROLE_6', 'ROLE_7']:
            return Division.objects.filter(id=scope_div.id)

        # По умолчанию безопасный фолбек - ничего не показываем
        return Division.objects.none()

    def can_perform(self, action: str, obj: Any = None) -> bool:
        """Проверка права на действие с использованием базового rbac.check_permission"""
        if not self.user or not self.user.is_authenticated:
            return False
        try:
            return check_permission(self.user, action, obj)
        except Exception:
            return False

    # === ЯВНЫЕ ФИЛЬТРЫ ДЛЯ QUERYSET (Explicit filtering helpers) ===

    def filter_employees(self, qs: QuerySet) -> QuerySet:
        visible_divs = self.get_visible_divisions()
        return qs.filter(staff_unit__division__in=visible_divs)

    def filter_staff_units(self, qs: QuerySet) -> QuerySet:
        visible_divs = self.get_visible_divisions()
        return qs.filter(division__in=visible_divs)

    def filter_statuses(self, qs: QuerySet) -> QuerySet:
        visible_divs = self.get_visible_divisions()
        return qs.filter(employee__staff_unit__division__in=visible_divs)

    def filter_secondments(self, qs: QuerySet) -> QuerySet:
        # Для прикомандирований мы должны видеть их, если либо from_division, либо to_division в нашей зоне
        visible_divs = self.get_visible_divisions()
        return qs.filter(Q(from_division__in=visible_divs) | Q(to_division__in=visible_divs))

    def filter_reports(self, qs: QuerySet) -> QuerySet:
        # Для отчетов базово ограничиваем областью видимости или автором
        visible_divs = self.get_visible_divisions()
        return qs.filter(Q(division__in=visible_divs) | Q(created_by=self.user))
