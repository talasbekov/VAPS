from django.db.models import QuerySet
from organization_management.apps.divisions.models import Division
from organization_management.apps.reports.models import Report


class PermissionService:
    """Область видимости отчётов.

    🔴 ОБЛАСТЬ ДАЁТ ГРАНТ ПРАВА РАЗДЕЛА (Plane №352, Ш-6). Раньше её брали у
    `user.role_info` — портальной роли из `common.UserRole`; этот шаг сносит
    её модель, и вместе с ней ушёл бы весь доступ к отчётам. Считается она
    ровно так же, как область штатки в `common/rbac.py`: подразделения гранта
    вместе с потомками.

    ПРАВО ВЫБРАНО ТО ЖЕ, ЧТО У ШТАТКИ (`orgstructure.view`), а не своё
    `report.*`: отчёт о расходе личного состава показывает те же
    подразделения, что и штатное расписание, и второе имя для одной и той же
    области разошлось бы с ним при первой раздаче прав.

    Поведение для того, у кого прав нет, ПРЕЖНЕЕ: пустая область. Раньше её
    давало отсутствие портальной роли, теперь — отсутствие гранта; человек
    по-прежнему видит только СВОИ отчёты (`created_by`), это решает вызывающий.
    """

    #: Право, чьи гранты и очерчивают область отчётов.
    SCOPE_PERMISSION = 'orgstructure.view'

    @staticmethod
    def get_accessible_divisions(user) -> QuerySet[Division]:
        """Подразделения, доступные пользователю: грант права и всё под ним."""
        if user.is_superuser:
            return Division.objects.all()

        from organization_management.apps.common.rbac import _scope_division_ids

        visible = _scope_division_ids(user, PermissionService.SCOPE_PERMISSION)
        if visible is None:
            # Грант без области (в том числе wildcard администратора).
            return Division.objects.all()
        if not visible:
            return Division.objects.none()
        return Division.objects.filter(id__in=sorted(visible))

    @staticmethod
    def can_access_division(user, division_id: int) -> bool:
        """
        Checks if the user has permission to access the specified division.
        """
        if user.is_superuser:
            return True

        accessible_divisions = PermissionService.get_accessible_divisions(user)
        # Handle string or int IDs
        return accessible_divisions.filter(id=int(division_id)).exists()

    @staticmethod
    def can_access_report(user, report: Report) -> bool:
        """
        Checks if the user has permission to view or download a specific report.
        """
        if user.is_superuser:
            return True

        # A user can always access a report they created
        if report.created_by_id == user.id:
            return True

        # Otherwise, they must have access to the division the report was generated for
        if report.division_id:
            return PermissionService.can_access_division(user, report.division_id)

        return False
