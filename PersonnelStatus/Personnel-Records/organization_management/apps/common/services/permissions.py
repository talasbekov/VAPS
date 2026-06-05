from typing import Optional
from django.db.models import QuerySet
from organization_management.apps.divisions.models import Division
from organization_management.apps.reports.models import Report

class PermissionService:
    """
    Centralized service for evaluating user permissions based on their role and division scope.
    """

    @staticmethod
    def get_user_division(user) -> Optional[Division]:
        """
        Extracts the user's division from their role_info.
        """
        if hasattr(user, 'role_info') and hasattr(user.role_info, 'get_user_division'):
            return user.role_info.get_user_division()
        return None

    @staticmethod
    def get_accessible_divisions(user) -> QuerySet[Division]:
        """
        Returns a QuerySet of divisions the user is allowed to access.
        For superusers, this is all divisions.
        For others, it is their division and all of its descendants.
        If the user has no division and is not a superuser, it returns none.
        """
        if user.is_superuser:
            return Division.objects.all()

        user_division = PermissionService.get_user_division(user)
        if not user_division:
            return Division.objects.none()

        return user_division.get_descendants(include_self=True)

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
